import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('real Electron smoke contract', () => {
  it('launches the packaged application main instead of constructing a harness window', async () => {
    const smoke = await readFile(new URL('../scripts/smoke-electron.ts', import.meta.url), 'utf8');
    const powershell = await readFile(new URL('../scripts/smoke-electron.ps1', import.meta.url), 'utf8');

    expect(smoke).toContain("runBoundedProcess(electronPath, ['.']");
    expect(smoke).toContain('STORYDREAM_SMOKE_OUTPUT');
    expect(smoke).toContain('STORYDREAM_SMOKE_USER_DATA');
    expect(smoke).toContain('mkdtemp');
    expect(smoke).toContain('timeoutMs');
    expect(smoke).toContain('setSmokeFailureExitCode(process)');
    expect(smoke).not.toContain('new BrowserWindow');
    expect(smoke).not.toContain('loadFile(indexPath)');
    expect(powershell).toContain('run-npm-node.cmd');
    expect(powershell).not.toContain('node_modules/electron/cli.js');
  });

  it('uses a fixed main-process handshake to cover preload, IPC, policy, and the shell', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const setUserData = main.indexOf("app.setPath('userData'");
    const ready = main.indexOf('app.whenReady()');

    expect(main).toContain('STORYDREAM_SMOKE_OUTPUT');
    expect(main).toContain('STORYDREAM_SMOKE_USER_DATA');
    expect(main).toContain("outputFromUserData.startsWith('..')");
    expect(setUserData).toBeGreaterThan(-1);
    expect(setUserData).toBeLessThan(ready);
    expect(main).toContain('runSmokeHandshake');
    expect(main).toContain("document.documentElement.dataset.themeReady === 'true'");
    expect(main).toContain('window.storydream');
    expect(main).toContain('api.getBootstrap()');
    expect(main).toContain('api.saveConfig');
    expect(main).toContain('api.saveUiPreferences');
    expect(main).toContain("savedConfig?.kind === 'state-patch'");
    expect(main).toContain("savedConfig.patch.kind === 'config'");
    expect(main).toContain("savedPreferences?.kind === 'state-patch'");
    expect(main).toContain("savedPreferences.patch.kind === 'theme-preference'");
    expect(main).toContain("savedPreferences.patch.ui.activeView === 'new-task'");
    expect(main).toContain('mainWindowPolicyInstalled');
    expect(main).toContain('mainWindow.close()');
    for (const field of [
      'mainLoaded',
      'preloadExposed',
      'ipcStateLoaded',
      'preloadActionSucceeded',
      'windowPolicyInstalled',
      'shellRendered',
    ]) {
      expect(main).toContain(field);
    }
  });

  it('acquires a userData-scoped single-instance lock before primary startup and focuses the existing window', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const setUserData = main.indexOf("app.setPath('userData'");
    const requestLock = main.indexOf('app.requestSingleInstanceLock()');
    const getDatabase = main.indexOf('async function getDb()');
    const startTask = main.indexOf('function startTaskRun(');
    const ready = main.indexOf('app.whenReady()');

    expect(requestLock).toBeGreaterThan(setUserData);
    expect(requestLock).toBeLessThan(getDatabase);
    expect(requestLock).toBeLessThan(startTask);
    expect(requestLock).toBeLessThan(ready);
    expect(main).toContain(`if (!isPrimaryInstance) {
  app.quit();
}`);
    expect(main).toContain(`if (isPrimaryInstance) {
  app.whenReady().then`);
    expect(main).toContain("app.on('second-instance'");
    expect(main).toContain('mainWindow.isMinimized()');
    expect(main).toContain('mainWindow.restore();');
    expect(main).toContain('mainWindow.isVisible()');
    expect(main).toContain('mainWindow.show();');
    expect(main).toContain('mainWindow.focus();');
  });

  it('requires every fixed smoke assertion and propagates child failures', async () => {
    const smoke = await readFile(new URL('../scripts/smoke-electron.ts', import.meta.url), 'utf8');

    for (const field of [
      'mainLoaded',
      'preloadExposed',
      'ipcStateLoaded',
      'preloadActionSucceeded',
      'windowPolicyInstalled',
      'shellRendered',
    ]) {
      expect(smoke).toContain(field);
    }
    expect(smoke).toContain('child.code !== 0');
    expect(smoke).toContain('failedAssertions');
    expect(smoke).toContain('delete env.ELECTRON_RUN_AS_NODE');
    expect(smoke).toContain("VITE_DEV_SERVER_URL: ''");
    expect(smoke).toContain('throw new Error(`Electron smoke failed');
  });

  it('installs graceful HTML smoke signals before temporary work and cleans up after abort', async () => {
    const smoke = await readFile(new URL('../scripts/smoke-html-video.ts', import.meta.url), 'utf8');
    const lifecycle = smoke.indexOf('runSmokeWithTempRoot({');
    const createTempRoot = smoke.indexOf('createTempRoot:', lifecycle);
    const run = smoke.indexOf('run: async ({ tempRoot, signal }) => {', createTempRoot);
    const createWorkDir = smoke.indexOf('await mkdir(workDir', run);
    const build = smoke.indexOf('await build({', createWorkDir);
    const abortCheckpoint = smoke.indexOf('signal.throwIfAborted()', build);
    const runner = smoke.indexOf('await runBoundedProcess(', createWorkDir);
    const runnerSignal = smoke.indexOf('signal,', runner);
    const cleanup = smoke.indexOf('cleanup:', runnerSignal);

    expect(lifecycle).toBeGreaterThan(-1);
    expect(createTempRoot).toBeGreaterThan(lifecycle);
    expect(run).toBeGreaterThan(createTempRoot);
    expect(createWorkDir).toBeGreaterThan(run);
    expect(build).toBeGreaterThan(createWorkDir);
    expect(abortCheckpoint).toBeGreaterThan(build);
    expect(runner).toBeGreaterThan(abortCheckpoint);
    expect(runnerSignal).toBeGreaterThan(runner);
    expect(cleanup).toBeGreaterThan(runnerSignal);
    expect(smoke).toContain('setSmokeFailureExitCode(process)');
    expect(smoke).toContain('formatSmokeError(error)');
  });

  it('keeps the completed HTML video DOM lifecycle in a portable real-Electron QA gate', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8').catch(() => '');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(qa.length).toBeGreaterThan(1_000);
    expect(manifest.scripts?.['qa:html-video-ui']).toContain('node_modules/tsx/dist/cli.mjs scripts/qa-html-video-ui.mjs');
    expect(qa).toContain("fileURLToPath(new URL('..', import.meta.url))");
    expect(qa).toContain('STORYDREAM_FFMPEG_PATH');
    expect(qa).toContain('IMAGEIO_FFMPEG_EXE');
    expect(qa).toContain('STORYDREAM_QA_OUTPUT_DIR');
    expect(qa).not.toMatch(/[A-Z]:\\/u);
    expect(qa).not.toContain('I:/');
    expect(qa).toContain('tmpdir()');
    expect(qa).toContain("mkdtemp(join(outputBase, 'storydream-html-video-ui-'))");
    expect(qa).toContain("tabLabel: '素材'");
    expect(qa).toContain("tabLabel: '配音'");
    expect(qa).toContain("tabLabel: '动画预览'");
    expect(qa).toContain("tabLabel: '出片'");
    expect(qa).toContain('STORYDREAM_QA_ASSET_REMOVAL_ONLY');
    expect(qa).toContain("scope: 'asset-removal'");
    expect(qa).toContain('transparencyLabels');
    expect(qa).toContain('singleRemovalButtonCount');
    expect(qa).toContain('batchRemovalVisible');
    expect(qa).toContain('staleReadyIgnored');
    expect(qa).toContain('staleErrorIgnored');
    expect(qa).toContain('!result.staleErrorIgnored');
    expect(qa).toContain('taskSwitchObserved');
    expect(qa).toContain('pathSwitchObserved');
    expect(qa).toContain('sameUrlMissingThenRestored');
    expect(qa).toContain('const image = new Image()');
    expect(qa).toContain("missing.event === 'error'");
    expect(qa).toContain("restored.event === 'load'");
    expect(qa).toContain('isExpectedMissingMedia404');
    expect(qa).toContain('expectedRequestIds');
    expect(qa).toContain('window.storydream.getTaskDetail');
    expect(qa).toContain('window.storydream.listTaskEvents');
    expect(qa).toContain('directTaskDetail');
    expect(qa).toContain('directTaskEvents');
    expect(qa).toContain('rendererRuntimeErrors: runtimeErrors.slice(-20)');
    expect(qa).toContain("electronStderr: Buffer.concat(stderr).toString('utf8').slice(-4000)");
    expect(qa.match(/element\.pause\?\.\(\);\s+element\.removeAttribute\('src'\);\s+element\.load\?\.\(\);/gu) ?? []).toHaveLength(2);
    expect(qa).toContain('async function stopChild(childProcess)');
    expect(qa).toContain("if (process.platform === 'win32')");
    expect(qa).not.toMatch(/playwright|puppeteer/u);
  });

  it('waits for the themed application shell before capturing visible page identity', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8');
    const identityIndex = qa.indexOf('const identity = await evaluate');
    const readiness = qa.slice(
      qa.lastIndexOf('await waitFor(', identityIndex),
      identityIndex,
    );

    expect(readiness).toContain("document.documentElement.dataset.themeReady === 'true'");
  });

  it('builds immediately before running the HTML video Electron QA gate', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const command = manifest.scripts?.['qa:html-video-ui'] ?? '';

    expect(command).toMatch(
      /scripts\\run-npm-powershell\.cmd scripts\/build\.ps1\s*&&\s*scripts\\run-npm-node\.cmd node_modules\/tsx\/dist\/cli\.mjs scripts\/qa-html-video-ui\.mjs/u,
    );
  });

  it('owns every operation after the HTML video QA temp directory through cleanup', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8');
    const tempRoot = qa.indexOf("const qaTempDir = await mkdtemp(join(outputBase, 'storydream-html-video-ui-'));");
    const afterTempRoot = qa.indexOf('\n', tempRoot) + 1;
    const cleanupTry = qa.indexOf('try {', afterTempRoot);
    const cleanupFinally = qa.indexOf('} finally {', cleanupTry);

    expect(tempRoot).toBeGreaterThan(-1);
    expect(qa.slice(afterTempRoot, cleanupTry).trim()).toBe('qaRun: {');
    expect(cleanupFinally).toBeGreaterThan(cleanupTry);
    expect(qa.slice(cleanupFinally, qa.indexOf('\n}', cleanupFinally) + 2)).toContain('await removeWithRetry(qaTempDir)');
  });

  it('bounds CDP connection work and rejects pending and future commands after termination', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8');
    const connect = qa.slice(qa.indexOf('function connectCdp'), qa.indexOf('async function evaluate'));
    const terminateStart = connect.indexOf('const terminateCdp');
    const terminate = connect.slice(terminateStart, connect.indexOf('\n    };', terminateStart));
    const target = qa.slice(qa.indexOf('async function waitForTarget'), qa.indexOf('function connectCdp'));
    const wait = qa.slice(qa.indexOf('async function waitFor'), qa.indexOf('async function saveScreenshot'));

    expect(connect).toContain("socket.addEventListener('close'");
    expect(connect).toContain("socket.addEventListener('error'");
    expect(connect).toContain('rejectPending(');
    expect(connect).toContain('terminalError');
    expect(terminate).toContain('clearTimeout(connectTimeout)');
    expect(connect).toMatch(/socket\.addEventListener\('error',[\s\S]*?terminateCdp\(error\)/u);
    expect(connect).toMatch(/socket\.addEventListener\('close',[\s\S]*?terminateCdp\(/u);
    expect(connect).toMatch(/send\(method, params = \{\}\)[\s\S]*?if \(terminalError\)[\s\S]*?setTimeout\(/u);
    expect(connect).toContain('return Promise.reject(terminalError)');
    expect(connect).toMatch(/close\(\)[\s\S]*?rejectPending\(/u);
    expect(target).toMatch(/await withTimeout\([\s\S]*?fetch\([\s\S]*?response\.json\(\)/u);
    expect(wait).toContain('WAIT_FOR_CHECK_TIMEOUT_MS');
    expect(wait).toMatch(/await withTimeout\([\s\S]*?check\(\)/u);
  });

  it('attributes the expected missing-media 404 exactly and verifies a real partial response', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8');
    const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const expected404 = qa.slice(
      qa.indexOf('function isExpectedMissingMedia404'),
      qa.indexOf('async function inspectPage'),
    );

    expect(qa).toContain("cdp.send('Network.enable')");
    expect(qa).toContain("cdp.on('Network.responseReceived'");
    expect(qa).toContain('entry.networkRequestId');
    expect(expected404).toContain('error.url === expectedMissingMediaUrl');
    expect(expected404).toContain('expectedRequestIds.has(error.requestId)');
    expect(expected404).toContain("error.message.includes('404')");
    expect(qa).toContain('verifyRangeResponse(cdp, primaryOutput.src, seededTasks.primary.outputPath)');
    expect(qa).toContain("headers: { Range: 'bytes=0-31' }");
    expect(qa).toContain('rangeResponse.status !== 206');
    expect(qa).toContain('rangeResponse.contentRange !== expectedContentRange');
    expect(qa).toContain('rangeResponse.bodyLength !== 32');
    expect(indexHtml).toMatch(/connect-src[^;]*storydream-media:/u);
  });

  it('exercises all governed HTML config controls and render-stage invalidation in real Electron QA', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8');

    expect(qa).toContain('const creationControls = await inspectConfigControls(cdp);');
    expect(qa).toContain('const workspaceControls = await inspectConfigControls(cdp);');
    expect(qa).toContain('createFields: creationControls.createFields');
    expect(qa).toContain('editFields: workspaceControls.editFields');
    expect(qa).toContain('const configUpdate = await exerciseHtmlVideoConfigUpdate(cdp);');
    expect(qa).toContain("document.querySelectorAll('[data-html-video-create-field]')");
    expect(qa).toContain("document.querySelectorAll('[data-html-video-edit-field]')");
    expect(qa).toContain("'coverImageMode', 'coverTemplate', 'coverRatio'");
    expect(qa).toContain("'draftTemplate'");
    expect(qa).toContain('const htmlVideoReadOnlyFields = [];');
    expect(qa).toContain("document.querySelector('[data-html-video-edit-field=\"transitionType\"] select')");
    expect(qa).toContain("item.textContent.includes('保存参数')");
    expect(qa).toContain("item.textContent.includes('继续')");
    expect(qa).toContain('completedStepCount: document.querySelectorAll(\'.hv-step.done\').length');
    expect(qa).toContain('if (configUpdate.completedStepCount !== 5)');
  });

  it('exercises preview-only caption controls and preview-stage invalidation in real Electron QA', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8');

    expect(qa).toContain('const captionUpdate = await exerciseHtmlVideoCaptionUpdate(cdp, seededTasks.primary.id);');
    expect(qa).toContain("'[data-html-video-edit-field=\"captionPreset\"] select'");
    expect(qa).toContain("'[data-html-video-edit-field=\"captionAnim\"] select'");
    expect(qa).toContain("'[data-html-video-edit-field=\"captionColors\"] input[type=\"color\"]'");
    expect(qa).toContain("'input[aria-label=\"强调十六进制颜色\"]'");
    expect(qa).toContain("item.textContent.includes('保存字幕')");
    expect(qa).toContain('if (captionUpdate.completedStepCount !== 4)');
    expect(qa).toContain('const captionPreview = await resumeAndCaptureCaptionPreview(');
    expect(qa).toContain("item.textContent.includes('继续')");
    expect(qa).toContain("data-caption-preset");
    expect(qa).toContain('caption-preview.png');
    expect(qa).toContain('captionPreview.captionVisible');
    expect(qa).toContain("document.querySelector('#html-video-panel .hv-reference-thumb img')");
    expect(qa).toContain("document.querySelector('#html-video-panel .hv-reference-phone iframe')");
    expect(qa).toContain('thumbnail.width !== 720 || thumbnail.height !== 1280');
    expect(qa).toContain('caption-editor.png');
    expect(qa).toContain('STORYDREAM_QA_EVIDENCE_DIR');
  });

  it('captures the official HyperFrames authoring workspace in both supported viewports', async () => {
    const qa = await readFile(new URL('../scripts/qa-html-video-ui.mjs', import.meta.url), 'utf8');

    expect(qa).toContain('const authoringDesktop = await exerciseHyperframesAuthoring(');
    expect(qa).toContain('const authoringCompact = await exerciseHyperframesAuthoring(');
    expect(qa).toContain('authoring-desktop.png');
    expect(qa).toContain('authoring-compact.png');
    expect(qa).toContain("item.textContent.trim() === '可视编排'");
    expect(qa).toContain("document.querySelector('.hv-authoring-workspace')");
    expect(qa).toContain('player?.ready === true');
    expect(qa).toContain('player?.iframeElement?.src');
    expect(qa).toContain("iframeUrl.startsWith('storydream-media:')");
    expect(qa).toContain("['源码', '属性', '检查', '渲染队列']");
    expect(qa).toContain("document.querySelector('.hv-authoring-statusbar')");
    expect(qa).toContain("document.querySelectorAll('.hv-authoring-lint-finding.error')");
    expect(qa).toContain("document.querySelectorAll('.hv-authoring-track-line')");
    expect(qa).toContain("document.querySelectorAll('.hv-authoring-clip')");
    expect(qa).toContain('authoringDesktop.horizontalOverflow');
    expect(qa).toContain('authoringCompact.clippedControls.length');
  });
});
