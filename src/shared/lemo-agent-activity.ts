import type { VoxProductionRun } from './vox-production';
import { lemoAgentBudgetExhausted, lemoAgentMaxTurns, parseLemoAgentAction, type LemoUpstreamFilm } from './creative-animation/upstream-agent';

/**
 * Step count of a production run for progress labels.
 * A Lemo v3 (native Agent) run appends one `upstream-turn:N` node per finished turn while the film is still
 * authoring, so its node count grows. `max` is then the largest possible total (all non-turn steps plus the
 * per-run turn limit); it is absent once the total can no longer grow.
 */
export interface VoxProductionStepCount { completed: number; total: number; max?: number }
const isAgentTurn = (node: VoxProductionRun['nodes'][number]) => node.kind === 'film-edit' && node.id.startsWith('upstream-turn:');
export function voxProductionStepCount(run: VoxProductionRun, film?: Pick<LemoUpstreamFilm, 'runId' | 'turn' | 'status' | 'usage'>): VoxProductionStepCount {
  const completed = run.nodes.filter(node => node.status === 'completed').length;
  const total = run.nodes.length;
  if (run.authoringVersion !== 3 || ['completed', 'cancelled'].includes(run.status)) return { completed, total };
  const current = film?.runId === run.id ? film : undefined;
  if (current?.status === 'ready' || lemoAgentBudgetExhausted(current, run.settings)) return { completed, total };
  const turns = run.nodes.filter(isAgentTurn).length;
  const max = Math.max(total, total - turns + lemoAgentMaxTurns(run.settings.agentMaxTurns));
  return max > total ? { completed, total, max } : { completed, total };
}
/** "78" or "≤127" — the denominator shown next to completed/current steps. */
export const voxProductionStepTotalLabel = (count: Pick<VoxProductionStepCount, 'total' | 'max'>) => count.max ? `≤${count.max}` : String(count.total);

/** One finished Agent turn, summarized from journal.json for the process view (no file bodies). */
export interface LemoAgentTurnSummary {
  index: number;
  tool: string;
  /** File path, directory or asset id the action addressed. */
  target?: string;
  /** False when the host rejected the action (the Agent is told and corrects itself next turn). */
  ok: boolean;
  /** Short human-readable detail: rejection reason, finish notes, written size, review result. */
  detail?: string;
  /** review_frames only: captured frame image paths and whether the capture was technically clean. */
  frames?: string[];
  technicalPassed?: boolean;
}
export interface LemoAgentActivity {
  runId: string;
  /** Finished turns in order (oldest first); capped to the most recent LEMO_AGENT_ACTIVITY_LIMIT. */
  turns: LemoAgentTurnSummary[];
  totalTurns: number;
  /** The next turn already has a submitted request on disk (it may be in flight, or interrupted). */
  pending?: { index: number; phase: 'waiting-model' | 'applying'; startedAt?: string };
}
export const LEMO_AGENT_ACTIVITY_LIMIT = 200;

export const LEMO_AGENT_TOOL_LABELS: Record<string, string> = {
  list_files: '浏览目录', read_file: '阅读文件', write_file: '编写文件', replace_text: '修改文件',
  review_frames: '渲染抽帧检查', finish: '提交审片', view_asset: '查看素材', request_image: '申请插画', invalid_reply: '回复无法执行',
};
export const lemoAgentToolLabel = (tool: string) => LEMO_AGENT_TOOL_LABELS[tool] ?? tool;

const REJECTED = /^Tool rejected; no success claimed: ([\s\S]*?)(?:\. Read actual files and correct the next action\.)?$/u;
const clip = (text: string, limit = 400) => {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat;
};
function parseJson(text: string): Record<string, unknown> | undefined {
  try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; } catch { return undefined; }
}

/** Pure: turn one journal entry (model reply + host observation) into a display row. Never throws. */
export function summarizeLemoAgentTurn(turn: { index: number; reply: string; observation: string; tool: string }): LemoAgentTurnSummary {
  const summary: LemoAgentTurnSummary = { index: turn.index, tool: turn.tool || 'invalid_reply', ok: true };
  let action: ReturnType<typeof parseLemoAgentAction> | undefined;
  try { action = parseLemoAgentAction(turn.reply); } catch { /* invalid replies are explained by the observation */ }
  if (action) {
    if ('path' in action && typeof action.path === 'string' && action.path) summary.target = action.path;
    else if ('id' in action && typeof action.id === 'string') summary.target = action.id;
    if (action.tool === 'list_files' && !summary.target) summary.target = action.scope === 'library' ? 'Lemo 库' : '工程根目录';
    if (action.tool === 'list_files' || action.tool === 'read_file') summary.detail = action.scope === 'library' ? '来自 Lemo 风格库' : undefined;
    if (action.tool === 'request_image') summary.detail = clip(action.prompt, 200);
    if (action.tool === 'finish') summary.detail = clip(action.notes);
  }
  const rejected = REJECTED.exec(turn.observation.trim());
  if (summary.tool === 'invalid_reply') {
    // The model answered with prose (or a malformed action) instead of one tool call; its words are the useful part.
    summary.ok = false;
    const reason = rejected ? rejected[1] : turn.observation;
    if (/^\s*(?:\{|```)/u.test(turn.reply)) {
      summary.detail = /after JSON/u.test(reason) ? '动作格式无效：一次回复了多个动作或在动作后附带了文字' : `动作格式无效：${clip(reason, 200)}`;
      return summary;
    }
    const said = clip(turn.reply.replace(/```[\s\S]*?```/gu, ' '), 160);
    summary.detail = said ? `模型回复了文字而不是动作：${said}` : `回复格式无效：${clip(reason, 200)}`;
    return summary;
  }
  if (rejected) {
    summary.ok = false;
    summary.detail = clip(rejected[1]);
    return summary;
  }
  const observed = parseJson(turn.observation);
  if (summary.tool === 'write_file' && typeof observed?.bytes === 'number') summary.detail = `${(observed.bytes / 1024).toFixed(1)} KB`;
  if (summary.tool === 'review_frames' && observed) {
    const frames = Array.isArray(observed.frames) ? observed.frames.flatMap(frame => typeof (frame as { path?: unknown })?.path === 'string' ? [(frame as { path: string }).path] : []) : [];
    const errors = Array.isArray(observed.errors) ? observed.errors.length : 0;
    const missing = Array.isArray(observed.missingResources) ? observed.missingResources.length : 0;
    summary.frames = frames.slice(0, 8);
    summary.technicalPassed = observed.technicalPassed === true && observed.durationMatches !== false;
    summary.detail = summary.technicalPassed ? `技术检查通过 · ${frames.length} 帧`
      : [observed.durationMatches === false ? '时长不符' : '', errors ? `${errors} 个运行错误` : '', missing ? `${missing} 个资源缺失` : ''].filter(Boolean).join(' · ') || '技术检查未通过';
  }
  return summary;
}
