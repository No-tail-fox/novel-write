import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { applyEditorialImageRecord, directorImageInput, prepareEditorialLayerGeneration, restoreEditorialImageVersion } from '../src/features/director-desk/director-generation';
import { editorialImageGenerationCount, editorialKeyframeAssetId, editorialShotImagesReady, editorialVideoPrompt } from '../src/shared/editorial-media';
import type { ImageLabRecord } from '../src/shared/types';

const now = '2026-09-14T00:00:00.000Z';
const fixture = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox-two-routes', title: '城市发展', now }), '城市沿着河流发展。桥梁改变了交通。', now);
const record = (input: ReturnType<typeof directorImageInput>, id: string): ImageLabRecord => ({
  id, prompt: input.prompt, ratio: input.ratio, style: 'magazine', provider: 'gpt_image', imagePath: `I:/fixture/${id}.png`,
  status: 'generated', errorMessage: '', resolution: '2K', smartMode: 'text-to-image', referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: null, createdAt: now, finishedAt: now,
});

describe('VOX independent local and image-to-video routes', () => {
  it('generates and versions each local layer separately without pretending the first image completes the shot', () => {
    let doc = fixture();
    const shot = doc.beats[0].shots[0];
    const background = directorImageInput(doc, shot.id, shot.layers[0].id);
    expect(background.prompt).toContain('Background plate only');
    doc = applyEditorialImageRecord(doc, shot.id, record(background, 'plate'), 'image-model', background);
    expect(editorialShotImagesReady(doc, doc.beats[0].shots[0])).toBe(false);
    const subject = directorImageInput(doc, shot.id, shot.layers[1].id);
    expect(subject.prompt).toContain('#00FF00');
    doc = applyEditorialImageRecord(doc, shot.id, record(subject, 'subject'), 'image-model', subject);
    expect(editorialShotImagesReady(doc, doc.beats[0].shots[0])).toBe(true);
    expect(doc.beats[0].shots[0].layers.map(layer => layer.assetVersionId)).toEqual(['image-asset-plate', 'image-asset-subject', undefined]);
    expect(doc.assets.map(asset => asset.assetId)).toEqual([`shot-layer-${shot.id}:${shot.layers[0].id}`, `shot-layer-${shot.id}:${shot.layers[1].id}`]);
    expect(parseEditorialCollagePipelineData(doc).beats[0].shots[0].layers[2].content?.type).toBe('text');
  });

  it('keeps separated assets when creating an AI keyframe and when switching back', () => {
    let doc = fixture();
    let shot = doc.beats[0].shots[0];
    for (const layer of shot.layers.filter(layer => !layer.content)) {
      const input = directorImageInput(doc, shot.id, layer.id);
      doc = applyEditorialImageRecord(doc, shot.id, record(input, layer.kind), 'image-model', input);
    }
    shot = doc.beats[0].shots[0];
    const layers = structuredClone(shot.layers);
    shot.renderStrategy = 'living-poster';
    expect(editorialKeyframeAssetId(shot)).toBeUndefined();
    expect(editorialShotImagesReady(doc, shot)).toBe(false);
    const input = directorImageInput(doc, shot.id);
    doc = applyEditorialImageRecord(doc, shot.id, record(input, 'composed-frame'), 'image-model', input);
    expect(doc.beats[0].shots[0].layers).toEqual(layers);
    expect(editorialKeyframeAssetId(doc.beats[0].shots[0])).toBe('image-asset-composed-frame');
    doc.beats[0].shots[0].renderStrategy = 'deterministic-layers';
    expect(editorialShotImagesReady(doc, doc.beats[0].shots[0])).toBe(true);
    expect(parseEditorialCollagePipelineData(rebuildEditorialTimeline(doc)).beats[0].shots[0].keyframeAssetVersionId).toBe('image-asset-composed-frame');
  });

  it('rejects a late layer result after mode switching while preserving completed assets in history', () => {
    const doc = fixture();
    const shot = doc.beats[0].shots[0];
    const input = directorImageInput(doc, shot.id, shot.layers[1].id);
    shot.renderStrategy = 'living-poster';
    const next = applyEditorialImageRecord(doc, shot.id, record(input, 'late'), 'image-model', input);
    expect(next.beats).toEqual(doc.beats);
    expect(next.assets.at(-1)).toMatchObject({ selected: false, assetId: `shot-layer-${shot.id}:${shot.layers[1].id}` });
  });

  it('restores a foreground version to its own layer and preserves an existing AI video', () => {
    let doc = fixture();
    const shot = doc.beats[0].shots[0];
    for (const id of ['old', 'new']) {
      const input = directorImageInput(doc, shot.id, shot.layers[1].id);
      doc = applyEditorialImageRecord(doc, shot.id, record(input, id), 'image-model', input);
    }
    Object.assign(doc.beats[0].shots[0], { videoJobId: 'video-job', videoAssetVersionId: 'video' });
    const next = restoreEditorialImageVersion(doc, shot.id, 'image-asset-old');
    expect(next.beats[0].shots[0].layers[0].assetVersionId).toBeUndefined();
    expect(next.beats[0].shots[0].layers[1].assetVersionId).toBe('image-asset-old');
    expect(next.beats[0].shots[0].videoAssetVersionId).toBe('video');
  });

  it('upgrades a legacy flattened poster to missing independent assets and retains the poster as the AI keyframe', () => {
    let doc = fixture();
    const shot = doc.beats[0].shots[0];
    shot.layers = shot.layers.map(({ required, content, width, height, fit, ...layer }) => ({ ...layer, source: 'svg' as const }));
    const input = directorImageInput(doc, shot.id);
    doc = applyEditorialImageRecord(doc, shot.id, record(input, 'legacy'), 'image-model', input);
    const next = prepareEditorialLayerGeneration(doc, shot.id);
    expect(next.beats[0].shots[0].keyframeAssetVersionId).toBe('image-asset-legacy');
    expect(next.beats[0].shots[0].layers.filter(layer => !layer.content).every(layer => !layer.assetVersionId)).toBe(true);
    expect(next.assets).toEqual(doc.assets);
    expect(prepareEditorialLayerGeneration(next, shot.id)).toBe(next);
  });

  it('describes element action and camera motion separately for real I2V generation', () => {
    const prompt = editorialVideoPrompt({ scenePrompt: '桥梁连接两岸', motionPrompt: '桥梁从左岸延伸到右岸，车辆沿桥前进' });
    expect(prompt).toContain('ELEMENT ACTION: 桥梁从左岸延伸到右岸，车辆沿桥前进');
    expect(prompt).toContain('CAMERA:');
    expect(prompt).toContain('Animate objects within the composition');
  });

  it('repairs legacy native labels without losing authored layers and counts only the missing images', () => {
    let doc = fixture();
    let shot = doc.beats[0].shots[0];
    for (const layer of shot.layers.filter((item) => !item.content)) {
      const input = directorImageInput(doc, shot.id, layer.id);
      doc = applyEditorialImageRecord(doc, shot.id, record(input, layer.kind), 'image-model', input);
    }
    shot = doc.beats[0].shots[0];
    shot.layers.forEach((layer) => { delete layer.required; });
    delete shot.layers[2].content;
    shot.layers.push({ ...shot.layers[1], id: 'second-actor', assetVersionId: undefined });
    const before = structuredClone(shot.layers.slice(0, 2));
    const next = prepareEditorialLayerGeneration(doc, shot.id);
    const prepared = next.beats[0].shots[0];
    expect(prepared.layers.slice(0, 2)).toEqual(before);
    expect(prepared.layers[2].content?.text).toBe(shot.layers[2].label);
    expect(editorialImageGenerationCount(shot)).toBe(3);
    expect(editorialImageGenerationCount(shot, doc)).toBe(1);
    expect(editorialImageGenerationCount(prepared, next)).toBe(1);
  });

  it('restores a composed keyframe from the shelf without replacing any separated image', () => {
    let doc = fixture();
    const shotId = doc.beats[0].shots[0].id;
    doc.beats[0].shots[0].renderStrategy = 'living-poster';
    for (const id of ['frame-old', 'frame-new']) {
      const input = directorImageInput(doc, shotId);
      doc = applyEditorialImageRecord(doc, shotId, record(input, id), 'image-model', input);
    }
    doc.beats[0].shots[0].renderStrategy = 'deterministic-layers';
    const before = structuredClone(doc.beats[0].shots[0].layers);
    const next = restoreEditorialImageVersion(doc, shotId, 'image-asset-frame-old');
    expect(next.beats[0].shots[0].layers).toEqual(before);
    expect(next.beats[0].shots[0].keyframeAssetVersionId).toBe('image-asset-frame-old');
    expect(next.assets.find((asset) => asset.id === 'image-asset-frame-old')?.selected).toBe(true);
    expect(next.assets.find((asset) => asset.id === 'image-asset-frame-new')?.selected).toBe(false);
  });

  it('does not accept the same poster as both completed local assets', () => {
    const doc = fixture();
    const shot = doc.beats[0].shots[0];
    doc.assets.push({ id: 'poster', assetId: 'poster', kind: 'image', localPath: 'I:/media/poster.png', createdAt: now });
    shot.layers[0].assetVersionId = 'poster';
    shot.layers[1].assetVersionId = 'poster';
    expect(editorialShotImagesReady(doc, shot)).toBe(false);
  });
});
