import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, editorialCollageCreateInputSchema, parseEditorialCollagePipelineData, validateEditorialCollagePipeline } from '../src/shared/editorial-collage';
import { EDITORIAL_MAX_SOURCE_LENGTH, editorialCueReadingMs, planEditorialScript, splitEditorialScriptText } from '../src/shared/editorial-script';

const now = '2026-09-08T00:00:00.000Z';
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });

describe('editorial full-text planning', () => {
  it.each([4000, 8000, 12000])('keeps all %s Chinese characters readable, owned and persistable', (length) => {
    const source = '完整事实需要保留上下文。'.repeat(Math.ceil(length / 12)).slice(0, length);
    const draft = createEditorialCollageDraft({ id: `long-${length}`, title: '全文', now });
    const document = createEditorialCollageStarterPlan(draft, source, now, 'auto');
    expect(document.sourceText).toBe(source);
    expect(document.beats.map((beat) => beat.narration).join('')).toBe(source);
    expect(document.beats.flatMap((beat) => beat.subtitleCues).map((cue) => cue.text).join('')).toBe(source);
    let cursor = 0;
    for (const beat of document.beats) {
      expect(beat.startMs).toBe(cursor);
      expect(beat.subtitleCues.length).toBeLessThanOrEqual(200);
      for (const shot of beat.shots) {
        expect(shot.durationMs).toBeGreaterThan(0);
        expect(shot.durationMs).toBeLessThanOrEqual(15000);
        expect(shot.subtitleCueIds.length).toBeLessThanOrEqual(100);
        expect(shot.camera[0]).toMatchObject({ atMs: 0, zoom: 1 });
        expect(shot.camera.at(-1)).toMatchObject({ atMs: shot.durationMs, zoom: 1.06 });
        const clip = document.timeline!.clips.find((item) => item.shotId === shot.id)!;
        expect(clip.startMs).toBe(cursor);
        for (const cueId of shot.subtitleCueIds) {
          const cue = beat.subtitleCues.find((item) => item.id === cueId)!;
          expect(cue.shotId).toBe(shot.id);
          expect(cue.startMs).toBeGreaterThanOrEqual(cursor);
          expect(cue.endMs).toBeLessThanOrEqual(cursor + shot.durationMs);
          expect(cue.endMs - cue.startMs).toBeGreaterThanOrEqual(editorialCueReadingMs(cue.text));
          expect([...graphemes.segment(cue.text.trim())].length).toBeLessThanOrEqual(18);
        }
        cursor += shot.durationMs;
      }
    }
    expect(document.timeline!.durationMs).toBe(cursor);
    expect(cursor).toBeGreaterThan(length * 200);
    expect(validateEditorialCollagePipeline(document)).toEqual([]);
    expect(parseEditorialCollagePipelineData(JSON.stringify(document))).toEqual(document);
    expect(draft.beats).toEqual([]);
  });

  it.each([15000, 30000, 60000] as const)('supports tiny and unbalanced text in the %s ms preset', (durationMs) => {
    for (const text of ['甲', 'a b', '钩子。背景。证据。结论。', '甲。乙。丙。' + '完整事实'.repeat(8)]) {
      const plan = planEditorialScript(text, durationMs);
      expect(plan.durationMs).toBe(durationMs);
      expect(plan.sourceGraphemeCount).toBeGreaterThan(0);
      expect(plan.minimumReadingCharsPerSecond).toBeGreaterThan(0);
      expect(plan.maximumCueCharsPerSecond).toBeGreaterThan(0);
      expect(plan.beats.map((beat) => beat.narration).join('')).toBe(text);
      expect(plan.beats.flatMap((beat) => beat.shots).every((shot) => shot.durationMs > 0 && shot.durationMs <= 15000)).toBe(true);
      const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'tiny', title: '短稿', now }), text, now, durationMs);
      expect(parseEditorialCollagePipelineData(document)).toEqual(document);
    }
  });

  it('preserves section roles when a long section spans multiple persisted beats', () => {
    const source = '完整事实需要保留上下文。'.repeat(1500);
    const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'multiple-parts', title: '多节拍', now }), source, now, 'auto');
    expect(document.beats.length).toBeGreaterThan(4);
    expect(document.beats.map((beat) => beat.narration).join('')).toBe(source);
    for (const beat of document.beats) {
      const subjectLayers = beat.shots.flatMap((shot) => shot.layers.filter((layer) => ['subject', 'archival'].includes(layer.kind)));
      expect(subjectLayers.every((layer) => layer.kind === (beat.title.startsWith('证据') ? 'archival' : 'subject'))).toBe(true);
      expect(beat.subtitleCues.length).toBeLessThanOrEqual(200);
    }
    expect(parseEditorialCollagePipelineData(document)).toEqual(document);
  });

  it('preserves original whitespace and complete normalized English and Unicode content', () => {
    const source = '  An opening statement.\n\nA cafe\u0301 with \u{1F469}\u200D\u{1F4BB} and 中文 has context.  A final statement.\r\n';
    const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'unicode', title: '原稿', now }), source, now, 'auto');
    expect(editorialCollageCreateInputSchema.parse({ title: '原稿', sourceText: source, durationMs: 'auto' }).sourceText).toBe(source);
    expect(parseEditorialCollagePipelineData(document).sourceText).toBe(source);
    expect(document.beats.map((beat) => beat.narration).join('')).toBe(source.replace(/\s+/gu, ' ').trim());
    const units = ['e\u0301', '\u{1F469}\u200D\u{1F4BB}', '\u{1F1E8}\u{1F1F3}'];
    for (const unit of units) {
      const chunks = splitEditorialScriptText(unit.repeat(40));
      expect(chunks.join('')).toBe(unit.repeat(40));
      expect(chunks.every((chunk) => [...graphemes.segment(chunk)].every((part) => part.segment === unit))).toBe(true);
    }
  });

  it('rejects unreadable fixed durations and capacity excess explicitly without truncation', () => {
    expect(() => planEditorialScript('完整事实'.repeat(1000), 60000)).toThrow('EDITORIAL_SCRIPT_TOO_FAST');
    expect(() => planEditorialScript('甲'.repeat(40000), 'auto')).toThrow('EDITORIAL_SCRIPT_CAPACITY');
    expect(() => planEditorialScript('。'.repeat(50000), 'auto')).toThrow('EDITORIAL_SCRIPT_CAPACITY');
    expect(() => planEditorialScript('甲'.repeat(EDITORIAL_MAX_SOURCE_LENGTH + 1), 'auto')).toThrow('EDITORIAL_SOURCE_TOO_LONG');
    expect(() => planEditorialScript('  \n ', 'auto')).toThrow('EDITORIAL_SOURCE_EMPTY');
    const maximumSource = '甲' + ' '.repeat(EDITORIAL_MAX_SOURCE_LENGTH - 1);
    const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'limit', title: '原稿', now }), maximumSource, now, 'auto');
    expect(parseEditorialCollagePipelineData(document).sourceText).toBe(maximumSource);
    expect(() => splitEditorialScriptText('甲', 0)).toThrow('Invalid subtitle width');
  });

  it('reports the minimum and per-cue reading speeds without changing full-text allocation', () => {
    const source = '城市里的公共生活开始改变。'.repeat(80);
    const plan = planEditorialScript(source, 'auto');
    expect(plan.sourceGraphemeCount).toBe([...graphemes.segment(source.replace(/\s+/gu, ' ').trim())].length);
    expect(plan.minimumReadingCharsPerSecond).toBeLessThan(6);
    expect(plan.maximumCueCharsPerSecond).toBeGreaterThanOrEqual(plan.minimumReadingCharsPerSecond);
    expect(plan.beats.flatMap((beat) => beat.narration).join('')).toBe(source);
  });
});
