import { describe, expect, it } from 'vitest';
import {
  applyMotionComicPreviousFrameAsFirst,
  appendMotionComicShot,
  createMotionComicDraft,
  createMotionComicStarterProject,
  motionComicPreviousShotFrameId,
  setMotionComicShotFirstFrame,
  setMotionComicShotLastFrame,
} from '../src/shared/motion-comic';

const now = '2026-11-14T00:00:00.000Z';

function fixture() {
  let document = createMotionComicStarterProject(createMotionComicDraft({
    id: 'frame-selection', title: '首尾帧', premise: '雨夜来信', now,
  }), '第一集', now);
  const episode = document.episodes[0];
  const scene = episode.scenes[0];
  document = appendMotionComicShot(document, episode.id, scene.id, { id: `${scene.id}-shot-second` });
  const shots = document.episodes[0].scenes.flatMap((item) => item.shots);
  const first = shots[0];
  const second = shots[1];
  document.assets.push(
    { id: 'frame-a', assetId: `shot-keyframe-${first.id}`, kind: 'image', localPath: 'C:/managed/frame-a.png', createdAt: now, selected: true },
    { id: 'frame-b', assetId: `shot-keyframe-${first.id}`, kind: 'image', localPath: 'C:/managed/frame-b.png', createdAt: now, selected: false },
    { id: 'frame-no-path', assetId: `shot-keyframe-${first.id}`, kind: 'image', createdAt: now, selected: false },
    { id: 'ref-image', assetId: 'motion-comic-reference-character-1', kind: 'image', localPath: 'C:/managed/ref.png', createdAt: now, selected: true },
    { id: 'video-x', assetId: `shot-video-${second.id}`, kind: 'video', localPath: 'C:/managed/video-x.mp4', createdAt: now, selected: true },
  );
  return { document, first, second };
}

const shotOf = (document: ReturnType<typeof fixture>['document'], id: string) =>
  document.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)).find((shot) => shot.id === id)!;

describe('motion-comic first/last frame selection', () => {
  it('sets and clears first and last frames', () => {
    const { document, first } = fixture();
    const withFirst = setMotionComicShotFirstFrame(document, first.id, 'frame-a');
    expect(shotOf(withFirst, first.id).firstFrameAssetVersionId).toBe('frame-a');
    const withLast = setMotionComicShotLastFrame(withFirst, first.id, 'frame-b');
    expect(shotOf(withLast, first.id).lastFrameAssetVersionId).toBe('frame-b');
    expect(shotOf(setMotionComicShotLastFrame(withLast, first.id, undefined), first.id).lastFrameAssetVersionId).toBeUndefined();
    expect(document).toEqual(fixture().document);
  });

  it('returns the same document when nothing changes', () => {
    const { document, first } = fixture();
    const next = setMotionComicShotFirstFrame(document, first.id, 'frame-a');
    expect(setMotionComicShotFirstFrame(next, first.id, 'frame-a')).toBe(next);
  });

  it('rejects missing, unreadable, non-image and series reference assets', () => {
    const { document, first } = fixture();
    expect(() => setMotionComicShotFirstFrame(document, first.id, 'does-not-exist')).toThrow('MOTION_COMIC_FRAME_INVALID');
    expect(() => setMotionComicShotFirstFrame(document, first.id, 'frame-no-path')).toThrow('MOTION_COMIC_FRAME_INVALID');
    expect(() => setMotionComicShotLastFrame(document, first.id, 'video-x')).toThrow('MOTION_COMIC_FRAME_INVALID');
    expect(() => setMotionComicShotFirstFrame(document, first.id, 'ref-image')).toThrow('系列一致性参考图');
    expect(() => setMotionComicShotFirstFrame(document, 'missing-shot', 'frame-a')).toThrow('MOTION_COMIC_SHOT_MISSING');
  });

  it('invalidates only the changed shot video', () => {
    const { document, first, second } = fixture();
    const bound = structuredClone(document);
    for (const shot of [shotOf(bound, first.id), shotOf(bound, second.id)]) {
      shot.videoAssetVersionId = 'video-x';
      shot.videoJobId = 'job-x';
    }
    const next = setMotionComicShotFirstFrame(bound, second.id, 'frame-a');
    expect(shotOf(next, second.id).videoAssetVersionId).toBeUndefined();
    expect(shotOf(next, second.id).videoJobId).toBeUndefined();
    expect(shotOf(next, first.id).videoAssetVersionId).toBe('video-x');
  });

  it('uses the previous shot last frame, falling back to its first frame', () => {
    const { document, first, second } = fixture();
    expect(motionComicPreviousShotFrameId(document, first.id)).toBeUndefined();
    expect(motionComicPreviousShotFrameId(document, second.id)).toBeUndefined();
    const withFirst = setMotionComicShotFirstFrame(document, first.id, 'frame-a');
    expect(motionComicPreviousShotFrameId(withFirst, second.id)).toBe('frame-a');
    const withLast = setMotionComicShotLastFrame(withFirst, first.id, 'frame-b');
    expect(motionComicPreviousShotFrameId(withLast, second.id)).toBe('frame-b');
  });

  it('applies the previous shot frame as this shot first frame', () => {
    const { document, first, second } = fixture();
    expect(() => applyMotionComicPreviousFrameAsFirst(document, second.id)).toThrow('MOTION_COMIC_PREVIOUS_FRAME_MISSING');
    const prepared = setMotionComicShotLastFrame(document, first.id, 'frame-b');
    const next = applyMotionComicPreviousFrameAsFirst(prepared, second.id);
    expect(shotOf(next, second.id).firstFrameAssetVersionId).toBe('frame-b');
  });
});
