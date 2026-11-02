import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { build } from 'esbuild';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createLemoProductionTools, type LemoProductionToolsOptions } from '../services/lemo-agent-worker/production-tools';
import { LemoStageStore, type LemoStageToolEvent } from '../services/lemo-agent-worker/stage-store';
import { validateLemoSessionRequest } from '../services/lemo-agent-worker/session';
import { LEMO_AGENT_HOST_TOOL_MAX_BYTES, validateLemoAgentHostToolResult, type LemoAgentHostToolRequest,
  type LemoAgentHostToolResult, type LemoAgentSessionRequest } from '../src/shared/lemo-agent-session';

const cleanup: Array<() => Promise<unknown>> = [];
const tempRoot = resolve(tmpdir());
const upstream = resolve('vendor/lemo-upstream');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==';
const frames = (): LemoAgentHostToolResult => ({ content: [{ type: 'text', text: 'Actual source captures for visual review.' },
  ...Array.from({ length: 3 }, () => ({ type: 'image' as const, data: png, mimeType: 'image/png' as const }))], sideEffectApplied: true });
async function root() {
  const path = await mkdtemp(join(tempRoot, 'lemo-production-tools-'));
  cleanup.push(async () => { if (!resolve(path).startsWith(tempRoot + sep)) throw new Error('UNSAFE_CLEANUP'); await rm(path, { recursive: true, force: true }); });
  return path;
}
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(extra: Partial<LemoProductionToolsOptions> = {}) {
  const directory = await root(); const library = join(directory, 'library'); await mkdir(join(library, 'core'), { recursive: true });
  for (const path of ['storydream-upstream.json', 'DIRECTOR.md', 'TECHNIQUE.md', 'core/lib.js']) await copyFile(join(upstream, path), join(library, path));
  const events: LemoStageToolEvent[] = []; const requests: LemoAgentHostToolRequest[] = []; const fatal: string[] = [];
  const production = await createLemoProductionTools({ upstreamRoot: library, runId: 'run_fixture', stageId: 'film',
    onToolEvent: async event => { events.push(event); }, onFatal: code => { fatal.push(code); },
    invokeHostTool: async request => { requests.push(request); return request.tool === 'review_film' ? frames() : { content: [{ type: 'text', text: 'Host accepted current sources.' }], sideEffectApplied: true }; }, ...extra });
  const client = new Client({ name: 'production-tools-public-mcp-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await production.server.instance.connect(serverTransport); await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await production.server.instance.close(); });
  return { directory, library, events, requests, fatal, production, client,
    call: (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) };
}
function sessionRequest(): LemoAgentSessionRequest {
  return { version: 1, action: 'start', runId: 'run_fixture', stageId: 'film', runRoot: resolve('.artifacts/film-tools-run'),
    upstreamRoot: upstream, inputFingerprint: 'a'.repeat(64), configFingerprint: 'b'.repeat(64), prompt: 'Create original film sources.',
    model: 'offline-test', maxTurns: 3, maxOutputTokens: 8192, gateway: { baseUrl: 'http://127.0.0.1:43123', token: 'c'.repeat(64) }, capability: 'film-authoring-v1' };
}

describe('official SDK production tools through public MCP', () => {
  it('exposes exactly the reviewed library and host film capabilities', async () => {
    const f = await fixture(); expect((await f.client.listTools()).tools.map(tool => tool.name)).toEqual(['review_film', 'read_library', 'finish_film']);
    expect(f.production.allowedToolNames).toEqual(['mcp__storydream_film__review_film', 'mcp__storydream_film__read_library', 'mcp__storydream_film__finish_film']);
    expect(validateLemoSessionRequest(sessionRequest()).capability).toBe('film-authoring-v1');
    const legacy = sessionRequest(); delete legacy.capability; expect(validateLemoSessionRequest(legacy).capability).toBeUndefined();
    expect(() => validateLemoSessionRequest({ ...legacy, capability: 'shell' })).toThrow('LEMO_SESSION_REQUEST');
  });
  it('returns three real image content blocks and waits for a subsequent assistant turn before finish', async () => {
    const f = await fixture(); f.production.noteAssistantTurn('model_message_1');
    expect((await f.call('finish_film', { notes: 'The model cannot manufacture a readiness result.' })).isError).toBe(true); expect(f.requests).toEqual([]);
    const review = await f.call('review_film');
    expect(review.isError).not.toBe(true); expect(review.content).toEqual(frames().content);
    expect(f.events.slice(-2).map(event => event.phase)).toEqual(['started', 'completed']);
    f.production.noteAssistantTurn('model_message_1');
    expect((await f.call('finish_film', { notes: 'This finish is still in the same response batch.' })).isError).toBe(true);
    expect(f.requests.map(request => request.tool)).toEqual(['review_film']);
    f.production.noteAssistantTurn('model_message_2');
    const finished = await f.call('finish_film', { notes: 'The returned frames have legible type and balanced composition.' });
    expect(finished.isError).not.toBe(true); expect(f.requests.map(request => request.tool)).toEqual(['review_film', 'finish_film']);
    expect(f.requests[1]).toMatchObject({ version: 1, action: 'host-tool', runId: 'run_fixture', stageId: 'film',
      input: { notes: 'The returned frames have legible type and balanced composition.' } });
    expect(f.requests[0].operationId).not.toBe(f.requests[1].operationId);
  });
  it('allows model continuation to read pinned library text after a host review', async () => {
    const f = await fixture(); f.production.noteAssistantTurn('one'); await f.call('review_film');
    const result = await f.call('read_library', { path: 'DIRECTOR.md', offset: 13, length: 120 });
    expect(result.isError).not.toBe(true);
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(data).toMatchObject({ path: 'DIRECTOR.md', offset: 13, text: (await readFile(join(upstream, 'DIRECTOR.md'), 'utf8')).slice(13, 133) });
    expect(data.sha256).toMatch(/^[a-f0-9]{64}$/); expect(f.fatal).toEqual([]);
  });
  it('advertises host-compatible review arguments and rejects incomplete finish notes locally', async () => {
    const f = await fixture(); const tools = (await f.client.listTools()).tools;
    expect(tools.find(tool => tool.name === 'review_film')?.inputSchema.properties).toEqual({});
    for (const notes of [undefined, '', 'short', ' '.repeat(20), 'x'.repeat(8001)]) {
      expect((await f.call('finish_film', notes === undefined ? {} : { notes })).isError).toBe(true);
    }
    expect(f.requests).toEqual([]); expect(f.events).toEqual([]);
  });
  it.each(['../DIRECTOR.md', '/DIRECTOR.md', 'C:/DIRECTOR.md', 'core/../DIRECTOR.md', 'core\\lib.js', '.env', 'DIRECTOR.md:stream', 'core//lib.js'])(
    'refuses untrusted library path %s', async path => {
      const f = await fixture(); expect((await f.call('read_library', { path })).isError).toBe(true); expect(f.requests).toEqual([]);
    });
  it('does not reveal untracked files, binary resources or changed original sources', async () => {
    const f = await fixture(); await writeFile(join(f.library, 'untracked.md'), 'secret must remain unread', 'utf8');
    const untracked = await f.call('read_library', { path: 'untracked.md' }); expect(untracked.isError).toBe(true);
    expect(JSON.stringify(untracked)).not.toContain('secret must remain unread');
    expect((await f.call('read_library', { path: 'core/assets/polyhaven/walnut_diff.jpg' })).isError).toBe(true);
    await writeFile(join(f.library, 'DIRECTOR.md'), 'changed private source', 'utf8');
    const changed = await f.call('read_library', { path: 'DIRECTOR.md' }); expect(changed.isError).toBe(true);
    expect(JSON.stringify(changed)).not.toContain('changed private source');
  });
  it('rejects a manifest whose hashes were edited even if its revision string is unchanged', async () => {
    const f = await fixture(); const path = join(f.library, 'storydream-upstream.json'); const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.files[0].sha256 = 'a'.repeat(64); await writeFile(path, JSON.stringify(manifest), 'utf8');
    expect((await f.call('read_library', { path: 'DIRECTOR.md' })).isError).toBe(true);
    await expect(createLemoProductionTools({ upstreamRoot: f.library, runId: 'r', stageId: 's',
      onToolEvent: async () => undefined, invokeHostTool: async () => frames() })).rejects.toThrow('MANIFEST_CHANGED');
  });
  it('rejects file hardlinks and directory junctions to the original library', async () => {
    const f = await fixture(); await link(join(f.library, 'DIRECTOR.md'), join(f.directory, 'alias.md'));
    expect((await f.call('read_library', { path: 'DIRECTOR.md' })).isError).toBe(true);
    const alias = join(f.directory, 'library-alias'); await symlink(f.library, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createLemoProductionTools({ upstreamRoot: alias, runId: 'r', stageId: 's',
      onToolEvent: async () => undefined, invokeHostTool: async () => frames() })).rejects.toThrow('LINK');
  });
  it('does not invoke the host when the started operation cannot be persisted', async () => {
    let calls = 0; const f = await fixture({ onToolEvent: async () => { throw new Error('private disk error'); },
      invokeHostTool: async () => { calls++; return frames(); } });
    const result = await f.call('review_film'); expect(result.isError).toBe(true); expect(calls).toBe(0);
    expect(JSON.stringify(result)).not.toContain('private disk error'); expect(f.fatal).toContain('LEMO_FILM_AUDIT_FAILED');
  });
  it('records uncertain host effects and refuses replay when completion persistence fails', async () => {
    const events: LemoStageToolEvent[] = []; let calls = 0;
    const f = await fixture({ onToolEvent: async event => { if (event.phase === 'completed') throw new Error('disk failed'); events.push(event); },
      invokeHostTool: async () => { calls++; return frames(); } });
    expect((await f.call('review_film')).isError).toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'failed', sideEffectApplied: true });
    expect((await f.call('review_film')).isError).toBe(true); expect(calls).toBe(1);
  });
  it('redacts thrown host details and conservatively records a dispatched operation', async () => {
    const f = await fixture({ invokeHostTool: async () => { throw new Error('api_key=private-secret C:/private/file'); } });
    const result = await f.call('review_film'); expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private-secret|private\/file/);
    expect(f.events.at(-1)).toMatchObject({ phase: 'failed', sideEffectApplied: true }); expect(f.fatal).toHaveLength(1);
  });
  it('allows correction after an explicit no-effect host failure without returning its private error body', async () => {
    let calls = 0; const f = await fixture({ invokeHostTool: async () => ++calls === 1
      ? { isError: true, sideEffectApplied: false, content: [{ type: 'text', text: 'secret internal renderer log' }] } : frames() });
    const failed = await f.call('review_film'); expect(failed.isError).toBe(true); expect(JSON.stringify(failed)).not.toContain('secret internal');
    expect(f.events.at(-1)).toMatchObject({ phase: 'failed', sideEffectApplied: false });
    expect((await f.call('review_film')).isError).not.toBe(true); expect(f.fatal).toEqual([]);
  });
  it('refuses malformed images and refuses a text-only review as evidence for finish', async () => {
    const invalid = await fixture({ invokeHostTool: async () => ({ content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('not an actual image').toString('base64') }] }) });
    expect((await invalid.call('review_film')).isError).toBe(true); expect(invalid.fatal).toHaveLength(1);
    const text = await fixture({ invokeHostTool: async () => ({ content: [{ type: 'text', text: 'ready=true' }], sideEffectApplied: false }) });
    expect((await text.call('review_film')).isError).toBe(true); text.production.noteAssistantTurn('next');
    expect((await text.call('finish_film', { notes: 'A text-only reply cannot prove actual rendered frames.' })).isError).toBe(true);
  });
  it('persists its public MCP audit using the actual stage store and retains unknown effects', async () => {
    const directory = await root(); const store = await LemoStageStore.open({ directory: join(directory, 'stage'), runId: 'run_fixture', stageId: 'film',
      inputFingerprint: 'a'.repeat(64), configFingerprint: 'b'.repeat(64) }); cleanup.push(() => store.close());
    await store.recordSession('session_film'); await store.startAttempt('start');
    const f = await fixture({ onToolEvent: event => store.recordToolEvent(event), invokeHostTool: async () => { throw new Error('lost host reply'); } });
    expect((await f.call('review_film')).isError).toBe(true);
    expect(store.snapshot()).toMatchObject({ status: 'unknown', pendingToolOperations: 1 });
    expect(store.snapshot().toolEvents.map(event => event.phase)).toEqual(['started', 'failed']);
    await expect(store.startAttempt('resume')).rejects.toThrow('RESUME_BLOCKED');
  });
  it('does not invoke host work after cancellation', async () => {
    const controller = new AbortController(); const f = await fixture({ signal: controller.signal }); controller.abort();
    expect((await f.call('review_film')).isError).toBe(true); expect(f.requests).toEqual([]); expect(f.events).toEqual([]);
  });
});

describe('bounded host result validation', () => {
  it('accepts exactly three image blocks and returns an independent copy', () => {
    const value = frames(); const result = validateLemoAgentHostToolResult(value); result.content.length = 0;
    expect(value.content).toHaveLength(4);
  });
  it.each([
    { content: Array.from({ length: 4 }, () => ({ type: 'image', data: png, mimeType: 'image/png' })) },
    { content: [{ type: 'text', text: 'x'.repeat(262145) }] },
    { content: [{ type: 'image', data: png, mimeType: 'image/svg+xml' }] },
    { content: [{ type: 'image', data: 'bad base64', mimeType: 'image/png' }] },
    { content: [{ type: 'text', text: 'ok' }], ready: true },
    { content: [], isError: true },
  ])('rejects an out-of-contract host result', result => expect(() => validateLemoAgentHostToolResult(result)).toThrow('HOST_RESULT'));
  it('bounds total encoded screenshots as well as image count', () => {
    expect(() => validateLemoAgentHostToolResult({ content: [{ type: 'image', mimeType: 'image/png',
      data: 'A'.repeat(LEMO_AGENT_HOST_TOOL_MAX_BYTES) }] })).toThrow('HOST_RESULT');
  });
});

let workerDirectory: string; let workerPath: string;
beforeAll(async () => {
  workerDirectory = await mkdtemp(join(tempRoot, 'lemo-film-wire-')); workerPath = join(workerDirectory, 'worker.cjs');
  await build({ entryPoints: [resolve('services/lemo-agent-worker/worker.ts')], outfile: workerPath, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'offline-session-boundary', setup(builder) {
      builder.onResolve({ filter: /^\.\/(session|probe)$/ }, args => args.importer.endsWith('worker.ts') ? { path: args.path, namespace: 'offline-session' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'offline-session' }, args => ({ loader: 'ts', contents: args.path === './probe'
        ? 'export async function probeLemoAgentSdk() { return {fixture:true}; }'
        : "export function validateLemoSessionRequest(value) { return value; } export async function runLemoAgentSession(request, options) { const result = await options.invokeHostTool({version:1,action:'host-tool',runId:request.runId,stageId:request.stageId,operationId:'op_review_once',tool:'review_film',input:{}}); return {status:'completed',images:result.content.filter(item=>item.type==='image').length,bytes:JSON.stringify(result).length}; }" }));
    } }] });
}, 30000);
afterAll(async () => { if (workerDirectory && resolve(workerDirectory).startsWith(tempRoot + sep)) await rm(workerDirectory, { recursive: true, force: true }); });
interface Wire { child: ChildProcessWithoutNullStreams; closed: Promise<number | null>; messages: Record<string, unknown>[]; next(predicate: (value: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> }
function startWorker(): Wire {
  const child = spawn(process.execPath, [workerPath], { stdio: 'pipe', env: { ...process.env, TEMP: tempRoot, TMP: tempRoot } });
  const messages: Record<string, unknown>[] = []; let buffer = ''; let stderr = '';
  child.stdin.on('error', () => undefined); child.stderr.setEncoding('utf8').on('data', part => { stderr = (stderr + part).slice(-4096); });
  child.stdout.setEncoding('utf8').on('data', part => {
    buffer += part;
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; messages.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); }
  });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  cleanup.push(async () => { child.kill(); await closed; });
  return { child, closed, messages, next(predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('WORKER_TIMEOUT: ' + stderr)), 15000);
      const inspect = () => { const found = messages.find(predicate); if (found) finish(undefined, found); };
      const died = () => { const found = messages.find(predicate); if (found) finish(undefined, found); else finish(new Error('WORKER_EXIT: ' + stderr + JSON.stringify(messages))); };
      function finish(error?: Error, value?: Record<string, unknown>) { clearTimeout(timer); child.stdout.off('data', inspect); child.off('close', died); if (error) reject(error); else resolve(value!); }
      child.stdout.on('data', inspect); child.once('close', died); inspect();
    });
  } };
}
function reply(request: LemoAgentHostToolRequest, result: LemoAgentHostToolResult = frames()) {
  return { version: 1, action: 'host-tool-result', runId: request.runId, stageId: request.stageId, operationId: request.operationId, result };
}
async function pendingWorker() {
  const worker = startWorker(); worker.child.stdin.write(JSON.stringify(sessionRequest()) + '\n');
  const message = await worker.next(value => 'hostTool' in value); return { worker, request: message.hostTool as LemoAgentHostToolRequest };
}
describe('real worker stdin/stdout host-tool routing without model calls', () => {
  it('transports three screenshots larger than the previous 512 KiB pipe allowance', async () => {
    const { worker, request } = await pendingWorker();
    // Wire validation has a separate actual-image check in the production MCP handler.
    // This bounded payload exercises the transport only; real PNGs are covered above.
    const result: LemoAgentHostToolResult = { content: Array.from({ length: 3 }, () => ({ type: 'image', mimeType: 'image/png', data: 'A'.repeat(262144) })) };
    worker.child.stdin.write(JSON.stringify(reply(request, result)) + '\n');
    const message = await worker.next(value => 'ok' in value);
    expect(message).toMatchObject({ ok: true, result: { status: 'completed', images: 3 } }); expect(await worker.closed).toBe(0);
  }, 20000);
  it.each(['runId', 'stageId', 'operationId'] as const)('aborts on a mismatched %s', async field => {
    const { worker, request } = await pendingWorker(); worker.child.stdin.write(JSON.stringify({ ...reply(request), [field]: 'wrong' }) + '\n');
    expect(await worker.next(value => 'ok' in value)).toMatchObject({ ok: false }); expect(await worker.closed).toBe(1);
  }, 20000);
  it('rejects a repeated result instead of applying a tool twice', async () => {
    const { worker, request } = await pendingWorker(); const line = JSON.stringify(reply(request)) + '\n'; worker.child.stdin.write(line + line);
    expect(await worker.next(value => 'ok' in value)).toMatchObject({ ok: false, code: 'LEMO_SESSION_HOST_RESULT_MISMATCH' });
    expect(await worker.closed).toBe(1);
  }, 20000);
  it.each(['cancel', 'eof'] as const)('terminates a pending host operation after %s', async action => {
    const { worker, request } = await pendingWorker();
    if (action === 'eof') worker.child.stdin.end();
    else worker.child.stdin.write(JSON.stringify({ version: 1, action: 'cancel', runId: request.runId, stageId: request.stageId }) + '\n');
    expect(await worker.next(value => 'ok' in value)).toMatchObject({ ok: false }); expect(await worker.closed).toBe(1);
  }, 20000);
  it('rejects a malformed host result and oversized input without exposing contents', async () => {
    const first = await pendingWorker(); first.worker.child.stdin.write(JSON.stringify(reply(first.request, { content: [] })) + '\n');
    expect(await first.worker.next(value => 'ok' in value)).toMatchObject({ ok: false, code: 'LEMO_SESSION_HOST_RESULT' });
    const second = await pendingWorker(); second.worker.child.stdin.write('x'.repeat(LEMO_AGENT_HOST_TOOL_MAX_BYTES + 1));
    expect(await second.worker.next(value => 'ok' in value)).toMatchObject({ ok: false, code: 'LEMO_SDK_INPUT_LIMIT' });
  }, 20000);
  it('retains the legacy one-document-at-EOF probe protocol', async () => {
    const worker = startWorker(); worker.child.stdin.end(JSON.stringify({ version: 1, action: 'probe' }));
    expect(await worker.next(value => 'ok' in value)).toMatchObject({ ok: true, result: { fixture: true } }); expect(await worker.closed).toBe(0);
  }, 20000);
});
