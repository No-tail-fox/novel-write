import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import { defaultProjectModels, projectRuntimeConfig, readProjectModelsDraft, selectedLanguageConfig, validateProjectModels } from '@shared/project-models';
import { enableImageProfile, enableLlmProfile, enableVideoProfile } from '@shared/provider-profile-utils';
import { FileDatabase } from '@shared/storage';
import { ipcInputSchemas } from '@shared/ipc-contract';
import { selectImageLabProfileConfig } from '@shared/image-lab-profile';
import { resolveDirectorImageProviderStatus } from '../src/features/director-desk/director-generation';
import { imageLabRetryInput } from '../src/features/labs/image-lab-helpers';
import { makeFallbackApi } from '../src/app/browser-fallback';
import type { AppConfig, ProjectModels } from '@shared/types';

const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const modelsA: ProjectModels = { llmProfileId: 'llm-a', imageProfileId: 'image-a', videoProviderId: 'video-a' };
const modelsB: ProjectModels = { llmProfileId: 'llm-b', imageProfileId: 'image-b', videoProviderId: 'video-b' };
function configs(): AppConfig {
  const config = normalizeAppConfig(defaultConfig);
  return normalizeAppConfig({ ...config,
    activeLlmProfileId: 'llm-a', llmProfiles: ['a', 'b'].map(id => ({ ...config.llm, id: `llm-${id}`, name: `语言 ${id}`, enabled: id === 'a', model: `text-${id}`, apiKey: `text-secret-${id}` })),
    activeImageProfileId: 'image-a', imageProfiles: ['a', 'b'].map(id => ({ ...config.imageProfiles[0], id: `image-${id}`, name: `生图 ${id}`, enabled: id === 'a', gptImage: { ...config.gptImage, model: `image-${id}`, apiKey: `image-secret-${id}` } })),
    video: { ...config.video, activeProviderId: 'video-a', providers: ['a', 'b'].map(id => ({ ...config.video.providers[0], id: `video-${id}`, name: `视频 ${id}`, enabled: id === 'a', model: `video-${id}`, apiKey: `video-secret-${id}` })) },
  });
}
function defaultsB(config: AppConfig) { return enableVideoProfile(enableImageProfile(enableLlmProfile(config, 'llm-b'), 'image-b'), 'video-b'); }
async function databaseFile() { const dir = await mkdtemp(join(tmpdir(), 'storydream-project-models-')); directories.push(dir); return join(dir, 'data.db'); }

describe('project-owned model selection', () => {
  it('selects saved inactive profiles and their credentials without changing global defaults', () => {
    const config = configs(); const snapshot = structuredClone(config);
    const runtime = projectRuntimeConfig(config, modelsB);
    expect(runtime.llm).toMatchObject({ id: 'llm-b', model: 'text-b', apiKey: 'text-secret-b', enabled: true });
    expect(runtime.gptImage).toMatchObject({ model: 'image-b', apiKey: 'image-secret-b' });
    expect(runtime.video.providers).toMatchObject([{ id: 'video-b', apiKey: 'video-secret-b', enabled: true }]);
    expect(runtime.video.providers).toHaveLength(1);
    expect(runtime.video.automation.providerWhitelist).toEqual(['video-b']);
    expect(config).toEqual(snapshot);
    expect(projectRuntimeConfig(config, { ...modelsB, videoProviderId: null }).video.providers).toEqual([]);
    expect(selectedLanguageConfig(config, 'llm-b').llm.model).toBe('text-b');
  });

  it.each([['llmProfileId', 'PROJECT_LLM_PROFILE_MISSING'], ['imageProfileId', 'PROJECT_IMAGE_PROFILE_MISSING'], ['videoProviderId', 'PROJECT_VIDEO_PROFILE_MISSING']] as const)('rejects deleted %s instead of routing to another provider', (field, code) => {
    const missing = { ...modelsA, [field]: 'deleted' };
    expect(() => projectRuntimeConfig(configs(), missing)).toThrow(code);
    expect(readProjectModelsDraft(JSON.stringify(missing), modelsA)).toEqual(missing);
    expect(() => validateProjectModels(configs(), missing)).toThrow(code);
  });

  it('shows unavailable image status for a deleted project profile even when a default is connected', () => {
    const status = resolveDirectorImageProviderStatus(configs(), { 'image/@active/gptImage/apiKey': true }, 'deleted');
    expect(status).toMatchObject({ profileId: 'deleted', connected: false });
    expect(status.unavailableReason).toContain('项目模型');
  });

  it('freezes defaults for every project type, retains choices on reopen, and changes only the selected project', async () => {
    const file = await databaseFile(); let db = await FileDatabase.open(file);
    try {
      await db.upsertConfig(configs());
      const ordinary = await db.createTask({ title: '普通项目', inputText: '测试' });
      const editorial = await db.createEditorialCollageTask({ title: '动画', sourceText: '测试。', projectModels: modelsB });
      const comic = await db.createMotionComicTask({ title: '漫剧', premise: '测试。', projectModels: modelsB });
      const html = await db.createTask({ title: 'HTML', inputText: '测试', taskType: 'html-video', projectModels: modelsB });
      const music = await db.createTask({ title: '音乐', inputText: '测试', taskType: 'music-mv', projectModels: modelsB });
      expect(ordinary.projectModels).toEqual(modelsA);
      for (const task of [editorial, comic, html, music]) expect(task.projectModels).toEqual(modelsB);
      await db.upsertConfig(defaultsB(configs()));
      expect((await db.getTaskDetail(ordinary.id))?.projectModels).toEqual(modelsA);
      expect((await db.createTask({ title: '新默认', inputText: '测试' })).projectModels).toEqual(modelsB);
      expect((await db.getTaskSummary(ordinary.id))?.projectModels).toEqual(modelsA);
      await db.setProjectModels(ordinary.id, modelsB);
      expect((await db.getTaskDetail(ordinary.id))?.llmProfileId).toBe('llm-b');
      await db.close(); db = await FileDatabase.open(file);
      expect((await db.getTaskSummary(ordinary.id))?.projectModels).toEqual(modelsB);
      expect((await db.getTaskDetail(editorial.id))?.projectModels).toEqual(modelsB);
    } finally { await db.close(); }
  });

  it('migrates legacy projects once, preserving a legacy language model and the image/video defaults at migration', async () => {
    const file = await databaseFile(); let db = await FileDatabase.open(file);
    await db.upsertConfig(configs());
    const task = await db.createTask({ title: '旧项目', inputText: '测试', llmProfileId: 'llm-b' });
    await db.close();
    const SQL = await initSqlJs(); const legacy = new SQL.Database(await readFile(file));
    legacy.run('UPDATE tasks SET project_models_json = NULL WHERE id = ?', [task.id]);
    await writeFile(file, legacy.export()); legacy.close();
    db = await FileDatabase.open(file);
    try {
      expect((await db.getTaskDetail(task.id))?.projectModels).toEqual({ ...modelsA, llmProfileId: 'llm-b' });
      await db.upsertConfig(defaultsB(configs()));
      await db.close(); db = await FileDatabase.open(file);
      expect((await db.getTaskDetail(task.id))?.projectModels).toEqual({ ...modelsA, llmProfileId: 'llm-b' });
    } finally { await db.close(); }
  });

  it('blocks model changes during running, paused, background generation and archived states', async () => {
    const db = await FileDatabase.open(await databaseFile());
    try {
      await db.upsertConfig(configs()); const task = await db.createTask({ title: '锁定', inputText: '测试' });
      for (const status of ['running', 'paused'] as const) {
        await db.updateTask(task.id, { status });
        await expect(db.setProjectModels(task.id, modelsB)).rejects.toThrow('PROJECT_MODELS_BUSY');
      }
      await db.updateTask(task.id, { status: 'draft' });
      const release = db.beginProjectActivity(task.id, '生成剧本');
      await expect(db.setProjectModels(task.id, modelsB)).rejects.toThrow('PROJECT_MODELS_BUSY'); release();
      await db.setProjectModels(task.id, modelsB);
      await db.archiveTask(task.id);
      await expect(db.setProjectModels(task.id, modelsA)).rejects.toThrow('HISTORY_ARCHIVED');
    } finally { await db.close(); }
  });

  it('persists standalone image attribution in summaries and retries the original profile after defaults change', async () => {
    const db = await FileDatabase.open(await databaseFile());
    try {
      const record = await db.addImageLabRecord({ prompt: '测试图', ratio: '16:9', style: 'photo-real', provider: 'gpt_image', imageProfileId: 'image-b', modelName: 'image-b', status: 'failed' });
      expect((await db.listImageLabRecords({ limit: 10 })).items[0]).toMatchObject({ imageProfileId: 'image-b', modelName: 'image-b' });
      const retry = imageLabRetryInput(record);
      expect(selectImageLabProfileConfig(configs(), retry).activeImageProfileId).toBe('image-b');
      expect(() => selectImageLabProfileConfig(configs(), { imageProfileId: 'deleted' })).toThrow('IMAGE_PROFILE_MISSING');
    } finally { await db.close(); }
  });

  it('validates project choices through strict IPC contracts without accepting credentials or step overrides', () => {
    expect(ipcInputSchemas['project:set-models'].parse({ id: 'project', models: modelsB })).toEqual({ id: 'project', models: modelsB });
    expect(ipcInputSchemas['project:set-models'].safeParse({ id: 'project', models: { ...modelsB, apiKey: 'forbidden' } }).success).toBe(false);
    expect(ipcInputSchemas['project:set-models'].safeParse({ id: 'project', models: { ...modelsB, imageProfileId: '' } }).success).toBe(false);
    expect(ipcInputSchemas['task:create-and-run'].parse({ title: 'test', inputText: 'test', projectModels: modelsB }).projectModels).toEqual(modelsB);
    expect(ipcInputSchemas['image-lab:generate'].parse({ prompt: 'test', ratio: '16:9', style: 'photo-real', imageProfileId: 'image-b' }).imageProfileId).toBe('image-b');
    expect(ipcInputSchemas['research:compose-copy'].parse({ keyword: 'test', extraRequirements: '', useBuiltinKnowledge: false, selectedSources: [], projectId: 'project' }).projectId).toBe('project');
  });

  it('keeps browser preview projects independent of new defaults and enforces the same selection validation', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const api = makeFallbackApi(() => undefined);
    await api.saveConfig({ config: configs(), secretChanges: {} });
    await api.createHtmlVideoTask({ title: '浏览器项目', inputText: '测试' });
    const first = (await api.getState()).tasks[0];
    expect(first.projectModels).toEqual(modelsA);
    await api.saveConfig({ config: defaultsB(configs()), secretChanges: {} });
    expect((await api.getTaskDetail(first.id))?.projectModels).toEqual(modelsA);
    await api.setProjectModels(first.id, modelsB);
    expect((await makeFallbackApi(() => undefined).getTaskDetail(first.id))?.projectModels).toEqual(modelsB);
    await expect(api.setProjectModels(first.id, { ...modelsB, imageProfileId: 'deleted' })).rejects.toThrow('PROJECT_IMAGE_PROFILE_MISSING');
    expect(defaultProjectModels(configs())).toEqual(modelsA);
  });
});
