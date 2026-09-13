import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { directorVisualCutTimes, evaluateDirectorVisualContinuity, productionVisualContinuityEvidenceSchema, visualCutFrameIndices, type ProductionVisualContinuityEvidence } from '../src/shared/production-visual-continuity';
import { resolveProductionQualityRecheckScope } from '../src/shared/production-quality-recheck';

const scenes = [1, 2, 3].map(id => ({ id: `shot-${id}`, durationMs: 2000 }));
function fixture(count = 3): ProductionVisualContinuityEvidence {
  return { version: 1, fps: 24, status: 'ok', cuts: Array.from({ length: count - 1 }, (_, i) => ({
    atMs: (i + 1) * 2000,
    frames: visualCutFrameIndices((i + 1) * 2000).map(index => ({ index, timeMs: index * 1000 / 24,
      lumaMean: 80, lumaMin: 50, lumaMax: 120, blackPercent: 0 })) as ProductionVisualContinuityEvidence['cuts'][number]['frames'],
  })) };
}

describe('decoded visual cut evidence', () => {
  it('accepts normal hard cuts without claiming semantic continuity', () => {
    const evidence = fixture();
    evidence.cuts[0].frames.slice(2).forEach(frame => Object.assign(frame, { lumaMin: 210, lumaMean: 220, lumaMax: 230 }));
    expect(evaluateDirectorVisualContinuity(scenes, evidence)).toMatchObject({ status: 'passed', detail: expect.stringContaining('待人工复核') });
    expect(evaluateDirectorVisualContinuity(scenes, undefined).status).toBe('pending');
    expect(evaluateDirectorVisualContinuity(scenes.slice(0, 1), undefined).detail).toContain('不适用');
  });

  it.each(['missing', 'extra', 'duplicate', 'reordered', 'timestamp', 'nan', 'infinity', 'range', 'frame-count', 'index', 'fps', 'failed', 'unavailable'] as const)('does not pass %s evidence', cause => {
    const evidence = fixture();
    if (cause === 'missing') evidence.cuts.pop();
    if (cause === 'extra') evidence.cuts.push(structuredClone(evidence.cuts[0]));
    if (cause === 'duplicate') evidence.cuts[1] = structuredClone(evidence.cuts[0]);
    if (cause === 'reordered') evidence.cuts.reverse();
    if (cause === 'timestamp') evidence.cuts[0].frames[0].timeMs += 10;
    if (cause === 'nan') evidence.cuts[0].frames[0].lumaMean = NaN;
    if (cause === 'infinity') evidence.cuts[0].frames[0].timeMs = Infinity;
    if (cause === 'range') evidence.cuts[0].frames[0].blackPercent = 101;
    if (cause === 'frame-count') evidence.cuts[0].frames.pop();
    if (cause === 'index') evidence.cuts[0].frames[0].index += 1;
    if (cause === 'fps') evidence.fps = 30;
    if (cause === 'failed' || cause === 'unavailable') evidence.status = cause;
    expect(evaluateDirectorVisualContinuity(scenes, evidence).status).not.toBe('passed');
  });

  it('locates only affected shots and actual sample times, with warnings for darkness and flashes', () => {
    const evidence = fixture();
    Object.assign(evidence.cuts[1].frames[2], { blackPercent: 100, lumaMin: 16, lumaMean: 16, lumaMax: 16 });
    Object.assign(evidence.cuts[1].frames[3], { lumaMin: 230, lumaMean: 235, lumaMax: 235 });
    const check = evaluateDirectorVisualContinuity(scenes, evidence);
    expect(check).toMatchObject({ status: 'failed', severity: 'warning', recheckScope: { kind: 'media', shotIds: ['shot-2', 'shot-3'] } });
    expect(check.detail).toContain('近黑画面');
    expect(check.detail).toContain('亮度突变');
    const plan = resolveProductionQualityRecheckScope(check.recheckScope!, scenes.map((scene, i) => ({ ...scene, startMs: i * 2000 })));
    expect(plan).toMatchObject({ primaryShotId: 'shot-2', seekMs: evidence.cuts[1].frames[0].timeMs });
  });

  it('flags a same-luma pixel-motion jump without calling a normal cut semantic failure', () => {
    const evidence = fixture();
    evidence.version = 2;
    evidence.cuts.forEach(cut => cut.frames.slice(1).forEach(frame => { frame.lumaMeanAbsoluteDelta = 1; }));
    evidence.cuts[0].frames[1].lumaMeanAbsoluteDelta = 55;
    evidence.cuts[0].frames[2].lumaMeanAbsoluteDelta = 120;
    evidence.cuts[0].frames[3].lumaMeanAbsoluteDelta = 8;
    const check = evaluateDirectorVisualContinuity(scenes, evidence);
    expect(check.status).toBe('failed');
    expect(check.detail).toContain('像素运动突变');
    expect(check.detail).toContain('需复核');
  });

  it('keeps version-two evidence pending when a neighboring frame delta is absent', () => {
    const evidence = fixture();
    evidence.version = 2;
    evidence.cuts[0].frames[1].lumaMeanAbsoluteDelta = 1;
    expect(evaluateDirectorVisualContinuity(scenes, evidence).status).toBe('pending');
  });

  it('uses the encoded clock including minimum and fractional scene durations', () => {
    expect(directorVisualCutTimes([{ durationMs: 200 }, { durationMs: 1201 }, { durationMs: 900 }])).toEqual([800, 2001]);
    expect(visualCutFrameIndices(2001)).toEqual([47, 48, 49, 50]);
  });

  it('round-trips 499 cuts and 500 affected shots through both document schemas', () => {
    const evidence = fixture(500);
    evidence.cuts.forEach(cut => { cut.frames[0].blackPercent = 100; });
    const shots = Array.from({ length: 500 }, (_, i) => ({ id: `shot-${i}`, durationMs: 2000 }));
    const check = evaluateDirectorVisualContinuity(shots, evidence);
    expect(check.recheckScope?.shotIds).toHaveLength(500);
    const now = '2026-09-09T00:00:00.000Z';
    for (const doc of [createEditorialCollageDraft({ id: 'v', title: 'VOX', now }), createMotionComicStarterProject(createMotionComicDraft({ id: 'm', title: 'Comic', premise: '', now }), 'Episode')]) {
      doc.qualityReports = [{ id: 'report', workflowKind: doc.workflowKind, stage: 'export', status: 'passed', checks: [check], evidence: { visualContinuity: evidence }, createdAt: now }];
      const parse = doc.workflowKind === 'editorial-collage' ? parseEditorialCollagePipelineData : parseMotionComicPipelineData;
      expect(parse(JSON.stringify(doc)).qualityReports[0].evidence?.visualContinuity).toEqual(evidence);
    }
    expect(productionVisualContinuityEvidenceSchema.safeParse(fixture(501)).success).toBe(false);
  });
});
