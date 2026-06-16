import { describe, expect, it } from 'vitest';
import { splitPodcastDialogue } from '@shared/podcast-dialogue';

describe('podcast dialogue splitting', () => {
  it('splits English Host A and Host B labels into ordered turns', () => {
    const turns = splitPodcastDialogue({ id: 7, cap: 'Host A: Hello there.\nHost B: Hi, I am here.' });

    expect(turns).toEqual([
      { sceneId: 7, speaker: 'A', turnIndex: 1, text: 'Hello there.' },
      { sceneId: 7, speaker: 'B', turnIndex: 2, text: 'Hi, I am here.' },
    ]);
  });

  it('splits Chinese host labels and strips punctuation labels', () => {
    const turns = splitPodcastDialogue({ id: 2, cap: '主持人A：你好，今天聊这个。\n主持人B：来了，先说重点。' });

    expect(turns).toEqual([
      { sceneId: 2, speaker: 'A', turnIndex: 1, text: '你好，今天聊这个。' },
      { sceneId: 2, speaker: 'B', turnIndex: 2, text: '来了，先说重点。' },
    ]);
  });

  it('accepts compact A and B prefixes', () => {
    const turns = splitPodcastDialogue({ id: 3, cap: 'A: One point.\nB: Two points.' });

    expect(turns).toEqual([
      { sceneId: 3, speaker: 'A', turnIndex: 1, text: 'One point.' },
      { sceneId: 3, speaker: 'B', turnIndex: 2, text: 'Two points.' },
    ]);
  });

  it('alternates unlabeled sentences as a fallback', () => {
    const turns = splitPodcastDialogue({ id: 4, cap: '第一句。第二句。第三句。' });

    expect(turns).toEqual([
      { sceneId: 4, speaker: 'A', turnIndex: 1, text: '第一句。' },
      { sceneId: 4, speaker: 'B', turnIndex: 2, text: '第二句。' },
      { sceneId: 4, speaker: 'A', turnIndex: 3, text: '第三句。' },
    ]);
  });

  it('returns no turns for empty captions', () => {
    expect(splitPodcastDialogue({ id: 5, cap: '   \n\t  ' })).toEqual([]);
  });
});
