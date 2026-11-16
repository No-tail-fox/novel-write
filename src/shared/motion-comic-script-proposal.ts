import { z } from 'zod';
import { motionComicScriptDraftSchema, type MotionComicScriptDraft } from './motion-comic-planning';

const key = z.string().trim().min(1).max(256);
/** Local edits target stable beat keys; proposals never mutate a saved script implicitly. */
export const motionComicScriptProposalSchema = z.object({
  id: key, projectId: key, taskId: key,
  baseRevision: z.number().int().positive(),
  inputFingerprint: key,
  sceneKey: key, beatKey: key,
  instruction: z.string().trim().min(1).max(4000),
  originalText: z.string().min(1).max(20000),
  proposedText: z.string().trim().min(1).max(20000).optional(),
  status: z.enum(['running', 'failed', 'ready', 'applied', 'reverted', 'dismissed', 'stale']),
  requestId: key, requestFingerprint: key,
  baseProjectUpdatedAt: z.string().datetime(), baseScriptHash: key,
  promptVersion: key, error: z.string().max(8000).optional(),
  appliedRevision: z.number().int().positive().optional(),
  appliedScriptHash: key.optional(),
  revertedRevision: z.number().int().positive().optional(),
  provider: key, model: key, createdAt: z.string().datetime(),
}).strict().refine(value => !['ready', 'applied', 'reverted'].includes(value.status) || Boolean(value.proposedText), '候选缺少修改文本');
export const motionComicScriptProposeSchema = z.object({
  id: key, taskId: key, outputRevision: z.number().int().positive(), expectedUpdatedAt: z.string().datetime(),
  sceneKey: key, beatKey: key, instruction: z.string().trim().min(1).max(4000), requestId: key,
}).strict();
export const motionComicScriptAdoptSchema = z.object({
  id: key, taskId: key, outputRevision: z.number().int().positive(), expectedUpdatedAt: z.string().datetime(), proposalId: key,
}).strict();
export type MotionComicScriptProposeInput = z.infer<typeof motionComicScriptProposeSchema>;
export type MotionComicScriptAdoptInput = z.infer<typeof motionComicScriptAdoptSchema>;
export const motionComicScriptRevertSchema = motionComicScriptAdoptSchema;
export type MotionComicScriptRevertInput = z.infer<typeof motionComicScriptRevertSchema>;
export const motionComicScriptOriginalSchema = z.object({
  taskId: key, outputRevision: z.number().int().positive(), script: motionComicScriptDraftSchema,
  createdAt: z.string().datetime(), provenance: z.literal('first-model-finish'),
}).strict();
export type MotionComicScriptOriginal = z.infer<typeof motionComicScriptOriginalSchema>;
export type MotionComicScriptProposal = z.infer<typeof motionComicScriptProposalSchema>;

export function applyMotionComicScriptProposal(script: MotionComicScriptDraft, proposal: MotionComicScriptProposal, context: {
  projectId: string; taskId: string; revision: number; inputFingerprint: string;
}): MotionComicScriptDraft {
  const parsed = motionComicScriptProposalSchema.parse(proposal);
  if (parsed.status !== 'ready') throw new Error('SCRIPT_PROPOSAL_NOT_READY: 候选已处理或过期。');
  if (parsed.projectId !== context.projectId || parsed.taskId !== context.taskId || parsed.baseRevision !== context.revision || parsed.inputFingerprint !== context.inputFingerprint) {
    throw new Error('SCRIPT_PROPOSAL_STALE: 剧本基准版本已变化，请重新生成修改候选。');
  }
  const scenes = script.scenes.filter(scene => scene.key === parsed.sceneKey);
  const beats = scenes.flatMap(scene => scene.beats.filter(beat => beat.key === parsed.beatKey));
  if (scenes.length !== 1 || beats.length !== 1 || beats[0].text !== parsed.originalText) {
    throw new Error('SCRIPT_PROPOSAL_TARGET_CHANGED: 目标段落已变化，候选未覆盖当前稿。');
  }
  const next = structuredClone(script);
  next.scenes.find(scene => scene.key === parsed.sceneKey)!.beats.find(beat => beat.key === parsed.beatKey)!.text = parsed.proposedText!;
  return motionComicScriptDraftSchema.parse(next);
}
