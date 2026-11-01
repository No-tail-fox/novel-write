import { describe, expect, it } from 'vitest';
import { buildOpenAiImageGenerationBody } from '../src/shared/openai-image';
import { buildOpenAiImageEditFormData } from '../src/shared/openai-image-edit';

describe('configured image dimensions', () => {
  it.each([['16:9', '3840x2160'], ['9:16', '2160x3840']])('sends a 4K %s canvas through generation and reference editing', async (ratio, size) => {
    const input = { model: 'gpt-image-2-adobe', ratio, resolution: '4K' as const, prompt: 'a lotus leaf', quality: 'medium' as const };
    expect(buildOpenAiImageGenerationBody(input)).toMatchObject({ size, quality: 'medium' });
    const form = await buildOpenAiImageEditFormData({ ...input, referenceImagePaths: ['package.json'] });
    expect(form.get('size')).toBe(size);
    expect(form.get('quality')).toBe('medium');
  });
  it('preserves custom size mappings and legacy model limits', () => {
    const input = { model: 'gpt-image-2', ratio: '16:9', resolution: '4K' as const, prompt: 'leaf' };
    expect(buildOpenAiImageGenerationBody({ ...input, ratioMappingJson: '{"16:9":{"size":"2560x1440"}}' }).size).toBe('2560x1440');
    expect(buildOpenAiImageGenerationBody({ ...input, model: 'gpt-image-1' }).size).toBe('1536x1024');
    expect(buildOpenAiImageGenerationBody({ ...input, model: 'custom-compatible' }).size).toBe('1536x1024');
  });
});
