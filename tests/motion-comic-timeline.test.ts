import { describe, expect, it } from 'vitest';
import {
  appendMotionComicShot,
  appendMotionComicEpisode,
  appendMotionComicScene,
  createMotionComicDraft,
  createMotionComicStarterProject,
  rebuildMotionComicEpisode,
  removeMotionComicShot,
  reorderMotionComicShot,
  updateMotionComicShotDuration,
  parseMotionComicPipelineData,
  validateMotionComicPipeline,
} from '../src/shared/motion-comic';
import { alignSubtitleCue, isSubtitleAlignmentValid } from '../src/shared/audio-alignment';
import { buildDirectorRenderScenes } from '../src/shared/director-render';

function fixture() {
  const draft = createMotionComicDraft({ id: 'timeline-fixture', title: '时间线', premise: '线索' });
  return createMotionComicStarterProject(draft);
}

describe('motion comic shot timeline projection', () => {
  it.each([0, 1, 2])('inserts into scene %i with full-length dialogue and surviving episode ownership', (sceneIndex) => {
    const before = appendMotionComicEpisode(fixture(), { id: 'second-episode' });
    const episode = before.episodes[0];
    const target = episode.scenes[sceneIndex];
    const newStart = episode.scenes.slice(0, sceneIndex + 1).flatMap((scene) => scene.shots).reduce((sum, shot) => sum + shot.durationMs, 0);
    const next = appendMotionComicShot(before, episode.id, target.id, { id: `insert-${sceneIndex}` });
    expect(next.episodes[1]).toBe(before.episodes[1]);
    expect(next.episodes[0].dialogueCues.find((cue) => cue.shotId === `insert-${sceneIndex}`)).toMatchObject({ startMs: newStart, endMs: newStart + 6000 });
    expect(validateMotionComicPipeline(next)).toEqual([]);
    expect(parseMotionComicPipelineData(JSON.stringify(next))).toEqual(next);
  });

  it('preserves valid word timings and authored audio offsets when a shot moves', () => {
    const before = fixture();
    const episode = before.episodes[0];
    const shot = episode.scenes[1].shots[0];
    const cue = episode.dialogueCues.find((item) => item.shotId === shot.id)!;
    const aligned = { ...cue, ...alignSubtitleCue(cue) };
    episode.dialogueCues = episode.dialogueCues.map((item) => item.id === cue.id ? aligned : item);
    before.assets.push({ id: 'sfx', assetId: 'sfx', kind: 'audio', localPath: 'E:/fixture.wav', createdAt: before.createdAt });
    const oldStart = episode.timeline.clips.find((clip) => clip.shotId === shot.id)!.startMs;
    episode.timeline.audioClips = [{ id: 'sfx-clip', assetVersionId: 'sfx', trackType: 'sfx', shotId: shot.id, startMs: oldStart + 400, durationMs: 500, sourceStartMs: 125, gainDb: -6 }];
    const moved = reorderMotionComicShot(before, episode.id, shot.id, episode.scenes[0].id, 0);
    const movedCue = moved.episodes[0].dialogueCues.find((item) => item.id === cue.id)!;
    expect(isSubtitleAlignmentValid(movedCue)).toBe(true);
    expect(movedCue.tokens).toEqual(aligned.tokens!.map((token) => ({ ...token, startMs: token.startMs - oldStart, endMs: token.endMs - oldStart })));
    expect(moved.episodes[0].timeline.audioClips?.[0]).toMatchObject({ startMs: 400, durationMs: 500, sourceStartMs: 125, gainDb: -6 });
    expect(validateMotionComicPipeline(moved)).toEqual([]);
  });

  it('rescales separate cues, removes stale speech, and trims sound fades after resize', () => {
    const before = fixture();
    const episode = before.episodes[0];
    const shot = episode.scenes[0].shots[0];
    const shotCues = episode.dialogueCues.filter((item) => item.shotId === shot.id);
    const first = shotCues[0];
    const midpoint = shot.durationMs / 2;
    const second = { ...shotCues[1], id: 'second-cue', startMs: midpoint };
    first.endMs = midpoint;
    first.voiceAssetVersionId = 'voice';
    first.audioAssetVersionId = 'voice';
    shot.voiceAssetVersionId = 'voice';
    shot.dialogueCueIds = [first.id, second.id];
    episode.dialogueCues = episode.dialogueCues.filter((item) => item.shotId !== shot.id || item.id === first.id).concat(second);
    episode.timeline.clips[0].subtitleCueIds = shot.dialogueCueIds;
    before.assets.push(...['voice', 'sfx'].map((id) => ({ id, assetId: id, kind: 'audio' as const, localPath: `E:/${id}.wav`, createdAt: before.createdAt })));
    episode.timeline.audioClips = [
      { id: 'speech', assetVersionId: 'voice', trackType: 'dialogue', shotId: shot.id, startMs: 0, durationMs: midpoint },
      { id: 'sound', assetVersionId: 'sfx', trackType: 'sfx', shotId: shot.id, startMs: 100, durationMs: shot.durationMs - 100, fadeInMs: 2500, fadeOutMs: 2500 },
    ];
    const next = updateMotionComicShotDuration(before, episode.id, shot.id, 2000);
    expect(next.episodes[0].dialogueCues.filter((item) => item.shotId === shot.id).map((item) => [item.startMs, item.endMs])).toEqual([[0, 1000], [1000, 2000]]);
    expect(next.episodes[0].dialogueCues[0].voiceAssetVersionId).toBeUndefined();
    expect(next.episodes[0].timeline.audioClips).toEqual([expect.objectContaining({ id: 'sound', durationMs: 1900, fadeInMs: 1900, fadeOutMs: 1900 })]);
    expect(next.episodes[0].timeline.audioAssetVersionIds).toEqual(['sfx']);
    expect(validateMotionComicPipeline(next)).toEqual([]);
    expect(updateMotionComicShotDuration(next, episode.id, shot.id, 2000)).toBe(next);
  });

  it('repairs legacy appended clip order without discarding the original cue offset', () => {
    const before = fixture();
    const episode = before.episodes[0];
    const next = appendMotionComicShot(before, episode.id, episode.scenes[0].id, { id: 'legacy-appended' });
    const changed = next.episodes[0];
    const appended = changed.timeline.clips.find((clip) => clip.shotId === 'legacy-appended')!;
    const original = before.episodes[0];
    changed.timeline.clips = [...original.timeline.clips, { ...appended, startMs: original.timeline.durationMs }];
    changed.dialogueCues = [...original.dialogueCues, { ...changed.dialogueCues.find((cue) => cue.shotId === 'legacy-appended')!, startMs: original.timeline.durationMs, endMs: original.timeline.durationMs + 6000 }];
    expect(validateMotionComicPipeline(next).some((issue) => issue.message.includes('order'))).toBe(true);
    const restored = parseMotionComicPipelineData(JSON.stringify(next));
    expect(restored.episodes[0].timeline.clips[2]).toMatchObject({ shotId: 'legacy-appended', startMs: 12000 });
    expect(restored.episodes[0].dialogueCues.find((cue) => cue.shotId === 'legacy-appended')).toMatchObject({ startMs: 12000, endMs: 18000 });
    expect(validateMotionComicPipeline(restored)).toEqual([]);
  });

  it('projects final render scenes in the same order after insert, move and delete', () => {
    let document = fixture();
    const episodeId = document.activeEpisodeId;
    const firstScene = document.episodes[0].scenes[0];
    document = appendMotionComicShot(document, episodeId, firstScene.id, { id: 'new-shot' });
    document = reorderMotionComicShot(document, episodeId, firstScene.shots[0].id, document.episodes[0].scenes[2].id, 0);
    document = removeMotionComicShot(document, episodeId, firstScene.shots[1].id);
    document.assets.push({ id: 'image', assetId: 'frame', kind: 'image', localPath: 'E:/fixture.png', createdAt: document.createdAt }, { id: 'audio', assetId: 'voice', kind: 'audio', localPath: 'E:/fixture.wav', createdAt: document.createdAt });
    const episode = document.episodes[0];
    const shots = episode.scenes.flatMap((scene) => scene.shots);
    for (const shot of shots) { shot.firstFrameAssetVersionId = 'image'; shot.voiceAssetVersionId = 'audio'; }
    const scenes = buildDirectorRenderScenes(document);
    expect(scenes.map((scene) => scene.id)).toEqual(episode.timeline.clips.map((clip) => clip.shotId));
    expect(scenes.reduce((sum, scene) => sum + scene.durationMs, 0)).toBe(episode.timeline.durationMs);
    for (const scene of scenes) expect(scene.subtitleCues?.every((cue) => cue.startMs >= 0 && cue.endMs <= scene.durationMs)).toBe(true);
  });

  it('keeps empty scene metadata and rejects deleting the final shot and invalid positions', () => {
    let document = fixture();
    const original = document.episodes[0];
    const ids = original.scenes.flatMap((scene) => scene.shots).map((shot) => shot.id);
    for (const id of ids.slice(0, -1)) document = removeMotionComicShot(document, original.id, id);
    expect(document.episodes[0].scenes.map((scene) => scene.id)).toEqual(original.scenes.map((scene) => scene.id));
    expect(() => removeMotionComicShot(document, original.id, ids.at(-1)!)).toThrow(/LAST_SHOT/);
    expect(() => reorderMotionComicShot(document, original.id, ids.at(-1)!, original.scenes[0].id, NaN)).toThrow(/INVALID_INDEX/);
    expect(() => updateMotionComicShotDuration(document, original.id, ids.at(-1)!, 0.5)).toThrow(/INVALID_DURATION/);
  });

  it('gives the first cue of an appended scene its full shot duration', () => {
    const before = fixture();
    const next = appendMotionComicScene(before, before.activeEpisodeId);
    expect(next.episodes[0].dialogueCues.at(-1)).toMatchObject({ startMs: 40000, endMs: 46000 });
  });
  it('inserts a shot into its scene position and shifts later cues', () => {
    const before = fixture();
    const episode = before.episodes[0];
    const firstScene = episode.scenes[0];
    const next = appendMotionComicShot(before, episode.id, firstScene.id, { id: 'inserted-shot' });
    const updated = next.episodes[0];
    expect(updated.timeline.clips.map((clip) => clip.shotId).slice(0, 4)).toEqual([
      firstScene.shots[0].id,
      firstScene.shots[1].id,
      'inserted-shot',
      episode.scenes[1].shots[0].id,
    ]);
    expect(updated.timeline.durationMs).toBe(updated.timeline.clips.reduce((sum, clip) => sum + clip.durationMs, 0));
    expect(rebuildMotionComicEpisode(updated).timeline).toEqual(updated.timeline);
  });

  it('rebuilds offsets after duration edits and removes the shot plus its cues', () => {
    const before = fixture();
    const episode = before.episodes[0];
    const shotId = episode.scenes[0].shots[0].id;
    const changed = updateMotionComicShotDuration(before, episode.id, shotId, 2_000);
    const changedEpisode = changed.episodes[0];
    expect(changedEpisode.timeline.clips.find((clip) => clip.shotId === shotId)?.durationMs).toBe(2_000);
    expect(changedEpisode.timeline.clips[1].startMs).toBe(2_000);
    const removed = removeMotionComicShot(changed, episode.id, shotId).episodes[0];
    expect(removed.scenes.flatMap((scene) => scene.shots).some((shot) => shot.id === shotId)).toBe(false);
    expect(removed.dialogueCues.some((cue) => cue.shotId === shotId)).toBe(false);
    expect(removed.timeline.clips.some((clip) => clip.shotId === shotId)).toBe(false);
    expect(removed.timeline.durationMs).toBe(removed.timeline.clips.reduce((sum, clip) => sum + clip.durationMs, 0));
  });

  it('reorders a shot across scenes while preserving canonical indices', () => {
    const before = fixture();
    const episode = before.episodes[0];
    const shotId = episode.scenes[0].shots[0].id;
    const targetSceneId = episode.scenes[2].id;
    const next = reorderMotionComicShot(before, episode.id, shotId, targetSceneId, 0).episodes[0];
    expect(next.scenes[0].shots.some((shot) => shot.id === shotId)).toBe(false);
    expect(next.scenes[2].shots[0]).toMatchObject({ id: shotId, sceneId: targetSceneId, index: 1 });
    expect(next.timeline.clips[0].shotId).toBe(episode.scenes[0].shots[1].id);
    expect(next.timeline.clips.at(-1)?.shotId).toBe(episode.scenes[2].shots[1].id);
  });
});
