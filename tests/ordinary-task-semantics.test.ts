import { describe, expect, it } from 'vitest';
import { defaultCustomCoverTemplates } from '@shared/config';
import {
  ORDINARY_COVER_MODE_MANIFEST,
  resolveOrdinaryCoverTemplate,
} from '../src/features/tasks/task-control-manifest';

describe('ordinary task semantic manifest', () => {
  it('exposes off and auto while marking manual unavailable', () => {
    expect(ORDINARY_COVER_MODE_MANIFEST).toEqual({
      off: expect.objectContaining({ available: true }),
      auto: expect.objectContaining({ available: true }),
      manual: expect.objectContaining({ available: false }),
    });
  });

  it('resolves the complete selected auto template and never falls back', () => {
    expect(resolveOrdinaryCoverTemplate('off', 'missing', defaultCustomCoverTemplates)).toBeNull();
    expect(resolveOrdinaryCoverTemplate('auto', 'cinematic-poster', defaultCustomCoverTemplates))
      .toEqual(defaultCustomCoverTemplates[0]);
    expect(() => resolveOrdinaryCoverTemplate('auto', 'missing', defaultCustomCoverTemplates))
      .toThrow(/ORDINARY_COVER_TEMPLATE_NOT_FOUND/);
    expect(() => resolveOrdinaryCoverTemplate('manual', 'cinematic-poster', defaultCustomCoverTemplates))
      .toThrow(/ORDINARY_MANUAL_COVER_UNAVAILABLE/);
  });

  it('rejects an incomplete selected auto template', () => {
    const incomplete = { ...defaultCustomCoverTemplates[0], subtitleLayout: '' };
    expect(() => resolveOrdinaryCoverTemplate('auto', incomplete.id, [incomplete]))
      .toThrow(/ORDINARY_COVER_TEMPLATE_INVALID.*subtitleLayout/);
  });
});
