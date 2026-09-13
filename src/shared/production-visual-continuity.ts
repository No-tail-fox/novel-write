import { z } from 'zod';
import type { ProductionQualityCheck } from './production-workflow';

export const DIRECTOR_VISUAL_FPS = 24;
export const MAX_VISUAL_CUTS = 499;
const luma = z.number().finite().min(0).max(255);
const frameSchema = z.object({
  index: z.number().int().nonnegative(),
  timeMs: z.number().finite().nonnegative(),
  lumaMean: luma, lumaMin: luma, lumaMax: luma,
  blackPercent: z.number().finite().min(0).max(100),
  lumaMeanAbsoluteDelta: luma.optional(),
}).strict().refine(frame => frame.lumaMin <= frame.lumaMean && frame.lumaMean <= frame.lumaMax, 'Invalid luminance range');

export const productionVisualContinuityEvidenceSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  fps: z.number().finite().positive().max(120),
  status: z.enum(['ok', 'failed', 'unavailable']),
  error: z.string().max(2000).optional(),
  cuts: z.array(z.object({
    atMs: z.number().finite().positive(),
    frames: z.tuple([frameSchema, frameSchema, frameSchema, frameSchema]),
  }).strict()).max(MAX_VISUAL_CUTS),
}).strict();

export type ProductionVisualContinuityEvidence = z.infer<typeof productionVisualContinuityEvidenceSchema>;
export type VisualCut = ProductionVisualContinuityEvidence['cuts'][number];

export function directorVisualCutTimes(scenes: readonly { durationMs: number }[]): number[] {
  let elapsed = 0;
  return scenes.slice(0, -1).map(scene => (elapsed += Math.max(800, scene.durationMs)));
}

export function visualCutFrameIndices(atMs: number, fps = DIRECTOR_VISUAL_FPS): number[] {
  const after = Math.ceil(atMs * fps / 1000 - 1e-7);
  return [after - 2, after - 1, after, after + 1];
}

export function visualCutIssues(cut: VisualCut): string[] {
  const issues: string[] = [];
  if (cut.frames.some(frame => frame.blackPercent >= 98)) issues.push('近黑画面');
  // Compare within each shot. A deliberate hard cut can change the entire image.
  if (Math.abs(cut.frames[0].lumaMean - cut.frames[1].lumaMean) > 80
    || Math.abs(cut.frames[2].lumaMean - cut.frames[3].lumaMean) > 80) issues.push('镜头内亮度突变');
  if ((cut.frames[1].lumaMeanAbsoluteDelta ?? 0) > 42 || (cut.frames[3].lumaMeanAbsoluteDelta ?? 0) > 42) issues.push('镜头内像素运动突变');
  return issues;
}

export function evaluateDirectorVisualContinuity(
  scenes: readonly { id: string; durationMs: number }[],
  evidence: ProductionVisualContinuityEvidence | undefined,
): ProductionQualityCheck {
  const base = { id: 'visual-continuity', label: '切点前后四帧画面采样', severity: 'warning' as const };
  const expected = directorVisualCutTimes(scenes);
  if (!expected.length) return { ...base, status: 'passed', detail: '当前成片没有镜头间切点，切点采样不适用。' };
  const pending = (status: 'failed' | 'pending', detail: string): ProductionQualityCheck => ({
    ...base, status, detail, recheckScope: { kind: 'media', startMs: Math.max(0, expected[0] - 100), endMs: expected.at(-1)! + 100 },
  });
  if (!evidence) return pending('pending', '尚未取得切点画面证据。');
  const parsed = productionVisualContinuityEvidenceSchema.safeParse(evidence);
  if (!parsed.success) return pending('failed', '切点帧证据不完整或数值无效。');
  if (evidence.status !== 'ok') return pending(evidence.status === 'failed' ? 'failed' : 'pending', `切点帧探测${evidence.status === 'failed' ? '失败' : '不可用'}：${evidence.error || '未取得证据'}`);
  if (evidence.fps !== DIRECTOR_VISUAL_FPS || evidence.cuts.length !== expected.length) return pending('failed', '切点数量或采样帧率与当前成片不一致。');
  const total = scenes.reduce((sum, scene) => sum + Math.max(800, scene.durationMs), 0);
  for (const [i, cut] of evidence.cuts.entries()) {
    const indices = visualCutFrameIndices(expected[i]);
    if (Math.abs(cut.atMs - expected[i]) > 0.01 || cut.frames.some((frame, j) =>
      frame.index !== indices[j] || Math.abs(frame.timeMs - indices[j] * 1000 / DIRECTOR_VISUAL_FPS) > 1 || frame.timeMs >= total)) {
      return pending('failed', '切点证据的实际帧时间与当前时间线不一致。');
    }
  }
  if (evidence.version === 2 && evidence.cuts.some(cut => cut.frames.some((frame, index) => index > 0 && frame.lumaMeanAbsoluteDelta === undefined))) {
    return pending('pending', '切点逐帧差证据不完整，尚未取得全部相邻帧指标。');
  }
  const affected = evidence.cuts.flatMap((cut, i) => {
    const issues = visualCutIssues(cut);
    return issues.length ? [{ cut, i, issues }] : [];
  });
  if (!affected.length) return { ...base, status: 'passed', detail: `${expected.length} 个切点采样未检出近黑画面、镜头内亮度突变或像素运动突变；人物与场景连续性待人工复核。` };
  const first = affected[0];
  return {
    ...base, status: 'failed',
    detail: `${affected.length} 个切点需复核：${affected.slice(0, 8).map(item => `${(item.cut.atMs / 1000).toFixed(3)} 秒（${item.issues.join('、')}）`).join('；')}${affected.length > 8 ? '；其余见切点证据' : ''}。`,
    recheckScope: {
      kind: 'media',
      shotIds: [...new Set(affected.flatMap(item => [scenes[item.i].id, scenes[item.i + 1].id]))],
      startMs: first.cut.frames[0].timeMs,
      endMs: Math.min(total, affected.at(-1)!.cut.frames[3].timeMs + 1000 / DIRECTOR_VISUAL_FPS),
    },
  };
}
