import { describe, expect, it } from 'vitest';
import { normalizeTaskOutputTargets } from '../src/shared/task-output';

describe('short video output contract', () => {
  it('keeps historical tasks draft-only', () => {
    expect(normalizeTaskOutputTargets(undefined)).toEqual(['jianying-draft']);
    expect(normalizeTaskOutputTargets(null)).toEqual(['jianying-draft']);
  });
  it('supports single and dual outputs without duplicates', () => {
    expect(normalizeTaskOutputTargets(['mp4'])).toEqual(['mp4']);
    expect(normalizeTaskOutputTargets(['jianying-draft'])).toEqual(['jianying-draft']);
    expect(normalizeTaskOutputTargets(['mp4', 'jianying-draft', 'mp4'])).toEqual(['mp4', 'jianying-draft']);
  });
  it.each([[], ['invalid'], 'mp4', ['mp4', 'invalid']])('rejects invalid explicit selection %j', (value) => {
    expect(() => normalizeTaskOutputTargets(value)).toThrow('请至少选择');
  });
});


describe('output IPC contract', () => {
  it('accepts nonempty supported selections through the real gateway', async () => {
    const { ipcInputSchemas } = await import('../src/shared/ipc-contract');
    const schema = ipcInputSchemas['task:create-and-run'];
    for (const outputTargets of [['mp4'], ['jianying-draft'], ['mp4', 'jianying-draft']]) {
      expect(schema.parse({ inputText: 'test', outputTargets }).outputTargets).toEqual(outputTargets);
    }
    for (const outputTargets of [[], ['unknown'], 'mp4']) {
      expect(() => schema.parse({ inputText: 'test', outputTargets })).toThrow();
    }
    expect(schema.parse({ inputText: 'legacy' }).outputTargets).toBeUndefined();
  });
});
