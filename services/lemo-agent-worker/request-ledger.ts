import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { acquireLemoLedgerOwner, inspectLemoLedgerOwner, recoverLemoLedgerOwner, rejectLedgerLinks, type LemoLedgerOwnerLease } from './ledger-owner';
export type { LemoLedgerOwnerSnapshot } from './ledger-owner';

export type ReceiptOutcome = 'received' | 'rejected' | 'unknown';
export interface RequestReceipt {
  outcome: ReceiptOutcome;
  httpStatus?: number;
  messageId?: string;
  stopReason?: string;
  responseSha256?: string;
}
interface Submitted { version: 1; kind: 'submitted'; seq: number; requestId: string; fingerprint: string; at: string }
interface Settled { version: 1; kind: 'settled' | 'recovered'; seq: number; requestId: string; at: string; receipt: RequestReceipt }
type Entry = Submitted | Settled;
export interface LedgerSummary { requests: number; received: number; rejected: number; unknown: number; blocked: boolean }
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
export function requestFingerprint(value: unknown): string {
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
    const result = JSON.stringify(v); if (result === undefined) throw new Error('LEMO_LEDGER_FINGERPRINT'); return result;
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function receiptValid(v: RequestReceipt): boolean {
  return !!v && ['received', 'rejected', 'unknown'].includes(v.outcome)
    && Object.keys(v).every(k => ['outcome','httpStatus','messageId','stopReason','responseSha256'].includes(k))
    && (v.httpStatus === undefined || (Number.isInteger(v.httpStatus) && v.httpStatus >= 100 && v.httpStatus <= 599))
    && (v.messageId === undefined || (typeof v.messageId === 'string' && SAFE_ID.test(v.messageId)))
    && (v.stopReason === undefined || (typeof v.stopReason === 'string' && SAFE_ID.test(v.stopReason)))
    && (v.responseSha256 === undefined || (typeof v.responseSha256 === 'string' && SHA256.test(v.responseSha256)))
    && (v.outcome !== 'received' || (v.httpStatus === 200 && !!v.messageId && !!v.stopReason && !!v.responseSha256));
}
function restoreJournal(text: string) {
  const submitted = new Map<string, Submitted>(); const receipts = new Map<string, RequestReceipt>(); let seq = 0;
  if (text && !text.endsWith('\n')) throw new Error('LEMO_LEDGER_CORRUPT');
  for (const line of text.split('\n').filter(Boolean)) {
    let e: Entry; try { e = JSON.parse(line); } catch { throw new Error('LEMO_LEDGER_CORRUPT'); }
    if (!e || e.version !== 1 || e.seq !== seq + 1 || typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at))
      || typeof e.requestId !== 'string' || !SAFE_ID.test(e.requestId)) throw new Error('LEMO_LEDGER_CORRUPT');
    if (e.kind === 'submitted') {
      if (typeof e.fingerprint !== 'string' || !SHA256.test(e.fingerprint) || submitted.has(e.requestId)
        || [...submitted.values()].some(previous => previous.fingerprint === e.fingerprint)
        || Object.keys(e).sort().join(',') !== 'at,fingerprint,kind,requestId,seq,version') throw new Error('LEMO_LEDGER_CORRUPT');
      submitted.set(e.requestId, e);
    } else if (e.kind === 'settled' || e.kind === 'recovered') {
      const previous = receipts.get(e.requestId);
      const invalidTransition = e.kind === 'settled' ? !!previous
        : e.receipt?.outcome !== 'received' || (previous !== undefined && previous.outcome !== 'unknown');
      if (!submitted.has(e.requestId) || invalidTransition || !receiptValid(e.receipt)
        || Object.keys(e).sort().join(',') !== 'at,kind,receipt,requestId,seq,version') throw new Error('LEMO_LEDGER_CORRUPT');
      receipts.set(e.requestId, e.receipt);
    } else throw new Error('LEMO_LEDGER_CORRUPT');
    seq = e.seq;
  }
  return { submitted, receipts, seq };
}
function validateOptions(directory: string, maxRequests: number) {
  if (!isAbsolute(directory) || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new Error('LEMO_LEDGER_OPTIONS');
}
async function openJournal(directory: string, existingOnly: boolean) {
  const path = join(directory, 'requests.jsonl'); await rejectLedgerLinks(path);
  try { const info = await lstat(path); if (!info.isFile() || info.nlink !== 1) throw new Error('LEMO_LEDGER_JOURNAL_FILE'); }
  catch (error) { if (existingOnly || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const journal = await open(path, existingOnly ? constants.O_RDWR | constants.O_APPEND : 'a+', 0o600);
  try {
    const stat = await journal.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_JOURNAL_BYTES) throw new Error('LEMO_LEDGER_CORRUPT');
    return journal;
  } catch (error) { await journal.close(); throw error; }
}
/** One exclusive owner per run/stage. A crash leaves the lock in place: never auto-steal it.
 * Journal contains only opaque IDs/hashes/receipts, never prompt, response body or credentials.
 * Filesystem permissions/ownership must be enforced by the caller; this is not an OS sandbox.
 */
export class LemoRequestLedger {
  private readonly submitted = new Map<string, Submitted>();
  private readonly receipts = new Map<string, RequestReceipt>();
  private seq = 0;
  private busy = false;
  private poisoned = false;
  private closed = false;
  private constructor(private readonly directory: string, private readonly journal: FileHandle, private readonly owner: LemoLedgerOwnerLease, readonly maxRequests: number) {}
  static async open(directory: string, maxRequests: number, options: { existingOnly?: boolean } = {}): Promise<LemoRequestLedger> {
    validateOptions(directory, maxRequests);
    await rejectLedgerLinks(directory); await mkdir(directory, { recursive: true, mode: 0o700 });
    return this.openOwned(directory, maxRequests, await acquireLemoLedgerOwner(directory), options.existingOnly === true);
  }
  static inspectInterruptedOwner(directory: string) { return inspectLemoLedgerOwner(directory); }
  /** Explicit host action; never invoked by open() or by an SDK retry.
   * Reuses the original journal, request IDs and private responses. No request/tool is replayed.
   */
  static async recoverInterruptedOwner(directory: string, maxRequests: number, expectedOwnerFingerprint: string): Promise<LemoRequestLedger> {
    validateOptions(directory, maxRequests);
    const owner = await recoverLemoLedgerOwner(directory, expectedOwnerFingerprint, async () => {
      const journal = await openJournal(directory, true);
      try { restoreJournal(await journal.readFile('utf8')); } finally { await journal.close(); }
    });
    return this.openOwned(directory, maxRequests, owner, true);
  }
  private static async openOwned(directory: string, maxRequests: number, owner: LemoLedgerOwnerLease, existingOnly: boolean): Promise<LemoRequestLedger> {
    let journal: FileHandle | undefined;
    try {
      journal = await openJournal(directory, existingOnly);
      const ledger = new LemoRequestLedger(directory, journal, owner, maxRequests);
      const restored = restoreJournal(await journal.readFile('utf8'));
      for (const [key, value] of restored.submitted) ledger.submitted.set(key, value);
      for (const [key, value] of restored.receipts) ledger.receipts.set(key, value);
      ledger.seq = restored.seq; return ledger;
    } catch (error) {
      try { await journal?.close(); } finally { await owner.release(); }
      throw error;
    }
  }
  get responseDirectory(): string { return join(this.directory, 'private-responses'); }
  lookup(fingerprint: string): { requestId: string; fingerprint: string; receipt?: RequestReceipt } | undefined {
    if (this.closed || this.busy || this.poisoned) throw new Error('LEMO_LEDGER_UNAVAILABLE');
    if (!SHA256.test(fingerprint)) throw new Error('LEMO_LEDGER_FINGERPRINT');
    const entry = [...this.submitted.values()].find(e => e.fingerprint === fingerprint);
    if (!entry) return undefined;
    const receipt = this.receipts.get(entry.requestId);
    return { requestId: entry.requestId, fingerprint, ...(receipt ? { receipt: { ...receipt } } : {}) };
  }
  summary(): LedgerSummary {
    const outcomes = [...this.receipts.values()];
    const unknown = this.submitted.size - this.receipts.size + outcomes.filter(r => r.outcome === 'unknown').length;
    const rejected = outcomes.filter(r => r.outcome === 'rejected').length;
    return { requests: this.submitted.size, received: outcomes.filter(r => r.outcome === 'received').length, rejected, unknown,
      blocked: this.poisoned || unknown > 0 || rejected > 0 };
  }
  private async append(e: Entry) {
    try { await this.owner.assertOwned(); await this.journal.writeFile(JSON.stringify(e) + '\n'); await this.journal.sync(); this.seq = e.seq; }
    catch { this.poisoned = true; throw new Error('LEMO_LEDGER_PERSIST_FAILED'); }
  }
  async begin(fingerprint: string): Promise<string> {
    if (this.closed || this.busy || this.poisoned) throw new Error('LEMO_LEDGER_UNAVAILABLE');
    if (!SHA256.test(fingerprint)) throw new Error('LEMO_LEDGER_FINGERPRINT');
    if (this.summary().blocked) throw new Error('LEMO_LEDGER_BLOCKED: unresolved or rejected request; no automatic retry.');
    if ([...this.submitted.values()].some(e => e.fingerprint === fingerprint)) throw new Error('LEMO_LEDGER_DUPLICATE');
    if (this.submitted.size >= this.maxRequests) throw new Error('LEMO_LEDGER_REQUEST_LIMIT');
    this.busy = true;
    try {
      const e: Submitted = { version: 1, kind: 'submitted', seq: this.seq + 1, requestId: randomUUID(), fingerprint, at: new Date().toISOString() };
      await this.append(e); this.submitted.set(e.requestId, e); return e.requestId;
    } finally { this.busy = false; }
  }
  async settle(requestId: string, receipt: RequestReceipt): Promise<void> {
    if (this.closed || this.busy || this.poisoned || !this.submitted.has(requestId) || this.receipts.has(requestId)) throw new Error('LEMO_LEDGER_UNAVAILABLE');
    if (!receiptValid(receipt)) throw new Error('LEMO_LEDGER_RECEIPT');
    this.busy = true;
    try {
      const safeReceipt = { ...receipt };
      await this.append({ version: 1, kind: 'settled', seq: this.seq + 1, requestId, at: new Date().toISOString(), receipt: safeReceipt });
      this.receipts.set(requestId, safeReceipt);
    } finally { this.busy = false; }
  }
  /** Explicit host recovery only. Caller must verify the complete private response first. */
  async recordRecoveredResponse(requestId: string, fingerprint: string, receipt: RequestReceipt): Promise<void> {
    if (this.closed || this.busy || this.poisoned || this.submitted.get(requestId)?.fingerprint !== fingerprint) throw new Error('LEMO_LEDGER_UNAVAILABLE');
    if (receipt.outcome !== 'received' || !receiptValid(receipt)) throw new Error('LEMO_LEDGER_RECEIPT');
    const previous = this.receipts.get(requestId);
    if (previous?.outcome === 'received') {
      if (requestFingerprint(previous) !== requestFingerprint(receipt)) throw new Error('LEMO_LEDGER_RECOVERY_MISMATCH');
      return;
    }
    if (previous && previous.outcome !== 'unknown') throw new Error('LEMO_LEDGER_RECOVERY_REJECTED');
    this.busy = true;
    try {
      const copy = { ...receipt };
      await this.append({ version: 1, kind: 'recovered', seq: this.seq + 1, requestId, at: new Date().toISOString(), receipt: copy });
      this.receipts.set(requestId, copy);
    } finally { this.busy = false; }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.busy) throw new Error('LEMO_LEDGER_BUSY');
    this.closed = true;
    try { await this.journal.close(); } finally { await this.owner.release(); }
  }
}
