import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const outputBase = resolve(process.env.STORYDREAM_QA_OUTPUT_DIR || tmpdir());
const CDP_CONNECT_TIMEOUT_MS = 10_000;
const CDP_COMMAND_TIMEOUT_MS = 15_000;
const WAIT_FOR_CHECK_TIMEOUT_MS = 5_000;
const stderr = [];
const stdout = [];
const runtimeErrors = [];
const networkRequests = [];
const networkResponses = [];
let child;
let cdp;
let ffmpegPath;
let profileDir;
await mkdir(outputBase, { recursive: true });
const qaTempDir = await mkdtemp(join(outputBase, 'storydream-html-video-ui-'));
try {
  profileDir = join(qaTempDir, 'profile');
  const desktopScreenshot = join(qaTempDir, 'desktop.png');
  const compactScreenshot = join(qaTempDir, 'compact.png');
  const require = createRequire(join(rootDir, 'package.json'));
  const electronPath = require('electron');
  const { WebSocket } = require('undici');
  ffmpegPath = await resolveFfmpegPath();
  const port = await availablePort();
  await assertBuiltApplication();
  await mkdir(profileDir, { recursive: true });
  const seededTasks = await seedCompletedTasks();
  const env = { ...process.env, NODE_ENV: 'production', VITE_DEV_SERVER_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    rootDir,
  ], {
    cwd: rootDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendBounded(stdout, chunk));
  child.stderr.on('data', (chunk) => appendBounded(stderr, chunk));

  const target = await waitForTarget(port, child);
  cdp = await connectCdp(target.webSocketDebuggerUrl, WebSocket);
  cdp.on('Runtime.exceptionThrown', (params) => {
    runtimeErrors.push({
      source: 'runtime',
      message: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Runtime exception',
    });
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error' && params.type !== 'warning') return;
    runtimeErrors.push({
      source: 'console',
      message: params.args?.map((item) => item.value ?? item.description ?? '').join(' ') || `console.${params.type}`,
    });
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry?.level !== 'error' && entry?.level !== 'warning') return;
    runtimeErrors.push({
      source: 'log',
      message: entry.text || `log.${entry.level}`,
      url: entry.url || '',
      requestId: entry.networkRequestId || '',
    });
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    if (!response || response.status < 400) return;
    networkResponses.push({ requestId, url: response.url, status: response.status });
  });
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!request?.url?.startsWith('storydream-media:')) return;
    networkRequests.push({ requestId, url: request.url, headers: request.headers });
  });

  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable'),
    cdp.send('Network.enable'),
  ]);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1320,
    height: 860,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(
    async () => evaluate(cdp, `Boolean(document.querySelector('.app-shell'))`),
    20_000,
    'application shell',
  );

  const identity = await evaluate(cdp, `({
    title: document.title,
    url: location.href,
    bodyTextLength: document.body.innerText.trim().length,
    hasFrameworkOverlay: Boolean(document.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay')),
  })`);
  const expectedUrl = pathToFileURL(join(rootDir, 'dist-renderer', 'index.html')).href;
  if (identity.url !== expectedUrl) throw new Error(`Unexpected renderer URL: ${identity.url}`);
  const navClicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('HTML 动画视频'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!navClicked) throw new Error('HTML video navigation button was not found.');
  await waitFor(
    async () => evaluate(cdp, `document.querySelector('.hv-config h2')?.textContent === 'HTML 动画视频'`),
    10_000,
    'HTML video page',
  );
  await waitFor(
    async () => evaluate(cdp, `document.querySelectorAll('.hv-step').length === 6 && document.querySelector('.hv-workspace h3')?.textContent.includes(${JSON.stringify(seededTasks.primary.title)})`),
    20_000,
    'primary completed task',
  );

  const primaryOutput = await openOutputAndWait(cdp, seededTasks.primary);
  const rangeResponse = await verifyRangeResponse(cdp, primaryOutput.src, seededTasks.primary.outputPath);
  const playback = await samplePlayback(cdp);
  const sameUrlRecovery = await exerciseSameUrlMissingRestore(
    cdp,
    seededTasks.primary.id,
    seededTasks.primary.retryPath,
  );
  const sameUrlMissingThenRestored = sameUrlRecovery.restored;
  const taskPathSwitch = await exerciseTaskAndPathSwitch(cdp, seededTasks, primaryOutput.src);
  const taskSwitchObserved = taskPathSwitch.taskSwitchObserved;
  const pathSwitchObserved = taskPathSwitch.pathSwitchObserved;

  const mediaElementRecovery = {
    asset: await exerciseMediaElementState(cdp, {
      tabLabel: '素材',
      selector: '.hv-media-frame img',
      failureText: '图片加载失败',
      successEvent: 'load',
    }),
    voice: await exerciseMediaElementState(cdp, {
      tabLabel: '配音',
      selector: '#html-video-panel audio',
      failureText: '音频文件暂不可用',
      successEvent: 'canplay',
    }),
    thumbnail: await exerciseMediaElementState(cdp, {
      tabLabel: '动画预览',
      selector: '.hv-media-frame img',
      failureText: '预览加载失败',
      successEvent: 'load',
    }),
    output: await exerciseMediaElementState(cdp, {
      tabLabel: '出片',
      selector: '.hv-video-output video',
      failureText: '视频文件暂不可用',
      successEvent: 'canplay',
    }),
  };

  await evaluate(cdp, `document.querySelector('.hv-video-output')?.scrollIntoView({ block: 'center' })`);
  await delay(250);
  const desktopState = await inspectPage(cdp);
  await saveScreenshot(cdp, desktopScreenshot);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1080,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(350);
  await evaluate(cdp, `document.querySelector('.hv-video-output')?.scrollIntoView({ block: 'center' })`);
  const compactState = await inspectPage(cdp);
  await saveScreenshot(cdp, compactScreenshot);

  const expectedMissingMediaResponses = networkResponses.filter((response) => (
    response.status === 404 && response.url === sameUrlRecovery.mediaUrl
  ));
  if (!expectedMissingMediaResponses.length) {
    throw new Error(`The expected missing-media request did not produce a tracked 404: ${sameUrlRecovery.mediaUrl}`);
  }
  const expectedRequestIds = new Set(expectedMissingMediaResponses.map((response) => response.requestId));
  const relevantRuntimeErrors = runtimeErrors.filter((error) => (
    error.message
    && !error.message.includes('DevTools')
    && !isExpectedMissingMedia404(error, sameUrlRecovery.mediaUrl, expectedRequestIds)
  ));
  if (identity.title !== 'StoryDream') throw new Error(`Unexpected page title: ${identity.title}`);
  if (identity.bodyTextLength < 100 || identity.hasFrameworkOverlay) {
    throw new Error('Application shell is blank or covered by a framework error overlay.');
  }
  if (!taskSwitchObserved || !pathSwitchObserved) throw new Error('Task and path switching was not observed.');
  if (!sameUrlMissingThenRestored) throw new Error('The same media URL did not recover after a no-store 404.');
  if (desktopState.stepCount !== 6 || compactState.stepCount !== 6) throw new Error('Six-step rail was not rendered.');
  if (!desktopState.stepsCompleted || !compactState.stepsCompleted) throw new Error('Completed task steps were not all completed.');
  if (desktopState.activeTab !== '出片' || compactState.activeTab !== '出片') throw new Error('Output tab did not stay active.');
  if (!desktopState.video.visible || !compactState.video.visible) throw new Error('Completed output is not visible in both viewports.');
  if (desktopState.horizontalOverflow > 2 || compactState.horizontalOverflow > 2) throw new Error('HTML video page overflows horizontally.');
  if (desktopState.clippedControls.length || compactState.clippedControls.length) throw new Error('HTML video controls are clipped.');
  if (!(playback.currentTime > 0.2) || playback.readyState < 2 || playback.error) throw new Error('Output playback did not advance.');
  for (const [kind, result] of Object.entries(mediaElementRecovery)) {
    if (!result.errorObserved || !result.retryObserved || !result.staleErrorIgnored || !result.staleReadyIgnored || !result.readyObserved) {
      throw new Error(`${kind} did not complete the error, retry, stale-event, and ready lifecycle.`);
    }
  }
  if (relevantRuntimeErrors.length) {
    throw new Error(`Renderer console errors: ${relevantRuntimeErrors.map((error) => error.message).join(' | ')}`);
  }

  const screenshots = await Promise.all([desktopScreenshot, compactScreenshot].map(async (path) => {
    const value = await stat(path);
    if (value.size <= 0) throw new Error(`Screenshot evidence is empty: ${basename(path)}`);
    return { name: basename(path), size: value.size };
  }));
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    pageTitle: identity.title,
    pageUrl: identity.url,
    playback,
    rangeResponse,
    sameUrlMissingThenRestored,
    taskSwitchObserved,
    pathSwitchObserved,
    mediaElementRecovery,
    desktop: desktopState,
    compact: compactState,
    screenshots,
    runtimeErrors: relevantRuntimeErrors,
  }, null, 2)}\n`);
} finally {
  cdp?.close();
  await stopChild(child);
  await removeWithRetry(qaTempDir);
}

async function assertBuiltApplication() {
  const required = [
    join(rootDir, 'dist-renderer', 'index.html'),
    join(rootDir, 'dist-electron', 'electron', 'main.js'),
    join(rootDir, 'dist-electron', 'electron', 'preload.js'),
  ];
  for (const path of required) {
    try {
      const value = await stat(path);
      if (!value.isFile() || value.size <= 0) throw new Error('empty build artifact');
    } catch (error) {
      throw new Error(`HTML video UI QA requires a fresh build. Missing ${path}. Run npm run build first.`, { cause: error });
    }
  }
}

async function resolveFfmpegPath() {
  for (const explicit of [process.env.STORYDREAM_FFMPEG_PATH, process.env.IMAGEIO_FFMPEG_EXE]) {
    if (!explicit) continue;
    const path = resolve(explicit);
    const value = await stat(path).catch(() => null);
    if (!value?.isFile()) throw new Error(`Configured ffmpeg is not a file: ${path}`);
    return path;
  }

  const roots = [rootDir];
  const parent = dirname(rootDir);
  if (basename(parent) === '.worktrees') roots.push(dirname(parent));
  const discovered = [];
  for (const candidateRoot of [...new Set(roots)]) {
    const binariesDir = join(
      candidateRoot,
      'vendor',
      'python',
      'Lib',
      'site-packages',
      'imageio_ffmpeg',
      'binaries',
    );
    const names = await readdir(binariesDir).catch(() => []);
    for (const name of names) {
      if (!/^ffmpeg(?:-|\.exe$)/iu.test(name)) continue;
      const path = join(binariesDir, name);
      if ((await stat(path).catch(() => null))?.isFile()) discovered.push(path);
    }
  }
  const unique = [...new Set(discovered.map((path) => resolve(path)))];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) {
    throw new Error('Multiple bundled ffmpeg binaries were found. Set STORYDREAM_FFMPEG_PATH explicitly.');
  }
  throw new Error('No ffmpeg binary was found. Set STORYDREAM_FFMPEG_PATH or IMAGEIO_FFMPEG_EXE.');
}

async function seedCompletedTasks() {
  const storageUrl = pathToFileURL(join(rootDir, 'src', 'shared', 'storage.ts')).href;
  const workflowUrl = pathToFileURL(join(rootDir, 'src', 'shared', 'html-video-workflow.ts')).href;
  const [{ FileDatabase }, { createHtmlVideoPipelineData }] = await Promise.all([
    import(storageUrl),
    import(workflowUrl),
  ]);
  const appDataDir = join(profileDir, 'storydream');
  await mkdir(appDataDir, { recursive: true });
  const database = await FileDatabase.open(join(appDataDir, 'data.db'));
  try {
    const secondary = await seedCompletedTask(database, createHtmlVideoPipelineData, appDataDir, {
      title: '切换目标输出 QA',
      tone: 550,
    });
    await delay(10);
    const primary = await seedCompletedTask(database, createHtmlVideoPipelineData, appDataDir, {
      title: '已完成输出播放 QA',
      tone: 660,
    });
    return { primary, secondary };
  } finally {
    await database.close();
  }
}

async function seedCompletedTask(database, createHtmlVideoPipelineData, appDataDir, options) {
  const pipeline = createHtmlVideoPipelineData(`${options.title}。`, {
    ratio: '9:16',
    style: 'cinematic',
    transitionType: 'fade',
    bgmId: '',
    foreground: false,
  });
  const task = await database.createTask({
    title: options.title,
    inputText: `${options.title}。`,
    taskKind: 'story',
    taskType: 'html-video',
    ratio: '9:16',
    style: 'cinematic',
    pipelineStep: 'rewrite',
    pipelineData: JSON.stringify(pipeline),
  });
  if (!task.managedStorageKey) throw new Error('Seeded task has no managed storage key.');
  const taskDir = join(appDataDir, 'tasks', task.managedStorageKey);
  const assetPath = join(taskDir, 'scene-001.png');
  const voicePath = join(taskDir, 'scene-001.wav');
  const thumbnailPath = join(taskDir, 'scene-001-thumbnail.png');
  const outputPath = join(taskDir, 'final.mp4');
  const retryPath = join(taskDir, 'same-url-retry.png');
  await mkdir(taskDir, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await Promise.all([
    writeFile(assetPath, png),
    writeFile(thumbnailPath, png),
    writeFile(retryPath, png),
  ]);
  createQaAudio(voicePath, options.tone);
  createQaVideo(outputPath, options.tone);
  const [assetStat, voiceStat, outputStat] = await Promise.all([
    stat(assetPath),
    stat(voicePath),
    stat(outputPath),
  ]);
  const now = Date.now();
  pipeline.current = 'done';
  pipeline.revision = 6;
  for (const step of Object.values(pipeline.steps)) {
    step.status = 'completed';
    step.startedAt = now - 5_000;
    step.completedAt = now - 1_000;
    delete step.error;
  }
  pipeline.assets = [{
    sceneIndex: 1,
    kind: 'bg',
    slot: 0,
    src: assetPath,
    prompt: '真实 DOM 图片错误恢复验证',
    sizeBytes: assetStat.size,
  }];
  pipeline.voices = [{
    sceneIndex: 1,
    src: voicePath,
    durationSec: 1,
    text: '真实 DOM 音频错误恢复验证',
    sizeBytes: voiceStat.size,
  }];
  pipeline.compositions = [{
    index: 1,
    durationSec: 1,
    canvas: { w: 320, h: 568 },
    audio: { src: voicePath, durationSec: 1 },
    background: { src: assetPath },
    captions: [{ id: 'caption-1', text: '媒体恢复验证', startSec: 0, durationSec: 1 }],
    thumbnailPath,
    rev: 1,
  }];
  pipeline.output = {
    path: outputPath,
    sizeBytes: outputStat.size,
    durationSec: 3,
  };
  await database.updateTask(task.id, {
    status: 'completed',
    currentStep: 6,
    outputDir: taskDir,
    errorMessage: '',
    completedAt: new Date(now).toISOString(),
    pipelineStep: 'done',
    pipelineData: JSON.stringify(pipeline),
  });
  return { id: task.id, title: options.title, taskDir, outputPath, retryPath };
}

function createQaAudio(outputPath, tone) {
  runFfmpeg([
    '-f', 'lavfi',
    '-i', `sine=frequency=${tone}:sample_rate=48000:duration=1`,
    '-c:a', 'pcm_s16le',
    outputPath,
  ], 'audio');
}

function createQaVideo(outputPath, tone) {
  runFfmpeg([
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x568:rate=24:duration=3',
    '-f', 'lavfi',
    '-i', `sine=frequency=${tone}:sample_rate=48000:duration=3`,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ], 'video');
}

function runFfmpeg(args, label) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    cwd: rootDir,
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Could not create QA ${label} (${result.status ?? result.signal}).\n${String(result.stderr).slice(-4000)}`);
  }
}

async function openOutputAndWait(cdpConnection, task) {
  const { id, title } = task;
  const clicked = await evaluate(cdpConnection, `(() => {
    const tab = [...document.querySelectorAll('.hv-tab')].find((item) => item.textContent.trim() === '出片');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Output tab was not found.');
  try {
    await waitFor(
      async () => evaluate(cdpConnection, `(() => {
        const video = document.querySelector('.hv-video-output video');
        return Boolean(document.querySelector('.hv-workspace h3')?.textContent.includes(${JSON.stringify(title)})
          && video?.src && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0);
      })()`),
      20_000,
      `output for ${title}`,
    );
  } catch (error) {
    const diagnostic = await evaluate(cdpConnection, `(async () => {
      const capture = async (operation) => {
        try {
          return { status: 'fulfilled', value: await operation };
        } catch (reason) {
          return { status: 'rejected', reason: String(reason?.stack || reason) };
        }
      };
      const [directTaskDetail, directTaskEvents] = await Promise.all([
        capture(window.storydream.getTaskDetail(${JSON.stringify(id)})),
        capture(window.storydream.listTaskEvents(${JSON.stringify(id)}, { limit: 100 })),
      ]);
      const video = document.querySelector('.hv-video-output video');
      return {
        heading: document.querySelector('.hv-workspace h3')?.textContent || '',
        panelText: document.querySelector('#html-video-panel')?.textContent || '',
        alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent?.trim() || ''),
        directTaskDetail,
        directTaskEvents,
        video: video ? {
          src: video.src,
          readyState: video.readyState,
          duration: video.duration,
          networkState: video.networkState,
          error: video.error ? { code: video.error.code, message: video.error.message } : null,
        } : null,
      };
    })()`);
    throw new Error(`${error.message}\n${JSON.stringify({
      ...diagnostic,
      rendererRuntimeErrors: runtimeErrors.slice(-20),
      electronStderr: Buffer.concat(stderr).toString('utf8').slice(-4000),
    })}`, { cause: error });
  }
  return evaluate(cdpConnection, `(() => {
    const video = document.querySelector('.hv-video-output video');
    return { src: video.src, duration: video.duration, readyState: video.readyState };
  })()`);
}

async function samplePlayback(cdpConnection) {
  return evaluate(cdpConnection, `(async () => {
    const video = document.querySelector('.hv-video-output video');
    if (!video) throw new Error('Completed output video was not rendered.');
    video.currentTime = 0;
    await video.play();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video playback did not advance.')), 5000);
      const check = () => {
        if (video.error) {
          clearTimeout(timeout);
          reject(new Error('Video playback error code ' + video.error.code));
        } else if (video.currentTime > 0.2) {
          clearTimeout(timeout);
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
    const result = {
      currentTime: video.currentTime,
      duration: video.duration,
      readyState: video.readyState,
      src: video.src,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    };
    video.pause();
    return result;
  })()`, { userGesture: true });
}

async function verifyRangeResponse(cdpConnection, mediaUrl, mediaPath) {
  const expectedSize = (await stat(mediaPath)).size;
  if (expectedSize < 32) throw new Error(`Range QA media is too small: ${expectedSize} bytes.`);
  const expectedContentRange = `bytes 0-31/${expectedSize}`;
  const rangeResponse = await evaluate(cdpConnection, `(async () => {
    const response = await fetch(${JSON.stringify(mediaUrl)}, {
      cache: 'no-store',
      headers: { Range: 'bytes=0-31' },
    });
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      contentRange: response.headers.get('content-range'),
      bodyLength: body.byteLength,
    };
  })()`);
  if (rangeResponse.status !== 206) {
    const request = networkRequests.findLast((item) => item.url === mediaUrl);
    throw new Error(`Range request returned ${rangeResponse.status}, expected 206. Request: ${JSON.stringify(request)}`);
  }
  if (rangeResponse.contentRange !== expectedContentRange) {
    throw new Error(`Range request returned Content-Range ${rangeResponse.contentRange}, expected ${expectedContentRange}.`);
  }
  if (rangeResponse.bodyLength !== 32) {
    throw new Error(`Range request returned ${rangeResponse.bodyLength} bytes, expected 32.`);
  }
  return { ...rangeResponse, expectedContentRange };
}

async function exerciseSameUrlMissingRestore(cdpConnection, taskId, mediaPath) {
  const mediaUrl = await evaluate(cdpConnection, `window.storydream.getHtmlVideoMediaUrl(
    ${JSON.stringify(taskId)},
    ${JSON.stringify(mediaPath)}
  )`);
  const original = await readFile(mediaPath);
  let missing;
  try {
    await rm(mediaPath, { force: true });
    missing = await loadImageInRenderer(cdpConnection, mediaUrl);
  } finally {
    await writeFile(mediaPath, original);
  }
  const restored = await loadImageInRenderer(cdpConnection, mediaUrl);
  if (!(missing.event === 'error')) throw new Error('Missing media did not reach Image.onerror.');
  if (!(restored.event === 'load') || restored.width <= 0 || restored.height <= 0) {
    throw new Error('Restored media did not load at the same URL.');
  }
  return {
    restored: mediaUrl === missing.url && mediaUrl === restored.url,
    mediaUrl,
  };
}

function loadImageInRenderer(cdpConnection, mediaUrl) {
  return evaluate(cdpConnection, `(new Promise((resolve) => {
    const image = new Image();
    const timeout = setTimeout(() => resolve({ event: 'timeout', url: image.src, width: 0, height: 0 }), 10000);
    image.addEventListener('load', () => {
      clearTimeout(timeout);
      resolve({ event: 'load', url: image.src, width: image.naturalWidth, height: image.naturalHeight });
    }, { once: true });
    image.addEventListener('error', () => {
      clearTimeout(timeout);
      resolve({ event: 'error', url: image.src, width: 0, height: 0 });
    }, { once: true });
    image.src = ${JSON.stringify(mediaUrl)};
  }))`);
}

async function exerciseTaskAndPathSwitch(cdpConnection, seededTasks, primarySrc) {
  const selected = await evaluate(cdpConnection, `(() => {
    const select = document.querySelector('select[aria-label="切换 HTML 动画视频任务"]');
    if (!select) return false;
    select.value = ${JSON.stringify(seededTasks.secondary.id)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!selected) throw new Error('HTML video task selector was not found.');
  const secondaryOutput = await openOutputAndWait(cdpConnection, seededTasks.secondary);
  const returned = await evaluate(cdpConnection, `(() => {
    const select = document.querySelector('select[aria-label="切换 HTML 动画视频任务"]');
    if (!select) return false;
    select.value = ${JSON.stringify(seededTasks.primary.id)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!returned) throw new Error('Could not return to the primary HTML video task.');
  const restoredPrimaryOutput = await openOutputAndWait(cdpConnection, seededTasks.primary);
  return {
    taskSwitchObserved: selected && returned,
    pathSwitchObserved: secondaryOutput.src !== primarySrc && restoredPrimaryOutput.src === primarySrc,
    primarySrc,
    secondarySrc: secondaryOutput.src,
  };
}

async function exerciseMediaElementState(cdpConnection, options) {
  const { tabLabel, selector, failureText, successEvent } = options;
  const clicked = await clickTab(cdpConnection, tabLabel);
  if (!clicked) throw new Error(`Could not open the ${tabLabel} media tab.`);
  await waitFor(
    async () => evaluate(cdpConnection, `Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    10_000,
    `${tabLabel} media element`,
  );
  await waitFor(
    async () => evaluate(cdpConnection, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      return ${JSON.stringify(successEvent)} === 'load'
        ? Boolean(element.complete && element.naturalWidth > 0)
        : element.readyState >= 3;
    })()`),
    10_000,
    `${tabLabel} initial ready state`,
  );
  await delay(100);

  const firstMarker = `qa-first-${tabLabel}-${Date.now()}`;
  const errorDispatched = await evaluate(cdpConnection, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.dataset.qaMediaInstance = ${JSON.stringify(firstMarker)};
    const reactPropsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
    const handlerName = ${JSON.stringify(successEvent)} === 'load' ? 'onLoad' : 'onCanPlay';
    globalThis.__storydreamQaLateError = reactPropsKey ? element[reactPropsKey]?.onError : null;
    globalThis.__storydreamQaLateReady = reactPropsKey ? element[reactPropsKey]?.[handlerName] : null;
    element.pause?.();
    element.removeAttribute('src');
    element.load?.();
    element.dispatchEvent(new Event('error', { bubbles: true }));
    return typeof globalThis.__storydreamQaLateError === 'function'
      && typeof globalThis.__storydreamQaLateReady === 'function';
  })()`);
  if (!errorDispatched) throw new Error(`Could not capture and dispatch ${tabLabel} media handlers.`);
  await waitForFailureState(cdpConnection, selector, failureText, tabLabel);
  const errorObserved = true;

  if (!await clickMediaRetry(cdpConnection)) throw new Error(`Could not retry ${tabLabel}.`);
  await waitFor(
    async () => evaluate(cdpConnection, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return Boolean(element && element.dataset.qaMediaInstance !== ${JSON.stringify(firstMarker)});
    })()`),
    10_000,
    `${tabLabel} retry remount`,
  );
  const retryObserved = true;
  const secondError = await evaluate(cdpConnection, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.pause?.();
    element.removeAttribute('src');
    element.load?.();
    element.dispatchEvent(new Event('error', { bubbles: true }));
    return true;
  })()`);
  if (!secondError) throw new Error(`Could not dispatch second ${tabLabel} error.`);
  await waitForFailureState(cdpConnection, selector, failureText, `${tabLabel} second generation`);

  await evaluate(cdpConnection, `(() => {
    globalThis.__storydreamQaLateError?.({ type: 'error' });
    return true;
  })()`);
  await delay(100);
  const staleErrorIgnored = await evaluate(cdpConnection, `(() => {
    const panel = document.querySelector('#html-video-panel');
    return Boolean(panel?.textContent.includes(${JSON.stringify(failureText)})
      && !panel.querySelector(${JSON.stringify(selector)}));
  })()`);
  if (!staleErrorIgnored) throw new Error(`${tabLabel} stale error escaped its media scope.`);

  await evaluate(cdpConnection, `(() => {
    globalThis.__storydreamQaLateReady?.({ type: ${JSON.stringify(successEvent)} });
    return true;
  })()`);
  await delay(100);
  const staleReadyIgnored = await evaluate(cdpConnection, `(() => {
    const panel = document.querySelector('#html-video-panel');
    return Boolean(panel?.textContent.includes(${JSON.stringify(failureText)})
      && !panel.querySelector(${JSON.stringify(selector)}));
  })()`);

  if (!await clickMediaRetry(cdpConnection)) throw new Error(`Could not retry ${tabLabel} after stale readiness.`);
  await waitFor(
    async () => evaluate(cdpConnection, `Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    10_000,
    `${tabLabel} final remount`,
  );
  const readyDispatched = await evaluate(cdpConnection, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.dispatchEvent(new Event(${JSON.stringify(successEvent)}, { bubbles: true }));
    return true;
  })()`);
  if (!readyDispatched) throw new Error(`Could not dispatch ${successEvent} for ${tabLabel}.`);
  await waitFor(
    async () => evaluate(cdpConnection, `(() => {
      const panel = document.querySelector('#html-video-panel');
      return Boolean(panel?.querySelector(${JSON.stringify(selector)})
        && !panel.textContent.includes(${JSON.stringify(failureText)}));
    })()`),
    10_000,
    `${tabLabel} ready state`,
  );
  const readyObserved = true;
  return { errorObserved, retryObserved, staleErrorIgnored, staleReadyIgnored, readyObserved, successEvent };
}

function clickTab(cdpConnection, tabLabel) {
  return evaluate(cdpConnection, `(() => {
    const tab = [...document.querySelectorAll('.hv-tab')]
      .find((item) => item.textContent.trim() === ${JSON.stringify(tabLabel)});
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
}

function clickMediaRetry(cdpConnection) {
  return evaluate(cdpConnection, `(() => {
    const button = [...document.querySelectorAll('.hv-media-error button')]
      .find((item) => item.textContent.includes('重新加载媒体'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

function waitForFailureState(cdpConnection, selector, failureText, label) {
  return waitFor(
    async () => evaluate(cdpConnection, `(() => {
      const panel = document.querySelector('#html-video-panel');
      return Boolean(panel?.textContent.includes(${JSON.stringify(failureText)})
        && !panel.querySelector(${JSON.stringify(selector)}));
    })()`),
    10_000,
    `${label} failure state`,
  );
}

function isExpectedMissingMedia404(error, expectedMissingMediaUrl, expectedRequestIds) {
  return error.source === 'log'
    && error.message.includes('404')
    && error.url === expectedMissingMediaUrl
    && typeof error.requestId === 'string'
    && expectedRequestIds.has(error.requestId);
}

async function inspectPage(cdpConnection) {
  return evaluate(cdpConnection, `(() => {
    const isVisible = (item) => {
      const style = getComputedStyle(item);
      const rect = item.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const clippedControls = [...document.querySelectorAll('.hv-workspace button, .hv-config button, .hv-workspace select')]
      .filter((item) => isVisible(item))
      .filter((item) => {
        const rect = item.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      })
      .map((item) => item.textContent.trim() || item.getAttribute('aria-label') || item.tagName);
    const video = document.querySelector('.hv-video-output video');
    return {
      heading: document.querySelector('.hv-config h2')?.textContent.trim() || '',
      taskHeading: document.querySelector('.hv-workspace h3')?.textContent.trim() || '',
      stepCount: document.querySelectorAll('.hv-step').length,
      stepsCompleted: document.querySelectorAll('.hv-step').length === 6
        && document.querySelectorAll('.hv-step.done').length === 6
        && [...document.querySelectorAll('.hv-step small')].every((item) => item.textContent.includes('已完成')),
      activeTab: document.querySelector('.hv-tab.active')?.textContent.trim() || '',
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clippedControls,
      video: {
        visible: Boolean(video && isVisible(video)),
        readyState: video?.readyState ?? 0,
        currentTime: video?.currentTime ?? 0,
        src: video?.src || '',
      },
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`);
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const value = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(value));
    });
  });
}

async function waitForTarget(debugPort, process) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Electron exited before CDP connected (${process.exitCode}).\n${Buffer.concat(stderr).toString('utf8').slice(-4000)}`);
    }
    try {
      const targets = await withTimeout((async () => {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        return response.json();
      })(), Math.max(1, deadline - Date.now()), 'Electron CDP target discovery');
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // Electron has not opened the debugging endpoint yet.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Electron CDP.\n${Buffer.concat(stderr).toString('utf8').slice(-4000)}`);
}

function connectCdp(url, WebSocketConstructor) {
  return new Promise((resolveConnection, rejectConnection) => {
    const socket = new WebSocketConstructor(url);
    const pending = new Map();
    const listeners = new Map();
    let id = 0;
    let terminalError = null;
    let opened = false;
    const rejectPending = (error) => {
      for (const [operationId, operation] of pending) {
        pending.delete(operationId);
        clearTimeout(operation.timeout);
        operation.reject(error);
      }
    };
    const terminateCdp = (error) => {
      clearTimeout(connectTimeout);
      terminalError ??= error;
      rejectPending(terminalError);
      if (!opened) rejectConnection(terminalError);
    };
    const connectTimeout = setTimeout(() => {
      terminateCdp(new Error(`Timed out connecting to Electron CDP after ${CDP_CONNECT_TIMEOUT_MS}ms.`));
      try {
        socket.close();
      } catch {
        // The connection is already terminal.
      }
    }, CDP_CONNECT_TIMEOUT_MS);
    socket.addEventListener('error', (event) => {
      const error = event?.error instanceof Error ? event.error : new Error('Electron CDP WebSocket failed.');
      terminateCdp(error);
    });
    socket.addEventListener('close', (event) => {
      terminateCdp(new Error(`Electron CDP WebSocket closed (${event?.code ?? 'unknown'}).`));
    });
    socket.addEventListener('open', () => {
      if (terminalError) return;
      opened = true;
      clearTimeout(connectTimeout);
      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch (error) {
          terminateCdp(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (message.id !== undefined) {
          const operation = pending.get(message.id);
          if (!operation) return;
          pending.delete(message.id);
          clearTimeout(operation.timeout);
          if (message.error) operation.reject(new Error(message.error.message));
          else operation.resolve(message.result ?? {});
          return;
        }
        for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {});
      });
      resolveConnection({
        send(method, params = {}) {
          if (terminalError) return Promise.reject(terminalError);
          if (socket.readyState !== 1) {
            const error = new Error('Electron CDP WebSocket is not open.');
            terminateCdp(error);
            return Promise.reject(error);
          }
          return new Promise((resolveOperation, rejectOperation) => {
            const operationId = ++id;
            const timeout = setTimeout(() => {
              pending.delete(operationId);
              rejectOperation(new Error(`Timed out waiting for CDP command ${method} after ${CDP_COMMAND_TIMEOUT_MS}ms.`));
            }, CDP_COMMAND_TIMEOUT_MS);
            pending.set(operationId, { resolve: resolveOperation, reject: rejectOperation, timeout });
            try {
              socket.send(JSON.stringify({ id: operationId, method, params }));
            } catch (error) {
              terminateCdp(error instanceof Error ? error : new Error(String(error)));
            }
          });
        },
        on(method, listener) {
          listeners.set(method, [...(listeners.get(method) ?? []), listener]);
        },
        close() {
          const error = terminalError ?? new Error('Electron CDP connection was closed by the QA harness.');
          terminalError = error;
          rejectPending(error);
          listeners.clear();
          try {
            socket.close();
          } catch {
            // The connection is already terminal.
          }
        },
      });
    }, { once: true });
  });
}

async function evaluate(cdpConnection, expression, options = {}) {
  const response = await cdpConnection.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: options.userGesture === true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime.evaluate failed.');
  }
  return response.result?.value;
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const matched = await withTimeout(
      Promise.resolve().then(() => check()),
      Math.min(WAIT_FOR_CHECK_TIMEOUT_MS, remaining),
      `${label} check`,
    );
    if (matched) return;
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function withTimeout(operation, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function saveScreenshot(cdpConnection, path) {
  const result = await cdpConnection.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(path, Buffer.from(result.data, 'base64'));
}

function appendBounded(chunks, chunk) {
  chunks.push(Buffer.from(chunk));
  while (Buffer.concat(chunks).length > 1024 * 1024) chunks.shift();
}

async function stopChild(childProcess) {
  if (!childProcess || childProcess.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(childProcess.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    childProcess.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolveExit) => childProcess.once('close', resolveExit)),
    delay(5_000),
  ]);
}

async function removeWithRetry(path) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
