import { probeLemoAgentSdk } from './probe';
import { runLemoAgentSession, validateLemoSessionRequest } from './session';
import { LEMO_AGENT_HOST_TOOL_MAX_BYTES, validateLemoAgentHostToolResult,
  type LemoAgentHostToolRequest, type LemoAgentHostToolResult, type LemoAgentSessionRequest } from '../../src/shared/lemo-agent-session';

// Probe retains its single document at EOF. Sessions keep stdin open for
// matching cancellation and one exact host-tool result per pending operation.
let input = '';
let active: LemoAgentSessionRequest | undefined;
let started = false;
let protocolFailure: string | undefined;
let pending: { request: LemoAgentHostToolRequest; resolve(value: LemoAgentHostToolResult): void; reject(error: Error): void } | undefined;
const abort = new AbortController();
function output(value: unknown) { process.stdout.write(JSON.stringify(value) + '\n'); }
function rejectPending(code: string) { const current = pending; pending = undefined; current?.reject(new Error(code)); }
function stopProtocol(code: string) {
  protocolFailure ??= code;
  rejectPending(protocolFailure); abort.abort(); process.stdin.pause();
}
abort.signal.addEventListener('abort', () => rejectPending(protocolFailure ?? 'LEMO_SESSION_CANCELLED'));
function invokeHostTool(request: LemoAgentHostToolRequest): Promise<LemoAgentHostToolResult> {
  if (!active || active.capability !== 'film-authoring-v1' || abort.signal.aborted || pending
    || request.runId !== active.runId || request.stageId !== active.stageId) return Promise.reject(new Error('LEMO_SESSION_HOST_TOOL_STATE'));
  return new Promise((resolve, reject) => {
    pending = { request, resolve, reject };
    try { output({ hostTool: request }); } catch { stopProtocol('LEMO_SESSION_OUTPUT'); }
  });
}
async function dispatch(raw: unknown) {
  if (started) {
    const command = raw as Record<string, unknown>;
    if (!command || typeof command !== 'object' || Array.isArray(command) || command.version !== 1 || !active
      || command.runId !== active.runId || command.stageId !== active.stageId) { stopProtocol('LEMO_SESSION_INPUT_MISMATCH'); return; }
    if (command.action === 'cancel' && Object.keys(command).sort().join(',') === 'action,runId,stageId,version') { abort.abort(); return; }
    if (command.action !== 'host-tool-result' || Object.keys(command).sort().join(',') !== 'action,operationId,result,runId,stageId,version'
      || active.capability !== 'film-authoring-v1' || !pending || command.operationId !== pending.request.operationId) {
      stopProtocol('LEMO_SESSION_HOST_RESULT_MISMATCH'); return;
    }
    try {
      const result = validateLemoAgentHostToolResult(command.result);
      const current = pending; pending = undefined; current.resolve(result);
    } catch { stopProtocol('LEMO_SESSION_HOST_RESULT'); }
    return;
  }
  started = true;
  try {
    if ((raw as { action?: unknown })?.action === 'probe') {
      const result = await probeLemoAgentSdk(raw);
      if (protocolFailure) throw new Error(protocolFailure);
      output({ ok: true, result });
    } else {
      active = validateLemoSessionRequest(raw);
      const result = await runLemoAgentSession(active, { signal: abort.signal, invokeHostTool,
        onEvent: event => { output({ event }); } });
      if (protocolFailure) throw new Error(protocolFailure);
      output({ ok: true, result });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    output({ ok: false, code: protocolFailure ?? message.match(/^LEMO_[A-Z_]+/)?.[0] ?? 'LEMO_SESSION_FAILED' });
    process.exitCode = 1;
  } finally { rejectPending('LEMO_SESSION_CLOSED'); active = undefined; process.stdin.destroy(); }
}
function invalidInput(code: string) {
  stopProtocol(code);
  if (!started) { started = true; output({ ok: false, code }); process.exitCode = 1; process.stdin.destroy(); }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  for (;;) {
    const end = input.indexOf('\n'); if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    const limit = active?.capability === 'film-authoring-v1' ? LEMO_AGENT_HOST_TOOL_MAX_BYTES : 524288;
    if (Buffer.byteLength(line, 'utf8') > limit) { invalidInput('LEMO_SDK_INPUT_LIMIT'); return; }
    if (!line.trim()) continue;
    try { void dispatch(JSON.parse(line)); } catch { invalidInput('LEMO_SESSION_INPUT'); return; }
    if (protocolFailure) return;
  }
  const limit = active?.capability === 'film-authoring-v1' ? LEMO_AGENT_HOST_TOOL_MAX_BYTES : 524288;
  if (Buffer.byteLength(input, 'utf8') > limit) invalidInput('LEMO_SDK_INPUT_LIMIT');
});
process.stdin.on('end', () => {
  if (!started) {
    try {
      const raw = JSON.parse(input);
      if (raw?.action !== 'probe') { invalidInput('LEMO_SESSION_INPUT_CLOSED'); return; }
      void dispatch(raw);
    } catch { invalidInput('LEMO_SDK_REQUEST'); }
  } else if (active) stopProtocol('LEMO_SESSION_INPUT_CLOSED');
});
process.stdin.on('error', () => invalidInput('LEMO_SESSION_INPUT'));
process.stdout.on('error', () => stopProtocol('LEMO_SESSION_OUTPUT'));
