import { describe, expect, it } from 'vitest';
import { resolveEditorialSystemStatus, resolveMotionComicSystemStatus } from '@shared/director-system-status';

describe('director system status summaries', () => {
  it('reports the first actionable editorial dependency in workflow order', () => {
    expect(resolveEditorialSystemStatus({ actionError: true, imageConnected: false, voiceConnected: false, videoRequired: true, videoConnected: false })).toEqual({ tone: 'error', label: '项目需要处理' });
    expect(resolveEditorialSystemStatus({ imageConnected: false, voiceConnected: true, videoRequired: false, videoConnected: false }).label).toBe('图片服务待配置');
    expect(resolveEditorialSystemStatus({ imageConnected: true, voiceConnected: true, videoRequired: true, videoConnected: false }).label).toBe('视频服务待配置');
    expect(resolveEditorialSystemStatus({ imageConnected: true, voiceConnected: false, videoRequired: false, videoConnected: true }).label).toBe('旁白服务待配置');
    expect(resolveEditorialSystemStatus({ imageConnected: true, voiceConnected: true, videoRequired: false, videoConnected: true })).toEqual({ tone: 'ok', label: '生成服务正常' });
  });

  it('distinguishes image connection, reference capability and consistency readiness', () => {
    expect(resolveMotionComicSystemStatus({ imageConnected: false, supportsReferenceImages: false, consistencyReady: false, voiceConnected: true }).label).toBe('图片服务待配置');
    expect(resolveMotionComicSystemStatus({ imageConnected: true, supportsReferenceImages: false, consistencyReady: false, voiceConnected: true }).label).toBe('参考图能力不支持');
    expect(resolveMotionComicSystemStatus({ imageConnected: true, supportsReferenceImages: true, consistencyReady: false, voiceConnected: true }).label).toBe('一致性基准待建立');
    expect(resolveMotionComicSystemStatus({ imageConnected: true, supportsReferenceImages: true, consistencyReady: true, voiceConnected: false }).label).toBe('旁白服务待配置');
  });
});
