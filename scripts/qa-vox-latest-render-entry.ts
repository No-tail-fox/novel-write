import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { renderDirectorVideo } from '../electron/director-renderer';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { prepareEditorialNarrationForRender } from '../src/shared/editorial-narration-timing';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';

const { root, artifacts } = JSON.parse(process.env.STORYDREAM_VOX_LATEST_QA!);
const report: Record<string, unknown> = { status: 'running', externalCalls: 0, realSourceMedia: true, liveDatabaseModified: false,
  sourceProjectId: '1b36e516-3642-4af3-aea9-075ea6468b83', sourceProjectTitle: '今天要介绍的是——自我主义',
  latestProjectId: 'b22ec7e4-1a7d-4e0a-9d44-b30d28da8a2a', latestProjectHasMedia: false };
app.disableHardwareAcceleration();
app.setPath('userData', join(artifacts, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
globalThis.fetch = async () => { report.externalCalls = Number(report.externalCalls) + 1; throw new Error('Network prohibited in real-media audit'); };
let keepAlive: BrowserWindow;

async function run() {
  keepAlive = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let document = parseEditorialCollagePipelineData(await readFile(join(root, '.artifacts/vox-latest-media-20260916/project-1b36e516-3642-4af3-aea9-075ea6468b83.json'), 'utf8'));
  const firstBeat = document.beats[0];
  const shot = firstBeat.shots[0];
  document.beats = [{ ...firstBeat, shots: [shot], subtitleCues: firstBeat.subtitleCues.filter(cue => shot.subtitleCueIds.includes(cue.id)) }];
  if (document.timeline) document.timeline.audioClips = document.timeline.audioClips?.filter(clip => clip.shotId === shot.id);
  document = rebuildEditorialTimeline(document);
  document = await prepareEditorialNarrationForRender(document, async path => {
    const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: artifacts, media_path: path, measure_audio_duration: true });
    return Number(probe.audio_duration_ms);
  });
  const scenes = buildDirectorRenderScenes(document);
  assert.equal(scenes.length, 1);
  await writeFile(join(artifacts, 'isolated-shot.json'), JSON.stringify(document, null, 2), 'utf8');
  const render = await renderDirectorVideo({ workDir: join(artifacts, 'work'), projectTitle: '自我主义首镜头本地分层验证', modeLabel: 'VOX', ratio: document.ratio, scenes });
  report.render = { outputPath: render.outputPath, durationMs: render.durationMs, width: render.width, height: render.height, hasAudio: render.hasAudio, hasVideo: render.hasVideo };
  assert(render.hasAudio && render.hasVideo);
  const htmlDir = join(dirname(dirname(render.outputPath)), 'html-scenes');
  const html = (await readdir(htmlDir)).find(name => name.endsWith('.html'))!;
  const inspect = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } });
  const samples = [];
  try {
    await inspect.loadFile(join(htmlDir, html));
    for (const seconds of [.25, 1.4, 4, 8, 13]) {
      const sample = await inspect.webContents.executeJavaScript(`(async () => {
        await window.__tl.seek(${seconds}); await document.fonts.ready;
        return [...document.querySelectorAll('img.scene-layer')].map(img => { const r = img.getBoundingClientRect(); const c = getComputedStyle(img); return { src: img.getAttribute('src'), opacity: Number(c.opacity), transform: c.transform, x: r.x, y: r.y, width: r.width, height: r.height }; });
      })()`);
      assert.equal(sample.length, 2);
      await writeFile(join(artifacts, `frame-${String(seconds).replace('.', '-')}.png`), (await inspect.webContents.capturePage()).toPNG());
      samples.push({ seconds, layers: sample });
    }
  } finally { inspect.destroy(); }
  report.samples = samples;
  assert(samples[0].layers[1].opacity < .01);
  assert(samples[2].layers[1].opacity > .99);
  assert(Math.abs(samples[0].layers[1].x - samples[2].layers[1].x) > 1000);
  assert(Math.abs(samples[0].layers[0].x - samples[2].layers[0].x) < 100);
  report.sampleVideo = join(artifacts, 'selfism-real-shot-local-motion.mp4');
  await copyFile(render.outputPath, report.sampleVideo as string);
  assert.equal(report.externalCalls, 0);
  report.status = 'passed';
}
app.whenReady().then(run).catch(error => { report.status = 'failed'; report.error = String(error.stack ?? error); }).finally(async () => {
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  if (keepAlive && !keepAlive.isDestroyed()) keepAlive.destroy();
  app.exit(report.status === 'passed' ? 0 : 1);
});
