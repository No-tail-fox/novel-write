import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { generateText, tool, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { LEMO_NATIVE_AGENT_VERSION, type LemoAgentHostToolRequest, type LemoAgentHostToolResult, type LemoAgentSessionEvent, type LemoAgentSessionReceipt, type LemoAgentSessionRequest } from '../../src/shared/lemo-agent-session';
import { prepareLemoStateDirectory } from './paths';
import { rejectLedgerLinks } from './ledger-owner';
import { verifyPinnedLemoPlugin } from './policy';
import { LemoStageStore } from './stage-store';
import { createLemoCreativeTools } from './creative-tools';
import { createLemoProductionTools } from './production-tools';
import { artifactPaths } from './session';

interface Transcript {
  version: 1; backend: typeof LEMO_NATIVE_AGENT_VERSION; protocol: 'openai' | 'responses';
  configFingerprint: string; inputFingerprint: string; sessionId: string; turns: number;
  phase: 'ready' | 'request-pending' | 'tools-pending'; messages: ModelMessage[];
  review: { assistantTurn: number; reviewedAt?: number };
}
const transcriptLimit = 64 * 1024 * 1024;
async function loadTranscript(file: string, request: LemoAgentSessionRequest, sessionId: string): Promise<Transcript> {
  await rejectLedgerLinks(file); const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > transcriptLimit) throw new Error('LEMO_NATIVE_TRANSCRIPT');
  const value = JSON.parse(await readFile(file, 'utf8')) as Transcript;
  if (value.version !== 1 || value.backend !== LEMO_NATIVE_AGENT_VERSION || value.protocol !== request.protocol || value.sessionId !== sessionId
    || value.configFingerprint !== request.configFingerprint || value.inputFingerprint !== request.inputFingerprint
    || value.phase !== 'ready' || !Number.isSafeInteger(value.turns) || value.turns < 0 || value.turns > 1000
    || !Array.isArray(value.messages) || value.messages.length > 10000 || value.messages.some(m => !m || !['user', 'assistant', 'tool'].includes(m.role)
      || (typeof m.content !== 'string' && !Array.isArray(m.content)))) throw new Error('LEMO_NATIVE_RESUME_BLOCKED');
  return value;
}
async function saveTranscript(file: string, value: Transcript) {
  await rejectLedgerLinks(file);
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > transcriptLimit) throw new Error('LEMO_NATIVE_CONTEXT_LIMIT');
  const temporary = file + '.' + randomUUID() + '.pending'; const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rejectLedgerLinks(file); await rename(temporary, file);
}

/** AI SDK owns wire conversion. The host owns each persisted turn and tool dispatch.
 * No automatic execute callbacks: a fully validated, durable gateway receipt and
 * transcript must exist before any tool can change project files. */
export async function runLemoNativeSession(request: LemoAgentSessionRequest, options: {
  signal?: AbortSignal; onEvent?: (event: LemoAgentSessionEvent) => void | Promise<void>;
  invokeHostTool?: (request: LemoAgentHostToolRequest) => Promise<LemoAgentHostToolResult>;
} = {}): Promise<LemoAgentSessionReceipt> {
  if (!request.protocol || request.maxBudgetUsd !== undefined) throw new Error('LEMO_NATIVE_REQUEST');
  if (request.capability && !options.invokeHostTool) throw new Error('LEMO_SESSION_HOST_TOOLS_REQUIRED');
  options.signal?.throwIfAborted();
  const plugin = await verifyPinnedLemoPlugin(request.upstreamRoot);
  const skill = await readFile(join(plugin, 'skills/lemo-opuscar/SKILL.md'), 'utf8');
  const stateRoot = await prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: request.runRoot, upstreamRoot: request.upstreamRoot }, 'sdk-state');
  const projectDirectory = join(stateRoot, 'project'); const transcriptFile = join(stateRoot, 'native-session.json');
  const store = await LemoStageStore.open({ directory: join(request.runRoot, 'stage'), projectDirectory, runId: request.runId, stageId: request.stageId,
    inputFingerprint: request.inputFingerprint, configFingerprint: request.configFingerprint });
  const abort = new AbortController(); const cancel = () => abort.abort(); options.signal?.addEventListener('abort', cancel, { once: true });
  const emit = (event: LemoAgentSessionEvent) => options.onEvent?.(event);
  let attempted = false; let terminal = false;
  try {
    if (options.signal?.aborted) abort.abort(); abort.signal.throwIfAborted();
    const sessionId = store.snapshot().sessionId ?? randomUUID();
    let transcript: Transcript;
    if (request.action === 'resume') transcript = await loadTranscript(transcriptFile, request, sessionId);
    else {
      try { await lstat(transcriptFile); throw new Error('LEMO_NATIVE_TRANSCRIPT_EXISTS'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      transcript = { version: 1, backend: LEMO_NATIVE_AGENT_VERSION, protocol: request.protocol, configFingerprint: request.configFingerprint,
        inputFingerprint: request.inputFingerprint, sessionId, turns: 0, phase: 'ready', messages: [{ role: 'user', content: request.prompt }], review: { assistantTurn: 0 } };
    }
    await store.startAttempt(request.action); attempted = true; await store.recordSession(sessionId);
    const onToolEvent = async (event: Parameters<typeof store.recordToolEvent>[0]) => {
      await store.recordToolEvent(event);
      await emit({ type: 'tool', runId: request.runId, stageId: request.stageId, operationId: event.operationId, tool: event.tool, phase: event.phase });
    };
    const creative = await createLemoCreativeTools({ workspaceRoot: projectDirectory, protectedRoots: [request.upstreamRoot], signal: abort.signal, onToolEvent });
    const production = request.capability ? await createLemoProductionTools({ upstreamRoot: request.upstreamRoot, runId: request.runId, stageId: request.stageId,
      signal: abort.signal, invokeHostTool: options.invokeHostTool!, onToolEvent, onFatal: () => abort.abort() }) : undefined;
    production?.restoreReviewState(transcript.review);
    type Definition = typeof creative.definitions[number] | NonNullable<typeof production>['definitions'][number];
    const definitions = new Map<string, Definition>([...creative.definitions.map(d => ['mcp__storydream__' + d.name, d] as const),
      ...(production?.definitions.map(d => ['mcp__storydream_film__' + d.name, d] as const) ?? [])]);
    const tools: ToolSet = Object.fromEntries([...definitions].map(([name, definition]) => [name, tool({
      description: definition.description, inputSchema: z.object(definition.inputSchema),
    })]));
    const provider = createOpenAI({ baseURL: request.gateway.baseUrl + '/v1', apiKey: request.gateway.token });
    const model = request.protocol === 'responses' ? provider.responses(request.model) : provider.chat(request.model);
    const system = 'You are the Lemo film authoring agent inside StoryDream. Use only the declared audited tools. Follow the stage brief and pinned creative guidance below. '
      + 'Do not run setup, shell commands, network requests or install dependencies. Dependencies, narration, audio, rendering and final MP4 export are host-owned. '
      + 'Tool names use the mcp__storydream__ and mcp__storydream_film__ prefixes. Read pinned DIRECTOR.md, TECHNIQUE.md and the selected style with read_library when available. '
      + 'For film stages, write original sources, call review_film, inspect its actual returned images in the NEXT assistant turn, repair and review if needed, then call finish_film alone with concrete visual findings. '
      + 'Never fabricate readiness, preview images or a completed render. File-only treatment stages do not have rendering tools. The stage brief overrides generic setup steps.\n\nPinned Lemo guidance:\n' + skill;
    await saveTranscript(transcriptFile, transcript);
    await emit({ type: 'session', runId: request.runId, stageId: request.stageId, sessionId });
    let completed = false; let subtype = 'error_max_turns';
    for (let turn = 0; turn < request.maxTurns; turn++) {
      abort.signal.throwIfAborted();
      transcript.phase = 'request-pending'; await saveTranscript(transcriptFile, transcript);
      const result = await generateText({ model, system, messages: transcript.messages, tools, maxOutputTokens: request.maxOutputTokens,
        maxRetries: 0, abortSignal: abort.signal, providerOptions: { openai: { store: false, parallelToolCalls: false,
          ...(request.protocol === 'responses' ? { include: ['reasoning.encrypted_content'] } : {}) } } });
      transcript.messages.push(...result.response.messages); transcript.turns++;
      if (!['stop', 'tool-calls'].includes(result.finishReason)) {
        transcript.phase = 'ready'; await saveTranscript(transcriptFile, transcript); subtype = 'error_output_incomplete'; break;
      }
      const calls = result.toolCalls;
      if (calls.length > 32 || new Set(calls.map(c => c.toolCallId)).size !== calls.length
        || (calls.some(c => c.toolName === 'mcp__storydream_film__finish_film') && calls.length !== 1)) throw new Error('LEMO_NATIVE_TOOL_BATCH');
      // Validate the entire batch before executing any member.
      const validated = calls.map(call => {
        const definition = definitions.get(call.toolName);
        if (!definition) throw new Error('LEMO_NATIVE_TOOL_DENIED');
        return { call, definition, input: z.object(definition.inputSchema).strict().parse(call.input) };
      });
      production?.noteAssistantTurn('native-' + transcript.turns);
      transcript.phase = 'tools-pending'; transcript.review = production?.reviewState() ?? transcript.review; await saveTranscript(transcriptFile, transcript);
      const results: Extract<ModelMessage, { role: 'tool' }>['content'] = [];
      const images: Array<{ type: 'image'; image: string; mediaType: string }> = [];
      for (const { call, definition, input } of validated) {
        abort.signal.throwIfAborted();
        const output = await definition.handler(input as never, { signal: abort.signal });
        if (store.snapshot().status === 'unknown' || store.snapshot().pendingToolOperations || abort.signal.aborted) throw new Error('LEMO_NATIVE_TOOL_UNRESOLVED');
        const text: string[] = [];
        for (const part of output.content) {
          if (part.type === 'text') text.push(part.text);
          else if (part.type === 'image') { images.push({ type: 'image', image: part.data, mediaType: part.mimeType }); text.push('Actual host image follows this tool batch in the next user message.'); }
          else throw new Error('LEMO_NATIVE_TOOL_CONTENT');
        }
        results.push({ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName,
          output: { type: output.isError ? 'error-text' : 'text', value: text.join('\n') } });
        if (call.toolName === 'mcp__storydream_film__finish_film' && !output.isError) completed = true;
      }
      if (results.length) transcript.messages.push({ role: 'tool', content: results });
      if (images.length) transcript.messages.push({ role: 'user', content: [{ type: 'text', text: 'Inspect these actual host-rendered images from the preceding tools before making any visual judgment or finishing the film.' }, ...images] });
      transcript.review = production?.reviewState() ?? transcript.review; transcript.phase = 'ready'; await saveTranscript(transcriptFile, transcript);
      if (!calls.length || completed) { completed = true; subtype = 'success'; break; }
    }
    const status = completed ? 'completed' : 'failed';
    const snapshot = await store.complete({ status, resultSubtype: subtype, ...(completed ? { artifacts: await artifactPaths(projectDirectory) } : {}) }); terminal = true;
    await emit({ type: 'result', runId: request.runId, stageId: request.stageId, status });
    return { version: 1, runId: request.runId, stageId: request.stageId, sessionId, status, resultSubtype: subtype,
      sdkVersion: LEMO_NATIVE_AGENT_VERSION, cliVersion: 'native', deliveryStatus: 'unverified', artifacts: snapshot.artifacts };
  } catch (error) {
    if (attempted && !terminal) await store.complete({ status: 'unknown' }).catch(() => {});
    const code = error instanceof Error ? error.message.match(/^LEMO_[A-Z_]+/)?.[0] : undefined;
    throw new Error(abort.signal.aborted ? 'LEMO_SESSION_CANCELLED' : code ?? 'LEMO_NATIVE_SESSION_FAILED');
  } finally { abort.abort(); options.signal?.removeEventListener('abort', cancel); await store.close(); }
}
