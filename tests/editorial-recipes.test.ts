import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { applyEditorialRecipe, setEditorialLastFrame, setEditorialRecipeKeyframe } from '../src/shared/editorial-recipes';
import { buildEditorialShotVideoRequest, editorialVideoFrames, editorialImageGenerationCount } from '../src/shared/editorial-media';
import { applyEditorialImageRecord, directorImageInput, directorImageInputMatches, resolveDirectorVideoProviderStatus } from '../src/features/director-desk/director-generation';
import { directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { createConfiguredVideoProvider, requiredVideoCapabilities } from '../src/shared/video-provider';
import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import type { ImageLabRecord } from '../src/shared/types';

const now = '2026-09-15T00:00:00.000Z';
const fixture = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'recipe-film', title: '桥梁与城市', now }), '城市沿着河流发展。桥梁连接了两岸。', now);
const image = (id: string, localPath = `I:/fixtures/${id}.png`) => ({ id, assetId: id, kind: 'image' as const, localPath, createdAt: now });
afterEach(() => vi.unstubAllGlobals());

describe('VOX production recipes', () => {
  it('round-trips each real recipe while preserving authored narration and scene text', () => {
    for (const id of ['paper-cut', 'vox-narrated', 'collage-broll', 'nantian'] as const) {
      const original = fixture(), shotId = original.beats[0].shots[0].id;
      const doc = parseEditorialCollagePipelineData(applyEditorialRecipe(original, shotId, id));
      expect(doc.beats[0].shots[0].productionRecipe).toBe(id);
      expect(doc.beats[0].narration).toBe(original.beats[0].narration);
      expect(doc.beats[0].shots[0].scenePrompt).toBe(original.beats[0].shots[0].scenePrompt);
      expect(doc.beats[1]).toEqual(original.beats[1]);
    }
  });

  it('generates the Paper Cut hero first and sends it as a reference for distinct layer jobs', () => {
    const initial = fixture(), id = initial.beats[0].shots[0].id;
    let doc = applyEditorialRecipe(initial, id, 'paper-cut');
    expect(editorialImageGenerationCount(doc.beats[0].shots[0], doc)).toBe(3);
    const input = directorImageInput(doc, id);
    expect(input).toMatchObject({ target: 'keyframe', references: [] });
    const record: ImageLabRecord = { id: 'hero-job', prompt: input.prompt, ratio: input.ratio, style: 'magazine', provider: 'gpt_image', imagePath: 'I:/fixtures/hero.png', status: 'generated', errorMessage: '', resolution: '2K', smartMode: 'video-narration', referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: null, createdAt: now, finishedAt: now };
    doc = applyEditorialImageRecord(doc, id, record, 'test-model', input);
    const shot = doc.beats[0].shots[0];
    expect(shot.keyframeAssetVersionId).toBe('image-asset-hero-job');
    expect(shot.layers[0].assetVersionId).toBeUndefined();
    const background = directorImageInput(doc, id, shot.layers[0].id), subject = directorImageInput(doc, id, shot.layers[1].id);
    expect(background.references).toEqual([{ assetVersionId: shot.keyframeAssetVersionId, path: record.imagePath }]);
    expect(background.prompt).toContain('Remove the hero');
    expect(subject.prompt).toContain('Isolate the requested subject');
    expect(editorialImageGenerationCount(shot, doc)).toBe(2);
    doc.assets.push(image('replacement'));
    doc = setEditorialRecipeKeyframe(doc, id, 'replacement');
    expect(directorImageInputMatches(doc, background)).toBe(false);
  });

  it('uses Remotion with the paper template and a real timing instruction', () => {
    const doc = fixture(), id = doc.beats[0].shots[0].id;
    const shot = applyEditorialRecipe(doc, id, 'vox-narrated').beats[0].shots[0];
    expect(shot.renderStrategy).toBe('remotion');
    expect(shot.animation?.template.id).toBe('paper-actors');
    expect(shot.animation?.code.prompt).toContain('props.cues');
    expect(editorialImageGenerationCount(shot)).toBe(0);
  });

  it('blocks Nantian before a paid call until both project images exist', () => {
    const original = fixture(), id = original.beats[0].shots[0].id;
    let doc = applyEditorialRecipe(original, id, 'nantian');
    doc.assets.push(image('first'), image('last'));
    doc = setEditorialRecipeKeyframe(doc, id, 'first');
    expect(editorialVideoFrames(doc, doc.beats[0].shots[0]).ready).toBe(false);
    expect(() => buildEditorialShotVideoRequest(doc, doc.beats[0].shots[0])).toThrow('尾帧');
    doc = setEditorialLastFrame(doc, id, 'last');
    const request = buildEditorialShotVideoRequest(doc, doc.beats[0].shots[0]);
    expect(request).toMatchObject({ firstFramePath: 'I:/fixtures/first.png', lastFramePath: 'I:/fixtures/last.png' });
    expect(requiredVideoCapabilities(request)).toEqual(['i2v', 'first-last-frame']);
    expect(request.prompt).toContain('Match the last-frame composition');
    expect(() => setEditorialLastFrame(doc, id, 'missing')).toThrow('尾帧');
  });

  it('invalidates an old video and its render fingerprint when the ending changes without deleting its history', () => {
    const original = fixture(), id = original.beats[0].shots[0].id;
    let doc = applyEditorialRecipe(original, id, 'nantian');
    doc.assets.push(image('first'), image('last'), image('replacement'));
    doc = setEditorialRecipeKeyframe(doc, id, 'first');
    doc = setEditorialLastFrame(doc, id, 'last');
    doc.beats[0].shots[0].videoAssetVersionId = 'old-video';
    const fingerprint = directorDocumentRenderFingerprint(doc), assets = structuredClone(doc.assets);
    const updated = setEditorialLastFrame(doc, id, 'replacement');
    expect(updated.assets).toEqual(assets);
    expect(updated.beats[0].shots[0].videoAssetVersionId).toBeUndefined();
    expect(directorDocumentRenderFingerprint(updated)).not.toBe(fingerprint);
  });

  it('does not advertise an I2V-only provider as capable of the Nantian recipe', () => {
    const config = normalizeAppConfig(defaultConfig), provider = config.video.providers[0];
    Object.assign(provider, { enabled: true, baseUrl: 'https://test.invalid', model: 'test', capabilities: ['i2v'], maxDurationSec: 15 });
    config.video.automation.providerWhitelist = [provider.id];
    const secrets = { [`video/${encodeURIComponent(provider.id)}/apiKey`]: true };
    expect(resolveDirectorVideoProviderStatus(config, secrets, { durationMs: 5000, requiresLastFrame: true }).connected).toBe(false);
    provider.capabilities.push('first-last-frame');
    expect(resolveDirectorVideoProviderStatus(config, secrets, { durationMs: 5000, requiresLastFrame: true }).connected).toBe(true);
  });

  it('submits the selected first and last frame bytes through the real provider adapter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vox-recipe-test-'));
    try {
      const first = join(dir, 'first.png'), last = join(dir, 'last.png');
      await writeFile(first, 'first-frame'); await writeFile(last, 'last-frame');
      let payload: Record<string, unknown> | undefined;
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit = {}) => {
        if (init.body) { payload = JSON.parse(String(init.body)); return new Response(JSON.stringify({ data: [{ url: 'https://test.invalid/result.mp4' }] }), { headers: { 'content-type': 'application/json' } }); }
        return new Response('video-fixture', { headers: { 'content-type': 'video/mp4' } });
      }));
      let doc = fixture(); const id = doc.beats[0].shots[0].id;
      doc = applyEditorialRecipe(doc, id, 'nantian'); doc.assets.push(image('first', first), image('last', last));
      doc = setEditorialRecipeKeyframe(doc, id, 'first'); doc = setEditorialLastFrame(doc, id, 'last');
      const request = buildEditorialShotVideoRequest(doc, doc.beats[0].shots[0]);
      const config = normalizeAppConfig(defaultConfig), provider = config.video.providers[0];
      Object.assign(provider, { enabled: true, baseUrl: 'https://test.invalid/v1', apiKey: 'test-key', model: 'test-model', capabilities: ['i2v', 'first-last-frame'], maxDurationSec: 15 });
      config.video.automation.providerWhitelist = [provider.id];
      const adapter = createConfiguredVideoProvider(config, dir, { durationSec: request.durationSec, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: config.video.automation.budgetLimit }, { submitRetryCount: 0 });
      const result = await adapter.generate(request);
      expect(payload?.first_frame_image).toBe('data:image/png;base64,' + Buffer.from('first-frame').toString('base64'));
      expect(payload?.last_frame_image).toBe('data:image/png;base64,' + Buffer.from('last-frame').toString('base64'));
      expect(await readFile(result.path, 'utf8')).toBe('video-fixture');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
