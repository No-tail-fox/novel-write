import { describe, expect, it } from 'vitest';
import { fallbackJianyingEffectCatalog, loadJianyingEffectCatalog } from '@shared/jianying-effects';

describe('Jianying effect catalog', () => {
  it('parses pyJianYingDraft enum names from Python JSON output', async () => {
    const catalog = await loadJianyingEffectCatalog({
      execute: async () => ({
        stdout: JSON.stringify({
          transitions: ['叠化', '向左'],
          filters: ['冷白'],
          videoEffects: ['光晕'],
          audioEffects: ['人声增强'],
        }),
        stderr: '',
      }),
    });

    expect(catalog).toMatchObject({
      status: 'pass',
      transitions: ['叠化', '向左'],
      filters: ['冷白'],
      videoEffects: ['光晕'],
      audioEffects: ['人声增强'],
    });
  });

  it('returns a safe fallback catalog when Python or pyJianYingDraft is unavailable', async () => {
    const catalog = await loadJianyingEffectCatalog({
      execute: async () => {
        throw new Error('python missing');
      },
    });

    expect(catalog.status).toBe('warn');
    expect(catalog.detail).toContain('python missing');
    expect(catalog.transitions).toEqual(fallbackJianyingEffectCatalog.transitions);
    expect(catalog.transitions).toContain('叠化');
  });
});
