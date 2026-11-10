import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import { markSceneImagesForRegeneration } from '@shared/pipeline-cache';
import { createOrdinaryTaskPipelineData } from '@shared/ordinary-task-options';
import { adaptHtmlVideoAssetGenerator, adaptHtmlVideoCoverGenerator } from '@shared/task-runtime-providers';
import { resolveHtmlVideoCoverForRender } from '@shared/html-video-runner';
import { createHtmlVideoPipelineData, validateHtmlVideoAssets } from '@shared/html-video-workflow';
import { createHtmlVideoCoverAsset } from '@shared/html-video-cover';
import { defaultCustomCoverTemplates } from '@shared/config';
import type { ImageBudgetPolicy } from '@shared/image-budget';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';
import type { CustomCoverTemplate, HtmlVideoAsset, HtmlVideoScenePlan, ImagePrompt, PipelineArtifact, StoryboardScene, Task } from '@shared/types';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

async function withDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// HTML route
// ---------------------------------------------------------------------------------------------

function htmlScenes(count: number): HtmlVideoScenePlan[] {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    narration: `第${index + 1}幕。`,
    title: `第${index + 1}幕`,
    captions: [`第${index + 1}幕。`],
    sceneTemplate: 'center-focus' as const,
    background: { prompt: `背景 ${index + 1}` },
    elements: [{ slot: 0, prompt: `主体 ${index + 1}` }],
  }));
}

async function runHtmlAssets(dir: string, imageBudget: ImageBudgetPolicy | undefined, existingAssets?: HtmlVideoAsset[]) {
  const calls: string[] = [];
  const task = { id: 'html-budget', title: 'HTML budget', style: 'modern-film', ratio: '9:16', speaker: 'voice' } as Task;
  const generate = adaptHtmlVideoAssetGenerator(async (scenes, prompts) => {
    const assets = [];
    for (const [index, scene] of scenes.entries()) {
      calls.push(prompts[index].prompt);
      const path = join(dir, `provider-${calls.length}.png`);
      await writeFile(path, `image ${scene.id}`);
      assets.push({ sceneId: scene.id, path });
    }
    return assets;
  }, task, { inspectAssetTransparency: async () => true, dedupeIdenticalPrompts: true, workDir: dir });
  const config = { foreground: true, ...(imageBudget ? { imageBudget } : {}) };
  const scenes = htmlScenes(6);
  const assets = await generate({ scenes, config, ...(existingAssets ? { existingAssets } : {}) });
  // The runner validates the result the same way.
  validateHtmlVideoAssets(assets, scenes, config, 'assets');
  return { calls, assets: assets.map((asset) => ({ ...asset, src: relative(dir, asset.src).replace(/\\/gu, '/') })) };
}

describe('H-5 image budget — HTML route', () => {
  it('old configs (no imageBudget) keep the exact provider calls and outputs', async () => {
    const absent = await withDir('budget-html-absent-', (dir) => runHtmlAssets(dir, undefined));
    const standard = await withDir('budget-html-standard-', (dir) => runHtmlAssets(dir, { mode: 'standard' }));
    expect(absent.calls).toHaveLength(12);
    expect(absent.calls.filter((prompt) => prompt.includes('主体'))).toHaveLength(6);
    expect(standard).toEqual(absent);
    expect(absent.assets.every((asset) => !asset.src.includes('.reuse-'))).toBe(true);
  });

  it('counts provider calls per mode; reused slots never call the provider', async () => {
    const economy = await withDir('budget-html-economy-', (dir) => runHtmlAssets(dir, { mode: 'economy' }));
    expect(economy.calls).toHaveLength(6);
    expect(economy.calls.some((prompt) => prompt.includes('主体'))).toBe(false);
    expect(economy.assets.map((asset) => `${asset.sceneIndex}:${asset.kind}`)).toEqual(['1:bg', '2:bg', '3:bg', '4:bg', '5:bg', '6:bg']);

    const minimal = await withDir('budget-html-minimal-', (dir) => runHtmlAssets(dir, { mode: 'minimal' }));
    expect(minimal.calls).toEqual([expect.stringContaining('背景 1'), expect.stringContaining('背景 4')]);
    expect(minimal.assets).toHaveLength(6);
    const reused = minimal.assets.filter((asset) => asset.src.includes('.reuse-'));
    expect(reused.map((asset) => asset.sceneIndex)).toEqual([2, 3, 5, 6]);
    // each reused slot owns a private copy, so a single-slot regenerate never touches its source
    expect(new Set(minimal.assets.map((asset) => asset.src)).size).toBe(6);

    const capped = await withDir('budget-html-cap-', (dir) => runHtmlAssets(dir, { mode: 'standard', maxImages: 3 }));
    expect(capped.calls).toHaveLength(3);
    expect(capped.assets.filter((asset) => asset.kind === 'fg')).toEqual([]);

    const fits = await withDir('budget-html-fits-', (dir) => runHtmlAssets(dir, { mode: 'standard', maxImages: 12 }));
    expect(fits.calls).toHaveLength(12);
  });

  it('reuses an already generated source from existingAssets instead of calling the provider', async () => {
    await withDir('budget-html-existing-', async (dir) => {
      const source = join(dir, 'kept-001.png');
      await writeFile(source, 'kept');
      const existing: HtmlVideoAsset[] = [{ sceneIndex: 1, kind: 'bg', slot: 0, src: 'kept-001.png', prompt: '背景 1' }];
      const result = await runHtmlAssets(dir, { mode: 'minimal' }, existing);
      expect(result.calls).toEqual([expect.stringContaining('背景 4')]);
      expect(result.assets.find((asset) => asset.sceneIndex === 2)?.src).toMatch(/^kept-001\.reuse-\d{3}\.png$/u);
    });
  });

  it('the auto cover reuses the first scene image under a budget, but a forced regenerate calls the provider', async () => {
    const template: CustomCoverTemplate = { ...defaultCustomCoverTemplates[0] };
    const state = createHtmlVideoPipelineData('第一幕。第二幕。', { coverImageMode: 'auto', coverTemplate: template.id, imageBudget: { mode: 'economy' } });
    state.assets = state.scenes.map((scene) => ({ sceneIndex: scene.index, kind: 'bg' as const, slot: 0, src: `provider-images/00${scene.index}.png`, prompt: scene.background.prompt }));
    const requests: Array<{ reuseSourcePath?: string }> = [];
    const asset = createHtmlVideoCoverAsset({
      revision: 1, mode: 'auto', path: 'covers/cover-auto-r1.reuse-scene.png', sizeBytes: 10, width: 768, height: 1024,
      mimeType: 'image/png', sha256: 'a'.repeat(64), ratio: '3:4', templateId: template.id, createdAt: '2026-11-10T00:00:00.000Z',
    });
    const options = {
      state, taskTitle: 'Budget cover', resolveTemplate: async () => structuredClone(template),
      generateCover: async (input: { reuseSourcePath?: string }) => { requests.push(input); return asset; },
    };
    await resolveHtmlVideoCoverForRender(options);
    await resolveHtmlVideoCoverForRender({ ...options, force: true });
    const standardState = { ...structuredClone(state), config: { ...state.config, imageBudget: undefined } };
    await resolveHtmlVideoCoverForRender({ ...options, state: standardState });
    expect(requests.map((request) => request.reuseSourcePath)).toEqual(['provider-images/001.png', undefined, undefined]);

    await withDir('budget-html-cover-', async (dir) => {
      await mkdir(join(dir, 'provider-images'), { recursive: true });
      await writeFile(join(dir, 'provider-images', '001.png'), tinyPng);
      let providerCalls = 0;
      const prepared: string[] = [];
      const generate = adaptHtmlVideoCoverGenerator(
        async () => { providerCalls += 1; return []; },
        { id: 'cover-budget', title: 'Cover', style: 'modern-film', ratio: '9:16' } as Task,
        dir,
        async (input) => {
          prepared.push(relative(dir, input.sourcePath).replace(/\\/gu, '/'));
          return { sizeBytes: 10, width: input.dimensions.width, height: input.dimensions.height, mimeType: 'image/png', sha256: 'b'.repeat(64) };
        },
      );
      const cover = await generate({
        taskTitle: 'Cover', summary: 'summary', ratio: '3:4', revision: 2, dimensions: { width: 768, height: 1024 },
        template, prompt: 'unused', config: state.config, reuseSourcePath: 'provider-images/001.png',
      });
      expect(providerCalls).toBe(0);
      expect(prepared).toEqual(['provider-images/001.png']);
      expect(cover.path).toBe('covers/cover-auto-r2.reuse-scene.png');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Template (storyboard) route
// ---------------------------------------------------------------------------------------------

function makeArtifact(sceneCount: number): PipelineArtifact {
  const scenes: StoryboardScene[] = Array.from({ length: sceneCount }, (_, index) => ({
    id: index + 1, cap: `Scene ${index + 1}`, descPrompt: `visual prompt ${index + 1}`, durationMs: 1200,
  }));
  const imagePrompts: ImagePrompt[] = scenes.map((scene) => ({
    sceneId: scene.id, cap: scene.cap, prompt: scene.descPrompt, negativePrompt: 'none', style: 'photo-real', ratio: '9:16', characterProfile: '',
  }));
  return {
    reviewedText: 'Story.', rewrittenCopy: 'Story.',
    cover: { title: 'Budget', subtitle: [], summary: 'summary', tags: [], comments: [] },
    scenes, imagePrompts, subtitles: { cues: [], srt: '' },
  };
}

function wavTone(durationMs: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(Math.round(Math.sin((i / sampleRate) * Math.PI * 880) * 8000), 44 + i * 2);
  return buffer;
}

async function writeSceneAssets(dir: string, scenes: StoryboardScene[], extension: string, data: Buffer) {
  await mkdir(dir, { recursive: true });
  return Promise.all(scenes.map(async (scene) => {
    const path = join(dir, `${scene.id}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
    await writeFile(path, data);
    return { sceneId: scene.id, path };
  }));
}

async function fakeBridge(payload: PyJianYingBridgeInput) {
  await mkdir(payload.draftDir, { recursive: true });
  const draftContentPath = join(payload.draftDir, 'draft_content.json');
  const draftMetaPath = join(payload.draftDir, 'draft_meta_info.json');
  await writeFile(draftContentPath, JSON.stringify({ images: payload.images }), 'utf8');
  await writeFile(draftMetaPath, JSON.stringify({ draft_name: payload.title }), 'utf8');
  return { draftDir: payload.draftDir, draftContentPath, draftMetaPath, durationUs: payload.totalDurationUs ?? 0 };
}

interface TemplateRun {
  calls: number[][];
  images: Array<{ sceneId: number; file: string; borrowedFrom?: number }>;
  cover?: string;
  imageBudgetReuse?: unknown;
  statePath: string;
}

async function runTemplateTask(
  dir: string,
  pipelineData: string | undefined,
  options: { sceneCount?: number; cover?: boolean; rerunScenes?: number[] } = {},
): Promise<TemplateRun & { rerunCalls?: number[][] }> {
  const db = await FileDatabase.open(join(dir, 'app.db'));
  try {
    const state = await db.getState();
    await db.upsertConfig({ ...state.config, jianying: { ...state.config.jianying, draftPath: join(dir, 'drafts') } });
    const task = await db.createTask({
      title: 'Budget template', inputText: 'Story.',
      ...(pipelineData === undefined ? {} : { pipelineData }),
      ...(options.cover ? { coverImageMode: 'auto' as const, coverTemplateId: 'cinematic-poster' } : {}),
    });
    const calls: number[][] = [];
    const artifact = makeArtifact(options.sceneCount ?? 7);
    const workDir = join(dir, 'tasks', task.managedStorageKey!);
    const run = (current: Task) => runTask(db, current, {
      appDataDir: dir,
      workDir,
      imageConcurrency: 1,
      customCoverTemplates: defaultCustomCoverTemplates,
      generatePipelineArtifact: async () => artifact,
      generateImages: async (scenes) => {
        calls.push(scenes.map((scene) => scene.id));
        return writeSceneAssets(join(dir, 'media'), scenes, 'png', tinyPng);
      },
      synthesizeNarration: async (scenes) => writeSceneAssets(join(dir, 'media'), scenes, 'wav', wavTone(1200)),
      draftWriterOptions: { runBridge: fakeBridge },
    });
    await run(task);
    const read = async (): Promise<TemplateRun> => {
      const current = (await db.getState()).tasks.find((item) => item.id === task.id)!;
      expect(current.status).toBe('completed');
      const pipeline = JSON.parse(await readFile(current.artifactStatePath, 'utf8')) as {
        assets: { images: Array<{ sceneId: number; path: string; borrowedFrom?: number }>; cover: Array<{ path: string }> };
        imageBudgetReuse?: unknown;
      };
      const file = (path: string) => path.startsWith(workDir) ? relative(workDir, path).replace(/\\/gu, '/') : 'media';
      return {
        calls: [...calls],
        images: pipeline.assets.images.map((asset) => ({ sceneId: asset.sceneId, file: file(asset.path), ...(asset.borrowedFrom === undefined ? {} : { borrowedFrom: asset.borrowedFrom }) })),
        cover: pipeline.assets.cover[0] ? file(pipeline.assets.cover[0].path) : undefined,
        imageBudgetReuse: pipeline.imageBudgetReuse,
        statePath: current.artifactStatePath,
      };
    };
    const first = await read();
    if (!options.rerunScenes) return first;
    calls.length = 0;
    await markSceneImagesForRegeneration(first.statePath, options.rerunScenes);
    const current = (await db.getState()).tasks.find((item) => item.id === task.id)!;
    await run(current);
    const second = await read();
    return { ...second, rerunCalls: second.calls, calls: first.calls };
  } finally {
    await db.close();
  }
}

describe('H-5 image budget — template route', () => {
  it('old tasks (no imageBudget in pipelineData) keep the same provider calls and outputs', async () => {
    const legacy = await withDir('budget-tpl-legacy-', (dir) => runTemplateTask(dir, undefined, { cover: true }));
    const optionsOnly = await withDir('budget-tpl-options-', (dir) => runTemplateTask(dir, JSON.stringify({ version: 1, platformVariants: ['douyin'], versionsPerPlatform: 1 }), { cover: true }));
    const standard = await withDir('budget-tpl-standard-', (dir) => runTemplateTask(dir, createOrdinaryTaskPipelineData({ imageBudget: { mode: 'standard' } }), { cover: true }));
    expect(legacy.calls).toEqual([[0], [1], [2], [3], [4], [5], [6], [7]]);
    for (const run of [optionsOnly, standard]) {
      expect(run.calls).toEqual(legacy.calls);
      expect(run.images).toEqual(legacy.images);
      expect(run.cover).toEqual(legacy.cover);
      expect(run.imageBudgetReuse).toBeUndefined();
    }
    expect(legacy.images.every((image) => image.borrowedFrom === undefined)).toBe(true);
    expect(createOrdinaryTaskPipelineData({ imageBudget: { mode: 'standard' } })).toBe(createOrdinaryTaskPipelineData({}));
  });

  it('economy: one call per scene; the cover reuses scene 1 without a provider call', async () => {
    const run = await withDir('budget-tpl-economy-', (dir) => runTemplateTask(dir, createOrdinaryTaskPipelineData({ imageBudget: { mode: 'economy' } }), { cover: true }));
    expect(run.calls).toEqual([[1], [2], [3], [4], [5], [6], [7]]);
    expect(run.cover).toBe('cover-image.png');
    expect(run.images.every((image) => image.borrowedFrom === undefined)).toBe(true);
  });

  it('minimal: one image per 3 scenes; reused scenes get private .reuse- copies', async () => {
    const run = await withDir('budget-tpl-minimal-', async (dir) => {
      const result = await runTemplateTask(dir, createOrdinaryTaskPipelineData({ imageBudget: { mode: 'minimal' } }), { cover: true });
      const providerDir = (await readdir(join(dir, 'tasks'))).map((key) => join(dir, 'tasks', key, 'provider-images'))[0];
      return { ...result, files: existsSync(providerDir) ? (await readdir(providerDir)).sort() : [] };
    });
    expect(run.calls).toEqual([[1], [4], [7]]);
    expect(run.images).toEqual([
      { sceneId: 1, file: 'media' },
      { sceneId: 2, file: 'provider-images/002.reuse-001.png', borrowedFrom: 1 },
      { sceneId: 3, file: 'provider-images/003.reuse-001.png', borrowedFrom: 1 },
      { sceneId: 4, file: 'media' },
      { sceneId: 5, file: 'provider-images/005.reuse-004.png', borrowedFrom: 4 },
      { sceneId: 6, file: 'provider-images/006.reuse-004.png', borrowedFrom: 4 },
      { sceneId: 7, file: 'media' },
    ]);
    expect(run.files.every((name) => name.includes('.reuse-'))).toBe(true);
    expect(run.cover).toBe('cover-image.png');
  });

  it('maxImages caps the calls deterministically (evenly spaced scenes)', async () => {
    const run = await withDir('budget-tpl-cap-', (dir) => runTemplateTask(dir, createOrdinaryTaskPipelineData({ imageBudget: { mode: 'standard', maxImages: 3 } }), { cover: true }));
    expect(run.calls).toEqual([[1], [4], [7]]);
    expect(run.images.filter((image) => image.borrowedFrom !== undefined).map((image) => [image.sceneId, image.borrowedFrom])).toEqual([[2, 1], [3, 4], [5, 4], [6, 7]]);
  });

  it('regenerating one reused scene calls the provider for that scene only', async () => {
    const run = await withDir('budget-tpl-regen-', (dir) => runTemplateTask(dir, createOrdinaryTaskPipelineData({ imageBudget: { mode: 'minimal' } }), { rerunScenes: [2] }));
    expect(run.calls).toEqual([[1], [4], [7]]);
    expect(run.rerunCalls).toEqual([[2]]);
    expect(run.images.find((image) => image.sceneId === 2)).toEqual({ sceneId: 2, file: 'media' });
    expect(run.images.find((image) => image.sceneId === 3)).toMatchObject({ borrowedFrom: 1 });
  });
});
