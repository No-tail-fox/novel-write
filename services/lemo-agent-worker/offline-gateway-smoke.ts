import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { LEMO_AGENT_SDK_VERSION, LEMO_AGENT_SKILL_NAME } from '../../src/shared/lemo-agent-sdk';
import { lemoWorkerEnvironment } from './environment';
import { prepareLemoStateDirectory } from './paths';
import { verifyLoadedLemoPlugin, verifyPinnedLemoPlugin } from './policy';
import { LemoRequestLedger } from './request-ledger';
import { startLemoMessagesGateway } from './messages-gateway';

/** Offline transport contract, not a real model benchmark or production entrypoint. */
const root = resolve('.artifacts/lemo-agent-gateway-smoke');
await mkdir(root, { recursive: true });
const upstreamRoot = resolve('vendor/lemo-upstream');
const pluginPath = await verifyPinnedLemoPlugin(upstreamRoot);
const runs = [];
for (const scenario of ['tool-denied-then-recovery', 'truncated-provider-stream'] as const) {
  const runRoot = join(root, scenario + '-' + Date.now());
  const stateRoot = await prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot, upstreamRoot }, 'sdk-state');
  const env = lemoWorkerEnvironment(process.env, stateRoot);
  let requestCount = 0; let sawDeniedToolResult = false; let permissionDenials = 0;
  const requestShapes: Array<{ model: unknown; maxTokens: unknown; stream: unknown }> = [];
  const upstream = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requestCount++;
      requestShapes.push({ model: body.model, maxTokens: body.max_tokens, stream: body.stream });
      sawDeniedToolResult ||= body.messages.some((m: { content?: unknown }) => Array.isArray(m.content)
        && m.content.some((b: { type?: string; is_error?: boolean }) => b.type === 'tool_result' && b.is_error === true));
      const event = (type: string, fields: object = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
      const tool = scenario === 'tool-denied-then-recovery' && !sawDeniedToolResult;
      const message = { id: 'msg_offline_' + requestCount, type: 'message', role: 'assistant', model: 'offline-model', content: [], stop_reason: null,
        stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(event('message_start', { message }));
      if (tool) {
        res.write(event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_offline_1', name: 'Skill', input: {} } }));
        res.write(event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ skill: LEMO_AGENT_SKILL_NAME }) } }));
      } else {
        res.write(event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
        res.write(event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OFFLINE_GATEWAY_OK' } }));
      }
      res.write(event('content_block_stop', { index: 0 }));
      res.write(event('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }));
      if (scenario !== 'truncated-provider-stream') res.write(event('message_stop'));
      res.end();
    } catch { res.destroy(); }
  });
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r));
  const address = upstream.address(); assert(address && typeof address !== 'string');
  const ledger = await LemoRequestLedger.open(join(runRoot, 'ledger'), 4);
  const gateway = await startLemoMessagesGateway({ ledger,
    provider: { protocol: 'anthropic', messagesUrl: `http://127.0.0.1:${address.port}/v1/messages`, apiKey: 'offline-upstream-not-a-real-key', auth: 'bearer', model: 'offline-model' },
    maxOutputTokens: 32768, timeoutMs: 15000, allowLoopbackTestProvider: true });
  env.ANTHROPIC_BASE_URL = gateway.baseUrl;
  env.ANTHROPIC_API_KEY = gateway.localToken;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'offline-model'; env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'offline-model'; env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'offline-model';
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
  if (process.platform === 'win32') {
    const bash = join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
    try { if ((await lstat(bash)).isFile()) env.CLAUDE_CODE_GIT_BASH_PATH = bash; } catch { /* SDK reports unavailable runtime. */ }
  }
  const abort = new AbortController(); let sdk: Query | undefined;
  const timer = setTimeout(() => abort.abort(), 45000);
  try {
    sdk = query({ prompt: 'Offline protocol test only. Do not execute any commands, edit files, or access networks. The local fixture may return a denied tool; accept the denial and continue the model conversation.', options: {
      cwd: join(stateRoot, 'project'), env, abortController: abort, settingSources: [], persistSession: false,
      permissionMode: 'default', allowDangerouslySkipPermissions: false,
      model: 'offline-model', thinking: { type: 'disabled' }, maxTurns: 3,
      tools: ['Skill'], skills: [LEMO_AGENT_SKILL_NAME], allowedTools: [], strictMcpConfig: true, mcpServers: {},
      canUseTool: async () => { permissionDenials++; return { behavior: 'deny', message: 'Offline fixture: execution prohibited.' }; },
      hooks: { PreToolUse: [{ hooks: [async () => { permissionDenials++; return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Offline fixture: execution prohibited.' } }; }] }] },
      plugins: [{ type: 'local', path: pluginPath }], pluginDelivery: 'initialize',
    } });
    const init = await sdk.initializationResult();
    verifyLoadedLemoPlugin(await sdk.reloadPlugins(), pluginPath);
    let result: { subtype: string; is_error: boolean } | undefined;
    let sdkErrorCode: string | undefined;
    try {
      for await (const item of sdk) if (item.type === 'result') result = { subtype: item.subtype, is_error: item.is_error };
    } catch (error) {
      // The official SDK can throw after emitting an error result. Accept only the expected negative contract.
      sdkErrorCode = error instanceof Error ? error.message.match(/LEMO_[A-Z_]+/)?.[0] : undefined;
      if (scenario !== 'truncated-provider-stream' || !['LEMO_LEDGER_BLOCKED', 'LEMO_GATEWAY_INCOMPLETE'].includes(sdkErrorCode ?? '')) throw error;
    }
    const summary = gateway.summary();
    if (scenario === 'tool-denied-then-recovery') {
      assert.deepEqual(result, { subtype: 'success', is_error: false });
      assert.equal(requestCount, 2); assert.equal(summary.received, 2); assert.equal(summary.unknown, 0);
      assert.equal(sawDeniedToolResult, true); assert(permissionDenials > 0);
    } else {
      assert.equal(requestCount, 1); assert.equal(summary.unknown, 1); assert.equal(summary.blocked, true);
      assert(result?.is_error || sdkErrorCode); assert(summary.blockedRequests >= 1);
    }
    runs.push({ scenario, status: 'passed', sdkVersion: LEMO_AGENT_SDK_VERSION, cliVersion: init.claude_code_version,
      requestCount, permissionDenials, sawDeniedToolResult, requestShapes, result, sdkErrorCode, ledger: summary, runRoot });
  } finally {
    clearTimeout(timer); sdk?.close(); abort.abort(); await gateway.close(); await ledger.close();
    upstream.closeAllConnections(); await new Promise<void>(r => upstream.close(() => r()));
  }
}
const report = { version: 1, status: 'offline-protocol-passed', paidRequests: 0, realProviderVerified: false, productionReady: false,
  limitations: ['本机模拟Messages响应，不代表真实渠道兼容或视觉创作效果。', 'SSE完整回执落盘后再交给SDK，尚非逐token展示。', '工具全部拒绝；Windows生产执行隔离、素材音频桥接和发行接线尚未验收。'], runs };
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report));
