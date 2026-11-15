import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { LlmConfig } from '../src/shared/types';
import type { CodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import { createPiGatewayHost } from './pi-gateway-host';
import { startPiAgentProcess } from './pi-agent-process';
import { piLemoHostInstructions } from './pi-agent-instructions';
import { createPiToolRouter, type PiHostOperation } from './pi-agent-tool-router';
import type { PiModelCapabilities } from './pi-model-config';
import type { PiBudgetLimits } from './pi-agent-budget';

/** One host-owned gateway/session for a production run; never place stateRoot under projectRoot. */
export async function openPiFilmSession(options: {
  workerPath: string; projectRoot: string; libraryRoot: string; stateRoot: string; styleSlug: string;
  config: LlmConfig; capabilities: PiModelCapabilities; policy: CodeVideoPolicy;
  limits: PiBudgetLimits; pricing: { inputPerMillion: number; outputPerMillion: number };
  sessionFile?: string; operations: Readonly<Record<string, PiHostOperation>>; onEvent?(event: unknown): void;
  beforeSubmit?: () => void | Promise<void>;
  beforeTool?: () => void | Promise<void>;
}) {
  const [project, library] = await Promise.all([realpath(options.projectRoot), realpath(options.libraryRoot)]);
  await mkdir(options.stateRoot, { recursive: true });
  const state = await realpath(options.stateRoot);
  const isWithin = (root: string, file: string) => { const rel = relative(root, file); return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
  if (isWithin(project, state) || isWithin(library, state)) throw new Error('PI_STATE_ROOT_UNSAFE');
  const sessionDir = join(state, 'sessions'), home = join(state, 'home'), temp = join(state, 'temp');
  await Promise.all([sessionDir, home, temp].map(path => mkdir(path, { recursive: true })));
  let sessionFile: string | undefined;
  if (options.sessionFile) {
    sessionFile = await realpath(options.sessionFile);
    if (!isWithin(await realpath(sessionDir), sessionFile)) throw new Error('PI_SESSION_RESTORE_PATH');
  }
  const tools = createPiToolRouter({ projectRoot: project, libraryRoot: library, styleSlug: options.styleSlug,
    receiptDirectory: join(state, 'tools'), operations: options.operations, beforeTool: options.beforeTool });
  const gateway = await createPiGatewayHost({ directory: join(state, 'ledger'), config: options.config,
    capabilities: options.capabilities, limits: options.limits, pricing: options.pricing, beforeSubmit: options.beforeSubmit });
  let worker: ReturnType<typeof startPiAgentProcess>;
  try { worker = startPiAgentProcess({ workerPath: options.workerPath, cwd: project, home, temp,
    executeTool: tools.execute, onEvent: options.onEvent }); }
  catch (error) { await gateway.close(); throw error; }
  try {
    const started = await worker.start({ cwd: project, sessionDir, sessionFile,
      gatewayBaseUrl: gateway.model.baseUrl, gatewayToken: gateway.localToken,
      api: gateway.model.api, modelId: gateway.model.id, contextWindow: gateway.model.contextWindow,
      maxTokens: gateway.model.maxTokens, reasoning: gateway.model.reasoning, images: options.capabilities.images,
      systemPrompt: piLemoHostInstructions(options.policy), tools: tools.tools }, !!sessionFile);
    sessionFile = started.sessionFile;
  } catch (error) { worker.kill(); await gateway.close(); throw error; }
  return {
    sessionFile,
    prompt: worker.prompt,
    compact: worker.compact,
    abort: async () => { try { await worker.abort(); } finally { await gateway.close(); } },
    summary: gateway.summary,
    close: async () => { try { await worker.close(); } finally { await gateway.close(); } },
  };
}
