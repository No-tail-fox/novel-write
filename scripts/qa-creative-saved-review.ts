/** Recheck saved, already-paid model responses with the current compiler. No provider/config access. */
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
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

const root = resolve('.'), work = join(root, '.artifacts/creative-saved-review');
const reviewOnly = process.argv.includes('--review-only');
const runtimePath = join(root, 'dist-electron/electron/vox-animation-runtime.js');
await mkdir(work, { recursive: true });
app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
await app.whenReady();
app.on('window-all-closed', () => {});
const keep = new BrowserWindow({ show: false });
const persist = (name: string, value: unknown) => writeFile(join(work, name), JSON.stringify(value, null, 2), 'utf8');
try {
  let document = parseEditorialCollagePipelineData(JSON.parse(await readFile(join(root, '.artifacts/creative-integration/document.json'), 'utf8')));
  if (document.productionRun?.status !== 'completed') throw new Error('The original paid acceptance must be completed.');
  const dispatchesBefore = await readFile(join(root, '.artifacts/creative-integration/dispatches.json'), 'utf8');
  const shots: { id: string; mode: string; attempts: { requestId: string; accepted: boolean; error?: string }[] }[] = [];
  for (const shot of document.beats.flatMap(b => b.shots)) {
    const animation = shot.animation;
    if (!animation?.authoring) throw new Error('Missing saved authoring history.');
    const checks: (typeof shots)[number]['attempts'] = [];
    let accepted = false;
    for (const attempt of [...animation.authoring.attempts].reverse()) {
      try {
        const code = compileVoxCode(attempt.source);
        const nextAnimation = { ...animation, mode: 'code' as const, code: { ...animation.code, ...code }, authoring: { ...animation.authoring, status: 'reviewed' as const, error: undefined } };
        const candidate = { ...document, beats: document.beats.map(b => ({ ...b, shots: b.shots.map(s => s.id === shot.id ? { ...s, animation: nextAnimation } : s) })) };
        const previewPaths = await reviewCreativeAnimation(candidate, shot.id, join(work, shot.id, attempt.requestId), runtimePath);
        document = { ...candidate, beats: candidate.beats.map(b => ({ ...b, shots: b.shots.map(s => s.id === shot.id ? { ...s, animation: { ...nextAnimation, authoring: { ...nextAnimation.authoring, previewPaths } } } : s) })) };
        checks.push({ requestId: attempt.requestId, accepted: true }); accepted = true; break;
      } catch (error) {
        checks.push({ requestId: attempt.requestId, accepted: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!accepted) document = { ...document, beats: document.beats.map(b => ({ ...b, shots: b.shots.map(s => s.id === shot.id ? { ...s, animation: { ...animation, mode: 'template' as const, authoring: { ...animation.authoring!, status: 'fallback' as const, error: checks.map(c => c.error).filter(Boolean).join('\n').slice(0, 8000) } } } : s) })) };
    shots.push({ id: shot.id, mode: accepted ? 'code' : 'template', attempts: checks });
    await persist('document.json', document);
    await persist('shots.json', shots);
    console.log('Saved code review', shot.id, accepted ? 'code' : 'template', JSON.stringify(checks));
  }
  if (reviewOnly) { console.log('Review-only complete; no render/provider requests.'); keep.destroy(); app.exit(0); }
  const scenes = buildDirectorRenderScenes(document), fingerprint = directorDocumentRenderFingerprint(document);
  console.log('Rendering saved-code acceptance; no model requests.');
  const result = await renderDirectorVideo({ workDir: work, projectTitle: 'NASA 温度记录 · 创意动画', modeLabel: '创意动画', ratio: document.ratio, scenes, animationRuntimePath: runtimePath });
  const checks = evaluateDirectorQuality(document, scenes, result, fingerprint), status = directorQualityStatus(checks);
  const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: work, media_path: result.outputPath, require_nonblack: true, analyze_quality: true });
  await persist('probe.json', probe);
  if (status !== 'passed' || !probe.has_video || !probe.has_nonblack_video || !probe.has_audio || probe.audio_is_silent || Math.abs(Number(probe.duration) * 1000 - scenes.reduce((total, scene) => total + scene.durationMs, 0)) > 750) throw new Error(`Saved-code media gate failed: ${JSON.stringify(checks)}`);
  if (await readFile(join(root, '.artifacts/creative-integration/dispatches.json'), 'utf8') !== dispatchesBefore) throw new Error('The paid ledger must remain unchanged.');
  const outputPath = join(work, 'creative-nasa-reviewed.mp4');
  await copyFile(result.outputPath, outputPath);
  const report = { status, reviewRevision: CREATIVE_REVIEW_REVISION, aestheticReview: false,
    aiCodeAcceptance: shots.every(shot => shot.mode === 'code') ? 'technical-only' : 'not-passed',
    surface: 'saved real model source + current compiler + actual browser review + FFmpeg; no product IPC',
    originalAcceptance: join(root, '.artifacts/creative-integration/report.json'), newPaidCalls: 0, shots, result, checks,
    outputPath, sha256: await hashDirectorRenderOutput(outputPath, result.sizeBytes),
    limitations: ['dataviz/16:9 trial only; rejected code uses template fallback', 'No VLM review or aesthetic acceptance', 'Sentence-level timing', 'Production IPC blocked by LICENSE_REQUIRED'] };
  await persist('report.json', report);
  console.log(JSON.stringify({ status, outputPath, shots: shots.map(s => ({ id: s.id, mode: s.mode })) }));
  keep.destroy(); app.exit(0);
} catch (error) {
  await writeFile(join(work, 'error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), 'utf8');
  console.error(error); keep.destroy(); app.exit(1);
}
