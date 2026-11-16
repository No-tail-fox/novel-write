import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { applyLemoEdits } from '../src/shared/creative-animation/lemo-edits';

describe('bounded exact-source edit transactions', () => {
  const source = 'const palette={ink:1}; return {palette};';
  const hash = createHash('sha256').update(source).digest('hex');
  const patch = (edits: {search:string;replace:string}[], baseHash = hash) => JSON.stringify({ baseHash, edits, done: true, summary: '调整色板' });
  it('extracts one complete fenced JSON reply without changing embedded code strings', () => {
    const json = patch([{ search: 'ink:1', replace: 'ink:2' }]);
    const fenced = 'Batch explanation.\n\n```json\n' + json + '\n```\nCompleted this batch.';
    expect(applyLemoEdits(source, hash, fenced).source).toBe('const palette={ink:2}; return {palette};');
    expect(() => applyLemoEdits(source, hash, fenced + '\n```json\n' + json + '\n```')).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n```json\n' + json)).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n```json\n' + json.slice(0, -2) + '\n```')).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n' + json)).toThrow('LEMO_EDIT_INVALID');
  });
  it('applies ordered unique edits and checks the saved base hash', () => {
    expect(applyLemoEdits(source, hash, patch([{ search: 'ink:1', replace: 'ink:2' }])).source).toContain('ink:2');
    expect(() => applyLemoEdits(source, hash, patch([{ search: 'ink:1', replace: 'ink:2' }], '0'.repeat(64)))).toThrow('LEMO_EDIT_STALE');
  });
  it.each([
    [{ search: 'palette', replace: 'p' }], [{ search: 'missing', replace: 'p' }], [{ search: '', replace: 'p' }], [{ search: 'ink:1', replace: 'ink:1' }],
  ])('rejects missing, ambiguous, empty and no-op searches %#', (...edits) => {
    expect(() => applyLemoEdits(source, hash, patch(edits))).toThrow('LEMO_EDIT_');
  });
  it('reports an oversized replacement as a size failure with the actual limit, rather than malformed JSON', () => {
    const atLimit = '/*' + 'x'.repeat(15986) + '*/return {};';
    expect(atLimit).toHaveLength(16000);
    expect(applyLemoEdits('', hash, patch([{ search: '', replace: atLimit }])).source).toBe(atLimit);
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: atLimit + ' ' }]))).toThrow('16001 字符');
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: atLimit + ' ' }]))).toThrow('16000 字符限制');
  });
  it('limits reply size and permits an empty insertion only for a new file', () => {
    expect(applyLemoEdits('', hash, patch([{ search: '', replace: 'return {};' }])).source).toBe('return {};');
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: 'x'.repeat(16001) }]))).toThrow('LEMO_EDIT_SIZE');
    expect(() => applyLemoEdits(source, hash, '{')).toThrow('LEMO_EDIT_INVALID');
  });
});
