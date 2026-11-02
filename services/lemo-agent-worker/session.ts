import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { LEMO_AGENT_SDK_VERSION, LEMO_AGENT_SKILL_NAME } from '../../src/shared/lemo-agent-sdk';
import type { LemoAgentHostToolRequest, LemoAgentHostToolResult, LemoAgentSessionEvent, LemoAgentSessionReceipt, LemoAgentSessionRequest } from '../../src/shared/lemo-agent-session';
import { prepareLemoStateDirectory, validateProbeRequest } from './paths';
import { lemoWorkerEnvironment } from './environment';
import { disableLemoGlobalGitBash } from './windows-shell';
import { verifyLoadedLemoPlugin, verifyPinnedLemoPlugin } from './policy';
import { LemoStageStore } from './stage-store';
import { createLemoCreativeTools } from './creative-tools';
import { createLemoProductionTools } from './production-tools';

export function validateLemoSessionRequest(raw: unknown): LemoAgentSessionRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('LEMO_SESSION_REQUEST');
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).filter(key => !['capability', 'maxBudgetUsd', 'protocol'].includes(key)).sort().join(',') !== 'action,configFingerprint,gateway,inputFingerprint,maxOutputTokens,maxTurns,model,prompt,runId,runRoot,stageId,upstreamRoot,version'
    || (v.protocol !== undefined && !['openai', 'responses'].includes(String(v.protocol)))
    || (v.protocol !== undefined && v.maxBudgetUsd !== undefined)
    || (v.maxBudgetUsd !== undefined && (typeof v.maxBudgetUsd !== 'number' || !Number.isFinite(v.maxBudgetUsd) || v.maxBudgetUsd <= 0 || v.maxBudgetUsd > 1000))
    || (v.capability !== undefined && v.capability !== 'film-authoring-v1')
    || v.version !== 1 || !['start', 'resume'].includes(String(v.action))
    || ![v.runId, v.stageId].every(s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s))
    || ![v.inputFingerprint, v.configFingerprint].every(s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s))
    || typeof v.prompt !== 'string' || !v.prompt.trim() || Buffer.byteLength(v.prompt) > 262144
    || typeof v.model !== 'string' || !v.model.trim() || v.model.length > 200 || /[\r\n\x00]/.test(v.model)
    || !Number.isSafeInteger(v.maxOutputTokens) || (v.maxOutputTokens as number) < 1 || (v.maxOutputTokens as number) > 1000000
    || !Number.isSafeInteger(v.maxTurns) || (v.maxTurns as number) < 1 || (v.maxTurns as number) > 100) throw new Error('LEMO_SESSION_REQUEST');
  validateProbeRequest({ version: 1, action: 'probe', runRoot: v.runRoot, upstreamRoot: v.upstreamRoot });
  const gateway = v.gateway as Record<string, unknown> | null;
  if (!gateway || typeof gateway !== 'object' || Array.isArray(gateway)
    || Object.keys(gateway).sort().join(',') !== 'baseUrl,token'
    || typeof gateway.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(gateway.baseUrl)
    || Number(gateway.baseUrl.slice(gateway.baseUrl.lastIndexOf(':') + 1)) > 65535
    || typeof gateway.token !== 'string' || !/^[a-f0-9]{64}$/.test(gateway.token)) throw new Error('LEMO_SESSION_GATEWAY');
  return structuredClone(raw) as LemoAgentSessionRequest;
}

export async function artifactPaths(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, prefix: string) {
    for (const name of await readdir(directory)) {
      const file = join(directory, name); const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('LEMO_SESSION_ARTIFACT_LINK');
      if (info.isDirectory()) await walk(file, prefix + name + '/');
      else if (info.isFile() && info.nlink === 1) {
        found.push(prefix + name);
        if (found.length > 256) throw new Error('LEMO_SESSION_ARTIFACT_LIMIT');
      } else throw new Error('LEMO_SESSION_ARTIFACT_TYPE');
    }
  }
  await walk(root, ''); return found.sort();
}

/** Executes the official loop with persistent sessions and bounded, audited MCP tools.
 * This initial capability set authors files; it does not execute generated programs. */
export async function runLemoAgentSession(raw: unknown, options: {
  signal?: AbortSignal;
  onEvent?: (event: LemoAgentSessionEvent) => void | Promise<void>;
  invokeHostTool?: (request: LemoAgentHostToolRequest) => Promise<LemoAgentHostToolResult>;
} = {}): Promise<LemoAgentSessionReceipt> {
  const request = validateLemoSessionRequest(raw);
  if (request.protocol) return (await import('./native-session')).runLemoNativeSession(request, options);
  const filmCapability = request.capability === 'film-authoring-v1';
  if (filmCapability && !options.invokeHostTool) throw new Error('LEMO_SESSION_HOST_TOOLS_REQUIRED');
  if (options.signal?.aborted) throw new Error('LEMO_SESSION_CANCELLED');
  const pluginPath = await verifyPinnedLemoPlugin(request.upstreamRoot);
  const sdkEntry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
  if (JSON.parse(await readFile(join(dirname(sdkEntry), 'package.json'), 'utf8')).version !== LEMO_AGENT_SDK_VERSION) throw new Error('LEMO_SDK_VERSION_MISMATCH');
  const stateRoot = await prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: request.runRoot, upstreamRoot: request.upstreamRoot }, 'sdk-state');
  const projectDirectory = join(stateRoot, 'project');
  const store = await LemoStageStore.open({ directory: join(request.runRoot, 'stage'), projectDirectory,
    runId: request.runId, stageId: request.stageId, inputFingerprint: request.inputFingerprint, configFingerprint: request.configFingerprint });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let sdk: Query | undefined; let attempted = false; let terminal = false;
  let releasePrompt!: () => void;
  const promptReady = new Promise<void>(r => { releasePrompt = r; });
  let cliVersion = 'unreported';
  const emit = (event: LemoAgentSessionEvent) => options.onEvent?.(event);
  try {
    if (options.signal?.aborted) throw new Error('LEMO_SESSION_CANCELLED');
    await store.startAttempt(request.action); attempted = true;
    const sessionId = store.snapshot().sessionId ?? randomUUID();
    await store.recordSession(sessionId);
    const env = lemoWorkerEnvironment(process.env, stateRoot);
    env.ANTHROPIC_BASE_URL = request.gateway.baseUrl; env.ANTHROPIC_API_KEY = request.gateway.token;
    for (const tier of ['OPUS', 'SONNET', 'HAIKU']) env['ANTHROPIC_DEFAULT_' + tier + '_MODEL'] = request.model;
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(request.maxOutputTokens);
    await disableLemoGlobalGitBash(env, stateRoot);
    const creative = await createLemoCreativeTools({ workspaceRoot: projectDirectory, signal: abort.signal, protectedRoots: [request.upstreamRoot],
      onToolEvent: async event => {
        await store.recordToolEvent(event);
        await emit({ type: 'tool', runId: request.runId, stageId: request.stageId, operationId: event.operationId, tool: event.tool, phase: event.phase });
      } });
    const production = filmCapability ? await createLemoProductionTools({ upstreamRoot: request.upstreamRoot,
      runId: request.runId, stageId: request.stageId, signal: abort.signal, invokeHostTool: options.invokeHostTool!,
      onFatal: () => abort.abort(), onToolEvent: async event => {
        await store.recordToolEvent(event);
        await emit({ type: 'tool', runId: request.runId, stageId: request.stageId, operationId: event.operationId, tool: event.tool, phase: event.phase });
      } }) : undefined;
    const allowedToolNames = [...creative.allowedToolNames, ...(production?.allowedToolNames ?? [])];
    const allowedNames = new Set<string>(allowedToolNames);
    const permitted = (name: string, input: Record<string, unknown>) => allowedNames.has(name)
      || name === 'Skill' && input.skill === LEMO_AGENT_SKILL_NAME;
    async function* prompts(): AsyncGenerator<SDKUserMessage> {
      await promptReady;
      if (!abort.signal.aborted) yield { type: 'user', session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content: request.action === 'start' ? request.prompt :
        'Resume the same approved stage using the persisted conversation and existing project files. Inspect completed work before acting. Do not repeat completed tools or create a new run. Original stage brief: ' + request.prompt } };
    }
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    sdk = query({ prompt: prompts(), options: {
      cwd: projectDirectory, env, abortController: abort, settingSources: [], persistSession: true,
      ...(request.action === 'start' ? { sessionId } : { resume: sessionId }),
      permissionMode: 'default', allowDangerouslySkipPermissions: false,
      model: request.model, thinking: { type: 'disabled' }, maxTurns: request.maxTurns,
      ...(request.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: request.maxBudgetUsd }),
      tools: ['Skill'], skills: [LEMO_AGENT_SKILL_NAME], allowedTools: allowedToolNames,
      strictMcpConfig: true, mcpServers: { storydream: creative.server, ...(production ? { storydream_film: production.server } : {}) },
      canUseTool: async (name, input) => permitted(name, input) ? { behavior: 'allow', updatedInput: input } :
        { behavior: 'deny', message: 'Use the audited StoryDream project tools. Shell, network and generated-program execution are unavailable in this capability stage.' },
      hooks: { PreToolUse: [{ hooks: [async input => {
        const allow = 'tool_name' in input && 'tool_input' in input && permitted(input.tool_name, input.tool_input as Record<string, unknown>);
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: allow ? 'allow' : 'deny',
          permissionDecisionReason: allow ? 'Validated project capability.' : 'Tool outside the approved capability set.' } };
      }] }] },
      plugins: [{ type: 'local', path: pluginPath }], pluginDelivery: 'initialize',
      systemPrompt: { type: 'preset', preset: 'claude_code', append:
        'StoryDream host: create original project artifacts with the audited storydream MCP tools. The fixed original Lemo plugin is loaded. Dependencies are host-owned; do not run setup, install packages, execute generated scripts, access credentials, or bypass missing tools. Preserve approved narration and timing. '
        + (filmCapability
          ? 'The storydream_film MCP server provides read_library for hash-verified original DIRECTOR.md, TECHNIQUE.md, styles and core text; review_film asks the trusted host for actual current-source frame captures; finish_film asks the host to verify readiness. After writing film sources, call review_film and inspect the returned real images in a subsequent model turn. Repair problems and review again before finish_film; include concrete visual findings in notes. Never batch review and finish before you have received the images. Model prose, tool arguments and SDK completion cannot set ready or replace host validation. Do not execute rendering scripts or synthesize audio yourself; the host owns rendering, approved narration, subtitles and final audiovisual export.'
          : 'Rendering/audio are not enabled by these file capabilities; do not claim a film is rendered.') },
    } });
    const init = await sdk.initializationResult(); cliVersion = init.claude_code_version ?? 'unreported';
    verifyLoadedLemoPlugin(await sdk.reloadPlugins(), pluginPath);
    await emit({ type: 'session', runId: request.runId, stageId: request.stageId, sessionId });
    releasePrompt();
    let result: { subtype: string; is_error: boolean; estimatedCostUsd?: number } | undefined;
    try {
      for await (const item of sdk) {
        if ('session_id' in item && item.session_id && item.session_id !== sessionId) throw new Error('LEMO_SESSION_ID_MISMATCH');
        if (item.type === 'assistant' && !item.parent_tool_use_id) production?.noteAssistantTurn(item.message.id ?? item.uuid);
        if (item.type === 'result') result = { subtype: item.subtype, is_error: item.is_error,
          ...(Number.isFinite(item.total_cost_usd) && item.total_cost_usd >= 0 ? { estimatedCostUsd: item.total_cost_usd } : {}) };
      }
    } catch (error) {
      // The CLI may exit nonzero after delivering a valid bounded-stop result.
      // Only that explicit resumable result is accepted; transport/unknown errors remain blocked.
      if (!result?.is_error || !['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'].includes(result.subtype)) throw error;
    }
    const status = abort.signal.aborted ? 'cancelled' : result ? result.is_error ? 'failed' : 'completed' : 'unknown';
    const snapshot = await store.complete({ status, resultSubtype: result?.subtype,
      ...(status === 'completed' ? { artifacts: await artifactPaths(projectDirectory) } : {}) });
    terminal = true;
    await emit({ type: 'result', runId: request.runId, stageId: request.stageId, status });
    return { version: 1, runId: request.runId, stageId: request.stageId, sessionId, status, resultSubtype: result?.subtype,
      ...(result?.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: result.estimatedCostUsd }),
      sdkVersion: LEMO_AGENT_SDK_VERSION, cliVersion, deliveryStatus: 'unverified', artifacts: snapshot.artifacts };
  } catch (error) {
    if (attempted && !terminal) {
      const status = abort.signal.aborted && store.snapshot().pendingToolOperations === 0 ? 'cancelled' : 'unknown';
      await store.complete({ status }).catch(() => {});
    }
    const code = error instanceof Error ? error.message.match(/^LEMO_[A-Z_]+/)?.[0] : undefined;
    throw new Error(abort.signal.aborted ? 'LEMO_SESSION_CANCELLED' : code ?? 'LEMO_SESSION_FAILED');
  } finally {
    releasePrompt(); sdk?.close(); abort.abort(); options.signal?.removeEventListener('abort', cancel);
    await store.close();
  }
}
