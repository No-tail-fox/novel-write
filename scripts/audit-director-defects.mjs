import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACTS = join(ROOT, '.artifacts', 'director-defect-audit-2026-08-18', 'after');
const AUDIT_TEMP = join(ROOT, '.codex-audit-temp');
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const USER_DATA = process.env.STORYDREAM_HISTORY_DATA_DIR || join(process.env.APPDATA || '', 'storydream', 'storydream');
const bundledModules = process.env.CODEX_BUNDLED_NODE_MODULES;
const require = bundledModules ? createRequire(join(bundledModules, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => server.listen(0, '127.0.0.1', accept).once('error', reject));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((accept) => server.close(accept));
  return port;
}

async function copyDatabase(profile) {
  const targetDir = join(profile, 'storydream');
  await mkdir(targetDir, { recursive: true });
  const copied = [];
  for (const name of ['data.db', 'data.db-wal', 'data.db-shm']) {
    const source = join(USER_DATA, name);
    try {
      const info = await stat(source);
      await copyFile(source, join(targetDir, name));
      copied.push({ name, bytes: info.size });
    } catch (error) {
      if (name === 'data.db') throw error;
    }
  }
  return copied;
}

async function writeFixtureWav(path, durationMs = 1200) {
  const sampleRate = 16_000;
  const frames = Math.round(sampleRate * durationMs / 1000);
  const payload = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    const envelope = Math.min(1, index / 400, (frames - index) / 400);
    payload.writeInt16LE(Math.round(Math.sin(index * 330 * Math.PI * 2 / sampleRate) * envelope * 3500), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + payload.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(payload.length, 40);
  await writeFile(path, Buffer.concat([header, payload]));
}

async function waitForCdp(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited before CDP was ready: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // The endpoint appears after Electron creates the renderer.
    }
    await new Promise((accept) => setTimeout(accept, 150));
  }
  throw new Error('Electron CDP endpoint did not become ready.');
}

async function waitForApp(page) {
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(250);
}

async function waitForPreview(page) {
  await page.locator('.director-media-preview').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.director-media-preview img').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.director-media-preview img');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }, undefined, { timeout: 20_000 });
}

async function capture(page, name) {
  await page.waitForTimeout(250);
  const path = join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

async function inspectWorkbench(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, clientHeight: element.clientHeight };
    };
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
    const providerLabel = [...document.querySelectorAll('label')].find((label) => label.textContent?.trim() === '生成服务');
    const provider = providerLabel?.htmlFor ? document.getElementById(providerLabel.htmlFor) : providerLabel?.parentElement?.querySelector('select');
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const clippedFixed = [...document.querySelectorAll('.director-desk-header button, .director-preview-transport button, .director-preview-transport input')]
      .filter(visible).map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, clipped: rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight };
      }).filter((item) => item.clipped);
    const preview = document.querySelector('.director-media-preview');
    const previewRect = preview?.getBoundingClientRect();
    const title = document.querySelector('.director-preview-title');
    const caption = document.querySelector('.director-preview-caption');
    const titleRect = title?.getBoundingClientRect();
    const captionRect = caption?.getBoundingClientRect();
    const overlaps = Boolean(titleRect && captionRect && titleRect.bottom > captionRect.top && titleRect.top < captionRect.bottom);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      title: text('.director-project-menu strong, .director-project-crumb strong'),
      titleBox: box('.director-project-menu strong, .director-project-crumb strong'),
      previewTitle: text('.director-preview-title'),
      previewTitleBox: box('.director-preview-title'),
      previewCaption: text('.director-preview-caption'),
      previewCaptionBox: box('.director-preview-caption'),
      previewBox: box('.director-media-preview'),
      previewTextOverlaps: overlaps,
      assetSearchBox: box('.director-asset-search'),
      assetTabsBox: box('.director-asset-tabs'),
      timecode: text('.director-timecode'),
      hasSeekControl: Boolean(document.querySelector('input[type="range"], [role="slider"]')),
      provider: provider instanceof HTMLSelectElement ? {
        value: provider.value,
        disabled: provider.disabled,
        options: [...provider.options].map((option) => ({ value: option.value, label: option.textContent?.trim() || '', disabled: option.disabled })),
      } : null,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clippedFixed,
      errors: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()).filter(Boolean),
    };
  });
}

async function openRoute(page, route) {
  const selector = route === 'vox' ? '[data-editorial-collage-workbench="true"]' : '[data-motion-comic-workbench="true"]';
  if (await page.locator(selector).isVisible().catch(() => false)) return;
  const tabName = route === 'vox' ? 'VOX 视频' : 'AI 漫剧';
  const tabs = page.getByRole('tab', { name: tabName, exact: true });
  if (await tabs.count()) {
    await tabs.click();
  } else {
    const buttonName = route === 'vox' ? 'VOX 视觉导演' : 'AI 漫剧';
    const buttons = page.getByRole('button', { name: buttonName, exact: true });
    const count = await buttons.count();
    if (count === 0) throw new Error(`Route button not found: ${buttonName}`);
    await buttons.last().click();
  }
  await page.locator(selector).waitFor({ state: 'visible', timeout: 15_000 });
  const createPanel = page.locator('.director-create-panel');
  if (await createPanel.isVisible().catch(() => false)) {
    if (route === 'vox') {
      await page.getByRole('textbox', { name: '项目标题' }).fill('VOX 屏幕复审项目');
      await page.getByRole('textbox', { name: '原始文案' }).fill('第一镜交代地点。第二镜展示变化。第三镜补充证据。第四镜完成结论。');
      await page.getByRole('button', { name: '创建 30 秒结构', exact: true }).click();
    } else {
      await page.getByRole('textbox', { name: '系列名称' }).fill('AI 漫剧屏幕复审');
      await page.getByRole('textbox', { name: '核心设定' }).fill('雨夜来信，主角在旧城收到一封改变命运的信。');
      await page.getByRole('button', { name: '创建系列骨架', exact: true }).click();
    }
  }
  await waitForPreview(page);
}

async function addIsolatedProvider(page) {
  return page.evaluate(async () => {
    const state = await window.storydream.getBootstrap();
    const source = state.config.imageProfiles?.[0];
    if (!source) throw new Error('No image profile available for isolated provider audit.');
    const id = 'qa-secondary-image-profile';
    const profile = {
      ...source,
      id,
      name: 'QA 第二图片服务',
      enabled: false,
      provider: 'gpt_image',
      gptImage: { ...state.config.gptImage, apiKey: '', baseUrl: 'https://qa.invalid/v1', model: 'qa-image-model', resolution: '2K' },
    };
    const config = {
      ...state.config,
      imageProfiles: [...(state.config.imageProfiles ?? []).filter((candidate) => candidate.id !== id), profile],
      activeImageProfileId: state.config.activeImageProfileId,
    };
    await window.storydream.saveConfig({ config, secretChanges: { [`image/${id}/gptImage/apiKey`]: 'qa-local-only-key' } });
    return { id, profileCount: config.imageProfiles.length };
  });
}

async function selectAndReloadProvider(page, providerId) {
  const select = page.getByLabel('生成服务', { exact: true });
  await select.selectOption(providerId);
  await page.waitForFunction((id) => {
    const label = [...document.querySelectorAll('label')].find((item) => item.textContent?.trim() === '生成服务');
    const element = label?.htmlFor ? document.getElementById(label.htmlFor) : label?.parentElement?.querySelector('select');
    return element instanceof HTMLSelectElement && element.value === id;
  }, providerId, { timeout: 15_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  if (!(await page.locator('[data-editorial-collage-workbench="true"] .director-media-preview').isVisible().catch(() => false))) {
    await openRoute(page, 'vox');
  }
  await waitForPreview(page);
  return page.evaluate((id) => {
    const label = [...document.querySelectorAll('label')].find((item) => item.textContent?.trim() === '生成服务');
    const element = label?.htmlFor ? document.getElementById(label.htmlFor) : label?.parentElement?.querySelector('select');
    return element instanceof HTMLSelectElement ? { value: element.value, options: element.options.length, selected: element.value === id, disabled: element.disabled } : null;
  }, providerId);
}

async function exercisePlayback(page) {
  const slider = page.getByRole('slider', { name: '播放进度' });
  const before = await slider.inputValue();
  await page.getByRole('button', { name: '播放', exact: true }).first().click();
  await page.waitForTimeout(650);
  const playing = await slider.inputValue();
  await page.getByRole('button', { name: '暂停', exact: true }).first().click();
  const paused = await slider.inputValue();
  await page.waitForTimeout(500);
  const pausedAfter = await slider.inputValue();
  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error('Playback slider has no visible bounding box.');
  await slider.click({ position: { x: Math.max(2, bounds.width * 0.62), y: bounds.height / 2 } });
  const dragged = await slider.inputValue();
  const shotRows = page.locator('.director-shot-row');
  if (await shotRows.count() < 2) throw new Error('Playback boundary audit needs at least two shots.');
  await shotRows.nth(1).click();
  const secondShot = await slider.inputValue();
  const timecode = await page.locator('.director-timecode').innerText();
  if (Number(playing) <= Number(before) || paused !== pausedAfter || Number(dragged) <= Number(paused) || Number(secondShot) <= 0) {
    throw new Error(`Playback interaction failed: ${JSON.stringify({ before, playing, paused, pausedAfter, dragged, secondShot })}`);
  }
  if (!/^\d{2}:\d{2} \/ \d{2}:\d{2}$/.test(timecode)) throw new Error(`Unexpected timecode format: ${timecode}`);
  return { before, playing, paused, pausedAfter, dragged, secondShot, timecode };
}

async function captureRoute(page, route, viewport, name, report) {
  await page.setViewportSize(viewport);
  await waitForPreview(page);
  const inspection = await inspectWorkbench(page);
  if (inspection.horizontalOverflow > 0 || inspection.clippedFixed.length > 0 || inspection.previewTextOverlaps || !inspection.hasSeekControl) {
    throw new Error(`Visual contract failed for ${name}: ${JSON.stringify(inspection)}`);
  }
  report.captures.push({ name, path: await capture(page, name), inspection });
}

async function prepareRenderProject(page, imagePath, audioPath) {
  await page.getByRole('button', { name: '新建 VOX 项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目标题' }).fill('VOX 本地视频播放验收');
  await page.getByRole('textbox', { name: '原始文案' }).fill('第一镜交代地点。第二镜展示变化。第三镜补充证据。第四镜完成结论。');
  await page.getByRole('button', { name: '创建 30 秒结构', exact: true }).click();
  await waitForPreview(page);
  const task = await page.evaluate(async () => {
    const list = await window.storydream.listTasks({ taskType: 'editorial-collage', limit: 50 });
    const summary = list.items.find((item) => item.name === 'VOX 本地视频播放验收') ?? list.items[0];
    return summary ? window.storydream.getTaskDetail(summary.id) : null;
  });
  if (!task) throw new Error('Render fixture project could not be reloaded.');
  const prepared = await page.evaluate(async ({ id, imagePath: fixtureImage, audioPath: fixtureAudio }) => {
    const current = await window.storydream.getTaskDetail(id);
    if (!current) throw new Error('Render fixture project disappeared.');
    const document = JSON.parse(current.pipelineData);
    const createdAt = new Date().toISOString();
    const imageAssetId = 'director-audit-image-v1';
    const audioAssetId = 'director-audit-audio-v1';
    let offsetMs = 0;
    document.assets = [
      ...document.assets.filter((asset) => asset.id !== imageAssetId && asset.id !== audioAssetId),
      { id: imageAssetId, assetId: 'director-audit-image', kind: 'image', localPath: fixtureImage, createdAt, selected: true, pinned: true },
      { id: audioAssetId, assetId: 'director-audit-audio', kind: 'audio', localPath: fixtureAudio, createdAt, selected: true, pinned: true },
    ];
    document.beats = document.beats.map((beat) => {
      const startMs = offsetMs;
      const durationMs = 900;
      offsetMs += durationMs;
      return {
        ...beat,
        startMs,
        durationMs,
        subtitleCues: beat.subtitleCues.map((cue, index, cues) => ({ ...cue, startMs: Math.round(startMs + durationMs * index / cues.length), endMs: Math.round(startMs + durationMs * (index + 1) / cues.length) })),
        shots: beat.shots.map((shot) => ({
          ...shot,
          durationMs,
          voiceAssetVersionId: audioAssetId,
          camera: shot.camera.map((frame) => ({ ...frame, atMs: Math.min(frame.atMs, durationMs) })),
          layers: shot.layers.map((layer, index) => ({ ...layer, ...(index === 0 ? { assetVersionId: imageAssetId } : {}), motion: layer.motion.map((frame) => ({ ...frame, atMs: Math.min(frame.atMs, durationMs) })) })),
        })),
      };
    });
    document.timeline = {
      durationMs: offsetMs,
      clips: document.beats.flatMap((beat) => beat.shots.map((shot) => ({ id: `clip-${shot.id}`, shotId: shot.id, startMs: beat.startMs, durationMs: shot.durationMs, assetVersionIds: [imageAssetId], subtitleCueIds: shot.subtitleCueIds, source: 'deterministic' }))),
      audioAssetVersionIds: [audioAssetId],
    };
    await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
    return { id, durationMs: offsetMs, shots: document.beats.length };
  }, { id: task.id, imagePath, audioPath });
  if (!prepared || prepared.shots < 2) throw new Error('Render fixture did not persist enough shots.');
  return task.id;
}

async function renderAndExerciseVideo(page, taskId, report) {
  await page.getByRole('button', { name: '生成成片', exact: true }).click();
  await page.locator('video[aria-label$="成片预览"]').waitFor({ state: 'visible', timeout: 180_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label$="成片预览"]');
    return video instanceof HTMLVideoElement && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0;
  }, undefined, { timeout: 60_000 });
  const video = page.locator('video[aria-label$="成片预览"]');
  const media = await video.evaluate((element) => ({ readyState: element.readyState, duration: element.duration, paused: element.paused, src: element.currentSrc }));
  const played = await video.evaluate(async (element) => {
    const item = element;
    const samples = [item.currentTime];
    let playError = '';
    try { await item.play(); } catch (error) { playError = String(error); }
    const playResolved = !item.paused;
    const deadline = performance.now() + 1800;
    while (performance.now() < deadline && samples[samples.length - 1] <= 0.02) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      samples.push(item.currentTime);
    }
    const currentTime = item.currentTime;
    item.pause();
    const pausedAt = item.currentTime;
    item.currentTime = Math.min(item.duration * 0.7, Math.max(0.1, item.duration - 0.1));
    await new Promise((resolve) => { item.addEventListener('seeked', resolve, { once: true }); });
    return { samples, playError, playResolved, currentTime, pausedAt, seekedTime: item.currentTime, paused: item.paused };
  });
  if (played.playError || !played.playResolved || played.currentTime <= 0 || played.seekedTime <= played.currentTime || !played.paused) throw new Error(`Native video interaction failed: ${JSON.stringify(played)}`);
  const persisted = await page.evaluate(async (id) => {
    const task = await window.storydream.getTaskDetail(id);
    const document = task ? JSON.parse(task.pipelineData) : null;
    const output = document?.assets?.find((asset) => asset.assetId === 'director-final-video' && asset.selected);
    return { stage: document?.stage, outputs: document?.assets?.filter((asset) => asset.assetId === 'director-final-video' && asset.selected).length ?? 0, outputPath: output?.localPath || '' };
  }, taskId);
  if (persisted.stage !== 'completed' || persisted.outputs !== 1) throw new Error(`Rendered video state did not persist: ${JSON.stringify(persisted)}`);
  const evidencePath = join(ARTIFACTS, 'director-rendered-video.mp4');
  if (persisted.outputPath) await copyFile(persisted.outputPath, evidencePath);
  report.video = { media, played, persisted: { ...persisted, evidencePath } };
}

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(AUDIT_TEMP, { recursive: true });
  const profile = join(AUDIT_TEMP, `director-defects-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const fixtureImage = join(ARTIFACTS, 'fixture-frame.png');
  const fixtureAudio = join(ARTIFACTS, 'fixture-voice.wav');
  await copyFile(join(ROOT, 'src', 'assets', 'director-desk', 'preview-city.png'), fixtureImage);
  await writeFixtureWav(fixtureAudio);
  const report = { status: 'running', copiedDatabase: [], runtimeErrors: [], captures: [], playback: {}, provider: {}, navigation: {}, video: null };
  let child;
  let browser;
  try {
    report.copiedDatabase = await copyDatabase(profile);
    const port = await freePort();
    const environment = { ...process.env, NODE_ENV: 'production' };
    delete environment.VITE_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    child = spawn(ELECTRON, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', `--user-data-dir=${profile}`, ROOT], { cwd: ROOT, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const endpoint = await waitForCdp(port, child);
    browser = await chromium.connectOverCDP(endpoint);
    const page = browser.contexts()[0].pages()[0];
    page.on('pageerror', (error) => report.runtimeErrors.push({ type: 'pageerror', message: String(error) }));
    page.on('console', (message) => { if (message.type() === 'error') report.runtimeErrors.push({ type: 'console', message: message.text() }); });
    await waitForApp(page);

    await openRoute(page, 'vox');
    const isolatedProvider = await addIsolatedProvider(page);
    report.provider = { ...isolatedProvider, selected: await selectAndReloadProvider(page, isolatedProvider.id) };
    await captureRoute(page, 'vox', { width: 1320, height: 860 }, '01-vox-1320x860', report);
    report.playback = await exercisePlayback(page);
    await captureRoute(page, 'vox', { width: 1536, height: 1024 }, '02-vox-1536x1024', report);
    await captureRoute(page, 'vox', { width: 1040, height: 720 }, '03-vox-1040x720', report);

    await openRoute(page, 'motion-comic');
    await captureRoute(page, 'motion-comic', { width: 1536, height: 1024 }, '04-ai-comic-1536x1024', report);
    await captureRoute(page, 'motion-comic', { width: 1320, height: 860 }, '05-ai-comic-1320x860', report);
    await captureRoute(page, 'motion-comic', { width: 1040, height: 720 }, '06-ai-comic-1040x720', report);

    await page.evaluate(() => { window.__directorNavigationFrames = []; const start = performance.now(); const sample = () => { const content = document.querySelector('.content'); window.__directorNavigationFrames.push({ t: Math.round(performance.now() - start), desk: Boolean(document.querySelector('.director-desk')), sidebar: Boolean(document.querySelector('.sidebar')), saving: (content?.textContent || '').includes('保存中'), bodyBg: getComputedStyle(document.body).backgroundColor }); if (performance.now() - start < 900) requestAnimationFrame(sample); }; requestAnimationFrame(sample); });
    await page.getByRole('button', { name: '返回工作流列表', exact: true }).first().click();
    report.navigation.immediateCapture = await capture(page, '07-return-immediate');
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(1000);
    report.navigation.frames = await page.evaluate(() => window.__directorNavigationFrames || []);
    report.navigation.savingFrames = report.navigation.frames.filter((frame) => frame.saving).length;
    report.navigation.ready = true;
    if (report.navigation.savingFrames > 0) throw new Error(`Return path exposed saving frames: ${report.navigation.savingFrames}`);
    report.navigation.readyCapture = await capture(page, '08-return-ready');

    await openRoute(page, 'vox');
    const taskId = await prepareRenderProject(page, fixtureImage, fixtureAudio);
    await renderAndExerciseVideo(page, taskId, report);
    report.videoCapture = await capture(page, '09-vox-rendered-video');
    report.status = report.runtimeErrors.length ? 'runtime-errors' : 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = `${error?.name || 'Error'}: ${error?.message || error}`;
    throw error;
  } finally {
    await writeFile(join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    await browser?.close().catch(() => undefined);
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((accept) => child.once('exit', accept));
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { await rm(profile, { recursive: true, force: true }); break; } catch (error) { if (attempt === 3) throw error; await new Promise((accept) => setTimeout(accept, 250 * (attempt + 1))); }
    }
  }
}

await main();
