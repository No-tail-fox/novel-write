import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { object, type PiReceipt } from './receipt';
export function requestFingerprint(v: unknown): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    const encoded = JSON.stringify(value); if (encoded === undefined) throw new Error('PI_LEDGER_FINGERPRINT'); return encoded;
  };
  return createHash('sha256').update(canonical(v)).digest('hex');
}
export async function rejectLinks(path: string): Promise<void> {
  let current = resolve(path);
  for (;;) {
    try { const s = await lstat(current); if (s.isSymbolicLink() || (s.isFile() && s.nlink !== 1)) throw new Error('PI_LEDGER_LINK'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
interface Entry { version: 1; seq: number; kind: 'submitted' | 'settled'; requestId: string; at: string; fingerprint?: string; receipt?: PiReceipt }
export class PiRequestLedger {
  private entries = new Map<string, { fingerprint: string; receipt?: PiReceipt }>();
  private seq = 0; private busy = false; private poisoned = false; private closed = false;
  private constructor(readonly directory: string, private journal: FileHandle, private lock: FileHandle, readonly maxRequests: number) {}
  static async open(directory: string, maxRequests: number): Promise<PiRequestLedger> {
    if (!isAbsolute(directory) || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new Error('PI_LEDGER_OPTIONS');
    await rejectLinks(directory); await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = join(directory, 'owner.lock'); const journalPath = join(directory, 'requests.jsonl');
    await rejectLinks(lockPath); await rejectLinks(journalPath);
    const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('PI_LEDGER_LOCKED'); });
    let journal: FileHandle | undefined;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); await lock.sync();
      journal = await open(journalPath, 'a+', 0o600);
      if ((await journal.stat()).size > 8 * 1024 * 1024) throw new Error('PI_LEDGER_CORRUPT');
      const ledger = new PiRequestLedger(directory, journal, lock, maxRequests);
      ledger.restore(await readFile(journalPath, 'utf8')); return ledger;
    } catch (e) { await journal?.close(); await lock.close(); await unlink(lockPath); throw e; }
  }
  private restore(text: string) {
    if (text && !text.endsWith('\n')) throw new Error('PI_LEDGER_CORRUPT');
    for (const line of text.split('\n').filter(Boolean)) {
      const e = JSON.parse(line) as Entry;
      if (!object(e) || e.version !== 1 || e.seq !== this.seq + 1 || !/^[a-zA-Z0-9_-]{1,160}$/.test(e.requestId)
        || typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at))) throw new Error('PI_LEDGER_CORRUPT');
      if (e.kind === 'submitted' && typeof e.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(e.fingerprint) && !this.entries.has(e.requestId)) {
        this.entries.set(e.requestId, { fingerprint: e.fingerprint });
      } else if (e.kind === 'settled' && this.entries.has(e.requestId) && !this.entries.get(e.requestId)!.receipt && this.validReceipt(e.receipt)) {
        this.entries.get(e.requestId)!.receipt = e.receipt;
      } else throw new Error('PI_LEDGER_CORRUPT');
      this.seq = e.seq;
    }
  }
  private validReceipt(r: unknown): r is PiReceipt {
    return object(r) && ['received', 'rejected', 'unknown'].includes(r.outcome)
      && (r.httpStatus === undefined || (Number.isInteger(r.httpStatus) && r.httpStatus >= 100 && r.httpStatus <= 599))
      && (r.outcome !== 'received' || (r.httpStatus === 200 && ['anthropic', 'openai-chat', 'openai-responses'].includes(r.protocol)
        && typeof r.messageId === 'string' && !!r.messageId && typeof r.stopReason === 'string' && !!r.stopReason
        && typeof r.terminalEvidence === 'string' && !!r.terminalEvidence
        && (r.usageStatus === 'unknown' || (r.usageStatus === 'known' && object(r.usage))) && /^[a-f0-9]{64}$/.test(r.responseSha256)));
  }
  summary() {
    const values = [...this.entries.values()]; const received = values.filter(x => x.receipt?.outcome === 'received').length;
    const rejected = values.filter(x => x.receipt?.outcome === 'rejected').length;
    const unknown = values.length - received - rejected;
    const usageUnknown = values.filter(x => x.receipt?.outcome === 'received' && x.receipt.usageStatus !== 'known').length;
    return { requests: values.length, received, rejected, unknown, usageUnknown, blocked: this.poisoned || unknown > 0 || rejected > 0 || usageUnknown > 0 || values.some(x => x.receipt?.terminalEvidence === 'response.failed') };
  }
  /** Detached receipt snapshot for host budget accounting; nested native usage is cloned. */
  receipts(): ReadonlyArray<{ readonly requestId: string; readonly receipt?: PiReceipt }> {
    return [...this.entries].map(([requestId, entry]) => ({ requestId, ...(entry.receipt ? { receipt: structuredClone(entry.receipt) } : {}) }));
  }
  lookup(fingerprint: string) { const pair = [...this.entries].find(([, v]) => v.fingerprint === fingerprint); return pair ? { requestId: pair[0], ...structuredClone(pair[1]) } : undefined; }
  private async append(e: Entry) {
    try { await this.journal.writeFile(JSON.stringify(e) + '\n'); await this.journal.sync(); this.seq = e.seq; }
    catch { this.poisoned = true; throw new Error('PI_LEDGER_PERSIST_FAILED'); }
  }
  async begin(fingerprint: string): Promise<string> {
    if (this.closed || this.busy || this.poisoned) throw new Error('PI_LEDGER_UNAVAILABLE');
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('PI_LEDGER_FINGERPRINT');
    if (this.summary().blocked) throw new Error('PI_LEDGER_BLOCKED');
    if (this.lookup(fingerprint)) throw new Error('PI_LEDGER_DUPLICATE');
    if (this.entries.size >= this.maxRequests) throw new Error('PI_LEDGER_REQUEST_LIMIT');
    this.busy = true;
    try { const requestId = randomUUID(); await this.append({ version: 1, seq: this.seq + 1, kind: 'submitted', requestId, fingerprint, at: new Date().toISOString() });
      this.entries.set(requestId, { fingerprint }); return requestId;
    } finally { this.busy = false; }
  }
  async settle(requestId: string, receipt: PiReceipt) {
    if (this.closed || this.busy || this.poisoned || !this.entries.has(requestId) || this.entries.get(requestId)!.receipt) throw new Error('PI_LEDGER_UNAVAILABLE');
    if (!this.validReceipt(receipt)) throw new Error('PI_LEDGER_RECEIPT');
    this.busy = true;
    try { const copy = structuredClone(receipt); await this.append({ version: 1, seq: this.seq + 1, kind: 'settled', requestId, receipt: copy, at: new Date().toISOString() }); this.entries.get(requestId)!.receipt = copy; }
    finally { this.busy = false; }
  }
  /** Close only after gateway.close(). A process crash intentionally leaves owner.lock. */
  async close() { if (this.closed) return; if (this.busy) throw new Error('PI_LEDGER_BUSY'); this.closed = true;
    await this.journal.close(); await this.lock.close(); await unlink(join(this.directory, 'owner.lock')); }
}
