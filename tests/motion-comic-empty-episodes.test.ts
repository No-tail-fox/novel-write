import { describe, expect, it } from 'vitest';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';

const now = '2026-11-12T00:00:00.000Z';
function fixture() {
  return createMotionComicStarterProject(createMotionComicDraft({ id: 'empty-project', title: '待规划项目', premise: '雨夜来信', now }));
}

describe('empty generated episode project loading', () => {
  it('loads source episodes without inventing a generated episode', () => {
    const document = fixture();
    document.episodes = [];
    document.sourceDocument = {
      kind: 'script', adaptationMode: 'faithful-script', originalText: '雨夜来信', importedAt: now,
      episodes: [{ id: 'source-1', number: 1, title: '第一集', sourceText: '雨夜来信' }],
    };
    const loaded = parseMotionComicPipelineData(JSON.stringify(document));
    expect(loaded.episodes).toEqual([]);
    expect(loaded.activeEpisodeId).toBe(document.activeEpisodeId);
    expect(loaded.sourceDocument?.episodes[0].id).toBe('source-1');
  });

  it('still rejects a missing active episode when generated episodes exist', () => {
    const document = fixture();
    document.activeEpisodeId = 'missing-episode';
    expect(() => parseMotionComicPipelineData(document)).toThrow('The active episode must exist.');
  });
});
