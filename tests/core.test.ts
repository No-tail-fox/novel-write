import { describe, expect, it } from 'vitest';
import {
  buildCoverMetadata,
  buildImagePrompts,
  buildStoryPackage,
  buildStoryboardScenes,
  buildSubtitleTrack,
  normalizeStoryboardSceneLengths,
  normalizeSourceText,
  reviewSourceText,
  rewriteSourceText,
  splitCaptionLines,
} from '@shared/story';

const sampleInput =
  '武曌，通称武则天、武后，是中国历史上唯一的女皇帝。武则天十四岁入宫为唐太宗才人，历经十二年不得升迁。唐高宗时复为昭仪，通过废黜王皇后与萧淑妃，得以立为皇后。并尊号为天后，与唐高宗并称二圣。';

describe('story pipeline', () => {
  it('normalizes source text into stable paragraphs', () => {
    const normalized = normalizeSourceText(sampleInput);

    expect(normalized).toContain('武则天十四岁入宫为唐太宗才人');
    expect(normalized.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });

  it('reviews the source into a short factual brief', () => {
    const reviewed = reviewSourceText(sampleInput);

    expect(reviewed).toContain('又称武则天');
    expect(reviewed).toContain('二圣');
  });

  it('rewrites the source into a punchier narrative', () => {
    const rewritten = rewriteSourceText(sampleInput);

    expect(rewritten).toContain('唯一的女皇帝');
    expect(rewritten).toContain('低谷不等于结局');
  });

  it('builds a cover package from the rewritten copy', () => {
    const cover = buildCoverMetadata(sampleInput);

    expect(cover.title).toBe('被遗忘十二年后称帝');
    expect(cover.subtitle).toHaveLength(2);
    expect(cover.tags).toContain('#女皇');
  });

  it('splits the story into eleven storyboard scenes', () => {
    const scenes = buildStoryboardScenes(sampleInput, 'photo-real', '9:16');

    expect(scenes).toHaveLength(11);
    expect(scenes[0].cap).toContain('十四岁入宫');
    expect(scenes[10].descPrompt).toContain('写实彩色摄影');
  });

  it('builds image prompts with negative prompts', () => {
    const scenes = buildStoryboardScenes(sampleInput, 'black-white', '9:16');
    const prompts = buildImagePrompts(scenes, { style: 'black-white', ratio: '9:16', inputText: sampleInput });

    expect(prompts[0].negativePrompt).toContain('水印');
    expect(prompts[0].characterProfile).toContain('唐代女性');
  });

  it('builds subtitle cues from scenes', () => {
    const subtitles = buildSubtitleTrack([
      { id: 1, cap: '第一句', durationMs: 1200 },
      { id: 2, cap: '第二句', durationMs: 1400 },
    ]);

    expect(subtitles.srt).toContain('第一句');
    expect(subtitles.cues).toHaveLength(2);
  });

  it('splits scene captions into Storybound-style short display cues without losing text', () => {
    const cap = '公元649年唐太宗去世，武则天重新回到权力中心，她的人生从此彻底改变。';
    const subtitles = buildSubtitleTrack([{ id: 7, cap, durationMs: 7200 }], { maxCharsPerLine: 12 });

    expect(subtitles.cues.length).toBeGreaterThan(1);
    expect(subtitles.cues.every((cue) => Array.from(cue.text).length <= 12)).toBe(true);
    expect(subtitles.cues.every((cue) => cue.sceneId === 7)).toBe(true);
    expect(subtitles.cues.every((cue) => !cue.text.startsWith('的'))).toBe(true);
    expect(subtitles.cues.map((cue) => cue.text).join('')).toBe(cap.replace(/[\p{P}\s]+/gu, ''));
    expect(subtitles.cues.some((cue) => cue.text.includes('公元649年'))).toBe(true);
    expect(subtitles.cues[0].startMs).toBe(0);
    expect(subtitles.cues.at(-1)?.endMs).toBe(7200);
    expect(subtitles.cues.slice(1).every((cue, index) => cue.startMs === subtitles.cues[index].endMs)).toBe(true);
  });

  it('keeps semantic words and avoids lines beginning with 的', () => {
    const lines = splitCaptionLines('真正改变她命运的，反而是一次离开。', 8);

    expect(lines.every((line) => Array.from(line).length <= 8)).toBe(true);
    expect(lines.every((line) => !line.startsWith('的'))).toBe(true);
    expect(lines.join('')).toBe('真正改变她命运的反而是一次离开');
  });

  it('repairs storyboard scenes over 55 characters without changing the copy', () => {
    const cap = '她第一次走进宫门时还只有十四岁。那时没人知道这个沉默的才人会改变帝国。十二年后她离开宫廷，却也因此等来了真正改变命运的机会。';
    const scenes = normalizeStoryboardSceneLengths([{ id: 9, cap, descPrompt: cap, durationMs: 10000 }]);

    expect(scenes.length).toBeGreaterThan(1);
    expect(scenes.every((scene) => scene.cap.replace(/\s+/gu, '').length <= 55)).toBe(true);
    expect(scenes.map((scene) => scene.cap).join('').replace(/\s+/gu, '')).toBe(cap.replace(/\s+/gu, ''));
    expect(scenes.map((scene) => scene.id)).toEqual(scenes.map((_, index) => index + 1));
  });

  it('builds a full story package', async () => {
    const result = await buildStoryPackage(sampleInput, {
      style: 'photo-real',
      ratio: '9:16',
    });

    expect(result.cover.title).toBe('被遗忘十二年后称帝');
    expect(result.scenes).toHaveLength(11);
    expect(result.imagePrompts).toHaveLength(11);
    expect(result.rewrittenCopy).toContain('二圣');
  });
});
