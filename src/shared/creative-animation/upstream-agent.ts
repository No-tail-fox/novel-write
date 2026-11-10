import { z } from 'zod';

export const LEMO_UPSTREAM_WORKFLOW = 3 as const;
/** Default (and historical hard) turn limit; old projects without a setting keep exactly this. */
export const LEMO_AGENT_MAX_TURNS = 64;
/** User-configurable bounds for the per-run turn limit (L-4). */
export const LEMO_AGENT_TURNS_MIN = 8;
export const LEMO_AGENT_TURNS_LIMIT = 160;
/** Optional cumulative model-token budget bounds (input + output, as reported by the provider). */
export const LEMO_AGENT_TOKENS_MIN = 50_000;
export const LEMO_AGENT_TOKENS_LIMIT = 50_000_000;
export function lemoAgentMaxTurns(value?: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(LEMO_AGENT_TURNS_LIMIT, Math.max(LEMO_AGENT_TURNS_MIN, Math.round(value))) : LEMO_AGENT_MAX_TURNS;
}
export function lemoAgentMaxTokens(value?: number | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(LEMO_AGENT_TOKENS_LIMIT, Math.max(LEMO_AGENT_TOKENS_MIN, Math.round(value))) : undefined;
}
export const lemoAgentUsageSchema = z.object({
  inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0),
  /** Turns whose provider response carried usage; turns without usage are not estimated. */
  reportedTurns: z.number().int().min(0),
}).strict();
export type LemoAgentUsage = z.infer<typeof lemoAgentUsageSchema>;
const tokens = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
/** Normalize OpenAI (prompt/completion), Responses/Anthropic (input/output + cache) usage. Undefined when absent. */
export function lemoUsageFromResponse(usage: Record<string, unknown> | undefined): { inputTokens: number; outputTokens: number } | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const input = tokens(usage.input_tokens) ?? tokens(usage.prompt_tokens);
  const output = tokens(usage.output_tokens) ?? tokens(usage.completion_tokens);
  if (input === undefined && output === undefined) return undefined;
  const cache = (tokens(usage.cache_creation_input_tokens) ?? 0) + (tokens(usage.cache_read_input_tokens) ?? 0);
  return { inputTokens: (input ?? 0) + cache, outputTokens: output ?? 0 };
}
export function addLemoAgentUsage(total: LemoAgentUsage | undefined, turn: { inputTokens: number; outputTokens: number }): LemoAgentUsage {
  return { inputTokens: (total?.inputTokens ?? 0) + turn.inputTokens, outputTokens: (total?.outputTokens ?? 0) + turn.outputTokens, reportedTurns: (total?.reportedTurns ?? 0) + 1 };
}
export const lemoAgentUsedTokens = (usage: LemoAgentUsage | undefined) => (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
export interface LemoAgentBudgetSettings { agentMaxTurns?: number; agentMaxTokens?: number }
/** Why an authoring (not ready) run may not buy another turn; undefined = may continue. */
export function lemoAgentBudgetExhausted(film: Pick<LemoUpstreamFilm, 'turn' | 'status' | 'usage'> | undefined, settings: LemoAgentBudgetSettings | undefined): 'turns' | 'tokens' | undefined {
  if (!film || film.status === 'ready') return undefined;
  if (film.turn >= lemoAgentMaxTurns(settings?.agentMaxTurns)) return 'turns';
  const maxTokens = lemoAgentMaxTokens(settings?.agentMaxTokens);
  return maxTokens !== undefined && lemoAgentUsedTokens(film.usage) >= maxTokens ? 'tokens' : undefined;
}
/** Resumable stop; the film-finalize step raises it instead of the generic LEMO_AGENT_NOT_READY. */
export function lemoAgentBudgetError(film: Pick<LemoUpstreamFilm, 'turn' | 'usage'>, settings: LemoAgentBudgetSettings | undefined, reason: 'turns' | 'tokens'): Error {
  const turns = `${film.turn} / ${lemoAgentMaxTurns(settings?.agentMaxTurns)} 轮`;
  return reason === 'turns'
    ? new Error(`LEMO_AGENT_TURN_LIMIT: Lemo Agent 已用完 ${turns}，影片尚未完成审片。工程和每轮回执都已保留；可在“自动制作设置”中调高“Agent 轮数上限”并保存，再点“重试失败步骤”从第 ${film.turn + 1} 轮继续。`)
    : new Error(`LEMO_AGENT_TOKEN_LIMIT: Lemo Agent 已用 ${lemoAgentUsedTokens(film.usage).toLocaleString('en-US')} tokens，达到预算 ${lemoAgentMaxTokens(settings?.agentMaxTokens)!.toLocaleString('en-US')}（${turns}），影片尚未完成审片。工程和回执已保留；可在“自动制作设置”中调高或清空“Token 预算”并保存，再点“重试失败步骤”继续。`);
}
export const lemoUpstreamFilmSchema = z.object({
  version: z.literal(1), runId: z.string().min(1), styleId: z.string().min(1),
  directory: z.string().min(1), turn: z.number().int().min(0).max(LEMO_AGENT_TURNS_LIMIT),
  status: z.enum(['authoring', 'ready']), sourceHash: z.string(),
  lastTool: z.string(), message: z.string().max(12000),
  review: z.object({ sourceHash: z.string(), technicalPassed: z.boolean(), frames: z.array(z.string()).max(8), durationSeconds: z.number().optional() }).optional(),
  visualReview: z.object({ sourceHash: z.string(), notes: z.string().min(20).max(8000), turn: z.number().int().positive() }).optional(),
  /** One asset thumbnail shown to the model on the turn after view_asset (multimodal input, not image generation). */
  assetPreview: z.object({ id: z.string().min(1).max(64), path: z.string().min(1) }).strict().optional(),
  /** Cumulative provider-reported model usage for this run (absent on old projects / providers without usage). */
  usage: lemoAgentUsageSchema.optional(),
}).strict();
export type LemoUpstreamFilm = z.infer<typeof lemoUpstreamFilmSchema>;
/** Progress line: "原生 Agent 第 N / M 轮 · 已用 X tokens（预算 Y）". Usage is provider-reported only; cost is not estimated. */
export function lemoAgentProgressText(film: Pick<LemoUpstreamFilm, 'turn' | 'status' | 'usage'> | undefined, settings: LemoAgentBudgetSettings | undefined): string {
  const maxTurns = lemoAgentMaxTurns(settings?.agentMaxTurns), maxTokens = lemoAgentMaxTokens(settings?.agentMaxTokens);
  const turn = film?.turn ?? 0;
  const parts = [`原生 Agent 第 ${turn} / ${maxTurns} 轮${film?.status === 'ready' ? '（已完成审片）' : ''}`];
  const used = lemoAgentUsedTokens(film?.usage);
  if (film?.usage) parts.push(`已用 ${used.toLocaleString('en-US')} tokens（输入 ${film.usage.inputTokens.toLocaleString('en-US')} / 输出 ${film.usage.outputTokens.toLocaleString('en-US')}${film.usage.reportedTurns < turn ? `；${turn - film.usage.reportedTurns} 轮服务商未返回用量` : ''}）`);
  else if (turn) parts.push('服务商未返回 token 用量');
  if (maxTokens !== undefined) parts.push(`Token 预算 ${maxTokens.toLocaleString('en-US')}`);
  return parts.join(' · ');
}

const path = z.string().min(1).max(512);
const actionSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('list_files'), scope: z.enum(['project', 'library']).default('project'), path: z.string().max(512).default('') }).strict(),
  z.object({ tool: z.literal('read_file'), scope: z.enum(['project', 'library']).default('project'), path, offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(60000).default(24000) }).strict(),
  z.object({ tool: z.literal('write_file'), path }).strict(),
  z.object({ tool: z.literal('replace_text'), path, before: z.string().min(1).max(100000), after: z.string().max(100000) }).strict(),
  z.object({ tool: z.literal('review_frames') }).strict(),
  z.object({ tool: z.literal('finish'), notes: z.string().min(20).max(8000) }).strict(),
  z.object({ tool: z.literal('view_asset'), id: z.string().min(1).max(64) }).strict(),
  z.object({ tool: z.literal('request_image'), id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), prompt: z.string().min(12).max(1500), transparent: z.boolean().default(false) }).strict(),
]);
export type LemoAgentAction = z.infer<typeof actionSchema> & { body?: string };

/** Only the small tool header is JSON. File bodies remain verbatim, without JSON escaping. */
export function parseLemoAgentAction(text: string): LemoAgentAction {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('LEMO_AGENT_EMPTY_RESPONSE: The parsed model reply contains no visible text. An empty reply alone does not establish a JSON/tool-schema incompatibility. Return one complete tool action.');
  const header = /```json\s*\r?\n([\s\S]*?)\r?\n```/i.exec(trimmed);
  const action = actionSchema.parse(JSON.parse(header ? header[1] : trimmed));
  if (action.tool !== 'write_file') return action;
  if (!header) throw new Error('LEMO_AGENT_BODY: write_file requires a separate fenced source body.');
  const rest = trimmed.slice(header.index + header[0].length).trim();
  const start = /^```[^\r\n]*\r?\n/.exec(rest);
  const end = rest.lastIndexOf('\n```');
  if (!start || end < start[0].length || rest.slice(end + 4).trim()) throw new Error('LEMO_AGENT_BODY: source fence is incomplete.');
  const body = rest.slice(start[0].length, end).replace(/\r$/, '');
  if (!body.trim()) throw new Error('LEMO_AGENT_BODY: empty source is not a file update.');
  return { ...action, body: body + '\n' };
}