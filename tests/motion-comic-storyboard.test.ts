import { describe, expect, it } from 'vitest';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import type { DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import { storyboardDurationMs, storyboardImageStatus, storyboardKeyframeActionLabel, storyboardKeyframeHint, storyboardSceneGroups, storyboardSelectedShot, storyboardShotStatusTone } from '../src/features/motion-comic/motion-comic-storyboard';

const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'board', title: 'Board', premise: 'Story', now: '2026-01-01T00:00:00Z' }), 'Episode', '2026-01-01T00:00:00Z');
const episode = document.episodes[0];
const shots: DirectorShot[] = episode.scenes.flatMap((scene) => scene.shots).map((shot, index) => ({ id: shot.id, index: index + 1, title: shot.title, scene: 'same title', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' }));

describe('storyboard projection helpers', () => {
  it('groups by canonical scene identity and retains projection references', () => {
    const groups = storyboardSceneGroups(episode, shots);
    expect(groups.map((group) => group.id)).toEqual(episode.scenes.map((scene) => scene.id));
    expect(groups[0].shots[0]).toBe(shots[0]);
    expect(groups.flatMap((group) => group.shots)).toEqual(shots);
  });
  it('keeps selection by stable ID across order changes and handles removed IDs', () => {
    expect(storyboardSelectedShot([...shots].reverse(), shots[1].id)).toBe(shots[1]);
    expect(storyboardSelectedShot(shots, 'deleted')).toBe(shots[0]);
    expect(storyboardSelectedShot([], 'deleted')).toBeUndefined();
  });
  it('only accepts finite positive durations and preserves milliseconds', () => {
    expect(storyboardDurationMs('3.2')).toBe(3200);
    for (const invalid of ['', ' ', '0', '-2', 'Infinity', 'NaN']) expect(storyboardDurationMs(invalid)).toBeUndefined();
  });
  it('labels unknown submissions without changing their persisted running state', () => {
    const shot: DirectorShot = { ...shots[0], videoJobStatus: 'running', videoRecovery: 'unknown' };
    expect(storyboardImageStatus(shot)).toBe('提交结果待核对');
    expect(shot.videoJobStatus).toBe('running');
    expect(storyboardImageStatus({ ...shot, videoRecovery: 'resume' })).toBe('视频生成中');
    expect(storyboardImageStatus({ ...shot, videoUrl: 'file:///previous.mp4' })).toBe('提交结果待核对');
  });
  it('labels image availability without pretending that it is review approval', () => {
    expect(storyboardImageStatus(shots[0])).toBe('待生成画面');
    expect(storyboardImageStatus({ ...shots[0], imageReady: true })).toBe('画面已就绪');
    expect(storyboardImageStatus({ ...shots[0], imageFailed: true })).toBe('生成失败');
  });
  it('shows remote-video readiness and keeps optional references mode keyframes explicit', () => {
    const remoteWithoutFrame: DirectorShot = { ...shots[0], renderStrategy: 'living-poster', videoInputReady: true };
    expect(storyboardImageStatus(remoteWithoutFrame)).toBe('待生成视频');
    expect(storyboardShotStatusTone(remoteWithoutFrame)).toBe('pending');
    expect(storyboardKeyframeActionLabel(remoteWithoutFrame)).toBe('生成可选关键帧');
    expect(storyboardKeyframeHint(remoteWithoutFrame)).toContain('首帧关键帧可选');
    expect(storyboardImageStatus({ ...remoteWithoutFrame, videoJobStatus: 'running' })).toBe('视频生成中');
    const videoReady = { ...remoteWithoutFrame, videoUrl: 'file:///clip.mp4', videoJobStatus: 'completed' as const };
    expect(storyboardImageStatus(videoReady)).toBe('视频已就绪');
    expect(storyboardShotStatusTone(videoReady)).toBe('ready');
    expect(storyboardShotStatusTone({ ...remoteWithoutFrame, videoJobStatus: 'failed' })).toBe('failed');
  });
});
