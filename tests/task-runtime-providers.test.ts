import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adaptHtmlVideoAssetGenerator,
  adaptHtmlVideoNarrationSynthesizer,
  createHtmlVideoRuntimeProviders,
  createTaskRuntimeProviders,
} from '@shared/task-runtime-providers';
import { defaultConfig } from '@shared/config';
import { FileDatabase } from '@shared/storage';
import { runTask, type RunTaskOptions } from '@shared/runner';
import type { SceneAsset } from '@shared/draft';
import type { HtmlVideoScenePlan, Task } from '@shared/types';

afterEach(() => vi.unstubAllGlobals());

describe('task runtime providers', () => {
  it('returns actionable HTML video provider failures instead of mock assets', async () => {
    expect(createHtmlVideoRuntimeProviders).toBeTypeOf('function');
    await withRuntimeTask(async (task, workDir) => {
      const providers = createHtmlVideoRuntimeProviders(defaultConfig, workDir, task, {
        measureAudioDuration: async () => 1,
      });
      const input = { scenes: htmlScenes(), config: { ratio: '9:16', foreground: true } };

      expect(providers.rewrite).toBeUndefined();
      expect(providers.plan).toBeUndefined();
      await expect(providers.generateAssets(input)).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_NOT_CONFIGURED' });
      await expect(providers.synthesizeVoices(input)).rejects.toMatchObject({ code: 'TTS_PROVIDER_NOT_CONFIGURED' });
    });
  });

  it('adapts HTML backgrounds and optional foregrounds to unique image scene ids', async () => {
    expect(adaptHtmlVideoAssetGenerator).toBeTypeOf('function');
    await withRuntimeTask(async (task, workDir) => {
      const captured: { sceneIds: number[]; prompts: string[]; ratio: string }[] = [];
      const generator: NonNullable<RunTaskOptions['generateImages']> = async (scenes, prompts, runtimeTask) => {
        captured.push({
          sceneIds: scenes.map((scene) => scene.id),
          prompts: prompts.map((prompt) => prompt.prompt),
          ratio: runtimeTask.ratio,
        });
        const assets: SceneAsset[] = [];
        for (const scene of scenes) {
          const path = join(workDir, `asset-${scene.id}.png`);
          await writeFile(path, Buffer.from(`asset-${scene.id}`));
          assets.push({ sceneId: scene.id, path });
        }
        return assets;
      };
      const generateAssets = adaptHtmlVideoAssetGenerator(generator, task);

      const assets = await generateAssets({ scenes: htmlScenes(), config: { ratio: '16:9', style: 'paper', foreground: true } });

      expect(captured).toHaveLength(1);
      expect(new Set(captured[0].sceneIds).size).toBe(2);
      expect(captured[0].prompts.some((prompt) => prompt.includes('透明'))).toBe(true);
      expect(captured[0].ratio).toBe('16:9');
      expect(assets).toMatchObject([
        { sceneIndex: 1, kind: 'bg', slot: 0 },
        { sceneIndex: 1, kind: 'fg', slot: 0 },
      ]);
    });
  });

  it('adapts narration assets and records measured audio duration', async () => {
    expect(adaptHtmlVideoNarrationSynthesizer).toBeTypeOf('function');
    await withRuntimeTask(async (task, workDir) => {
      const measured: string[] = [];
      const synthesizer: NonNullable<RunTaskOptions['synthesizeNarration']> = async (scenes) => {
        const assets: SceneAsset[] = [];
        for (const scene of scenes) {
          const path = join(workDir, `voice-${scene.id}.wav`);
          await writeFile(path, Buffer.from(`voice-${scene.id}`));
          assets.push({ sceneId: scene.id, path, text: scene.cap });
        }
        return assets;
      };
      const synthesizeVoices = adaptHtmlVideoNarrationSynthesizer(
        synthesizer,
        task,
        async (path) => {
          measured.push(path);
          return 1.75;
        },
      );

      const voices = await synthesizeVoices({ scenes: htmlScenes(), config: { ttsSpeed: 1 } });

      expect(measured).toEqual([join(workDir, 'voice-1.wav')]);
      expect(voices).toEqual([{ sceneIndex: 1, src: join(workDir, 'voice-1.wav'), durationSec: 1.75, text: '第一幕。' }]);
    });
  });

  it('uses the configured LLM for HTML rewrite and scene planning', async () => {
    expect(createHtmlVideoRuntimeProviders).toBeTypeOf('function');
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        const content = requests.length === 1
          ? JSON.stringify({ rewrittenText: '改写后的第一幕。', segments: ['改写后的第一幕。'] })
          : JSON.stringify({ scenes: htmlScenes() });
        return new Response(JSON.stringify({ id: `html-llm-${requests.length}`, choices: [{ message: { content } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    await withRuntimeTask(async (task, workDir) => {
      const config = {
        ...defaultConfig,
        llm: { ...defaultConfig.llm, apiKey: 'html-key', model: 'html-model', enabled: true },
      };
      const providers = createHtmlVideoRuntimeProviders(config, workDir, task, {
        measureAudioDuration: async () => 1,
      });
      const signal = new AbortController().signal;

      const rewrite = await providers.rewrite?.({ sourceText: '原始第一幕。', config: {}, signal });
      const planning = await providers.plan?.({ ...rewrite!, config: {}, signal });

      expect(rewrite).toEqual({ rewrittenText: '改写后的第一幕。', segments: ['改写后的第一幕。'] });
      expect(planning).toEqual({ scenes: htmlScenes() });
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.model === 'html-model')).toBe(true);
    });
  });

  it('uses a task-specific LLM profile when one is selected for the task', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: 'llm-request', choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const config = {
      ...defaultConfig,
      llm: { ...defaultConfig.llm, id: 'llm-active', apiKey: 'active-key', model: 'active-model', enabled: true },
      llmProfiles: [
        { ...defaultConfig.llm, id: 'llm-active', apiKey: 'active-key', model: 'active-model', enabled: true },
        { ...defaultConfig.llm, id: 'llm-draft', apiKey: 'draft-key', model: 'draft-model', enabled: false },
      ],
      activeLlmProfileId: 'llm-active',
    };
    const providers = createTaskRuntimeProviders(config, 'D:/tmp/storybound-task', { llmProfileId: 'llm-draft' });

    await providers.llm?.run({ step: 0, name: 'profile-check', messages: [{ role: 'user', content: 'Return {"ok":true}' }] });

    expect(requests[0]).toMatchObject({ model: 'draft-model' });
  });

  it('treats Volcengine V3 API key settings as a usable TTS provider', () => {
    const providers = createTaskRuntimeProviders(
      {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            appId: '',
            accessKey: '',
            resourceId: 'seed-tts-2.0',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      },
      'D:/tmp/storybound-task',
    );

    expect(providers.synthesizeNarration).toBeTypeOf('function');
  });

  it('honors a task-selected configured TTS provider when the global provider is mock', () => {
    const config = {
      ...defaultConfig,
      tts: {
        ...defaultConfig.tts,
        provider: 'mock' as const,
        volcengine: {
          ...defaultConfig.tts.volcengine,
          apiKey: 'task-v3-key',
        },
      },
    };

    const providers = createTaskRuntimeProviders(config, 'D:/tmp/storybound-task', {
      llmProfileId: null,
      ttsProvider: 'volcengine',
    });

    expect(providers.synthesizeNarration).toBeTypeOf('function');
  });

  it('pauses at content generation instead of using mock providers when the LLM is not configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runtime-providers-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));

    try {
      await db.upsertConfig(defaultConfig);
      const task = await db.createTask({
        title: 'AI local fallback',
        inputText: '',
        mode: 'ai',
        aiKeyword: 'Wu Zetian comeback',
        aiSources: ['web', 'builtin-knowledge'],
        extraRequirements: 'Use a short-video narration style.',
        track: 'character-story',
        style: 'photo-real',
        ratio: '9:16',
      });

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          resolveAiSourceContext: async () => ({
            query: task.aiKeyword,
            sections: [{ source: 'web', title: 'Search result', content: 'Wu Zetian returns to the court.' }],
            warnings: [],
          }),
          ...createTaskRuntimeProviders(defaultConfig, join(dir, 'tasks', task.id)),
        }),
      ).rejects.toThrow(/LLM provider is not configured/);

      const state = await db.getState();

      expect(state.tasks[0]).toMatchObject({
        status: 'paused',
        currentStep: 0,
        failedStep: 0,
        retryFromStep: 0,
      });
      expect(state.tasks[0].errorMessage).toContain('LLM provider is not configured');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function htmlScenes(): HtmlVideoScenePlan[] {
  return [{
    index: 1,
    narration: '第一幕。',
    title: '第一幕',
    captions: ['第一幕。'],
    sceneTemplate: 'cinematic-title',
    background: { prompt: '电影感背景' },
    elements: [{ slot: 0, prompt: '人物透明 PNG 前景' }],
  }];
}

async function withRuntimeTask(run: (task: Task, workDir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'storydream-html-runtime-provider-'));
  const db = await FileDatabase.open(join(dir, 'app.db'));
  try {
    const task = await db.createTask({
      title: 'HTML provider task',
      inputText: '第一幕。',
      taskType: 'html-video',
      style: 'modern-film',
      ratio: '9:16',
      speaker: 'voice',
    });
    await run(task, dir);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}
