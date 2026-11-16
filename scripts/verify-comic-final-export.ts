import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createMotionComicDraft, createMotionComicStarterProject, rebuildMotionComicEpisode, motionComicPipelineSchema } from '../src/shared/motion-comic';
import { motionComicVideoInputHash, motionComicVideoInputFingerprintSource } from '../src/shared/motion-comic-video';
import { adoptMotionComicVideoVersion } from '../src/shared/motion-comic-video-versions';
import { buildDirectorRenderScenes, buildDirectorSceneHtml } from '../src/shared/director-render';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
const out = resolve('.artifacts/comic-final-export');
await mkdir(out, { recursive: true });
const sidecar = await writeStoryboundSidecarScript(out);
function python(mode: string) {
  const result = spawnSync(resolve('vendor/python/python.exe'), [resolve('tests/motion-comic-final-export.py'), out, sidecar, mode], { stdio: 'inherit', timeout: 180000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Python ${mode} failed`);
}
python('fixtures');
const now = '2026-09-18T00:00:00.000Z';
let doc = createMotionComicStarterProject(createMotionComicDraft({ id: 'local-final-export', title: 'Local fixture export', premise: 'Offline colored video and tone acceptance', ratio: '16:9', now }), 'Local episode', now);
const episode = doc.episodes[0];
const templates = episode.scenes.flatMap(s => s.shots).slice(0, 2);
episode.scenes = [{ ...episode.scenes[0], shots: templates.map((shot, i) => ({ ...shot, title: `Local ${i}`, durationMs: 2500, renderStrategy: 'remote-video', videoProduction: { version: 1, referenceMode: 'frames', audioMode: 'native' }, dialogueCueIds: [`cue-${i}`], firstFrameAssetVersionId: `frame-${i}`, lastFrameAssetVersionId: undefined, voiceAssetVersionId: undefined, videoAssetVersionId: `video-${i}`, videoJobId: `job-${i}`, propAssetIds: [] })) }];
episode.dialogueCues = templates.map((shot, i) => ({ id: `cue-${i}`, shotId: shot.id, startMs: 500, endMs: 2000, text: i === 0 ? 'BLUE adopted history' : 'RED second scene', speakerRole: 'narrative', emotion: 'calm' }));
doc.assets = []; doc.providerJobs = [];
for (let i = 0; i < 2; i++) {
  const shot = episode.scenes[0].shots[i];
  doc.assets.push({ id: `frame-${i}`, assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: join(out, 'reference.png'), createdAt: now }, { id: `video-${i}`, assetId: `shot-video-${shot.id}`, episodeId: episode.id, kind: 'video', localPath: join(out, 'red.mp4'), providerJobId: `job-${i}`, durationMs: 2500, selected: true, createdAt: now });
}
episode.timeline = { durationMs: 5000, clips: [], audioAssetVersionIds: [] };
doc.episodes = [rebuildMotionComicEpisode(episode)];
for (const shot of doc.episodes[0].scenes[0].shots) {
  doc.providerJobs.push({ id: shot.videoJobId!, workflowKind: 'motion-comic', nodeId: shot.id, episodeId: episode.id, providerId: 'qa-local-fixture', model: 'synthetic-color-tone-not-model-output', capability: 'image-to-video', status: 'completed', inputHash: motionComicVideoInputHash(doc, shot, 'qa-local-fixture', 'synthetic-color-tone-not-model-output'), videoInputSnapshot: JSON.stringify(motionComicVideoInputFingerprintSource(doc, shot, 'qa-local-fixture', 'synthetic-color-tone-not-model-output')), phase: 'completed', idempotencyKey: shot.id, estimatedCost: 0, actualCost: 0, attempt: 1, createdAt: now, updatedAt: now });
}
const first = doc.episodes[0].scenes[0].shots[0];
doc.providerJobs.push({ ...doc.providerJobs[0], id: 'job-history', idempotencyKey: 'local-history' });
doc.assets.push({ id: 'video-history', assetId: `shot-video-${first.id}`, episodeId: episode.id, kind: 'video', localPath: join(out, 'blue.mp4'), providerJobId: 'job-history', durationMs: 2500, selected: false, createdAt: now });
doc.assets.push({ id: 'music', assetId: 'local-music', kind: 'audio', localPath: join(out, 'music.wav'), durationMs: 5000, createdAt: now });
doc.episodes[0].timeline.audioClips = doc.episodes[0].scenes[0].shots.map((shot, i) => ({ id: `music-track-${i}`, shotId: shot.id, assetVersionId: 'music', trackType: 'music', startMs: i * 2500, durationMs: 2500, sourceDurationMs: 5000, sourceStartMs: i * 2500, gainDb: -12, fadeInMs: 100, fadeOutMs: 100 }));
doc = motionComicPipelineSchema.parse(doc);
const before = buildDirectorRenderScenes(doc, episode.id);
await writeFile(join(out, 'document-before.json'), JSON.stringify(doc, null, 2));
doc = motionComicPipelineSchema.parse(adoptMotionComicVideoVersion(doc, episode.id, first.id, 'video-history'));
const scenes = buildDirectorRenderScenes(doc, episode.id);
assert.equal(before[0].videoAssetVersionId, 'video-0');
assert.equal(scenes[0].videoAssetVersionId, 'video-history');
assert(doc.episodes[0].timeline.clips[0].assetVersionIds.includes('video-history'));
assert(!doc.episodes[0].timeline.clips[0].assetVersionIds.includes('video-0'));
for (const [i, scene] of scenes.entries()) await writeFile(join(out, `scene-${i}.html`), buildDirectorSceneHtml({ ...scene, videoUrl: pathToFileURL(scene.videoPath!).href, modeLabel: 'AI 漫剧' }), 'utf8');
await writeFile(join(out, 'document.json'), JSON.stringify(doc, null, 2));
await writeFile(join(out, 'fixture.json'), JSON.stringify({ schemaValidated: true, before, scenes, adoption: { before: before[0].videoAssetVersionId, after: scenes[0].videoAssetVersionId, timeline: doc.episodes[0].timeline }, paidCalls: 0 }, null, 2));
python('render');
