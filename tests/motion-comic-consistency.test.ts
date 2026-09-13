import { describe, expect, it } from 'vitest';
import {
  attachMotionComicReference,
  buildMotionComicConsistencyPrompt,
  collectMotionComicReferenceBundle,
  collectMotionComicReferencePaths,
  createMotionComicReferenceAsset,
  imageLabRecordIdFromMutation,
  inspectMotionComicShotConsistency,
  motionComicConsistencySummary,
  setMotionComicFixedReference,
} from '../src/features/motion-comic/motion-comic-consistency';
import { createMotionComicDraft, createMotionComicStarterProject, motionComicReferencesImageLabRecord, parseMotionComicPipelineData, type MotionComicPipelineData } from '../src/shared/motion-comic';
import type { ImageLabRecord } from '../src/shared/types';

function project(): MotionComicPipelineData {
  return createMotionComicStarterProject(createMotionComicDraft({
    id: 'comic-consistency',
    title: '雾中来信',
    premise: '一封信把两个人引向同一座车站。',
    now: '2026-09-05T00:00:00.000Z',
  }), '第一集');
}

function record(id: string, imagePath: string): ImageLabRecord {
  return {
    id,
    managedStorageKey: `managed-${id}`,
    archivedAt: null,
    prompt: `reference ${id}`,
    ratio: '16:9',
    style: 'reference',
    provider: 'local-import',
    imagePath,
    status: 'generated',
    errorMessage: '',
    resolution: '2K',
    quality: 'high',
    smartMode: 'reference-edit',
    referenceImagePaths: [],
    referenceImagePath: '',
    upstreamTaskId: 'comic-consistency',
    createdAt: '2026-09-05T00:00:00.000Z',
    finishedAt: '2026-09-05T00:00:01.000Z',
  };
}

describe('motion comic consistency references', () => {
  it('preserves every reference version after more than 100 imports', () => {
    let document = project();
    const target = { kind: 'look' as const, id: document.characters[0].looks[0].id };
    const ids: string[] = [];
    for (let index = 0; index < 105; index += 1) {
      const asset = createMotionComicReferenceAsset(record(`version-${index}`, `I:/fixture/${index}.png`), target.id, target.kind);
      ids.push(asset.id);
      document = attachMotionComicReference(document, target, asset);
    }
    const restored = parseMotionComicPipelineData(JSON.stringify(document));
    expect(restored.characters[0].looks[0].referenceAssetVersionIds).toEqual(ids);
    expect(restored.assets.filter((asset) => asset.pinned).map((asset) => asset.id)).toEqual(ids.slice(-1));
    expect(motionComicReferencesImageLabRecord(restored, 'version-0')).toBe(true);
  });

  it('keeps reference history while making the newest import the only fixed version', () => {
    const initial = project();
    const look = initial.characters[0].looks[0];
    const first = createMotionComicReferenceAsset(record('look-v1', 'C:/managed/look-v1.png'), look.id, 'look');
    const second = createMotionComicReferenceAsset(record('look-v2', 'C:/managed/look-v2.png'), look.id, 'look');

    const withFirst = attachMotionComicReference(initial, { kind: 'look', id: look.id }, first);
    const withSecond = attachMotionComicReference(withFirst, { kind: 'look', id: look.id }, second);
    const savedLook = withSecond.characters[0].looks[0];

    expect(savedLook.referenceAssetVersionIds).toEqual([first.id, second.id]);
    expect(withSecond.assets.find((asset) => asset.id === first.id)).toMatchObject({ selected: false, pinned: false });
    expect(withSecond.assets.find((asset) => asset.id === second.id)).toMatchObject({ selected: true, pinned: true });
    expect(first.providerJobId).toBeUndefined();
    expect(first.uri).toBe('storydream:image-lab/look-v1');
    expect(motionComicReferencesImageLabRecord(withSecond, 'look-v1')).toBe(true);
    expect(motionComicReferencesImageLabRecord(withSecond, 'missing')).toBe(false);
  });

  it('can restore an older fixed version or deliberately leave a target unfixed', () => {
    const initial = project();
    const look = initial.characters[0].looks[0];
    const first = createMotionComicReferenceAsset(record('look-v1', 'C:/managed/look-v1.png'), look.id, 'look');
    const second = createMotionComicReferenceAsset(record('look-v2', 'C:/managed/look-v2.png'), look.id, 'look');
    const withVersions = attachMotionComicReference(attachMotionComicReference(initial, { kind: 'look', id: look.id }, first), { kind: 'look', id: look.id }, second);

    const restored = setMotionComicFixedReference(withVersions, { kind: 'look', id: look.id }, first.id);
    expect(restored.assets.find((asset) => asset.id === first.id)).toMatchObject({ selected: true, pinned: true });
    expect(restored.assets.find((asset) => asset.id === second.id)).toMatchObject({ selected: false, pinned: false });

    const unfixed = setMotionComicFixedReference(restored, { kind: 'look', id: look.id }, null);
    expect(unfixed.assets.filter((asset) => [first.id, second.id].includes(asset.id)).every((asset) => !asset.selected && !asset.pinned)).toBe(true);
  });

  it('collects only fixed references in shot order with stable semantic labels', () => {
    let document = project();
    const shot = document.episodes[0].scenes[0].shots[0];
    const look = document.characters[0].looks[0];
    const scene = document.sceneAssets.find((item) => item.id === shot.sceneAssetId)!;
    const prop = document.props[0];
    shot.propAssetIds = [prop.id];
    document = attachMotionComicReference(document, { kind: 'look', id: look.id }, createMotionComicReferenceAsset(record('look', 'C:/managed/look.png'), look.id, 'look'));
    document = attachMotionComicReference(document, { kind: 'scene', id: scene.id }, createMotionComicReferenceAsset(record('scene', 'C:/managed/scene.png'), scene.id, 'scene'));
    document = attachMotionComicReference(document, { kind: 'prop', id: prop.id }, createMotionComicReferenceAsset(record('prop', 'C:/managed/prop.png'), prop.id, 'prop'));

    const bundle = collectMotionComicReferenceBundle(document, shot);
    expect(bundle.map((item) => item.target.kind)).toEqual(['look', 'scene', 'prop']);
    expect(bundle.map((item) => item.path)).toEqual(['C:/managed/look.png', 'C:/managed/scene.png', 'C:/managed/prop.png']);
    expect(collectMotionComicReferencePaths(document, shot)).toEqual(bundle.map((item) => item.path));
    expect(buildMotionComicConsistencyPrompt(document, shot)).toContain(`REFERENCE IMAGE ORDER: Image 1 = ${bundle[0].label} | Image 2 = ${bundle[1].label} | Image 3 = ${bundle[2].label}`);
  });

  it('reports exactly the references required by the current shot and project', () => {
    let document = project();
    const shot = document.episodes[0].scenes[0].shots[0];
    const look = document.characters[0].looks[0];
    const scene = document.sceneAssets.find((item) => item.id === shot.sceneAssetId)!;

    expect(inspectMotionComicShotConsistency(document, shot)).toMatchObject({ ready: false, fixedReferenceCount: 0 });
    document = attachMotionComicReference(document, { kind: 'look', id: look.id }, createMotionComicReferenceAsset(record('look', 'C:/managed/look.png'), look.id, 'look'));
    document = attachMotionComicReference(document, { kind: 'scene', id: scene.id }, createMotionComicReferenceAsset(record('scene', 'C:/managed/scene.png'), scene.id, 'scene'));

    expect(inspectMotionComicShotConsistency(document, shot)).toEqual({ ready: true, fixedReferenceCount: 2, missingTargets: [], exceedsProviderLimit: false });
    const summary = motionComicConsistencySummary(document);
    expect(summary.requiredTargetCount).toBeGreaterThanOrEqual(2);
    expect(summary.readyTargetCount).toBe(2);
    expect(summary.ready).toBe(false);
    expect(summary.missingTargets.length).toBeGreaterThan(0);
  });

  it('accepts only the authoritative image-lab upsert id', () => {
    expect(imageLabRecordIdFromMutation({
      kind: 'state-patch',
      patch: { kind: 'image-lab-upsert', record: { ...record('authority', 'C:/managed/authority.png'), promptPreview: 'reference' } },
      revision: 4,
    })).toBe('authority');
    expect(() => imageLabRecordIdFromMutation(null)).toThrow(/IMAGE_LAB_IMPORT_RESULT_INVALID/u);
  });
});
