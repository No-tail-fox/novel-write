import { describe, expect, it } from 'vitest';
import { defaultCustomStyles } from '../src/shared/config';
import { imageStylePreview } from '../src/shared/image-style-previews';

describe('cached drawing style samples', () => {
  it('provides a distinct bundled sample for every built-in drawing template', () => {
    const previews = defaultCustomStyles.map(style => imageStylePreview(style));
    expect(previews.every(Boolean)).toBe(true);
    expect(new Set(previews.map(preview => preview?.src)).size).toBe(defaultCustomStyles.length);
    for (const style of defaultCustomStyles) {
      expect(imageStylePreview(style.id)).toEqual(imageStylePreview(style));
    }
  });

  it('reuses the matching sample for an unchanged clone while showing its own name', () => {
    const original = defaultCustomStyles[0];
    const copy = { ...original, id: 'my-copy', name: '我的电影模板' };
    expect(imageStylePreview(copy)).toMatchObject({ src: imageStylePreview(original)?.src, label: copy.name });
  });

  it('does not misrepresent modified drawing instructions with an old stock sample', () => {
    const original = defaultCustomStyles[0];
    for (const field of ['prefix', 'suffix', 'negativePrompt'] as const) {
      expect(imageStylePreview({ ...original, [field]: `${original[field]} changed` })).toBeUndefined();
    }
    expect(imageStylePreview({ ...original, allowColor: !original.allowColor })).toBeUndefined();
    expect(imageStylePreview('unknown-custom-template')).toBeUndefined();
  });
});
