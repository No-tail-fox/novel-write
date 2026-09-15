import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, insertEditorialShot, parseEditorialCollagePipelineData, rebuildEditorialTimeline, splitEditorialShot } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes, buildDirectorSceneHtml, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { createEditorialMotionLayers } from '../src/shared/editorial-motion';

function renderablePlan(ratio: '9:16' | '16:9' = '9:16') {
  const plan = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'motion-plan', title: '城市的改变', ratio }), '咖啡馆改变城市。报纸传播知识。');
  for (const shot of plan.beats.flatMap((beat) => beat.shots)) {
    for (const layer of shot.layers.filter((layer) => !layer.content)) {
      layer.assetVersionId = `asset-${layer.id}`;
      plan.assets.push({ id: layer.assetVersionId, assetId: layer.id, kind: 'image', localPath: `C:/managed/${layer.id}.png`, createdAt: plan.createdAt });
    }
    shot.voiceAssetVersionId = `voice-${shot.id}`;
    plan.assets.push({ id: shot.voiceAssetVersionId, assetId: shot.voiceAssetVersionId, kind: 'audio', localPath: `C:/managed/${shot.id}.wav`, createdAt: plan.createdAt });
  }
  return rebuildEditorialTimeline(plan);
}

describe('complete editorial motion scenes', () => {
  it('uses independent artwork, accurate labels and staggered entrance, hold and exit in both aspect ratios', () => {
    const create = (ratio: string) => createEditorialMotionLayers({ shotId: 'shot', title: '报纸改变城市', narration: '报纸改变城市', durationMs: 5000, index: 0, ratio });
    const portrait = create('9:16');
    const landscape = create('16:9');
    expect(portrait.map((layer) => [layer.source, layer.required])).toEqual([['generated-image', true], ['generated-image', true], ['svg', true]]);
    expect(portrait[0].prompt).toContain('No people');
    expect(portrait[1].prompt).toContain('Solid pure green');
    expect(portrait[1].fit).toBe('contain');
    expect(portrait[2].content).toEqual({ type: 'text', text: '报纸改变城市' });
    expect(portrait[1].width).toBeGreaterThan(landscape[1].width!);
    expect(portrait[1].motion[0].x - portrait[1].motion[3].x).toBeGreaterThan(0.8);
    expect(portrait[1].motion[0].rotation).not.toBe(portrait[1].motion[3].rotation);
    expect(portrait[1].motion[3].opacity).toBe(1);
    expect(portrait[1].motion.at(-1)?.opacity).toBe(0);
    expect(portrait[2].motion.find((frame) => frame.opacity === 1)!.atMs).toBeGreaterThan(portrait[1].motion.find((frame) => frame.opacity === 1)!.atMs);
    expect(portrait[1].motion.at(-2)!.atMs - portrait[1].motion[3].atMs).toBeGreaterThan(2500);
  });

  it('persists layer boxes and label copy through save, duplicate and splitting, and fingerprints their changes', () => {
    const plan = renderablePlan();
    plan.beats[0].shots[0].keyframeAssetVersionId = plan.beats[0].shots[0].layers[0].assetVersionId;
    expect(parseEditorialCollagePipelineData(JSON.stringify(plan))).toEqual(plan);
    const shot = plan.beats[0].shots[0];
    const duplicated = insertEditorialShot(plan, shot.beatId, 1, shot.id);
    expect(duplicated.beats[0].shots[1].keyframeAssetVersionId).toBe(shot.keyframeAssetVersionId);
    expect(duplicated.beats[0].shots[1].layers.map(({ width, height, fit, content, required }) => ({ width, height, fit, content, required }))).toEqual(shot.layers.map(({ width, height, fit, content, required }) => ({ width, height, fit, content, required })));
    const split = splitEditorialShot(plan, shot.id, Math.round(shot.durationMs / 2));
    expect(split.beats[0].shots[1].layers[2].content).toEqual(shot.layers[2].content);
    expect(split.beats[0].shots[1].layers[1].width).toBe(shot.layers[1].width);
    const fingerprint = directorDocumentRenderFingerprint(plan);
    const resized = structuredClone(plan);
    resized.beats[0].shots[0].layers[1].width = 0.7;
    expect(directorDocumentRenderFingerprint(resized)).not.toBe(fingerprint);
    const relabelled = structuredClone(plan);
    relabelled.beats[0].shots[0].layers[2].content!.text = '新的证据';
    expect(directorDocumentRenderFingerprint(relabelled)).not.toBe(fingerprint);
  });

  it('loads legacy SVG placeholders but refuses to silently drop missing subjects during export', () => {
    const plan = renderablePlan();
    const subject = plan.beats[0].shots[0].layers[1];
    subject.source = 'svg';
    delete subject.assetVersionId;
    delete subject.required;
    const legacy = rebuildEditorialTimeline(plan);
    expect(() => parseEditorialCollagePipelineData(JSON.stringify(legacy))).not.toThrow();
    expect(() => buildDirectorRenderScenes(legacy)).toThrow('补齐分层素材');
  });

  it('rejects one poster reused across nominally separate layers', () => {
    const plan = renderablePlan();
    const shot = plan.beats[0].shots[0];
    shot.layers[1].assetVersionId = shot.layers[0].assetVersionId;
    expect(() => buildDirectorRenderScenes(rebuildEditorialTimeline(plan))).toThrow('独立背景和主体图片');
  });

  it('allows an explicitly optional decoration to be absent while retaining the complete scene', () => {
    const plan = renderablePlan();
    plan.beats[0].shots[0].layers.push({ id: 'optional-texture', label: '纸张纹理', kind: 'texture', source: 'svg', zIndex: 30, depth: 0, required: false, motion: [] });
    expect(buildDirectorRenderScenes(rebuildEditorialTimeline(plan))[0].layers).toHaveLength(3);
  });

  it('renders native text safely without a file and seeks sized layers in canvas coordinates', async () => {
    const plan = renderablePlan();
    plan.beats[0].shots[0].layers[2].content!.text = '<script>准确文字 & 数字 2026</script>';
    const scene = buildDirectorRenderScenes(plan)[0];
    const native = scene.layers[2];
    expect(native.imagePath).toBeUndefined();
    const html = buildDirectorSceneHtml({ ...scene, modeLabel: 'VOX', layers: scene.layers.map(({ imagePath, ...layer }) => ({ ...layer, ...(imagePath ? { imageUrl: `file:///${imagePath}` } : {}) })) });
    expect(html).toContain('&lt;script&gt;准确文字 &amp; 数字 2026&lt;/script&gt;');
    expect(html).not.toContain('src="undefined"');
    expect(html).toContain('scene-cutout');
    expect(html).toContain('drop-shadow');
    const elements = scene.layers.map(() => ({ style: {} as Record<string, string> }));
    const stage = { style: {} as Record<string, string> };
    const window: { __tl?: { seek(seconds: number): Promise<void> }; __ready?: boolean } = {};
    runInNewContext(html.match(/<script nonce="director-render">([\s\S]+)<\/script>/)![1], {
      window,
      document: { getElementById: (id: string) => id === 'scene-video' ? null : stage, querySelectorAll: () => [], querySelector: (selector: string) => elements[Number(selector.match(/"(\d+)"/)![1])] },
      performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    });
    expect(window.__ready).toBe(true);
    const actor = scene.layers[1];
    const settled = actor.motion[3];
    await window.__tl!.seek(settled.atMs / 1000);
    expect(elements[1].style.left).toBe(`${settled.x * 100}%`);
    expect(elements[1].style.top).toBe(`${settled.y * 100}%`);
    expect(elements[1].style.width).toBe(`${actor.width! * 100}%`);
    expect(elements[1].style.objectFit).toBe('contain');
    expect(elements[1].style.transform).toBe(`translate3d(-50%, -50%, 0) scale(${settled.scale}) rotate(${settled.rotation}deg)`);
    await window.__tl!.seek(scene.durationMs / 1000);
    expect(elements[1].style.opacity).toBe('0');
  });

  it('mixes local motion and actual generated video across shots and blocks unfinished video jobs', () => {
    const plan = renderablePlan();
    const shots = plan.beats.flatMap((beat) => beat.shots);
    const shot = shots.at(-1)!;
    shot.renderStrategy = 'living-poster';
    shot.layers.forEach((layer) => { delete layer.assetVersionId; });
    shot.videoJobId = 'video-job';
    shot.videoAssetVersionId = 'video-asset';
    plan.assets.push({ id: 'video-asset', assetId: 'video', kind: 'video', providerJobId: 'video-job', localPath: 'C:/managed/video.mp4', createdAt: plan.createdAt });
    plan.providerJobs.push({ id: 'video-job', workflowKind: 'editorial-collage', nodeId: shot.id, providerId: 'video-provider', model: 'video-model', capability: 'image-to-video', status: 'completed', inputHash: 'test', idempotencyKey: 'test', estimatedCost: 0, attempt: 1, createdAt: plan.createdAt, updatedAt: plan.updatedAt });
    const scenes = buildDirectorRenderScenes(rebuildEditorialTimeline(plan));
    expect(scenes[0].renderStrategy).toBe('deterministic-layers');
    expect(scenes.at(-1)).toMatchObject({ renderStrategy: 'living-poster', videoPath: 'C:/managed/video.mp4', layers: [] });
    plan.providerJobs[0].status = 'running';
    expect(() => buildDirectorRenderScenes(rebuildEditorialTimeline(plan))).toThrow('尚未成功完成');
  });
});
