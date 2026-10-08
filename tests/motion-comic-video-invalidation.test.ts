import { describe, expect, it } from 'vitest';
import { applyMotionComicImageRecord, restoreMotionComicImageVersion } from '../src/features/director-desk/director-generation';
import {
  appendMotionComicShot,
  createMotionComicDraft,
  createMotionComicStarterProject,
  invalidateMotionComicShotVideo,
  updateMotionComicRatio,
  updateMotionComicShotDuration,
} from '../src/shared/motion-comic';
import type { ImageLabRecord } from '../src/shared/types';
import { invalidateMotionComicVideosForChangedInputs } from '../src/shared/motion-comic-video';

const now = '2026-09-18T00:00:00.000Z';

function fixture() {
  const document = createMotionComicStarterProject(createMotionComicDraft({
    id: 'comic-video-invalidation', title: '雨夜来信', premise: '两个人在雨夜交换一封信。', now,
  }), '第一集', now);
  const episode = document.episodes[0];
  const shot = episode.scenes[0].shots[0];
  const otherShot = episode.scenes.at(-1)!.shots[0];
  shot.renderStrategy = 'remote-video';
  otherShot.renderStrategy = 'remote-video';
  shot.firstFrameAssetVersionId = 'frame-current';
  otherShot.firstFrameAssetVersionId = 'frame-other';
  shot.videoAssetVersionId = 'video-current';
  shot.videoJobId = 'video-job-current';
  otherShot.videoAssetVersionId = 'video-other';
  otherShot.videoJobId = 'video-job-other';
  document.assets.push(
    { id: 'frame-old', assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: 'C:/managed/frame-old.png', createdAt: now, selected: false },
    { id: 'frame-current', assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: 'C:/managed/frame-current.png', createdAt: now, selected: true },
    { id: 'frame-other', assetId: `shot-keyframe-${otherShot.id}`, kind: 'image', localPath: 'C:/managed/frame-other.png', createdAt: now, selected: true },
    { id: 'video-history', assetId: `shot-video-${shot.id}`, kind: 'video', localPath: 'C:/managed/video-history.mp4', createdAt: now, selected: false },
    { id: 'video-current', assetId: `shot-video-${shot.id}`, kind: 'video', localPath: 'C:/managed/video-current.mp4', createdAt: now, selected: true },
    { id: 'video-other', assetId: `shot-video-${otherShot.id}`, kind: 'video', localPath: 'C:/managed/video-other.mp4', createdAt: now, selected: true },
    { id: 'voice-current', assetId: `shot-voice-${shot.id}`, kind: 'audio', localPath: 'C:/managed/voice.wav', createdAt: now, selected: true },
  );
  episode.timeline.clips.find((clip) => clip.shotId === shot.id)!.assetVersionIds = ['frame-current', 'video-history', 'video-current', 'voice-current'];
  episode.timeline.clips.find((clip) => clip.shotId === otherShot.id)!.assetVersionIds = ['frame-other', 'video-other'];
  document.providerJobs.push(
    { id: 'video-job-current', workflowKind: 'motion-comic', nodeId: shot.id, episodeId: episode.id, providerId: 'remote', model: 'model', capability: 'image-to-video', status: 'completed', inputHash: 'current', idempotencyKey: 'current', estimatedCost: 1, attempt: 1, createdAt: now, updatedAt: now },
    { id: 'video-job-other', workflowKind: 'motion-comic', nodeId: otherShot.id, episodeId: episode.id, providerId: 'remote', model: 'model', capability: 'image-to-video', status: 'completed', inputHash: 'other', idempotencyKey: 'other', estimatedCost: 1, attempt: 1, createdAt: now, updatedAt: now },
  );
  return { document, episode, shot, otherShot };
}

function generatedImage(id = 'generated-frame'): ImageLabRecord {
  return {
    id,
    prompt: '雨夜门口，两个人交换信封',
    ratio: '9:16',
    style: 'cinematic',
    provider: 'gpt_image',
    imagePath: `C:/managed/${id}.png`,
    status: 'generated',
    errorMessage: '',
    resolution: '2K',
    quality: 'medium',
    smartMode: 'reference-edit',
    referenceImagePaths: [],
    referenceImagePath: '',
    upstreamTaskId: null,
    createdAt: now,
    finishedAt: now,
  };
}

describe('motion-comic derived video invalidation', () => {
  it('clears only the target shot video bindings while preserving asset and job history', () => {
    const { document, episode, shot, otherShot } = fixture();
    const before = structuredClone(document);
    const next = invalidateMotionComicShotVideo(document, shot.id);
    const target = next.episodes[0].scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === shot.id)!;
    const sibling = next.episodes[0].scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === otherShot.id)!;
    const clip = next.episodes[0].timeline.clips.find((candidate) => candidate.shotId === shot.id)!;

    expect(target.videoAssetVersionId).toBeUndefined();
    expect(target.videoJobId).toBeUndefined();
    expect(clip.assetVersionIds).toEqual(['frame-current', 'voice-current']);
    expect(next.assets.find((asset) => asset.id === 'video-current')).toMatchObject({ selected: false, localPath: 'C:/managed/video-current.mp4' });
    expect(next.assets.find((asset) => asset.id === 'video-history')?.localPath).toBe('C:/managed/video-history.mp4');
    expect(sibling).toMatchObject({ videoAssetVersionId: 'video-other', videoJobId: 'video-job-other' });
    expect(next.assets.find((asset) => asset.id === 'video-other')?.selected).toBe(true);
    expect(next.episodes[0].timeline.clips.find((candidate) => candidate.shotId === otherShot.id)?.assetVersionIds).toEqual(['frame-other', 'video-other']);
    expect(next.providerJobs).toEqual(document.providerJobs);
    expect(document).toEqual(before);
    expect(invalidateMotionComicShotVideo(next, shot.id)).toBe(next);
    expect(episode.id).toBe(next.episodes[0].id);
  });

  it('invalidates a derived video when a generated keyframe replaces the first frame', () => {
    const { document, shot } = fixture();
    const next = applyMotionComicImageRecord(document, shot.id, generatedImage(), 'gpt-image-2');
    const updated = next.episodes[0].scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === shot.id)!;
    const clip = next.episodes[0].timeline.clips.find((candidate) => candidate.shotId === shot.id)!;

    expect(updated).toMatchObject({ firstFrameAssetVersionId: 'image-asset-generated-frame' });
    expect(updated.videoAssetVersionId).toBeUndefined();
    expect(updated.videoJobId).toBeUndefined();
    expect(clip.assetVersionIds).not.toContain('video-current');
    expect(next.assets.find((asset) => asset.id === 'video-current')?.selected).toBe(false);
    expect(next.assets.find((asset) => asset.id === 'image-asset-generated-frame')?.selected).toBe(true);
  });

  it('invalidates on a different restored first frame but keeps video bindings for the same frame', () => {
    const different = fixture();
    const restored = restoreMotionComicImageVersion(different.document, different.shot.id, 'frame-old');
    const restoredShot = restored.episodes[0].scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === different.shot.id)!;
    const restoredClip = restored.episodes[0].timeline.clips.find((candidate) => candidate.shotId === different.shot.id)!;
    expect(restoredShot).toMatchObject({ firstFrameAssetVersionId: 'frame-old' });
    expect(restoredShot.videoAssetVersionId).toBeUndefined();
    expect(restoredShot.videoJobId).toBeUndefined();
    expect(restoredClip.assetVersionIds).toEqual(['frame-old', 'voice-current']);
    expect(restored.assets.find((asset) => asset.id === 'video-current')?.selected).toBe(false);

    const same = fixture();
    const unchanged = restoreMotionComicImageVersion(same.document, same.shot.id, 'frame-current');
    const unchangedShot = unchanged.episodes[0].scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === same.shot.id)!;
    expect(unchangedShot).toMatchObject({ videoAssetVersionId: 'video-current', videoJobId: 'video-job-current' });
    expect(unchanged.episodes[0].timeline.clips.find((clip) => clip.shotId === same.shot.id)?.assetVersionIds).toContain('video-current');
    expect(unchanged.assets.find((asset) => asset.id === 'video-current')?.selected).toBe(true);
  });

  it('uses the same invalidation for duration edits and never inherits video output into an appended shot', () => {
    const { document, episode, shot } = fixture();
    expect(updateMotionComicShotDuration(document, episode.id, shot.id, shot.durationMs)).toBe(document);
    expect(document.assets.find((asset) => asset.id === 'video-current')?.selected).toBe(true);
    const resized = updateMotionComicShotDuration(document, episode.id, shot.id, shot.durationMs + 1_000);
    const resizedShot = resized.episodes[0].scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === shot.id)!;
    expect(resizedShot.videoAssetVersionId).toBeUndefined();
    expect(resizedShot.videoJobId).toBeUndefined();
    expect(resized.episodes[0].timeline.clips.find((clip) => clip.shotId === shot.id)?.assetVersionIds).not.toContain('video-current');
    expect(resized.assets.find((asset) => asset.id === 'video-current')?.selected).toBe(false);

    const appended = appendMotionComicShot(document, episode.id, episode.scenes[0].id, { id: 'appended-shot' });
    const appendedShot = appended.episodes[0].scenes[0].shots.find((candidate) => candidate.id === 'appended-shot')!;
    expect(appendedShot.videoAssetVersionId).toBeUndefined();
    expect(appendedShot.videoJobId).toBeUndefined();
  });

  it('invalidates every selected shot video and prior final output when the project ratio changes', () => {
    const { document, shot, otherShot } = fixture();
    document.assets.push({
      id: 'old-final', assetId: 'director-final-video', kind: 'video', localPath: 'C:/managed/final.mp4',
      createdAt: now, selected: true, pinned: true,
    });

    expect(updateMotionComicRatio(document, document.ratio)).toBe(document);
    const next = updateMotionComicRatio(document, '16:9');
    const updatedShots = next.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));

    expect(next.ratio).toBe('16:9');
    expect(updatedShots.find((candidate) => candidate.id === shot.id)).toMatchObject({ videoAssetVersionId: undefined, videoJobId: undefined });
    expect(updatedShots.find((candidate) => candidate.id === otherShot.id)).toMatchObject({ videoAssetVersionId: undefined, videoJobId: undefined });
    expect(next.assets.filter((asset) => asset.kind === 'video').every((asset) => asset.selected !== true)).toBe(true);
    expect(next.assets.find((asset) => asset.id === 'old-final')).toMatchObject({ selected: false, pinned: false });
    expect(next.providerJobs).toEqual(document.providerJobs);
  });

  it('invalidates only shots whose series entity input changed', () => {
    const { document, shot, otherShot } = fixture();
    const changed = structuredClone(document);
    const scene = changed.sceneAssets.find((asset) => asset.id === shot.sceneAssetId)!;
    scene.prompt = `${scene.prompt}, neon rain reflections`;
    const next = invalidateMotionComicVideosForChangedInputs(document, changed);
    const shots = next.episodes[0].scenes.flatMap((item) => item.shots);

    expect(shots.find((candidate) => candidate.id === shot.id)).toMatchObject({ videoAssetVersionId: undefined, videoJobId: undefined });
    expect(shots.find((candidate) => candidate.id === otherShot.id)).toMatchObject({ videoAssetVersionId: 'video-other', videoJobId: 'video-job-other' });
    expect(next.assets.find((asset) => asset.id === 'video-current')?.selected).toBe(false);
    expect(next.assets.find((asset) => asset.id === 'video-other')?.selected).toBe(true);
    expect(next.providerJobs).toEqual(document.providerJobs);
  });

  it('invalidates bound videos when a fixed continuity reference changes', () => {
    const { document, shot, otherShot } = fixture();
    const scene = document.sceneAssets.find((asset) => asset.id === shot.sceneAssetId)!;
    scene.referenceAssetVersionIds = ['scene-reference-old'];
    document.assets.push({ id: 'scene-reference-old', assetId: `scene-reference-${scene.id}`, kind: 'image', localPath: 'C:/managed/scene-old.png', selected: true, pinned: true, createdAt: now });
    const changed = structuredClone(document);
    const changedScene = changed.sceneAssets.find((asset) => asset.id === scene.id)!;
    changedScene.referenceAssetVersionIds.push('scene-reference-new');
    changed.assets.find((asset) => asset.id === 'scene-reference-old')!.selected = false;
    changed.assets.find((asset) => asset.id === 'scene-reference-old')!.pinned = false;
    changed.assets.push({ id: 'scene-reference-new', assetId: `scene-reference-${scene.id}`, kind: 'image', localPath: 'C:/managed/scene-new.png', selected: true, pinned: true, createdAt: now });
    const next = invalidateMotionComicVideosForChangedInputs(document, changed);
    const shots = next.episodes[0].scenes.flatMap((item) => item.shots);

    expect(shots.find((candidate) => candidate.id === shot.id)?.videoAssetVersionId).toBeUndefined();
    expect(shots.find((candidate) => candidate.id === otherShot.id)?.videoAssetVersionId).toBe('video-other');
  });
});
