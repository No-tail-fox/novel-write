import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, link, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LemoRequestLedger, requestFingerprint, type LedgerSummary } from '../services/lemo-agent-worker/request-ledger';
import { recoverStoredLemoResponse } from '../services/lemo-agent-worker/response-store';

const roots: string[] = [];
const ledgers: LemoRequestLedger[] = [];
const children = new Set<FixtureChild>();
const tempRoot = resolve(tmpdir());
let buildRoot: string;
let fixturePath: string;
const fingerprint = requestFingerprint({ endpoint: 'https://offline.invalid/v1/messages', prompt: 'private crash test prompt' });
const response = Buffer.from(JSON.stringify({ id: 'msg_crash_test', type: 'message', role: 'assistant',
  content: [{ type: 'text', text: '断电后保留完整的原创响应 🌙\n第二行' }], stop_reason: 'end_turn' }), 'utf8');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Checkpoint = 'submitted' | 'response-saved' | 'received';
interface FixtureMessage { event: string; pid: number; requestId?: string; ok?: boolean; error?: string; summary?: LedgerSummary }
interface FixtureChild {
  child: ChildProcess;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  message(event: string): Promise<FixtureMessage>;
}

beforeAll(async () => {
  buildRoot = await mkdtemp(join(tempRoot, 'lemo-crash-bundle-'));
  fixturePath = join(buildRoot, 'lemo-ledger-crash.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/lemo-ledger-crash.ts', import.meta.url))],
    outfile: fixturePath, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent' });
}, 30000);

async function removeTestRoot(directory: string) {
  if (!resolve(directory).startsWith(tempRoot + sep)) throw new Error('UNSAFE_TEST_CLEANUP');
  await rm(directory, { recursive: true, force: true });
}
afterEach(async () => {
  for (const ledger of ledgers.splice(0).reverse()) await ledger.close();
  for (const child of children) child.child.kill();
  await Promise.all([...children].map(child => child.closed));
  children.clear();
  for (const root of roots.splice(0)) await removeTestRoot(root);
}, 20000);
afterAll(async () => { if (buildRoot) await removeTestRoot(buildRoot); });

async function root() {
  const directory = await mkdtemp(join(tempRoot, 'lemo-process-recovery-'));
  roots.push(directory);
  return directory;
}
function spawnFixture(args: string[]): FixtureChild {
  const child = fork(fixturePath, args, { execArgv: [], silent: true,
    env: { ...process.env, TEMP: tempRoot, TMP: tempRoot } });
  const received: FixtureMessage[] = [];
  let stderr = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: Error | undefined;
  child.stderr?.setEncoding('utf8').on('data', part => { stderr = (stderr + part).slice(-8192); });
  child.stdout?.resume();
  child.on('message', message => received.push(message as FixtureMessage));
  child.on('error', error => { spawnError = error; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => { exit = { code, signal }; resolve(exit); });
  });
  const result: FixtureChild = { child, closed, message(event) {
    const previous = received.find(message => message.event === event);
    if (previous) return Promise.resolve(previous);
    if (spawnError || exit) return Promise.reject(spawnError ?? new Error('FIXTURE_EXIT: ' + JSON.stringify(exit) + ' ' + stderr));
    return new Promise<FixtureMessage>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('FIXTURE_TIMEOUT: ' + event + ' ' + stderr)), 15000);
      const onMessage = (message: unknown) => {
        const value = message as FixtureMessage;
        if (value.event === event) finish(undefined, value);
        else if (value.event === 'error') finish(new Error(value.error));
      };
      const onClose = (code: number | null, signal: NodeJS.Signals | null) =>
        finish(new Error('FIXTURE_EXIT: ' + code + '/' + signal + ' ' + stderr + ' ' + JSON.stringify(received)));
      const onError = (error: Error) => finish(error);
      function finish(error?: Error, value?: FixtureMessage) {
        clearTimeout(timer);
        child.off('message', onMessage); child.off('close', onClose); child.off('error', onError);
        if (error) reject(error); else resolve(value!);
      }
      child.on('message', onMessage); child.once('close', onClose); child.once('error', onError);
    });
  } };
  children.add(result);
  return result;
}
async function interrupted(checkpoint: Checkpoint = 'submitted') {
  const directory = await root();
  const worker = spawnFixture(['crash', directory, checkpoint, fingerprint, response.toString('base64')]);
  const ready = await worker.message('ready');
  expect(await worker.closed).toEqual({ code: 73, signal: null });
  const owner = await readFile(join(directory, 'owner.lock'));
  const journal = await readFile(join(directory, 'requests.jsonl'));
  return { directory, ready, owner, journal };
}
async function recover(directory: string, ownerFingerprint: string) {
  const ledger = await LemoRequestLedger.recoverInterruptedOwner(directory, 8, ownerFingerprint);
  ledgers.push(ledger);
  return ledger;
}
async function archiveBytes(directory: string) {
  const archive = join(directory, 'owner-history');
  return Promise.all((await readdir(archive)).map(name => readFile(join(archive, name))));
}
async function expectNoRecoveryLock(directory: string) {
  await expect(readFile(join(directory, 'recovery.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('explicit ledger recovery after a real worker process exits', () => {
  it('retains a version 2 identity and never auto-steals even a confirmed exited owner', async () => {
    const f = await interrupted();
    const owner = JSON.parse(f.owner.toString('utf8'));
    expect(owner).toMatchObject({ version: 2, pid: f.ready.pid, host: hostname() });
    expect(owner.ownerId).toEqual(expect.any(String));
    expect(owner.ownerId.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(owner.createdAt))).toBe(true);
    await expect(LemoRequestLedger.open(f.directory, 8)).rejects.toThrow('LOCKED');
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    expect(snapshot).toMatchObject({ fingerprint: sha256(f.owner), ownerId: owner.ownerId, pid: f.ready.pid,
      host: hostname(), createdAt: owner.createdAt, processState: 'exited' });
    await expect(LemoRequestLedger.open(f.directory, 8)).rejects.toThrow('LOCKED');
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
  }, 20000);

  it.each<Checkpoint>(['submitted', 'response-saved', 'received'])(
    'preserves one billable submission when the worker exits after %s', async checkpoint => {
      const f = await interrupted(checkpoint);
      const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
      expect(snapshot.processState).toBe('exited');
      const ledger = await recover(f.directory, snapshot.fingerprint);
      expect(ledger.lookup(fingerprint)?.requestId).toBe(f.ready.requestId);
      expect(ledger.summary()).toEqual(f.ready.summary);
      expect(ledger.summary().requests).toBe(1);
      expect(ledger.responseDirectory).toBe(join(f.directory, 'private-responses'));
      expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
      expect(await archiveBytes(f.directory)).toEqual([f.owner]);
      const newOwner = JSON.parse(await readFile(join(f.directory, 'owner.lock'), 'utf8'));
      expect(newOwner).toMatchObject({ version: 2, pid: process.pid, host: hostname() });
      expect(newOwner.ownerId).not.toBe(snapshot.ownerId);
      await expectNoRecoveryLock(f.directory);

      if (checkpoint === 'submitted') {
        await expect(recoverStoredLemoResponse(ledger, fingerprint)).rejects.toThrow('RESPONSE_MISSING');
        expect(ledger.summary()).toEqual({ requests: 1, received: 0, rejected: 0, unknown: 1, blocked: true });
        await expect(ledger.begin(fingerprint)).rejects.toThrow('BLOCKED');
        await expect(ledger.begin(requestFingerprint({ changed: 'attempted paid retry' }))).rejects.toThrow('BLOCKED');
        expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
      } else {
        const recovered = await recoverStoredLemoResponse(ledger, fingerprint);
        expect(recovered).toMatchObject({ requestId: f.ready.requestId, fingerprint, stream: false });
        expect(recovered.response.equals(response)).toBe(true);
        expect(ledger.lookup(fingerprint)?.receipt?.responseSha256).toBe(sha256(response));
        expect(ledger.summary()).toEqual({ requests: 1, received: 1, rejected: 0, unknown: 0, blocked: false });
        await expect(ledger.begin(fingerprint)).rejects.toThrow('DUPLICATE');
        const recoveredJournal = await readFile(join(f.directory, 'requests.jsonl'));
        expect(recoveredJournal.subarray(0, f.journal.length)).toEqual(f.journal);
        const records = recoveredJournal.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(records.filter(record => record.kind === 'submitted')).toHaveLength(1);
        expect(records.filter(record => record.kind === 'recovered')).toHaveLength(checkpoint === 'response-saved' ? 1 : 0);
        if (checkpoint === 'received') expect(recoveredJournal).toEqual(f.journal);
        expect((await recoverStoredLemoResponse(ledger, fingerprint)).response).toEqual(response);
        expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(recoveredJournal);
      }
      const finalJournal = await readFile(join(f.directory, 'requests.jsonl'));
      await ledger.close();
      const reopened = await LemoRequestLedger.open(f.directory, 8); ledgers.push(reopened);
      expect(reopened.summary().requests).toBe(1);
      expect(reopened.lookup(fingerprint)?.requestId).toBe(f.ready.requestId);
      await expect(reopened.begin(fingerprint)).rejects.toThrow(checkpoint === 'submitted' ? 'BLOCKED' : 'DUPLICATE');
      expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(finalJournal);
    }, 20000);

  it('refuses to take ownership from a real live process', async () => {
    const directory = await root();
    const worker = spawnFixture(['hold', directory, 'submitted', fingerprint, response.toString('base64')]);
    const ready = await worker.message('ready');
    const owner = await readFile(join(directory, 'owner.lock'));
    const journal = await readFile(join(directory, 'requests.jsonl'));
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(directory);
    expect(snapshot).toMatchObject({ processState: 'active', pid: ready.pid });
    await expect(LemoRequestLedger.open(directory, 8)).rejects.toThrow('LOCKED');
    await expect(LemoRequestLedger.recoverInterruptedOwner(directory, 8, snapshot.fingerprint)).rejects.toThrow();
    expect(await readFile(join(directory, 'owner.lock'))).toEqual(owner);
    expect(await readFile(join(directory, 'requests.jsonl'))).toEqual(journal);
    await expectNoRecoveryLock(directory);
  }, 20000);

  it('refuses a stale owner snapshot and only recovers after explicit reinspection', async () => {
    const f = await interrupted();
    const old = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(f.owner.toString('utf8')), ownerId: randomUUID() }));
    await writeFile(join(f.directory, 'owner.lock'), changed);
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, old.fingerprint)).rejects.toThrow();
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(changed);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
    await expectNoRecoveryLock(f.directory);
    const current = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    expect(current.fingerprint).toBe(sha256(changed));
    expect(current.fingerprint).not.toBe(old.fingerprint);
    expect((await recover(f.directory, current.fingerprint)).summary().requests).toBe(1);
    expect(await archiveBytes(f.directory)).toEqual([changed]);
  }, 20000);

  it('treats an exited PID on another host as unverifiable', async () => {
    const f = await interrupted();
    const owner = Buffer.from(JSON.stringify({ ...JSON.parse(f.owner.toString('utf8')), host: hostname() + '-other-host' }));
    await writeFile(join(f.directory, 'owner.lock'), owner);
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    expect(snapshot.processState).toBe('unverifiable');
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, snapshot.fingerprint)).rejects.toThrow();
    await expect(LemoRequestLedger.open(f.directory, 8)).rejects.toThrow('LOCKED');
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
    await expectNoRecoveryLock(f.directory);
  }, 20000);

  it.each(['legacy', 'malformed'])('preserves and rejects an unverifiable %s owner', async kind => {
    const f = await interrupted();
    const owner = Buffer.from(kind === 'legacy'
      ? JSON.stringify({ version: 1, pid: f.ready.pid, createdAt: new Date().toISOString() }) : '{"version":2');
    await writeFile(join(f.directory, 'owner.lock'), owner);
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, sha256(owner))).rejects.toThrow();
    await expect(LemoRequestLedger.open(f.directory, 8)).rejects.toThrow('LOCKED');
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
    await expectNoRecoveryLock(f.directory);
  }, 20000);

  it('keeps the interrupted owner and the exact torn journal when restoration fails', async () => {
    const f = await interrupted();
    await appendFile(join(f.directory, 'requests.jsonl'), '{"version":1', 'utf8');
    const corruptJournal = await readFile(join(f.directory, 'requests.jsonl'));
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, snapshot.fingerprint)).rejects.toThrow('CORRUPT');
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(corruptJournal);
    await expect(LemoRequestLedger.open(f.directory, 8)).rejects.toThrow('LOCKED');
    await expectNoRecoveryLock(f.directory);
  }, 20000);

  it('does not delete another recovery attempt’s exclusive lock', async () => {
    const f = await interrupted();
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    const lock = Buffer.from('another recovery owns this file');
    await writeFile(join(f.directory, 'recovery.lock'), lock);
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, snapshot.fingerprint)).rejects.toThrow();
    expect(await readFile(join(f.directory, 'recovery.lock'))).toEqual(lock);
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
  }, 20000);

  it('does not create a new journal when the interrupted journal is missing', async () => {
    const f = await interrupted();
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    await unlink(join(f.directory, 'requests.jsonl'));
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, snapshot.fingerprint)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    await expect(readFile(join(f.directory, 'requests.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expectNoRecoveryLock(f.directory);
  }, 20000);

  it('retains a recovery lock after its real owner exits during recovery and refuses further takeover', async () => {
    const f = await interrupted();
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    const worker = spawnFixture(['recover-crash', f.directory, snapshot.fingerprint]);
    const ready = await worker.message('ready');
    expect(await worker.closed).toEqual({ code: 74, signal: null });
    const marker = await readFile(join(f.directory, 'recovery.lock'));
    expect(JSON.parse(marker.toString('utf8'))).toMatchObject({ version: 2, pid: ready.pid, host: hostname() });
    await expect(LemoRequestLedger.open(f.directory, 8)).rejects.toThrow('RECOVERY_LOCKED');
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, snapshot.fingerprint)).rejects.toThrow('RECOVERY_LOCKED');
    expect(await readFile(join(f.directory, 'recovery.lock'))).toEqual(marker);
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
  }, 20000);

  it('allows exactly one of three simultaneous recovery processes to own the journal', async () => {
    const f = await interrupted();
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    const contenders = Array.from({ length: 3 }, () => spawnFixture(['recover', f.directory, snapshot.fingerprint]));
    await Promise.all(contenders.map(worker => worker.message('ready')));
    const results = contenders.map(worker => worker.message('result'));
    for (const worker of contenders) worker.child.send({ command: 'recover' });
    const outcomes = await Promise.all(results);
    expect(outcomes.filter(result => result.ok)).toHaveLength(1);
    expect(outcomes.filter(result => !result.ok)).toHaveLength(2);
    const winner = outcomes.find(result => result.ok)!;
    expect(winner.summary).toEqual(f.ready.summary);
    const owner = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    expect(owner).toMatchObject({ pid: winner.pid, processState: 'active' });
    expect(await archiveBytes(f.directory)).toEqual([f.owner]);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
    await expect(LemoRequestLedger.open(f.directory, 8)).rejects.toThrow('LOCKED');
    await expectNoRecoveryLock(f.directory);
  }, 30000);

  it('rejects a linked state directory without modifying its target', async () => {
    const f = await interrupted();
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    const container = await root();
    const alias = join(container, 'linked-state');
    await symlink(f.directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(LemoRequestLedger.inspectInterruptedOwner(alias)).rejects.toThrow('LINK');
    await expect(LemoRequestLedger.recoverInterruptedOwner(alias, 8, snapshot.fingerprint)).rejects.toThrow('LINK');
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
  }, 20000);

  it('rejects a linked owner-history directory before archiving outside the run', async () => {
    const f = await interrupted();
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    const outside = await root();
    await symlink(outside, join(f.directory, 'owner-history'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, snapshot.fingerprint)).rejects.toThrow('LINK');
    expect(await readdir(outside)).toEqual([]);
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
    await expectNoRecoveryLock(f.directory);
  }, 20000);

  it.each(['owner.lock', 'requests.jsonl'])('rejects a hard-linked %s without changing either name', async name => {
    const f = await interrupted();
    const snapshot = await LemoRequestLedger.inspectInterruptedOwner(f.directory);
    const outside = await root();
    const alias = join(outside, 'linked-file');
    const original = await readFile(join(f.directory, name));
    await link(join(f.directory, name), alias);
    await expect(LemoRequestLedger.recoverInterruptedOwner(f.directory, 8, snapshot.fingerprint)).rejects.toThrow();
    expect(await readFile(alias)).toEqual(original);
    expect(await readFile(join(f.directory, 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.directory, 'requests.jsonl'))).toEqual(f.journal);
    await expectNoRecoveryLock(f.directory);
  }, 20000);
});
