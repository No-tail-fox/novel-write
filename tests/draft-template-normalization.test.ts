import { describe, expect, it } from 'vitest';
import { draftTemplates, normalizeDraftTemplate } from '@shared/templates';
import type { DraftTemplate } from '@shared/types';

describe('draft template normalization', () => {
  it('fills draggable coordinates for legacy template objects', () => {
    const fallback = draftTemplates[0];
    const legacyTemplate = {
      ...fallback,
      title: { visible: true, text: 'Legacy title', fontSize: 44, color: '#ffde00' },
      subtitle: { visible: true, fontSize: 22, color: '#ffffff' },
      caption: { ...fallback.caption, x: undefined },
      disclaimer: { visible: true, text: 'Legacy disclaimer' },
    } as unknown as DraftTemplate;

    const normalized = normalizeDraftTemplate(legacyTemplate);

    expect(normalized.title).toMatchObject({ x: 0, y: -0.1 });
    expect(normalized.subtitle).toMatchObject({ x: 0, y: 0.02 });
    expect(normalized.caption).toMatchObject({ x: 0 });
    expect(typeof normalized.caption.y).toBe('number');
    expect(normalized.disclaimer).toMatchObject({ x: 0, y: 0.92 });
  });

  it('fills editing effect defaults for legacy template audio settings', () => {
    const fallback = draftTemplates[0];
    const legacyTemplate = {
      ...fallback,
      audio: {
        narrationVolume: 8,
        bgmVolume: 2,
        bgmFadeOutMs: 1500,
      },
    } as unknown as DraftTemplate;

    const normalized = normalizeDraftTemplate(legacyTemplate);

    expect(normalized.audio).toMatchObject({
      narrationVolume: 8,
      bgmVolume: 2,
      transitionType: '叠化',
      transitionDurationMs: 450,
      narrationFadeInMs: 80,
      narrationFadeOutMs: 80,
      bgmFadeInMs: 800,
      bgmFadeOutMs: 1500,
      filterType: '',
      videoEffectType: '',
      audioEffectType: '',
    });
  });
});
