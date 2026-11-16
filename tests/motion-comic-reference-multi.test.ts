import { describe, expect, it } from 'vitest';
import {
  MOTION_COMIC_REFERENCE_ROLE_ORDER, fixedMotionComicReferenceAsset, fixedMotionComicReferenceAssets,
  fixedMotionComicReferencePaths, motionComicReferenceRole, setMotionComicReferenceRole, unpinMotionComicReference,
} from '../src/features/motion-comic/motion-comic-consistency';
import { motionComicReferenceGenerationFingerprint, motionComicReferenceGenerationInput } from '../src/features/motion-comic/motion-comic-reference-generation';
import { motionComicVideoInputHash } from '../src/shared/motion-comic-video';
import { createMotionComicDraft, createMotionComicStarterProject, type MotionComicPipelineData } from '../src/shared/motion-comic';
import type { ProductionAssetVersion } from '../src/shared/production-workflow';
import type { DirectorImageProviderStatus } from '../src/features/director-desk/director-generation';

const provider: DirectorImageProviderStatus = {
  profileId: 'image-profile', connected: true, provider: 'gpt_image', supportsReferenceImages: true,
  maxReferenceImages: 6, label: 'Configured image model', model: 'gpt-image-2.5', resolution: '2K', quality: 'high',
};

function withImages(): { document: MotionComicPipelineData; lookId: string } {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'multi-ref', title: '多图参考', premise: '测试', now: '2026-11-13T00:00:00.000Z' }), '第一集');
  document.characters[0].identityPrompt = '少年神将';
  document.characters[0].looks[0].appearancePrompt = '红绫装束';
  const lookId = document.characters[0].looks[0].id;
  const images: ProductionAssetVersion[] = [
    { id: 'ref-design', assetId: `motion-comic-reference-look-${lookId}`, kind: 'image', localPath: 'I:/fixtures/design.png', createdAt: '2026-11-13T00:00:00.000Z', selected: true, pinned: true },
    { id: 'ref-front', assetId: `motion-comic-reference-look-${lookId}`, kind: 'image', localPath: 'I:/fixtures/front.png', createdAt: '2026-11-13T00:01:00.000Z', selected: false, pinned: false },
    { id: 'ref-side', assetId: `motion-comic-reference-look-${lookId}`, kind: 'image', localPath: 'I:/fixtures/side.png', createdAt: '2026-11-13T00:02:00.000Z', selected: false, pinned: false },
  ];
  const withAssets = { ...document, assets: images };
  return {
    lookId,
    document: { ...withAssets, characters: withAssets.characters.map((character, index) => (index ? character : { ...character, looks: character.looks.map((look) => (look.id === lookId ? { ...look, referenceAssetVersionIds: images.map((asset) => asset.id) } : look)) })) },
  };
}

describe('multi-image reference set', () => {
  it('keeps one pinned image per role and returns them in provider order', () => {
    let { document, lookId } = withImages();
    const target = { kind: 'look' as const, id: lookId };
    document = setMotionComicReferenceRole(document, target, 'ref-side', 'side');
    document = setMotionComicReferenceRole(document, target, 'ref-front', 'front');
    const ids = document.characters[0].looks[0].referenceAssetVersionIds;
    expect(fixedMotionComicReferenceAssets(document, ids).map((asset) => asset.id)).toEqual(['ref-design', 'ref-front', 'ref-side']);
    expect(fixedMotionComicReferencePaths(document, ids)).toEqual(['I:/fixtures/design.png', 'I:/fixtures/front.png', 'I:/fixtures/side.png']);
    // The usage checks and badges still read one primary reference.
    expect(fixedMotionComicReferenceAsset(document, ids)?.id).toBe('ref-design');
  });

  it('replaces only the same role and never keeps two images pinned to it', () => {
    const { document: base, lookId } = withImages();
    const target = { kind: 'look' as const, id: lookId };
    const pinned = setMotionComicReferenceRole(setMotionComicReferenceRole(base, target, 'ref-design', 'design'), target, 'ref-front', 'front');
    const replaced = setMotionComicReferenceRole(pinned, target, 'ref-side', 'front');
    const ids = replaced.characters[0].looks[0].referenceAssetVersionIds;
    expect(fixedMotionComicReferenceAssets(replaced, ids).map((asset) => asset.id)).toEqual(['ref-design', 'ref-side']);
    expect(replaced.assets.filter((asset) => motionComicReferenceRole(asset) === 'front' && asset.pinned).map((asset) => asset.id)).toEqual(['ref-side']);
    // Pinning does not silently drop the replaced image from history.
    expect(ids).toContain('ref-front');
  });

  it('unpins one role and leaves the others fixed', () => {
    const { document: base, lookId } = withImages();
    const target = { kind: 'look' as const, id: lookId };
    const pinned = setMotionComicReferenceRole(setMotionComicReferenceRole(base, target, 'ref-design', 'design'), target, 'ref-front', 'front');
    const unpinned = unpinMotionComicReference(pinned, target, 'ref-front');
    const ids = unpinned.characters[0].looks[0].referenceAssetVersionIds;
    expect(fixedMotionComicReferenceAssets(unpinned, ids).map((asset) => asset.id)).toEqual(['ref-design']);
    expect(unpinned.assets.find((asset) => asset.id === 'ref-front')).toMatchObject({ pinned: false, selected: false });
  });

  it('refuses to pin an image that is not attached to the target', () => {
    const { document, lookId } = withImages();
    expect(() => setMotionComicReferenceRole(document, { kind: 'look', id: lookId }, 'missing', 'front')).toThrow('MOTION_COMIC_REFERENCE_NOT_FOUND');
  });

  it('offers a stable role order for every surface', () => {
    expect(MOTION_COMIC_REFERENCE_ROLE_ORDER).toEqual(['design', 'front', 'side', 'back', 'detail', 'outfit']);
  });
});

describe('multi-image generation input', () => {
  it('uses the same visible legacy look inputs regardless of the old composition toggle', () => {
    const { document: base, lookId } = withImages();
    const target = { kind: 'look' as const, id: lookId };
    const document = setMotionComicReferenceRole(setMotionComicReferenceRole(base, target, 'ref-front', 'front'), target, 'ref-side', 'side');
    const single = motionComicReferenceGenerationInput(document, target, provider);
    expect(single.smartMode).toBe('reference-edit');
    expect(single.referenceImagePaths).toEqual(['I:/fixtures/design.png', 'I:/fixtures/front.png', 'I:/fixtures/side.png']);
    const composed = motionComicReferenceGenerationInput(document, target, provider, { composeMultiple: true });
    expect(composed.referenceImagePaths).toEqual(['I:/fixtures/design.png', 'I:/fixtures/front.png', 'I:/fixtures/side.png']);
    expect(composed.referenceImagePath).toBe('I:/fixtures/design.png');
    expect(composed.prompt).toContain('结合各参考图的角度');
  });

  it('caps references at the provider limit', () => {
    const { document: base, lookId } = withImages();
    const target = { kind: 'look' as const, id: lookId };
    const document = setMotionComicReferenceRole(setMotionComicReferenceRole(base, target, 'ref-front', 'front'), target, 'ref-side', 'side');
    const limited = motionComicReferenceGenerationInput(document, target, { ...provider, maxReferenceImages: 2 }, { composeMultiple: true });
    expect(limited.referenceImagePaths).toHaveLength(2);
  });

  it('changes the fingerprint when the composition choice changes', () => {
    const { document, lookId } = withImages();
    const target = { kind: 'look' as const, id: lookId };
    expect(motionComicReferenceGenerationFingerprint(document, target, provider, { composeMultiple: true }))
      .not.toBe(motionComicReferenceGenerationFingerprint(document, target, provider));
  });

  it('invalidates shot videos when another angle is pinned', () => {
    const { document: bound, lookId } = withImages();
    const shot = bound.episodes[0].scenes[0].shots[0];
    shot.renderStrategy = 'remote-video';
    bound.assets.push({ id: 'first-frame', assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: 'I:/fixtures/first.png', createdAt: '2026-11-13T00:00:00.000Z' } as MotionComicPipelineData['assets'][number]);
    shot.firstFrameAssetVersionId = 'first-frame';
    shot.characterLookIds = [lookId];
    shot.sceneAssetId = bound.sceneAssets[0].id;
    bound.sceneAssets[0].referenceAssetVersionIds = ['scene-reference'];
    bound.assets.push({ id: 'scene-reference', assetId: 'scene-reference', kind: 'image', localPath: 'I:/fixtures/scene.png', selected: true, pinned: true, createdAt: bound.createdAt });
    const before = motionComicVideoInputHash(bound, shot, provider.profileId, provider.model);
    const after = setMotionComicReferenceRole(bound, { kind: 'look', id: lookId }, 'ref-side', 'side');
    expect(motionComicVideoInputHash(after, after.episodes[0].scenes[0].shots[0], provider.profileId, provider.model)).not.toBe(before);
  });
})
