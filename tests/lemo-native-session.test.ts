import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runOfficialLemoAgentSession, type OfficialLemoSessionOptions } from '../electron/lemo-agent-session-runtime';
import { LEMO_NATIVE_AGENT_VERSION } from '../src/shared/lemo-agent-session';
import { nativeReply } from './fixtures/lemo-native-wire';

const roots: string[] = []; const cleanup: Array<() => Promise<void>> = [];
beforeAll(() => execFileSync(process.execPath, ['scripts/build-lemo-agent-worker.mjs'], { cwd: resolve('.'), windowsHide: true, stdio: 'pipe' }));
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
type Json = Record<string, any>;
async function fixture(protocol: 'openai' | 'responses', respond: (body: Json, index: number, res: ServerResponse) => void, patch: Partial<OfficialLemoSessionOptions> = {}) {
  const runRoot = await mkdtemp(join(tmpdir(), 'lemo-native-session-')); roots.push(runRoot);
  const bodies: Json[] = []; const headers: unknown[] = [];
  const server = createServer(async (req, res) => {
    try { let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); bodies.push(body); headers.push(req.headers); respond(body, bodies.length, res); }
    catch { res.destroy(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address');
  const options: OfficialLemoSessionOptions = { action: 'start', nodeExecutable: process.execPath, workerPath: resolve('services/lemo-agent-worker/dist/worker.mjs'),
    runRoot, upstreamRoot: resolve('vendor/lemo-upstream'), runId: 'native_run', stageId: 'native_stage', prompt: 'Create the approved original file with the supplied audited tools.',
    provider: { protocol, messagesUrl: 'http://127.0.0.1:' + address.port + (protocol === 'openai' ? '/v1/chat/completions' : '/v1/responses'), apiKey: 'fixture-upstream-secret', auth: 'bearer', model: 'fixture-model' },
    maxOutputTokens: 1024, maxRequests: 8, maxTurns: 4, timeoutMs: 60000, requestTimeoutMs: 5000, allowLoopbackTestProvider: true, ...patch };
  return { options, bodies, headers, runRoot, run: (extra: Partial<OfficialLemoSessionOptions> = {}) => runOfficialLemoAgentSession({ ...options, ...extra }) };
}
const send = (res: ServerResponse, body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const write = { name: 'mcp__storydream__write_text', input: { path: 'TREATMENT.md', content: '原创中文创意方案' } };
const preview = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yRUsAAAAASUVORK5CYII=';

describe.each(['openai', 'responses'] as const)('%s actual isolated AI SDK worker', protocol => {
  it('authors a real UTF-8 file, returns a tool result and saves native receipts', async () => {
    const f = await fixture(protocol, (_body, n, res) => send(res, nativeReply(protocol, 'Done', n === 1 ? [write] : [], n)), { maxEstimatedCostUsd: 1 });
    const result = await f.run();
    expect(result.receipt).toMatchObject({ status: 'completed', sdkVersion: LEMO_NATIVE_AGENT_VERSION, deliveryStatus: 'unverified' });
    expect(result.receipt.estimatedCostUsd).toBeUndefined();
    expect(result.ledger).toMatchObject({ requests: 2, received: 2, blocked: false });
    expect(await readFile(join(f.runRoot, 'sdk-state/project/TREATMENT.md'), 'utf8')).toBe(write.input.content);
    expect(JSON.stringify(f.bodies[1])).toContain(protocol === 'openai' ? 'tool_call_id' : 'function_call_output');
    expect(f.headers[0]).toMatchObject({ authorization: 'Bearer fixture-upstream-secret' });
    if (protocol === 'responses') { expect(f.bodies[0].store).toBe(false); expect(f.bodies[0].include).toContain('reasoning.encrypted_content'); }
    const transcript = await readFile(join(f.runRoot, 'sdk-state/native-session.json'), 'utf8');
    expect(JSON.parse(transcript)).toMatchObject({ backend: LEMO_NATIVE_AGENT_VERSION, protocol, phase: 'ready', turns: 2 });
    expect(transcript).not.toContain('fixture-upstream-secret');
    const responseRoot = join(f.runRoot, 'ledger/private-responses');
    const files = await readdir(responseRoot, { withFileTypes: true });
    const stored = files.filter(e => e.isDirectory() && !e.name.startsWith('.'));
    expect(stored).toHaveLength(2);
    expect(JSON.parse(await readFile(join(responseRoot, stored[0].name, 'manifest.json'), 'utf8')).protocol).toBe(protocol);
  }, 20000);
  it('resumes a bounded turn without repeating completed tools or changing session identity', async () => {
    const f = await fixture(protocol, (_body, n, res) => send(res, nativeReply(protocol, 'Done', n === 1 ? [write] : [], n)), { maxTurns: 1 });
    const first = await f.run(); expect(first.receipt).toMatchObject({ status: 'failed', resultSubtype: 'error_max_turns' });
    const second = await f.run({ action: 'resume' });
    expect(second.receipt.status).toBe('completed'); expect(second.receipt.sessionId).toBe(first.receipt.sessionId); expect(f.bodies).toHaveLength(2);
    const stage = JSON.parse(await readFile(join(f.runRoot, 'stage/stage.json'), 'utf8'));
    expect(stage.toolEvents.filter((e: Json) => e.phase === 'started')).toHaveLength(1); expect(stage.attempt).toBe(2);
  }, 20000);
  it('returns actual review images in the next model turn before permitting finish', async () => {
    const host: string[] = [];
    const f = await fixture(protocol, (_body, n, res) => send(res, nativeReply(protocol, '', [{ name: n === 1 ? 'mcp__storydream_film__review_film' : 'mcp__storydream_film__finish_film', input: n === 1 ? {} : { notes: 'I inspected the supplied real image and its layout and contrast.' } }], n)), {
      capability: 'film-authoring-v1', invokeHostTool: async request => { host.push(request.tool); return { sideEffectApplied: false, content: request.tool === 'review_film' ? [{ type: 'image', mimeType: 'image/png', data: preview }] : [{ type: 'text', text: 'Host accepted' }] }; },
    });
    expect((await f.run()).receipt.status).toBe('completed');
    expect(host).toEqual(['review_film', 'finish_film']); expect(f.bodies).toHaveLength(2);
    expect(JSON.stringify(f.bodies[1])).toContain('data:image/png;base64,' + preview);
  }, 20000);
  it('blocks a review/finish batch before executing either host tool', async () => {
    let hostCalls = 0;
    const f = await fixture(protocol, (_body, n, res) => send(res, nativeReply(protocol, '', [
      { name: 'mcp__storydream_film__review_film', input: {} }, { name: 'mcp__storydream_film__finish_film', input: { notes: 'Cannot have seen the image yet, so this must be refused.' } },
    ], n)), { capability: 'film-authoring-v1', invokeHostTool: async () => { hostCalls++; return { content: [{ type: 'text', text: 'invalid' }] }; } });
    await expect(f.run()).rejects.toThrow('LEMO_NATIVE_TOOL_BATCH'); expect(hostCalls).toBe(0); expect(f.bodies).toHaveLength(1);
  }, 20000);
  it('retains unknown responses, avoids retry and prevents restart from bypassing the ledger', async () => {
    const f = await fixture(protocol, (_body, _n, res) => send(res, { id: 'unfinished', output: [], choices: [] }));
    await expect(f.run()).rejects.toThrow(); expect(f.bodies).toHaveLength(1);
    await expect(f.run({ action: 'resume' })).rejects.toThrow('LEMO_LEDGER_BLOCKED'); expect(f.bodies).toHaveLength(1);
    expect(await readdir(join(f.runRoot, 'sdk-state/project'))).toEqual([]);
  }, 20000);
  it('blocks a transcript interrupted between response persistence and tool settlement', async () => {
    const f = await fixture(protocol, (_body, n, res) => send(res, nativeReply(protocol, '', [write], n)), { maxTurns: 1 });
    await f.run(); const file = join(f.runRoot, 'sdk-state/native-session.json'); const transcript = JSON.parse(await readFile(file, 'utf8'));
    transcript.phase = 'tools-pending'; await writeFile(file, JSON.stringify(transcript), 'utf8');
    await expect(f.run({ action: 'resume' })).rejects.toThrow('LEMO_NATIVE_RESUME_BLOCKED'); expect(f.bodies).toHaveLength(1);
  }, 20000);
  it('cancels an in-flight upstream request and blocks replay of its unknown result', async () => {
    const controller = new AbortController();
    let upstreamClosed = false;
    const f = await fixture(protocol, (_body, _n, res) => {
      res.once('close', () => { upstreamClosed = true; });
      controller.abort();
    });
    await expect(f.run({ signal: controller.signal })).rejects.toThrow('LEMO_SESSION_CANCELLED');
    await expect.poll(() => upstreamClosed).toBe(true);
    expect(f.bodies).toHaveLength(1);
    await expect(f.run({ action: 'resume' })).rejects.toThrow('LEMO_LEDGER_BLOCKED');
    expect(f.bodies).toHaveLength(1);
    expect(await readdir(join(f.runRoot, 'sdk-state/project'))).toEqual([]);
  }, 20000);
  it('validates an entire tool batch before allowing a valid earlier write', async () => {
    const f = await fixture(protocol, (_body, n, res) => send(res, nativeReply(protocol, '', [write,
      { name: 'mcp__storydream__write_text', input: { path: 'bad.md', content: 42 } },
    ], n)));
    await expect(f.run()).rejects.toThrow();
    expect(f.bodies).toHaveLength(1);
    expect(await readdir(join(f.runRoot, 'sdk-state/project'))).toEqual([]);
  }, 20000);
});
