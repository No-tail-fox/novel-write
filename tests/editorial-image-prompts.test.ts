import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { buildEditorialScenePrompt, EDITORIAL_IMAGE_REQUEST_OPTIONS, resolveEditorialScenePrompt } from '../src/shared/editorial-image-prompts';
import { directorImageInput, directorImageInputMatches } from '../src/features/director-desk/director-generation';
import { generateImageLabRecord } from '../src/shared/image-lab';
import { defaultConfig } from '../src/shared/config';
import { recomposeEditorialMotionLayers } from '../src/shared/editorial-motion';

const narration = '城市沿着河流发展。';
const fixture = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'prompt-audit', title: '河流与城市', ratio: '16:9' }), narration);
afterEach(() => vi.unstubAllGlobals());

describe('VOX visual briefs and image provider payloads', () => {
  it('creates editable subject, action, depth and composition instructions with narration marked as context', () => {
    const shot = fixture().beats[0].shots[0];
    expect(shot.scenePrompt).toContain('主体与动作：');
    expect(shot.scenePrompt).toContain('场景与层次：');
    expect(shot.scenePrompt).toContain('旁白语义参考（仅供理解，不是画面文字）');
    expect(shot.scenePrompt).not.toBe(`16:9 editorial collage, ${narration}`);
    const comparison = buildEditorialScenePrompt({ narration: '红茶与绿茶的区别', ratio: '9:16', motionStyle: 'comparison' });
    expect(comparison).toContain('相同视角、比例和照明');
    expect(comparison).not.toEqual(shot.scenePrompt);
  });

  it('upgrades exact legacy raw narration wrappers at request time without overwriting custom scene text', () => {
    const options = { narration, ratio: '16:9', knownStylePrompts: ['archival paper collage'] };
    expect(resolveEditorialScenePrompt({ ...options, scenePrompt: `archival paper collage. 16:9 editorial collage, ${narration}` })).toContain('主体与动作：');
    const authored = `16:9 editorial collage, ${narration} A hand-built red bridge at dusk.`;
    expect(resolveEditorialScenePrompt({ ...options, scenePrompt: authored })).toBe(authored);
    const doc = fixture();
    const shot = doc.beats[0].shots[0];
    shot.scenePrompt = `16:9 editorial collage, ${narration}`;
    expect(directorImageInput(doc, shot.id).prompt).toContain('主体与动作：');
    expect(shot.scenePrompt).toBe(`16:9 editorial collage, ${narration}`);
  });

  it('keeps full-frame recipe and layout requests out of independent background and cutout outputs', () => {
    const doc = fixture();
    const shot = doc.beats[0].shots[0];
    shot.productionRecipe = 'paper-cut';
    shot.layoutTemplate = '漫画分格 · 角色优先';
    const background = directorImageInput(doc, shot.id, shot.layers[0].id);
    const subject = directorImageInput(doc, shot.id, shot.layers[1].id);
    for (const input of [background, subject]) {
      expect(input.prompt).not.toContain('Establish one clear hero subject and a restrained supporting object');
      expect(input.prompt).not.toContain('Layout: 漫画分格');
      expect(input.prompt).not.toContain('OUTPUT TARGET — COMPLETE COMPOSED KEYFRAME');
    }
    expect(background.prompt).toContain('No people, no foreground hero objects');
    expect(background.prompt).not.toContain('#00FF00');
    expect(subject.prompt).toContain('perfectly uniform to all four edges');
    const keyframe = directorImageInput(doc, shot.id);
    expect(keyframe.prompt).toContain('OUTPUT TARGET — COMPLETE COMPOSED KEYFRAME');
    expect(keyframe.prompt).toContain('Layout: 漫画分格');
    expect(keyframe.prompt).not.toContain('#00FF00');
  });

  it('preserves authored scene and layer instructions, and rejects late results after either is edited', () => {
    const doc = fixture();
    const shot = doc.beats[0].shots[0];
    const layer = shot.layers[1];
    shot.scenePrompt = 'A red iron bridge above a narrow river at blue hour.';
    layer.prompt = 'One rusty red iron bridge, side elevation, complete silhouette.';
    const input = directorImageInput(doc, shot.id, layer.id);
    expect(input.prompt).toContain(shot.scenePrompt);
    expect(input.prompt).toContain(layer.prompt);
    expect(directorImageInputMatches(doc, input)).toBe(true);
    layer.prompt += ' Keep all three arches.';
    expect(directorImageInputMatches(doc, input)).toBe(false);
    const nextInput = directorImageInput(doc, shot.id, layer.id);
    shot.scenePrompt += ' Morning light.';
    expect(directorImageInputMatches(doc, nextInput)).toBe(false);
  });

  it('does not discard a user addition to a generated layer prompt when changing the animation', () => {
    const doc = fixture();
    const shot = doc.beats[0].shots[0];
    shot.layers[1].prompt += '\nUse a red bridge with exactly three arches.';
    const changed = recomposeEditorialMotionLayers(shot.layers, { shotId: shot.id, title: '河流与城市', narration, ratio: doc.ratio, durationMs: shot.durationMs, index: 0, motionStyle: 'focus-reveal' });
    expect(changed[1].prompt).toBe(shot.layers[1].prompt);
  });

  it('sends the assembled VOX prompt unchanged to the actual provider adapter without a magazine or presenter prefix', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-vox-prompt-'));
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('local-fixture').toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    try {
      const doc = fixture();
      const shot = doc.beats[0].shots[0];
      const config = { ...defaultConfig, imageProvider: 'gpt_image' as const, gptImage: { ...defaultConfig.gptImage, baseUrl: 'https://fixture.invalid', apiKey: 'fixture-only', model: 'gpt-image-2' } };
      for (const layerId of [shot.layers[0].id, shot.layers[1].id, undefined]) {
        const input = directorImageInput(doc, shot.id, layerId);
        const record = await generateImageLabRecord(config, directory, { prompt: input.prompt, ratio: input.ratio, ...EDITORIAL_IMAGE_REQUEST_OPTIONS });
        expect(record.status).toBe('generated');
        expect(requests.at(-1)?.prompt).toBe(input.prompt);
        expect(String(requests.at(-1)?.prompt)).not.toContain('现代杂志插画');
        expect(String(requests.at(-1)?.prompt)).not.toContain('单人讲述感');
      }
      expect(requests).toHaveLength(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
