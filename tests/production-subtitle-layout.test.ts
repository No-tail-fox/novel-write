import { describe, expect, it } from 'vitest';
import { evaluateDirectorSubtitleLayout, productionSubtitleLayoutEvidenceSchema, type ProductionSubtitleLayoutEvidence } from '../src/shared/production-subtitle-layout';

const canvas = { width: 1920, height: 1080 };
const scenes = [1, 2].map(index => ({ id: `shot-${index}`, index, durationMs: 3000, caption: '',
  subtitleCues: [{ id: `cue-${index}`, text: '字幕', startMs: 100, endMs: 2900 }] }));
function fixture(): ProductionSubtitleLayoutEvidence {
  return { version: 1, measuredAt: '2026-09-09T09:00:00.000Z', scenes: scenes.map((scene, index) => ({
    status: 'ok', shotId: scene.id, ...canvas, viewportWidth: 1920, viewportHeight: 1080, fontsReady: true,
    safeArea: { x: 96, y: 54, width: 1728, height: 972 }, titleBounds: { x: 600, y: 700, width: 720, height: 90 }, titleOutsideSafeArea: false,
    cues: [{ cueId: scene.subtitleCues[0].id, startMs: index * 3000 + 100, endMs: index * 3000 + 2900,
      bounds: { x: 154, y: 880, width: 1612, height: 130 }, textBounds: { x: 800, y: 910, width: 320, height: 65 },
      lineCount: 1, fontFamily: 'Microsoft YaHei', fontSize: 48, issues: [] }],
    visibilitySamples: [{ atMs: index * 3000 + 100, activeCueIds: [`cue-${index}`] }, { atMs: index * 3000 + 2900, activeCueIds: [] }],
  })) };
}

describe('measured subtitle layout policy', () => {
  it('accepts complete output measurements while leaving glyph coverage for manual review', () => {
    const checks = evaluateDirectorSubtitleLayout(scenes, fixture(), canvas);
    expect(checks[0]).toMatchObject({ status: 'passed', severity: 'manual' });
    expect(checks[0].detail).toContain('测量 2 句字幕');
    expect(checks[1]).toMatchObject({ status: 'pending', severity: 'manual' });
  });

  it('keeps layout coverage pending until a font engine verifies glyphs', () => {
    const evidence = fixture();
    evidence.scenes.forEach((scene) => {
      if (scene.status === 'ok') scene.cues[0].glyphCoverage = {
        status: 'ok', codePointCount: 2, renderedCodePointCount: 2, missingCodePoints: [],
        verification: 'layout-only',
      };
    });
    expect(evaluateDirectorSubtitleLayout(scenes, evidence, canvas)[1]).toMatchObject({ status: 'pending' });
    const second = evidence.scenes[1];
    if (second.status !== 'ok') throw new Error('Expected fixture');
    second.cues[0].glyphCoverage = { verification: 'font-engine', status: 'failed', codePointCount: 2, renderedCodePointCount: 1, missingCodePoints: ['幕'] };
    expect(evaluateDirectorSubtitleLayout(scenes, evidence, canvas)[1]).toMatchObject({ status: 'failed' });
  });

  it('passes when every measured cue has complete font-engine coverage', () => {
    const evidence = fixture();
    evidence.scenes.forEach((scene) => {
      if (scene.status !== 'ok') throw new Error('Expected fixture');
      scene.cues[0].glyphCoverage = {
        status: 'ok', codePointCount: 2, renderedCodePointCount: 2, missingCodePoints: [],
        verification: 'font-engine', fontFamilies: ['Microsoft YaHei'], glyphCount: 2,
      };
    });
    expect(evaluateDirectorSubtitleLayout(scenes, evidence, canvas)[1]).toMatchObject({ status: 'passed' });
  });

  it.each(['missing', 'failed', 'dimensions', 'clock', 'cue', 'duplicate', 'nonfinite'] as const)('never passes %s measurement evidence', cause => {
    const evidence = fixture();
    const second = evidence.scenes[1];
    if (second.status !== 'ok') throw new Error('Expected fixture');
    if (cause === 'missing') evidence.scenes.pop();
    if (cause === 'failed') evidence.scenes[1] = { status: 'failed', shotId: second.shotId, error: 'probe failed' };
    if (cause === 'dimensions') second.width = 1080;
    if (cause === 'clock') second.cues[0].startMs = 100;
    if (cause === 'cue') second.cues[0].cueId = 'deleted';
    if (cause === 'duplicate') second.shotId = scenes[0].id;
    if (cause === 'nonfinite') second.cues[0].bounds.x = NaN;
    expect(evaluateDirectorSubtitleLayout(scenes, evidence, canvas)[0].status).toBe('pending');
  });

  it('binds measured overflow, overlap and title failures to the affected shot and cue', () => {
    const evidence = fixture(); const second = evidence.scenes[1];
    if (second.status !== 'ok') throw new Error('Expected fixture');
    second.titleOutsideSafeArea = true;
    second.cues[0].lineCount = 5; second.cues[0].issues = ['too-many-lines', 'title-overlap', 'cue-overlap', 'outside-safe-area'];
    const check = evaluateDirectorSubtitleLayout(scenes, evidence, canvas)[0];
    expect(check).toMatchObject({ status: 'failed', recheckScope: { kind: 'subtitle', shotIds: ['shot-2'], cueIds: ['cue-2'] } });
    expect(check.detail).toContain('实测 5 行');
  });

  it('keeps absent evidence pending instead of passing short text, and flags replacement characters separately', () => {
    const checks = evaluateDirectorSubtitleLayout([{ ...scenes[0], subtitleCues: [{ ...scenes[0].subtitleCues[0], text: '\uFFFD' }] }], undefined, canvas);
    expect(checks[0].status).toBe('pending'); expect(checks[1].status).toBe('failed');
    expect(productionSubtitleLayoutEvidenceSchema.safeParse(fixture()).success).toBe(true);
  });

  it('keeps subtitle visibility pending when the output timeline reports the wrong active cue', () => {
    const evidence = fixture();
    const second = evidence.scenes[1];
    if (second.status !== 'ok' || !second.visibilitySamples) throw new Error('Expected fixture');
    second.visibilitySamples[0].activeCueIds = [];
    expect(evaluateDirectorSubtitleLayout(scenes, evidence, canvas).find(check => check.id === 'subtitle-visibility')).toMatchObject({ status: 'pending' });
  });
});
