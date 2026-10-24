/** Offline real-media acceptance for the shared cutout and both render chains. */
import { app, BrowserWindow } from 'electron';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { removeImageBackground } from '../electron/background-removal';
import { buildHtmlVideoExportInput } from '../src/shared/html-video';
import { createElectronHtmlVideoRenderer } from '../electron/html-video-renderer';
import { renderDirectorVideo } from '../electron/director-renderer';
import { createEditorialMotionLayers } from '../src/shared/editorial-motion';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS } from '../src/shared/html-video-captions';
import type { PipelineArtifact } from '../src/shared/types';

const root = resolve(process.cwd());
const workDir = join(root, '.artifacts/cutout-stage-a');
app.disableHardwareAcceleration();
app.setPath('userData', join(workDir, 'electron-profile'));
setDefaultPythonRuntimeAppRoot(root);
app.on('window-all-closed', () => {});
async function run() {
const keepAlive = new BrowserWindow({ show: false });
try {
  await mkdir(workDir, { recursive: true });
  const storyData = join(process.env.APPDATA!, 'storydream/storydream');
  const source = join(storyData, 'tasks/1f730bce917108cec8d0ff5ceea0527a49216b4c990582da/provider-images/001.png');
  const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
  const foreground = join(workDir, 'natural-person-shared.png');
  const options = { method: 'onnx' as const, modelDirectory: join(storyData, 'models'), workerPath: join(root, 'src/shared/remove-background-worker.py') };
  if (process.env.CUTOUT_QA_FIXTURES === '1') {
    const paper = await removeImageBackground(join(workDir, 'derived-paper-hole-source.png'), join(workDir, 'derived-paper-hole.png'), { ...options, method: 'green-key' });
    const cardigan = await removeImageBackground(join(workDir, 'derived-green-cardigan-source.png'), join(workDir, 'derived-green-cardigan.png'), options);
    await writeFile(join(workDir, 'fixture-report.json'), JSON.stringify({ paper, cardigan, provenance: 'derived fixtures using existing real image pixels; not natural green clothing or paper photography' }, null, 2), 'utf8');
    keepAlive.destroy(); app.exit(0); return;
  }
  console.log('cutout: natural person');
  const metadata = await removeImageBackground(source, foreground, options);
  if (metadata.quality !== 'passed') throw new Error('Person alpha preflight failed');
  const greenSource = join(storyData, 'tasks/98ec4d43-3ef3-4af0-b14c-0cdd4753e595/provider-images/001.png');
  const greenOutput = join(workDir, 'green-clothing.png');
  console.log('cutout: coat and paper');
  const green = await removeImageBackground(greenSource, greenOutput, options);
  const nativeOutput = join(workDir, 'native-reused.png');
  const native = await removeImageBackground(foreground, nativeOutput, { ...options, modelDirectory: join(workDir, 'intentionally-no-model'), workerPath: 'intentionally-no-worker' });
  if (native.outputSha256 !== metadata.outputSha256) throw new Error('Native alpha bytes changed');
  const background = join(workDir, 'paper-background.png');
  await copyFile(join(storyData, 'image-lab/1b4aca54c6badb6df198cd3ef26bf96bfbf5195662424239/provider-images/001.png'), background);
  const audioPath = join(workDir, 'narration.wav');
  const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: workDir, media_path: audioPath });
  const durationMs = Math.ceil(Number(probe.duration) * 1000);
  const caption = '当身体感到疲惫，先听见自己的需求。把目光转回自己，给生活留一点空间。';
  const title = '先听见自己的需求';
  const artifact: PipelineArtifact = { reviewedText: caption, rewrittenCopy: caption,
    cover: { title, subtitle: [], summary: caption, tags: [], comments: [] },
    scenes: [{ id: 1, cap: caption, descPrompt: '本地自然背景人物', durationMs }], imagePrompts: [], subtitles: { cues: [], srt: '' } };
  const htmlDir = join(workDir, 'html');
  const htmlSceneDir = join(htmlDir, 'html-scenes');
  await mkdir(htmlSceneDir, { recursive: true });
  await copyFile(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(htmlSceneDir, 'gsap.min.js'));
  await copyFile(join(root, 'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js'), join(htmlSceneDir, 'hyperframe.runtime.gsap.iife.js'));
  const composition = buildHtmlVideoExportInput({ workDir: htmlDir, outputPath: join(workDir, 'html-real-person.mp4'), title, artifact,
    generatedImages: [{ sceneId: 1, path: background }], foregroundImages: [{ sceneId: 1, path: foreground }], narrationAudio: [{ sceneId: 1, path: audioPath }],
    fps: 24, canvas_w: 1280, canvas_h: 720,
    captionConfig: { captionPreset: 'editorial', captionLayout: { ...HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS, region: 'bottom', fontSize: 42 } },
    scenePlans: [{ index: 1, narration: caption, title, captions: ['当身体感到疲惫，先听见自己的需求。', '把目光转回自己，给生活留一点空间。'], sceneTemplate: 'left-text-right-object', background: { prompt: '本地纸张底板' }, elements: [{ slot: 0, prompt: '自然背景人物抠图' }] }],
  });
  console.log('render: HTML');
  const html = await createElectronHtmlVideoRenderer().render(composition);
  const layers = createEditorialMotionLayers({ shotId: 'real-person', narration: caption, title, durationMs, ratio: '16:9', index: 2, motionStyle: 'focus-reveal' })
    .map(({ source: _source, prompt: _prompt, ...layer }) => ({ ...layer, ...(layer.kind === 'background' ? { imagePath: background } : layer.kind === 'subject' || layer.kind === 'archival' ? { imagePath: foreground, backgroundRemoval: metadata } : {}) }));
  console.log('render: Vox');
  const vox = await renderDirectorVideo({ workDir: join(workDir, 'vox'), projectTitle: title, modeLabel: 'Vox', ratio: '16:9', scenes: [{
    id: 'real-person', index: 1, title, caption, subtitleCues: [
      { id: 'line-1', text: '当身体感到疲惫，先听见自己的需求。', startMs: 0, endMs: Math.floor(durationMs / 2) },
      { id: 'line-2', text: '把目光转回自己，给生活留一点空间。', startMs: Math.floor(durationMs / 2), endMs: durationMs },
    ], durationMs, renderStrategy: 'deterministic-layers', layers, camera: [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }, { atMs: durationMs, x: 0.5, y: 0.5, zoom: 1 }], audioPath,
  }] });
  const sourceUnchanged = createHash('sha256').update(await readFile(source)).digest('hex') === sourceHash;
  const report = { source, sourceHash, sourceUnchanged, foreground, metadata, greenSource, greenOutput, green, native, html, vox,
    durationMs, paidCalls: 0, liveDatabaseModified: false, subtitleTiming: 'estimated', visualReview: 'pending', paperHoleCoverage: 'pending' };
  await writeFile(join(workDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ html: html.outputPath, vox: vox.outputPath, sourceUnchanged, durationMs }));
  keepAlive.destroy(); app.exit(0);
} catch (error) {
  await writeFile(join(workDir, 'error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), 'utf8');
  console.error(error); keepAlive.destroy(); app.exit(1);
}

}
app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });
