import { describe, expect, it } from 'vitest';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { ImageLabRecord } from '../src/shared/types';
import type { DirectorImageProviderStatus } from '../src/features/director-desk/director-generation';
import { applyGeneratedMotionComicReference, motionComicReferenceGenerationFingerprint, motionComicReferenceGenerationInput } from '../src/features/motion-comic/motion-comic-reference-generation';

const provider: DirectorImageProviderStatus = {
  profileId: 'image-profile', connected: true, provider: 'gpt_image', supportsReferenceImages: true,
  maxReferenceImages: 10, label: 'Configured image model', model: 'gpt-image-2.5', resolution: '2K', quality: 'high',
};
function project() {
  return createMotionComicStarterProject(createMotionComicDraft({ id: 'reference-qa', title: '来信', premise: '在邮局找到线索。', now: '2026-10-20T00:00:00.000Z' }));
}
function record(id: string): ImageLabRecord {
  return {
    id, prompt: 'reference input '.repeat(100), ratio: '9:16', style: 'reference', provider: 'gpt_image',
    imagePath: `I:/fixtures/${id}.png`, status: 'generated', errorMessage: '', resolution: '2K', quality: 'high',
    smartMode: 'text-to-image', referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: 'reference-qa',
    createdAt: '2026-10-20T00:00:00.000Z', finishedAt: '2026-10-20T00:00:02.000Z',
  };
}

describe('comic reference generation', () => {
  it('builds distinct role, empty-scene and prop requests without cover styling', () => {
    const document = project();
    const role = motionComicReferenceGenerationInput(document, { kind: 'look', id: document.characters[0].looks[0].id }, provider);
    const scene = motionComicReferenceGenerationInput(document, { kind: 'scene', id: document.sceneAssets[0].id }, provider);
    const prop = motionComicReferenceGenerationInput(document, { kind: 'prop', id: document.props[0].id }, provider);
    expect(role).toMatchObject({ ratio: '9:16', style: 'reference', smartMode: 'text-to-image', provider: 'gpt_image' });
    expect(role.prompt).toContain(document.characters[0].identityPrompt);
    expect(role.prompt).toContain(document.characters[0].looks[0].wardrobe);
    expect(scene.prompt).toContain('不添加主角');
    expect(prop).toMatchObject({ ratio: '1:1', style: 'reference' });
    expect(prop.prompt).toContain(document.props[0].prompt);
  });

  it('reuses only the same character fixed reference when creating a second look', () => {
    const initial = project();
    const target = { kind: 'look' as const, id: initial.characters[0].looks[0].id };
    const document = applyGeneratedMotionComicReference(initial, target, record('first-look'), provider);
    const first = document.characters[0].looks[0];
    const alternate = { ...first, id: 'look-alternate', label: '雨衣', wardrobe: '黄色雨衣', referenceAssetVersionIds: [] };
    document.characters[0].looks.push(alternate);
    const input = motionComicReferenceGenerationInput(document, { kind: 'look', id: alternate.id }, provider);
    expect(input.smartMode).toBe('reference-edit');
    expect(input.referenceImagePaths).toEqual(['I:/fixtures/first-look.png']);
    expect(input.prompt).toContain('黄色雨衣');
    expect(() => motionComicReferenceGenerationInput(document, target, { ...provider, supportsReferenceImages: false })).toThrow('不支持参考图');
    expect(() => motionComicReferenceGenerationInput(document, target, { ...provider, maxReferenceImages: 0 })).toThrow('不支持参考图');
  });

  it('keeps generated provenance and fixed version history valid after save/reopen', () => {
    const initial = project();
    const target = { kind: 'scene' as const, id: initial.sceneAssets[0].id };
    const first = applyGeneratedMotionComicReference(initial, target, record('scene-v1'), provider);
    const second = applyGeneratedMotionComicReference(first, target, { ...record('scene-v2'), referenceImagePaths: ['I:/fixtures/scene-v1.png'] }, provider);
    const restored = parseMotionComicPipelineData(JSON.stringify(second));
    expect(restored.sceneAssets[0].referenceAssetVersionIds).toHaveLength(2);
    expect(restored.assets.map((asset) => asset.pinned)).toEqual([false, true]);
    expect(restored.assets[1]).toMatchObject({ provider: 'gpt_image', model: 'gpt-image-2.5', providerJobId: restored.providerJobs[1].id });
    expect(restored.providerJobs[1]).toMatchObject({ attempt: 2, status: 'completed', capability: 'image-edit' });
    expect(restored.providerJobs[1].inputHash.length).toBeLessThanOrEqual(256);
    expect(initial.assets).toHaveLength(0);
  });

  it('changes the dependency fingerprint on edited definitions, references or model', () => {
    const initial = project();
    const target = { kind: 'look' as const, id: initial.characters[0].looks[0].id };
    const original = motionComicReferenceGenerationFingerprint(initial, target, provider);
    const changed = structuredClone(initial);
    changed.characters[0].looks[0].wardrobe = '红色长外套';
    expect(motionComicReferenceGenerationFingerprint(changed, target, provider)).not.toBe(original);
    expect(motionComicReferenceGenerationFingerprint(initial, target, { ...provider, model: 'other-model' })).not.toBe(original);
    const referenced = applyGeneratedMotionComicReference(initial, target, record('fixed-look'), provider);
    expect(motionComicReferenceGenerationFingerprint(referenced, target, provider)).not.toBe(original);
  });

  it('rejects missing definitions and failed provider results without touching references', () => {
    const initial = project();
    const target = { kind: 'look' as const, id: initial.characters[0].looks[0].id };
    const changed = structuredClone(initial);changed.characters[0].identityPrompt = '';
    expect(() => motionComicReferenceGenerationInput(changed, target, provider)).toThrow('身份提示词');
    expect(() => motionComicReferenceGenerationInput(initial, { kind: 'scene', id: 'deleted' }, provider)).toThrow('已不存在');
    expect(() => applyGeneratedMotionComicReference(initial, target, { ...record('failed'), status: 'failed', imagePath: '', errorMessage: 'upstream failed' }, provider)).toThrow('upstream failed');
    expect(initial.assets).toHaveLength(0);
    expect(initial.characters[0].looks[0].referenceAssetVersionIds).toHaveLength(0);
  });
});
