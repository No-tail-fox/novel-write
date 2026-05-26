import { describe, expect, it } from 'vitest';
import {
  buildCoverMetadata,
  buildImagePrompts,
  buildStoryPackage,
  buildStoryboardScenes,
  buildSubtitleTrack,
  normalizeSourceText,
  reviewSourceText,
  rewriteSourceText,
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

    expect(cover.title).toBe('武则天');
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

  it('builds a full story package', async () => {
    const result = await buildStoryPackage(sampleInput, {
      style: 'photo-real',
      ratio: '9:16',
    });

    expect(result.cover.title).toBe('武则天');
    expect(result.scenes).toHaveLength(11);
    expect(result.imagePrompts).toHaveLength(11);
    expect(result.rewrittenCopy).toContain('二圣');
  });
});
