import { describe, expect, it } from 'vitest';
import { attachMotionComicReference, createMotionComicReferenceAsset, fixedMotionComicReferenceAsset, inspectMotionComicShotConsistency, setMotionComicFixedReference } from '../src/features/motion-comic/motion-comic-consistency';
import { invalidateMotionComicVideosForChangedInputs, motionComicVideoInputHash } from '../src/shared/motion-comic-video';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { ImageLabRecord } from '../src/shared/types';
import type { DirectorImageProviderStatus } from '../src/features/director-desk/director-generation';
import { applyGeneratedMotionComicReference, defaultMotionComicLookReferencePrompt, motionComicReferenceGenerationRequests, motionComicReferenceGenerationFingerprint, motionComicReferenceGenerationInput } from '../src/features/motion-comic/motion-comic-reference-generation';

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
  it('derives the editable default from identity and look continuity and requests distinct views', () => {
    const document = project();
    const character = document.characters[0]; const look = character.looks[0];
    const prompt = defaultMotionComicLookReferencePrompt(character, look);
    for (const value of [character.name, character.identityPrompt, look.label, look.appearancePrompt, look.wardrobe, look.continuityNotes]) expect(prompt).toContain(value);
    const requests = motionComicReferenceGenerationRequests(document, { kind: 'look', id: look.id }, provider);
    expect(requests.map(request => request.view)).toEqual(['front', 'side', 'back']);
    expect(new Set(requests.map(request => request.input.prompt)).size).toBe(3);
    expect(requests.every(request => request.input.prompt.includes('不得生成三视图拼图'))).toBe(true);
    expect(motionComicReferenceGenerationRequests(document, { kind: 'scene', id: document.sceneAssets[0].id }, provider)).toHaveLength(1);
  });

  it('keeps explicit generation inputs separate from adopted output references, including an empty selection', () => {
    const initial = project(); const target = { kind: 'look' as const, id: initial.characters[0].looks[0].id };
    const document = setMotionComicFixedReference(applyGeneratedMotionComicReference(initial, target, record('adopted'), provider), target, 'motion-comic-reference-adopted');
    const look = document.characters[0].looks[0];
    look.generationReferenceImagePaths = ['I:/fixtures/input.png'];
    expect(motionComicReferenceGenerationInput(document, target, provider).referenceImagePaths).toEqual(['I:/fixtures/input.png']);
    look.generationReferenceImagePaths = [];
    expect(motionComicReferenceGenerationInput(document, target, provider).referenceImagePaths).toEqual([]);
    expect(motionComicReferenceGenerationInput(document, target, provider).smartMode).toBe('text-to-image');
  });
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

  it('persists an editable generation prompt and includes it in the request and dependency fingerprint', () => {
    const document = project();
    const look = document.characters[0].looks[0];
    const target = { kind: 'look' as const, id: look.id };
    const before = motionComicReferenceGenerationFingerprint(document, target, provider);
    look.referencePrompt = '侧面全身，白色背景，清晰展示衣服轮廓';
    const restored = parseMotionComicPipelineData(JSON.stringify(document));
    expect(restored.characters[0].looks[0].referencePrompt).toBe(look.referencePrompt);
    const input = motionComicReferenceGenerationInput(restored, target, provider);
    expect(input.prompt).toContain(look.referencePrompt);
    expect(input.prompt).toContain(document.characters[0].identityPrompt);
    expect(input.prompt).toContain(look.wardrobe);
    expect(input.prompt).not.toContain('单一角色，全身或清晰的四分之三身构图');
    expect(motionComicReferenceGenerationFingerprint(restored, target, provider)).not.toBe(before);
    look.referencePrompt = '   ';
    expect(motionComicReferenceGenerationInput(document, target, provider).prompt).toContain('角色定妆参考图');
  });

  it('does not add hidden fixed references from another look', () => {
    const initial = project();
    const target = { kind: 'look' as const, id: initial.characters[0].looks[0].id };
    const candidate = applyGeneratedMotionComicReference(initial, target, record('first-look'), provider);
    const document = setMotionComicFixedReference(candidate, target, 'motion-comic-reference-first-look');
    const first = document.characters[0].looks[0];
    const alternate = { ...first, id: 'look-alternate', label: '雨衣', wardrobe: '黄色雨衣', referenceAssetVersionIds: [] };
    document.characters[0].looks.push(alternate);
    const input = motionComicReferenceGenerationInput(document, { kind: 'look', id: alternate.id }, provider);
    expect(input.smartMode).toBe('text-to-image');
    expect(input.referenceImagePaths).toEqual([]);
    expect(input.prompt).toContain('黄色雨衣');
    expect(() => motionComicReferenceGenerationInput(document, target, { ...provider, supportsReferenceImages: false })).toThrow('不支持参考图');
    expect(() => motionComicReferenceGenerationInput(document, target, { ...provider, maxReferenceImages: 0 })).toThrow('不支持参考图');
  });

  it('keeps generated provenance and fixed version history valid after save/reopen', () => {
    const initial = project();
    const target = { kind: 'scene' as const, id: initial.sceneAssets[0].id };
    const first = setMotionComicFixedReference(applyGeneratedMotionComicReference(initial, target, record('scene-v1'), provider), target, 'motion-comic-reference-scene-v1');
    const second = applyGeneratedMotionComicReference(first, target, { ...record('scene-v2'), referenceImagePaths: ['I:/fixtures/scene-v1.png'] }, provider);
    const restored = parseMotionComicPipelineData(JSON.stringify(second));
    expect(restored.sceneAssets[0].referenceAssetVersionIds).toHaveLength(2);
    expect(restored.assets.map((asset) => asset.pinned)).toEqual([true, false]);
    expect(restored.assets.map((asset) => asset.selected)).toEqual([true, false]);
    expect(restored.assets[0]).toEqual(first.assets[0]);
    expect(fixedMotionComicReferenceAsset(restored, restored.sceneAssets[0].referenceAssetVersionIds)?.id).toBe(first.assets[0].id);
    const adopted = setMotionComicFixedReference(restored, target, restored.assets[1].id);
    expect(adopted.assets.map((asset) => asset.pinned)).toEqual([false, true]);
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
    expect(motionComicReferenceGenerationFingerprint(referenced, target, provider)).toBe(original);
    const adopted = setMotionComicFixedReference(referenced, target, referenced.assets[0].id);
    expect(motionComicReferenceGenerationFingerprint(adopted, target, provider)).not.toBe(original);
  });

  it.each(['look', 'scene', 'prop'] as const)('keeps a new %s candidate unfixed until explicit adoption', (kind) => {
    const initial = project();
    const id = kind === 'look' ? initial.characters[0].looks[0].id : kind === 'scene' ? initial.sceneAssets[0].id : initial.props[0].id;
    const target = { kind, id };
    const candidate = applyGeneratedMotionComicReference(initial, target, record('candidate'), provider);
    const asset = candidate.assets[0];
    expect(asset).toMatchObject({ selected: false, pinned: false });
    expect(fixedMotionComicReferenceAsset(candidate, [asset.id])).toBeUndefined();
    expect(inspectMotionComicShotConsistency(candidate, candidate.episodes[0].scenes[0].shots[0]).ready).toBe(false);
    const restored = parseMotionComicPipelineData(JSON.stringify(candidate));
    expect(fixedMotionComicReferenceAsset(restored, [asset.id])).toBeUndefined();
    const adopted = setMotionComicFixedReference(restored, target, asset.id);
    expect(fixedMotionComicReferenceAsset(adopted, [asset.id])?.id).toBe(asset.id);
    const imported = attachMotionComicReference(candidate, target, createMotionComicReferenceAsset(record('import'), id, kind));
    expect(imported.assets.at(-1)).toMatchObject({ selected: true, pinned: true });
  });

  it('preserves video input hash and bindings until a candidate is explicitly fixed', () => {
    const initial = project();
    const shot = initial.episodes[0].scenes[0].shots[0];
    const target = { kind: 'scene' as const, id: shot.sceneAssetId! };
    const first = attachMotionComicReference(initial, target, createMotionComicReferenceAsset(record('fixed'), target.id, target.kind));
    shot.renderStrategy = 'remote-video';
    shot.videoProduction = { version: 1, referenceMode: 'frames', audioMode: 'post-mix' };
    shot.firstFrameAssetVersionId = 'first-frame';
    first.assets.push({ id: 'first-frame', assetId: 'shot-frame', kind: 'image', localPath: 'I:/fixtures/frame.png', createdAt: record('fixed').createdAt });
    shot.videoAssetVersionId = 'existing-video';
    shot.videoJobId = 'existing-job';
    first.providerJobs.push({ id: 'existing-job', workflowKind: 'motion-comic', nodeId: shot.id, providerId: 'remote', model: 'video', capability: 'image-to-video', status: 'completed', inputHash: 'old', idempotencyKey: 'old', estimatedCost: 0, attempt: 1, createdAt: record('fixed').createdAt, updatedAt: record('fixed').createdAt });
    const hash = motionComicVideoInputHash(first, shot, 'remote', 'video');
    const candidate = applyGeneratedMotionComicReference(first, target, record('next'), provider);
    expect(motionComicVideoInputHash(candidate, shot, 'remote', 'video')).toBe(hash);
    expect(candidate.assets[0]).toEqual(first.assets[0]);
    expect(invalidateMotionComicVideosForChangedInputs(first, candidate)).toBe(candidate);
    expect(candidate.episodes[0].scenes[0].shots[0].videoAssetVersionId).toBe('existing-video');
    const legacy = structuredClone(first);
    legacy.episodes[0].scenes[0].shots[0].videoJobId = undefined;
    legacy.providerJobs = [];
    const legacyCandidate = applyGeneratedMotionComicReference(legacy, target, record('legacy-next'), provider);
    expect(legacyCandidate.episodes[0].scenes[0].shots[0].videoAssetVersionId).toBe('existing-video');
    expect(motionComicVideoInputHash(legacyCandidate, legacyCandidate.episodes[0].scenes[0].shots[0], 'remote', 'video')).toBe(hash);
    const adopted = setMotionComicFixedReference(candidate, target, 'motion-comic-reference-next');
    expect(motionComicVideoInputHash(adopted, shot, 'remote', 'video')).not.toBe(hash);
    const invalidated = invalidateMotionComicVideosForChangedInputs(candidate, adopted);
    expect(invalidated.episodes[0].scenes[0].shots[0].videoAssetVersionId).toBeUndefined();
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
