import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron ipc contract', () => {
  it('exposes product shell persistence channels to the renderer', async () => {
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    for (const channel of [
      'prompt-template:save',
      'prompt-template:reset',
      'custom-style:save',
      'custom-style:generate-draft',
      'draft-template:save',
      'image-lab:generate',
      'image-lab:add-record',
      'voice-lab:generate',
      'account:save',
      'activation:save',
      'ui:save-preferences',
      'task:update-status',
      'task:retry',
      'task:regenerate-image',
      'task:regenerate-narration',
      'task:get-artifacts',
      'asset:read-data-url',
      'config:test',
      'llm:test-config',
      'models:list',
      'volcengine:speakers:list',
      'research:web-search',
      'research:compose-copy',
      'diagnostics:run',
      'local-image:select',
      'local-audio:select',
      'local-folder:select',
      'cookie-file:select',
      'viral:open-login-window',
      'jianying:draft-path:detect',
      'jianying:effect-catalog',
      'viral:create-and-run',
      'viral:update-status',
      'viral:retry',
      'viral:get-result',
      'viral:create-production-task',
    ]) {
      expect(preload).toContain(channel);
      expect(main).toContain(channel);
    }
  });

  it('exposes viral analyzer state and production-task handoff to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain('startViralAnalysisRun');
    expect(main).toContain('runViralAnalysis');
    expect(main).toContain('createViralProductionTaskInput');
    expect(preload).toContain('createAndRunViralAnalysis');
    expect(preload).toContain('createProductionTaskFromViral');
    expect(viteEnv).toContain('createAndRunViralAnalysis');
    expect(viteEnv).toContain('createProductionTaskFromViral');
  });

  it('starts newly created tasks in the background so the renderer can open task detail immediately', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('startTaskRun(database, task');
    expect(main).toContain('return database.getState()');
  });

  it('routes resume and retry through a background task runner instead of only mutating status', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('runningTasks');
    expect(main).toContain('AbortController');
    expect(main).toContain('restartAfterAbort');
    expect(main).toContain('resumeTaskRun');
    expect(main).toContain("input.status === 'running'");
    const retryHandler = main.slice(main.indexOf("ipcMain.handle('task:retry'"), main.indexOf("ipcMain.handle('diagnostics:run'"));
    expect(retryHandler).toContain('resumeTaskRun(database, task)');
    expect(retryHandler).not.toContain('runTask(');
  });

  it('keeps aborting task runners registered until they exit to avoid duplicate runs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const statusHandler = main.slice(main.indexOf("ipcMain.handle('task:update-status'"), main.indexOf("ipcMain.handle('task:retry'"));

    expect(statusHandler).toContain('existingRun.controller.abort');
    expect(statusHandler).toContain('existingRun.restartAfterAbort = false');
    expect(statusHandler).not.toContain('runningTasks.delete(input.id)');
  });

  it('pushes a fresh app state snapshot for live task detail updates', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain('sendTaskState');
    expect(main).toContain("mainWindow?.webContents.send('task:event', state)");
    expect(main).toContain('notifyTaskState');
    expect(preload).toContain('callback(state)');
    expect(preload).toContain('testLlmConfig');
    expect(preload).toContain('listProviderModels');
    expect(preload).toContain('listVolcengineSpeakers');
    expect(preload).toContain('searchWebSources');
    expect(preload).toContain('composeResearchCopy');
    expect(preload).toContain('saveCustomStyle');
    expect(preload).toContain('generateCustomStyleDraft');
    expect(preload).toContain('getTaskArtifacts');
    expect(viteEnv).toContain('callback: (state: AppState) => void');
    expect(viteEnv).toContain('testLlmConfig');
    expect(viteEnv).toContain('listProviderModels');
    expect(viteEnv).toContain('listVolcengineSpeakers');
    expect(viteEnv).toContain('composeResearchCopy');
    expect(viteEnv).toContain('saveCustomStyle');
    expect(viteEnv).toContain('generateCustomStyleDraft');
    expect(viteEnv).toContain('getTaskArtifacts');
  });

  it('exposes safe local image data URLs for task artifact thumbnails', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain("ipcMain.handle('asset:read-data-url'");
    expect(main).toContain('readLocalImageDataUrl');
    expect(main).toContain('data:image/');
    expect(main).toContain('Unsupported preview image extension');
    expect(preload).toContain('readAssetDataUrl');
    expect(preload).toContain('asset:read-data-url');
    expect(viteEnv).toContain('readAssetDataUrl: (path: string) => Promise<string>');
  });

  it('routes image lab submissions through the configured real image generator', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("ipcMain.handle('image-lab:generate'"), main.indexOf("ipcMain.handle('image-lab:add-record'"));

    expect(main).toContain('generateImageLabRecord');
    expect(handler).toContain('imageLabWorkDir');
    expect(handler).toContain('database.addImageLabRecord(record)');
    expect(preload).toContain('generateImageLab');
    expect(preload).toContain('image-lab:generate');
      expect(viteEnv).toContain('generateImageLab: (input: ImageLabGenerateInput) => Promise<AppState>');
  });

  it('routes voice lab preview generation through the configured TTS provider', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("ipcMain.handle('voice-lab:generate'"), main.indexOf("ipcMain.handle('account:save'"));

    expect(main).toContain('generateConfiguredVoicePreview');
    expect(handler).toContain('voiceLabWorkDir');
    expect(handler).toContain('database.addVoiceLabRecord(record)');
    expect(preload).toContain('generateVoiceLabPreview');
    expect(preload).toContain('voice-lab:generate');
    expect(viteEnv).toContain('generateVoiceLabPreview: (input: VoiceLabGenerateInput) => Promise<AppState>');
  });

  it('exposes a safe local image picker for draft template background images', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain("ipcMain.handle('local-image:select'");
    expect(main).toContain('dialog.showOpenDialog');
    expect(main).toContain("properties: ['openFile']");
    expect(preload).toContain('selectLocalImage');
    expect(preload).toContain('local-image:select');
    expect(viteEnv).toContain('selectLocalImage: () => Promise<string | null>');
  });

  it('exposes a safe local audio picker for uploaded BGM files', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain("ipcMain.handle('local-audio:select'");
    expect(main).toContain('selectLocalAudio');
    expect(main).toContain("extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']");
    expect(preload).toContain('selectLocalAudio');
    expect(preload).toContain('local-audio:select');
    expect(viteEnv).toContain('selectLocalAudio: () => Promise<string | null>');
  });

  it('exposes Jianying draft folder detection and folder picking to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain("ipcMain.handle('local-folder:select'");
    expect(main).toContain("properties: ['openDirectory']");
    expect(main).toContain("ipcMain.handle('jianying:draft-path:detect'");
    expect(main).toContain('detectJianyingDraftPath');
    expect(preload).toContain('selectLocalFolder');
    expect(preload).toContain('local-folder:select');
    expect(preload).toContain('detectJianyingDraftPath');
    expect(preload).toContain('jianying:draft-path:detect');
    expect(viteEnv).toContain('selectLocalFolder: () => Promise<string | null>');
    expect(viteEnv).toContain('detectJianyingDraftPath: () => Promise<string>');
  });

  it('exposes viral cookie file picking and a persistent login browser', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain("ipcMain.handle('cookie-file:select'");
    expect(main).toContain("ipcMain.handle('viral:open-login-window'");
    expect(main).toContain('partition:');
    expect(main).toContain('persist:storydream-viral-douyin');
    expect(main).toContain('async function openViralLoginWindow(): Promise<string | null>');
    expect(main).toContain('resolve(cookiePath)');
    expect(preload).toContain('selectCookieFile');
    expect(preload).toContain('openViralLoginWindow');
    expect(preload).toContain('openViralLoginWindow: (): Promise<string | null>');
    expect(viteEnv).toContain('selectCookieFile: () => Promise<string | null>');
    expect(viteEnv).toContain('openViralLoginWindow: () => Promise<string | null>');
  });

  it('exposes pyJianYingDraft effect catalog loading to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain("ipcMain.handle('jianying:effect-catalog'");
    expect(main).toContain('loadJianyingEffectCatalog');
    expect(preload).toContain('getJianyingEffectCatalog');
    expect(preload).toContain('jianying:effect-catalog');
    expect(viteEnv).toContain('getJianyingEffectCatalog: () => Promise<JianyingEffectCatalog>');
  });

  it('regenerates a single scene image through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const regenerateHandler = main.slice(main.indexOf("ipcMain.handle('task:regenerate-image'"), main.indexOf("ipcMain.handle('task:get-artifacts'"));

    expect(main).toContain('markSceneImageForRegeneration');
    expect(regenerateHandler).toContain('retryFromStep: 4');
    expect(regenerateHandler).toContain('failedStep: 4');
    expect(regenerateHandler).toContain('resumeTaskRun(database, updatedTask)');
    expect(regenerateHandler).not.toContain('runTask(');
    expect(preload).toContain('regenerateTaskImage');
    expect(preload).toContain('task:regenerate-image');
    expect(viteEnv).toContain('regenerateTaskImage: (id: string, sceneId: number) => Promise<AppState>');
  });

  it('regenerates a single scene narration through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const regenerateHandler = main.slice(main.indexOf("ipcMain.handle('task:regenerate-narration'"), main.indexOf("ipcMain.handle('task:get-artifacts'"));

    expect(main).toContain('markSceneNarrationForRegeneration');
    expect(regenerateHandler).toContain('retryFromStep: 5');
    expect(regenerateHandler).toContain('failedStep: 5');
    expect(regenerateHandler).toContain('resumeTaskRun(database, updatedTask)');
    expect(regenerateHandler).not.toContain('runTask(');
    expect(preload).toContain('regenerateTaskNarration');
    expect(preload).toContain('task:regenerate-narration');
    expect(viteEnv).toContain('regenerateTaskNarration: (id: string, sceneId: number) => Promise<AppState>');
  });

  it('reruns an artifact pipeline step through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const rerunHandler = main.slice(main.indexOf("ipcMain.handle('task:rerun-step'"), main.indexOf("ipcMain.handle('task:get-artifacts'"));

    expect(main).toContain('markTaskStepForRerun');
    expect(rerunHandler).toContain('retryFromStep: step');
    expect(rerunHandler).toContain('failedStep: step');
    expect(rerunHandler).toContain('resumeTaskRun(database, updatedTask)');
    expect(rerunHandler).not.toContain('runTask(');
    expect(preload).toContain('rerunTaskStep');
    expect(preload).toContain('task:rerun-step');
    expect(viteEnv).toContain('TaskStepRerunMode');
    expect(viteEnv).toContain('rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => Promise<AppState>');
  });
});
