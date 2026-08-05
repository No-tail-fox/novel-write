import { describe, expect, it } from 'vitest';
import { repairSubtitleProblemLines, subtitleLineIssues } from '../src/features/tasks/subtitle-line-diagnostics';

describe('subtitle line diagnostics', () => {
  it('reports empty and over-limit lines with stable source indexes', () => {
    expect(subtitleLineIssues(['正常字幕', '', '这一行明显超过六个字'], 6)).toEqual([
      { index: 1, characterCount: 0, kind: 'empty' },
      { index: 2, characterCount: 10, kind: 'over-limit' },
    ]);
    expect(subtitleLineIssues([], 6)).toEqual([{ index: 0, characterCount: 0, kind: 'empty' }]);
  });

  it('repairs only empty and over-limit content while preserving valid manual lines', () => {
    expect(repairSubtitleProblemLines(['保留这行', '', '这是需要重新切分的长字幕'], '备用文案', 6)).toEqual([
      '保留这行',
      '这是需要重新',
      '切分的长字幕',
    ]);
    expect(repairSubtitleProblemLines([], '没有字幕时使用原分镜', 6)).toEqual([
      '没有字幕',
      '时使用原分镜',
    ]);
  });
});
