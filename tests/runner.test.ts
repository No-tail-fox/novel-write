import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import { markTaskStepForRerun } from '@shared/pipeline-cache';
import type { CustomCoverTemplate, ImagePrompt, PipelineArtifact, StoryboardScene, TaskStatus } from '@shared/types';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';
import type { StoryboundSidecarInput } from '@shared/storybound-sidecar';
import type { HtmlVideoExportInput } from '@shared/html-video';
import type { ConfiguredJsonLlm, JsonLlm, LlmJsonRequest } from '@shared/llm-provider';

const sampleInput =
  'Wu Zetian entered the palace at fourteen. Years later, she returned to the center of power and changed the court forever.';
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

function mockConfiguredLlm(run: JsonLlm): ConfiguredJsonLlm {
  return { protocol: 'anthropic', run };
}

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
            json: { rewrittenCopy: fitSourceLengthRewrite(), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite',
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
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

  it('does not duplicate review source material when the review template already includes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-review-source-once-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const sourceText = 'UNIQUE_LONG_REVIEW_SOURCE_TEXT';
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      await db.upsertPromptTemplate({
        id: 'builtin-review',
        name: 'Review with source',
        type: 'review',
        content: 'Review exactly this source once: {{inputText}}',
        isBuiltin: true,
      });
      const task = await db.createTask({
        title: 'Review source once',
        inputText: sourceText,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sourceText } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite('First line\n\nSecond line', sourceText), cover: { title: 'Review', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(makeArtifact().scenes) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const reviewContent = requests.find((request) => request.step === 0)?.messages.map((message) => message.content).join('\n') ?? '';
      expect(countOccurrences(reviewContent, sourceText)).toBe(1);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });


  it('passes required rewrite output schema as Anthropic-specific request options', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-rewrite-schema-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];
    const artifact = makeArtifact();

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Rewrite schema task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });
      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite(artifact.rewrittenCopy), cover: artifact.cover } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') {
          return {
            json: { bestRound: 1, evaluations: [{ round: 1, score: 100, reason: 'best' }] } as T,
            raw: '{}',
            requestId: 'rewrite-evaluation',
          };
        }
        if (request.step === 2) return { json: { scenes: artifact.scenes } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same protagonist', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: artifact.imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const rewriteRequest = requests.find((request) => request.name === 'rewrite-round-1');
      expect(rewriteRequest?.anthropic?.toolInputSchema).toMatchObject({
        type: 'object',
        required: ['rewrittenCopy'],
        properties: {
          rewrittenCopy: { type: 'string' },
        },
      });

      const coverRequest = requests.find((request) => request.name === 'cover-metadata');
      expect(coverRequest?.anthropic?.toolInputSchema).toMatchObject({
        type: 'object',
        required: ['cover'],
        properties: {
          cover: {
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string' },
            },
          },
        },
      });
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
            json: { rewrittenCopy: fitSourceLengthRewrite(), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite',
          };
        }
        if (request.step === 2) return { json: { scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: `prompts-${request.step}` };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
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


  it('accepts storyboard arrays returned under common non-schema keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-storyboard-key-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const scenes = makeScenes(3);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Storyboard key task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        storyboardSceneCount: 3,
        targetScenes: 3,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite(), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) return { json: { storyboard: scenes } as T, raw: '{"storyboard":[]}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: `prompts-${request.step}` };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const storedScenes = JSON.parse(await readFile(join(dir, 'tasks', task.id, '02-sentences.json'), 'utf8')) as StoryboardScene[];
      expect(storedScenes.map((scene) => scene.cap)).toEqual(['Scene 1', 'Scene 2', 'Scene 3']);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts storyboard scenes returned as a stringified JSON array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-storyboard-string-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const scenes = makeScenes(3);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Storyboard string task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        storyboardSceneCount: 3,
        targetScenes: 3,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite(), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) {
          const raw = JSON.stringify({ scenes: JSON.stringify(scenes) });
          return { json: JSON.parse(raw) as T, raw, requestId: 'storyboard' };
        }
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: `prompts-${request.step}` };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const storedScenes = JSON.parse(await readFile(join(dir, 'tasks', task.id, '02-sentences.json'), 'utf8')) as StoryboardScene[];
      expect(storedScenes).toMatchObject([
        { cap: 'Scene 1', descPrompt: 'visual prompt 1' },
        { cap: 'Scene 2', descPrompt: 'visual prompt 2' },
        { cap: 'Scene 3', descPrompt: 'visual prompt 3' },
      ]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('splits Storybound tail anchors into exact storyboard caps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-storyboard-tail-anchors-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const rewrittenCopy = '那一年他十八岁，独自踏上了北上的列车。窗外风景飞退，他心跳加速。他没说话，也没回头，就这样走了。';
    const anchors = ['独自踏上了北上的列车。', '他心跳加速。', '也没回头，就这样走了。'];
    const requests: LlmJsonRequest[] = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Tail anchor storyboard task',
        inputText: rewrittenCopy,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        storyboardSceneCount: 3,
        targetScenes: 3,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: rewrittenCopy } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy, cover: { title: '列车', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) return { json: anchors as T, raw: JSON.stringify(anchors), requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: `prompts-${request.step}` };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const storedScenes = JSON.parse(await readFile(join(dir, 'tasks', task.id, '02-sentences.json'), 'utf8')) as StoryboardScene[];
      expect(storedScenes.map((scene) => scene.cap)).toEqual([
        '那一年他十八岁，独自踏上了北上的列车。',
        '窗外风景飞退，他心跳加速。',
        '他没说话，也没回头，就这样走了。',
      ]);
      expect(storedScenes.map((scene) => scene.descPrompt)).toEqual(storedScenes.map((scene) => scene.cap));
      const storyboardRequest = requests.find((request) => request.step === 2);
      const storyboardContent = storyboardRequest?.messages.map((message) => message.content).join('\n') ?? '';
      expect(storyboardContent).toContain('JSON 字符串数组');
      expect(storyboardContent).toContain('尾部锚点');
      expect(storyboardRequest?.anthropic?.toolInputSchema).toBeUndefined();
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
        if (request.name.startsWith('rewrite-target-length-repair-')) {
          return {
            json: { rewrittenCopy: '字'.repeat(920), cover: { title: '武则天', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.step === 2) return { json: { scenes: makeScenes(3) } as T, raw: '{}', requestId: 'storyboard' };
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
        llm: mockConfiguredLlm(llm),
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const storyboardContent = requests.find((request) => request.step === 2)?.messages.map((message) => message.content).join('\n') ?? '';
      const imageContent = requests.find((request) => request.name === 'image-prompts')?.messages.map((message) => message.content).join('\n') ?? '';
      const snapshot = (await db.getState()).tasks[0].step3PromptSnapshot;

      expect(storyboardContent).toContain('# 分句规则 - 影视分镜级字幕拆分标准');
      expect(storyboardContent).toContain('JSON 字符串数组');
      expect(storyboardContent).toContain('尾部锚点');
      expect(storyboardContent).not.toContain('descPrompt');
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
        targetScenes: 12,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite('Targeted rewrite'), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.name.startsWith('rewrite-target-length-repair-')) {
          return {
            json: { rewrittenCopy: '字'.repeat(920), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      for (const request of requests.filter(
        (item) =>
          item.step === 1 &&
          (item.name.startsWith('rewrite-round-') ||
            item.name === 'rewrite-evaluation' ||
            item.name.startsWith('rewrite-target-length-repair-')),
      )) {
        const content = request.messages.map((message) => message.content).join('\n');
        expect(content).toContain('Target word count range: 720-1080 Chinese characters.');
        expect(countOccurrences(content, 'Target word count range: 720-1080 Chinese characters.')).toBe(1);
      }
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes the selected target scene count into rewrite prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-target-scenes-'));
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
        title: 'Target scenes task',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        targetScenes: 16,
      });
      const scenes = makeScenes(16);

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite('Targeted rewrite'), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.step === 2) return { json: { scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      for (const request of requests.filter(
        (item) => item.step === 1 && (item.name.startsWith('rewrite-round-') || item.name === 'rewrite-evaluation'),
      )) {
        const content = request.messages.map((message) => message.content).join('\n');
        expect(content).toContain('Storyboard scene count target: 16');
      }
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips review and rewrite when publish mode is direct copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-direct-copy-'));
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
        title: 'Direct copy publish',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
        publishMode: 'direct-copy',
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        if (request.step === 3) return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
        if (request.step === 4) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'cover' };
        throw new Error(`Unexpected request ${request.name} at step ${request.step}`);
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(requests.some((request) => request.step === 0)).toBe(false);
      expect(requests.some((request) => request.step === 1)).toBe(false);
      expect((await db.getState()).tasks[0].publishMode).toBe('direct-copy');
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses source length as the automatic target word count range when no target is selected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-auto-target-length-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];
    const repairedCopy = 'a'.repeat(100);

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
        if (request.name === 'rewrite-target-length-repair-1') {
          const repairPrompt = request.messages.map((message) => message.content).join('\n');
          expect(repairPrompt).toContain('Target word count range: 80-122 Chinese characters.');
          expect(repairPrompt).toContain('Word count is too low: current 16 Chinese characters, target 80-122.');
          return {
            json: { rewrittenCopy: repairedCopy, cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'auto-target-repair',
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makeArtifact().imagePrompts } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      for (const request of requests.filter(
        (item) =>
          item.step === 1 &&
          (item.name.startsWith('rewrite-round-') ||
            item.name === 'rewrite-evaluation' ||
            item.name.startsWith('rewrite-target-length-repair-')),
      )) {
        const content = request.messages.map((message) => message.content).join('\n');
        expect(content).toContain('Target word count range: 80-122 Chinese characters.');
        expect(countOccurrences(content, 'Target word count range: 80-122 Chinese characters.')).toBe(1);
      }
      expect(requests.some((request) => request.name === 'rewrite-target-length-repair-1')).toBe(true);
      await expect(readFile(join(dir, 'tasks', task.id, '01-rewritten-copy.md'), 'utf8')).resolves.toBe(repairedCopy);
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
            json: { rewrittenCopy: fitSourceLengthRewrite(), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
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
        llm: mockConfiguredLlm(llm),
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
          return { json: { rewrittenCopy: fitSourceLengthRewrite('Host A: First line\nHost B: Second line'), cover: { title: 'Podcast', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T, raw: '{}', requestId: 'rewrite' };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [{ round: 1, score: 90, reason: 'dialogue' }] } as T, raw: '{}', requestId: 'eval' };
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        return { json: { imagePrompts: makePrompts(extractScenesFromPrompt(request)) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
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

  it('runs rewrite evaluation with three rewrite rounds, saves local evaluation output, and injects a character card into image prompts', async () => {
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
        if (request.name === 'rewrite-round-1') {
          return {
            json: {
              rewrittenCopy: fitSourceLengthRewrite('Round 1 line one.\n\nRound 1 line two.'),
              cover: { title: 'Cover 1', subtitle: ['round 1 subtitle'], summary: 'summary 1', tags: ['#one'], comments: ['comment 1'] },
            } as T,
            raw: '{}',
            requestId: 'rewrite-1',
          };
        }
        if (request.name === 'rewrite-round-2') {
          return {
            json: {
              rewrittenCopy: fitSourceLengthRewrite('Round 2 line one.\n\nRound 2 line two.\n\nRound 2 line three.'),
              cover: { title: 'Cover 2', subtitle: ['round 2 subtitle'], summary: 'summary 2', tags: ['#two'], comments: ['comment 2'] },
            } as T,
            raw: '{}',
            requestId: 'rewrite-2',
          };
        }
        if (request.name === 'rewrite-round-3') {
          return {
            json: {
              rewrittenCopy: fitSourceLengthRewrite('Round 3 line one.\n\nRound 3 line two.'),
              cover: { title: 'Cover 3', subtitle: ['round 3 subtitle'], summary: 'summary 3', tags: ['#three'], comments: ['comment 3'] },
            } as T,
            raw: '{}',
            requestId: 'rewrite-3',
          };
        }
        if (request.name === 'rewrite-evaluation') {
          const evaluationPrompt = request.messages.map((message) => message.content).join('\n');
          expect(evaluationPrompt).toContain('Round 1 line one.');
          expect(evaluationPrompt).toContain('Round 2 line one.');
          expect(evaluationPrompt).toContain('Round 3 line one.');
          return {
            json: {
              bestRound: 2,
              evaluations: [
                { round: 1, score: 82, reason: 'round 1' },
                { round: 2, score: 97, reason: 'round 2' },
                { round: 3, score: 90, reason: 'round 3' },
              ],
            } as T,
            raw: '{}',
            requestId: 'rewrite-evaluation',
          };
        }
        if (request.name === 'cover-metadata') {
          const coverPrompt = request.messages.map((message) => message.content).join('\n');
          expect(coverPrompt).toContain('Final rewritten copy:');
          expect(coverPrompt).toContain('Round 2 line one.');
          return {
            json: {
              cover: { title: 'Cover 2', subtitle: ['round 2 subtitle'], summary: 'summary 2', tags: ['#two'], comments: ['comment 2'] },
            } as T,
            raw: '{}',
            requestId: 'cover-metadata',
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
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const workDir = join(dir, 'tasks', task.id);
      await expect(readFile(join(workDir, '01-rewritten-copy.md'), 'utf8')).resolves.toContain('Round 2 line one');
      await expect(readFile(join(workDir, '00-cover-title.json'), 'utf8')).resolves.toContain('Cover 2');
      const evaluations = JSON.parse(await readFile(join(workDir, '01-rewrite-evaluations.json'), 'utf8'));
      expect(evaluations.bestRound).toBe(2);
      expect(evaluations.evaluations).toEqual([
        { round: 1, score: 82, reason: 'round 1' },
        { round: 2, score: 97, reason: 'round 2' },
        { round: 3, score: 90, reason: 'round 3' },
      ]);
      const characterCard = JSON.parse(await readFile(join(workDir, '02-character-card.json'), 'utf8'));
      expect(characterCard.summary).toContain('same historical protagonist');
      expect(requests.filter((request) => request.name.startsWith('rewrite-round-'))).toHaveLength(3);
      expect(requests.filter((request) => request.name.startsWith('rewrite-round-')).every((request) => !request.messages.map((message) => message.content).join('\n').includes('Cover instructions:'))).toBe(true);
      expect(requests.some((request) => request.name === 'rewrite-evaluation')).toBe(true);
      expect(requests.some((request) => request.name === 'cover-metadata')).toBe(true);
      expect(requests.some((request) => request.name === 'character-card')).toBe(true);
      expect((await db.getState()).events.some((event) => event.detail.includes('第 3 轮'))).toBe(true);
      expect((await db.getState()).events.some((event) => event.type === 'step_warning')).toBe(false);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('enforces target word count range in review and rewrite before accepting rewritten copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-target-length-repair-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];
    const repairedCopy = '字'.repeat(130);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Target length repair',
        inputText: sampleInput,
        targetLength: 120,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: '太短', cover: { title: 'Short', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') {
          return {
            json: { bestRound: 1, evaluations: [{ round: 1, score: 90, reason: 'best but short' }] } as T,
            raw: '{}',
            requestId: 'rewrite-evaluation',
          };
        }
        if (request.name === 'rewrite-target-length-repair-1') {
          const repairPrompt = request.messages.map((message) => message.content).join('\n');
          expect(repairPrompt).toContain('Target-length repair rewrite');
          expect(repairPrompt).toContain('Target word count range: 96-144 Chinese characters.');
          expect(repairPrompt).toContain('Word count is too low: current 2 Chinese characters, target 96-144.');
          expect(repairPrompt).toContain('Current short draft:');
          expect(repairPrompt).not.toContain('Original source material:');
          expect(repairPrompt).not.toContain('Cover instructions:');
          return {
            json: { rewrittenCopy: repairedCopy, cover: { title: 'Repaired', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: 'rewrite-repair',
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(makeArtifact().scenes) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const reviewPrompt = requests.find((request) => request.step === 0)?.messages.map((message) => message.content).join('\n') ?? '';
      const rewritePrompt = requests.find((request) => request.name === 'rewrite-round-1')?.messages.map((message) => message.content).join('\n') ?? '';
      expect(reviewPrompt).toContain('你是一名资深短视频文案预审策划者');
      expect(reviewPrompt).toContain('【当前赛道】character-story');
      expect(reviewPrompt).toContain('不要主观臆断或编造细节');
      expect(reviewPrompt).toContain('适合后续创作原创短视频口播稿');
      expect(reviewPrompt).toContain('Target word count range: 96-144 Chinese characters.');
      expect(reviewPrompt).toContain('Preserve enough source detail');
      expect(reviewPrompt).not.toContain('rewrittenCopy');
      expect(rewritePrompt).toContain('Target word count range: 96-144 Chinese characters.');
      expect(requests.some((request) => request.name === 'rewrite-target-length-repair-1')).toBe(true);
      await expect(readFile(join(dir, 'tasks', task.id, '01-rewritten-copy.md'), 'utf8')).resolves.toBe(repairedCopy);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts the latest in-range rewrite after two target-length repairs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-target-length-near-miss-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];
    const nearMissCopy = '字'.repeat(2432);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Target length near miss',
        inputText: sampleInput,
        targetLength: 2500,
        targetScenes: 12,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: '太短', cover: { title: 'Short', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') {
          return { json: { bestRound: 1, evaluations: [{ round: 1, score: 90, reason: 'best but short' }] } as T, raw: '{}', requestId: 'rewrite-eval' };
        }
        if (request.name === 'rewrite-target-length-repair-1') {
          const repairPrompt = request.messages.map((message) => message.content).join('\n');
          expect(repairPrompt).toContain('Current draft length: 2 Chinese characters.');
          expect(repairPrompt).toContain('Target word count range: 2000-3000 Chinese characters.');
          expect(repairPrompt).toContain('Word count is too low: current 2 Chinese characters, target 2000-3000.');
          return {
            json: { rewrittenCopy: '字'.repeat(1900), cover: { title: 'Still short', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-target-length-repair-2') {
          const repairPrompt = request.messages.map((message) => message.content).join('\n');
          expect(repairPrompt).toContain('Current draft length: 1900 Chinese characters.');
          expect(repairPrompt).toContain('Target word count range: 2000-3000 Chinese characters.');
          expect(repairPrompt).toContain('Word count is too low: current 1900 Chinese characters, target 2000-3000.');
          return {
            json: { rewrittenCopy: nearMissCopy, cover: { title: 'Near miss', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(makeArtifact().scenes) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(requests.some((request) => request.name === 'rewrite-target-length-repair-2')).toBe(true);
      expect(requests.some((request) => request.name === 'rewrite-target-length-repair-3')).toBe(false);
      await expect(readFile(join(dir, 'tasks', task.id, '01-rewritten-copy.md'), 'utf8')).resolves.toBe(nearMissCopy);
      const evaluations = JSON.parse(await readFile(join(dir, 'tasks', task.id, '01-rewrite-evaluations.json'), 'utf8'));
      expect(evaluations.wordCountWarning).toBeUndefined();
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('compresses an overlong rewrite into the target word count range', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-target-length-overlong-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];
    const overlongCopy = 'x'.repeat(150);
    const compressedCopy = 'y'.repeat(100);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Target length overlong',
        inputText: sampleInput,
        targetLength: 100,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: overlongCopy, cover: { title: 'Long', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') {
          return { json: { bestRound: 1, evaluations: [{ round: 1, score: 90, reason: 'best but long' }] } as T, raw: '{}', requestId: 'rewrite-eval' };
        }
        if (request.name === 'rewrite-target-length-repair-1') {
          const repairPrompt = request.messages.map((message) => message.content).join('\n');
          expect(repairPrompt).toContain('Target-length repair rewrite');
          expect(repairPrompt).toContain('Current draft length: 150 Chinese characters.');
          expect(repairPrompt).toContain('Target word count range: 80-120 Chinese characters.');
          expect(repairPrompt).toContain('Word count is too high: current 150 Chinese characters, target 80-120.');
          expect(repairPrompt).toContain('Compress redundant phrasing without dropping key plot points or source facts.');
          expect(repairPrompt).toContain('Current long draft:');
          return {
            json: { rewrittenCopy: compressedCopy, cover: { title: 'Compressed', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.step === 2) return { json: { scenes: makeArtifact().scenes } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(makeArtifact().scenes) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(requests.some((request) => request.name === 'rewrite-target-length-repair-1')).toBe(true);
      expect(requests.some((request) => request.name === 'rewrite-target-length-repair-2')).toBe(false);
      await expect(readFile(join(dir, 'tasks', task.id, '01-rewritten-copy.md'), 'utf8')).resolves.toBe(compressedCopy);
      const evaluations = JSON.parse(await readFile(join(dir, 'tasks', task.id, '01-rewrite-evaluations.json'), 'utf8'));
      expect(evaluations.wordCountWarning).toBeUndefined();
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('repairs storyboard output when it is below the target scene count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-target-scenes-repair-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const requests: LlmJsonRequest[] = [];
    const repairedScenes = makeScenes(4);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Target scenes repair',
        inputText: sampleInput,
        storyboardSceneCount: 4,
        targetScenes: 4,
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        requests.push(request);
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite('First line\n\nSecond line\n\nThird line\n\nFourth line'), cover: { title: 'Scenes', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.name === 'storyboard') return { json: { scenes: makeScenes(2) } as T, raw: '{}', requestId: 'storyboard' };
        if (request.name === 'storyboard-target-scenes-repair-1') {
          const repairPrompt = request.messages.map((message) => message.content).join('\n');
          expect(repairPrompt).toContain('Target-scene repair storyboard.');
          expect(repairPrompt).toContain('Hard target storyboard scene count: 4.');
          expect(repairPrompt).toContain('Current storyboard scene count: 2.');
          expect(repairPrompt).toContain('Rewritten copy:');
          expect(repairPrompt).toContain('Current short storyboard:');
          return { json: { scenes: repairedScenes } as T, raw: '{}', requestId: 'storyboard-repair' };
        }
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(repairedScenes) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(requests.some((request) => request.name === 'storyboard-target-scenes-repair-1')).toBe(true);
      const storedScenes = JSON.parse(await readFile(join(dir, 'tasks', task.id, '02-sentences.json'), 'utf8')) as StoryboardScene[];
      expect(storedScenes).toHaveLength(4);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts storyboard scenes when scenes is a stringified array with trailing text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-stringified-storyboard-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');
    const scenes = makeScenes(12);

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Stringified storyboard scenes',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      const llm: JsonLlm = async <T,>(request: LlmJsonRequest) => {
        if (request.step === 0) return { json: { reviewedText: sampleInput } as T, raw: '{}', requestId: 'review' };
        if (request.name.startsWith('rewrite-round-')) {
          return {
            json: { rewrittenCopy: fitSourceLengthRewrite(), cover: { title: 'Storyboard', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
            raw: '{}',
            requestId: request.name,
          };
        }
        if (request.name === 'rewrite-evaluation') return { json: { bestRound: 1, evaluations: [] } as T, raw: '{}', requestId: 'rewrite-eval' };
        if (request.name === 'storyboard') {
          const stringifiedScenes = `${JSON.stringify(scenes, null, 2)}\n\nReturn only JSON.`;
          return { json: { scenes: stringifiedScenes } as T, raw: JSON.stringify({ scenes: stringifiedScenes }), requestId: 'storyboard' };
        }
        if (request.name === 'character-card') {
          return {
            json: { characterCard: { summary: 'same person', characters: [], consistencyRules: [] } } as T,
            raw: '{}',
            requestId: 'character-card',
          };
        }
        return { json: { imagePrompts: makePrompts(scenes) } as T, raw: '{}', requestId: 'prompts' };
      };

      await runTask(db, task, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'png', tinyPng),
        synthesizeNarration: async (inputScenes) => writeSceneAssets(mediaDir, inputScenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const storedScenes = JSON.parse(await readFile(join(dir, 'tasks', task.id, '02-sentences.json'), 'utf8')) as StoryboardScene[];
      expect(storedScenes).toHaveLength(12);
      expect(storedScenes[0]).toMatchObject({ id: 1, cap: 'Scene 1' });
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

  it('uses the recovered music_mv sidecar mode for full music MV draft export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-music-mv-sidecar-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const songPath = join(mediaDir, 'song.wav');
    const capturedPayloads: StoryboundSidecarInput[] = [];

    try {
      await mkdir(mediaDir, { recursive: true });
      await writeFile(songPath, wavTone(3600));
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'Music MV Sidecar',
        inputText: 'First lyric\nSecond lyric\nThird lyric',
        taskKind: 'music-mv',
        processingMode: 'full-auto',
        track: 'music-mv',
        musicMv: {
          rhythmMode: 'lyric-sync',
          captionStyle: 'karaoke',
          visualMotif: 'neon rain',
          audioPath: songPath,
        },
      });

      await runTask(db, task, {
        appDataDir: dir,
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        mediaSidecar: async (payload) => {
          capturedPayloads.push(payload);
          const draftDir = join(draftRootDir, 'music-mv-sidecar');
          await mkdir(draftDir, { recursive: true });
          await writeFile(join(draftDir, 'draft_content.json'), '{}', 'utf8');
          await writeFile(join(draftDir, 'draft_meta_info.json'), '{}', 'utf8');
          return { success: true, draft_dir: draftDir, draft_id: 'music-mv-sidecar' };
        },
      });

      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0]).toMatchObject({
        mode: 'music_mv',
        work_dir: join(dir, 'tasks', task.id),
        audio_path: songPath,
        material_source: 'ai',
        jianying_draft_path: draftRootDir,
        task_title: 'Music MV Sidecar',
        cover_title: expect.objectContaining({ title: expect.any(String) }),
        template: expect.objectContaining({ canvas: expect.any(Object) }),
      });
      expect((capturedPayloads[0] as { assignments?: unknown[] }).assignments).toHaveLength(3);
      expect((capturedPayloads[0] as { lyrics?: unknown[] }).lyrics).toHaveLength(3);
      expect((capturedPayloads[0] as { audio_duration?: number }).audio_duration).toBeGreaterThan(0);
      expect((await db.getState()).tasks[0]).toMatchObject({
        status: 'completed',
        outputDir: join(draftRootDir, 'music-mv-sidecar'),
      });
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exports html-video tasks through the typed HTML renderer instead of the draft writer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-html-video-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');
    const capturedExports: HtmlVideoExportInput[] = [];

    try {
      const task = await db.createTask({
        title: 'HTML Animation',
        inputText: sampleInput,
        taskKind: 'html-video',
        processingMode: 'full-auto',
        track: 'html-video',
        style: 'modern-film',
        ratio: '9:16',
        storyboardSceneCount: 3,
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        htmlVideoRenderer: async (input) => {
          capturedExports.push(input);
          return {
            outputPath: input.outputPath,
            sourceVideoPath: join(input.workDir, '_source.mp4'),
            duration: input.totalDurationS,
            taskDir: input.workDir,
            framesDirs: input.scenes.map((scene) => join(input.workDir, `frames-${String(scene.sceneId).padStart(3, '0')}`)),
          };
        },
      });

      const completed = (await db.getState()).tasks[0];
      expect(capturedExports).toHaveLength(1);
      expect(capturedExports[0]).toMatchObject({
        workDir: join(dir, 'tasks', task.id),
        outputPath: join(dir, 'tasks', task.id, 'HTML Animation.mp4'),
        fps: 30,
        canvas_w: 1080,
        canvas_h: 1920,
      });
      expect(capturedExports[0].scenes[0].html).toContain('window.__tl');
      expect(completed).toMatchObject({
        status: 'completed',
        taskKind: 'html-video',
        pipelineStep: 'done',
        outputDir: join(dir, 'tasks', task.id, 'HTML Animation.mp4'),
      });
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

  it('records the failed image scene id when a provider rejects one storyboard image', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-image-scene-error-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');
    const providerError = 'Image provider API error (400): content_policy_violation';

    try {
      const task = await db.createTask({
        title: 'Image scene error',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });
      const artifact = makeArtifact();
      artifact.scenes = artifact.scenes.slice(0, 2);
      artifact.imagePrompts = makePrompts(artifact.scenes);

      await expect(runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => artifact,
        generateImages: async (scenes) => {
          if (scenes.some((scene) => scene.id === 2)) {
            throw new Error(providerError);
          }
          return writeSceneAssets(mediaDir, scenes, 'png', tinyPng);
        },
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      })).rejects.toThrow(providerError);

      const state = await db.getState();
      const pipeline = JSON.parse(await readFile(state.tasks[0].artifactStatePath, 'utf8')) as {
        assets?: { imageErrors?: Array<{ sceneId: number; message: string }> };
      };

      expect(state.tasks[0]).toMatchObject({ status: 'paused', currentStep: 4, failedStep: 4 });
      expect(pipeline.assets?.imageErrors).toEqual([{ sceneId: 2, message: providerError }]);
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
          llm: mockConfiguredLlm(async () => {
            throw new Error('LLM API key is missing; cannot run real task content generation.');
          }),
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
            json: { rewrittenCopy: fitSourceLengthRewrite(), cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: [], comments: [] } } as T,
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

      await expect(runTask(db, task, { appDataDir: dir, llm: mockConfiguredLlm(llm) })).rejects.toThrow(/storyboard provider failed/);
      const paused = (await db.getState()).tasks[0];
      expect(paused.status).toBe('paused');
      expect(paused.failedStep).toBe(2);

      await runTask(db, paused, {
        appDataDir: dir,
        llm: mockConfiguredLlm(llm),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      expect(calls).toMatchObject({ 0: 1, 1: 5, 2: 2, 3: 2 });
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
            json: { rewrittenCopy: fitSourceLengthRewrite('Fresh rewrite'), cover: { title: 'Fresh title', subtitle: [], summary: 'fresh summary', tags: [], comments: [] } } as T,
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
          llm: mockConfiguredLlm(llm),
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
    ...makeScenes(10).map((scene, index) => ({ ...scene, id: index + 3, cap: `Scene ${index + 3}`, descPrompt: `visual prompt ${index + 3}` })),
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

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function fitSourceLengthRewrite(prefix = 'First line\n\nSecond line', source = sampleInput): string {
  const target = countVisibleTestCharacters(source);
  const prefixLength = countVisibleTestCharacters(prefix);
  if (prefixLength >= Math.floor(target * 0.8) && prefixLength <= Math.ceil(target * 1.2)) return prefix;
  return `${prefix}\n\n${'x'.repeat(Math.max(0, target - prefixLength))}`;
}

function countVisibleTestCharacters(value: string): number {
  return value.replace(/\s+/g, '').length;
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
