import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { verifyMessagesReceipt } from './message-receipt';
import type { LemoRequestLedger } from './request-ledger';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
interface ResponseLimits { version: 1; maxBytes: number }
interface ResponseManifest {
  version: 1; requestId: string; fingerprint: string; stream: boolean;
  byteLength: number; sha256: string; createdAt: string;
}
export interface StoredLemoResponse {
  requestId: string; fingerprint: string; stream: boolean; response: Buffer;
}
async function rejectLinks(path: string) {
  let current = resolve(path);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('LEMO_RESPONSE_LINK'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
async function readRegular(path: string, limit: number): Promise<Buffer> {
  await rejectLinks(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > limit) throw new Error('LEMO_RESPONSE_FILE');
  const bytes = await readFile(path);
  if (bytes.length !== stat.size || bytes.length > limit) throw new Error('LEMO_RESPONSE_FILE');
  return bytes;
}
async function writeExclusive(path: string, bytes: Uint8Array) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function readLimits(path: string): Promise<number | undefined> {
  await rejectLinks(path);
  let bytes: Buffer;
  try { bytes = await readRegular(path, 4096); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('LEMO_RESPONSE_LIMITS');
  }
  let limits: ResponseLimits;
  try { limits = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('LEMO_RESPONSE_LIMITS'); }
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) || limits.version !== 1
    || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1
    || Object.keys(limits).sort().join(',') !== 'maxBytes,version') throw new Error('LEMO_RESPONSE_LIMITS');
  return limits.maxBytes;
}
async function prepareLimits(directory: string, requested?: number): Promise<number> {
  const path = join(directory, 'limits.json');
  let stored = await readLimits(path);
  if (stored === undefined) {
    const pending = join(directory, '.limits-' + randomUUID() + '.pending');
    const limits: ResponseLimits = { version: 1, maxBytes: requested ?? DEFAULT_MAX_BYTES };
    await writeExclusive(pending, Buffer.from(JSON.stringify(limits), 'utf8'));
    try {
      await rejectLinks(path);
      // Publish a complete, flushed policy without replacing another creator's policy.
      // Until the pending hard link is removed, readers fail closed on nlink !== 1.
      await link(pending, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally { await unlink(pending); }
    stored = await readLimits(path);
  }
  if (stored === undefined) throw new Error('LEMO_RESPONSE_LIMITS_MISSING');
  if (requested !== undefined && requested !== stored) throw new Error('LEMO_RESPONSE_LIMITS_CONFLICT');
  return stored;
}
/** Private artifacts, NOT diagnostics. The host must enforce directory access on Windows.
 * File mode/linked-path checks are not an OS sandbox. No API keys or request bodies are stored.
 * Incomplete staging directories are retained for diagnosis and are never treated as committed.
 */
export class LemoResponseStore {
  private constructor(readonly directory: string, readonly maxBytes: number) {}
  static async open(directory: string, maxBytes?: number) {
    if (!isAbsolute(directory) || (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1))) throw new Error('LEMO_RESPONSE_OPTIONS');
    await rejectLinks(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rejectLinks(directory);
    if (!(await lstat(directory)).isDirectory()) throw new Error('LEMO_RESPONSE_DIRECTORY');
    return new LemoResponseStore(directory, await prepareLimits(directory, maxBytes));
  }
  private async assertLimits(): Promise<void> {
    const stored = await readLimits(join(this.directory, 'limits.json'));
    if (stored === undefined) throw new Error('LEMO_RESPONSE_LIMITS_MISSING');
    if (stored !== this.maxBytes) throw new Error('LEMO_RESPONSE_LIMITS_CONFLICT');
  }
  private destination(requestId: string) {
    if (!ID.test(requestId)) throw new Error('LEMO_RESPONSE_ID');
    return join(this.directory, requestId);
  }
  async save(input: StoredLemoResponse): Promise<void> {
    await this.assertLimits();
    const final = this.destination(input.requestId);
    if (!HASH.test(input.fingerprint) || typeof input.stream !== 'boolean' || !Buffer.isBuffer(input.response)
      || input.response.length < 1 || input.response.length > this.maxBytes) throw new Error('LEMO_RESPONSE_INPUT');
    verifyMessagesReceipt(input.response, input.stream);
    await rejectLinks(final);
    const existing = await this.load(input.requestId, input.fingerprint);
    if (existing) {
      if (existing.stream !== input.stream || !existing.response.equals(input.response)) throw new Error('LEMO_RESPONSE_CONFLICT');
      return;
    }
    const staging = join(this.directory, `.${input.requestId}-${randomUUID()}.pending`);
    await mkdir(staging, { mode: 0o700 });
    const manifest: ResponseManifest = { version: 1, requestId: input.requestId, fingerprint: input.fingerprint,
      stream: input.stream, byteLength: input.response.length, sha256: sha256(input.response), createdAt: new Date().toISOString() };
    await writeExclusive(join(staging, 'response.bin'), input.response);
    await writeExclusive(join(staging, 'manifest.json'), Buffer.from(JSON.stringify(manifest), 'utf8'));
    await rejectLinks(final);
    await rename(staging, final);
  }
  async load(requestId: string, fingerprint: string): Promise<StoredLemoResponse | undefined> {
    await this.assertLimits();
    const final = this.destination(requestId);
    if (!HASH.test(fingerprint)) throw new Error('LEMO_RESPONSE_FINGERPRINT');
    await rejectLinks(final);
    try { if (!(await lstat(final)).isDirectory()) throw new Error('LEMO_RESPONSE_DIRECTORY'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
    let manifest: ResponseManifest;
    try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readRegular(join(final, 'manifest.json'), 4096))); }
    catch { throw new Error('LEMO_RESPONSE_MANIFEST'); }
    if (!manifest || manifest.version !== 1 || manifest.requestId !== requestId || manifest.fingerprint !== fingerprint
      || typeof manifest.stream !== 'boolean' || !Number.isSafeInteger(manifest.byteLength) || manifest.byteLength < 1 || manifest.byteLength > this.maxBytes
      || typeof manifest.sha256 !== 'string' || !HASH.test(manifest.sha256) || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))
      || Object.keys(manifest).sort().join(',') !== 'byteLength,createdAt,fingerprint,requestId,sha256,stream,version') throw new Error('LEMO_RESPONSE_MANIFEST');
    const response = await readRegular(join(final, 'response.bin'), this.maxBytes);
    if (response.length !== manifest.byteLength || sha256(response) !== manifest.sha256) throw new Error('LEMO_RESPONSE_CHECKSUM');
    verifyMessagesReceipt(response, manifest.stream);
    return { requestId, fingerprint, stream: manifest.stream, response };
  }
}
/** Explicit local recovery. No model call and no tool replay is performed here.
 * For a legacy store without limits.json, the host may supply its known original limit.
 * Otherwise migration uses the default; response manifests never enlarge that limit.
 */
export async function recoverStoredLemoResponse(ledger: LemoRequestLedger, fingerprint: string, legacyMaxBytes?: number): Promise<StoredLemoResponse> {
  const entry = ledger.lookup(fingerprint);
  if (!entry) throw new Error('LEMO_RECOVERY_REQUEST_MISSING');
  if (entry.receipt?.outcome === 'rejected') throw new Error('LEMO_LEDGER_RECOVERY_REJECTED');
  const store = await LemoResponseStore.open(ledger.responseDirectory, legacyMaxBytes);
  const artifact = await store.load(entry.requestId, fingerprint);
  if (!artifact) throw new Error('LEMO_RECOVERY_RESPONSE_MISSING');
  const receipt = { outcome: 'received' as const, httpStatus: 200, ...verifyMessagesReceipt(artifact.response, artifact.stream) };
  await ledger.recordRecoveredResponse(entry.requestId, fingerprint, receipt);
  return artifact;
}
