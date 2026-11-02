import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { LemoRequestLedger, requestFingerprint } from '../services/lemo-agent-worker/request-ledger';
import { LemoResponseStore, recoverStoredLemoResponse } from '../services/lemo-agent-worker/response-store';
import { verifyMessagesReceipt } from '../services/lemo-agent-worker/message-receipt';
const roots: string[] = []; const ledgers: LemoRequestLedger[] = [];
afterEach(async () => {
  for (const l of ledgers.splice(0).reverse()) await l.close();
  for (const dir of roots.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error('UNSAFE_TEST_CLEANUP');
    await rm(dir, { recursive: true, force: true });
  }
});
const fingerprint = requestFingerprint({ endpoint: 'https://test.invalid/v1/messages', prompt: 'private prompt' });
const response = Buffer.from(JSON.stringify({ id: 'msg_private', type: 'message', role: 'assistant',
  content: [{ type: 'text', text: '私有原创工程代码' }], stop_reason: 'end_turn' }));
async function fixture(maxBytes?: number) {
  const root = await mkdtemp(join(tmpdir(), 'lemo-private-response-')); roots.push(root);
  const ledger = await LemoRequestLedger.open(root, 8); ledgers.push(ledger);
  const store = await LemoResponseStore.open(ledger.responseDirectory, maxBytes);
  const id = await ledger.begin(fingerprint);
  const input = { requestId: id, fingerprint, stream: false, response };
  return { root, ledger, store, id, input };
}
describe('private response artifacts and explicit recovery', () => {
  it('persists complete original bytes without putting private content in the journal', async () => {
    const f = await fixture(); await f.store.save(f.input);
    expect((await f.store.load(f.id, fingerprint))?.response.equals(response)).toBe(true);
    expect(await readFile(join(f.root, 'requests.jsonl'), 'utf8')).not.toContain('私有原创');
    expect(await readFile(join(f.root, 'requests.jsonl'), 'utf8')).not.toContain('private prompt');
  });
  it.each(['pending', 'unknown'])('recovers %s only from a complete local response and still blocks resubmission', async outcome => {
    const f = await fixture(); await f.store.save(f.input);
    if (outcome === 'unknown') await f.ledger.settle(f.id, { outcome: 'unknown' });
    expect(f.ledger.summary().blocked).toBe(true);
    expect((await recoverStoredLemoResponse(f.ledger, fingerprint)).response.equals(response)).toBe(true);
    expect(f.ledger.summary()).toEqual({ requests: 1, received: 1, rejected: 0, unknown: 0, blocked: false });
    await expect(f.ledger.begin(fingerprint)).rejects.toThrow('DUPLICATE');
    await f.ledger.close(); const reopened = await LemoRequestLedger.open(f.root, 8); ledgers.push(reopened);
    expect(reopened.summary().received).toBe(1);
    expect((await recoverStoredLemoResponse(reopened, fingerprint)).response.equals(response)).toBe(true);
  });
  it('does not append another recovery record for an already received response', async () => {
    const f = await fixture(); await f.store.save(f.input);
    await f.ledger.settle(f.id, { outcome: 'received', httpStatus: 200, ...verifyMessagesReceipt(response, false) });
    const before = await readFile(join(f.root, 'requests.jsonl'), 'utf8');
    await recoverStoredLemoResponse(f.ledger, fingerprint);
    expect(await readFile(join(f.root, 'requests.jsonl'), 'utf8')).toBe(before);
  });
  it('keeps unknown blocked if the private response was never committed', async () => {
    const f = await fixture(); await f.ledger.settle(f.id, { outcome: 'unknown' });
    await mkdir(join(f.store.directory, '.interrupted.pending'));
    await expect(recoverStoredLemoResponse(f.ledger, fingerprint)).rejects.toThrow('RESPONSE_MISSING');
    expect(f.ledger.summary().blocked).toBe(true);
  });
  it('does not recover a response that belongs to no submitted request', async () => {
    const f = await fixture(); await expect(recoverStoredLemoResponse(f.ledger, 'a'.repeat(64))).rejects.toThrow('REQUEST_MISSING');
  });
  it('does not override an explicit rejection with a cached artifact', async () => {
    const f = await fixture(); await f.store.save(f.input); await f.ledger.settle(f.id, { outcome: 'rejected', httpStatus: 400 });
    await expect(recoverStoredLemoResponse(f.ledger, fingerprint)).rejects.toThrow('RECOVERY_REJECTED');
    expect(f.ledger.summary().rejected).toBe(1);
  });
  it('detects response tampering and leaves the uncertain request blocked', async () => {
    const f = await fixture(); await f.store.save(f.input);
    await writeFile(join(f.store.directory, f.id, 'response.bin'), response.toString().replace('私有', '篡改'));
    await expect(recoverStoredLemoResponse(f.ledger, fingerprint)).rejects.toThrow('CHECKSUM');
    expect(f.ledger.summary().blocked).toBe(true);
  });
  it('rejects a substituted fingerprint', async () => {
    const f = await fixture(); await f.store.save(f.input);
    await expect(f.store.load(f.id, 'b'.repeat(64))).rejects.toThrow('MANIFEST');
  });
  it('rejects missing manifests instead of overwriting a damaged committed artifact', async () => {
    const f = await fixture(); await mkdir(join(f.store.directory, f.id));
    await expect(f.store.save(f.input)).rejects.toThrow('MANIFEST');
  });
  it('refuses incomplete provider responses before committing any result', async () => {
    const f = await fixture(); await expect(f.store.save({ ...f.input, response: Buffer.from('{}') })).rejects.toThrow('INCOMPLETE');
    expect(await f.store.load(f.id, fingerprint)).toBeUndefined();
  });
  it('enforces the response size allowance', async () => {
    const f = await fixture(2);
    await expect(f.store.save(f.input)).rejects.toThrow('INPUT');
  });
  it.each(['../escape', 'a/b', 'a\\b', '', '..'])('rejects unsafe artifact id %s', async id => {
    const f = await fixture(); await expect(f.store.save({ ...f.input, requestId: id })).rejects.toThrow('ID');
  });
  it('is idempotent for identical bytes but refuses a conflicting response', async () => {
    const f = await fixture(); await f.store.save(f.input); await f.store.save(f.input);
    const changed = Buffer.from(response.toString().replace('原创', '替代'));
    await expect(f.store.save({ ...f.input, response: changed })).rejects.toThrow('CONFLICT');
    expect((await f.store.load(f.id, fingerprint))?.response.equals(response)).toBe(true);
  });
  it('rejects directory junctions before writing outside the assigned state', async () => {
    const f = await fixture(); const outside = await mkdtemp(join(tmpdir(), 'lemo-response-outside-')); roots.push(outside);
    const link = join(f.root, 'linked'); await symlink(outside, link, 'junction');
    await expect(LemoResponseStore.open(join(link, 'results'))).rejects.toThrow('LINK');
  });
  it('does not return mutable internal receipts', async () => {
    const f = await fixture(); await f.store.save(f.input); await recoverStoredLemoResponse(f.ledger, fingerprint);
    const found = f.ledger.lookup(fingerprint)!; found.receipt!.outcome = 'unknown';
    expect(f.ledger.summary().unknown).toBe(0);
  });
  it('refuses recovery when a received receipt disagrees with the artifact', async () => {
    const f = await fixture(); await f.store.save(f.input);
    await f.ledger.settle(f.id, { outcome: 'received', httpStatus: 200, ...verifyMessagesReceipt(response, false), responseSha256: 'a'.repeat(64) });
    await expect(recoverStoredLemoResponse(f.ledger, fingerprint)).rejects.toThrow('MISMATCH');
  });
  it('rejects a duplicate recovered journal entry after restart', async () => {
    const f = await fixture(); await f.store.save(f.input); await recoverStoredLemoResponse(f.ledger, fingerprint); await f.ledger.close();
    const lines = (await readFile(join(f.root, 'requests.jsonl'), 'utf8')).trim().split('\n');
    const duplicate = JSON.parse(lines.at(-1)!); duplicate.seq++;
    await appendFile(join(f.root, 'requests.jsonl'), JSON.stringify(duplicate) + '\n');
    await expect(LemoRequestLedger.open(f.root, 8)).rejects.toThrow('CORRUPT');
  });
});
