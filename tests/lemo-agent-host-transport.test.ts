import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { sessionTransport, type OfficialLemoSessionOptions } from '../electron/lemo-agent-session-runtime';
import { LEMO_AGENT_SDK_VERSION } from '../src/shared/lemo-agent-sdk';
import type { LemoAgentHostToolRequest, LemoAgentHostToolResult, LemoAgentSessionRequest } from '../src/shared/lemo-agent-session';

// This is a real Node stdio peer. It deliberately never imports the SDK, starts a
// gateway, loads user credentials, or connects to any provider.
const peer = String.raw`
const { createInterface } = require('node:readline');
const { writeFileSync } = require('node:fs');
const mode = process.env.LEMO_TRANSPORT_FIXTURE_MODE;
const replies = [];
let request, host;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const stop = value => { process.stdin.destroy(); process.stdout.write(JSON.stringify(value) + '\n', () => process.exit(0)); };
const receipt = () => ({version:1,runId:request.runId,stageId:request.stageId,
  sessionId:'33333333-3333-4333-8333-333333333333',status:'completed',sdkVersion:process.env.LEMO_TRANSPORT_FIXTURE_SDK,
  cliVersion:'offline-fixture',deliveryStatus:'unverified',artifacts:[]});
createInterface({input:process.stdin}).on('line', line => {
  const value = JSON.parse(line);
  if (!request) {
    request = value;
    host = {version:1,action:'host-tool',runId:request.runId,stageId:request.stageId,
      operationId:'11111111-1111-4111-8111-111111111111',tool:'review_film',input:{}};
    if (mode.startsWith('wrong-')) host[mode.slice(6)] = 'invalid';
    if (mode === 'extra-field') host.ready = true;
    if (mode === 'bad-review-input') host.input = {notes:'unexpected'};
    if (mode === 'bad-finish-input') { host.tool = 'finish_film'; host.input = {notes:'short'}; }
    if (mode === 'terminal-first') { process.stdout.write(JSON.stringify({ok:true,result:receipt()})+'\n'+JSON.stringify({hostTool:host})+'\n'); return; }
    send({hostTool:host});
    if (mode === 'duplicate-pending') send({hostTool:host});
    if (mode === 'terminal-pending') send({ok:true,result:receipt()});
    if (mode === 'failure-pending') send({ok:false,code:'LEMO_SESSION_FAILED'});
    return;
  }
  if (value.action === 'cancel') {
    writeFileSync(process.env.LEMO_TRANSPORT_FIXTURE_CAPTURE, JSON.stringify({cancel:value}), 'utf8');
    stop({ok:false,code:'LEMO_SESSION_CANCELLED'}); return;
  }
  replies.push(value);
  writeFileSync(process.env.LEMO_TRANSPORT_FIXTURE_CAPTURE, JSON.stringify(replies), 'utf8');
  if (mode === 'duplicate-replied') { send({hostTool:host}); return; }
  if (mode === 'two-tools' && replies.length === 1) {
    host = {...host,operationId:'22222222-2222-4222-8222-222222222222',tool:'finish_film',
      input:{notes:'I inspected all three returned frames for layout and readable type.'}};
    send({hostTool:host}); return;
  }
  stop({ok:true,result:receipt()});
});
`;

const directories: string[] = [];
const temporaryRoot = resolve(tmpdir());
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(temporaryRoot + sep)) throw new Error('FIXTURE_PATH');
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(mode = 'normal') {
  const directory = await mkdtemp(join(temporaryRoot, 'lemo-host-transport-')); directories.push(directory);
  const workerPath = join(directory, 'peer.cjs'); const capture = join(directory, 'reply.json');
  await writeFile(workerPath, peer, 'utf8');
  const request: LemoAgentSessionRequest = { version: 1, action: 'start', runId: 'run_fixture', stageId: 'film',
    capability: 'film-authoring-v1', runRoot: directory, upstreamRoot: resolve('vendor/lemo-upstream'),
    inputFingerprint: 'a'.repeat(64), configFingerprint: 'b'.repeat(64), prompt: 'offline transport fixture',
    gateway: { baseUrl: 'http://127.0.0.1:43123', token: 'c'.repeat(64) }, model: 'fixture-model', maxOutputTokens: 8192, maxTurns: 3 };
  const options: OfficialLemoSessionOptions = { action: 'start', nodeExecutable: process.execPath, workerPath,
    runRoot: directory, upstreamRoot: request.upstreamRoot, runId: request.runId, stageId: request.stageId, prompt: request.prompt,
    capability: 'film-authoring-v1', provider: { protocol: 'anthropic', messagesUrl: 'https://provider.invalid/v1/messages',
      apiKey: 'fixture-only-unused', auth: 'x-api-key', model: request.model },
    maxOutputTokens: request.maxOutputTokens, maxTurns: request.maxTurns, maxRequests: 3, timeoutMs: 10000, requestTimeoutMs: 10000 };
  const env = { ...process.env, LEMO_TRANSPORT_FIXTURE_MODE: mode, LEMO_TRANSPORT_FIXTURE_CAPTURE: capture,
    LEMO_TRANSPORT_FIXTURE_SDK: LEMO_AGENT_SDK_VERSION };
  return { options, request, run: () => sessionTransport(options, request, env),
    readReplies: async () => JSON.parse(await readFile(capture, 'utf8')) as Array<{ action: string; runId: string; stageId: string; operationId: string; result: LemoAgentHostToolResult }>,
    readCancel: async () => JSON.parse(await readFile(capture, 'utf8')) as { cancel: { action: string; runId: string; stageId: string } } };
}

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFwoAAAAASUVORK5CYII=';
const frames = (): LemoAgentHostToolResult => ({ sideEffectApplied: true, content: [
  { type: 'text', text: 'Three rendered frames are attached.' },
  ...Array.from({ length: 3 }, () => ({ type: 'image' as const, mimeType: 'image/png' as const, data: png })),
] });

function pendingHost(options: OfficialLemoSessionOptions) {
  let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
  let cleanupComplete = false; let abortCount = 0;
  const invoke = vi.fn((_request: LemoAgentHostToolRequest, signal: AbortSignal) => new Promise<LemoAgentHostToolResult>(resolve => {
    started(); signal.addEventListener('abort', () => {
      abortCount++;
      setTimeout(() => { cleanupComplete = true; resolve({ isError: true, sideEffectApplied: false,
        content: [{ type: 'text', text: 'fixture cancellation completed' }] }); }, 20);
    }, { once: true });
  }));
  options.invokeHostTool = invoke;
  return { entered, invoke, cleaned: () => cleanupComplete, aborts: () => abortCount };
}

describe('real host sessionTransport bidirectional protocol without provider calls', () => {
  it('routes actual host screenshots and a subsequent finish reply to the same worker', async () => {
    const f = await fixture('two-tools'); const requests: LemoAgentHostToolRequest[] = []; const signals: AbortSignal[] = [];
    f.options.invokeHostTool = async (request, signal) => {
      requests.push(request); signals.push(signal);
      return request.tool === 'review_film' ? frames() : { sideEffectApplied: true, content: [{ type: 'text', text: 'Host delivery verified.' }] };
    };
    expect(await f.run()).toMatchObject({ status: 'completed', deliveryStatus: 'unverified' });
    expect(requests.map(request => request.tool)).toEqual(['review_film', 'finish_film']);
    const replies = await f.readReplies(); expect(replies).toHaveLength(2);
    expect(replies[0]).toEqual({ version: 1, action: 'host-tool-result', runId: f.request.runId, stageId: f.request.stageId,
      operationId: requests[0].operationId, result: frames() });
    expect(replies[1].operationId).toBe(requests[1].operationId);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('carries a bounded three-image response larger than 512 KiB', async () => {
    const f = await fixture();
    const result: LemoAgentHostToolResult = { content: Array.from({ length: 3 }, () => ({ type: 'image', mimeType: 'image/png', data: 'A'.repeat(262144) })) };
    // Actual image validation belongs to the production MCP suite; this checks the wire size.
    f.options.invokeHostTool = async () => result;
    await expect(f.run()).resolves.toMatchObject({ status: 'completed' });
    expect((await f.readReplies())[0].result).toEqual(result);
  });

  it.each(['runId', 'stageId', 'operationId', 'version', 'action', 'tool'])(
    'refuses a wrong host request %s before dispatch', async field => {
      const f = await fixture('wrong-' + field); const invoke = vi.fn(async () => frames()); f.options.invokeHostTool = invoke;
      await expect(f.run()).rejects.toThrow('LEMO_SESSION_HOST_REQUEST'); expect(invoke).not.toHaveBeenCalled();
    });

  it.each(['extra-field', 'bad-review-input', 'bad-finish-input'])(
    'refuses malformed input: %s', async mode => {
      const f = await fixture(mode); const invoke = vi.fn(async () => frames()); f.options.invokeHostTool = invoke;
      await expect(f.run()).rejects.toThrow('LEMO_SESSION_HOST_REQUEST'); expect(invoke).not.toHaveBeenCalled();
    });

  it('refuses host tools when the film capability was omitted', async () => {
    const f = await fixture(); delete f.request.capability; delete f.options.capability;
    const invoke = vi.fn(async () => frames()); f.options.invokeHostTool = invoke;
    await expect(f.run()).rejects.toThrow('LEMO_SESSION_HOST_REQUEST'); expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses host tools when no host implementation exists', async () => {
    const f = await fixture(); await expect(f.run()).rejects.toThrow('LEMO_SESSION_HOST_REQUEST');
  });

  it('refuses a repeated operation after its first reply', async () => {
    const f = await fixture('duplicate-replied'); const invoke = vi.fn(async () => frames()); f.options.invokeHostTool = invoke;
    await expect(f.run()).rejects.toThrow('LEMO_SESSION_HOST_REQUEST'); expect(invoke).toHaveBeenCalledTimes(1);
    expect(await f.readReplies()).toHaveLength(1);
  });

  it.each(['duplicate-pending', 'terminal-pending', 'failure-pending'])(
    'aborts and waits for pending host cleanup on %s', async mode => {
      const f = await fixture(mode); f.options.timeoutMs = 2000; const pending = pendingHost(f.options);
      await expect(f.run()).rejects.toThrow(mode === 'duplicate-pending' ? 'LEMO_SESSION_HOST_REQUEST' : 'LEMO_SESSION_WORKER_OUTPUT');
      expect(pending.invoke).toHaveBeenCalledTimes(1); expect(pending.aborts()).toBe(1); expect(pending.cleaned()).toBe(true);
    });

  it('refuses a host tool emitted after a terminal receipt', async () => {
    const f = await fixture('terminal-first'); const invoke = vi.fn(async () => frames()); f.options.invokeHostTool = invoke;
    await expect(f.run()).rejects.toThrow('LEMO_SESSION_HOST_REQUEST'); expect(invoke).not.toHaveBeenCalled();
  });

  it('cancels a host operation, sends scoped cancellation, and awaits cleanup', async () => {
    const f = await fixture(); const controller = new AbortController(); f.options.signal = controller.signal;
    const pending = pendingHost(f.options); const result = expect(f.run()).rejects.toThrow('LEMO_SESSION_CANCELLED');
    await pending.entered; controller.abort(); await result;
    expect(pending.aborts()).toBe(1); expect(pending.cleaned()).toBe(true);
    expect((await f.readCancel()).cancel).toEqual({ version: 1, action: 'cancel', runId: f.request.runId, stageId: f.request.stageId });
  });

  it('aborts pending host work when the session deadline expires', async () => {
    const f = await fixture(); f.options.timeoutMs = 200; const pending = pendingHost(f.options);
    await expect(f.run()).rejects.toThrow('LEMO_SESSION_TIMEOUT');
    expect(pending.invoke).toHaveBeenCalledTimes(1); expect(pending.aborts()).toBe(1); expect(pending.cleaned()).toBe(true);
  });

  it.each(['throw', 'malformed'] as const)('sanitizes a %s host failure and marks its effect uncertain', async mode => {
    const f = await fixture(); f.options.invokeHostTool = async () => {
      if (mode === 'throw') throw new Error('private-fixture-token /private/file');
      return { content: [], privateKey: 'private-fixture-token' } as unknown as LemoAgentHostToolResult;
    };
    await f.run(); const replies = await f.readReplies();
    expect(replies[0].result).toEqual({ isError: true, sideEffectApplied: true,
      content: [{ type: 'text', text: 'LEMO_FILM_HOST_OPERATION_UNKNOWN' }] });
    expect(JSON.stringify(replies)).not.toContain('private-fixture-token');
  });
});
