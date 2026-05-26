import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';

const sampleInput =
  '武曌，通称武则天、武后，是中国历史上唯一的女皇帝。武则天十四岁入宫为唐太宗才人，历经十二年不得升迁。唐高宗时复为昭仪，通过废黜王皇后与萧淑妃，得以立为皇后。并尊号为天后，与唐高宗并称二圣。';

describe('high parity Storybound shell model', () => {
  it('migrates observed provider, template, credit, style, and lab defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-high-parity-defaults-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const state = await db.getState();

      expect(state.config.imageProvider).toBe('gpt_image');
      expect(state.config.llmProfiles[0]).toMatchObject({ provider: 'custom', model: 'gpt-5.5' });
      expect(state.config.gptImage).toMatchObject({ model: 'gpt-image-1', resolution: '2K' });
      expect(state.config.jimeng).toMatchObject({ model: 'jimeng-3.1', resolution: '2K' });
      expect(state.config.customImage).toMatchObject({ asyncMode: false });
      expect(state.config.tts.provider).toBe('volcengine');
      expect(state.config.tts.minimax.model).toBe('speech-02-hd');
      expect(state.config.jianying.bgmLibrary[0].title).toBe('内置 BGM');
      expect(state.config.ima).toMatchObject({ clientId: '', apiKey: '' });
      expect(state.customStyles.map((style) => style.name)).toContain('黑白摄影');
      expect(state.creditTransactions[0]).toMatchObject({ type: 'system', amount: 0, balance: 0 });
      expect(state.minimaxCloneVoices).toEqual([]);

      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists observed new-task options and lifecycle controls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-high-parity-task-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const task = await db.createTask({
        title: '武则天试跑',
        inputText: sampleInput,
        mode: 'ai',
        aiKeyword: '武则天回宫',
        aiSources: ['web', 'builtin-knowledge', 'ima'],
        extraRequirements: '聚焦人物转折经历，语气偏感性',
        track: 'character-story',
        style: 'photo-real',
        speaker: '灿博小叔',
        ratio: '9:16',
        templateId: 'default-portrait-9-16',
        bgmId: '__builtin__',
        pausePoints: ['critical'],
        referenceImagePath: 'C:/refs/wu.png',
        rewriteIntensity: 'deep',
        narrativePov: 'first-person',
        keepPromotion: true,
        ttsProvider: 'minimax',
        ttsSpeed: 1.15,
        step3PromptSnapshot: 'custom step3',
      });

      await db.updateTask(task.id, { status: 'paused', currentStep: 3 });
      await db.updateTask(task.id, { status: 'cancelled', errorMessage: '用户取消' });
      const state = await db.getState();

      expect(state.tasks[0]).toMatchObject({
        title: '武则天试跑',
        status: 'cancelled',
        mode: 'ai',
        aiKeyword: '武则天回宫',
        aiSources: ['web', 'builtin-knowledge', 'ima'],
        extraRequirements: '聚焦人物转折经历，语气偏感性',
        speaker: '灿博小叔',
        bgmId: '__builtin__',
        referenceImagePath: 'C:/refs/wu.png',
        rewriteIntensity: 'deep',
        narrativePov: 'first-person',
        keepPromotion: true,
        ttsProvider: 'minimax',
        ttsSpeed: 1.15,
        step3PromptSnapshot: 'custom step3',
      });

      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes the complete observable artifact contract for a mock run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-high-parity-run-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));

    try {
      const task = await db.createTask({
        title: '武则天完整闭环',
        inputText: sampleInput,
        mode: 'paste',
        track: 'character-story',
        style: 'photo-real',
        ratio: '9:16',
        templateId: 'default-portrait-9-16',
        speaker: '灿博小叔',
        ttsSpeed: 1,
      });

      await runTask(db, task, { appDataDir: dir });
      const state = await db.getState();
      const completed = state.tasks[0];
      const files = await readdir(completed.outputDir);
      const imageFiles = await readdir(join(completed.outputDir, 'images'));
      const audioFiles = await readdir(join(completed.outputDir, 'audio'));
      const prompts = JSON.parse(await readFile(join(completed.outputDir, '03-image-prompts.json'), 'utf8'));
      const diagnostics = JSON.parse(await readFile(join(completed.outputDir, 'diagnostics.json'), 'utf8'));

      expect(completed.status).toBe('completed');
      expect(files).toEqual(
        expect.arrayContaining([
          '00-reviewed.txt',
          '01-rewritten-copy.md',
          '00-cover-title.json',
          '02-sentences.json',
          '03-image-prompts.json',
          'subtitles.srt',
          'draft-project.json',
          'diagnostics.json',
        ]),
      );
      expect(imageFiles.length).toBeGreaterThan(0);
      expect(audioFiles.length).toBeGreaterThan(0);
      expect(prompts[0]).toHaveProperty('negativePrompt');
      expect(diagnostics.checks.map((check: { id: string }) => check.id)).toContain('draft-package');
      expect(state.events.map((event) => event.detail)).toContain('字幕时间轴已生成');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders observed high-parity feature labels in the React shell source', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of [
      'AI 创作',
      '全网搜索',
      'AI 内置知识补全',
      'IMA 知识库',
      '高级选项',
      '暂停确认',
      '改写强度',
      '叙事视角',
      'MiniMax',
      '克隆音色',
      '导入 JSON',
      '主角档案',
      '图像参考',
      '关于 · 诊断',
      '复制诊断报告',
    ]) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.draft-editor-shell');
    expect(css).toContain('.segmented');
  });
});
