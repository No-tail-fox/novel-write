import { describe, expect, it } from 'vitest';
import { VOX_TEMPLATES, validateVoxAnimation, voxAnimationAssetIds } from '../src/shared/vox-animation';
import { createVoxTemplateExample, voxTemplateExampleAssets } from '../src/features/vox-animation/vox-template-examples';

describe('animation catalog examples', () => {
  it.each(VOX_TEMPLATES.map(template => [template.id]))('%s has complete local preview media and valid content', id => {
    const assets = voxTemplateExampleAssets(), example = createVoxTemplateExample(id);
    expect(validateVoxAnimation(example.animation, assets)).toEqual([]);
    for (const assetId of voxAnimationAssetIds(example.animation)) {
      expect(assets.find(asset => asset.id === assetId)?.url).toMatch(/^data:/);
    }
    if (['audio-captions', 'audio-lyrics'].includes(id)) {
      expect(example.cues.at(-1)?.endMs).toBe(example.durationMs);
      expect(example.cues.flatMap(cue => cue.tokens ?? []).length).toBeGreaterThan(5);
    }
  });

  it('does not share mutable example props between catalog choices', () => {
    const first = createVoxTemplateExample('paper-actors');
    first.animation.template.props.assetIds.length = 0;
    first.animation.template.props.items[0].label = 'edited';
    const second = createVoxTemplateExample('paper-actors');
    expect(second.animation.template.props.assetIds).toHaveLength(2);
    expect(second.animation.template.props.items[0].label).toBe('观察');
  });
});
