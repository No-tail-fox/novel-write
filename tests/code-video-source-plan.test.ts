import { describe, expect, it } from 'vitest';
import { planCodeVideoSource, codeVideoSourcePreflightErrors } from '../src/shared/code-video-source-plan';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import { voxProductionInputErrors, voxProductionSettings } from '../src/shared/vox-production';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';

const policy = newCodeVideoPolicy();
function documentFor(text: string, durationMs?: number): EditorialCollagePipelineData {
  return { sourceText: text, beats: [{ subtitleCues: [{ id: 'cue', text }], shots: [{ id: 'shot', subtitleCueIds: ['cue'], ...(durationMs ? { voiceAssetVersionId: 'audio' } : {}) }] }], assets: durationMs ? [{ id: 'audio', kind: 'audio', durationMs }] : [] } as unknown as EditorialCollagePipelineData;
}
describe('code video source planning before voice', () => {
  it('defaults to sixty seconds and leaves short scripts intact', () => {
    expect(planCodeVideoSource('简短原稿。')).toMatchObject({ policy, requiresAction: false, segments: [{ text: '简短原稿。' }] });
  });
  it('preserves every character, whitespace and grapheme in deterministic bounded segments', () => {
    const source = '  原文带有数字42和限定。\r\n👨‍👩‍👧‍👦 Keep this evidence intact! '.repeat(40);
    for (const targetDurationSeconds of [30, 60, 90, 120, 180]) {
      const plan = planCodeVideoSource(source, { ...policy, targetDurationSeconds });
      expect(plan).toEqual(planCodeVideoSource(source, { ...policy, targetDurationSeconds }));
      expect(plan.segments.map(segment => segment.text).join('')).toBe(source);
      for (const segment of plan.segments) {
        expect(segment.text).toBe(source.slice(segment.start, segment.end));
        expect(segment.estimatedDurationMs).toBeLessThanOrEqual(targetDurationSeconds * 1000);
      }
    }
  });
  it('splits a long sentence without punctuation without losing its tail', () => {
    const source = '事实'.repeat(500);
    const plan = planCodeVideoSource(source);
    expect(plan.requiresAction).toBe(true);
    expect(plan.segments.length).toBeGreaterThan(1);
    expect(plan.segments.map(segment => segment.text).join('')).toBe(source);
  });
  it('requires review of a faithful summary without silently rewriting the original', () => {
    const source = '这是原始事实与限定。'.repeat(100);
    const plan = planCodeVideoSource(source, { ...policy, longTextMode: 'condense' });
    expect(plan.condenseInstructions).toContain('60 秒');
    expect(plan.condenseInstructions).toContain('不得编造事实');
    expect(plan.segments.map(segment => segment.text).join('')).toBe(source);
    expect(codeVideoSourcePreflightErrors(documentFor(source), plan.policy)[0]).toContain('重新创建、审核分镜');
  });
  it('enforces policy through the production gate with actionable split ranges', () => {
    const doc = documentFor('完整事实。'.repeat(200));
    const settings = { ...voxProductionSettings(), codeVideo: policy };
    expect(voxProductionInputErrors(doc, settings).join('\n')).toContain('第 1 段：原稿字符');
    expect(voxProductionInputErrors(doc, settings).join('\n')).toContain('不会自动创建多部影片');
    expect(codeVideoSourcePreflightErrors(doc)).toEqual([]);
    expect(voxProductionInputErrors(doc, { ...settings, narration: false })).toEqual([]);
  });
  it('uses measured audio ahead of heuristics and never truncates it', () => {
    const doc = documentFor('事实。'.repeat(300), 60_000);
    expect(codeVideoSourcePreflightErrors(doc, policy)).toEqual([]);
    doc.assets[0].durationMs = 66_001;
    expect(codeVideoSourcePreflightErrors(doc, policy)[0]).toContain('不会截断已有音频');
    expect(doc.assets[0].durationMs).toBe(66_001);
  });
  it('honors trimmed continuous audio without counting the shared file twice', () => {
    const doc = documentFor('事实。'.repeat(300), 120_000);
    doc.assets[0].localPath = 'voice.wav';
    doc.beats[0].shots.push({ ...doc.beats[0].shots[0], id: 'shot2' });
    doc.timeline = { durationMs: 60_000, clips: [], audioAssetVersionIds: ['audio'], audioClips: [
      { id: 'a', shotId: 'shot', assetVersionId: 'audio', trackType: 'narration', startMs: 0, sourceStartMs: 0, durationMs: 30_000 },
      { id: 'b', shotId: 'shot2', assetVersionId: 'audio', trackType: 'narration', startMs: 30_000, sourceStartMs: 30_000, durationMs: 30_000 },
    ] } as EditorialCollagePipelineData['timeline'];
    expect(codeVideoSourcePreflightErrors(doc, policy)).toEqual([]);
  });
  it('checks authored narration so a reviewed summary can retain its long source', () => {
    const doc = documentFor('简短且已审核的摘要。');
    doc.sourceText = '原始文案。'.repeat(300);
    expect(codeVideoSourcePreflightErrors(doc, { ...policy, longTextMode: 'condense' })).toEqual([]);
  });
});
