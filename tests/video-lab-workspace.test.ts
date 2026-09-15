import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import type { VideoLabRecord } from '../src/shared/video-lab';
import { videoLabInput, videoLabInputIssue, videoLabProviderIssue, videoLabRecordDraft, type VideoLabDraft } from '../src/features/labs/video-lab-helpers';

const provider = { ...defaultConfig.video.providers[0], id: 'manual/video', enabled: true, baseUrl: 'https://video.example', model: 'video-model' };
const draft: VideoLabDraft = {
  prompt: '清晨的海边', providerId: provider.id, durationSec: 5, ratio: '16:9', firstFramePath: '', lastFramePath: '', referenceImagePaths: '',
};

describe('standalone video workbench inputs', () => {
  it('requires the selected service credential, using encoded profile IDs', () => {
    expect(videoLabProviderIssue(provider, { 'video/manual%2Fvideo/apiKey': true })).toBe('');
    expect(videoLabProviderIssue(provider, { 'video/different/apiKey': true })).toContain('API Key');
    expect(videoLabProviderIssue({ ...provider, enabled: false }, { 'video/manual%2Fvideo/apiKey': true })).toContain('未启用');
  });

  it('keeps unsupported references visible in the draft and blocks submission after switching services', () => {
    const withReferences = { ...draft, firstFramePath: 'C:/frame.png', lastFramePath: 'C:/end.png', referenceImagePaths: 'C:/style.png' };
    expect(videoLabInputIssue(withReferences, provider, 50)).toContain('不支持首尾帧');
    const firstLastProvider = { ...provider, capabilities: [...provider.capabilities, 'first-last-frame' as const] };
    expect(videoLabInputIssue(withReferences, firstLastProvider, 50)).toContain('不支持参考图');
    expect(videoLabInput(withReferences)).toMatchObject({ firstFramePath: 'C:/frame.png', lastFramePath: 'C:/end.png', referenceImagePaths: ['C:/style.png'] });
  });

  it('validates required image, maximum duration, ratio and per-attempt budget', () => {
    expect(videoLabInputIssue({ ...draft, lastFramePath: 'C:/end.png' }, provider, 50)).toContain('同时选择首帧');
    expect(videoLabInputIssue({ ...draft, durationSec: 11 }, provider, 50)).toContain('最长支持 10 秒');
    expect(videoLabInputIssue({ ...draft, durationSec: Number.NaN }, provider, 50)).toContain('视频时长');
    expect(videoLabInputIssue({ ...draft, ratio: 'broken' }, provider, 50)).toContain('画面比例');
    expect(videoLabInputIssue(draft, { ...provider, pricePerSecond: 3 }, 10)).toContain('超过视频生成预算');
    expect(videoLabInputIssue(draft, { ...provider, capabilities: ['i2v'] }, 50)).toContain('添加首帧');
  });

  it('reuses every generation parameter without resubmitting record state or results', () => {
    const record: VideoLabRecord = {
      id: 'old-record', prompt: '推近镜头', providerId: provider.id, durationSec: 6, ratio: '9:16', firstFramePath: 'C:/first.png', lastFramePath: 'C:/last.png', referenceImagePaths: ['C:/actor.png', 'C:/style.png'],
      providerName: '原服务', model: 'video-model', status: 'failed', videoPath: '', errorMessage: '服务超时', estimatedCost: 6, createdAt: '2026-09-14T00:00:00.000Z', finishedAt: null,
    };
    expect(videoLabInput(videoLabRecordDraft(record))).toEqual({
      prompt: record.prompt, providerId: record.providerId, durationSec: 6, ratio: '9:16', firstFramePath: record.firstFramePath, lastFramePath: record.lastFramePath, referenceImagePaths: record.referenceImagePaths,
    });
  });
});
