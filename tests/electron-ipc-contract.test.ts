import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { INVOKE_CHANNELS } from '../src/shared/storydream-api';

describe('electron ipc contract', () => {
  it('keeps runner integration timeouts at the committed heavy-test baseline', async () => {
    const runnerTests = await readFile(new URL('./runner.test.ts', import.meta.url), 'utf8');

    expect((runnerTests.match(/rewriteControlTestTimeoutMs/gu) ?? []).length).toBe(18);
  });

  it('routes every privileged invoke through one trusted registration and result boundary', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const gateway = await readFile(new URL('../electron/ipc.ts', import.meta.url), 'utf8').catch(() => '');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(main).toContain('createTrustedIpcRegistrar');
    expect(main).toContain("trustedHandle('app:get-bootstrap'");
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

  it('declares both renderer bridges through the shared API contract', async () => {
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(viteEnv).toContain("import type { StoryDreamApi } from './shared/storydream-api';");
    expect(viteEnv).toContain('storydream?: StoryDreamApi;');
    expect(viteEnv).toContain('storybound?: StoryDreamApi;');
    expect(viteEnv).not.toContain('getState:');
  });

  it('exposes product shell persistence channels to the renderer', async () => {
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    for (const channel of [
      'app:get-bootstrap',
      'app:reconcile-deltas',
      'task:list',
      'task:get-detail',
      'task:list-events',
      'viral:list',
      'viral:list-events',
      'image-lab:list',
      'voice-lab:list',
      'viral:get-detail',
      'image-lab:get-detail',
      'voice-lab:get-detail',
      'prompt-template:list',
      'prompt-template:get-detail',
      'draft-template:list',
      'draft-template:get-detail',
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
    const preloadInvokeChannels = [...preload.matchAll(/invokeTrusted(?:<[^>]+>)?\('([^']+)'/gu)].map((match) => match[1]);
    expect(preloadInvokeChannels).toEqual(INVOKE_CHANNELS);
  });

  it('keeps bootstrap list SQL off heavy record and template body columns', async () => {
    const storage = await readFile(new URL('../src/shared/storage.ts', import.meta.url), 'utf8');
    const viralList = storage.slice(storage.indexOf('async listViralAnalyses'), storage.indexOf('async getViralAnalysisDetail'));
    const imageList = storage.slice(storage.indexOf('async listImageLabRecords'), storage.indexOf('async getImageLabRecordDetail'));
    const voiceList = storage.slice(storage.indexOf('async listVoiceLabRecords'), storage.indexOf('async getVoiceLabRecordDetail'));
    const listHelper = storage.slice(storage.indexOf('private async listCreatedRecords'), storage.indexOf('async addTaskEvent'));
    const draftList = storage.slice(storage.indexOf('async listDraftTemplateSummaries'), storage.indexOf('async getDraftTemplateDetail'));

    expect(viralList).not.toContain('SELECT *');
    expect(viralList).not.toContain('settings_json');
    expect(imageList).not.toContain('SELECT *');
    expect(imageList).toContain('substr(prompt');
    expect(imageList).not.toContain('reference_image_paths_json');
    expect(voiceList).not.toContain('SELECT *');
    expect(voiceList).toContain('substr(text');
    expect(listHelper).not.toContain('SELECT *');
    expect(draftList).not.toContain('SELECT id, data');
  });

  it('exposes viral analyzer state and production-task handoff to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain('startViralAnalysisRun');
    expect(main).toContain('runViralAnalysis');
    expect(main).toContain('createViralProductionTaskInput');
    expect(preload).toContain('createAndRunViralAnalysis');
    expect(preload).toContain('createProductionTaskFromViral');
    expect(apiContract).toContain('createAndRunViralAnalysis');
    expect(apiContract).toContain('createProductionTaskFromViral');
  });

  it('publishes the initial running viral summary before waiting for runtime events', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const runner = main.slice(main.indexOf('function startViralAnalysisRun'), main.indexOf('async function resumeViralAnalysisRun'));
    const runningUpdate = runner.indexOf("status: 'running'");
    const initialPublish = runner.indexOf('await publishViralUpsert(database, record.id);', runningUpdate);
    const runtimeStart = runner.indexOf('const completed = await runViralAnalysis', runningUpdate);

    expect(runningUpdate).toBeGreaterThan(-1);
    expect(initialPublish).toBeGreaterThan(runningUpdate);
    expect(initialPublish).toBeLessThan(runtimeStart);
  });

  it('starts newly created tasks in the background so the renderer can open task detail immediately', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("trustedHandle('task:create-and-run'"), main.indexOf("trustedHandle('viral:create-and-run'"));

    expect(handler).toContain('const delta = await publishTaskUpsert(database, task.id)');
    expect(handler).toContain('startTaskRun(database, task)');
    expect(handler).toContain('return delta');
    expect(handler).not.toContain('getPublicState()');
    expect(main.match(/return getPublicState\(\)/gu)).toHaveLength(1);
  });

  it('routes resume and retry through a background task runner instead of only mutating status', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('runningTasks');
    expect(main).toContain('AbortController');
    expect(main).toContain('requestTaskRunIntent');
    expect(main).toContain('latestTaskControlRequests');
    expect(main).not.toContain('restartAfterAbort');
    expect(main).toContain('resumeTaskRun');
    expect(main).toContain("input.status === 'running'");
    const retryHandler = main.slice(main.indexOf("trustedHandle('task:retry'"), main.indexOf("trustedHandle('diagnostics:run'"));
    expect(retryHandler).toContain("requestTaskRunIntent(existingRun, 'restart', '用户重试')");
    expect(retryHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, id, async (isCurrent) => {');
    expect(retryHandler).toContain('await resumeTaskRun(database, task, isCurrent)');
    expect(retryHandler).not.toContain('runTask(');
  });

  it('keeps aborting task runners registered until they exit to avoid duplicate runs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const statusHandler = main.slice(main.indexOf("trustedHandle('task:update-status'"), main.indexOf("trustedHandle('task:retry'"));

    const requestIntent = statusHandler.indexOf('requestTaskRunIntent(');
    const firstAwait = statusHandler.indexOf('await getDb()');
    expect(requestIntent).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(requestIntent);
    expect(statusHandler).toContain('latestTaskControlRequests');
    expect(statusHandler).not.toContain('existingRun.controller.abort');
    expect(statusHandler).not.toContain('runningTasks.delete(input.id)');
  });

  it('pushes revisioned app deltas and exposes narrow bootstrap APIs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain('publishAppDelta');
    expect(main).toContain("target.webContents.send('app:delta', delta)");
    expect(main).toContain('publishTaskUpsert');
    expect(preload).toContain('getBootstrap');
    expect(preload).toContain('getTaskDetail');
    expect(preload).toContain('listTaskEvents');
    expect(preload).toContain('onAppDelta');
    expect(preload).toContain('testLlmConfig');
    expect(preload).toContain('listProviderModels');
    expect(preload).toContain('listVolcengineSpeakers');
    expect(preload).toContain('searchWebSources');
    expect(preload).toContain('composeResearchCopy');
    expect(preload).toContain('saveCustomStyle');
    expect(preload).toContain('generateCustomStyleDraft');
    expect(preload).toContain('getTaskArtifacts');
    expect(apiContract).toContain('callback: (delta: AppDelta) => void');
    expect(apiContract).toContain('testLlmConfig');
    expect(apiContract).toContain('listProviderModels');
    expect(apiContract).toContain('listVolcengineSpeakers');
    expect(apiContract).toContain('composeResearchCopy');
    expect(apiContract).toContain('saveCustomStyle');
    expect(apiContract).toContain('generateCustomStyleDraft');
    expect(apiContract).toContain('getTaskArtifacts');
  });

  it('publishes committed runner events and narrow heartbeat task summaries', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const buildOptions = main.slice(main.indexOf('async function buildRunOptions'), main.indexOf('function startTaskRun'));
    const heartbeat = buildOptions.slice(buildOptions.indexOf('onHeartbeat:'), buildOptions.indexOf('\n    },', buildOptions.indexOf('onHeartbeat:')));

    expect(buildOptions).toContain('onEvent: (event: SequencedTaskEvent)');
    expect(buildOptions).toContain('void publishTaskEvent(event)');
    expect(heartbeat).toContain('publishTaskUpsert(database, task.id)');
    expect(heartbeat).not.toContain('getState(');
    expect(heartbeat).not.toContain('getPublicState(');
    expect(heartbeat).not.toContain('sendTaskState(');
  });

  it('exposes safe local image data URLs for task artifact thumbnails', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('asset:read-data-url'");
    expect(main).toContain('readLocalImageDataUrl');
    expect(main).toContain('data:image/');
    expect(main).toContain('Unsupported preview image extension');
    expect(preload).toContain('readAssetDataUrl');
    expect(preload).toContain('asset:read-data-url');
    expect(apiContract).toContain('readAssetDataUrl: (path: string) => Promise<string>');
  });

  it('routes image lab submissions through the configured real image generator', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("trustedHandle('image-lab:generate'"), main.indexOf("trustedHandle('image-lab:add-record'"));

    expect(main).toContain('generateImageLabRecord');
    expect(handler).toContain('imageLabWorkDir');
    expect(handler).toContain('database.addImageLabRecord(record)');
    expect(preload).toContain('generateImageLab');
    expect(preload).toContain('image-lab:generate');
    expect(apiContract).toContain('generateImageLab: (input: ImageLabGenerateInput) => Promise<AppMutationResult | null>');
  });

  it('routes voice lab preview generation through the configured TTS provider', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("trustedHandle('voice-lab:generate'"), main.indexOf("trustedHandle('account:save'"));

    expect(main).toContain('generateConfiguredVoicePreview');
    expect(handler).toContain('voiceLabWorkDir');
    expect(handler).toContain('database.addVoiceLabRecord(record)');
    expect(preload).toContain('generateVoiceLabPreview');
    expect(preload).toContain('voice-lab:generate');
    expect(apiContract).toContain('generateVoiceLabPreview: (input: VoiceLabGenerateInput) => Promise<AppMutationResult | null>');
  });

  it('exposes a safe local image picker for draft template background images', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('local-image:select'");
    expect(main).toContain('dialog.showOpenDialog');
    expect(main).toContain("properties: ['openFile']");
    expect(preload).toContain('selectLocalImage');
    expect(preload).toContain('local-image:select');
    expect(apiContract).toContain('selectLocalImage: () => Promise<string | null>');
  });

  it('exposes a safe local audio picker for uploaded BGM files', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('local-audio:select'");
    expect(main).toContain('selectLocalAudio');
    expect(main).toContain("extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']");
    expect(preload).toContain('selectLocalAudio');
    expect(preload).toContain('local-audio:select');
    expect(apiContract).toContain('selectLocalAudio: () => Promise<string | null>');
  });

  it('exposes Jianying draft folder detection and folder picking to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('local-folder:select'");
    expect(main).toContain("properties: ['openDirectory']");
    expect(main).toContain("trustedHandle('jianying:draft-path:detect'");
    expect(main).toContain('detectJianyingDraftPath');
    expect(preload).toContain('selectLocalFolder');
    expect(preload).toContain('local-folder:select');
    expect(preload).toContain('detectJianyingDraftPath');
    expect(preload).toContain('jianying:draft-path:detect');
    expect(apiContract).toContain('selectLocalFolder: () => Promise<string | null>');
    expect(apiContract).toContain('detectJianyingDraftPath: () => Promise<string>');
  });

  it('exposes viral cookie file picking and a persistent login browser', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('cookie-file:select'");
    expect(main).toContain("trustedHandle('viral:open-login-window'");
    expect(main).toContain('partition:');
    expect(main).toContain('persist:storydream-viral-douyin');
    expect(main).toContain('async function openViralLoginWindow(): Promise<string | null>');
    expect(main).toContain('resolve(cookiePath)');
    expect(preload).toContain('selectCookieFile');
    expect(preload).toContain('openViralLoginWindow');
    expect(preload).toContain('openViralLoginWindow: (): Promise<string | null>');
    expect(apiContract).toContain('selectCookieFile: () => Promise<string | null>');
    expect(apiContract).toContain('openViralLoginWindow: () => Promise<string | null>');
  });

  it('exposes pyJianYingDraft effect catalog loading to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('jianying:effect-catalog'");
    expect(main).toContain('loadJianyingEffectCatalog');
    expect(preload).toContain('getJianyingEffectCatalog');
    expect(preload).toContain('jianying:effect-catalog');
    expect(apiContract).toContain('getJianyingEffectCatalog: () => Promise<JianyingEffectCatalog>');
  });

  it('checks Storybound-compatible sidecar dependencies in diagnostics', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('checkStoryboundSidecarDependencies');
    expect(main).toContain('pyJianYingDraft, imageio_ffmpeg, pydub, jieba');
    expect(main).toContain("id: 'storybound-sidecar'");
  });

  it('keeps HTML video capture behind a typed dedicated runner and narrow preview IPC', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('html-video:create-task'");
    expect(main).toContain('createElectronHtmlVideoRuntime');
    expect(main).toContain('runHtmlVideoPipeline');
    expect(main).toContain('startHtmlVideoTaskRun');
    expect(renderer).toContain('BrowserWindow');
    expect(renderer).toContain('executeJavaScript');
    expect(renderer).toContain('capturePage');
    expect(renderer).toContain('frame_%04d.jpg');
    expect(preload).toContain('createHtmlVideoTask');
    expect(preload).toContain('openHtmlVideoPreview');
    expect(preload).toContain('getHtmlVideoMediaUrl');
    expect(apiContract).toContain('createHtmlVideoTask: (input: CreateTaskInput) => Promise<AppMutationResult | null>');
    expect(apiContract).toContain('openHtmlVideoPreview: (id: string, sceneIndex?: number) => Promise<void>');
    expect(apiContract).toContain('getHtmlVideoMediaUrl: (id: string, path: string) => Promise<string>');
    expect(preload).not.toContain('eval_in_window');
    expect(preload).not.toContain('capture_webview_by_label');
    expect(preload).not.toContain('executeJavaScript');
    expect(apiContract).not.toContain('eval_in_window');
    expect(apiContract).not.toContain('capture_webview_by_label');
    expect(apiContract).not.toContain('executeJavaScript');
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
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const regenerateHandler = main.slice(main.indexOf("trustedHandle('task:regenerate-image'"), main.indexOf("trustedHandle('task:get-artifacts'"));

    expect(main).toContain('markSceneImageForRegeneration');
    expect(regenerateHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {');
    expect(regenerateHandler).toContain('retryFromStep: 4');
    expect(regenerateHandler).toContain('failedStep: 4');
    expect(regenerateHandler).toContain('resumeLatestTaskRun(database, task.id, isCurrent)');
    expect(regenerateHandler).not.toContain('runTask(');
    expect(preload).toContain('regenerateTaskImage');
    expect(preload).toContain('task:regenerate-image');
    expect(apiContract).toContain('regenerateTaskImage: (id: string, sceneId: number) => Promise<AppMutationResult | null>');
  });

  it('regenerates a single scene narration through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const regenerateHandler = main.slice(main.indexOf("trustedHandle('task:regenerate-narration'"), main.indexOf("trustedHandle('task:get-artifacts'"));

    expect(main).toContain('markSceneNarrationForRegeneration');
    expect(regenerateHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {');
    expect(regenerateHandler).toContain('retryFromStep: 5');
    expect(regenerateHandler).toContain('failedStep: 5');
    expect(regenerateHandler).toContain('resumeLatestTaskRun(database, task.id, isCurrent)');
    expect(regenerateHandler).not.toContain('runTask(');
    expect(preload).toContain('regenerateTaskNarration');
    expect(preload).toContain('task:regenerate-narration');
    expect(apiContract).toContain('regenerateTaskNarration: (id: string, sceneId: number) => Promise<AppMutationResult | null>');
  });

  it('updates one scene image prompt through a narrow task artifact API', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const updateHandler = main.slice(main.indexOf("trustedHandle('task:update-image-prompt'"), main.indexOf("trustedHandle('task:rerun-step'"));

    expect(main).toContain("trustedHandle('task:update-image-prompt'");
    expect(main).toContain('updateSceneImagePrompt');
    expect(updateHandler).toContain('artifactStatePath');
    expect(updateHandler).toContain('const event = await database.addTaskEvent');
    expect(updateHandler).toContain('await publishTaskEvent(event)');
    expect(updateHandler).not.toContain('resumeTaskRun(database, updatedTask)');
    expect(preload).toContain('updateTaskImagePrompt');
    expect(preload).toContain('task:update-image-prompt');
    expect(apiContract).toContain('updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => Promise<AppMutationResult | null>');
  });

  it('reruns an artifact pipeline step through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const rerunHandler = main.slice(main.indexOf("trustedHandle('task:rerun-step'"), main.indexOf("trustedHandle('task:get-artifacts'"));

    expect(main).toContain('markTaskStepForRerun');
    expect(rerunHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {');
    expect(rerunHandler).toContain('retryFromStep: step');
    expect(rerunHandler).toContain('failedStep: step');
    expect(rerunHandler).toContain('resumeLatestTaskRun(database, task.id, isCurrent)');
    expect(rerunHandler).not.toContain('runTask(');
    expect(preload).toContain('rerunTaskStep');
    expect(preload).toContain('task:rerun-step');
    expect(apiContract).toContain('TaskStepRerunMode');
    expect(apiContract).toContain('rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => Promise<AppMutationResult | null>');
  });
});
