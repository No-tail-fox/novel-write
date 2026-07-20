import { describe, expect, it } from 'vitest';
import { defaultCustomCoverTemplates } from '@shared/config';
import { buildTaskCreateInput } from '../src/features/tasks/task-create-input';

describe('ordinary task create input', () => {
  it('preserves an explicit false promotion choice when product metadata exists', () => {
    expect(buildTaskCreateInput({
      inputText: 'source',
      keepPromotion: false,
      productInfo: JSON.stringify({ name: 'Book' }),
      coverImageMode: 'off',
    }, defaultCustomCoverTemplates)).toMatchObject({
      keepPromotion: false,
      productInfo: JSON.stringify({ name: 'Book' }),
      coverImageMode: 'off',
    });
  });

  it('accepts auto only with the selected complete canonical cover template', () => {
    expect(buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'auto',
      coverTemplateId: 'cinematic-poster',
    }, defaultCustomCoverTemplates).coverTemplateId).toBe('cinematic-poster');

    expect(() => buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'auto',
      coverTemplateId: 'missing-cover',
    }, defaultCustomCoverTemplates)).toThrow(/ORDINARY_COVER_TEMPLATE_NOT_FOUND/);
  });

  it('rejects manual cover creation until a validated manual asset contract exists', () => {
    expect(() => buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'manual',
    }, defaultCustomCoverTemplates)).toThrow(/ORDINARY_MANUAL_COVER_UNAVAILABLE/);
  });
});
