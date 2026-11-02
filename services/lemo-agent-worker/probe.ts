import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { LEMO_AGENT_SDK_VERSION, LEMO_AGENT_SKILL_NAME,
  type LemoAgentSdkProbeReceipt } from '../../src/shared/lemo-agent-sdk';
import { lemoWorkerEnvironment } from './environment';
import { prepareLemoStateDirectory, validateProbeRequest } from './paths';
import { disableLemoGlobalGitBash } from './windows-shell';
import { LEMO_SDK_UPSTREAM_REVISION, verifyPinnedLemoPlugin, verifyLoadedLemoPlugin } from './policy';

/** Starts the real official SDK, but deliberately never supplies a user/model prompt. */
export async function probeLemoAgentSdk(raw: unknown, timeoutMs = 45000): Promise<LemoAgentSdkProbeReceipt> {
  const request = validateProbeRequest(raw);
  const pluginPath = await verifyPinnedLemoPlugin(request.upstreamRoot);
  const stateRoot = await prepareLemoStateDirectory(request, 'sdk-state');
  const env = lemoWorkerEnvironment(process.env, stateRoot);
  const cwd = join(stateRoot, 'project');
  await disableLemoGlobalGitBash(env, stateRoot);
  let outboundRequestsBlocked = 0;
  // This local sink is never a forwarding proxy. Even accidental model requests cannot incur charges.
  const sink = createServer((_req, res) => {
    outboundRequestsBlocked++;
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'Offline SDK readiness check: model calls are prohibited.' } }));
  });
  await new Promise<void>((ok, fail) => { sink.once('error', fail); sink.listen(0, '127.0.0.1', () => { sink.off('error', fail); ok(); }); });
  const address = sink.address();
  if (!address || typeof address === 'string') throw new Error('LEMO_SDK_LOCAL_SINK');
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`;
  env.ANTHROPIC_API_KEY = 'storydream-offline-probe-not-a-real-key';
  const abort = new AbortController();
  let release!: () => void;
  const stopped = new Promise<void>(r => { release = r; });
  async function* noPrompt(): AsyncGenerator<SDKUserMessage> { await stopped; }
  let sdk: Query | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sdkEntry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
    const installed = JSON.parse(await readFile(join(dirname(sdkEntry), 'package.json'), 'utf8'));
    if (installed.version !== LEMO_AGENT_SDK_VERSION) throw new Error('LEMO_SDK_VERSION_MISMATCH');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    sdk = query({ prompt: noPrompt(), options: {
      cwd, env, abortController: abort, settingSources: [], persistSession: false,
      permissionMode: 'default', allowDangerouslySkipPermissions: false,
      tools: ['Skill'], skills: [LEMO_AGENT_SKILL_NAME], allowedTools: [],
      canUseTool: async () => ({ behavior: 'deny', message: 'Readiness check: tool execution is disabled.' }),
      hooks: { PreToolUse: [{ hooks: [async () => ({ hookSpecificOutput: {
        hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Readiness check only.',
      } })] }] },
      strictMcpConfig: true, mcpServers: {}, plugins: [{ type: 'local', path: pluginPath }],
      pluginDelivery: 'initialize', maxTurns: 1,
    } });
    const ready = async () => {
      const init = await sdk!.initializationResult();
      const snapshot = await sdk!.reloadPlugins();
      const plugin = verifyLoadedLemoPlugin(snapshot, pluginPath);
      if (outboundRequestsBlocked) throw new Error('LEMO_SDK_UNEXPECTED_MODEL_REQUEST');
      return { version: 1, status: 'runtime-ready', sdkVersion: LEMO_AGENT_SDK_VERSION,
        cliVersion: init.claude_code_version ?? 'unreported', upstreamRevision: LEMO_SDK_UPSTREAM_REVISION,
        plugin, skills: [LEMO_AGENT_SKILL_NAME], paidRequests: 0, outboundRequestsBlocked,
        productionReady: false, limitations: [
          '仅验证官方SDK和原插件加载；没有调用模型，也没有生成影片。',
          '真实Messages工具/图像/流式兼容、未知付费回执恢复和生产权限隔离仍需验收。',
          '独立进程与工作目录不是操作系统安全沙箱；尚未替换原生产工作流。',
        ] } satisfies LemoAgentSdkProbeReceipt;
    };
    return await Promise.race([ready(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('LEMO_SDK_INIT_TIMEOUT')), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
    release();
    sdk?.close();
    abort.abort();
    sink.closeAllConnections();
    await new Promise<void>(r => sink.close(() => r()));
  }
}
