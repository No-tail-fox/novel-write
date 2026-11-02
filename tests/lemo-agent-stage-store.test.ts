import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LemoStageStore, type LemoStageSnapshot, type LemoStageStoreOptions, type LemoStageToolEvent } from '../services/lemo-agent-worker/stage-store';

const tempRoot = resolve(tmpdir());
const roots: string[] = []; const stores: LemoStageStore[] = []; const children: Worker[] = [];
let buildRoot: string; let fixturePath: string;
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const startEvent = (id: string): LemoStageToolEvent => ({ version: 1, operationId: id, tool: 'write_file',
  phase: 'started', argumentsSha256: hash(id), at: new Date().toISOString() });
interface Message { event: string; pid: number; ok?: boolean; error?: string; snapshot?: LemoStageSnapshot }
interface Worker { child: ChildProcess; closed: Promise<number | null>; message(event: string): Promise<Message> }
beforeAll(async () => {
  buildRoot = await mkdtemp(join(tempRoot, 'lemo-stage-bundle-')); fixturePath = join(buildRoot, 'worker.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/lemo-stage-store-crash.ts', import.meta.url))], outfile: fixturePath,
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent' });
}, 30000);
async function removeRoot(path: string) {
  if (!resolve(path).startsWith(tempRoot + sep)) throw new Error('UNSAFE_TEST_CLEANUP');
  await rm(path, { recursive: true, force: true });
}
afterEach(async () => {
  for (const store of stores.splice(0).reverse()) await store.close();
  for (const worker of children) worker.child.kill();
  await Promise.all(children.splice(0).map(worker => worker.closed));
  for (const path of roots.splice(0)) await removeRoot(path);
}, 20000);
afterAll(async () => { if (buildRoot) await removeRoot(buildRoot); });
async function options(): Promise<LemoStageStoreOptions> {
  const root = await mkdtemp(join(tempRoot, 'lemo-stage-')); roots.push(root);
  const projectDirectory = join(root, 'project'); await mkdir(projectDirectory);
  return { directory: join(root, 'state'), projectDirectory, runId: 'run_original', stageId: 'creative',
    inputFingerprint: hash('original input'), configFingerprint: hash('pinned config') };
}
async function open(input: LemoStageStoreOptions) { const store = await LemoStageStore.open(input); stores.push(store); return store; }
async function running() {
  const input = await options(); const store = await open(input); await store.recordSession('session_bound'); await store.startAttempt('start');
  return { input, store };
}
function spawn(mode: string, input: LemoStageStoreOptions, checkpoint = 'running'): Worker {
  const child = fork(fixturePath, [mode, JSON.stringify(input), checkpoint], { execArgv: [], silent: true,
    env: { ...process.env, TEMP: tempRoot, TMP: tempRoot } });
  const messages: Message[] = []; let exited = false; let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', part => { stderr = (stderr + part).slice(-8192); }); child.stdout?.resume();
  child.on('message', message => messages.push(message as Message));
  const closed = new Promise<number | null>(resolve => child.once('close', code => { exited = true; resolve(code); }));
  const worker: Worker = { child, closed, message(event) {
    const old = messages.find(message => message.event === event); if (old) return Promise.resolve(old);
    if (exited) return Promise.reject(new Error('FIXTURE_EXIT: ' + stderr + JSON.stringify(messages)));
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('FIXTURE_TIMEOUT: ' + stderr)), 15000);
      const onMessage = (message: unknown) => {
        const value = message as Message;
        if (value.event === event) finish(undefined, value); else if (value.event === 'error') finish(new Error(value.error));
      };
      const onExit = () => finish(new Error('FIXTURE_EXIT: ' + stderr + JSON.stringify(messages)));
      const onError = (error: Error) => finish(error);
      function finish(error?: Error, value?: Message) {
        clearTimeout(timer); child.off('message', onMessage); child.off('close', onExit); child.off('error', onError);
        if (error) reject(error); else resolve(value!);
      }
      child.on('message', onMessage); child.once('close', onExit); child.once('error', onError);
    });
  } }; children.push(worker); return worker;
}
async function crashed(checkpoint = 'running') {
  const input = await options(); const worker = spawn('crash', input, checkpoint); const ready = await worker.message('ready');
  expect(await worker.closed).toBe(81);
  return { input, ready, bytes: await readFile(join(input.directory, 'stage.json')),
    owner: await readFile(join(input.directory, 'stage-owner', 'owner.lock')) };
}

describe('durable Lemo stage and official SDK session state', () => {
  it('persists a prebound session and exposes immutable copies without claiming delivery acceptance', async () => {
    const input = await options(); const store = await open(input);
    expect(store.snapshot()).toMatchObject({ version: 1, status: 'ready', attempt: 0, revision: 0,
      pendingToolOperations: 0, deliveryStatus: 'unverified', artifacts: [], toolEvents: [] });
    await store.recordSession('session_prebound'); const bound = await readFile(join(input.directory, 'stage.json'));
    await store.recordSession('session_prebound'); expect(await readFile(join(input.directory, 'stage.json'))).toEqual(bound);
    const snapshot = store.snapshot(); snapshot.sessionId = 'tampered'; snapshot.artifacts.push({ path: 'fake', sha256: hash(''), byteLength: 0 });
    expect(store.snapshot().sessionId).toBe('session_prebound'); expect(store.snapshot().artifacts).toEqual([]);
    await store.close(); const reopened = await open(input);
    expect(reopened.snapshot()).toMatchObject({ sessionId: 'session_prebound', status: 'ready', attempt: 0 });
    await expect(reopened.recordSession('replacement')).rejects.toThrow('SESSION_CHANGED');
    await reopened.startAttempt('start'); expect(reopened.snapshot()).toMatchObject({ status: 'running', attempt: 1, lastAction: 'start' });
    if (process.platform !== 'win32') {
      expect((await lstat(input.directory)).mode & 0o777).toBe(0o700);
      expect((await lstat(join(input.directory, 'stage.json'))).mode & 0o777).toBe(0o600);
    }
  });
  it.each(['runId', 'stageId', 'inputFingerprint', 'configFingerprint', 'projectDirectory'] as const)(
    'rejects changed %s instead of creating a replacement run', async field => {
      const input = await options(); const store = await open(input); await store.close();
      const before = await readFile(join(input.directory, 'stage.json'));
      const changed = { ...input, [field]: field.endsWith('Fingerprint') ? hash('changed') : field === 'projectDirectory' ? join(input.directory, 'other') : 'changed' };
      await expect(LemoStageStore.open(changed)).rejects.toThrow('IDENTITY_CONFLICT');
      expect(await readFile(join(input.directory, 'stage.json'))).toEqual(before);
      expect((await open(input)).snapshot().attempt).toBe(0);
    });
  it('does not dispatch repeated start or implicit resume while running', async () => {
    const { input, store } = await running(); const bytes = await readFile(join(input.directory, 'stage.json'));
    await expect(store.startAttempt('start')).rejects.toThrow('START_ALREADY_ATTEMPTED');
    await expect(store.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
    expect(await readFile(join(input.directory, 'stage.json'))).toEqual(bytes);
  });
  it.each(['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'])(
    'resumes the same persisted session after explicit %s result', async resultSubtype => {
      const { input, store } = await running(); await store.complete({ status: 'failed', resultSubtype }); await store.close();
      const resumed = await open(input); await resumed.startAttempt('resume');
      expect(resumed.snapshot()).toMatchObject({ sessionId: 'session_bound', attempt: 2, status: 'running', lastAction: 'resume' });
      expect(resumed.snapshot().resultSubtype).toBeUndefined();
      await resumed.complete({ status: 'completed', resultSubtype: 'success' });
      expect(resumed.snapshot()).toMatchObject({ deliveryStatus: 'unverified', artifacts: [] });
      await expect(resumed.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
    });
  it('resumes only explicitly cancelled work and marks an unfinished resumed attempt unknown on close', async () => {
    const { input, store } = await running(); await store.complete({ status: 'cancelled' }); await store.startAttempt('resume');
    await store.close(); const next = await open(input);
    expect(next.snapshot()).toMatchObject({ status: 'unknown', attempt: 2, resultSubtype: 'interrupted_close', sessionId: 'session_bound' });
    await expect(next.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
  });
  it.each(['unknown', 'failed', 'no-session'] as const)('blocks unsafe %s continuation', async kind => {
    const input = await options(); const store = await open(input); await store.startAttempt('start');
    if (kind !== 'no-session') await store.recordSession('session_bound');
    await store.complete({ status: kind === 'no-session' ? 'cancelled' : kind, resultSubtype: 'error_during_execution' });
    await expect(store.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
    await expect(store.startAttempt('start')).rejects.toThrow('START_ALREADY_ATTEMPTED');
  });
  it('does not turn a missing or corrupt durable state into a fresh attempt', async () => {
    const { input, store } = await running(); await store.complete({ status: 'cancelled' }); await store.close();
    const path = join(input.directory, 'stage.json'); await unlink(path);
    await expect(LemoStageStore.open(input)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path, '{"version":1', 'utf8');
    await expect(LemoStageStore.open(input)).rejects.toThrow('CORRUPT');
    expect(await readFile(path, 'utf8')).toBe('{"version":1');
  });
  it('poisons a store after a real filesystem obstruction and retains the previous committed state', async () => {
    const { input, store } = await running(); const path = join(input.directory, 'stage.json');
    const original = await readFile(path); await rename(path, join(input.directory, 'before-obstruction.json')); await mkdir(path);
    await expect(store.complete({ status: 'completed' })).rejects.toThrow('FILE');
    expect(store.snapshot().status).toBe('running');
    expect(await readFile(join(input.directory, 'before-obstruction.json'))).toEqual(original);
    await expect(store.complete({ status: 'unknown' })).rejects.toThrow('UNAVAILABLE');
  });
  it('detects a changed state snapshot before overwriting it', async () => {
    const { input, store } = await running(); const path = join(input.directory, 'stage.json');
    const changed = JSON.stringify({ ...store.snapshot(), revision: 200 }); await writeFile(path, changed, 'utf8');
    await expect(store.complete({ status: 'unknown' })).rejects.toThrow('CHANGED');
    expect(await readFile(path, 'utf8')).toBe(changed);
  });
});

describe('stage artifact evidence', () => {
  it('hashes real project files and persists their sizes without accepting the delivery', async () => {
    const { input, store } = await running(); await mkdir(join(input.projectDirectory!, 'assets'));
    const bytes = Buffer.from('中文原创素材\n'.repeat(100000), 'utf8');
    await writeFile(join(input.projectDirectory!, 'assets', 'story.txt'), bytes);
    const snapshot = await store.complete({ status: 'completed', resultSubtype: 'success', artifacts: ['assets/story.txt'] });
    expect(snapshot.artifacts).toEqual([{ path: 'assets/story.txt', sha256: hash(bytes), byteLength: bytes.length }]);
    expect(snapshot.deliveryStatus).toBe('unverified'); await store.close();
    expect((await open(input)).snapshot().artifacts).toEqual(snapshot.artifacts);
  });
  it.each(['../escape', '/absolute', 'nested/../escape', 'nested\\file', 'file:stream', './file', 'nested//file'])(
    'rejects unsafe artifact path %s', async path => {
      const { store } = await running(); await expect(store.complete({ status: 'completed', artifacts: [path] })).rejects.toThrow('ARTIFACT_PATH');
      expect(store.snapshot().status).toBe('running');
    });
  it('rejects directories, hard links and linked parent directories as artifact evidence', async () => {
    const { input, store } = await running(); const project = input.projectDirectory!;
    await mkdir(join(project, 'folder')); await expect(store.complete({ status: 'completed', artifacts: ['folder'] })).rejects.toThrow('ARTIFACT_FILE');
    const outside = join(resolve(project, '..'), 'outside'); await mkdir(outside); await writeFile(join(outside, 'file.txt'), 'evidence');
    await link(join(outside, 'file.txt'), join(project, 'hard.txt'));
    await expect(store.complete({ status: 'completed', artifacts: ['hard.txt'] })).rejects.toThrow('ARTIFACT_FILE');
    await symlink(outside, join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(store.complete({ status: 'completed', artifacts: ['linked/file.txt'] })).rejects.toThrow('LINK');
    expect(await readFile(join(outside, 'file.txt'), 'utf8')).toBe('evidence');
  });
  it.each(['stage.json', 'stage-identity.json'])('rejects hard-linked private %s', async name => {
    const input = await options(); const store = await open(input); await store.close();
    const path = join(input.directory, name); const bytes = await readFile(path);
    await link(path, join(input.projectDirectory!, 'alias'));
    await expect(LemoStageStore.open(input)).rejects.toThrow('FILE');
    expect(await readFile(path)).toEqual(bytes);
  });
});

describe('durable creative-tool operations', () => {
  it('serializes parallel callbacks and preserves completed operation history', async () => {
    const { input, store } = await running(); const starts = [startEvent('first'), startEvent('second')];
    await Promise.all(starts.map(event => store.recordToolEvent(event)));
    expect(store.snapshot().pendingToolOperations).toBe(2);
    await Promise.all(starts.map(event => store.recordToolEvent({ ...event, phase: 'completed', resultSha256: hash(event.operationId) })));
    expect(store.snapshot()).toMatchObject({ pendingToolOperations: 0 }); expect(store.snapshot().toolEvents).toHaveLength(4);
    await store.complete({ status: 'completed' }); await store.close();
    const reopened = await open(input); expect(reopened.snapshot().toolEvents).toHaveLength(4);
    expect(reopened.snapshot().pendingToolOperations).toBe(0);
  });
  it.each(['started', 'completed'] as const)('rejects replayed %s and disables further dispatch from that owner', async phase => {
    const { input, store } = await running(); const event = startEvent('only_once'); await store.recordToolEvent(event);
    if (phase === 'completed') await store.recordToolEvent({ ...event, phase });
    const bytes = await readFile(join(input.directory, 'stage.json'));
    await expect(store.recordToolEvent({ ...event, phase })).rejects.toThrow(phase === 'started' ? 'TOOL_REPLAY' : 'TOOL_TRANSITION');
    await expect(store.recordToolEvent(startEvent('next'))).rejects.toThrow('UNAVAILABLE');
    expect(await readFile(join(input.directory, 'stage.json'))).toEqual(bytes);
  });
  it.each(['tool', 'argumentsSha256', 'missing-start'] as const)('rejects mismatched tool terminal %s', async mismatch => {
    const { store } = await running(); const event = startEvent('matching');
    if (mismatch !== 'missing-start') await store.recordToolEvent(event);
    await expect(store.recordToolEvent({ ...event, phase: 'completed',
      ...(mismatch === 'tool' ? { tool: 'other_tool' } : mismatch === 'argumentsSha256' ? { argumentsSha256: hash('different') } : {}) })).rejects.toThrow('TOOL_TRANSITION');
    await expect(store.complete({ status: 'completed' })).rejects.toThrow('UNAVAILABLE');
  });
  it('keeps unfinished tool operations unknown, even after late terminal evidence arrives', async () => {
    const { store } = await running(); const event = startEvent('pending'); await store.recordToolEvent(event);
    for (const status of ['completed', 'failed', 'cancelled'] as const)
      await expect(store.complete({ status })).rejects.toThrow('TOOL_UNRESOLVED');
    await store.complete({ status: 'unknown' }); await expect(store.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
    await store.recordToolEvent({ ...event, phase: 'completed', resultSha256: hash('local result') });
    expect(store.snapshot()).toMatchObject({ pendingToolOperations: 0, status: 'unknown' });
    await expect(store.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
  });
  it('records already-applied side effects as unknown and blocks completion or retry', async () => {
    const { input, store } = await running(); const event = startEvent('applied'); await store.recordToolEvent(event);
    await store.recordToolEvent({ ...event, phase: 'failed', errorCode: 'CALLBACK_FAILED', sideEffectApplied: true });
    expect(store.snapshot()).toMatchObject({ status: 'unknown', pendingToolOperations: 1, resultSubtype: 'tool_side_effect_unconfirmed' });
    await expect(store.complete({ status: 'completed' })).rejects.toThrow();
    await expect(store.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
    await store.close(); const reopened = await open(input);
    expect(reopened.snapshot().toolEvents.at(-1)).toMatchObject({ phase: 'failed', sideEffectApplied: true });
    await expect(reopened.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
  });
});

describe('real process crashes and exclusive stage ownership', () => {
  it.each(['running', 'tool-started', 'completed'])('recovers %s without a new attempt or clearing model receipts', async checkpoint => {
    const f = await crashed(checkpoint); const billing = Buffer.from('unresolved model receipt retained');
    await writeFile(join(f.input.directory, 'requests.jsonl'), billing);
    await expect(LemoStageStore.open(f.input)).rejects.toThrow('LOCKED');
    const inspected = await LemoStageStore.inspectInterruptedOwner(f.input.directory);
    expect(inspected.owner.processState).toBe('exited'); expect(inspected.stateFingerprint).toBe(hash(f.bytes));
    const store = await LemoStageStore.recoverInterruptedOwner(f.input, inspected); stores.push(store);
    expect(store.snapshot()).toMatchObject({ attempt: 1, sessionId: 'session_process_crash',
      status: checkpoint === 'completed' ? 'completed' : 'unknown', pendingToolOperations: checkpoint === 'tool-started' ? 1 : 0 });
    await expect(store.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
    expect(await readFile(join(f.input.directory, 'requests.jsonl'))).toEqual(billing);
    const archives = await readdir(join(f.input.directory, 'stage-owner', 'owner-history'));
    expect(archives).toHaveLength(1);
    expect(await readFile(join(f.input.directory, 'stage-owner', 'owner-history', archives[0]))).toEqual(f.owner);
    if (checkpoint === 'completed') expect(await readFile(join(f.input.directory, 'stage.json'))).toEqual(f.bytes);
  }, 20000);
  it('refuses live stage owners and does not rewrite their state', async () => {
    const input = await options(); const worker = spawn('hold', input); await worker.message('ready');
    const inspected = await LemoStageStore.inspectInterruptedOwner(input.directory); expect(inspected.owner.processState).toBe('active');
    const bytes = await readFile(join(input.directory, 'stage.json'));
    await expect(LemoStageStore.recoverInterruptedOwner(input, inspected)).rejects.toThrow('OWNER_ACTIVE');
    expect(await readFile(join(input.directory, 'stage.json'))).toEqual(bytes);
  }, 20000);
  it('requires both the owner and state fingerprint to match the reviewed snapshot', async () => {
    const f = await crashed(); const inspected = await LemoStageStore.inspectInterruptedOwner(f.input.directory);
    const path = join(f.input.directory, 'stage.json');
    const changed = JSON.stringify({ ...inspected.snapshot, revision: inspected.snapshot.revision + 1 }); await writeFile(path, changed, 'utf8');
    await expect(LemoStageStore.recoverInterruptedOwner(f.input, inspected)).rejects.toThrow('CHANGED');
    expect(await readFile(path, 'utf8')).toBe(changed);
    expect(await readFile(join(f.input.directory, 'stage-owner', 'owner.lock'))).toEqual(f.owner);
  }, 20000);
  it('retains corrupt stage evidence and its original owner during failed recovery', async () => {
    const f = await crashed(); const inspected = await LemoStageStore.inspectInterruptedOwner(f.input.directory);
    await writeFile(join(f.input.directory, 'stage.json'), '{"status":"running"', 'utf8');
    await expect(LemoStageStore.recoverInterruptedOwner(f.input, inspected)).rejects.toThrow('CORRUPT');
    expect(await readFile(join(f.input.directory, 'stage-owner', 'owner.lock'))).toEqual(f.owner);
    expect(await readFile(join(f.input.directory, 'stage.json'), 'utf8')).toBe('{"status":"running"');
  }, 20000);
  it('allows exactly one process to create and start the same stage concurrently', async () => {
    const input = await options(); const competitors = [spawn('contend', input), spawn('contend', input), spawn('contend', input)];
    await Promise.all(competitors.map(worker => worker.message('ready')));
    const outcomes = competitors.map(worker => worker.message('result'));
    for (const worker of competitors) worker.child.send('go');
    const results = await Promise.all(outcomes); expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => result.ok)?.snapshot).toMatchObject({ attempt: 1, status: 'running', runId: input.runId });
    expect((await LemoStageStore.inspectInterruptedOwner(input.directory)).owner.processState).toBe('active');
  }, 30000);
});
