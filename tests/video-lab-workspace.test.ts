import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import type { VideoLabRecord } from '../src/shared/video-lab';
import { videoLabInput, videoLabInputIssue, videoLabProviderIssue, videoLabRecordDraft, videoLabResolutionOptions, type VideoLabDraft } from '../src/features/labs/video-lab-helpers';

const provider = { ...defaultConfig.video.providers[0], id: 'manual/video', enabled: true, baseUrl: 'https://video.example', model: 'video-model' };
const draft: VideoLabDraft = {
  mode: 'text', prompt: '清晨的海边', providerId: provider.id, durationSec: 5, ratio: '16:9', resolution: '720P', generateAudio: true,
  firstFramePath: '', lastFramePath: '', referenceImages: [], referenceVideoPaths: [], referenceAudioPaths: [],
};

describe('standalone video workbench inputs', () => {
  it('requires the selected service credential, using encoded profile IDs', () => {
    expect(videoLabProviderIssue(provider, { 'video/manual%2Fvideo/apiKey': true })).toBe('');
    expect(videoLabProviderIssue(provider, { 'video/different/apiKey': true })).toContain('API Key');
    expect(videoLabProviderIssue({ ...provider, enabled: false }, { 'video/manual%2Fvideo/apiKey': true })).toBe('');
  });

  it('keeps unsupported references visible in the draft and blocks submission after switching services', () => {
    const withReferences = { ...draft, mode: 'references' as const, firstFramePath: 'C:/frame.png', lastFramePath: 'C:/end.png', referenceImages: [{ path: 'C:/style.png', kind: 'style' as const, description: '' }] };
    expect(videoLabInputIssue(withReferences, provider, 50)).toContain('不支持参考图');
    const firstLastProvider = { ...provider, capabilities: [...provider.capabilities, 'first-last-frame' as const] };
    expect(videoLabInputIssue(withReferences, firstLastProvider, 50)).toContain('不支持参考图');
    expect(videoLabInput(withReferences)).toMatchObject({ referenceImages: [{ path: 'C:/style.png', kind: 'style', description: '' }] });
  });

  it('validates required image, maximum duration, ratio and per-attempt budget', () => {
    expect(videoLabInputIssue({ ...draft, mode: 'frames', lastFramePath: 'C:/end.png' }, provider, 50)).toContain('同时选择首帧');
    expect(videoLabInputIssue({ ...draft, durationSec: 11 }, provider, 50)).toContain('最长支持 10 秒');
    expect(videoLabInputIssue({ ...draft, durationSec: Number.NaN }, provider, 50)).toContain('视频时长');
    expect(videoLabInputIssue({ ...draft, ratio: 'broken' }, provider, 50)).toContain('画面比例');
    expect(videoLabInputIssue(draft, { ...provider, pricePerSecond: 3 }, 10)).toContain('超过视频生成预算');
    expect(videoLabInputIssue(draft, { ...provider, capabilities: ['i2v'] }, 50)).toContain('切换到首尾帧');
  });

  it('distinguishes standard H3 from H3 Max and ignores references hidden by another mode', () => {
    expect(videoLabResolutionOptions('MiniMax-H3', '1080P')).toEqual(['768P', '2K']);
    expect(videoLabResolutionOptions('MiniMax-H3-Max', '1080P')).toEqual(['480P', '768P']);
    const h3 = { ...provider, model: 'MiniMax-H3', modelPreset: 'h3' as const, maxDurationSec: 15, maxResolution: '2K', capabilities: ['t2v' as const] };
    const hiddenReferences = { ...draft, modelPreset: 'h3' as const, referenceImages: Array.from({ length: 30 }, (_, index) => ({ path: `C:/hidden-${index}.png`, kind: 'style' as const, description: '' })), resolution: '768P' };
    expect(videoLabInputIssue(hiddenReferences, h3, 50)).toBe('');
    expect(videoLabInputIssue({ ...hiddenReferences, durationSec: 4.5 }, h3, 50)).toContain('整数');
  });

  it('reuses every generation parameter without resubmitting record state or results', () => {
    const record: VideoLabRecord = {
      id: 'old-record', prompt: '推近镜头', providerId: provider.id, durationSec: 6, ratio: '9:16', resolution: '1080P', generateAudio: true, firstFramePath: 'C:/first.png', lastFramePath: 'C:/last.png',
      providerName: '原服务', model: 'video-model', status: 'failed', videoPath: '', errorMessage: '服务超时', estimatedCost: 6, createdAt: '2026-09-14T00:00:00.000Z', finishedAt: null,
    };
    expect(videoLabInput(videoLabRecordDraft(record))).toEqual({ prompt: record.prompt, providerId: record.providerId,
      durationSec: 6, ratio: '9:16', resolution: '1080P', generateAudio: true,
      firstFramePath: record.firstFramePath, lastFramePath: record.lastFramePath });
  });
});
