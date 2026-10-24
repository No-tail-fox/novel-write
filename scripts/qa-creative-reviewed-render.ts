/** Render an already-reviewed model shot over a known-safe fallback document. No providers. */
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

const root = resolve('.'), work = join(root, '.artifacts/creative-reviewed-render');
const runtimePath = join(root, 'dist-electron/electron/vox-animation-runtime.js');
await mkdir(work, { recursive: true });
app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
await app.whenReady();
app.on('window-all-closed', () => {});
const keep = new BrowserWindow({ show: false });
const persist = (name: string, value: unknown) => writeFile(join(work, name), JSON.stringify(value, null, 2), 'utf8');
try {
  let document = parseEditorialCollagePipelineData(JSON.parse(await readFile(join(root, '.artifacts/creative-saved-review/document.json'), 'utf8')));
  const promptDocument = parseEditorialCollagePipelineData(JSON.parse(await readFile(join(root, '.artifacts/creative-prompt/document.json'), 'utf8')));
  const promptReport = JSON.parse(await readFile(join(root, '.artifacts/creative-prompt/report.json'), 'utf8')) as { status: string; reviewRevision: number; requestId: string };
  const dispatchesBefore = await readFile(join(root, '.artifacts/creative-integration/dispatches.json'), 'utf8');
  const claimBefore = await readFile(join(root, '.artifacts/creative-prompt/claim.json'), 'utf8');
  if (document.id !== promptDocument.id || document.ratio !== promptDocument.ratio || document.sourceText !== promptDocument.sourceText) throw new Error('The two saved documents must have the same source.');
  if (promptReport.status !== 'reviewed' || promptReport.reviewRevision !== CREATIVE_REVIEW_REVISION) throw new Error('The saved code must pass the current review.');
  if (!document.beats.flatMap(b => b.shots).every(s => s.animation?.mode === 'template' && s.animation.authoring?.status === 'fallback')) throw new Error('Expected the all-template safe baseline.');
  const shot = promptDocument.beats[0]?.shots[0];
  if (!shot?.animation || shot.animation.mode !== 'code' || shot.animation.authoring?.status !== 'reviewed' || !shot.animation.authoring.attempts.some(a => a.requestId === promptReport.requestId)) throw new Error('Missing reviewed shot provenance.');
  const baselineShot = document.beats.flatMap(b => b.shots).find(s => s.id === shot.id);
  if (!baselineShot || baselineShot.durationMs !== shot.durationMs || baselineShot.voiceAssetVersionId !== shot.voiceAssetVersionId || JSON.stringify(baselineShot.subtitleCueIds) !== JSON.stringify(shot.subtitleCueIds)) throw new Error('Shot timing, narration and subtitles must match.');
  const compiled = compileVoxCode(shot.animation.code.source);
  const animation = { ...shot.animation, code: { ...shot.animation.code, ...compiled } };
  // Only the new reviewed animation crosses into the safe document. Old prompt shots never do.
  document = { ...document, beats: document.beats.map(b => ({ ...b, shots: b.shots.map(s => s.id === shot.id ? { ...s, animation } : s) })) };
  delete document.productionRun;
  const previewPaths = await reviewCreativeAnimation(document, shot.id, join(work, 'preview'), runtimePath);
  document = { ...document, beats: document.beats.map(b => ({ ...b, shots: b.shots.map(s => s.id === shot.id ? { ...s, animation: { ...animation, authoring: { ...animation.authoring!, previewPaths } } } : s) })) };
  await persist('document.json', document);
  const scenes = buildDirectorRenderScenes(document), fingerprint = directorDocumentRenderFingerprint(document);
  console.log('Rendering one reviewed AI shot plus safe template shots; no provider calls.');
  const result = await renderDirectorVideo({ workDir: work, projectTitle: 'NASA 温度记录 · AI 首镜与模板回退', modeLabel: '创意动画', ratio: document.ratio, scenes, animationRuntimePath: runtimePath });
  const checks = evaluateDirectorQuality(document, scenes, result, fingerprint), status = directorQualityStatus(checks);
  const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: work, media_path: result.outputPath, require_nonblack: true, analyze_quality: true });
  await persist('probe.json', probe);
  if (status !== 'passed' || !probe.has_video || !probe.has_nonblack_video || !probe.has_audio || probe.audio_is_silent || Math.abs(Number(probe.duration) * 1000 - scenes.reduce((n, s) => n + s.durationMs, 0)) > 750) throw new Error(`Media gate failed: ${JSON.stringify(checks)}`);
  if (await readFile(join(root, '.artifacts/creative-integration/dispatches.json'), 'utf8') !== dispatchesBefore || await readFile(join(root, '.artifacts/creative-prompt/claim.json'), 'utf8') !== claimBefore) throw new Error('Paid journals changed during the no-provider render.');
  const outputPath = join(work, 'creative-nasa-mixed-reviewed.mp4');
  await copyFile(result.outputPath, outputPath);
  await persist('report.json', { status, surface: 'saved real AI code + safe template fallback + real browser + FFmpeg; no product IPC',
    reviewRevision: CREATIVE_REVIEW_REVISION, aestheticReview: false, aiCodeAcceptance: 'one-shot-technical-only', newPaidCalls: 0,
    codeRequestId: promptReport.requestId, previewPaths, shots: scenes.map(s => ({ id: s.id, mode: s.animation?.mode, durationMs: s.durationMs })),
    firstShotDurationMs: shot.durationMs, result, checks, outputPath, sha256: await hashDirectorRenderOutput(outputPath, result.sizeBytes),
    manualFrameReview: '15%/85%: supplied values match, no subtitle overlap; source and axis labels are small.',
    limitations: ['First shot AI code, remaining shots template fallback; dark/cream style discontinuity is not approved.', 'One dataviz/16:9 trial; no VLM or full-film aesthetic acceptance.', 'Sentence timing, no word alignment.', 'Product IPC blocked by LICENSE_REQUIRED.'] });
  console.log(JSON.stringify({ status, outputPath, firstShotDurationMs: shot.durationMs }));
  keep.destroy(); app.exit(0);
} catch (error) {
  await writeFile(join(work, 'error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), 'utf8');
  console.error(error); keep.destroy(); app.exit(1);
}
