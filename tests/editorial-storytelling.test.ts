import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, insertEditorialShot, parseEditorialCollagePipelineData, rebuildEditorialTimeline, setEditorialShotTitle, setEditorialShotMotionStyle } from '../src/shared/editorial-collage';
import { editorialContentTitle, editorialShotTitle, isEditorialStructureTitle } from '../src/shared/editorial-storytelling';
import { buildDirectorRenderScenes, buildDirectorSceneHtml, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { editorialImageGenerationCount } from '../src/shared/editorial-media';
import { directorImageInput } from '../src/features/director-desk/director-generation';

const source = '城市咖啡馆的秘密藏在一张桌子上。茶馆和咖啡馆的区别在于交流方式。调查记录了三次公开辩论。报纸随后沿着街道传到港口。';
const fixture = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'story-titles', title: '咖啡馆与城市' }), source, undefined, 'auto');
function addMedia(doc: ReturnType<typeof fixture>) {
  for (const shot of doc.beats.flatMap((beat) => beat.shots)) {
    for (const layer of shot.layers.filter((item) => !item.content)) {
      layer.assetVersionId = `asset-${layer.id}`;
      doc.assets.push({ id: layer.assetVersionId, assetId: layer.id, kind: 'image', localPath: `I:/fixtures/${layer.id}.png`, createdAt: doc.createdAt });
    }
    shot.voiceAssetVersionId = `voice-${shot.id}`;
    doc.assets.push({ id: shot.voiceAssetVersionId, assetId: shot.voiceAssetVersionId, kind: 'audio', localPath: 'I:/fixtures/voice.wav', createdAt: doc.createdAt });
  }
  return rebuildEditorialTimeline(doc);
}

describe('VOX audience copy and narrative motion', () => {
  it('keeps a short sentence intact and gives every scene a title from its actual copy', () => {
    const short = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'short', title: '草原生活' }), '纸片人物走进草原，文字标签随后出现。', undefined, 'auto');
    expect(short.beats).toHaveLength(1);
    expect(short.beats[0].narration).toBe('纸片人物走进草原，文字标签随后出现。');
    expect(short.beats[0].shots[0].title).toBe('纸片人物走进草原');
    const doc = fixture();
    expect(doc.beats.map((beat) => beat.title)).toEqual(['钩子', '背景', '证据', '结论']);
    const shots = doc.beats.flatMap((beat) => beat.shots);
    expect(shots.every((shot) => shot.title && source.includes(shot.title) && !isEditorialStructureTitle(shot.title))).toBe(true);
    expect(shots.map((shot) => shot.motionStyle)).toEqual(['focus-reveal', 'comparison', 'evidence-stack', 'path-progress']);
    expect(new Set(shots.map((shot) => JSON.stringify(shot.layers[1].motion))).size).toBe(4);
  });

  it('uses different object prompts for an actual comparison and reserves the required images', () => {
    const doc = fixture();
    const shot = doc.beats[1].shots[0];
    const subject = shot.layers.find((layer) => layer.id.endsWith('-subject'))!;
    const other = shot.layers.find((layer) => layer.id.endsWith('-subject-secondary'))!;
    const first = directorImageInput(doc, shot.id, subject.id);
    const second = directorImageInput(doc, shot.id, other.id);
    expect(first.prompt).toContain('representing: 茶馆.');
    expect(second.prompt).toContain('representing: 咖啡馆.');
    expect(first.prompt).not.toBe(second.prompt);
    expect(editorialImageGenerationCount(shot, doc)).toBe(3);
  });

  it('edits only the selected shot title, synchronizes native copy and persists both fields', () => {
    const doc = addMedia(fixture());
    const shot = doc.beats[0].shots[0];
    const fingerprint = directorDocumentRenderFingerprint(doc);
    let next = setEditorialShotTitle(doc, shot.id, '咖啡馆的公共讨论');
    next = setEditorialShotMotionStyle(next, shot.id, 'path-progress');
    const saved = parseEditorialCollagePipelineData(JSON.stringify(next));
    expect(saved.beats[0].title).toBe('钩子');
    expect(saved.beats[1]).toEqual(doc.beats[1]);
    expect(saved.beats[0].shots[0]).toMatchObject({ title: '咖啡馆的公共讨论', motionStyle: 'path-progress' });
    expect(saved.beats[0].shots[0].layers.find((layer) => layer.kind === 'label')?.content?.text).toBe('咖啡馆的公共讨论');
    expect(saved.beats[0].shots[0].layers[1].assetVersionId).toBe(shot.layers[1].assetVersionId);
    expect(directorDocumentRenderFingerprint(saved)).not.toBe(fingerprint);
    const scene = buildDirectorRenderScenes(saved)[0];
    expect(scene.title).toBe('咖啡馆的公共讨论');
    const html = buildDirectorSceneHtml({ ...scene, modeLabel: 'VOX', layers: scene.layers.map(({ imagePath, ...layer }) => ({ ...layer, imageUrl: imagePath ? `file:///${imagePath}` : undefined })) });
    expect(html).not.toContain('<div class="title">');
    expect(html).not.toContain('>钩子<');
    expect(html).toContain('咖啡馆的公共讨论');
  });

  it('repairs old outline text without changing media or manually edited keyframes', () => {
    const doc = addMedia(fixture());
    const shot = doc.beats[0].shots[0];
    delete shot.title;
    delete shot.motionStyle;
    const label = shot.layers.find((layer) => layer.kind === 'label')!;
    label.label = '钩子';
    label.content!.text = '钩子';
    const before = structuredClone(shot.layers.map((layer) => ({ assetVersionId: layer.assetVersionId, motion: layer.motion })));
    const next = parseEditorialCollagePipelineData(JSON.stringify(doc));
    const restored = next.beats[0].shots[0];
    expect(restored.title).toBe('城市咖啡馆的秘密藏在一张桌子上');
    expect(restored.layers.find((layer) => layer.kind === 'label')?.content?.text).toBe(restored.title);
    expect(restored.layers.map((layer) => ({ assetVersionId: layer.assetVersionId, motion: layer.motion }))).toEqual(before);
    expect(next.assets).toEqual(doc.assets);
    expect(editorialShotTitle(doc, doc.beats[0], shot)).not.toBe('钩子');
  });

  it('supports intentionally hiding titles and never invents copy when only a role is available', () => {
    expect(editorialContentTitle('钩子。', '咖啡馆与城市')).toBe('咖啡馆与城市');
    expect(editorialContentTitle('', '结论')).toBe('');
    const doc = fixture();
    const next = setEditorialShotMotionStyle(setEditorialShotTitle(doc, doc.beats[0].shots[0].id, ''), doc.beats[0].shots[0].id, 'comparison');
    expect(next.beats[0].shots[0].layers.find((layer) => layer.kind === 'label')?.visible).toBe(false);
    expect(parseEditorialCollagePipelineData(next).beats[0].shots[0].title).toBe('');
  });

  it('changes choreography on duplicated comparisons without losing the second subject or exceeding layer capacity', () => {
    const doc = addMedia(fixture());
    const original = doc.beats[1].shots[0];
    const copied = insertEditorialShot(doc, doc.beats[1].id, 1, original.id);
    const copy = copied.beats[1].shots[1];
    const focus = setEditorialShotMotionStyle(copied, copy.id, 'focus-reveal');
    const compared = setEditorialShotMotionStyle(focus, copy.id, 'comparison');
    const restored = compared.beats[1].shots[1];
    expect(restored.layers).toHaveLength(6);
    expect(restored.layers.filter((layer) => !layer.content).map((layer) => layer.assetVersionId)).toEqual(original.layers.filter((layer) => !layer.content).map((layer) => layer.assetVersionId));
    expect(() => parseEditorialCollagePipelineData(compared)).not.toThrow();
  });
});
