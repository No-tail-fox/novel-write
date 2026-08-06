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
import { MAX_HTML_VIDEO_SOURCE_CHARS } from '@shared/html-video-workflow';
import { HTML_VIDEO_JOB_DEFAULTS } from '@shared/html-video-config';
import type { AppConfig, HtmlVideoScenePlan, ImagePrompt, StoryboardScene, Task } from '@shared/types';

afterEach(() => vi.unstubAllGlobals());

describe('task runtime providers', () => {
  it('returns actionable HTML video provider failures instead of mock assets', async () => {
    expect(createHtmlVideoRuntimeProviders).toBeTypeOf('function');
    await withRuntimeTask(async (task, workDir) => {
      const providers = createHtmlVideoRuntimeProviders(defaultConfig, workDir, task, {
        measureAudioDuration: async () => 1,
        jobConfig: {},
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

  it('does not use Task mirrors as runtime fallbacks for HTML asset or voice providers', async () => {
    await withRuntimeTask(async (task, workDir) => {
      Object.assign(task, {
        style: 'task-mirror-style',
        ratio: '16:9',
        speaker: 'task-mirror-voice',
        ttsProvider: 'minimax',
        ttsSpeed: 1.8,
      });
      const runtimeTasks: Task[] = [];
      const generateAssets = adaptHtmlVideoAssetGenerator(async (scenes, _prompts, runtimeTask) => {
        runtimeTasks.push(structuredClone(runtimeTask));
        return Promise.all(scenes.map(async (scene) => {
          const path = join(workDir, `owner-asset-${scene.id}.png`);
          await writeFile(path, Buffer.from('asset'));
          return { sceneId: scene.id, path };
        }));
      }, task);
      const synthesizeVoices = adaptHtmlVideoNarrationSynthesizer(async (scenes, runtimeTask) => {
        runtimeTasks.push(structuredClone(runtimeTask));
        return Promise.all(scenes.map(async (scene) => {
          const path = join(workDir, `owner-voice-${scene.id}.wav`);
          await writeFile(path, Buffer.from('voice'));
          return { sceneId: scene.id, path, text: scene.cap };
        }));
      }, task, async () => 1);

      await generateAssets({ scenes: htmlScenes(), config: {} });
      await synthesizeVoices({ scenes: htmlScenes(), config: {} });

      expect(runtimeTasks).toHaveLength(2);
      expect(runtimeTasks[0]).toMatchObject({
        style: HTML_VIDEO_JOB_DEFAULTS.style,
        ratio: HTML_VIDEO_JOB_DEFAULTS.ratio,
      });
      expect(runtimeTasks[1]).toMatchObject({
        style: HTML_VIDEO_JOB_DEFAULTS.style,
        ratio: HTML_VIDEO_JOB_DEFAULTS.ratio,
        speaker: HTML_VIDEO_JOB_DEFAULTS.voiceId,
        ttsProvider: HTML_VIDEO_JOB_DEFAULTS.ttsProvider,
        ttsSpeed: HTML_VIDEO_JOB_DEFAULTS.ttsSpeed,
      });
    });
  });

  it('keeps an exact-cap foreground prompt valid when adding the transparent-PNG suffix', async () => {
    await withRuntimeTask(async (task, workDir) => {
      let providerPrompt = '';
      const generator: NonNullable<RunTaskOptions['generateImages']> = async (scenes, prompts) => {
        providerPrompt = prompts.find((prompt) => prompt.sceneId === 2)?.prompt ?? '';
        return Promise.all(scenes.map(async (scene) => {
          const path = join(workDir, `bounded-prompt-${scene.id}.png`);
          await writeFile(path, Buffer.from('asset'));
          return { sceneId: scene.id, path };
        }));
      };
      const scene = structuredClone(htmlScenes()[0]);
      scene.elements[0].prompt = 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS);

      const assets = await adaptHtmlVideoAssetGenerator(generator, task)({
        scenes: [scene],
        config: { foreground: true },
      });

      expect(providerPrompt.length).toBeLessThanOrEqual(MAX_HTML_VIDEO_SOURCE_CHARS);
      expect(providerPrompt).toMatch(/透明背景 PNG 前景素材$/u);
      expect(assets.find((asset) => asset.kind === 'fg')?.prompt).toBe(providerPrompt);
    });
  });

  it('rejects oversized image-provider output before reading any returned item', async () => {
    await withRuntimeTask(async (task) => {
      let assetAccessed = false;
      const generated = new Array<SceneAsset>(3);
      Object.defineProperty(generated, 0, {
        get() {
          assetAccessed = true;
          throw new Error('image provider asset was accessed');
        },
      });
      const generateAssets = adaptHtmlVideoAssetGenerator(async () => generated, task);

      await expect(generateAssets({ scenes: htmlScenes(), config: { foreground: true } }))
        .rejects.toMatchObject({ code: 'IMAGE_PROVIDER_INVALID_OUTPUT' });
      expect(assetAccessed).toBe(false);
    });
  });

  it('preserves a native image timeout as a retryable provider diagnostic', async () => {
    await withRuntimeTask(async (task) => {
      const generateAssets = adaptHtmlVideoAssetGenerator(async () => {
        throw new Error('Image provider request timed out after 180000ms.');
      }, task);

      await expect(generateAssets({ scenes: htmlScenes(), config: { foreground: true } })).rejects.toMatchObject({
        code: 'IMAGE_PROVIDER_TIMEOUT',
        message: 'Image provider request timed out after 180000ms.',
        retryable: true,
      });
    });
  });

  it('rejects oversized direct image scene arrays before reading items or calling the provider', async () => {
    await withRuntimeTask(async (task) => {
      let sceneAccessed = false;
      let providerCalls = 0;
      const scenes = new Array<HtmlVideoScenePlan>(31);
      Object.defineProperty(scenes, 0, {
        get() {
          sceneAccessed = true;
          throw new Error('image scene was accessed');
        },
      });
      const generator: NonNullable<RunTaskOptions['generateImages']> = async () => {
        providerCalls += 1;
        return [];
      };
      const generateAssets = adaptHtmlVideoAssetGenerator(generator, task);

      await expect(generateAssets({ scenes, config: {} })).rejects.toThrow(/scene|maximum|limit/i);

      expect(sceneAccessed).toBe(false);
      expect(providerCalls).toBe(0);
    });
  });

  it('rejects oversized direct foreground arrays before reading items or calling the image provider', async () => {
    await withRuntimeTask(async (task) => {
      let elementAccessed = false;
      let providerCalls = 0;
      const scene = structuredClone(htmlScenes()[0]);
      const elements = new Array<HtmlVideoScenePlan['elements'][number]>(5);
      Object.defineProperty(elements, 0, {
        get() {
          elementAccessed = true;
          throw new Error('foreground element was accessed');
        },
      });
      scene.elements = elements;
      const generator: NonNullable<RunTaskOptions['generateImages']> = async () => {
        providerCalls += 1;
        return [];
      };
      const generateAssets = adaptHtmlVideoAssetGenerator(generator, task);

      await expect(generateAssets({ scenes: [scene], config: {} })).rejects.toThrow(/element|maximum|limit/i);

      expect(elementAccessed).toBe(false);
      expect(providerCalls).toBe(0);
    });
  });

  it('rejects oversized direct captions before image or narration provider calls', async () => {
    await withRuntimeTask(async (task) => {
      let imageCaptionAccessed = false;
      let voiceCaptionAccessed = false;
      let imageProviderCalls = 0;
      let voiceProviderCalls = 0;
      const imageScene = structuredClone(htmlScenes()[0]);
      const voiceScene = structuredClone(htmlScenes()[0]);
      const imageCaptions = new Array<string>(33);
      const voiceCaptions = new Array<string>(33);
      Object.defineProperty(imageCaptions, 0, {
        get() {
          imageCaptionAccessed = true;
          throw new Error('image caption was accessed');
        },
      });
      Object.defineProperty(voiceCaptions, 0, {
        get() {
          voiceCaptionAccessed = true;
          throw new Error('voice caption was accessed');
        },
      });
      imageScene.captions = imageCaptions;
      voiceScene.captions = voiceCaptions;
      const generateAssets = adaptHtmlVideoAssetGenerator(async () => {
        imageProviderCalls += 1;
        return [];
      }, task);
      const synthesizeVoices = adaptHtmlVideoNarrationSynthesizer(async () => {
        voiceProviderCalls += 1;
        return [];
      }, task, async () => 1);

      const imageError = await generateAssets({ scenes: [imageScene], config: {} }).then(
        () => null,
        (error: unknown) => error,
      );
      const voiceError = await synthesizeVoices({ scenes: [voiceScene], config: {} }).then(
        () => null,
        (error: unknown) => error,
      );

      expect(String(imageError)).toMatch(/caption|maximum|limit/i);
      expect(String(voiceError)).toMatch(/caption|maximum|limit/i);
      expect(imageCaptionAccessed).toBe(false);
      expect(voiceCaptionAccessed).toBe(false);
      expect(imageProviderCalls).toBe(0);
      expect(voiceProviderCalls).toBe(0);
    });
  });

  it('rejects aggregate planning text before direct image or narration provider calls', async () => {
    await withRuntimeTask(async (task) => {
      const text = 'x'.repeat(15_000);
      const scene = structuredClone(htmlScenes()[0]);
      scene.narration = text;
      scene.title = text;
      scene.captions = [text];
      scene.background.prompt = text;
      scene.elements[0].prompt = text;
      let imageProviderCalls = 0;
      let voiceProviderCalls = 0;
      const generateAssets = adaptHtmlVideoAssetGenerator(async () => {
        imageProviderCalls += 1;
        throw new Error('image provider called');
      }, task);
      const synthesizeVoices = adaptHtmlVideoNarrationSynthesizer(async () => {
        voiceProviderCalls += 1;
        throw new Error('voice provider called');
      }, task, async () => 1);

      const imageError = await generateAssets({ scenes: [scene], config: {} }).then(
        () => null,
        (error: unknown) => error,
      );
      const voiceError = await synthesizeVoices({ scenes: [scene], config: {} }).then(
        () => null,
        (error: unknown) => error,
      );

      expect(String(imageError)).toMatch(/planning|text|budget|large|69/i);
      expect(String(voiceError)).toMatch(/planning|text|budget|large|69/i);
      expect(imageProviderCalls).toBe(0);
      expect(voiceProviderCalls).toBe(0);
    });
  });

  it('rejects a source-sized planning field before direct providers or duration probes', async () => {
    await withRuntimeTask(async (task) => {
      const imageScene = structuredClone(htmlScenes()[0]);
      const voiceScene = structuredClone(htmlScenes()[0]);
      imageScene.narration = 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1);
      voiceScene.narration = 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1);
      let imageCalls = 0;
      let voiceCalls = 0;
      let probeCalls = 0;
      const generateAssets = adaptHtmlVideoAssetGenerator(async () => {
        imageCalls += 1;
        return [];
      }, task);
      const synthesizeVoices = adaptHtmlVideoNarrationSynthesizer(async () => {
        voiceCalls += 1;
        return [];
      }, task, async () => {
        probeCalls += 1;
        return 1;
      });

      await expect(generateAssets({ scenes: [imageScene], config: {} })).rejects.toThrow(/narration|characters|maximum/i);
      await expect(synthesizeVoices({ scenes: [voiceScene], config: {} })).rejects.toThrow(/narration|characters|maximum/i);
      expect(imageCalls).toBe(0);
      expect(voiceCalls).toBe(0);
      expect(probeCalls).toBe(0);
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

  it('rejects oversized narration-provider output before reading items or probing duration', async () => {
    await withRuntimeTask(async (task) => {
      let assetAccessed = false;
      let durationProbeCalls = 0;
      const generated = new Array<SceneAsset>(2);
      Object.defineProperty(generated, 0, {
        get() {
          assetAccessed = true;
          throw new Error('narration provider asset was accessed');
        },
      });
      const synthesizeVoices = adaptHtmlVideoNarrationSynthesizer(
        async () => generated,
        task,
        async () => {
          durationProbeCalls += 1;
          return 1;
        },
      );

      await expect(synthesizeVoices({ scenes: htmlScenes(), config: {} }))
        .rejects.toMatchObject({ code: 'TTS_PROVIDER_INVALID_OUTPUT' });
      expect(assetAccessed).toBe(false);
      expect(durationProbeCalls).toBe(0);
    });
  });

  it('rejects oversized direct narration scene arrays before reading items or calling the provider', async () => {
    await withRuntimeTask(async (task) => {
      let sceneAccessed = false;
      let providerCalls = 0;
      let durationProbeCalls = 0;
      const scenes = new Array<HtmlVideoScenePlan>(31);
      Object.defineProperty(scenes, 0, {
        get() {
          sceneAccessed = true;
          throw new Error('narration scene was accessed');
        },
      });
      const synthesizer: NonNullable<RunTaskOptions['synthesizeNarration']> = async () => {
        providerCalls += 1;
        return [];
      };
      const synthesizeVoices = adaptHtmlVideoNarrationSynthesizer(
        synthesizer,
        task,
        async () => {
          durationProbeCalls += 1;
          return 1;
        },
      );

      await expect(synthesizeVoices({ scenes, config: {} })).rejects.toThrow(/scene|maximum|limit/i);

      expect(sceneAccessed).toBe(false);
      expect(providerCalls).toBe(0);
      expect(durationProbeCalls).toBe(0);
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
        jobConfig: {},
      });
      const signal = new AbortController().signal;
      const configSnapshot = {
        maxScenes: 12,
        transitionType: 'dissolve',
        captionPreset: 'metadata-only-caption',
      } as const;

      const rewrite = await providers.rewrite?.({
        sourceText: '原始第一幕。',
        config: { maxScenes: 12 },
        configSnapshot,
        signal,
      });
      const planning = await providers.plan?.({
        ...rewrite!,
        config: { maxScenes: 12 },
        configSnapshot,
        signal,
      });

      expect(rewrite).toEqual({ rewrittenText: '改写后的第一幕。', segments: ['改写后的第一幕。'] });
      expect(planning).toEqual({ scenes: htmlScenes() });
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.model === 'html-model')).toBe(true);
      const promptPayloads = requests.map((request) => {
        const messages = request.messages as Array<{ role: string; content: string }>;
        const userMessage = [...messages].reverse().find((message) => message.role === 'user');
        return JSON.parse(userMessage!.content) as Record<string, unknown>;
      });
      expect(promptPayloads.map((payload) => payload.config)).toEqual([
        { maxScenes: 12 },
        { maxScenes: 12 },
      ]);
      expect(JSON.stringify(requests)).not.toContain('configSnapshot');
      expect(JSON.stringify(requests)).not.toContain('transitionType');
      expect(JSON.stringify(requests)).not.toContain('metadata-only-caption');
    });
  });

  it('classifies structurally invalid configured-LLM scenes for local planning fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        id: 'html-invalid-plan',
        choices: [{ message: { content: JSON.stringify({ scenes: [{ index: 1, narration: 42 }] }) } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    );

    await withRuntimeTask(async (task, workDir) => {
      const config = {
        ...defaultConfig,
        llm: { ...defaultConfig.llm, apiKey: 'html-key', model: 'html-model', enabled: true },
      };
      const providers = createHtmlVideoRuntimeProviders(config, workDir, task, {
        measureAudioDuration: async () => 1,
        jobConfig: { maxScenes: 8 },
      });
      const error = await providers.plan?.({
        rewrittenText: '改写后的第一幕。',
        segments: ['改写后的第一幕。'],
        config: { maxScenes: 8 },
        configSnapshot: { maxScenes: 8 },
      }).then(() => null, (reason: unknown) => reason);

      expect(error).toMatchObject({
        code: 'HTML_VIDEO_LLM_INVALID_JSON',
        retryable: true,
      });
      expect(String((error as Error).message)).toMatch(/场景规划.*结构.*scenes\[0\]\.narration/i);
    });
  });

  it('sends shared HTML resource limits in Anthropic rewrite and planning schemas', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const input = requests.length === 1
          ? { rewrittenText: '改写后的第一幕。', segments: ['改写后的第一幕。'] }
          : { scenes: htmlScenes() };
        return new Response(JSON.stringify({
          id: `html-anthropic-${requests.length}`,
          content: [{ type: 'tool_use', name: 'return_json', input }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    await withRuntimeTask(async (task, workDir) => {
      const config = {
        ...defaultConfig,
        llm: {
          ...defaultConfig.llm,
          provider: 'anthropic' as const,
          protocol: 'anthropic' as const,
          apiKey: 'anthropic-key',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-test',
          enabled: true,
        },
      };
      const providers = createHtmlVideoRuntimeProviders(config, workDir, task, {
        measureAudioDuration: async () => 1,
        jobConfig: {},
      });
      const rewrite = await providers.rewrite?.({ sourceText: '原始第一幕。', config: {} });
      await providers.plan?.({ ...rewrite!, config: {} });

      const rewriteSchema = anthropicToolSchema(requests[0]);
      const planningSchema = anthropicToolSchema(requests[1]);
      expect(rewriteSchema).toMatchObject({
        properties: {
          rewrittenText: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
          segments: { maxItems: 30, items: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS } },
        },
      });
      expect(planningSchema).toMatchObject({
        properties: {
          scenes: {
            maxItems: 30,
            items: {
              properties: {
                narration: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
                title: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
                captions: { maxItems: 32, items: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS } },
                sceneTemplate: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
                background: { properties: { prompt: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS } } },
                elements: {
                  maxItems: 4,
                  items: { properties: { prompt: { maxLength: MAX_HTML_VIDEO_SOURCE_CHARS } } },
                },
              },
            },
          },
        },
      });
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

  it('overrides only image quality while keeping the configured provider, model, resolution, and concurrency', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('task-image').toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    const config: AppConfig = {
      ...defaultConfig,
      imageProvider: 'gpt_image',
      gptImage: {
        ...defaultConfig.gptImage,
        baseUrl: 'https://active-image.example',
        apiKey: 'active-key',
        model: 'active-image-model',
        resolution: '2K',
        quality: 'medium',
        concurrency: 2,
      },
    };
    const scene: StoryboardScene = { id: 1, cap: 'Task image', descPrompt: 'task image prompt', durationMs: 1200 };
    const prompt: ImagePrompt = {
      sceneId: 1,
      cap: scene.cap,
      prompt: 'task image prompt',
      negativePrompt: '',
      style: 'photo-real',
      ratio: '9:16',
      characterProfile: '',
    };

    await withRuntimeTask(async (task, workDir) => {
      task.imageQuality = 'high';
      const providers = createTaskRuntimeProviders(config, workDir, task);
      expect(providers.imageConcurrency).toBe(2);
      await providers.generateImages?.([scene], [prompt], task);
    });

    expect(requests[0].url).toBe('https://active-image.example/v1/images/generations');
    expect(requests[0].body).toMatchObject({ model: 'active-image-model', size: '1024x1536', quality: 'high' });
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

  it('selects the HTML TTS provider from canonical job config instead of the Task mirror', async () => {
    const fetchMock = vi.fn(async () => new Response('provider reached', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      ...defaultConfig,
      tts: {
        ...defaultConfig.tts,
        provider: 'mock' as const,
        volcengine: {
          ...defaultConfig.tts.volcengine,
          apiKey: 'job-config-v3-key',
        },
      },
    };

    await withRuntimeTask(async (task, workDir) => {
      task.ttsProvider = 'mock';
      const providers = createHtmlVideoRuntimeProviders(config, workDir, task, {
        measureAudioDuration: async () => 1,
        jobConfig: {
          ttsProvider: 'volcengine',
          voiceId: 'job-config-voice',
          ttsSpeed: 1,
        },
      });

      await providers.synthesizeVoices({
        scenes: htmlScenes(),
        config: { ttsProvider: 'volcengine', voiceId: 'job-config-voice', ttsSpeed: 1 },
      }).catch(() => undefined);
      expect(fetchMock).toHaveBeenCalled();
    });
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
          workDir: managedTaskWorkDir(dir, task),
          resolveAiSourceContext: async () => ({
            query: task.aiKeyword,
            sections: [{ source: 'web', title: 'Search result', content: 'Wu Zetian returns to the court.' }],
            warnings: [],
          }),
          ...createTaskRuntimeProviders(defaultConfig, managedTaskWorkDir(dir, task)),
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

function anthropicToolSchema(request: Record<string, unknown>): Record<string, unknown> {
  const tools = request.tools as Array<{ input_schema?: Record<string, unknown> }>;
  return tools[0]?.input_schema ?? {};
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

function managedTaskWorkDir(appDataDir: string, task: Pick<Task, 'managedStorageKey'>): string {
  if (!task.managedStorageKey) throw new Error('Test task is missing a managed storage key.');
  return join(appDataDir, 'tasks', task.managedStorageKey);
}
