import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron ipc contract', () => {
  it('routes every privileged invoke through one trusted registration and result boundary', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const gateway = await readFile(new URL('../electron/ipc.ts', import.meta.url), 'utf8').catch(() => '');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(main).toContain('createTrustedIpcRegistrar');
    expect(main).toContain("trustedHandle('app:get-state'");
    expect((main.match(/ipcMain\.handle\(/g) ?? []).length).toBe(1);
    expect(preload).toContain('invokeTrusted');
    expect(preload).toContain('unwrapIpcResult');
    expect((preload.match(/ipcRenderer\.invoke\(/g) ?? []).length).toBe(1);
    expect(gateway).toContain('IPC_SENDER_REJECTED');
    expect(gateway).toContain('IPC_INVALID_INPUT');
    expect(manifest.dependencies?.zod).toBeTruthy();
    expect(manifest.devDependencies?.zod).toBeUndefined();
  });

  it('defines a renderer sender policy for the trusted IPC gateway', async () => {
    const security = await readFile(new URL('../electron/security.ts', import.meta.url), 'utf8').catch(() => '');

    expect(security).toContain('export function isTrustedRendererSender');
    expect(security).toContain('event.sender !== win.webContents');
    expect(security).toContain('event.senderFrame !== win.webContents.mainFrame');
    expect(security).toContain('isAllowedRendererNavigation');
  });

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
    const retryHandler = main.slice(main.indexOf("trustedHandle('task:retry'"), main.indexOf("trustedHandle('diagnostics:run'"));
    expect(retryHandler).toContain('resumeTaskRun(database, task)');
    expect(retryHandler).not.toContain('runTask(');
  });

  it('keeps aborting task runners registered until they exit to avoid duplicate runs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const statusHandler = main.slice(main.indexOf("trustedHandle('task:update-status'"), main.indexOf("trustedHandle('task:retry'"));

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

    expect(main).toContain("trustedHandle('asset:read-data-url'");
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
    const handler = main.slice(main.indexOf("trustedHandle('image-lab:generate'"), main.indexOf("trustedHandle('image-lab:add-record'"));

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
    const handler = main.slice(main.indexOf("trustedHandle('voice-lab:generate'"), main.indexOf("trustedHandle('account:save'"));

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

    expect(main).toContain("trustedHandle('local-image:select'");
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

    expect(main).toContain("trustedHandle('local-audio:select'");
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

    expect(main).toContain("trustedHandle('local-folder:select'");
    expect(main).toContain("properties: ['openDirectory']");
    expect(main).toContain("trustedHandle('jianying:draft-path:detect'");
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

    expect(main).toContain("trustedHandle('cookie-file:select'");
    expect(main).toContain("trustedHandle('viral:open-login-window'");
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

    expect(main).toContain("trustedHandle('jianying:effect-catalog'");
    expect(main).toContain('loadJianyingEffectCatalog');
    expect(preload).toContain('getJianyingEffectCatalog');
    expect(preload).toContain('jianying:effect-catalog');
    expect(viteEnv).toContain('getJianyingEffectCatalog: () => Promise<JianyingEffectCatalog>');
  });

  it('checks Storybound-compatible sidecar dependencies in diagnostics', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('checkStoryboundSidecarDependencies');
    expect(main).toContain('pyJianYingDraft, imageio_ffmpeg, pydub, jieba');
    expect(main).toContain("id: 'storybound-sidecar'");
  });

  it('keeps HTML video capture behind a typed Electron service without wiring it into the story runner', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('html-video:create-task'");
    expect(main).not.toContain('createElectronHtmlVideoRenderer');
    expect(renderer).toContain('BrowserWindow');
    expect(renderer).toContain('executeJavaScript');
    expect(renderer).toContain('capturePage');
    expect(renderer).toContain('frame_%04d.jpg');
    expect(preload).toContain('createHtmlVideoTask');
    expect(viteEnv).toContain('createHtmlVideoTask: (input: CreateTaskInput) => Promise<AppState>');
    expect(preload).not.toContain('eval_in_window');
    expect(preload).not.toContain('capture_webview_by_label');
    expect(preload).not.toContain('executeJavaScript');
    expect(viteEnv).not.toContain('eval_in_window');
    expect(viteEnv).not.toContain('capture_webview_by_label');
    expect(viteEnv).not.toContain('executeJavaScript');
    expect(main).not.toContain("trustedHandle('eval_in_window'");
    expect(main).not.toContain("trustedHandle('capture_webview_by_label'");
    expect(main).not.toContain("trustedHandle('executeJavaScript'");
  });

  it('waits for a fully ready hidden HTML scene before capture begins', async () => {
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');
    const openHiddenWindow = renderer.slice(renderer.indexOf('async function openHiddenHtmlWindow'));

    expect(renderer).toContain('waitForHiddenHtmlSceneReady');
    expect(openHiddenWindow).toContain('await waitForHiddenHtmlSceneReady(window)');
    expect(renderer).toContain("document.readyState !== 'loading'");
    expect(renderer).toContain('window.__ready === true');
    expect(renderer).toContain("typeof window.__tl.seek === 'function'");
    expect(renderer).toContain('document.fonts.ready');
    expect(renderer).toContain('document.images');
  });

  it('seeks each hidden scene frame onto an animation frame before writing recovered JPEG names', async () => {
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');
    const captureLoop = renderer.slice(renderer.indexOf('for (let frameIndex = 0'), renderer.indexOf('capturedScenes.push'));

    expect(renderer).toContain("const sidecarFramePattern = 'frame_%04d.jpg'");
    expect(captureLoop).toContain('const frameNumber = frameIndex + 1');
    expect(captureLoop).toContain("sidecarFramePattern.replace('%04d', String(frameNumber).padStart(4, '0'))");
    expect(captureLoop).toContain('await seekHiddenHtmlSceneFrame(window, time)');
    expect(renderer).toContain('requestAnimationFrame');
    expect(captureLoop).toContain('capturePage');
  });

  it('regenerates a single scene image through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const regenerateHandler = main.slice(main.indexOf("trustedHandle('task:regenerate-image'"), main.indexOf("trustedHandle('task:get-artifacts'"));

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
    const regenerateHandler = main.slice(main.indexOf("trustedHandle('task:regenerate-narration'"), main.indexOf("trustedHandle('task:get-artifacts'"));

    expect(main).toContain('markSceneNarrationForRegeneration');
    expect(regenerateHandler).toContain('retryFromStep: 5');
    expect(regenerateHandler).toContain('failedStep: 5');
    expect(regenerateHandler).toContain('resumeTaskRun(database, updatedTask)');
    expect(regenerateHandler).not.toContain('runTask(');
    expect(preload).toContain('regenerateTaskNarration');
    expect(preload).toContain('task:regenerate-narration');
    expect(viteEnv).toContain('regenerateTaskNarration: (id: string, sceneId: number) => Promise<AppState>');
  });

  it('updates one scene image prompt through a narrow task artifact API', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const updateHandler = main.slice(main.indexOf("trustedHandle('task:update-image-prompt'"), main.indexOf("trustedHandle('task:rerun-step'"));

    expect(main).toContain("trustedHandle('task:update-image-prompt'");
    expect(main).toContain('updateSceneImagePrompt');
    expect(updateHandler).toContain('artifactStatePath');
    expect(updateHandler).toContain('database.addTaskEvent');
    expect(updateHandler).not.toContain('resumeTaskRun(database, updatedTask)');
    expect(preload).toContain('updateTaskImagePrompt');
    expect(preload).toContain('task:update-image-prompt');
    expect(viteEnv).toContain('updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => Promise<AppState>');
  });

  it('reruns an artifact pipeline step through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const rerunHandler = main.slice(main.indexOf("trustedHandle('task:rerun-step'"), main.indexOf("trustedHandle('task:get-artifacts'"));

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
