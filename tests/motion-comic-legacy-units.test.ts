import { describe, expect, it } from 'vitest';
import { legacyMotionComicSourceUnitMap, normalizeMotionComicScriptRaw, splitMotionComicSource } from '../src/shared/motion-comic-planning';

describe('legacy motion-comic source unit ids (C4)', () => {
  const source = '林夏说：“这封信是你留下的吗？”\n周沉摇头说：“不是。我们去钟楼看看邮戳。”\n街道恢复安静。';
  const units = splitMotionComicSource(source);
  it('maps the old orphan-quote split onto the current units', () => {
    expect(units.map(unit => unit.text)).toEqual(['林夏说：“这封信是你留下的吗？”', '周沉摇头说：“不是。', '我们去钟楼看看邮戳。”', '街道恢复安静。']);
    const map = legacyMotionComicSourceUnitMap(units)!;
    expect(Object.fromEntries(map)).toEqual({ S1: ['S1'], S2: ['S1'], S3: ['S2'], S4: ['S3'], S5: ['S3'], S6: ['S4'] });
  });
  it('only remaps scripts that cite ids unknown to the current split', () => {
    const script = (ids: string[][]) => ({ scenes: [{ beats: ids.map((sourceUnitIds, i) => ({ key: `b${i}`, kind: 'action', text: '文本内容', sourceUnitIds })) }] });
    const read = (raw: unknown) => ((raw as { scenes: Array<{ beats: Array<{ sourceUnitIds: string[] }> }> }).scenes[0].beats).map(beat => beat.sourceUnitIds);
    expect(read(normalizeMotionComicScriptRaw(script([['S1', 'S2'], ['S3', 'S4', 'S5'], ['S6']]), units))).toEqual([['S1'], ['S2', 'S3'], ['S4']]);
    expect(read(normalizeMotionComicScriptRaw(script([['S1'], ['S2', 'S3'], ['S4']]), units))).toEqual([['S1'], ['S2', 'S3'], ['S4']]);
    expect(read(normalizeMotionComicScriptRaw(script([['S1'], ['S99']]), units))).toEqual([['S1'], ['S99']]);
  });
});
