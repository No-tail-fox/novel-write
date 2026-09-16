import { describe, expect, it } from 'vitest';
import { MUSIC_STYLE_GROUPS } from '../src/features/labs/music-style-catalog';
import { MUSIC_STYLE_COUNT, MUSIC_STYLE_TAGS, findMusicStyles, mergeMusicStyles, musicStyleKey, selectedMusicStyles } from '../src/features/labs/music-styles';

describe('complete music style catalog', () => {
  it('retains every category and entry from the reference website', () => {
    expect(MUSIC_STYLE_COUNT).toBe(633);
    expect(MUSIC_STYLE_GROUPS.map(group => [group.label, group.categories.length, group.categories.flatMap(category => category.tags).length])).toEqual([
      ['曲风', 17, 271], ['情绪与氛围', 4, 142], ['人声与语言', 3, 47], ['编制与演奏', 3, 20],
      ['节奏与曲式', 5, 55], ['音效与处理', 6, 33], ['制作与音质', 3, 25], ['使用场景', 2, 14], ['年代与时期', 3, 26],
    ]);
    expect(MUSIC_STYLE_TAGS).toHaveLength(598);
    for (const group of MUSIC_STYLE_GROUPS) {
      expect(new Set(group.categories.map(category => category.id)).size).toBe(group.categories.length);
      for (const tag of group.categories.flatMap(category => category.tags)) {
        expect(tag.zh.trim()).toBeTruthy();
        expect(tag.en.trim()).toBeTruthy();
      }
    }
  });
  it('searches all categories in Chinese and English without repeated results', () => {
    expect(findMusicStyles('巴洛克').map(tag => tag.en)).toEqual(expect.arrayContaining(['Baroque Pop', 'Baroque']));
    expect(findMusicStyles('  SYNTH-pop  ')).toEqual([expect.objectContaining({ zh: '合成器流行', en: 'Synth-Pop' })]);
    expect(findMusicStyles('1920')).toEqual([expect.objectContaining({ en: '1920s' })]);
    expect(findMusicStyles('不存在的风格xyz')).toEqual([]);
    const found = findMusicStyles('怀旧');
    expect(new Set(found.map(musicStyleKey)).size).toBe(found.length);
  });
  it('recognizes existing bilingual tags but does not mistake a sentence for a tag', () => {
    expect(selectedMusicStyles('pOP，流行; Synth-Pop\n我想让 Jazz 只在结尾出现').map(tag => tag.en)).toEqual(['Pop', 'Synth-Pop']);
  });
  it('keeps custom text and deduplicates existing translations when applying tags', () => {
    const tags = selectedMusicStyles('Pop, Folk');
    expect(mergeMusicStyles('温暖的人声，副歌留白\n自定义: 渐强, 流行, POP', tags, true)).toBe('温暖的人声，副歌留白\n自定义: 渐强, Pop, Folk');
    expect(mergeMusicStyles('手写要求', tags, false)).toBe('手写要求, 流行, 民谣');
    expect(mergeMusicStyles('手写要求', [...tags, ...tags], true)).toBe('手写要求, Pop, Folk');
  });
  it('only removes recognized tags when clearing selection and preserves an untouched draft', () => {
    expect(mergeMusicStyles('Pop, 自定义要求；Folk', [], true)).toBe('自定义要求');
    const custom = '  让副歌更温暖，逐渐加入鼓点\n保持叙事。  ';
    expect(mergeMusicStyles(custom, [], true)).toBe(custom);
    expect(mergeMusicStyles('', [], true)).toBe('');
  });
});
