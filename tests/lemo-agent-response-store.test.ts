import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LemoRequestLedger, requestFingerprint } from '../services/lemo-agent-worker/request-ledger';
import { LemoResponseStore, recoverStoredLemoResponse } from '../services/lemo-agent-worker/response-store';

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const roots: string[] = [];
const ledgers: LemoRequestLedger[] = [];
afterEach(async () => {
  for (const ledger of ledgers.splice(0).reverse()) await ledger.close();
  for (const directory of roots.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function root() {
  const directory = await mkdtemp(join(tmpdir(), 'lemo-response-store-'));
  roots.push(directory); return directory;
}
async function ledger() {
  const directory = await root();
  const value = await LemoRequestLedger.open(directory, 4); ledgers.push(value);
  return { directory, value };
}
const fingerprint = requestFingerprint({ instruction: 'local response recovery fixture' });
const response = (text = 'local fixture') => Buffer.from(JSON.stringify({ id: 'msg_saved', type: 'message', role: 'assistant',
  model: 'offline-model', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 } }), 'utf8');
const input = (bytes = response()) => ({ requestId: 'request_saved', fingerprint, stream: false, response: bytes });

describe('private response store limits', () => {
  it('persists a versioned limit and uses it when reopening without an explicit limit', async () => {
    const directory = await root();
    const original = await LemoResponseStore.open(directory, 4096);
    expect(original.maxBytes).toBe(4096);
    expect(JSON.parse(await readFile(join(directory, 'limits.json'), 'utf8'))).toEqual({ version: 1, maxBytes: 4096 });
    expect((await LemoResponseStore.open(directory)).maxBytes).toBe(4096);
    expect((await LemoResponseStore.open(directory, 4096)).maxBytes).toBe(4096);
    expect((await readdir(directory)).filter(name => name.endsWith('.pending'))).toEqual([]);
  });
  it('rejects conflicting explicit limits without changing the saved policy', async () => {
    const directory = await root(); await LemoResponseStore.open(directory, 4096);
    const before = await readFile(join(directory, 'limits.json'), 'utf8');
    for (const maxBytes of [2048, 8192]) await expect(LemoResponseStore.open(directory, maxBytes)).rejects.toThrow('LIMITS_CONFLICT');
    expect(await readFile(join(directory, 'limits.json'), 'utf8')).toBe(before);
  });
  it('does not let concurrent creators overwrite the winning policy', async () => {
    const directory = await root();
    const attempts = await Promise.allSettled([LemoResponseStore.open(directory, 4096), LemoResponseStore.open(directory, 8192)]);
    const successes = attempts.filter((attempt): attempt is PromiseFulfilledResult<LemoResponseStore> => attempt.status === 'fulfilled');
    expect(successes).toHaveLength(1);
    expect((await LemoResponseStore.open(directory)).maxBytes).toBe(successes[0].value.maxBytes);
    expect((await readdir(directory)).filter(name => name.endsWith('.pending'))).toEqual([]);
  });
  it('recovers a response larger than 32 MiB after reopening the ledger without requesting a larger limit again', async () => {
    const state = await ledger();
    const bytes = response('x'.repeat(DEFAULT_MAX_BYTES + 1024));
    const requestId = await state.value.begin(fingerprint);
    const store = await LemoResponseStore.open(state.value.responseDirectory, bytes.length + 1024);
    await store.save({ requestId, fingerprint, stream: false, response: bytes });
    await state.value.settle(requestId, { outcome: 'unknown' });
    await state.value.close();
    const reopened = await LemoRequestLedger.open(state.directory, 4); ledgers.push(reopened);
    const restored = await recoverStoredLemoResponse(reopened, fingerprint);
    expect(restored.response.equals(bytes)).toBe(true);
    expect(reopened.summary()).toMatchObject({ requests: 1, received: 1, unknown: 0 });
    await expect(reopened.begin(fingerprint)).rejects.toThrow('DUPLICATE');
  });
  it.each([
    '', '{', 'null', '[]', '{}', '{"version":2,"maxBytes":4096}', '{"version":1,"maxBytes":0}',
    '{"version":1,"maxBytes":1.5}', '{"version":1,"maxBytes":9007199254740992}',
    '{"version":1,"maxBytes":"4096"}', '{"version":1,"maxBytes":4096,"extra":true}',
  ])('rejects corrupt policy instead of falling back to defaults: %s', async data => {
    const directory = await root(); await writeFile(join(directory, 'limits.json'), data, 'utf8');
    await expect(LemoResponseStore.open(directory)).rejects.toThrow('LIMITS');
    await expect(LemoResponseStore.open(directory, 8192)).rejects.toThrow('LIMITS');
    expect(await readFile(join(directory, 'limits.json'), 'utf8')).toBe(data);
  });
  it('rejects invalid UTF-8 policy content', async () => {
    const directory = await root(); await writeFile(join(directory, 'limits.json'), Buffer.from([0xff]));
    await expect(LemoResponseStore.open(directory)).rejects.toThrow('LIMITS');
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid explicit limit %s before creating policy', async maxBytes => {
    const directory = await root();
    await expect(LemoResponseStore.open(directory, maxBytes)).rejects.toThrow('OPTIONS');
    expect(await readdir(directory)).toEqual([]);
  });
  it('rejects a hard-linked policy', async () => {
    const directory = await root(); const source = join(directory, 'policy-source.json');
    await writeFile(source, JSON.stringify({ version: 1, maxBytes: 4096 }), 'utf8');
    await link(source, join(directory, 'limits.json'));
    await expect(LemoResponseStore.open(directory)).rejects.toThrow('LIMITS');
  });
  it('rejects a linked store directory before creating a policy in its target', async () => {
    const directory = await root(); const outside = join(directory, 'outside'); await mkdir(outside);
    const linked = join(directory, 'linked'); await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(LemoResponseStore.open(linked)).rejects.toThrow('LINK');
    expect(await readdir(outside)).toEqual([]);
  });
  it.each(['missing', 'changed', 'corrupt'])('fails closed if policy is %s after opening', async change => {
    const directory = await root(); const store = await LemoResponseStore.open(directory, 4096);
    await store.save(input());
    if (change === 'missing') await unlink(join(directory, 'limits.json'));
    else await writeFile(join(directory, 'limits.json'), change === 'changed' ? '{"version":1,"maxBytes":8192}' : '{', 'utf8');
    await expect(store.load('request_saved', fingerprint)).rejects.toThrow('LIMITS');
    await expect(store.save({ ...input(), requestId: 'new_request' })).rejects.toThrow('LIMITS');
  });
});

describe('legacy response stores and integrity', () => {
  it.each([undefined, 4096])('migrates legacy policy with the default or explicitly known original limit: %s', async legacyMaxBytes => {
    const state = await ledger(); const requestId = await state.value.begin(fingerprint);
    const store = await LemoResponseStore.open(state.value.responseDirectory, legacyMaxBytes);
    await store.save({ ...input(), requestId });
    await unlink(join(store.directory, 'limits.json'));
    const artifact = await recoverStoredLemoResponse(state.value, fingerprint, legacyMaxBytes);
    expect(artifact.response.equals(response())).toBe(true);
    expect(JSON.parse(await readFile(join(store.directory, 'limits.json'), 'utf8'))).toEqual({ version: 1, maxBytes: legacyMaxBytes ?? DEFAULT_MAX_BYTES });
  });
  it('never derives a higher legacy limit from an untrusted response manifest', async () => {
    const state = await ledger(); const requestId = await state.value.begin(fingerprint);
    const store = await LemoResponseStore.open(state.value.responseDirectory);
    await store.save({ ...input(), requestId }); await unlink(join(store.directory, 'limits.json'));
    const manifestPath = join(store.directory, requestId, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.byteLength = DEFAULT_MAX_BYTES + 1;
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await expect(recoverStoredLemoResponse(state.value, fingerprint)).rejects.toThrow('MANIFEST');
    expect(JSON.parse(await readFile(join(store.directory, 'limits.json'), 'utf8')).maxBytes).toBe(DEFAULT_MAX_BYTES);
    expect(state.value.summary()).toMatchObject({ unknown: 1, received: 0, blocked: true });
  });
  it('is idempotent for identical saved responses but refuses different content for an existing request', async () => {
    const directory = await root(); const store = await LemoResponseStore.open(directory, 4096);
    await store.save(input());
    const before = await readFile(join(directory, 'request_saved', 'manifest.json'), 'utf8');
    await store.save(input());
    expect(await readFile(join(directory, 'request_saved', 'manifest.json'), 'utf8')).toBe(before);
    await expect(store.save(input(response('changed fixture')))).rejects.toThrow('CONFLICT');
    expect((await store.load('request_saved', fingerprint))?.response.equals(response())).toBe(true);
  });
  it('rejects bytes above the persisted limit before committing a response directory', async () => {
    const directory = await root(); const store = await LemoResponseStore.open(directory, 256);
    await expect(store.save(input(response('x'.repeat(256))))).rejects.toThrow('INPUT');
    expect(await readdir(directory)).toEqual(['limits.json']);
  });
  it('does not recover tampered response bytes or clear the unresolved receipt', async () => {
    const state = await ledger(); const requestId = await state.value.begin(fingerprint);
    const store = await LemoResponseStore.open(state.value.responseDirectory);
    await store.save({ ...input(), requestId });
    const bytes = response(); bytes[bytes.indexOf('local fixture')] = 'X'.charCodeAt(0);
    await writeFile(join(store.directory, requestId, 'response.bin'), bytes);
    await expect(recoverStoredLemoResponse(state.value, fingerprint)).rejects.toThrow('CHECKSUM');
    expect(state.value.summary()).toMatchObject({ unknown: 1, received: 0, blocked: true });
  });
  it('rejects incomplete protocol data even when its manifest checksum matches', async () => {
    const directory = await root(); const store = await LemoResponseStore.open(directory); await store.save(input());
    const manifestPath = join(directory, 'request_saved', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bytes = Buffer.from('{"type":"message","role":"assistant","content":[]}');
    manifest.byteLength = bytes.length; manifest.sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(directory, 'request_saved', 'response.bin'), bytes);
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await expect(store.load('request_saved', fingerprint)).rejects.toThrow('INCOMPLETE');
  });
  it('does not treat incomplete pending directories as committed responses', async () => {
    const directory = await root(); const store = await LemoResponseStore.open(directory);
    await mkdir(join(directory, '.request_saved-crash.pending'));
    await writeFile(join(directory, '.request_saved-crash.pending', 'response.bin'), response());
    expect(await store.load('request_saved', fingerprint)).toBeUndefined();
  });
  it('rejects hard-linked response files', async () => {
    const directory = await root(); const store = await LemoResponseStore.open(directory); await store.save(input());
    await link(join(directory, 'request_saved', 'response.bin'), join(directory, 'alias.bin'));
    await expect(store.load('request_saved', fingerprint)).rejects.toThrow('FILE');
  });
});
