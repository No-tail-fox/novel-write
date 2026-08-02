import { describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileDatabase } from '@shared/storage';
import { defaultConfig } from '@shared/config';
import { convertCozeWorkflowToDraftTemplate } from '@shared/coze-workflow-converter';
import {
  createHtmlVideoPipelineData,
  createHtmlVideoTaskInput,
  htmlVideoVisibleSteps,
  parseHtmlVideoPipelineData,
  recoverHtmlVideoPipelineDataForRetry,
} from '@shared/html-video-workflow';

function configWithStorageSecret(secret: string) {
  return {
    ...structuredClone(defaultConfig),
    llm: { ...defaultConfig.llm, apiKey: secret },
    llmProfiles: [{ ...defaultConfig.llmProfiles[0], apiKey: secret }],
  };
}

describe('file database', () => {
  async function overwriteThemeRows(file: string, config: unknown, ui: unknown): Promise<void> {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database(await readFile(file));
    sqlite.run('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)', [JSON.stringify(config)]);
    sqlite.run('INSERT OR REPLACE INTO ui_preferences (id, data) VALUES (1, ?)', [JSON.stringify(ui)]);
    const bytes = sqlite.export();
    sqlite.close();
    await writeFile(file, bytes);
  }

  it('migrates legacy theme ownership atomically and preserves activeView', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-theme-owner-migration-'));
    const file = join(dir, 'app.db');
    try {
      const seeded = await FileDatabase.open(file);
      await seeded.close();
      await overwriteThemeRows(
        file,
        { ...structuredClone(defaultConfig), ui: { theme: 'light' } },
        { theme: 'dark', activeView: 'history' },
      );

      const migrated = await FileDatabase.open(file);
      expect((await migrated.getState())).toMatchObject({
        ui: { theme: 'light', activeView: 'history', themePreferenceVersion: 1 },
        config: { ui: { theme: 'light' } },
      });
      await migrated.close();

      const restarted = await FileDatabase.open(file);
      expect((await restarted.getState()).ui).toEqual({
        theme: 'light', activeView: 'history', themePreferenceVersion: 1,
      });
      await restarted.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prevents navigation and stale config drafts from overwriting the current theme', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-theme-owner-updates-'));
    const file = join(dir, 'app.db');
    const db = await FileDatabase.open(file);
    try {
      await db.upsertUiPreferences({ theme: 'light' });
      const navigated = await db.upsertUiPreferences({ activeView: 'settings' });
      expect(navigated).toMatchObject({
        ui: { theme: 'light', activeView: 'settings', themePreferenceVersion: 1 },
        config: { ui: { theme: 'light' } },
      });

      const saved = await db.upsertConfig({ ...structuredClone(defaultConfig), ui: { theme: 'dark' } });
      expect(saved).toMatchObject({
        ui: { theme: 'light', activeView: 'settings', themePreferenceVersion: 1 },
        config: { ui: { theme: 'light' } },
      });
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rolls back both theme owner and config mirror when persistence fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-theme-owner-rollback-'));
    const file = join(dir, 'app.db');
    let rejectReplace = false;
    const db = await FileDatabase.open(file, {
      replaceFile: async (source, target) => {
        if (rejectReplace) throw new Error('injected theme commit failure');
        await rename(source, target);
      },
    });
    try {
      rejectReplace = true;
      await expect(db.upsertUiPreferences({ theme: 'light' })).rejects.toThrow('injected theme commit failure');
      rejectReplace = false;

      const state = await db.getState();
      expect(state.ui.theme).toBe('dark');
      expect(state.config.ui.theme).toBe('dark');
    } finally {
      rejectReplace = false;
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('strips provider credentials from normal config persistence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-config-redaction-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      await db.upsertConfig(configWithStorageSecret('must-never-reach-sqlite'));

      expect(JSON.stringify((await db.getState()).config)).not.toContain('must-never-reach-sqlite');
      await db.close();
      expect((await readFile(file)).includes(Buffer.from('must-never-reach-sqlite'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates StoryDream-compatible local tables and seeds Chinese account state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-compatible-schema-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const state = await db.getState();

      expect(state.account).toMatchObject({
        displayName: '本地用户',
        workspace: 'StoryDream 本地工作区',
      });
      expect(state.activation.message).toContain('试用');
      expect(state.creditTransactions.length).toBeGreaterThan(0);
      expect(state.minimaxCloneVoices).toEqual(expect.any(Array));

      await db.close();

      const SQL = await initSqlJs();
      const raw = await readFile(file);
      const sqlite = new SQL.Database(raw);
      const tableRows = sqlite.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0]?.values ?? [];
      const tables = tableRows.map((row) => String(row[0]));

      expect(tables).toEqual(expect.arrayContaining([
        'tasks',
        'task_events',
        'draft_templates',
        'user_prompt_templates',
        'playground_jobs',
        'minimax_clone_voices',
        'credits_transactions',
        'custom_styles',
        'custom_cover_templates',
        'book_selection',
      ]));

      const taskColumns = sqlite.exec('PRAGMA table_info(tasks)')[0]?.values.map((row) => String(row[1])) ?? [];
      expect(taskColumns).toEqual(expect.arrayContaining([
        'material_source',
        'product_info',
        'material_person',
        'draft_dir',
        'fixed_intro',
        'outro_cta',
        'lock_intro_sentences',
        'task_type',
        'pipeline_step',
        'pipeline_data',
        'target_length',
        'target_scenes',
        'script_format',
        'cover_image_mode',
        'cover_template_id',
        'ordinary_cover_asset_json',
      ]));

      const promptColumns = sqlite.exec('PRAGMA table_info(user_prompt_templates)')[0]?.values.map((row) => String(row[1])) ?? [];
      expect(promptColumns).toEqual(expect.arrayContaining([
        'step1_rewrite_system_prompt',
        'step1_metadata_system_prompt',
        'step3_system_prompt',
        'style_id',
        'image_seed_pools_json',
        'needs_character_card',
        'step3_skeleton_modules_json',
        'reference_kind',
      ]));
      sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists latest Storybound task controls and product fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-latest-task-controls-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const productInfo = JSON.stringify({ name: '额尔古纳河右岸', sellpt: '民族史诗' });
      await db.createTask({
        title: 'Latest Storybound controls',
        inputText: '一段原始素材',
        productInfo,
        materialSource: 'local',
        materialPerson: '迟子建',
        draftDir: 'D:/drafts/latest',
        fixedIntro: '今天先别急着划走。',
        outroCta: '想看{主角}，去橱窗找这本书。',
        lockIntroSentences: 3,
        autoBorrowImage: true,
        imageQuality: 'low',
      });

      const state = await db.getState();
      expect(state.tasks[0]).toMatchObject({
        productInfo,
        materialSource: 'local',
        materialPerson: '迟子建',
        draftDir: 'D:/drafts/latest',
        fixedIntro: '今天先别急着划走。',
        outroCta: '想看{主角}，去橱窗找这本书。',
        lockIntroSentences: 3,
        autoBorrowImage: true,
        imageQuality: 'low',
      });
      const defaultTask = await db.createTask({ inputText: '默认严格失败' });
      expect(defaultTask.autoBorrowImage).toBe(false);
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('round-trips explicit false promotion with product info and rejects new manual covers before insert', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-ordinary-task-semantics-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Literal promotion choice',
        inputText: 'source',
        keepPromotion: false,
        productInfo: JSON.stringify({ name: 'Book' }),
        coverImageMode: 'off',
      });
      await expect(db.createTask({
        title: 'Unsupported manual cover',
        inputText: 'source',
        coverImageMode: 'manual',
      })).rejects.toThrow(/ORDINARY_MANUAL_COVER_REQUIRED/);
      expect((await db.getState()).tasks).toHaveLength(1);
      await db.close();

      const reopened = await FileDatabase.open(file);
      expect((await reopened.getState()).tasks[0]).toMatchObject({
        keepPromotion: false,
        productInfo: JSON.stringify({ name: 'Book' }),
        coverImageMode: 'off',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('atomically binds a validated ordinary cover into task-managed storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-ordinary-managed-cover-'));
    const file = join(dir, 'app.db');
    const sourcePath = join(dir, 'selected.jpg');
    const managedBytes = Buffer.from('normalized-managed-cover');
    try {
      await writeFile(sourcePath, 'selected-source');
      const db = await FileDatabase.open(file);
      const task = await db.createTaskWithOrdinaryCover({
        title: 'Manual cover task',
        inputText: 'source',
        ratio: '9:16',
        coverImageMode: 'manual',
        manualCoverAssetId: '1f3de8ea-6775-43ab-971c-1e922eb19a57',
      }, {
        sourcePath,
        sourceBytes: Buffer.from('verified-source-bytes'),
        exists: true,
        isFile: true,
        sizeBytes: 1024,
        width: 720,
        height: 1280,
        mimeType: 'image/jpeg',
        originalName: 'selected.jpg',
      }, '9:16', {
        prepareImage: async ({ destinationPath, sourceBytes }) => {
          expect(sourceBytes).toEqual(Buffer.from('verified-source-bytes'));
          await writeFile(destinationPath, managedBytes, { flag: 'wx' });
          return {
            sizeBytes: managedBytes.length,
            width: 720,
            height: 1280,
            mimeType: 'image/png',
            sha256: createHash('sha256').update(managedBytes).digest('hex'),
          };
        },
        promoteFile: (source, target) => rename(source, target),
        removeFile: async (path) => { await rm(path, { force: true }); },
        ensureDirectory: async (path) => { await mkdir(path, { recursive: true }); },
        now: () => '2026-07-23T00:00:00.000Z',
      });
      expect(task.coverImageMode).toBe('manual');
      expect(task.ordinaryCoverAsset).toMatchObject({ path: 'covers/cover-manual.png', ratio: '9:16' });
      expect(await readFile(join(dir, 'tasks', task.managedStorageKey!, 'covers', 'cover-manual.png'))).toEqual(managedBytes);
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists local book selection records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-book-selection-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertBookSelection({
        theme: '文学',
        bookId: 'erguna',
        data: {
          name: '额尔古纳河右岸',
          author: '迟子建',
          keyword: '鄂温克',
          sellPoint: '民族迁徙与女性命运',
        },
      });

      const rows = await db.listBookSelections();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        theme: '文学',
        bookId: 'erguna',
      });
      expect(rows[0].data.name).toBe('额尔古纳河右岸');
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists StoryDream task workflow fields on created tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-task-workflow-fields-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: '参考字段任务',
        inputText: '一段原始素材',
        llmProfileId: 'llm-draft',
        materialSource: 'paste',
        taskType: 'story',
        pipelineStep: 'step-0-review',
        pipelineData: '{"from":"storybound"}',
        targetLength: 1800,
        targetScenes: 16,
        scriptFormat: 'short-video',
        coverImageMode: 'auto',
        coverTemplateId: 'cinematic-poster',
      } as Parameters<typeof db.createTask>[0] & Record<string, unknown>);

      const state = await db.getState();
      expect(state.tasks[0]).toMatchObject({
        materialSource: 'paste',
        taskType: 'story',
        pipelineStep: 'step-0-review',
        pipelineData: '{"from":"storybound"}',
        targetLength: 1800,
        targetScenes: 16,
        scriptFormat: 'short-video',
        llmProfileId: 'llm-draft',
        coverImageMode: 'auto',
        coverTemplateId: 'cinematic-poster',
      });
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('updates the selected draft template without changing generated-media settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-task-template-switch-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const task = await db.createTask({
        inputText: '切换草稿模板',
        templateId: 'default-portrait-9-16',
        ratio: '9:16',
      });
      await db.updateTask(task.id, { templateId: 'builtin-landscape-16-9' });
      const updated = await db.getTaskDetail(task.id);
      expect(updated).toMatchObject({
        templateId: 'builtin-landscape-16-9',
        ratio: '9:16',
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      await expect(reopened.getTaskDetail(task.id)).resolves.toMatchObject({
        templateId: 'builtin-landscape-16-9',
        ratio: '9:16',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('atomically persists the HTML video pipeline step and versioned snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-html-video-checkpoint-'));
    const file = join(dir, 'app.db');
    const pipelineData = JSON.stringify({
      version: 2,
      revision: 3,
      current: 'assets',
      warnings: [],
      steps: {},
      scenes: [],
      assets: [],
      voices: [],
      compositions: [],
      config: {},
    });

    try {
      const db = await FileDatabase.open(file);
      const task = await db.createTask({
        title: 'HTML checkpoint',
        inputText: 'source',
        taskType: 'html-video',
        pipelineStep: 'plan',
        pipelineData: '{"legacy":true}',
      });

      await db.updateTask(task.id, { pipelineStep: 'assets', pipelineData });
      await db.close();

      const reopened = await FileDatabase.open(file);
      expect((await reopened.getState()).tasks[0]).toMatchObject({
        pipelineStep: 'assets',
        pipelineData,
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('atomically saves versioned HTML composition source and rolls back file and database failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-html-video-source-'));
    const file = join(dir, 'app.db');
    let rejectDatabaseReplace = false;
    const db = await FileDatabase.open(file, {
      replaceFile: async (source, target) => {
        if (rejectDatabaseReplace) throw new Error('injected composition database commit failure');
        await rename(source, target);
      },
    });
    const sourceV1 = '<!doctype html><html><body><main data-composition-id="scene-1" data-duration="2"></main></body></html>';
    const sourceV2 = sourceV1.replace('</main>', '<p>saved revision two</p></main>');
    const sourceV3 = sourceV1.replace('</main>', '<p>must roll back</p></main>');
    const fileOperations = {
      ensureDirectory: async (path: string) => { await mkdir(path, { recursive: true }); },
      writeSource: async (path: string, source: string) => { await writeFile(path, source, 'utf8'); },
      moveFile: async (source: string, target: string) => { await rename(source, target); },
      removeFile: async (path: string) => { await rm(path, { force: true }); },
      now: () => '2026-07-30T10:00:00.000Z',
    };

    try {
      const task = await db.createTask(createHtmlVideoTaskInput({ copy: '源码修订测试。' }));
      if (!task.managedStorageKey) throw new Error('HTML video source fixture has no managed storage key.');
      const htmlPath = join(dir, 'tasks', task.managedStorageKey, 'html-scenes', 'scene-001.html');
      await mkdir(join(htmlPath, '..'), { recursive: true });
      await writeFile(htmlPath, sourceV1, 'utf8');

      const pipeline = createHtmlVideoPipelineData(task.inputText, {});
      pipeline.revision = 7;
      pipeline.current = 'done';
      for (const step of htmlVideoVisibleSteps) pipeline.steps[step] = { status: 'completed' };
      pipeline.compositions = [{
        index: 1,
        durationSec: 2,
        canvas: { w: 1080, h: 1920 },
        audio: { src: join(dir, 'voice.wav'), durationSec: 2 },
        background: { src: join(dir, 'background.png') },
        captions: [],
        htmlPath,
        thumbnailPath: join(dir, 'thumbnail.png'),
        rev: 1,
      }];
      pipeline.output = { path: join(dir, 'final.mp4'), sizeBytes: 2048, durationSec: 2 };
      await db.updateTask(task.id, {
        status: 'completed',
        currentStep: 6,
        pipelineStep: 'done',
        pipelineData: JSON.stringify(pipeline),
      });

      const saved = await db.updateHtmlVideoCompositionSource({
        taskId: task.id,
        sceneIndex: 1,
        expectedRevision: 1,
        source: sourceV2,
      }, fileOperations);
      expect(saved.composition.rev).toBe(2);
      expect(await readFile(htmlPath, 'utf8')).toBe(sourceV2);

      const afterSave = (await db.getState()).tasks.find((item) => item.id === task.id);
      const savedPipeline = parseHtmlVideoPipelineData(afterSave?.pipelineData);
      expect(afterSave).toMatchObject({ status: 'paused', currentStep: 5, pipelineStep: 'render' });
      expect(savedPipeline.revision).toBe(8);
      expect(savedPipeline.compositions).toEqual([{ ...pipeline.compositions[0], rev: 2 }]);
      expect(savedPipeline.steps.preview.status).toBe('completed');
      expect(savedPipeline.steps.render.status).toBe('pending');
      expect(savedPipeline.output).toBeUndefined();

      await expect(db.updateHtmlVideoCompositionSource({
        taskId: task.id,
        sceneIndex: 1,
        expectedRevision: 1,
        source: sourceV3,
      }, fileOperations)).rejects.toThrow('HTML_VIDEO_SOURCE_CONFLICT');
      expect(await readFile(htmlPath, 'utf8')).toBe(sourceV2);

      await db.updateTask(task.id, { status: 'running' });
      await expect(db.updateHtmlVideoCompositionSource({
        taskId: task.id,
        sceneIndex: 1,
        expectedRevision: 2,
        source: sourceV3,
      }, fileOperations)).rejects.toThrow('HTML_VIDEO_SOURCE_ACTIVE');
      expect(await readFile(htmlPath, 'utf8')).toBe(sourceV2);

      await db.updateTask(task.id, { status: 'paused' });
      rejectDatabaseReplace = true;
      await expect(db.updateHtmlVideoCompositionSource({
        taskId: task.id,
        sceneIndex: 1,
        expectedRevision: 2,
        source: sourceV3,
      }, fileOperations)).rejects.toThrow('injected composition database commit failure');
      rejectDatabaseReplace = false;

      expect(await readFile(htmlPath, 'utf8')).toBe(sourceV2);
      const afterFailure = (await db.getState()).tasks.find((item) => item.id === task.id);
      expect(parseHtmlVideoPipelineData(afterFailure?.pipelineData).compositions[0].rev).toBe(2);
    } finally {
      rejectDatabaseReplace = false;
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists every HTML retry setting outside the recoverable pipeline snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-html-video-recovery-settings-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const created = await db.createTask(createHtmlVideoTaskInput({
        copy: '第一句。\n\n第二句。\n\n第三句。\n\n第四句。',
        ratio: '1:1',
        style: 'paper-cut',
        ttsProvider: 'minimax',
        voiceId: 'female-shaonv',
        ttsSpeed: 1.2,
        bgmId: 'bgm-recovery',
        maxScenes: 4,
        foreground: false,
      }));
      expect(created).toMatchObject({
        targetScenes: 4,
        coverImageMode: 'off',
        coverTemplateId: 'cinematic-poster',
        htmlVideoForeground: false,
      });

      await db.updateTask(created.id, { pipelineData: '{' });
      await db.close();
      const reopened = await FileDatabase.open(file);
      const stored = (await reopened.getState()).tasks[0];
      expect(stored).toMatchObject({ htmlVideoForeground: false, targetScenes: 4, coverImageMode: 'off' });
      const recovery = recoverHtmlVideoPipelineDataForRetry(stored);
      const recovered = parseHtmlVideoPipelineData(recovery?.pipelineData);
      expect(recovered.config).toMatchObject({
        maxScenes: 4,
        foreground: false,
        coverImageMode: 'off',
        coverTemplate: 'cinematic-poster',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the recovered Storybound ai material source default while preserving explicit paste tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-material-source-default-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Default material source',
        inputText: 'Source material',
      });
      await db.createTask({
        title: 'Explicit paste material source',
        inputText: 'Source material',
        materialSource: 'paste',
      });

      const state = await db.getState();
      expect(state.tasks.find((task) => task.title === 'Default material source')?.materialSource).toBe('ai');
      expect(state.tasks.find((task) => task.title === 'Explicit paste material source')?.materialSource).toBe('paste');
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists publish mode on created tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-publish-mode-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Direct copy task',
        inputText: 'Source material',
        publishMode: 'direct-copy',
      });

      const state = await db.getState();
      expect(state.tasks[0]).toMatchObject({
        publishMode: 'direct-copy',
      });
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses StoryDream cover and podcast defaults for new tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-cover-podcast-defaults-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Cover podcast defaults',
        inputText: 'Source material',
      });

      const state = await db.getState();
      expect(state.tasks[0]).toMatchObject({
        scriptFormat: 'narration',
        podcastImageMode: 'multi',
        podcastSpeakers: null,
        coverImageMode: 'off',
        coverTemplateId: 'cinematic-poster',
      });
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps task target length automatic when no explicit word count is provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-auto-target-length-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Auto target length',
        inputText: 'Source material',
      });

      const state = await db.getState();
      expect(state.tasks[0].targetLength).toBeUndefined();
      expect(state.tasks[0].targetScenes).toBeUndefined();
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists StoryDream video form and two-host podcast task options', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-video-form-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Two-host podcast',
        inputText: 'Turn this story into a two-host podcast.',
        videoForm: 'two-host-podcast',
        podcastImageMode: 'single',
        podcastSpeakers: 'kazai-dayi',
        scriptFormat: 'dialogue',
        targetLength: 1200,
        targetScenes: 8,
      });

      const state = await db.getState();
      expect(state.tasks[0]).toMatchObject({
        videoForm: 'two-host-podcast',
        podcastImageMode: 'single',
        podcastSpeakers: 'kazai-dayi',
        scriptFormat: 'dialogue',
        targetLength: 1200,
        targetScenes: 8,
      });
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists true dual voice podcast speaker ids separately from narration tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-dual-voice-podcast-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Narration task',
        inputText: 'Read this as ordinary narration.',
        videoForm: 'narration',
      });
      await db.createTask({
        title: 'Dual voice podcast',
        inputText: 'Turn this story into a true two-host podcast.',
        videoForm: 'two-host-podcast',
        podcastSpeakerA: 'voice-host-a',
        podcastSpeakerB: 'voice-host-b',
        ttsProvider: 'minimax',
        ttsSpeed: 1.15,
      });

      const state = await db.getState();
      const podcastTask = state.tasks.find((task) => task.title === 'Dual voice podcast');
      const narrationTask = state.tasks.find((task) => task.title === 'Narration task');

      expect(podcastTask).toMatchObject({
        podcastSpeakerA: 'voice-host-a',
        podcastSpeakerB: 'voice-host-b',
        ttsProvider: 'minimax',
        ttsSpeed: 1.15,
      });
      expect(narrationTask?.podcastSpeakerA ?? null).toBeNull();
      expect(narrationTask?.podcastSpeakerB ?? null).toBeNull();
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists smart image lab metadata and mirrors generated records to playground jobs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-smart-image-lab-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const record = await db.addImageLabRecord({
        prompt: 'Podcast cover',
        ratio: '1:1',
        style: 'photo-real',
        provider: 'gpt_image',
        imagePath: 'D:/out/podcast-cover.png',
        status: 'generated',
        resolution: '2K',
        smartMode: 'podcast-cover',
        quality: 'high',
        referenceImagePaths: ['D:/refs/a.png', 'D:/refs/b.png'],
        upstreamTaskId: 'task-upstream',
        finishedAt: '2026-06-16T00:00:00.000Z',
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();
      expect(state.imageLabRecords[0]).toMatchObject({
        id: record.id,
        smartMode: 'podcast-cover',
        quality: 'high',
        referenceImagePaths: ['D:/refs/a.png', 'D:/refs/b.png'],
      });
      await reopened.close();

      const SQL = await initSqlJs();
      const raw = await readFile(file);
      const sqlite = new SQL.Database(raw);
      const labRows = sqlite.exec('SELECT smart_mode, quality, reference_image_paths_json FROM image_lab_records WHERE id = ?', [record.id])[0]?.values ?? [];
      expect(labRows[0]).toEqual(['podcast-cover', 'high', JSON.stringify(['D:/refs/a.png', 'D:/refs/b.png'])]);
      const playgroundRows = sqlite.exec('SELECT id, prompt, image_path, status, reference_image_path, upstream_task_id FROM playground_jobs WHERE id = ?', [record.id])[0]?.values ?? [];
      expect(playgroundRows[0]).toEqual([record.id, 'Podcast cover', 'D:/out/podcast-cover.png', 'generated', 'D:/refs/a.png', 'task-upstream']);
      sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('promotes staged image records to the canonical provider result in both storage tables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-staged-image-lab-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const staged = await db.addImageLabRecord({
        prompt: 'Provider selected cover',
        ratio: '16:9',
        style: 'photo-real',
        provider: 'mock',
        status: 'failed',
        resolution: '2K',
        smartMode: 'text-to-image',
        finishedAt: null,
      });
      const promoted = await db.updateImageLabRecord(staged.id, {
        provider: 'gpt_image',
        imagePath: 'D:/out/provider-cover.png',
        status: 'generated',
        errorMessage: '',
        resolution: '4K',
        smartMode: 'podcast-cover',
        referenceImagePaths: ['D:/refs/provider.png'],
        referenceImagePath: 'D:/refs/provider.png',
        upstreamTaskId: 'upstream-provider-task',
        finishedAt: '2026-07-15T00:00:00.000Z',
      });
      expect(promoted).toMatchObject({
        provider: 'gpt_image',
        resolution: '4K',
        smartMode: 'podcast-cover',
        referenceImagePaths: ['D:/refs/provider.png'],
        referenceImagePath: 'D:/refs/provider.png',
        upstreamTaskId: 'upstream-provider-task',
      });
      await db.close();

      const SQL = await initSqlJs();
      const sqlite = new SQL.Database(await readFile(file));
      const playground = sqlite.exec(
        'SELECT provider, image_path, status, reference_image_path, upstream_task_id, model FROM playground_jobs WHERE id = ?',
        [staged.id],
      )[0]?.values[0];
      expect(playground).toEqual([
        'gpt_image',
        'D:/out/provider-cover.png',
        'generated',
        'D:/refs/provider.png',
        'upstream-provider-task',
        'podcast-cover',
      ]);
      sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('seeds StoryDream cinematic cover templates and image styles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-cover-template-seeds-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const state = await db.getState();
      const coverTemplateIds = state.customCoverTemplates.map((template) => template.id);
      const styleIds = state.customStyles.map((style) => style.id);

      expect(coverTemplateIds).toEqual(expect.arrayContaining(['cinematic-poster', 'ancient-cinematic', 'podcast-cover']));
      expect(styleIds).toEqual(expect.arrayContaining(['cinematic', 'ancient-cinematic']));
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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

  it('rebuilds a malformed database file into a fresh StoryDream database', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-malformed-'));
    const file = join(dir, 'app.db');
    await writeFile(file, Buffer.from('not a sqlite database'));

    try {
      const db = await FileDatabase.open(file);
      const state = await db.getState();

      expect(state.tasks).toEqual([]);
      expect(state.viralAnalyses).toEqual([]);
      expect(state.promptTemplates.length).toBeGreaterThan(0);
      await db.close();

      const raw = await readFile(file);
      const SQL = await initSqlJs();
      const sqlite = new SQL.Database(raw);
      expect(sqlite.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]).toBe('ok');
      sqlite.close();
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

  it('persists database-owned storage keys independently from caller business ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-managed-keys-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const task = await db.createTask({ title: 'Managed task', inputText: 'task' });
      const viral = await db.createViralAnalysis({
        url: 'https://example.test/managed',
        settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'portrait' },
      });
      const image = await db.addImageLabRecord({
        id: 'caller-image-id',
        prompt: 'managed image',
        ratio: '9:16',
        style: 'photo-real',
        provider: 'mock',
      });
      const voice = await db.addVoiceLabRecord({
        id: 'caller-voice-id',
        text: 'managed voice',
        provider: 'mock',
        voiceId: 'voice',
        speed: 1,
      });
      const originalKeys = [task, viral, image, voice].map((record) => record.managedStorageKey);
      expect(originalKeys.every((key) => typeof key === 'string' && /^[a-z0-9_-]{16,128}$/u.test(key))).toBe(true);
      expect(image.managedStorageKey).not.toBe(image.id);
      expect(voice.managedStorageKey).not.toBe(voice.id);
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();
      expect([
        state.tasks.find((record) => record.id === task.id)?.managedStorageKey,
        state.viralAnalyses.find((record) => record.id === viral.id)?.managedStorageKey,
        state.imageLabRecords.find((record) => record.id === image.id)?.managedStorageKey,
        state.voiceLabRecords.find((record) => record.id === voice.id)?.managedStorageKey,
      ]).toEqual(originalKeys);
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses a main-process supplied managed key for an image import without coupling it to the record id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-import-managed-key-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const record = await db.addImageLabRecord({
        id: 'renderer-business-id',
        managedStorageKey: 'main-generated-managed-key',
        prompt: 'Managed imported image',
        ratio: '9:16',
        style: 'photo-real',
        provider: 'mock',
        imagePath: join(dir, 'image-lab', 'main-generated-managed-key', 'imported.png'),
        status: 'generated',
      });
      expect(record.managedStorageKey).toBe('main-generated-managed-key');
      expect(record.managedStorageKey).not.toBe(record.id);
      await db.close();
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

  it('persists music MV task kind, processing mode, and MV settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-music-mv-task-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'Rainy music MV',
        inputText: 'line one\nline two\nchorus again',
        taskKind: 'music-mv',
        processingMode: 'semi-auto',
        track: 'music-mv',
        style: 'modern-film',
        ratio: '16:9',
        storyboardSceneCount: 8,
        musicMv: {
          rhythmMode: 'lyric-sync',
          captionStyle: 'karaoke',
          visualMotif: 'rainy neon, lonely silhouette, slow camera',
          audioPath: 'D:/music/rain.wav',
        },
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.tasks[0]).toMatchObject({
        title: 'Rainy music MV',
        taskKind: 'music-mv',
        processingMode: 'semi-auto',
        track: 'music-mv',
        musicMv: {
          rhythmMode: 'lyric-sync',
          captionStyle: 'karaoke',
          visualMotif: 'rainy neon, lonely silhouette, slow camera',
          audioPath: 'D:/music/rain.wav',
        },
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

  it('refreshes built-in prompt templates to the StoryDream default set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-prompt-refresh-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      (db as unknown as { db: { run: (sql: string, params?: unknown[]) => void } }).db.run(
        `INSERT OR REPLACE INTO prompt_templates (id, name, type, description, content, is_builtin, updated_at, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['system-food-v2', '旧美食模板', 'task', '旧默认模板', 'old content', 1, '2026-05-01T00:00:00.000Z', '{}'],
      );
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.promptTemplates.some((template) => template.id === 'system-food-v2')).toBe(false);
      expect(state.promptTemplates.find((template) => template.id === 'system-food-vlog')).toMatchObject({
        name: '美食探店V2',
        baseTrack: 'food-vlog',
        isBuiltin: true,
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

  it('deletes custom draft templates while protecting system defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-delete-draft-template-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      const builtin = (await db.getState()).draftTemplates.find((template) => template.isDefault);
      if (!builtin) throw new Error('Built-in draft template fixture is missing.');
      const custom = {
        ...structuredClone(builtin),
        id: 'custom-delete-me',
        name: 'Custom delete me',
        isDefault: false,
      };
      await db.upsertDraftTemplate(custom);

      await expect(db.deleteDraftTemplate(builtin.id)).rejects.toThrow('DRAFT_TEMPLATE_BUILTIN_DELETE_FORBIDDEN');
      expect(await db.deleteDraftTemplate(custom.id)).toBe(true);
      expect(await db.deleteDraftTemplate(custom.id)).toBe(false);
      expect(await db.getDraftTemplateDetail(custom.id)).toBeNull();
      expect(await db.getDraftTemplateDetail(builtin.id)).not.toBeNull();
    } finally {
      await db.close();
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

  it('keeps active GPT image settings except credentials after saving config', async () => {
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
        apiKey: '',
        baseUrl: 'https://image.example/v1',
        model: 'gpt-image-2',
        concurrency: 4,
        resolution: '4K',
      });
      expect(state.config.image).toMatchObject({
        apiKey: '',
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

      expect(state.config.llm).toMatchObject({ id: 'llm-custom', apiKey: '', model: 'llm-active', enabled: true });
      expect(state.config.activeImageProfileId).toBe('image-custom');
      expect(state.config.imageProvider).toBe('custom');
      expect(state.config.customImage).toMatchObject({ apiKey: '', baseUrl: 'https://image.example', model: 'image-active' });
      expect(state.config.activeTtsProfileId).toBe('tts-minimax');
      expect(state.config.tts.provider).toBe('minimax');
      expect(state.config.tts.minimax).toMatchObject({ apiKey: '', model: 'speech-active', voiceId: 'voice-active' });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('paginates task summaries and events with stable cursors while keeping heavy fields on demand', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-pages-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    try {
      const created = [];
      for (const suffix of ['a', 'b', 'c']) {
        created.push(await db.createTask({
          title: `Task ${suffix}`,
          inputText: `full input ${suffix}`,
          track: 'story',
          style: 'photo-real',
          speaker: 'voice',
          selectedSources: [{ source: 'test', title: suffix, content: `source ${suffix}` }],
        }));
      }

      const first = await db.listTaskSummaries({ limit: 2 });
      const second = await db.listTaskSummaries({ cursor: first.nextCursor, limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(new Set([...first.items, ...second.items].map((task) => task.id))).toEqual(new Set(created.map((task) => task.id)));
      expect(first.items[0]).not.toHaveProperty('inputText');
      expect(first.items[0]).not.toHaveProperty('selectedSources');
      expect(first.items[0]).not.toHaveProperty('step3PromptSnapshot');
      expect(first.items[0]).not.toHaveProperty('pipelineData');
      expect(first.items[0]).not.toHaveProperty('productInfo');
      expect(first.items[0]).not.toHaveProperty('fixedIntro');
      expect(first.items[0]).not.toHaveProperty('outroCta');
      expect(first.items[0]).not.toHaveProperty('podcastSpeakers');
      expect(first.items[0].inputPreview.length).toBeLessThanOrEqual(160);

      const detail = await db.getTaskDetail(created[0].id);
      expect(detail?.inputText).toBe('full input a');
      expect(detail?.selectedSources[0]?.content).toBe('source a');

      const persisted = await Promise.all([
        db.addTaskEvent(created[0].id, { type: 'one', detail: 'one' }),
        db.addTaskEvent(created[0].id, { type: 'two', detail: 'two' }),
        db.addTaskEvent(created[0].id, { type: 'three', detail: 'three' }),
      ]);
      expect(persisted.every((event) => Number.isInteger(event.seq))).toBe(true);
      expect(persisted.map((event) => event.seq)).toEqual([...persisted.map((event) => event.seq)].sort((left, right) => left - right));
      const eventFirst = await db.listTaskEvents(created[0].id, { limit: 2 });
      const eventSecond = await db.listTaskEvents(created[0].id, { cursor: eventFirst.nextCursor, limit: 2 });
      expect(eventFirst.items.map((event) => event.seq)).toEqual(persisted.slice(1).map((event) => event.seq));
      expect(eventSecond.items.map((event) => event.seq)).toEqual(persisted.slice(0, 1).map((event) => event.seq));
      expect(new Set([...eventFirst.items, ...eventSecond.items].map((event) => event.seq))).toEqual(new Set(persisted.map((event) => event.seq)));
    } finally {
      vi.useRealTimers();
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('clamps every narrow list API and loads template bodies only by id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-list-clamps-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      const viralHeavy = `viral-heavy-${'v'.repeat(200_000)}`;
      const imageHeavy = `image-preview-${'i'.repeat(200_000)}-image-heavy-tail-must-be-lazy`;
      const voiceHeavy = `voice-preview-${'a'.repeat(200_000)}-voice-heavy-tail-must-be-lazy`;
      const viral = await db.createViralAnalysis({
        url: 'https://example.com/video',
        settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16', extraRequirements: viralHeavy },
      });
      await db.addViralAnalysisEvent(viral.id, { type: 'start', stage: 'downloading', detail: 'start' });
      const image = await db.addImageLabRecord({ prompt: imageHeavy, ratio: '9:16', style: 'photo-real', provider: 'mock', referenceImagePaths: [imageHeavy] });
      const voice = await db.addVoiceLabRecord({ text: voiceHeavy, provider: 'mock', voiceId: 'voice', speed: 1 });
      const template = await db.upsertPromptTemplate({ id: 'lazy-template', name: 'Lazy', type: 'task', content: 'lazy prompt body' });

      const viralSummaries = await db.listViralAnalyses({ limit: 0 });
      const imageSummaries = await db.listImageLabRecords({ limit: 0 });
      const voiceSummaries = await db.listVoiceLabRecords({ limit: 0 });
      expect(viralSummaries.items).toHaveLength(1);
      expect((await db.listViralAnalysisEvents(viral.id, { limit: 0 })).items).toHaveLength(1);
      expect(imageSummaries.items).toHaveLength(1);
      expect(voiceSummaries.items).toHaveLength(1);
      expect((await db.listPromptTemplateSummaries({ limit: 0 })).items).toHaveLength(1);
      expect((await db.listDraftTemplateSummaries({ limit: 0 })).items).toHaveLength(1);

      const summaries = await db.listPromptTemplateSummaries({ limit: 10_000 });
      expect(summaries.items.find((item) => item.id === template.id)).not.toHaveProperty('content');
      expect(summaries.items.find((item) => item.id === template.id)).not.toHaveProperty('stepPrompts');
      expect((await db.getPromptTemplateDetail(template.id))?.content).toBe('lazy prompt body');
      expect(viralSummaries.items[0]).not.toHaveProperty('settings');
      expect(imageSummaries.items[0]).not.toHaveProperty('prompt');
      expect(imageSummaries.items[0]).not.toHaveProperty('referenceImagePaths');
      expect(voiceSummaries.items[0]).not.toHaveProperty('text');
      expect(imageSummaries.items[0].promptPreview.length).toBeLessThanOrEqual(160);
      expect(voiceSummaries.items[0].textPreview.length).toBeLessThanOrEqual(160);
      expect(JSON.stringify([viralSummaries, imageSummaries, voiceSummaries])).not.toContain('heavy-tail-must-be-lazy');
      expect((await db.getViralAnalysisDetail(viral.id))?.settings.extraRequirements).toBe(viralHeavy);
      expect((await db.getImageLabRecordDetail(image.id))?.prompt).toBe(imageHeavy);
      expect((await db.getVoiceLabRecordDetail(voice.id))?.text).toBe(voiceHeavy);
      const draftSummary = (await db.listDraftTemplateSummaries({ limit: 1 })).items[0];
      expect((await db.getDraftTemplateDetail(draftSummary.id))?.id).toBe(draftSummary.id);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects empty, non-string, or over-specified draft cursors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-draft-cursors-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    const cursor = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    try {
      await expect(db.listDraftTemplateSummaries({ cursor: '' })).rejects.toThrow('CURSOR_INVALID');
      await expect(db.listDraftTemplateSummaries({ cursor: cursor({ id: 7 }) })).rejects.toThrow('CURSOR_INVALID');
      await expect(db.listDraftTemplateSummaries({ cursor: cursor({ id: 'draft', extra: true }) })).rejects.toThrow('CURSOR_INVALID');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns the latest bounded task and viral event pages with stable older cursors', { timeout: 30_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-latest-events-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      const task = await db.createTask({ title: 'Events', inputText: 'events', track: 'story', style: 'photo-real', speaker: 'voice' });
      const viral = await db.createViralAnalysis({
        url: 'https://example.com/events',
        settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
      });
      const taskEvents = await Promise.all(Array.from({ length: 101 }, (_, index) =>
        db.addTaskEvent(task.id, { type: 'tick', detail: `task-${index + 1}` })));
      const viralEvents = await Promise.all(Array.from({ length: 101 }, (_, index) =>
        db.addViralAnalysisEvent(viral.id, { type: 'tick', stage: 'downloading', detail: `viral-${index + 1}` })));

      const latestTaskPage = await db.listTaskEvents(task.id, { limit: 100 });
      const olderTaskPage = await db.listTaskEvents(task.id, { cursor: latestTaskPage.nextCursor, limit: 100 });
      expect(latestTaskPage.items.map((event) => event.seq)).toEqual(taskEvents.slice(1).map((event) => event.seq));
      expect(olderTaskPage.items.map((event) => event.seq)).toEqual(taskEvents.slice(0, 1).map((event) => event.seq));
      expect(new Set([...latestTaskPage.items, ...olderTaskPage.items].map((event) => event.seq)).size).toBe(101);

      const latestViralPage = await db.listViralAnalysisEvents(viral.id, { limit: 100 });
      const olderViralPage = await db.listViralAnalysisEvents(viral.id, { cursor: latestViralPage.nextCursor, limit: 100 });
      expect(latestViralPage.items.map((event) => event.seq)).toEqual(viralEvents.slice(1).map((event) => event.seq));
      expect(olderViralPage.items.map((event) => event.seq)).toEqual(viralEvents.slice(0, 1).map((event) => event.seq));
      expect(new Set([...latestViralPage.items, ...olderViralPage.items].map((event) => event.seq)).size).toBe(101);
    } finally {
      await db.close();
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
