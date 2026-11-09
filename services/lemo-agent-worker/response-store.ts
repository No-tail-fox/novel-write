import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { verifyMessagesReceipt } from './message-receipt';
import type { LemoRequestLedger } from './request-ledger';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
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
/** Private artifacts, NOT diagnostics. The host must enforce directory access on Windows.
 * File mode/linked-path checks are not an OS sandbox. No API keys or request bodies are stored.
 * Incomplete staging directories are retained for diagnosis and are never treated as committed.
 */
export class LemoResponseStore {
  private constructor(readonly directory: string, readonly maxBytes: number) {}
  static async open(directory: string, maxBytes = 32 * 1024 * 1024) {
    if (!isAbsolute(directory) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('LEMO_RESPONSE_OPTIONS');
    await rejectLinks(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rejectLinks(directory);
    if (!(await lstat(directory)).isDirectory()) throw new Error('LEMO_RESPONSE_DIRECTORY');
    return new LemoResponseStore(directory, maxBytes);
  }
  private destination(requestId: string) {
    if (!ID.test(requestId)) throw new Error('LEMO_RESPONSE_ID');
    return join(this.directory, requestId);
  }
  async save(input: StoredLemoResponse): Promise<void> {
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
/** Explicit local recovery. No model call and no tool replay is performed here. */
export async function recoverStoredLemoResponse(ledger: LemoRequestLedger, fingerprint: string): Promise<StoredLemoResponse> {
  const entry = ledger.lookup(fingerprint);
  if (!entry) throw new Error('LEMO_RECOVERY_REQUEST_MISSING');
  if (entry.receipt?.outcome === 'rejected') throw new Error('LEMO_LEDGER_RECOVERY_REJECTED');
  const store = await LemoResponseStore.open(ledger.responseDirectory);
  const artifact = await store.load(entry.requestId, fingerprint);
  if (!artifact) throw new Error('LEMO_RECOVERY_RESPONSE_MISSING');
  const receipt = { outcome: 'received' as const, httpStatus: 200, ...verifyMessagesReceipt(artifact.response, artifact.stream) };
  await ledger.recordRecoveredResponse(entry.requestId, fingerprint, receipt);
  return artifact;
}