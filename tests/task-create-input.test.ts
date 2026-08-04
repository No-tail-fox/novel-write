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

  it('keeps an optional cover-page title separate and rejects a page without an image source', () => {
    expect(buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'auto',
      coverTemplateId: 'cinematic-poster',
      coverPageEnabled: true,
      coverPageText: '  只在封面出现  ',
    }, defaultCustomCoverTemplates)).toMatchObject({
      coverPageEnabled: true,
      coverPageText: '只在封面出现',
    });

    expect(buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'auto',
      coverTemplateId: 'cinematic-poster',
      coverPageEnabled: false,
      coverPageText: '不应保存',
    }, defaultCustomCoverTemplates).coverPageText).toBe('');

    expect(() => buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'off',
      coverPageEnabled: true,
    }, defaultCustomCoverTemplates)).toThrow(/ORDINARY_COVER_PAGE_IMAGE_REQUIRED/);
  });

  it('accepts manual only with an opaque managed import id and never a renderer path', () => {
    expect(buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'manual',
      manualCoverAssetId: '1f3de8ea-6775-43ab-971c-1e922eb19a57',
    }, defaultCustomCoverTemplates)).toMatchObject({
      coverImageMode: 'manual',
      manualCoverAssetId: '1f3de8ea-6775-43ab-971c-1e922eb19a57',
    });
    expect(() => buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'manual',
    }, defaultCustomCoverTemplates)).toThrow(/ORDINARY_MANUAL_COVER_REQUIRED/);
    expect(() => buildTaskCreateInput({
      inputText: 'source',
      coverImageMode: 'manual',
      manualCoverAssetId: 'C:/outside/cover.png',
    }, defaultCustomCoverTemplates)).toThrow(/ORDINARY_MANUAL_COVER_ID_INVALID/);
  });
});
