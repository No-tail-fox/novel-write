import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import type { ImagePrompt, PipelineArtifact, StoryboardScene, TaskStatus } from '@shared/types';
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
        content: '任务模板标记：{{track}} / {{inputText}}',
        isBuiltin: false,
        baseTrack: 'character-story',
      });
      for (const template of [
        ['builtin-review', 'review', '预审模板标记：{{taskTemplateContent}} / {{inputText}}'],
        ['builtin-rewrite', 'rewrite', '改写模板标记：{{reviewedText}}'],
        ['builtin-cover', 'cover', '封面模板标记：{{rewrittenCopy}}'],
        ['builtin-storyboard', 'storyboard', '分镜模板标记：{{rewrittenCopy}}'],
        ['builtin-image-prompt', 'image-prompt', '绘图模板标记：{{scenesJson}} / {{taskTemplateContent}}'],
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
      expect((await db.getState()).tasks[0].step3PromptSnapshot).toContain('绘图模板标记');
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

      expect(calls).toMatchObject({ 0: 1, 1: 1, 2: 2, 3: 1 });
      expect((await db.getState()).tasks[0].status).toBe('completed');
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
  await writeFile(draftMetaPath, JSON.stringify({ draft_name: payload.title, tm_duration: payload.totalDurationUs }), 'utf8');
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
  const imagePrompts: ImagePrompt[] = scenes.map((scene) => ({
    sceneId: scene.id,
    cap: scene.cap,
    prompt: scene.descPrompt,
    negativePrompt: 'none',
    style: 'photo-real',
    ratio: '9:16',
    characterProfile: 'same person',
  }));
  return {
    reviewedText: sampleInput,
    rewrittenCopy: 'First line\n\nSecond line',
    cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: ['#tag'], comments: [] },
    scenes,
    imagePrompts,
    subtitles: { cues: [], srt: '' },
  };
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
