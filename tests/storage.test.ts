import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { defaultConfig } from '@shared/config';
import { convertCozeWorkflowToDraftTemplate } from '@shared/coze-workflow-converter';

describe('file database', () => {
  it('persists config, tasks, and events across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertConfig({
        ...defaultConfig,
        llm: { ...defaultConfig.llm, provider: 'custom', baseUrl: 'https://example.com', apiKey: 'k', model: 'gpt-5', proxyUrl: '' },
        image: { ...defaultConfig.image, baseUrl: 'https://example.com', apiKey: 'img', model: 'image-1', ratio: '9:16', concurrency: 2 },
        jianying: { ...defaultConfig.jianying, draftPath: 'G:/JianyingPro Drafts' },
      });
      const task = await db.createTask({ title: '20260507 - 武则天', inputText: '武曌...', track: 'character-story', style: 'photo-real' });
      await db.addTaskEvent(task.id, { type: 'step_start', step: 0, agent: 'Reviewer', detail: '预审整理文案' });
      await db.updateTask(task.id, { status: 'running', currentStep: 1 });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.config.jianying.draftPath).toBe('G:/JianyingPro Drafts');
      expect(state.tasks).toHaveLength(1);
      expect(state.events).toHaveLength(1);
      expect(state.tasks[0].title).toBe('20260507 - 武则天');
      await reopened.close();
      const raw = await readFile(file);
      expect(raw.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recovers interrupted running tasks as paused on startup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-recover-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const task = await db.createTask({ title: 'Interrupted', inputText: '素材', track: 'character-story', style: 'photo-real' });
      await db.updateTask(task.id, {
        status: 'running',
        currentStep: 0,
        errorMessage: 'LLM API key is missing; cannot run real task content generation.',
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.tasks[0]).toMatchObject({
        status: 'paused',
        currentStep: 0,
        failedStep: 0,
        retryFromStep: 0,
      });
      expect(state.tasks[0].errorMessage).toContain('LLM API key is missing');
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists selected AI web sources with the task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-sources-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Selected sources',
        inputText: '',
        mode: 'ai',
        aiKeyword: '武则天',
        aiSources: ['web'],
        selectedSources: [{ source: 'web', title: 'Selected article', url: 'https://example.test/a', content: 'Selected page body.' }],
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.tasks[0].selectedSources).toEqual([
        { source: 'web', title: 'Selected article', url: 'https://example.test/a', content: 'Selected page body.' },
      ]);
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists voice lab preview records across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-voice-lab-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.addVoiceLabRecord({
        text: '试听文案',
        provider: 'minimax',
        voiceId: 'female-yujie',
        voiceLabel: '御姐',
        speed: 1.15,
        audioPath: join(dir, 'voice-lab', 'preview.mp3'),
        status: 'generated',
        errorMessage: '',
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.voiceLabRecords).toHaveLength(1);
      expect(state.voiceLabRecords[0]).toMatchObject({
        text: '试听文案',
        provider: 'minimax',
        voiceId: 'female-yujie',
        voiceLabel: '御姐',
        speed: 1.15,
        status: 'generated',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists prompt template image seed pools across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-prompt-seeds-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertPromptTemplate({
        id: 'custom-seed-pools',
        name: 'Seed Pools',
        type: 'task',
        description: 'reference prompt content',
        content: 'Task instruction',
        isBuiltin: false,
        updatedAt: '2026-06-08T00:00:00.000Z',
        baseTrack: 'general-story',
        defaultStyles: ['photo-real'],
        defaultDraftTemplateId: 'default-portrait-9-16',
        characterPolicy: 'follow-template',
        step3SkeletonModules: ['产品一致性'],
        referenceKind: 'product',
        stepPrompts: {
          rewrite: 'rewrite prompt',
          cover: 'metadata prompt',
          'image-prompt': 'step 3 prompt',
        },
        imageSeedPoolsJson: '{"scenes":["wide","close"]}',
        origin: 'custom',
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.promptTemplates.find((template) => template.id === 'custom-seed-pools')).toMatchObject({
        imageSeedPoolsJson: '{"scenes":["wide","close"]}',
        stepPrompts: {
          rewrite: 'rewrite prompt',
          cover: 'metadata prompt',
          'image-prompt': 'step 3 prompt',
        },
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists converted Coze workflow draft templates across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-coze-draft-template-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const conversion = convertCozeWorkflowToDraftTemplate(JSON.stringify({
        type: 'coze-workflow-clipboard-data',
        source: { workflowId: '7629256239332032548' },
        json: {
          nodes: [
            {
              id: 'create',
              type: '4',
              data: {
                nodeMeta: { title: 'create_draft' },
                inputs: {
                  apiParam: [
                    cozeApiParam('apiName', 'create_draft'),
                    cozeApiParam('pluginID', '7522412867740565513'),
                    cozeApiParam('pluginName', '视频合成_剪映小助手'),
                  ],
                  inputParameters: [
                    cozeLiteralParameter('width', 1920),
                    cozeLiteralParameter('height', 1080),
                  ],
                },
              },
            },
          ],
        },
      }), { name: 'Coze imported template' });
      if (!conversion.ok) throw new Error(conversion.error);

      await db.upsertDraftTemplate(conversion.template);
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();
      const template = state.draftTemplates.find((item) => item.id === 'coze-7629256239332032548');

      expect(template).toMatchObject({
        name: 'Coze imported template',
        isDefault: false,
        canvas: { width: 1920, height: 1080, ratio: '16:9' },
        image: { ratio: '16:9', fit: 'cover' },
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists viral analyses and events across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-viral-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const record = await db.createViralAnalysis({
        url: 'https://www.douyin.com/video/123',
        platform: 'douyin',
        title: 'Viral source',
        settings: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
      });
      await db.addViralAnalysisEvent(record.id, {
        type: 'stage_start',
        stage: 'downloading',
        detail: 'downloading source video',
      });
      await db.updateViralAnalysis(record.id, {
        status: 'completed',
        currentStage: 'completed',
        resultPath: join(dir, 'viral-result.json'),
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.viralAnalyses).toHaveLength(1);
      expect(state.viralAnalyses[0]).toMatchObject({
        url: 'https://www.douyin.com/video/123',
        platform: 'douyin',
        status: 'completed',
        resultPath: join(dir, 'viral-result.json'),
      });
      expect(state.viralEvents).toHaveLength(1);
      expect(state.viralEvents[0]).toMatchObject({
        analysisId: record.id,
        type: 'stage_start',
        stage: 'downloading',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the active GPT image provider settings effective after saving config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-image-config-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertConfig({
        ...defaultConfig,
        imageProvider: 'gpt_image',
        image: { ...defaultConfig.image, apiKey: '', baseUrl: '', model: 'old-image-model' },
        gptImage: {
          ...defaultConfig.gptImage,
          apiKey: 'saved-image-key',
          baseUrl: 'https://image.example/v1',
          model: 'gpt-image-2',
          concurrency: 4,
          resolution: '4K',
        },
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.config.gptImage).toMatchObject({
        apiKey: 'saved-image-key',
        baseUrl: 'https://image.example/v1',
        model: 'gpt-image-2',
        concurrency: 4,
        resolution: '4K',
      });
      expect(state.config.image).toMatchObject({
        apiKey: 'saved-image-key',
        baseUrl: 'https://image.example/v1',
        model: 'gpt-image-2',
        concurrency: 4,
        resolution: '4K',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists enabled model profiles across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-model-profiles-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertConfig({
        ...defaultConfig,
        llm: { ...defaultConfig.llm, id: 'llm-custom', apiKey: 'llm-key', baseUrl: 'https://llm.example', model: 'llm-active', enabled: true },
        llmProfiles: [
          { ...defaultConfig.llm, id: 'llm-old', name: 'Old LLM', apiKey: 'old-key', baseUrl: 'https://old-llm.example', model: 'llm-old', enabled: false },
          { ...defaultConfig.llm, id: 'llm-custom', name: 'Custom LLM', apiKey: 'llm-key', baseUrl: 'https://llm.example', model: 'llm-active', enabled: true },
        ],
        activeLlmProfileId: 'llm-custom',
        imageProfiles: [
          {
            id: 'image-old',
            name: 'Old image',
            provider: 'gpt_image',
            enabled: false,
            gptImage: { ...defaultConfig.gptImage, apiKey: 'old-image-key', baseUrl: 'https://old-image.example', model: 'old-image' },
          },
          {
            id: 'image-custom',
            name: 'Custom image',
            provider: 'custom',
            enabled: true,
            customImage: { ...defaultConfig.customImage, apiKey: 'image-key', baseUrl: 'https://image.example', model: 'image-active' },
          },
        ],
        activeImageProfileId: 'image-custom',
        ttsProfiles: [
          {
            id: 'tts-old',
            name: 'Old TTS',
            provider: 'volcengine',
            enabled: false,
            volcengine: { ...defaultConfig.tts.volcengine, appId: 'old-app', accessKey: 'old-token', speaker: 'old-voice' },
          },
          {
            id: 'tts-minimax',
            name: 'MiniMax TTS',
            provider: 'minimax',
            enabled: true,
            minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-active', voiceId: 'voice-active' },
          },
        ],
        activeTtsProfileId: 'tts-minimax',
      } as unknown as typeof defaultConfig);
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.config.llm).toMatchObject({ id: 'llm-custom', model: 'llm-active', enabled: true });
      expect(state.config.activeImageProfileId).toBe('image-custom');
      expect(state.config.imageProvider).toBe('custom');
      expect(state.config.customImage).toMatchObject({ apiKey: 'image-key', baseUrl: 'https://image.example', model: 'image-active' });
      expect(state.config.activeTtsProfileId).toBe('tts-minimax');
      expect(state.config.tts.provider).toBe('minimax');
      expect(state.config.tts.minimax).toMatchObject({ apiKey: 'tts-key', model: 'speech-active', voiceId: 'voice-active' });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function cozeApiParam(name: string, content: string) {
  return {
    name,
    input: {
      type: 'string',
      value: {
        type: 'literal',
        content,
      },
    },
  };
}

function cozeLiteralParameter(name: string, content: unknown) {
  return {
    name,
    input: {
      type: typeof content === 'number' ? 'integer' : 'string',
      value: {
        type: 'literal',
        content,
      },
    },
  };
}
