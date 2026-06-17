import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import { markTaskStepForRerun } from '@shared/pipeline-cache';
import type { CustomCoverTemplate, ImagePrompt, PipelineArtifact, StoryboardScene, TaskStatus } from '@shared/types';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';
import type { JsonLlm, LlmJsonRequest } from '@shared/llm-provider';

const sampleInput =
  'Wu Zetian entered the palace at fourteen. Years later, she returned to the center of power and changed the court forever.';
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

describe('task runner', () => {
  it('runs a task into a real Jianying draft folder when providers return real assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: '20260507 - Wu Zetian',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });
      const state = await db.getState();
      const completed = state.tasks[0];
      const files = await readdir(completed.outputDir);
      const draftContent = JSON.parse(await readFile(join(completed.outputDir, 'draft_content.json'), 'utf8'));

      expect(completed.status).toBe('completed');
      expect(completed.outputDir).toContain('JianyingPro Drafts');
      expect(files).toEqual(expect.arrayContaining(['draft_content.json', 'draft_meta_info.json']));
      expect(draftContent.materials.videos.length).toBeGreaterThan(0);
      expect(draftContent.materials.audios.length).toBeGreaterThan(0);
      expect(state.events.some((event) => event.detail.includes('Jianying draft'))).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the configured default uploaded BGM when a new task omits bgmId', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-default-bgm-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const bgmPath = join(mediaDir, 'default-bgm.wav');
    const capturedPayloads: PyJianYingBridgeInput[] = [];

    try {
      await mkdir(mediaDir, { recursive: true });
      await writeFile(bgmPath, wavTone(3000));
      const state = await db.getState();
      await db.upsertConfig({
        ...state.config,
        jianying: {
          ...state.config.jianying,
          draftPath: draftRootDir,
          defaultBgmId: 'uploaded-default',
          bgmLibrary: [{ id: 'uploaded-default', title: 'Default BGM', path: bgmPath, durationMs: 0, volume: 0.25 }],
        },
      });
      const task = await db.createTask({
        title: 'Default BGM task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: {
          runBridge: async (payload) => {
            capturedPayloads.push(payload);
            return fakeBridge(payload);
          },
        },
      });

      expect(task.bgmId).toBe('uploaded-default');
      expect(capturedPayloads).toHaveLength(1);
      const payload = capturedPayloads[0];
      expect(payload.bgm).toMatchObject({ id: 'uploaded-default', path: bgmPath, volume: 0.25 });
      expect(payload.volumes?.bgm).toBe(0.25);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the saved draft template selected by the task when writing the draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-template-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    let capturedPayload: PyJianYingBridgeInput | null = null;

    try {
      const state = await db.getState();
      const customTemplate = {
        ...state.draftTemplates[0],
        id: 'custom-central-image',
        name: 'Central image template',
        isDefault: false,
        canvas: {
          ...state.draftTemplates[0].canvas,
          width: 1080,
          height: 1920,
          ratio: '9:16',
          backgroundColor: '#123456',
          backgroundImage: '',
        },
        image: {
          ...state.draftTemplates[0].image,
          ratio: '4:3',
          fit: 'contain' as const,
          top: 0.29,
          height: 0.42,
          animation: '缩放',
        },
        title: { ...state.draftTemplates[0].title, x: -0.2, y: -0.72 },
        caption: { ...state.draftTemplates[0].caption, x: 0.15, y: 0.63 },
      };
      await db.upsertDraftTemplate(customTemplate);
      await db.upsertConfig({
        ...state.config,
        jianying: { ...state.config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Template task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        templateId: customTemplate.id,
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: {
          runBridge: async (payload) => {
            capturedPayload = payload;
            return fakeBridge(payload);
          },
        },
      });

      expect(capturedPayload).toMatchObject({
        canvas: { width: 1080, height: 1920, backgroundColor: '#123456', backgroundImage: '' },
        imageArea: { top: 0.29, height: 0.42, fit: 'contain' },
        caption: { x: 0.15, y: 0.63 },
        overlays: {
          title: { x: -0.2, y: -0.72 },
        },
      });
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders selected prompt templates into every LLM content step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-prompt-templates-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      const state = await db.getState();
      await db.upsertConfig({
        ...state.config,
        jianying: { ...state.config.jianying, draftPath: draftRootDir },
      });
      await db.upsertPromptTemplate({
        id: 'custom-task-template',
        name: '自定义人物任务模板',
        type: 'task',
        content: '任务模板标记：{{内容赛道}} / {{原文素材}}',
        isBuiltin: false,
        baseTrack: 'character-story',
      });
      for (const template of [
        ['builtin-review', 'review', '预审模板标记：{{任务模板指令}} / {{原文素材}}'],
        ['builtin-rewrite', 'rewrite', '改写模板标记：{{reviewedText}}'],
        ['builtin-cover', 'cover', '封面模板标记：{{rewrittenCopy}}'],
        ['builtin-storyboard', 'storyboard', '分镜模板标记：{{rewrittenCopy}}'],
        ['builtin-image-prompt', 'image-prompt', '绘图模板标记：{{分镜数据}} / {{任务模板指令}}'],
      ] as const) {
        await db.upsertPromptTemplate({
          id: template[0],
          name: template[0],
          type: template[1],
          content: template[2],
          isBuiltin: true,
        });
      }
      const task = await db.createTask({
        title: 'Prompt template task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        promptTemplateId: 'custom-task-template',
        promptTemplateType: 'task',
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.step === 1) {
          return {
            json: { rewrittenCopy: 'First line\n\nSecond line', cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite',
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const renderedMessages = requests.map((request) => request.messages.map((message) => message.content).join('\n')).join('\n');
      expect(renderedMessages).toContain('预审模板标记');
      expect(renderedMessages).toContain('改写模板标记');
      expect(renderedMessages).toContain('封面模板标记');
      expect(renderedMessages).toContain('分镜模板标记');
      expect(renderedMessages).toContain('绘图模板标记');
      expect(renderedMessages).toContain('任务模板标记：character-story');
      expect(renderedMessages).not.toContain('{{');
      expect((await db.getState()).tasks[0].step3PromptSnapshot).toContain('绘图模板标记');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes the selected storyboard scene count into the storyboard prompt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-scene-count-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Scene count task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        storyboardSceneCount: 16,
      });
      const scenes = makeScenes(16);

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.step === 1) {
          return {
            json: { rewrittenCopy: 'First line\n\nSecond line', cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite',
          };
        }
        if (request.step === 2) return { json: { scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: `prompts-${request.step}` };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const storyboardRequest = requests.find((request) => request.step === 2);
      expect(storyboardRequest?.messages.map((message) => message.content).join('\n')).toContain('Storyboard scene count target: 16');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('localizes StoryDream storyboard and image prompts with runtime context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-storybound-localization-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Localized StoryDream task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'black-white',
        speaker: 'voice',
        storyboardSceneCount: 3,
        targetLength: 900,
        extraRequirements: '强调女性权力转折',
        referenceImagePath: 'D:/refs/wuzetian.png',
        imagePromptReference: '参考画面：黑白近景、宫门侧光',
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: '她十四岁入宫。\n\n她回到权力中心。', cover: { title: '武则天', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) return { json: { scenes: makeScenes(2) } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: {
              characterCard: {
                summary: '武则天，唐代女性政治人物。',
                characters: [{ name: '武则天', appearance: '青年女性，唐代宫廷服饰', wardrobe: '圆领袍与披帛', role: '主角' }],
                consistencyRules: ['保持唐代服饰和黑白纪实影调'],
              },
            } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: `prompts-${request.step}` };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const storyboardContent = requests.find((request) => request.step === 2)?.messages.map((message) => message.content).join('\n') ?? '';
      const imageContent = requests.find((request) => request.name === 'image-prompts')?.messages.map((message) => message.content).join('\n') ?? '';
      const snapshot = (await db.getState()).tasks[0].step3PromptSnapshot;

      expect(storyboardContent).toContain('StoryDream 本地化分镜规则');
      expect(storyboardContent).toContain('cap 是最终口播字幕');
      expect(storyboardContent).toContain('descPrompt 是给后续 StoryDream Step 3 的视觉种子');
      expect(storyboardContent).toContain('目标字数：900');
      expect(storyboardContent).toContain('目标分镜数：3');
      expect(storyboardContent).not.toContain('{{');
      expect(imageContent).toContain('StoryDream 本地运行上下文');
      expect(imageContent).toContain('当前画面风格：black-white');
      expect(imageContent).toContain('风格前缀：黑白纪实摄影');
      expect(imageContent).toContain('允许使用色彩词：false');
      expect(imageContent).toContain('负面提示词：卡通，动漫');
      expect(imageContent).toContain('参考图类型：face');
      expect(imageContent).toContain('参考图路径：D:/refs/wuzetian.png');
      expect(imageContent).toContain('参考画面：黑白近景、宫门侧光');
      expect(imageContent).toContain('武则天，唐代女性政治人物。');
      expect(imageContent).not.toContain('{{');
      expect(snapshot).toContain('StoryDream 本地运行上下文');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes the selected target word count into rewrite prompts and evaluation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-target-length-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Target length task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        targetLength: 900,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: 'Targeted rewrite', cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      for (const request of requests.filter((item) => item.step === 1)) {
        const content = request.messages.map((message) => message.content).join('\n');
        expect(content).toContain('Target word count: about 900 Chinese characters');
      }
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves rewrite prompts on automatic length when no target word count is selected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-auto-target-length-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Automatic target length task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: 'Automatic rewrite', cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      for (const request of requests.filter((item) => item.step === 1)) {
        const content = request.messages.map((message) => message.content).join('\n');
        expect(content).not.toContain('Target word count:');
      }
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates image prompts in batches and merges them in scene order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-prompt-batches-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];
    const scenes = makeScenes(17);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Prompt batch task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        storyboardSceneCount: 17,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.step === 1) {
          return {
            json: { rewrittenCopy: 'First line\n\nSecond line', cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite',
          };
        }
        if (request.step === 2) return { json: { scenes } as T, raw: '{}', requestId: 'storyboard' };
        const batchScenes = extractScenesFromPrompt(request);
        return { json: { imagePrompts: makePrompts(batchScenes) } as T, raw: '{}', requestId: `prompts-${batchScenes[0]?.id ?? 0}` };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const promptRequests = requests.filter((request) => request.step === 3);
      expect(promptRequests).toHaveLength(3);
      expect(promptRequests.map((request) => extractScenesFromPrompt(request).map((scene) => scene.id))).toEqual([
        [1, 2, 3, 4, 5, 6, 7, 8],
        [9, 10, 11, 12, 13, 14, 15, 16],
        [17],
      ]);
      const prompts = JSON.parse(await readFile(join(dir, 'tasks', task.id, '03-image-prompts.json'), 'utf8')) as ImagePrompt[];
      expect(prompts.map((prompt) => prompt.sceneId)).toEqual(scenes.map((scene) => scene.id));
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates an auto cover image asset and writes cover-image.png', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-auto-cover-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const imageCalls: Array<{ scenes: StoryboardScene[]; prompts: ImagePrompt[] }> = [];
    const draftPayloads: PyJianYingBridgeInput[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Auto cover task',
        inputText: sampleInput,
        coverImageMode: 'auto',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes, prompts) => {
          imageCalls.push({ scenes, prompts });
          return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
        },
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: {
          runBridge: async (payload) => {
            draftPayloads.push(payload);
            return fakeBridge(payload);
          },
        },
      });

      const completed = (await db.getState()).tasks[0];
      const pipeline = JSON.parse(await readFile(completed.artifactStatePath, 'utf8'));
      const draftMeta = JSON.parse(await readFile(join(completed.outputDir, 'draft_meta_info.json'), 'utf8'));
      expect(imageCalls[0].scenes.map((scene) => scene.id)).toEqual([0]);
      expect(imageCalls[0].prompts[0].prompt).toContain('Short-video cover');
      expect(pipeline.assets.cover[0].path).toBe(join(dir, 'tasks', task.id, 'cover-image.png'));
      expect(await readFile(join(dir, 'tasks', task.id, 'cover-image.png'))).toEqual(tinyPng);
      expect(draftPayloads[0].coverImagePath).toBe(join(dir, 'tasks', task.id, 'cover-image.png'));
      expect(draftMeta.draft_cover).toBe(join(dir, 'tasks', task.id, 'cover-image.png'));
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses podcast cover template wording when the task selects podcast-cover', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-podcast-cover-template-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const imageCalls: Array<{ prompts: ImagePrompt[] }> = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Podcast cover task',
        inputText: sampleInput,
        coverImageMode: 'auto',
        coverTemplateId: 'podcast-cover',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes, prompts) => {
          imageCalls.push({ prompts });
          return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
        },
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(imageCalls[0].prompts[0].prompt).toContain('Podcast cover');
      expect(imageCalls[0].prompts[0].prompt).toContain('thumbnail');
      expect(imageCalls[0].prompts[0].prompt).toContain('topic signal');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses custom cover template fields when building cover image prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-custom-cover-template-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const imageCalls: Array<{ prompts: ImagePrompt[] }> = [];
    const customCoverTemplates: CustomCoverTemplate[] = [
      {
        id: 'noir-cover',
        name: 'Noir Cover',
        description: 'High contrast noir cover',
        directions: 'Use hard side light and a single detective silhouette.',
        compositionRule: 'Subject stands in the lower right third with rain in the background.',
        titleLayout: 'Title stays in a clean upper-left block.',
        subtitleLayout: 'Subtitle is a narrow line below the title.',
        plainHint: 'Noir poster for {{TITLE}} with quiet menace.',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Noir cover task',
        inputText: sampleInput,
        coverImageMode: 'auto',
        coverTemplateId: 'noir-cover',
      });

      await runTask(db, task, {
        appDataDir: dir,
        customCoverTemplates,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes, prompts) => {
          imageCalls.push({ prompts });
          return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
        },
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const prompt = imageCalls[0].prompts[0].prompt;
      expect(prompt).toContain('Use hard side light and a single detective silhouette.');
      expect(prompt).toContain('Subject stands in the lower right third');
      expect(prompt).toContain('Title stays in a clean upper-left block');
      expect(prompt).toContain('Noir poster for Wu Zetian');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('maps one podcast cover image to every scene when two-host podcast uses single cover art', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-podcast-single-cover-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const imageCalls: Array<{ scenes: StoryboardScene[]; prompts: ImagePrompt[] }> = [];
    let capturedPayload: PyJianYingBridgeInput | null = null;

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Two-host single cover',
        inputText: sampleInput,
        videoForm: 'two-host-podcast',
        podcastImageMode: 'single',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes, prompts) => {
          imageCalls.push({ scenes, prompts });
          return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
        },
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: {
          runBridge: async (payload) => {
            capturedPayload = payload;
            return fakeBridge(payload);
          },
        },
      });

      const completed = (await db.getState()).tasks[0];
      const pipeline = JSON.parse(await readFile(completed.artifactStatePath, 'utf8'));
      expect(imageCalls).toHaveLength(1);
      expect(imageCalls[0].scenes.map((scene) => scene.id)).toEqual([0]);
      expect(imageCalls[0].prompts[0].prompt).toContain('Two-host podcast');
      expect(pipeline.assets.images).toHaveLength(makeArtifact().scenes.length);
      expect(new Set(pipeline.assets.images.map((asset: { path: string }) => asset.path)).size).toBe(1);
      const payload = capturedPayload as PyJianYingBridgeInput | null;
      expect(payload?.images.map((asset) => asset.path)).toEqual(pipeline.assets.images.map((asset: { path: string }) => asset.path));
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('injects two-host podcast dialogue constraints into LLM prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-podcast-prompts-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Podcast prompt task',
        inputText: sampleInput,
        videoForm: 'two-host-podcast',
        podcastSpeakers: 'kazai-dayi',
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return { json: { rewrittenCopy: 'Host A: First line\nHost B: Second line', cover: { title: 'Podcast', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T, raw: '{}', requestId: 'rewrite' };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [{ round: 1, score: 90, reason: 'dialogue' }] } as T, raw: '{}', requestId: 'eval' };
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const promptText = requests.map((request) => request.messages.map((message) => message.content).join('\n')).join('\n\n');
      expect(promptText).toContain('Two-host podcast mode');
      expect(promptText).toContain('dialogue script');
      expect(promptText).toContain('kazai-dayi');
      expect(promptText).toContain('Use exactly "Host A:" and "Host B:" labels');
      expect(promptText).toContain('Do not put host display names inside spoken lines');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves multiple narration turn assets for one two-host podcast scene', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-podcast-turn-assets-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Podcast turn assets',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        videoForm: 'two-host-podcast',
        podcastSpeakerA: 'voice-host-a',
        podcastSpeakerB: 'voice-host-b',
      });
      const artifact = makeArtifact();
      artifact.scenes = [{ id: 1, cap: 'Host A: First line\nHost B: Second line', descPrompt: 'podcast studio', durationMs: 1200 }];
      artifact.imagePrompts = [{ sceneId: 1, cap: artifact.scenes[0].cap, prompt: 'podcast studio', negativePrompt: '', style: 'photo-real', ratio: '9:16', characterProfile: '' }];
      const firstTurn = join(mediaDir, '001-turn-001-A.wav');
      const secondTurn = join(mediaDir, '001-turn-002-B.wav');
      await mkdir(mediaDir, { recursive: true });
      await writeFile(firstTurn, wavTone(600));
      await writeFile(secondTurn, wavTone(600));

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => artifact,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async () => [
          { sceneId: 1, path: firstTurn, speaker: 'A', turnIndex: 1, text: 'First line' },
          { sceneId: 1, path: secondTurn, speaker: 'B', turnIndex: 2, text: 'Second line' },
        ],
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const statePath = (await db.getState()).tasks[0].artifactStatePath;
      const pipeline = JSON.parse(await readFile(statePath, 'utf8'));
      expect(pipeline.assets.narration).toEqual([
        { sceneId: 1, path: firstTurn, speaker: 'A', turnIndex: 1, text: 'First line' },
        { sceneId: 1, path: secondTurn, speaker: 'B', turnIndex: 2, text: 'Second line' },
      ]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('treats a two-host scene with multiple narration turns as complete on resume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-podcast-turn-resume-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    let narrationCalls = 0;

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Podcast turn resume',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        videoForm: 'two-host-podcast',
        podcastSpeakerA: 'voice-host-a',
        podcastSpeakerB: 'voice-host-b',
      });
      const artifact = makeArtifact();
      artifact.scenes = [{ id: 1, cap: 'Host A: First line\nHost B: Second line', descPrompt: 'podcast studio', durationMs: 1200 }];
      artifact.imagePrompts = [{ sceneId: 1, cap: artifact.scenes[0].cap, prompt: 'podcast studio', negativePrompt: '', style: 'photo-real', ratio: '9:16', characterProfile: '' }];
      const firstTurn = join(mediaDir, '001-turn-001-A.wav');
      const secondTurn = join(mediaDir, '001-turn-002-B.wav');
      await mkdir(mediaDir, { recursive: true });
      await writeFile(firstTurn, wavTone(600));
      await writeFile(secondTurn, wavTone(600));

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => artifact,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async () => {
          narrationCalls += 1;
          return [
            { sceneId: 1, path: firstTurn, speaker: 'A', turnIndex: 1, text: 'First line' },
            { sceneId: 1, path: secondTurn, speaker: 'B', turnIndex: 2, text: 'Second line' },
          ];
        },
        draftWriterOptions: { runBridge: fakeBridge },
      });
      const completed = (await db.getState()).tasks[0];

      await runTask(db, completed, {
        appDataDir: dir,
        generatePipelineArtifact: async () => artifact,
        generateImages: async () => {
          throw new Error('images should stay cached');
        },
        synthesizeNarration: async () => {
          narrationCalls += 1;
          throw new Error('narration should stay cached');
        },
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(narrationCalls).toBe(1);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes task reference images through to generated image prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-reference-image-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const imageCalls: Array<{ prompts: ImagePrompt[] }> = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Reference image task',
        inputText: sampleInput,
        referenceImagePath: 'D:/refs/protagonist.png',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes, prompts) => {
          imageCalls.push({ prompts });
          return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
        },
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(imageCalls.at(-1)?.prompts.every((item) => item.referenceImagePaths?.includes('D:/refs/protagonist.png'))).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes clip-only tasks after content artifacts without generating media or draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-clip-only-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    let imageCalled = false;
    let narrationCalled = false;

    try {
      const task = await db.createTask({
        title: 'Clip only',
        inputText: sampleInput,
        processingMode: 'clip-only',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async () => {
          imageCalled = true;
          return [];
        },
        synthesizeNarration: async () => {
          narrationCalled = true;
          return [];
        },
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const completed = (await db.getState()).tasks[0];
      const workDir = join(dir, 'tasks', task.id);
      expect(completed).toMatchObject({
        status: 'completed',
        currentStep: 4,
        outputDir: workDir,
      });
      expect(imageCalled).toBe(false);
      expect(narrationCalled).toBe(false);
      await expect(readFile(join(workDir, '03-image-prompts.json'), 'utf8')).resolves.toContain('first prompt');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('pauses semi-auto tasks after content artifacts and resumes from media generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-semi-auto-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    let imageCalls = 0;

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Semi auto',
        inputText: sampleInput,
        processingMode: 'semi-auto',
      });

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          generatePipelineArtifact: async () => makeArtifact(),
          generateImages: async (scenes) => {
            imageCalls += 1;
            return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
          },
          synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
          draftWriterOptions: { runBridge: fakeBridge },
        }),
      ).rejects.toThrow(/paused for confirmation/i);

      const paused = (await db.getState()).tasks[0];
      expect(paused).toMatchObject({ status: 'paused', currentStep: 4, retryFromStep: 4, failedStep: null });
      expect(imageCalls).toBe(0);

      await runTask(db, paused, {
        appDataDir: dir,
        generateImages: async (scenes) => {
          imageCalls += 1;
          return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
        },
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect((await db.getState()).tasks[0].status).toBe('completed');
      expect(imageCalls).toBeGreaterThan(0);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('honors critical pause checkpoints before image generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-critical-pause-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    let imageCalled = false;

    try {
      const task = await db.createTask({
        title: 'Critical pause',
        inputText: sampleInput,
        pausePoints: ['critical'],
      });

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          generatePipelineArtifact: async () => makeArtifact(),
          generateImages: async () => {
            imageCalled = true;
            return [];
          },
        }),
      ).rejects.toThrow(/paused for confirmation/i);

      const paused = (await db.getState()).tasks[0];
      expect(paused).toMatchObject({ status: 'paused', currentStep: 4, retryFromStep: 4, failedStep: null });
      expect(imageCalled).toBe(false);
      expect((await db.getState()).events.some((event) => event.type === 'checkpoint_pause' && event.step === 4)).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs three rewrite rounds, saves evaluation output, and injects a character card into image prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-rewrite-character-card-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Rewrite evaluation',
        inputText: sampleInput,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          const round = Number(request.name.replace('rewrite-round-', ''));
          return {
            json: {
              rewrittenCopy: `Round ${round} line one.\n\nRound ${round} line two.`,
              cover: { title: `Cover ${round}`, subtitle: [], summary: `summary ${round}`, tags: [], comments: [`comment ${round}`] },
            } as T,
            raw: '{}',
            requestId: `rewrite-${round}`,
          };
        }
        if (request.name === 'rewrite-evaluation') {
          return {
            json: {
              bestRound: 2,
              evaluations: [
                { round: 1, score: 70, reason: 'plain' },
                { round: 2, score: 93, reason: 'best rhythm' },
                { round: 3, score: 80, reason: 'ok' },
              ],
              wordCountWarning: 'chosen copy is short',
            } as T,
            raw: '{}',
            requestId: 'rewrite-eval',
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: {
              characterCard: {
                summary: 'same historical protagonist',
                characters: [{ name: 'Wu Zetian', appearance: 'calm gaze', wardrobe: 'Tang court clothing' }],
                consistencyRules: ['keep face and wardrobe stable'],
              },
            } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        expect(request.messages.map((message) => message.content).join('\n')).toContain('same historical protagonist');
        return { json: { imagePrompts: makePrompts(makeArtifact().scenes) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const workDir = join(dir, 'tasks', task.id);
      await expect(readFile(join(workDir, '01-rewritten-copy.md'), 'utf8')).resolves.toContain('Round 2 line one');
      const evaluations = JSON.parse(await readFile(join(workDir, '01-rewrite-evaluations.json'), 'utf8'));
      expect(evaluations.bestRound).toBe(2);
      const characterCard = JSON.parse(await readFile(join(workDir, '02-character-card.json'), 'utf8'));
      expect(characterCard.summary).toContain('same historical protagonist');
      expect(requests.filter((request) => request.name.startsWith('rewrite-round-'))).toHaveLength(3);
      expect(requests.some((request) => request.name === 'rewrite-evaluation')).toBe(true);
      expect(requests.some((request) => request.name === 'character-card')).toBe(true);
      expect((await db.getState()).events.some((event) => event.type === 'step_warning' && event.detail.includes('short'))).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds music MV plans from lyrics before generating media', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-music-mv-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');

    try {
      const task = await db.createTask({
        title: 'Music MV',
        inputText: '雨落下第一句\n霓虹亮起第二句\n副歌把夜色唱亮',
        taskKind: 'music-mv',
        processingMode: 'clip-only',
        track: 'music-mv',
        musicMv: {
          rhythmMode: 'lyric-sync',
          captionStyle: 'karaoke',
          visualMotif: '雨夜霓虹和孤独背影',
          audioPath: 'D:/music/rain.mp3',
        },
      });

      await runTask(db, task, {
        appDataDir: dir,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const workDir = join(dir, 'tasks', task.id);
      const musicPlan = JSON.parse(await readFile(join(workDir, '02-music-plan.json'), 'utf8'));
      const scenes = JSON.parse(await readFile(join(workDir, '02-sentences.json'), 'utf8')) as StoryboardScene[];
      const prompts = JSON.parse(await readFile(join(workDir, '03-image-prompts.json'), 'utf8')) as ImagePrompt[];

      expect(musicPlan).toMatchObject({ rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '雨夜霓虹和孤独背影' });
      expect(scenes.map((scene) => scene.cap)).toEqual(['雨落下第一句', '霓虹亮起第二句', '副歌把夜色唱亮']);
      expect(prompts[0].prompt).toContain('音乐MV');
      expect(prompts[0].prompt).toContain('雨夜霓虹和孤独背影');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails instead of completing with fake assets when real image generation is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-no-image-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));

    try {
      const task = await db.createTask({
        title: 'No providers',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await expect(runTask(db, task, { appDataDir: dir, generatePipelineArtifact: async () => makeArtifact() })).rejects.toThrow(/image provider/i);
      const state = await db.getState();

      expect(state.tasks[0].status).toBe('paused');
      expect(state.tasks[0].currentStep).toBe(4);
      expect(state.tasks[0].failedStep).toBe(4);
      expect(state.tasks[0].errorMessage).toMatch(/image provider/i);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('notifies listeners after a failed task status is persisted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-failure-state-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const snapshots: TaskStatus[] = [];
    const snapshotReads: Array<Promise<void>> = [];

    try {
      const task = await db.createTask({
        title: 'Missing LLM',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          llm: async () => {
            throw new Error('LLM API key is missing; cannot run real task content generation.');
          },
          onEvent: () => {
            snapshotReads.push(
              db.getState().then((state) => {
                snapshots.push(state.tasks[0].status);
              }),
            );
          },
        }),
      ).rejects.toThrow(/LLM API key is missing/);
      await Promise.all(snapshotReads);

      expect(snapshots.at(-1)).toBe('paused');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records task heartbeats while running and pauses cleanly when aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-abort-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');
    const controller = new AbortController();
    const heartbeats: string[] = [];

    try {
      const task = await db.createTask({
        title: 'Abortable task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          signal: controller.signal,
          onHeartbeat: async (_taskId, _step, detail) => {
            heartbeats.push(detail);
          },
          generatePipelineArtifact: async () => makeArtifact(),
          generateImages: async (scenes) => {
            const assets = await writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
            controller.abort('paused');
            return assets;
          },
          synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
          draftWriterOptions: { runBridge: fakeBridge },
        }),
      ).rejects.toThrow(/paused|aborted/i);

      const paused = (await db.getState()).tasks[0];
      expect(paused.status).toBe('paused');
      expect(paused.failedStep).toBe(4);
      expect(paused.retryFromStep).toBe(4);
      expect(paused.startedAt).toEqual(expect.any(String));
      expect(paused.lastHeartbeatAt).toEqual(expect.any(String));
      expect(heartbeats.length).toBeGreaterThan(0);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks an aborted cancellation as cancelled instead of resumable paused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-cancel-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const controller = new AbortController();

    try {
      const task = await db.createTask({
        title: 'Cancelled task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          signal: controller.signal,
          generatePipelineArtifact: async () => {
            controller.abort('用户取消');
            return makeArtifact();
          },
          generateImages: async () => [],
          synthesizeNarration: async () => [],
          draftWriterOptions: { runBridge: fakeBridge },
        }),
      ).rejects.toThrow(/用户取消/);

      const cancelled = (await db.getState()).tasks[0];
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.retryFromStep).toBeNull();
      expect(cancelled.errorMessage).toContain('用户取消');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resumes from the failed LLM step without repeating completed LLM calls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-llm-resume-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const calls: Record<number, number> = {};

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'LLM resume task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });
      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        calls[request.step] = (calls[request.step] ?? 0) + 1;
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.step === 1) {
          return {
            json: { rewrittenCopy: 'First line\n\nSecond line', cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite',
          };
        }
        if (request.step === 2 && calls[2] === 1) {
          throw new Error('storyboard provider failed');
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await expect(runTask(db, task, { appDataDir: dir, llm })).rejects.toThrow(/storyboard provider failed/);
      const paused = (await db.getState()).tasks[0];
      expect(paused.status).toBe('paused');
      expect(paused.failedStep).toBe(2);

      await runTask(db, paused, {
        appDataDir: dir,
        llm,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(calls).toMatchObject({ 0: 1, 1: 4, 2: 2, 3: 1 });
      expect((await db.getState()).tasks[0].status).toBe('completed');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes existing artifact context into a rewrite-assisted LLM rerun step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-step-rerun-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Rewrite assisted rerun',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });
      const workDir = join(dir, 'tasks', task.id);
      const pipelineDir = join(workDir, 'pipeline');
      const statePath = join(pipelineDir, 'state.json');
      const oldArtifact: PipelineArtifact = {
        ...makeArtifact(),
        rewrittenCopy: 'Old rewrite context line',
        cover: { title: 'Old title', subtitle: [], summary: 'old summary', tags: ['#old'], comments: [] },
      };
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            taskId: task.id,
            updatedAt: '2026-06-09T00:00:00.000Z',
            steps: Object.fromEntries(Array.from({ length: 7 }, (_, step) => [String(step), { status: 'completed' }])),
            artifact: oldArtifact,
            assets: {
              images: oldArtifact.scenes.map((scene) => ({ sceneId: scene.id, path: join(mediaDir, `${scene.id}.png`) })),
              narration: oldArtifact.scenes.map((scene) => ({ sceneId: scene.id, path: join(mediaDir, `${scene.id}.wav`) })),
            },
            draft: {
              draftDir: join(workDir, 'draft'),
              draftContentPath: join(workDir, 'draft', 'draft_content.json'),
              draftMetaPath: join(workDir, 'draft', 'draft_meta_info.json'),
            },
          },
          null,
          2,
        ),
        'utf8',
      );
      await markTaskStepForRerun(statePath, 1, 'rewrite');

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) throw new Error('review should stay cached');
        if (request.step === 1) {
          return {
            json: { rewrittenCopy: 'Fresh rewrite', cover: { title: 'Fresh title', subtitle: [], summary: 'fresh summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite-rerun',
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard-rerun' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts-rerun' };
      };

      await runTask(
        db,
        { ...task, status: 'pending', currentStep: 1, retryFromStep: 1, artifactStatePath: statePath, outputDir: workDir, errorMessage: '' },
        {
          appDataDir: dir,
          llm,
          generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
          synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
          draftWriterOptions: { runBridge: fakeBridge },
        },
      );

      const rewriteRequest = requests.find((request) => request.step === 1);
      const rewriteContent = rewriteRequest?.messages.map((message) => message.content).join('\n') ?? '';
      expect(rewriteContent).toContain('Existing artifact context');
      expect(rewriteContent).toContain('Old rewrite context line');
      expect(requests.some((request) => request.step === 0)).toBe(false);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function fakeBridge(payload: PyJianYingBridgeInput) {
  await mkdir(payload.draftDir, { recursive: true });
  await mkdir(join(payload.draftDir, 'materials'), { recursive: true });
  const draftContentPath = join(payload.draftDir, 'draft_content.json');
  const draftMetaPath = join(payload.draftDir, 'draft_meta_info.json');
  await writeFile(
    draftContentPath,
    JSON.stringify({
      duration: payload.totalDurationUs,
      materials: {
        videos: payload.images,
        audios: payload.narration,
        texts: payload.scenes,
      },
      tracks: [{ type: 'video' }, { type: 'audio' }, { type: 'text' }],
    }),
    'utf8',
  );
  await writeFile(
    draftMetaPath,
    JSON.stringify({
      draft_name: payload.title,
      tm_duration: payload.totalDurationUs,
      draft_cover: payload.coverImagePath ?? payload.images[0]?.path ?? '',
    }),
    'utf8',
  );
  return {
    draftDir: payload.draftDir,
    draftContentPath,
    draftMetaPath,
    durationUs: payload.totalDurationUs ?? 0,
  };
}

async function writeSceneAssets(
  mediaDir: string,
  scenes: StoryboardScene[],
  extension: string,
  data: Buffer,
): Promise<Array<{ sceneId: number; path: string }>> {
  const targetDir = join(mediaDir, extension);
  await mkdir(targetDir, { recursive: true });
  return Promise.all(
    scenes.map(async (scene) => {
      const path = join(targetDir, `${scene.id}.${extension}`);
      await writeFile(path, data);
      return { sceneId: scene.id, path };
    }),
  );
}

function makeArtifact(): PipelineArtifact {
  const scenes: StoryboardScene[] = [
    { id: 1, cap: 'First line', descPrompt: 'first prompt', durationMs: 1200 },
    { id: 2, cap: 'Second line', descPrompt: 'second prompt', durationMs: 1200 },
  ];
  const imagePrompts = makePrompts(scenes);
  return {
    reviewedText: sampleInput,
    rewrittenCopy: 'First line\n\nSecond line',
    cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: ['#tag'], comments: [] },
    scenes,
    imagePrompts,
    subtitles: { cues: [], srt: '' },
  };
}

function makeScenes(count: number): StoryboardScene[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    cap: `Scene ${index + 1}`,
    descPrompt: `visual prompt ${index + 1}`,
    durationMs: 1200,
  }));
}

function makePrompts(scenes: StoryboardScene[]): ImagePrompt[] {
  return scenes.map((scene) => ({
    sceneId: scene.id,
    cap: scene.cap,
    prompt: scene.descPrompt,
    negativePrompt: 'none',
    style: 'photo-real',
    ratio: '9:16',
    characterProfile: 'same person',
  }));
}

function extractScenesFromPrompt(request: LlmJsonRequest): StoryboardScene[] {
  const content = request.messages.find((message) => message.role === 'user')?.content ?? '';
  const match = content.match(/Scene context:\n\n(\{.*\})/s);
  if (!match) return [];
  return JSON.parse(match[1]).scenes as StoryboardScene[];
}

function wavTone(durationMs: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 8000);
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  return buffer;
}
