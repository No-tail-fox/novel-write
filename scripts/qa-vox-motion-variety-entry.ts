import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderDirectorVideo } from '../electron/director-renderer';
import { createEditorialMotionLayers, editorialMotionDescription, type EditorialMotionStyle } from '../src/shared/editorial-motion';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { createEditorialCollageDraft, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { setDefaultPythonRuntimeAppRoot, resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { runBoundedProcess } from '../src/shared/process-runner';

const { root, artifacts } = JSON.parse(process.env.STORYDREAM_VOX_VARIETY_QA!);
const report: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString(), externalCalls: 0, syntheticMediaOnly: true };
const durationMs = 2500;
const specs: Array<{ style: EditorialMotionStyle; title: string; narration: string; actors: string[] }> = [
  { style: 'cutout-slide', title: '咖啡馆连接城市', narration: '一杯咖啡，带来了公共交流的空间。', actors: ['coffee'] },
  { style: 'focus-reveal', title: '茶馆里的公共空间', narration: '茶馆的关键，在于人们能够聚在一起。', actors: ['teapot'] },
  { style: 'comparison', title: '咖啡与茶的相遇', narration: '一边是咖啡，另一边是茶壶。', actors: ['coffee', 'teapot'] },
  { style: 'path-progress', title: '报纸走进街巷', narration: '报纸随后传入各地的咖啡馆。', actors: ['newspaper'] },
  { style: 'evidence-stack', title: '档案记录街道变迁', narration: '老照片记录了街道。档案保存了建筑图纸。', actors: ['photo', 'blueprint'] },
];
let keepAlive: BrowserWindow;
app.disableHardwareAcceleration();
app.setPath('userData', join(artifacts, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
globalThis.fetch = async () => { report.externalCalls = Number(report.externalCalls) + 1; throw new Error('No network in local VOX QA'); };
async function python(mode: string, ...args: string[]) {
  const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, [join(root, 'scripts', 'qa-vox-motion-variety-media.py'), mode, artifacts, ...args], { cwd: root, timeoutMs: 120_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 2 * 1024 * 1024 });
  if (result.code !== 0) throw new Error(`${mode}: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim());
}
async function run() {
  await mkdir(join(artifacts, 'work'), { recursive: true });
  keepAlive = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  report.source = await python('create');
  const document = createEditorialCollageDraft({ id: 'isolated-motion-variety', title: '城市公共生活：五种动画验收', ratio: '16:9' });
  document.assets.push({ id: 'tone', assetId: 'tone', kind: 'audio', localPath: join(artifacts, 'tone.wav'), createdAt: document.createdAt });
  document.beats = specs.map((spec, index) => {
    const shotId = `shot-${index + 1}`;
    const beatId = `beat-${index + 1}`;
    const cueId = `cue-${index + 1}`;
    const layers = createEditorialMotionLayers({ shotId, ...spec, motionStyle: spec.style, durationMs, ratio: '16:9', index });
    let actorIndex = 0;
    for (const layer of layers.filter((item) => !item.content)) {
      layer.assetVersionId = `${layer.id}-asset`;
      const filename = layer.kind === 'background' ? `background-${index}.png` : `${spec.actors[actorIndex++]}.png`;
      assert(filename !== 'undefined.png');
      document.assets.push({ id: layer.assetVersionId, assetId: layer.id, kind: 'image', localPath: join(artifacts, filename), createdAt: document.createdAt });
    }
    return { id: beatId, index: index + 1, title: spec.title, narration: spec.narration, startMs: index * durationMs, durationMs,
      subtitleCues: [{ id: cueId, startMs: index * durationMs, endMs: (index + 1) * durationMs, text: spec.narration, shotId }],
      shots: [{ id: shotId, beatId, title: spec.title, motionStyle: spec.style, durationMs, renderStrategy: 'deterministic-layers' as const, scenePrompt: spec.narration, motionPrompt: editorialMotionDescription(spec.style), layers,
        camera: [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }, { atMs: durationMs, x: 0.5, y: 0.5, zoom: 1 }], subtitleCueIds: [cueId], voiceAssetVersionId: 'tone' }] };
  });
  const prepared = rebuildEditorialTimeline(document);
  const scenes = buildDirectorRenderScenes(prepared);
  assert.equal(scenes.length, 5);
  await writeFile(join(artifacts, 'synthetic-project.json'), JSON.stringify(prepared, null, 2), 'utf8');
  report.render = await renderDirectorVideo({ workDir: join(artifacts, 'work'), projectTitle: prepared.title, modeLabel: 'VOX', ratio: prepared.ratio, scenes });
  const render = report.render as { outputPath: string; width: number; height: number; durationMs: number; hasAudio: boolean; hasVideo: boolean };
  assert.equal(render.width, 1920); assert.equal(render.height, 1080); assert(Math.abs(render.durationMs - 12_500) <= 100); assert(render.hasAudio && render.hasVideo);
  const htmlDir = join(dirname(dirname(render.outputPath)), 'html-scenes');
  const htmlNames = (await readdir(htmlDir)).filter((name) => name.endsWith('.html')).sort();
  assert.equal(htmlNames.length, 5);
  const sceneChecks = [];
  const inspect = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } });
  try {
    for (let index = 0; index < htmlNames.length; index++) {
      await inspect.loadFile(join(htmlDir, htmlNames[index]));
      const check = await inspect.webContents.executeJavaScript(`(async () => {
        await window.__tl.seek(1.75); await document.fonts.ready;
        const labels = [...document.querySelectorAll('.scene-native-text svg')].map(svg => svg.getAttribute('aria-label'));
        return { labels, bodyText: document.body.innerText, metaCount: document.querySelectorAll('.meta').length, titleCount: document.querySelectorAll('.title').length,
          videoElements: document.querySelectorAll('video').length, imageLayers: document.querySelectorAll('img.scene-layer').length,
          fits: [...document.querySelectorAll('.scene-native-text svg text')].every(text => { const box = text.getBBox(); const view = text.closest('svg').viewBox.baseVal; return box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height; }) };
      })()`);
      assert.equal(check.metaCount, 0); assert.equal(check.titleCount, 0);
      assert.equal(check.labels.filter((label: string) => label === specs[index].title).length, 1);
      assert(!check.labels.some((label: string) => /^(钩子|背景|证据|结论)(?:\s*\d+)?$/.test(label)));
      assert(!/VOX\s*SHOT|SHOT\s*\d/.test(check.bodyText));
      assert.equal(check.videoElements, 0); assert.equal(check.fits, true);
      await writeFile(join(artifacts, `scene-${index + 1}-electron.png`), (await inspect.webContents.capturePage()).toPNG());
      sceneChecks.push({ style: specs[index].style, ...check });
    }
  } finally { inspect.destroy(); }
  report.sceneChecks = sceneChecks;
  report.measurements = await python('verify', render.outputPath);
  report.sampleVideo = join(artifacts, 'vox-five-motion-styles.mp4');
  await copyFile(render.outputPath, report.sampleVideo as string);
  assert.equal(report.externalCalls, 0);
  report.status = 'passed';
}
app.whenReady().then(run).catch((error) => { report.status = 'failed'; report.error = error?.stack ?? String(error); }).finally(async () => {
  report.finishedAt = new Date().toISOString(); await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  if (keepAlive && !keepAlive.isDestroyed()) keepAlive.destroy(); app.exit(report.status === 'passed' ? 0 : 1);
});
