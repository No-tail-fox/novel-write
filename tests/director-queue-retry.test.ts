import { describe, expect, it, vi } from 'vitest';
import { directorQueueHasActiveImage, directorQueueKind, directorQueueRetryLabel, retryDirectorQueueItem } from '../src/features/director-desk/director-queue';
import { createDirectorBatchPlan, directorBatchUnavailableReasons, runDirectorBatchPlan, type DirectorBatchNode } from '../src/features/director-desk/director-batch';

describe('generation queue retries', () => {
  const target = { id: 'opaque-provider-job-id', shotId: 'shot-1', title: '标题随时可编辑' };

  it('sends a failed video to the video retry handler without generating an image', async () => {
    const image = vi.fn(), video = vi.fn();
    await retryDirectorQueueItem({ ...target, kind: 'shot-video' }, { 'shot-image': image, 'shot-video': video });
    expect(video).toHaveBeenCalledExactlyOnceWith('shot-1');
    expect(image).not.toHaveBeenCalled();
    expect(directorQueueRetryLabel({ ...target, kind: 'shot-video' })).toBe('重试视频');
  });

  it('keeps voice, style and legacy comic-image requests separate', async () => {
    const image = vi.fn(), voice = vi.fn(), style = vi.fn();
    const handlers = { 'shot-image': image, 'shot-voice': voice, 'style-sample': style };
    await retryDirectorQueueItem({ ...target, kind: 'shot-voice' }, handlers);
    expect(voice).toHaveBeenCalledExactlyOnceWith('shot-1');
    expect(image).not.toHaveBeenCalled();
    await retryDirectorQueueItem({ ...target, kind: 'style-sample', shotId: 'style-candidate:paper' }, handlers);
    expect(style).toHaveBeenCalledExactlyOnceWith('paper');
    await retryDirectorQueueItem(target, handlers);
    expect(image).toHaveBeenCalledExactlyOnceWith('shot-1');
    expect(directorQueueKind({ ...target, kind: 'shot-image', title: '动态海报如何制作' })).toBe('shot-image');
    expect(directorQueueKind({ ...target, title: '动态海报如何制作' })).toBe('shot-image');
  });

  it('surfaces an unavailable handler or provider failure instead of claiming success', async () => {
    await expect(retryDirectorQueueItem({ ...target, kind: 'shot-voice' }, {})).rejects.toThrow('重试旁白尚未接入');
    await expect(retryDirectorQueueItem({ ...target, kind: 'shot-video' }, { 'shot-video': async () => { throw new Error('视频服务超时'); } })).rejects.toThrow('视频服务超时');
  });

  it('retries a project render without generating shot assets', async () => {
    const image = vi.fn(), render = vi.fn();
    await retryDirectorQueueItem({ ...target, shotId: 'project-1', kind: 'project-render' }, { 'shot-image': image, 'project-render': render });
    expect(render).toHaveBeenCalledExactlyOnceWith('project-1');
    expect(image).not.toHaveBeenCalled();
  });

  it('keeps image generation available while the same shot has voice or video work in progress', () => {
    expect(directorQueueHasActiveImage([
      { ...target, kind: 'shot-voice', status: 'running' },
      { ...target, kind: 'shot-video', status: 'waiting' },
      { ...target, kind: 'shot-image', status: 'completed' },
      { ...target, kind: 'shot-image', status: 'failed' },
      { ...target, kind: 'shot-image', shotId: 'other-shot', status: 'running' },
    ], target.shotId)).toBe(false);
  });

  it.each(['running', 'waiting'])('blocks duplicate image requests when an older image attempt is %s', (status) => {
    expect(directorQueueHasActiveImage([
      { ...target, kind: 'shot-voice', status: 'completed' },
      { ...target, kind: 'shot-image', id: 'latest-image', status: 'failed' },
      { ...target, kind: 'shot-image', id: 'older-image', status },
    ], target.shotId)).toBe(true);
    expect(directorQueueHasActiveImage([{ ...target, status }], target.shotId)).toBe(true);
  });
});

describe('batch retry preflight', () => {
  it('retries the failed video even when unused image and voice services are unavailable', async () => {
    const failed: DirectorBatchNode = { id: 'batch:video:shot-1', capability: 'video', shotId: 'shot-1', title: '镜头视频', status: 'failed', dependencies: ['batch:image:shot-1'], estimatedCost: 0, error: '上次超时' };
    const image = vi.fn(), video = vi.fn();
    expect(directorBatchUnavailableReasons([failed], { image: '图片离线', voice: '旁白离线' })).toEqual([]);
    const result = await runDirectorBatchPlan([failed], { image, video });
    expect(video).toHaveBeenCalledOnce();
    expect(image).not.toHaveBeenCalled();
    expect(result.nodes[0]).toMatchObject({ status: 'completed', error: undefined });
  });

  it('checks auto-added keyframe work even when the image capability was not explicitly selected', () => {
    const plan = createDirectorBatchPlan({ scope: 'missing', capabilities: { image: false, video: true, voice: false, render: false }, outputReady: false, shots: [{ id: 'needs-frame', title: '缺少首帧', renderStrategy: 'living-poster', imageReady: false, videoReady: false, voiceReady: true, imageFailed: false, videoFailed: false, voiceFailed: false }] });
    expect(plan.nodes.map((node) => node.capability)).toEqual(['image', 'video']);
    expect(directorBatchUnavailableReasons(plan.nodes, { image: '请先配置图片服务', voice: '不应显示此旁白错误' })).toEqual(['请先配置图片服务']);
  });
});
