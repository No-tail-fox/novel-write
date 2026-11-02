import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { LEMO_NATIVE_AGENT_VERSION, validateLemoAgentHostToolResult, type LemoAgentHostToolRequest, type LemoAgentHostToolResult, type LemoAgentSessionEvent, type LemoAgentSessionReceipt, type LemoAgentSessionRequest } from '../src/shared/lemo-agent-session';
import { LEMO_AGENT_SDK_VERSION } from '../src/shared/lemo-agent-sdk';
import { LemoRequestLedger, requestFingerprint } from '../services/lemo-agent-worker/request-ledger';
import { startLemoMessagesGateway, type MessagesGatewayOptions } from '../services/lemo-agent-worker/messages-gateway';
import { prepareLemoStateDirectory } from '../services/lemo-agent-worker/paths';
import { lemoWorkerEnvironment } from '../services/lemo-agent-worker/environment';
import { stopWorkerTree } from './lemo-agent-runtime';
import { openLemoExecutionBudget } from './lemo-execution-budget';
import { openLemoNativeBudget } from './lemo-native-budget';

export interface OfficialLemoSessionOptions {
  action: 'start' | 'resume';
  nodeExecutable: string; workerPath: string; runRoot: string; upstreamRoot: string;
  runId: string; stageId: string; prompt: string;
  provider: MessagesGatewayOptions['provider'];
  maxOutputTokens: number; maxRequests: number; maxTurns: number;
  timeoutMs: number; requestTimeoutMs: number;
  maxEstimatedCostUsd?: number;
  maxRepairRounds?: number;
  /** All authoring stages of one film share the original ledger and budget. */
  executionRoot?: string;
  /** Offline fixtures only. Never inferred from a configured provider URL. */
  allowLoopbackTestProvider?: boolean;
  signal?: AbortSignal;
  capability?: 'film-authoring-v1';
  invokeHostTool?: (request: LemoAgentHostToolRequest, signal: AbortSignal) => Promise<LemoAgentHostToolResult>;
  onEvent?: (event: LemoAgentSessionEvent) => void;
}

export function lemoSessionFingerprints(options: OfficialLemoSessionOptions) {
  return { inputFingerprint: requestFingerprint({ runId: options.runId, stageId: options.stageId, prompt: options.prompt }),
    configFingerprint: requestFingerprint({ version: 1, capability: options.capability ?? 'audited-project-files-v1',
      ...(options.provider.protocol === 'anthropic' ? {} : { backend: LEMO_NATIVE_AGENT_VERSION }),
      provider: { ...options.provider, apiKey: createHash('sha256').update(options.provider.apiKey).digest('hex') },
      maxOutputTokens: options.maxOutputTokens, maxRequests: options.maxRequests, maxTurns: options.maxTurns,
      ...(options.maxEstimatedCostUsd === undefined ? {} : { maxEstimatedCostUsd: options.maxEstimatedCostUsd, timeoutMs: options.timeoutMs, maxRepairRounds: options.maxRepairRounds ?? 3 }) }) };
}

export function sessionTransport(options: OfficialLemoSessionOptions, request: LemoAgentSessionRequest, env: NodeJS.ProcessEnv) {
  return new Promise<LemoAgentSessionReceipt>((resolve, reject) => {
    const child = spawn(options.nodeExecutable, [options.workerPath], { cwd: options.runRoot, env, windowsHide: true, shell: false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let line = '', bytes = 0, settled = false, receipt: LemoAgentSessionReceipt | undefined, failure: string | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const hostAbort = new AbortController();
    const pending = new Set<Promise<void>>();
    const operationIds = new Set<string>();
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', cancel);
      hostAbort.abort();
      void (async () => {
        if (error) await stopWorkerTree(child);
        await Promise.allSettled([...pending]);
        if (error) reject(error); else resolve(receipt!);
      })().catch(reject);
    };
    const cancel = () => {
      if (settled || killTimer) return;
      failure = 'LEMO_SESSION_CANCELLED';
      hostAbort.abort();
      if (child.stdin.writable) child.stdin.write(JSON.stringify({ version: 1, action: 'cancel', runId: request.runId, stageId: request.stageId }) + '\n');
      killTimer = setTimeout(() => finish(new Error(failure)), 5000);
    };
    const timer = setTimeout(() => { cancel(); failure = 'LEMO_SESSION_TIMEOUT'; }, options.timeoutMs);
    const receive = (text: string) => {
      if (settled) return;
      let data: { hostTool?: LemoAgentHostToolRequest; event?: LemoAgentSessionEvent; ok?: boolean; code?: string; result?: LemoAgentSessionReceipt };
      try { data = JSON.parse(text); } catch { finish(new Error('LEMO_SESSION_WORKER_OUTPUT')); return; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) { finish(new Error('LEMO_SESSION_WORKER_OUTPUT')); return; }
      if (data.hostTool) {
        const h = data.hostTool;
        if (Object.keys(data).join(',') !== 'hostTool' || receipt || failure || pending.size || !options.invokeHostTool
          || request.capability !== 'film-authoring-v1' || h.version !== 1 || h.action !== 'host-tool'
          || h.runId !== request.runId || h.stageId !== request.stageId || typeof h.operationId !== 'string'
          || !/^[a-f0-9-]{36}$/.test(h.operationId) || operationIds.has(h.operationId) || operationIds.size >= 200
          || Object.keys(h).sort().join(',') !== 'action,input,operationId,runId,stageId,tool,version'
          || !['review_film', 'finish_film'].includes(h.tool) || !h.input || typeof h.input !== 'object' || Array.isArray(h.input)
          || (h.tool === 'review_film' ? Object.keys(h.input).length !== 0
            : Object.keys(h.input).join(',') !== 'notes' || typeof h.input.notes !== 'string' || h.input.notes.trim().length < 20 || h.input.notes.length > 8000)) {
          finish(new Error('LEMO_SESSION_HOST_REQUEST')); return;
        }
        operationIds.add(h.operationId);
        const task = (async () => {
          let result: LemoAgentHostToolResult;
          try { result = validateLemoAgentHostToolResult(await options.invokeHostTool!(h, hostAbort.signal)); }
          catch { result = { isError: true, sideEffectApplied: true, content: [{ type: 'text', text: 'LEMO_FILM_HOST_OPERATION_UNKNOWN' }] }; }
          if (settled || hostAbort.signal.aborted || !child.stdin.writable) return;
          child.stdin.write(JSON.stringify({ version: 1, action: 'host-tool-result', runId: request.runId, stageId: request.stageId, operationId: h.operationId, result }) + '\n');
        })();
        pending.add(task); void task.finally(() => pending.delete(task)).catch(() => finish(new Error('LEMO_SESSION_HOST_RESULT')));
        return;
      }
      if (data.event) {
        const event = data.event;
        if (event.runId !== request.runId || event.stageId !== request.stageId || !['session', 'tool', 'result'].includes(event.type)) { finish(new Error('LEMO_SESSION_WORKER_OUTPUT')); return; }
        try { options.onEvent?.(event); } catch { finish(new Error('LEMO_SESSION_EVENT_FAILED')); }
        return;
      }
      if (pending.size) { finish(new Error(failure ?? 'LEMO_SESSION_WORKER_OUTPUT')); return; }
      if (data.ok !== true) { failure ??= typeof data.code === 'string' && /^LEMO_[A-Z_]+$/.test(data.code) ? data.code : 'LEMO_SESSION_WORKER_FAILED'; return; }
      const r = data.result;
      if (pending.size || receipt || !r || r.version !== 1 || r.runId !== request.runId || r.stageId !== request.stageId
        || r.sdkVersion !== (request.protocol ? LEMO_NATIVE_AGENT_VERSION : LEMO_AGENT_SDK_VERSION) || typeof r.cliVersion !== 'string' || !/^[a-f0-9-]{36}$/.test(r.sessionId)
        || !['completed', 'failed', 'cancelled', 'unknown'].includes(r.status) || r.deliveryStatus !== 'unverified' || !Array.isArray(r.artifacts)) {
        finish(new Error('LEMO_SESSION_WORKER_OUTPUT')); return;
      }
      receipt = r; child.stdin.end();
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk); if (bytes > 1048576) { finish(new Error('LEMO_SESSION_WORKER_OUTPUT_LIMIT')); return; }
      line += chunk;
      for (;;) { const end = line.indexOf('\n'); if (end < 0) break; const value = line.slice(0, end); line = line.slice(end + 1); if (value.trim()) receive(value); }
    });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1048576) finish(new Error('LEMO_SESSION_WORKER_OUTPUT_LIMIT')); });
    child.on('error', () => finish(new Error('LEMO_SESSION_WORKER_START_FAILED')));
    child.stdin.on('error', () => { if (!receipt) finish(new Error('LEMO_SESSION_WORKER_INPUT_FAILED')); });
    child.on('close', code => { if (line.trim()) receive(line);
      finish(code !== 0 || failure || !receipt ? new Error(failure ?? 'LEMO_SESSION_WORKER_FAILED') : undefined); });
    options.signal?.addEventListener('abort', cancel, { once: true });
    child.stdin.write(JSON.stringify(request) + '\n');
    if (options.signal?.aborted) cancel();
  });
}

/** Host owns real credentials, ledger and cancellation. Unknown billing blocks resume
 * before starting any SDK process; a new session cannot bypass the original stage. */
export async function runOfficialLemoAgentSession(options: OfficialLemoSessionOptions) {
  options = { ...options, provider: { ...options.provider } };
  for (const path of [options.nodeExecutable, options.workerPath, options.runRoot, options.upstreamRoot])
    if (!isAbsolute(path)) throw new Error('LEMO_SESSION_ABSOLUTE_PATH_REQUIRED');
  if (!['start', 'resume'].includes(options.action) || ![options.runId, options.stageId].every(s => /^[a-zA-Z0-9_-]{1,100}$/.test(s))
    || ![options.maxRequests, options.timeoutMs, options.requestTimeoutMs].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('LEMO_SESSION_OPTIONS');
  if (options.signal?.aborted) throw new Error('LEMO_SESSION_CANCELLED');
  if (options.capability === 'film-authoring-v1' && !options.invokeHostTool) throw new Error('LEMO_SESSION_HOST_TOOLS_REQUIRED');
  const state = await prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: options.runRoot, upstreamRoot: options.upstreamRoot }, 'worker-state');
  const executionRoot = options.executionRoot ?? options.runRoot;
  if (!isAbsolute(executionRoot)) throw new Error('LEMO_SESSION_ABSOLUTE_PATH_REQUIRED');
  // Phased hosts initialize the one shared ledger/budget before any child stage.
  // A new stage is not a new allowance, including when the final film uses the root itself.
  const sharedExecution = options.executionRoot !== undefined;
  const ledger = await LemoRequestLedger.open(join(executionRoot, 'ledger'), options.maxRequests, { existingOnly: options.action === 'resume' || sharedExecution });
  let gateway: Awaited<ReturnType<typeof startLemoMessagesGateway>> | undefined;
  let closingGateway: Promise<void> | undefined;
  const closeGateway = () => closingGateway ??= gateway?.close() ?? Promise.resolve();
  const cancelGateway = () => { void closeGateway(); };
  try {
    if (ledger.summary().blocked) throw new Error('LEMO_LEDGER_BLOCKED');
    const native = options.provider.protocol !== 'anthropic';
    const nativeBudget = native ? await openLemoNativeBudget(executionRoot, { protocol: options.provider.protocol as 'openai' | 'responses',
      maxRequests: options.maxRequests, maxOutputTokens: options.maxOutputTokens, timeoutMs: options.timeoutMs }, options.action === 'resume' || sharedExecution || ledger.summary().requests > 0) : undefined;
    const budget = native || options.maxEstimatedCostUsd === undefined ? undefined : await openLemoExecutionBudget(executionRoot,
      { timeoutMs: options.timeoutMs, maxEstimatedCostUsd: options.maxEstimatedCostUsd }, options.action === 'resume' || sharedExecution || ledger.summary().requests > 0);
    gateway = await startLemoMessagesGateway({ ledger, provider: options.provider, maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.requestTimeoutMs, allowLoopbackTestProvider: options.allowLoopbackTestProvider,
      ...(options.capability === 'film-authoring-v1' ? { maxRequestBytes: 20 * 1024 * 1024 } : {}) });
    options.signal?.addEventListener('abort', cancelGateway, { once: true });
    if (options.signal?.aborted) { await closeGateway(); throw new Error('LEMO_SESSION_CANCELLED'); }
    const request: LemoAgentSessionRequest = { version: 1, action: options.action, runRoot: options.runRoot, upstreamRoot: options.upstreamRoot,
      ...(options.provider.protocol === 'anthropic' ? {} : { protocol: options.provider.protocol }),
      runId: options.runId, stageId: options.stageId, prompt: options.prompt, ...(options.capability ? { capability: options.capability } : {}), ...lemoSessionFingerprints(options),
      gateway: { baseUrl: gateway.baseUrl, token: gateway.localToken }, model: options.provider.model, maxOutputTokens: options.maxOutputTokens, maxTurns: options.maxTurns };
    const remaining = await budget?.claim(options.stageId);
    if (remaining) request.maxBudgetUsd = remaining.remainingCostUsd;
    const receipt = await sessionTransport({ ...options, timeoutMs: nativeBudget?.remainingMs ?? remaining?.remainingMs ?? options.timeoutMs }, request, lemoWorkerEnvironment(process.env, state));
    await budget?.settle(options.stageId, receipt.estimatedCostUsd);
    await closeGateway();
    return { receipt, ledger: gateway.summary() };
  } finally {
    options.signal?.removeEventListener('abort', cancelGateway);
    await closeGateway(); await ledger.close();
  }
}
