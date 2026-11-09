import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { reviewHtmlAnimationFrames } from '../electron/html-video-renderer';
import { prepareVoxHtml } from '../electron/vox-animation-runtime';
import { createVoxAnimation, type VoxAnimationPayload } from '../src/shared/vox-animation';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { voxProductionSettings, voxProjectMusicSchema } from '../src/shared/vox-production';
import { editorialProjectMusicClips } from '../src/shared/editorial-music';
import { setDefaultPythonRuntimeAppRoot, resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { runBoundedProcess } from '../src/shared/process-runner';

const root = resolve('.'), work = join(root, '.artifacts/video-continuity');
await mkdir(work, { recursive: true });
setDefaultPythonRuntimeAppRoot(root);
await app.whenReady();
app.on('window-all-closed', () => {});
const keep = new BrowserWindow({ show: false });
const report: Record<string, unknown> = { paidCalls: 0, cases: [] };
try {
  const runtime = join(work, 'runtime.js');
  await build({ entryPoints: [join(root, 'src/features/vox-animation/runtime.tsx')], outfile: runtime, bundle: true,
    platform: 'browser', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' }, minify: true });
  for (const scenario of ['complete', 'empty-first', 'empty-last']) {
    const dir = join(work, scenario);
    await mkdir(dir, { recursive: true });
    const animation = createVoxAnimation();
    animation.mode = 'code'; animation.template.props.background = '#e8f0e8';
    const visible = scenario === 'empty-first' ? 'frame > 0' : scenario === 'empty-last' ? 'frame < 47' : 'true';
    animation.code.source = `import React from 'react'; import {useCurrentFrame} from 'remotion';
      export default function Scene(){const frame=useCurrentFrame();return <div style={{position:'absolute',left:60,top:50,width:230,height:170,background:'#ab413c',opacity:${visible}?1:0,transform:'translateX('+Math.min(frame,20)+'px)'}}/>}`;
    const payload: VoxAnimationPayload = { animation, width: 640, height: 360, fps: 24, durationMs: 2000, assets: [],
      cues: [{ text: 'Visible captions must not hide an empty scene.', startMs: 0, endMs: 2000 }] };
    const htmlPath = join(dir, 'scene.html');
    await writeFile(htmlPath, await prepareVoxHtml(runtime, payload), 'utf8');
    let failure = '';
    try { await reviewHtmlAnimationFrames({ workDir: dir, htmlPath, canvas: { width: 640, height: 360 }, durationMs: 2000, expectedBackground: '#e8f0e8' }); }
    catch (error) { failure = String(error); }
    let evidence: { paths: string[]; atMs: number; passed: boolean } | null = null;
    try { evidence = JSON.parse(await readFile(join(dir, 'review.json'), 'utf8')); } catch { /* Renderer failures may happen before review evidence is written. */ }
    if (!evidence) {
      (report.cases as unknown[]).push({ scenario, passed: false, failure, evidence: null });
      throw new Error(`${scenario}: review did not produce evidence (${failure || 'renderer returned without review.json'})`);
    }
    if (scenario === 'complete' ? !!failure || evidence.paths.length !== 5 : !failure.includes('CREATIVE_EMPTY_FRAME')) throw new Error(`${scenario}: ${failure || 'empty scene accepted'}`);
    if (scenario === 'empty-first' && evidence.atMs !== 0) throw new Error('First frame was not rejected');
    if (scenario === 'empty-last' && evidence.atMs < 1900) throw new Error('Last frame was not rejected');
    (report.cases as unknown[]).push({ scenario, passed: true, evidence, failure });
  }
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'mix-qa', title: 'Mix QA' }), '开场。背景。证据。结论。');
  const music = voxProjectMusicSchema.parse({ id: 'qa', title: 'QA', path: join(work, 'music.wav'), durationMs: 7000 });
  const mixed = rebuildEditorialTimeline({ ...document, productionSettings: { ...voxProductionSettings(), music } });
  const reference = editorialProjectMusicClips({ ...mixed.timeline!, clips: [{ ...mixed.timeline!.clips[0], durationMs: mixed.timeline!.durationMs }] }, music);
  await writeFile(join(work, 'music-clips.json'), JSON.stringify({ timeline: mixed.timeline, reference, path: music.path }), 'utf8');
  const sidecar = await writeStoryboundSidecarScript(work);
  const audio = await runBoundedProcess(resolvePythonRuntimeInfo().command, [join(root, 'scripts/qa-project-music-mix.py'), sidecar, work], { cwd: root, timeoutMs: 120000, maxStdoutBytes: 8192, maxStderrBytes: 8192 });
  if (audio.code !== 0) throw new Error(audio.stderr);
  report.audio = JSON.parse(audio.stdout);
  report.status = 'passed';
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); }
await writeFile(join(work, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
keep.destroy(); app.exit(report.status === 'passed' ? 0 : 1);
