import { z } from 'zod';
import { motionComicScriptDraftSchema, motionComicPlanAdjustmentSchema, motionComicPlanningIssueSchema, motionComicPlanDraftSchema } from './motion-comic-planning';

export const MOTION_COMIC_SCRIPT_PROMPT_VERSION = 'novel-script-batch-v1';
const id = z.string().trim().min(1).max(256);
const timestamp = z.string().datetime();
export const motionComicScriptStatusSchema = z.enum(['queued', 'running', 'script-ready', 'review', 'approved', 'failed', 'cancelled', 'stale']);
export type MotionComicScriptStatus = z.infer<typeof motionComicScriptStatusSchema>;
export const motionComicScriptTaskSchema = z.object({
  id, projectId: id, sourceEpisodeId: id, status: motionComicScriptStatusSchema,
  inputFingerprint: id, seriesBibleVersion: id, previousStateVersion: id,
  bibleAssetIds: z.object({ characters: z.array(id), looks: z.array(id).optional(), sceneAssets: z.array(id), props: z.array(id) }).optional(),
  provider: id, model: id, promptVersion: id,
  instructions: z.string().max(4_000), targetDurationSec: z.number().min(5).max(1_800).optional(),
  outputRevision: z.number().int().nonnegative(), attempt: z.number().int().nonnegative(),
  progress: z.number().min(0).max(100),
  checkpoint: z.enum(['source', 'script', 'validate']).optional(),
  storyboardStatus: z.enum(['running', 'ready', 'failed']).optional(),
  storyboardError: z.string().max(8_000).optional(),
  error: z.string().max(8_000).optional(), createdAt: timestamp, updatedAt: timestamp,
}).strict();
export type MotionComicScriptTask = z.infer<typeof motionComicScriptTaskSchema>;
export const motionComicScriptCandidateSchema = z.object({
  taskId: id, outputRevision: z.number().int().positive(), script: motionComicScriptDraftSchema,
  adjustments: z.array(motionComicPlanAdjustmentSchema).max(20_000),
  issues: z.array(motionComicPlanningIssueSchema).max(500),
  origin: z.enum(['model', 'human']), createdAt: timestamp,
}).strict();
export type MotionComicScriptCandidate = z.infer<typeof motionComicScriptCandidateSchema>;
export const motionComicScriptApprovalSchema = z.object({
  sourceEpisodeId: id, taskId: id, outputRevision: z.number().int().positive(),
  inputFingerprint: id, script: motionComicScriptDraftSchema, model: id,
  instructions: z.string().max(4_000), targetDurationSec: z.number().min(5).max(1_800).optional(),
  approvedAt: timestamp, assetsConfirmedAt: timestamp.optional(), stale: z.boolean().default(false),
}).strict();
export type MotionComicScriptApproval = z.infer<typeof motionComicScriptApprovalSchema>;
export const motionComicScriptStoryboardCandidateSchema = z.object({
  taskId: id, outputRevision: z.number().int().positive(), plan: motionComicPlanDraftSchema,
  warnings: z.array(z.string()).max(500),
}).strict();
export type MotionComicScriptStoryboard = z.infer<typeof motionComicScriptStoryboardCandidateSchema>;
export interface MotionComicScriptSnapshot {
  projectId: string;
  paused: boolean;
  tasks: MotionComicScriptTask[];
  candidates: MotionComicScriptCandidate[];
  approvals: MotionComicScriptApproval[];
  storyboards: MotionComicScriptStoryboard[];
}
export const motionComicScriptEnqueueSchema = z.object({
  id, expectedUpdatedAt: timestamp, scope: z.enum(['missing', 'selected', 'failed']),
  sourceEpisodeIds: z.array(id).min(1).max(1_000).optional(),
  instructions: z.string().trim().max(4_000).default(''),
  targetDurationSec: z.number().finite().min(5).max(1_800).optional(),
}).strict().refine((value) => value.scope !== 'selected' || Boolean(value.sourceEpisodeIds?.length), '请选择分集');
export type MotionComicScriptEnqueueInput = z.input<typeof motionComicScriptEnqueueSchema>;
export const motionComicScriptControlSchema = z.object({ id, action: z.enum(['pause', 'resume', 'cancel']), taskId: id.optional() }).strict()
  .refine((value) => value.action !== 'cancel' || Boolean(value.taskId), '取消需要任务编号');
export type MotionComicScriptControlInput = z.infer<typeof motionComicScriptControlSchema>;
export const motionComicScriptRevisionSchema = z.object({
  id, taskId: id, outputRevision: z.number().int().positive(), expectedUpdatedAt: timestamp,
}).strict();
export const motionComicScriptStoryboardSchema = motionComicScriptRevisionSchema;
export const motionComicScriptApplyStoryboardSchema = motionComicScriptRevisionSchema.extend({ reviewedAdjustments: z.boolean() });
export type MotionComicScriptRevisionInput = z.infer<typeof motionComicScriptRevisionSchema>;
export type MotionComicScriptApplyStoryboardInput = z.infer<typeof motionComicScriptApplyStoryboardSchema>;
export const motionComicScriptEditSchema = motionComicScriptRevisionSchema.extend({ script: motionComicScriptDraftSchema });
export type MotionComicScriptEditInput = z.infer<typeof motionComicScriptEditSchema>;
export const motionComicScriptApproveSchema = z.object({
  id, expectedUpdatedAt: timestamp,
  revisions: z.array(z.object({ taskId: id, outputRevision: z.number().int().positive() }).strict()).min(1).max(1_000),
}).strict();
export type MotionComicScriptApproveInput = z.infer<typeof motionComicScriptApproveSchema>;

const transitions: Record<MotionComicScriptStatus, readonly MotionComicScriptStatus[]> = {
  queued: ['running', 'cancelled', 'stale'],
  running: ['script-ready', 'review', 'failed', 'cancelled', 'stale', 'queued'],
  'script-ready': ['review', 'approved', 'stale', 'cancelled'],
  review: ['review', 'approved', 'stale', 'cancelled'],
  approved: ['stale'], failed: ['stale'], cancelled: ['stale'], stale: [],
};
export function assertMotionComicScriptTransition(from: MotionComicScriptStatus, to: MotionComicScriptStatus): void {
  if (!transitions[from].includes(to)) throw new Error(`MOTION_COMIC_SCRIPT_TRANSITION: ${from} → ${to}`);
}

export const motionComicScriptStatusLabel: Record<MotionComicScriptStatus, string> = {
  queued: '排队中', running: '生成中', 'script-ready': '待审核', review: '待修订 / 审核',
  approved: '已批准', failed: '失败', cancelled: '已取消', stale: '输入已变化',
};
