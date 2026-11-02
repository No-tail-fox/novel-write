import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

interface OwnerRecord { version: 2; ownerId: string; pid: number; host: string; createdAt: string }
export interface LemoLedgerOwnerSnapshot {
  fingerprint: string; ownerId: string; pid: number; host: string; createdAt: string;
  processState: 'active' | 'exited' | 'unverifiable';
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export async function rejectLedgerLinks(path: string): Promise<void> {
  let current = resolve(path);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('LEMO_LEDGER_LINK'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
async function readOwner(path: string) {
  await rejectLedgerLinks(path);
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 4096) throw new Error('LEMO_LEDGER_OWNER_FILE');
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size) throw new Error('LEMO_LEDGER_OWNER_CHANGED');
    let record: OwnerRecord;
    try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('LEMO_LEDGER_OWNER_CORRUPT'); }
    if (!record || record.version !== 2) throw new Error('LEMO_LEDGER_RECOVERY_LEGACY_OWNER');
    if (!UUID.test(record.ownerId) || !Number.isSafeInteger(record.pid) || record.pid < 1 || record.pid > 0x7fffffff
      || typeof record.host !== 'string' || !record.host || record.host.length > 255
      || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
      || Object.keys(record).sort().join(',') !== 'createdAt,host,ownerId,pid,version') throw new Error('LEMO_LEDGER_OWNER_CORRUPT');
    return { record, fingerprint: hash(bytes), stat };
  } finally { await handle.close(); }
}
function ownerProcessState(record: OwnerRecord): LemoLedgerOwnerSnapshot['processState'] {
  if (record.host !== hostname()) return 'unverifiable';
  try { process.kill(record.pid, 0); return 'active'; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'exited' : 'unverifiable'; }
}
export async function inspectLemoLedgerOwner(directory: string): Promise<LemoLedgerOwnerSnapshot> {
  if (!isAbsolute(directory)) throw new Error('LEMO_LEDGER_OPTIONS');
  const { record, fingerprint } = await readOwner(join(directory, 'owner.lock'));
  const { ownerId, pid, host, createdAt } = record;
  return { fingerprint, ownerId, pid, host, createdAt, processState: ownerProcessState(record) };
}
async function assertNoRecovery(directory: string) {
  const path = join(directory, 'recovery.lock'); await rejectLedgerLinks(path);
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('LEMO_LEDGER_RECOVERY_LOCKED');
}

/** Cooperating owners verify their lease before release instead of unlinking by pathname alone.
 * This does not protect against a local attacker replacing files between validation and mutation.
 */
export class LemoLedgerOwnerLease {
  private released = false;
  private constructor(private readonly path: string, private readonly handle: FileHandle,
    private readonly fingerprint: string, private readonly device: number, private readonly inode: number) {}
  static async create(directory: string, name: 'owner.lock' | 'recovery.lock') {
    const path = join(directory, name); await rejectLedgerLinks(path);
    const handle = await open(path, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new Error(name === 'owner.lock' ? 'LEMO_LEDGER_LOCKED: active or interrupted owner; recovery must be explicit.' : 'LEMO_LEDGER_RECOVERY_LOCKED');
      throw error;
    });
    const identity = await handle.stat();
    try {
      const record: OwnerRecord = { version: 2, ownerId: randomUUID(), pid: process.pid, host: hostname(), createdAt: new Date().toISOString() };
      const bytes = Buffer.from(JSON.stringify(record), 'utf8');
      await handle.writeFile(bytes); await handle.sync();
      return new LemoLedgerOwnerLease(path, handle, hash(bytes), identity.dev, identity.ino);
    } catch (error) {
      // Only roll back the file that this exclusive create actually made.
      try { const current = await lstat(path); if (current.dev === identity.dev && current.ino === identity.ino && current.nlink === 1) await unlink(path); } catch { /* Preserve evidence on cleanup failure. */ }
      await handle.close(); throw error;
    }
  }
  async assertOwned(): Promise<void> {
    if (this.released) throw new Error('LEMO_LEDGER_OWNER_CHANGED');
    const current = await readOwner(this.path);
    if (current.fingerprint !== this.fingerprint || current.stat.dev !== this.device || current.stat.ino !== this.inode) throw new Error('LEMO_LEDGER_OWNER_CHANGED');
  }
  async release(): Promise<void> {
    if (this.released) return;
    try { await this.assertOwned(); await unlink(this.path); }
    finally { this.released = true; await this.handle.close(); }
  }
}
export async function acquireLemoLedgerOwner(directory: string): Promise<LemoLedgerOwnerLease> {
  await assertNoRecovery(directory);
  const owner = await LemoLedgerOwnerLease.create(directory, 'owner.lock');
  try { await assertNoRecovery(directory); return owner; }
  catch (error) { await owner.release(); throw error; }
}

/** Explicit same-host recovery only. PID reuse is conservative: ANY live process blocks takeover.
 * All participants use recovery.lock. If recovery itself crashes, its marker is retained and
 * blocks further opens for manual inspection; it is never guessed stale or silently deleted.
 * Local filesystem checks do not provide a sandbox or a cross-host distributed lease.
 */
export async function recoverLemoLedgerOwner(directory: string, expectedFingerprint: string, beforeArchive: () => Promise<void>): Promise<LemoLedgerOwnerLease> {
  if (!isAbsolute(directory) || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new Error('LEMO_LEDGER_RECOVERY_OPTIONS');
  await rejectLedgerLinks(directory);
  const guard = await LemoLedgerOwnerLease.create(directory, 'recovery.lock');
  let owner: LemoLedgerOwnerLease | undefined;
  try {
    const previous = await readOwner(join(directory, 'owner.lock'));
    if (previous.fingerprint !== expectedFingerprint) throw new Error('LEMO_LEDGER_OWNER_CHANGED');
    const state = ownerProcessState(previous.record);
    if (state !== 'exited') throw new Error(state === 'active' ? 'LEMO_LEDGER_OWNER_ACTIVE' : 'LEMO_LEDGER_OWNER_UNVERIFIABLE');
    await beforeArchive();
    const history = join(directory, 'owner-history'); await rejectLedgerLinks(history);
    await mkdir(history, { recursive: true, mode: 0o700 }); await rejectLedgerLinks(history);
    const path = join(directory, 'owner.lock');
    const current = await readOwner(path);
    if (current.fingerprint !== previous.fingerprint || current.stat.dev !== previous.stat.dev || current.stat.ino !== previous.stat.ino) throw new Error('LEMO_LEDGER_OWNER_CHANGED');
    const archived = join(history, `${previous.record.ownerId}-${randomUUID()}.json`);
    await rename(path, archived);
    if ((await readOwner(archived)).fingerprint !== previous.fingerprint) throw new Error('LEMO_LEDGER_OWNER_CHANGED');
    owner = await LemoLedgerOwnerLease.create(directory, 'owner.lock');
    await guard.release(); return owner;
  } catch (error) {
    await owner?.release().catch(() => {});
    await guard.release().catch(() => {});
    throw error;
  }
}
