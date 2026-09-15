import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderDirectorVideo } from '../electron/director-renderer';
import { createEditorialMotionLayers } from '../src/shared/editorial-motion';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { createEditorialCollageDraft, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { setDefaultPythonRuntimeAppRoot, resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { runBoundedProcess } from '../src/shared/process-runner';

const { root, artifacts } = JSON.parse(process.env.STORYDREAM_VOX_LOCAL_QA!);
const workDir = join(artifacts, 'work');
const label = '一张咖啡桌，改变一座城';
const report: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString(), externalCalls: 0, syntheticMediaOnly: true };
let keepAlive: BrowserWindow;
app.disableHardwareAcceleration();
app.setPath('userData', join(artifacts, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
globalThis.fetch = async () => { report.externalCalls = Number(report.externalCalls) + 1; throw new Error('No network in local VOX QA'); };

async function python(mode: string, ...args: string[]) {
  const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, [join(root, 'scripts', 'qa-vox-local-motion-media.py'), mode, artifacts, ...args], {
    cwd: root, timeoutMs: 90_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 2 * 1024 * 1024,
  });
  if (result.code !== 0) throw new Error(`${mode}: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

async function run() {
  await mkdir(workDir, { recursive: true });
  keepAlive = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  report.source = await python('create');
  const document = createEditorialCollageDraft({ id: 'isolated-local-motion', title: '独立图层动画验收', ratio: '16:9' });
  const layers = createEditorialMotionLayers({ shotId: 'shot-1', narration: '咖啡馆改变城市的公共生活', title: label, durationMs: 4000, ratio: '16:9', index: 0 });
  for (const layer of layers.filter((item) => !item.content)) {
    layer.assetVersionId = `${layer.id}-asset`;
    document.assets.push({ id: layer.assetVersionId, assetId: layer.id, kind: 'image', localPath: join(artifacts, layer.kind === 'background' ? 'background.png' : 'cutout.png'), createdAt: document.createdAt });
  }
  document.assets.push({ id: 'tone', assetId: 'tone', kind: 'audio', localPath: join(artifacts, 'tone.wav'), createdAt: document.createdAt });
  document.beats = [{ id: 'beat-1', index: 1, title: '咖啡馆与公共生活', narration: '主体先入场，标签后出现。', startMs: 0, durationMs: 4000,
    subtitleCues: [{ id: 'cue-1', startMs: 0, endMs: 4000, text: '主体先入场，标签后出现。', shotId: 'shot-1' }],
    shots: [{ id: 'shot-1', beatId: 'beat-1', durationMs: 4000, renderStrategy: 'deterministic-layers', scenePrompt: 'Synthetic paper coffee cup', motionPrompt: 'Enter, settle, hold and exit', layers,
      camera: [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }, { atMs: 4000, x: 0.5, y: 0.49, zoom: 1.025 }],
      subtitleCueIds: ['cue-1'], voiceAssetVersionId: 'tone' }],
  }];
  const prepared = rebuildEditorialTimeline(document);
  await writeFile(join(artifacts, 'synthetic-project.json'), JSON.stringify(prepared, null, 2), 'utf8');
  report.render = await renderDirectorVideo({ workDir, projectTitle: prepared.title, modeLabel: 'VOX', ratio: prepared.ratio, scenes: buildDirectorRenderScenes(prepared) });
  const render = report.render as { outputPath: string; width: number; height: number; durationMs: number; hasAudio: boolean; hasVideo: boolean };
  assert.equal(render.width, 1920); assert.equal(render.height, 1080); assert(Math.abs(render.durationMs - 4000) <= 100);
  assert(render.hasAudio && render.hasVideo);
  const renderRoot = dirname(dirname(render.outputPath));
  const htmlNames = (await readdir(join(renderRoot, 'html-scenes'))).filter((name) => name.endsWith('.html'));
  assert.equal(htmlNames.length, 1);
  const htmlPath = join(renderRoot, 'html-scenes', htmlNames[0]);
  const html = await readFile(htmlPath, 'utf8');
  assert(html.includes('scene-native-text') && html.includes('scene-cutout'));
  const inspect = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await inspect.loadFile(htmlPath);
    report.text = await inspect.webContents.executeJavaScript(`(async () => {
      await window.__tl.seek(1.6);
      await document.fonts.ready;
      const text = document.querySelector('.scene-native-text svg text');
      const svg = text.closest('svg');
      const box = text.getBBox();
      const view = svg.viewBox.baseVal;
      return { text: text.textContent, ariaLabel: svg.getAttribute('aria-label'), font: getComputedStyle(text).fontFamily,
        fits: box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        videoElements: document.querySelectorAll('video').length, imageLayers: document.querySelectorAll('img.scene-layer').length };
    })()`);
  } finally { inspect.destroy(); }
  assert.equal((report.text as { text: string }).text, label);
  assert.equal((report.text as { ariaLabel: string }).ariaLabel, label);
  assert.equal((report.text as { fits: boolean }).fits, true);
  assert.equal((report.text as { videoElements: number }).videoElements, 0);
  assert.equal((report.text as { imageLayers: number }).imageLayers, 2);
  report.measurements = await python('verify', render.outputPath);
  report.sampleVideo = join(artifacts, 'vox-local-motion.mp4');
  await copyFile(render.outputPath, report.sampleVideo as string);
  assert.equal(report.externalCalls, 0);
  report.status = 'passed';
}

app.whenReady().then(run).catch((error) => { report.status = 'failed'; report.error = error?.stack ?? String(error); }).finally(async () => {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  if (keepAlive && !keepAlive.isDestroyed()) keepAlive.destroy();
  app.exit(report.status === 'passed' ? 0 : 1);
});
