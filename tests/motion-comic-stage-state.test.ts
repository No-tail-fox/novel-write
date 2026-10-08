import { describe, expect, it } from 'vitest';
import {
  appendMotionComicEpisode,
  createMotionComicDraft,
  createMotionComicStarterProject,
  type MotionComicPipelineData,
} from '@shared/motion-comic';
import {
  motionComicDialogueCueAudioReady,
  motionComicShotVideoReady,
  resolveMotionComicActiveEpisodeReadiness,
  resolveMotionComicStageState,
} from '../src/features/motion-comic/motion-comic-stage-state';

const now = '2026-09-18T00:00:00.000Z';

function twoEpisodeFixture(): MotionComicPipelineData {
  let document = createMotionComicStarterProject(createMotionComicDraft({
    id: 'stage-state-comic',
    title: '分集状态',
    premise: '第一集完成后，第二集仍在制作。',
    now,
  }), '第一集', now);
  const firstEpisodeId = document.episodes[0].id;
  document = appendMotionComicEpisode(document, { id: 'episode-stage-state-2', title: '第二集', now });
  document.activeEpisodeId = firstEpisodeId;

  const firstEpisode = document.episodes.find((episode) => episode.id === firstEpisodeId)!;
  for (const shot of firstEpisode.scenes.flatMap((scene) => scene.shots)) {
    const frameId = `frame-${shot.id}`;
    const videoId = `video-${shot.id}`;
    const jobId = `video-job-${shot.id}`;
    shot.renderStrategy = 'remote-video';
    shot.firstFrameAssetVersionId = frameId;
    shot.videoAssetVersionId = videoId;
    shot.videoJobId = jobId;
    document.assets.push(
      { id: frameId, assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: `C:/managed/${frameId}.png`, createdAt: now },
      { id: videoId, assetId: `shot-video-${shot.id}`, kind: 'video', localPath: `C:/managed/${videoId}.mp4`, providerJobId: jobId, episodeId: firstEpisode.id, createdAt: now },
    );
    document.providerJobs.push({
      id: jobId,
      workflowKind: 'motion-comic',
      nodeId: shot.id,
      episodeId: firstEpisode.id,
      providerId: 'remote',
      model: 'video-model',
      capability: 'image-to-video',
      status: 'completed',
      inputHash: `hash-${shot.id}`,
      idempotencyKey: `key-${shot.id}`,
      estimatedCost: 1,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const cue of firstEpisode.dialogueCues) {
    const audioId = `audio-${cue.id}`;
    cue.audioAssetVersionId = audioId;
    cue.voiceAssetVersionId = audioId;
    document.assets.push({
      id: audioId,
      assetId: `dialogue-voice-${cue.id}`,
      kind: 'audio',
      localPath: `C:/managed/${audioId}.wav`,
      episodeId: firstEpisode.id,
      createdAt: now,
    });
  }
  return document;
}

describe('motion comic active-episode stage state', () => {
  it('does not let an unfinished sibling episode block the current episode', () => {
    const document = twoEpisodeFixture();
    const current = resolveMotionComicActiveEpisodeReadiness(document);
    const stages = resolveMotionComicStageState(document, new Set(), false);

    expect(current.episode?.number).toBe(1);
    expect(current.storyboardComplete).toBe(true);
    expect(current.videoComplete).toBe(true);
    expect(current.audioComplete).toBe(true);
    expect(stages.storyboard.complete).toBe(true);
    expect(stages.video.complete).toBe(true);
    expect(stages.audio.complete).toBe(true);
    expect(stages.video.detail).toBe(`${current.shotCount}/${current.shotCount} 远程视频已就绪`);

    document.activeEpisodeId = document.episodes[1].id;
    const sibling = resolveMotionComicActiveEpisodeReadiness(document);
    const siblingStages = resolveMotionComicStageState(document, new Set(), false);
    expect(sibling.episode?.number).toBe(2);
    expect(sibling.storyboardComplete).toBe(false);
    expect(sibling.videoComplete).toBe(false);
    expect(sibling.audioComplete).toBe(false);
    expect(siblingStages.storyboard.complete).toBe(false);
    expect(siblingStages.video.complete).toBe(false);
    expect(siblingStages.audio.complete).toBe(false);
  });

  it('requires a usable video asset and its authoritative completed shot job', () => {
    const document = twoEpisodeFixture();
    const shot = document.episodes[0].scenes[0].shots[0];
    expect(motionComicShotVideoReady(document, shot)).toBe(true);

    const mutations: Array<(candidate: MotionComicPipelineData) => void> = [
      (candidate) => { candidate.assets.find((asset) => asset.id === shot.videoAssetVersionId)!.localPath = '   '; },
      (candidate) => { candidate.assets.find((asset) => asset.id === shot.videoAssetVersionId)!.kind = 'image'; },
      (candidate) => { candidate.assets.find((asset) => asset.id === shot.videoAssetVersionId)!.providerJobId = 'another-job'; },
      (candidate) => { candidate.providerJobs.find((job) => job.id === shot.videoJobId)!.nodeId = 'another-shot'; },
      (candidate) => { candidate.providerJobs.find((job) => job.id === shot.videoJobId)!.capability = 'text-to-image'; },
      (candidate) => { candidate.providerJobs.find((job) => job.id === shot.videoJobId)!.status = 'running'; },
      (candidate) => { candidate.assets = candidate.assets.filter((asset) => asset.id !== shot.videoAssetVersionId); },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(document);
      mutate(invalid);
      const invalidShot = invalid.episodes[0].scenes[0].shots[0];
      expect(motionComicShotVideoReady(invalid, invalidShot)).toBe(false);
      expect(resolveMotionComicActiveEpisodeReadiness(invalid).videoComplete).toBe(false);
    }
  });

  it('treats legacy image-motion shots as video-ready from their usable first frames', () => {
    const document = twoEpisodeFixture();
    const episode = document.episodes[0];
    const shots = episode.scenes.flatMap((scene) => scene.shots);
    for (const shot of shots) {
      shot.renderStrategy = 'image-motion';
      shot.videoAssetVersionId = undefined;
      shot.videoJobId = undefined;
    }
    document.assets = document.assets.filter((asset) => asset.kind !== 'video');
    document.providerJobs = [];

    expect(shots.every((shot) => motionComicShotVideoReady(document, shot))).toBe(true);
    expect(resolveMotionComicActiveEpisodeReadiness(document)).toMatchObject({
      storyboardComplete: true,
      videoReadyCount: shots.length,
      videoComplete: true,
      generationComplete: true,
    });
    expect(resolveMotionComicStageState(document, new Set(), false).audio.ready).toBe(true);

    const firstFrame = document.assets.find((asset) => asset.id === shots[0].firstFrameAssetVersionId)!;
    firstFrame.localPath = '   ';
    expect(motionComicShotVideoReady(document, shots[0])).toBe(false);
    expect(resolveMotionComicActiveEpisodeReadiness(document).videoComplete).toBe(false);
  });

  it('counts only existing audio assets with the correct kind and a non-empty local path', () => {
    const document = twoEpisodeFixture();
    const episode = document.episodes[0];
    const cue = episode.dialogueCues[0];
    const shot = episode.scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === cue.shotId)!;
    expect(motionComicDialogueCueAudioReady(document, cue, shot)).toBe(true);

    for (const mutate of [
      (candidate: MotionComicPipelineData) => { candidate.assets.find((asset) => asset.id === cue.audioAssetVersionId)!.localPath = ''; },
      (candidate: MotionComicPipelineData) => { candidate.assets.find((asset) => asset.id === cue.audioAssetVersionId)!.kind = 'video'; },
      (candidate: MotionComicPipelineData) => { candidate.assets = candidate.assets.filter((asset) => asset.id !== cue.audioAssetVersionId); },
    ]) {
      const invalid = structuredClone(document);
      mutate(invalid);
      const invalidEpisode = invalid.episodes[0];
      const invalidCue = invalidEpisode.dialogueCues[0];
      const invalidShot = invalidEpisode.scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === invalidCue.shotId)!;
      expect(motionComicDialogueCueAudioReady(invalid, invalidCue, invalidShot)).toBe(false);
      expect(resolveMotionComicActiveEpisodeReadiness(invalid).audioComplete).toBe(false);
    }
  });
});
