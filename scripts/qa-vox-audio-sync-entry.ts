import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEditorialCollageDraft, parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { createEditorialMotionLayers } from '../src/shared/editorial-motion';
import { applyEditorialVoiceRecord } from '../src/features/director-desk/director-generation';
import { prepareEditorialNarrationForRender } from '../src/shared/editorial-narration-timing';
import { buildDirectorRenderScenes, directorNarrationAlignment } from '../src/shared/director-render';
import { renderDirectorVideo } from '../electron/director-renderer';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runBoundedProcess } from '../src/shared/process-runner';
import type { VoiceLabRecord } from '../src/shared/types';

const { root, artifacts } = JSON.parse(process.env.STORYDREAM_VOX_AUDIO_QA!);
const report: Record<string, unknown> = { status: 'running', externalCalls: 0, syntheticMedia: true };
app.disableHardwareAcceleration();
app.setPath('userData', join(artifacts, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
globalThis.fetch = async () => { report.externalCalls = Number(report.externalCalls) + 1; throw new Error('No external calls in VOX audio QA'); };
let keepAlive: BrowserWindow;
async function python(mode: string) {
  const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, [join(root, 'scripts/qa-vox-audio-sync-media.py'), mode, artifacts], { cwd: root, timeoutMs: 60_000, maxStdoutBytes: 128 * 1024, maxStderrBytes: 128 * 1024 });
  assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout);
}
async function measure(path: string) {
  const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: artifacts, media_path: path, measure_audio_duration: true });
  assert(probe.has_audio); return Number(probe.audio_duration_ms);
}
async function run() {
  keepAlive = new BrowserWindow({ show: false });
  report.media = await python('create');
  let document = createEditorialCollageDraft({ id: 'isolated-vox-audio-sync', title: '完整旁白与镜头切点', ratio: '16:9' });
  document.beats = ['清晨的城市', '草原歌声的尾句'].map((title, index) => {
    const id = `shot-${index + 1}`;
    const layers = createEditorialMotionLayers({ shotId: id, title, narration: title, durationMs: 1000, ratio: '16:9', index, motionStyle: index ? 'focus-reveal' : 'cutout-slide' });
    for (const layer of layers.filter(layer => !layer.content)) {
      layer.assetVersionId = `${layer.id}-asset`;
      document.assets.push({ id: layer.assetVersionId, assetId: layer.id, kind: 'image', localPath: join(artifacts, layer.kind === 'background' ? 'background.png' : `subject-${index}.png`), createdAt: document.createdAt });
    }
    return { id: `beat-${index}`, index: index + 1, title, narration: title, startMs: index * 1000, durationMs: 1000,
      subtitleCues: [{ id: `cue-${index}`, text: title, shotId: id, startMs: index * 1000, endMs: (index + 1) * 1000 }],
      shots: [{ id, beatId: `beat-${index}`, title, durationMs: 1000, renderStrategy: 'deterministic-layers' as const, scenePrompt: title, motionPrompt: '本地音画验收', layers,
        camera: [{ atMs: 0, x: .5, y: .5, zoom: 1 }, { atMs: 1000, x: .5, y: .5, zoom: 1 }], subtitleCueIds: [`cue-${index}`] }] };
  });
  document = rebuildEditorialTimeline(document);
  for (let index = 0; index < 2; index++) {
    const path = join(artifacts, `voice-${index}.wav`);
    const record = { id: `local-${index}`, text: document.beats[index].narration, voiceId: 'fixture', voiceLabel: '测试音', speed: 1, provider: 'minimax', audioPath: path, status: 'generated', createdAt: document.createdAt, finishedAt: document.createdAt, errorMessage: '' } as VoiceLabRecord;
    document = applyEditorialVoiceRecord(document, `shot-${index + 1}`, record, 'local-fixture', undefined, true, await measure(path));
  }
  document = parseEditorialCollagePipelineData(await prepareEditorialNarrationForRender(document, measure));
  const scenes = buildDirectorRenderScenes(document);
  assert.equal(directorNarrationAlignment(document, scenes).status, 'passed');
  const render = await renderDirectorVideo({ workDir: join(artifacts, 'work'), projectTitle: document.title, modeLabel: 'VOX', ratio: document.ratio, scenes });
  report.render = { outputPath: render.outputPath, durationMs: render.durationMs, hasAudio: render.hasAudio, hasVideo: render.hasVideo };
  const expected = { video: render.outputPath, shots: document.timeline!.clips.map((clip, index) => ({ startMs: clip.startMs, durationMs: clip.durationMs, audioMs: [820, 1414][index], audioPath: join(artifacts, `voice-${index}.wav`) })) };
  await writeFile(join(artifacts, 'expected.json'), JSON.stringify(expected), 'utf8');
  await writeFile(join(artifacts, 'synthetic-project.json'), JSON.stringify(document, null, 2), 'utf8');
  report.verification = await python('verify');
  const oldPath = join(root, '.artifacts/vox-audio-sync-audit/project-ed32643f-e9bb-496b-b8eb-f3824da5ecda.json');
  const snapshot = parseEditorialCollagePipelineData(await readFile(oldPath, 'utf8'));
  const repaired = parseEditorialCollagePipelineData(await prepareEditorialNarrationForRender(snapshot, measure));
  report.historicalSnapshot = { originalMs: snapshot.timeline!.durationMs, repairedMs: repaired.timeline!.durationMs,
    shots: repaired.timeline!.clips.map(clip => { const speech = repaired.timeline!.audioClips!.find(audio => audio.shotId === clip.shotId && audio.trackType === 'narration')!; return { shotId: clip.shotId, durationMs: clip.durationMs, sourceDurationMs: speech.sourceDurationMs, retainedAudioMs: speech.durationMs }; }) };
  assert(repaired.timeline!.audioClips!.filter(clip => clip.trackType === 'narration').every(clip => clip.sourceDurationMs === clip.durationMs));
  await writeFile(join(artifacts, 'repaired-snapshot.json'), JSON.stringify(repaired, null, 2), 'utf8');
  assert.equal(report.externalCalls, 0);
  report.status = 'passed';
}
app.whenReady().then(run).catch(error => { report.status = 'failed'; report.error = String(error.stack ?? error); }).finally(async () => {
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  if (keepAlive && !keepAlive.isDestroyed()) keepAlive.destroy(); app.exit(report.status === 'passed' ? 0 : 1);
});
