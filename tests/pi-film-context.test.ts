import { describe, expect, it } from 'vitest';
import { buildPiSegmentPrompt, parsePiSegmentHandoff, splitPiNarration } from '../src/shared/pi-film-context';

describe('Pi narration-window context', () => {
  it('splits deterministically without losing whitespace, punctuation, or grapheme clusters', () => {
    const source = ('  第一段讲清事实。\r\n👨‍👩‍👧‍👦 第二段保留限定和数据  ').repeat(40);
    const chunks = splitPiNarration(source, 256);
    expect(chunks).toEqual(splitPiNarration(source, 256));
    expect(chunks.join('')).toBe(source);
    expect(chunks.every(chunk => chunk.length <= 256)).toBe(true);
  });
  it('uses only current window plus bounded global plan and handoff', () => {
    const prompt = buildPiSegmentPrompt({ globalPlan: '{"title":"Global"}', narration: 'Current paragraph only.', segment: 2, segmentCount: 4, previousSummary: 'Palette is fixed; next scene follows the map.' });
    expect(prompt).toContain('CURRENT NARRATION WINDOW 2/4');
    expect(prompt).toContain('Current paragraph only.');
    expect(prompt).toContain('Palette is fixed');
    expect(prompt).not.toContain('entire source text');
    expect(() => buildPiSegmentPrompt({ globalPlan: '{}', narration: 'x'.repeat(12_001), segment: 1, segmentCount: 1 })).toThrow('PI_CONTEXT_SEGMENT_RANGE');
    expect(() => buildPiSegmentPrompt({ globalPlan: '{}', narration: 'x', segment: 2, segmentCount: 1 })).toThrow('PI_CONTEXT_SEGMENT_RANGE');
    expect(() => buildPiSegmentPrompt({ globalPlan: '{}', narration: 'x', segment: 1, segmentCount: 1, previousSummary: 'x'.repeat(4001) })).toThrow('PI_CONTEXT_SUMMARY_TOO_LARGE');
  });
  it('requires a bounded explicit handoff section in each completed treatment', () => {
    expect(parsePiSegmentHandoff('# Treatment\nArc...\n\n## Segment handoff\nPalette: red and black.\nNext: reveal the archive.')).toContain('Palette: red');
    expect(() => parsePiSegmentHandoff('# Treatment\nNo continuity notes')).toThrow('PI_SEGMENT_HANDOFF_REQUIRED');
    expect(() => parsePiSegmentHandoff('## Segment handoff\n' + 'x'.repeat(4001))).toThrow('PI_SEGMENT_HANDOFF_INVALID');
  });
});
