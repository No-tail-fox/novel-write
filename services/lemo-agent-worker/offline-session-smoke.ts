import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runOfficialLemoAgentSession } from '../../electron/lemo-agent-session-runtime';
import { LemoRequestLedger } from './request-ledger';

const root = resolve('.artifacts/lemo-session-20261102');
await mkdir(root, { recursive: true });
const runRoot = join(root, 'run-' + Date.now());
const events: unknown[] = []; const requests: Array<{ tools: string[]; hadToolResult: boolean; hadPriorBrief: boolean }> = [];
const content = '# 离线创意动画阶段\n城市热岛：树荫帮助街道降温。\n';
let mode: 'author' | 'cancel' = 'author';
let cancelSubmitted!: () => void; const submitted = new Promise<void>(r => { cancelSubmitted = r; });
const upstream = createServer(async (req, res) => {
  try {
    let input = ''; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    requests.push({ tools: body.tools.map((t: { name: string }) => t.name),
      hadToolResult: body.messages.some((m: { content: unknown }) => Array.isArray(m.content) && m.content.some((c: { type: string }) => c.type === 'tool_result')),
      hadPriorBrief: JSON.stringify(body.messages).includes('OFFLINE_AUTHORING_BRIEF') });
    if (mode === 'cancel') { cancelSubmitted(); return; }
    const first = requests.length === 1;
    assert(requests.at(-1)!.tools.includes('mcp__storydream__write_text'));
    const event = (type: string, fields: object = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event('message_start', { message: { id: 'msg_session_' + requests.length, type: 'message', role: 'assistant', model: 'offline-session-model',
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } }));
    res.write(event('content_block_start', { index: 0, content_block: first
      ? { type: 'tool_use', id: 'toolu_write_treatment', name: 'mcp__storydream__write_text', input: {} } : { type: 'text', text: '' } }));
    res.write(event('content_block_delta', { index: 0, delta: first
      ? { type: 'input_json_delta', partial_json: JSON.stringify({ path: 'TREATMENT.md', content }) }
      : { type: 'text_delta', text: 'The treatment artifact is saved. Film rendering and real provider acceptance remain unverified.' } }));
    res.write(event('content_block_stop', { index: 0 }));
    res.write(event('message_delta', { delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }));
    res.end(event('message_stop'));
  } catch { res.destroy(); }
});
await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r));
const address = upstream.address(); assert(address && typeof address !== 'string');
const options = { action: 'start' as const, nodeExecutable: process.execPath, workerPath: resolve('services/lemo-agent-worker/dist/worker.mjs'),
  runRoot, upstreamRoot: resolve('vendor/lemo-upstream'), runId: 'offline-authoring', stageId: 'treatment',
  prompt: 'OFFLINE_AUTHORING_BRIEF: Write a short original Chinese treatment to TREATMENT.md with the audited project tool. This local fixture is not real AI film acceptance.',
  provider: { protocol: 'anthropic' as const, messagesUrl: `http://127.0.0.1:${address.port}/v1/messages`, apiKey: 'offline-provider-key', auth: 'bearer' as const, model: 'offline-session-model' },
  maxOutputTokens: 8192, maxRequests: 4, maxTurns: 1, timeoutMs: 60000, requestTimeoutMs: 30000, allowLoopbackTestProvider: true,
  onEvent: (event: unknown) => { events.push(event); } };
try {
  const first = await runOfficialLemoAgentSession(options);
  assert.equal(first.receipt.status, 'failed'); assert.equal(first.receipt.resultSubtype, 'error_max_turns');
  const project = join(runRoot, 'sdk-state', 'project');
  assert.equal(await readFile(join(project, 'TREATMENT.md'), 'utf8'), content);
  const saved = JSON.parse(await readFile(join(runRoot, 'stage', 'stage.json'), 'utf8'));
  assert.equal(saved.pendingToolOperations, 0); assert.equal(saved.toolEvents.length, 2);
  const resumed = await runOfficialLemoAgentSession({ ...options, action: 'resume' });
  assert.equal(resumed.receipt.status, 'completed'); assert.equal(resumed.receipt.sessionId, first.receipt.sessionId);
  assert.equal(resumed.receipt.deliveryStatus, 'unverified'); assert.equal(resumed.receipt.artifacts.length, 1);
  assert.equal(requests.length, 2); assert.equal(requests[1].hadToolResult, true); assert.equal(requests[1].hadPriorBrief, true);
  await assert.rejects(runOfficialLemoAgentSession({ ...options, action: 'resume' }), /RESUME_BLOCKED/);
  await assert.rejects(runOfficialLemoAgentSession({ ...options, action: 'start' }), /START_ALREADY_ATTEMPTED/);
  await assert.rejects(runOfficialLemoAgentSession({ ...options, action: 'resume', prompt: options.prompt + ' changed' }), /IDENTITY_CONFLICT/);
  assert.equal(requests.length, 2);
  mode = 'cancel'; const abort = new AbortController(); const cancelledRoot = join(root, 'cancel-' + Date.now());
  const cancelling = runOfficialLemoAgentSession({ ...options, runRoot: cancelledRoot, runId: 'offline-cancel', signal: abort.signal });
  const cancellationCheck = assert.rejects(cancelling, /CANCELLED/);
  await submitted; abort.abort(); await cancellationCheck;
  const ledger = await LemoRequestLedger.open(join(cancelledRoot, 'ledger'), 4);
  const cancellationLedger = ledger.summary(); await ledger.close();
  assert.equal(cancellationLedger.unknown, 1); assert.equal(cancellationLedger.blocked, true);
  await assert.rejects(runOfficialLemoAgentSession({ ...options, action: 'resume', runRoot: cancelledRoot, runId: 'offline-cancel' }), /LEMO_LEDGER_BLOCKED/);
  assert.equal(requests.length, 3);
  const report = { version: 1, status: 'passed', scope: 'Official SDK file-authoring start/resume/cancel using a local provider fixture',
    paidRequests: 0, realProviderVerified: false, productionReady: false, sdkVersion: first.receipt.sdkVersion, cliVersion: first.receipt.cliVersion,
    first, resumed, cancellationLedger, requests, events, runRoot, cancelledRoot,
    limitations: ['No live provider requests or rendered film acceptance.', 'Project file tools are not an OS execution sandbox.', 'Product creative-video routing remains unchanged until rendering and audio capability acceptance.'] };
  await writeFile(join(root, 'offline-session-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ status: report.status, providerRequests: requests.length, paidRequests: 0, sessionId: first.receipt.sessionId, artifacts: resumed.receipt.artifacts, cancellationLedger }));
} finally { upstream.closeAllConnections(); await new Promise<void>(r => upstream.close(() => r())); }
