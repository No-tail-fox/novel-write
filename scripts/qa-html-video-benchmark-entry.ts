import { app, BrowserWindow, screen } from 'electron';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildHtmlVideoExportInput } from '../src/shared/html-video';
import { createElectronHtmlVideoRenderer } from '../electron/html-video-renderer';
import { HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS } from '../src/shared/html-video-captions';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import type { HtmlVideoScenePlan, HtmlVideoTimedCaptionCue, PipelineArtifact } from '../src/shared/types';

const root = resolve('.');
const work = resolve(process.env.HTML_BENCH_WORK!);
const longEdge = Number(process.env.HTML_BENCH_EDGE ?? '1920');
const repeat = Number(process.env.HTML_BENCH_REPEAT ?? '1');
const concurrency = Number(process.env.HTML_BENCH_CONCURRENCY ?? '1');
if (![1920, 3840].includes(longEdge) || ![1, 2, 4].includes(repeat) || ![1, 2].includes(concurrency)) {
  throw new Error('Unsupported benchmark dimensions or workload');
}
app.disableHardwareAcceleration();
app.setPath('userData', join(work, 'profile'));
app.on('window-all-closed', () => {});
setDefaultPythonRuntimeAppRoot(root);

app.whenReady().then(async () => {
  const keep = new BrowserWindow({ show: false });
  const started = Date.now();
  const events: object[] = [];
  const eventPath = join(work, 'events.jsonl');
  let eventWrite = Promise.resolve();
  const record = (detail: object) => {
    events.push({ elapsedMs: Date.now() - started, ...detail });
    // Serialize writes, including close events, so the external sampler sees valid JSON.
    eventWrite = eventWrite.then(() => writeFile(eventPath, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8'));
    return eventWrite;
  };
  try {
    await mkdir(work, { recursive: true });
    const prior = JSON.parse(await readFile(join(root, '.artifacts/animation-stage-b/report.json'), 'utf8')) as { plans: HtmlVideoScenePlan[] };
    const voices = JSON.parse(await readFile(join(root, '.artifacts/animation-stage-b/voices/timing.json'), 'utf8')) as Array<{
      path: string; durationMs: number; captionCues: HtmlVideoTimedCaptionCue[];
    }>;
    const cutoutReport = JSON.parse(await readFile(join(root, '.artifacts/cutout-stage-a/report.json'), 'utf8')) as { source: string };
    const results = await Promise.all(Array.from({ length: concurrency }, async (_, run) => {
      const directory = join(work, `render-${run + 1}`);
      const htmlDir = join(directory, 'html-scenes');
      await mkdir(htmlDir, { recursive: true });
      await copyFile(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(htmlDir, 'gsap.min.js'));
      await copyFile(join(root, 'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js'), join(htmlDir, 'hyperframe.runtime.gsap.iife.js'));
      const media = { paper: join(directory, 'paper.jpg'), original: join(directory, 'original.png'), person: join(directory, 'person.png') };
      await Promise.all([
        copyFile(join(root, '.artifacts/animation-stage-b/paper.jpg'), media.paper),
        copyFile(cutoutReport.source, media.original),
        copyFile(join(root, '.artifacts/cutout-stage-a/natural-person-shared.png'), media.person),
      ]);
      const localVoices = await Promise.all(voices.map(async (voice, index) => {
        const path = join(directory, `voice-${index + 1}.wav`);
        await copyFile(voice.path, path);
        return { ...voice, path };
      }));
      const plans = Array.from({ length: repeat }, () => prior.plans).flat().map((plan, index) => ({ ...plan, index: index + 1 }));
      const voiceFor = (index: number) => localVoices[index % localVoices.length];
      const caption = plans.map((plan) => plan.narration).join('');
      const artifact: PipelineArtifact = {
        reviewedText: caption, rewrittenCopy: caption,
        cover: { title: '构图与叙述 · 高清持续渲染', subtitle: [], summary: caption, tags: [], comments: [] },
        scenes: plans.map((plan, index) => ({ id: plan.index, cap: plan.narration, descPrompt: '', durationMs: voiceFor(index).durationMs })),
        imagePrompts: [], subtitles: { cues: [], srt: '' },
      };
      const input = buildHtmlVideoExportInput({
        workDir: directory, outputPath: join(directory, 'final.mp4'), title: artifact.cover.title, artifact,
        generatedImages: plans.map((plan) => ({ sceneId: plan.index, path: media.paper })),
        foregroundImages: plans.flatMap((plan) => plan.elements.map((element) => ({
          sceneId: plan.index, slot: element.slot,
          path: plan.sceneTemplate === 'split-compare' ? (element.slot ? media.person : media.original) : (element.slot ? media.original : media.person),
        }))),
        narrationAudio: plans.map((plan, index) => ({ sceneId: plan.index, path: voiceFor(index).path, captionCues: voiceFor(index).captionCues })),
        fps: 24, canvas_w: longEdge, canvas_h: longEdge / 16 * 9,
        captionConfig: { captionPreset: 'editorial', captionAnim: 'none', captionLayout: { ...HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS, fontSize: 52 } },
        scenePlans: plans,
        // Use the product's default transition. Hard cuts are a separate benchmark, not a hidden shortcut.
        transition: { type: 'fade', duration: 0.3 },
      });
      await record({ run: run + 1, phase: 'queued', sceneCount: plans.length, durationSec: input.totalDurationS });
      const renderer = createElectronHtmlVideoRenderer({ inspectScene: async (window, scene) => {
        await record({ run: run + 1, phase: 'capture', sceneId: scene.sceneId });
        window.once('closed', () => { void record({ run: run + 1, phase: 'encode', sceneId: scene.sceneId }); });
        // Real rendered pixels, not a different preview resolution.
        await window.webContents.executeJavaScript(`void window.__tl.seek(${Math.min(2, scene.duration / 2)}, false)`);
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        if (scene.sceneId <= 6) await writeFile(join(directory, `scene-${scene.sceneId}.png`), (await window.webContents.capturePage()).toPNG());
      } });
      const renderStarted = Date.now();
      const result = await renderer.render(input);
      await record({ run: run + 1, phase: 'completed' });
      return {
        ...result, elapsedMs: Date.now() - renderStarted, sceneCount: plans.length,
        // compose_render pads the transition-overlapped source to the authored clock.
        expectedDurationSec: input.totalDurationS,
        authoredDurationSec: input.totalDurationS, outputBytes: (await stat(result.outputPath)).size,
        scratchCleaned: !(await readdir(directory)).some((name) => name.startsWith('render-segments-')),
      };
    }));
    await eventWrite;
    await writeFile(join(work, 'render-report.json'), JSON.stringify({
      status: 'passed', elapsedMs: Date.now() - started, longEdge, repeat, concurrency, fps: 24,
      hardwareAcceleration: false, paidCalls: 0, results,
      displays: screen.getAllDisplays().map(({ size, scaleFactor }) => ({ size, scaleFactor })),
      source: 'Existing six-scene photo/cutout/paper sample and offline SAPI narration; repeated scenes are a stress fixture.',
      transition: 'fade-0.3', events,
    }, null, 2), 'utf8');
    keep.destroy(); app.exit(0);
  } catch (error) {
    await eventWrite.catch(() => {});
    await writeFile(join(work, 'render-report.json'), JSON.stringify({ status: 'failed', error: error instanceof Error ? error.stack : String(error), events }, null, 2), 'utf8');
    console.error(error); keep.destroy(); app.exit(1);
  }
});
