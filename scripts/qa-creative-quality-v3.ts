/** Reuse saved paid sources/voices; no config, provider dispatch or paid repair. */
import { app, BrowserWindow } from 'electron';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { reviewCreativeAnimation } from '../electron/creative-animation-preview';
import { renderDirectorVideo } from '../electron/director-renderer';
import { hashDirectorRenderOutput } from '../electron/director-render-output';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint, evaluateDirectorQuality, directorQualityStatus } from '../src/shared/director-render';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { CREATIVE_REVIEW_REVISION } from '../src/shared/creative-animation/review';

const root = resolve('.'), work = join(root, '.artifacts/creative-quality-v3');
const runtimePath = join(root, 'dist-electron/electron/vox-animation-runtime.js');
await mkdir(work, { recursive: true });
app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
await app.whenReady();
app.on('window-all-closed', () => {});
const keep = new BrowserWindow({ show: false });
const persist = (name: string, value: unknown) => writeFile(join(work, name), JSON.stringify(value, null, 2), 'utf8');
try {
  const dispatchPath = join(root, '.artifacts/creative-integration/dispatches.json');
  const claimPath = join(root, '.artifacts/creative-prompt/claim.json');
  const dispatchesBefore = await readFile(dispatchPath, 'utf8'), claimBefore = await readFile(claimPath, 'utf8');
  const baseline = parseEditorialCollagePipelineData(JSON.parse(await readFile(join(root, '.artifacts/creative-saved-review/document.json'), 'utf8')));
  const prompt = parseEditorialCollagePipelineData(JSON.parse(await readFile(join(root, '.artifacts/creative-prompt/document.json'), 'utf8')));
  const shot = prompt.beats[0].shots[0];
  if (!shot.animation?.authoring || shot.animation.mode !== 'code') throw new Error('Missing saved paid source.');
  const compiled = compileVoxCode(shot.animation.code.source);
  const candidate = { ...baseline, beats: baseline.beats.map(b => ({ ...b, shots: b.shots.map(s => s.id === shot.id ? { ...s, animation: { ...shot.animation!, code: { ...shot.animation!.code, ...compiled } } } : s) })) };
  let rejection = '';
  try { await reviewCreativeAnimation(candidate, shot.id, join(work, 'saved-ai-review'), runtimePath); }
  catch (error) { rejection = error instanceof Error ? error.message : String(error); }
  await persist('saved-ai-review.json', { reviewRevision: CREATIVE_REVIEW_REVISION, accepted: !rejection, error: rejection,
    sourceDocument: join(root, '.artifacts/creative-prompt/document.json'), requestIds: shot.animation.authoring.attempts.map(a => a.requestId), newPaidCalls: 0 });
  if (!rejection.startsWith('CREATIVE_LAYOUT:') || !rejection.includes('文字过小') || !rejection.includes('背景未遵循')) throw new Error(`Expected strict font/palette rejection; got ${rejection}`);
  // This separate QA document explicitly selects cuts. Saved projects retain their choices.
  const document = { ...baseline, beats: baseline.beats.map(b => ({ ...b, shots: b.shots.map(s => ({ ...s, transitionIn: { type: 'cut' as const, durationMs: 0 } })) })) };
  if (!document.beats.flatMap(b => b.shots).every(s => s.animation?.mode === 'template' && s.animation.authoring?.status === 'fallback')) throw new Error('Expected safe template baseline.');
  const reviews: { id: string; paths: string[] }[] = [];
  for (const s of document.beats.flatMap(b => b.shots)) {
    reviews.push({ id: s.id, paths: await reviewCreativeAnimation(document, s.id, join(work, 'templates', s.id), runtimePath) });
  }
  await persist('document.json', document);
  await persist('template-reviews.json', reviews);
  const scenes = buildDirectorRenderScenes(document), fingerprint = directorDocumentRenderFingerprint(document);
  console.log('Saved AI rejected by review v3; rendering four safe templates with cuts and normalized audio. No provider calls.');
  const result = await renderDirectorVideo({ workDir: work, projectTitle: 'NASA 温度记录 · 统一模板与声音', modeLabel: '创意动画', ratio: document.ratio, scenes, animationRuntimePath: runtimePath });
  const checks = evaluateDirectorQuality(document, scenes, result, fingerprint), status = directorQualityStatus(checks);
  const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: work, media_path: result.outputPath, require_nonblack: true, analyze_quality: true });
  await persist('probe.json', probe);
  if (status !== 'passed' || probe.audio_quality_status !== 'ok' || !probe.has_video || !probe.has_nonblack_video || !probe.has_audio || probe.audio_is_silent || Number(probe.audio_lufs) < -17 || Number(probe.audio_lufs) > -15 || Math.abs(Number(probe.duration) * 1000 - scenes.reduce((n, s) => n + s.durationMs, 0)) > 100) throw new Error(`Media gate failed: ${JSON.stringify({ checks, probe })}`);
  if (await readFile(dispatchPath, 'utf8') !== dispatchesBefore || await readFile(claimPath, 'utf8') !== claimBefore) throw new Error('Paid journals changed.');
  const outputPath = join(work, 'creative-nasa-quality-v3.mp4');
  await copyFile(result.outputPath, outputPath);
  await persist('report.json', { status, reviewRevision: CREATIVE_REVIEW_REVISION, aestheticReview: false, aiCodeAcceptance: 'not-passed-v3',
    surface: 'saved model source rejection + safe template fallback + actual browser + FFmpeg; no product IPC', newPaidCalls: 0,
    savedAiRejection: rejection, reviews, shots: scenes.map(s => ({ id: s.id, mode: s.animation?.mode, transitionIn: s.transitionIn, durationMs: s.durationMs })),
    result, checks, outputPath, sha256: await hashDirectorRenderOutput(outputPath, result.sizeBytes),
    limitations: ['All four shots use stable templates; no AI code approved under v3.', 'Saved source/paid journals untouched. Cuts explicitly selected in this QA copy.', 'dataviz 16:9 only; no VLM/full-film aesthetic or listening acceptance.', 'Sentence timing, no word alignment.', 'Product IPC blocked by LICENSE_REQUIRED.'] });
  console.log(JSON.stringify({ status, outputPath, duration: probe.duration, lufs: probe.audio_lufs, newPaidCalls: 0 }));
  keep.destroy(); app.exit(0);
} catch (error) {
  await writeFile(join(work, 'error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), 'utf8');
  console.error(error); keep.destroy(); app.exit(1);
}
