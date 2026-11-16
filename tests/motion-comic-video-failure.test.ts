import { describe, expect, it } from 'vitest';
import { AppError, serializeAppErrorForBridge } from '../src/shared/app-error';
import { buildVideoFailureDiagnostics, isContentPolicyFailure, motionComicVideoErrorMessage, videoFailureHint } from '../src/features/motion-comic/motion-comic-video-failure';

describe('motion comic video failure helpers', () => {
  it('decodes rejected generation IPC errors and preserves the original diagnostic', () => {
    const encoded = serializeAppErrorForBridge(new AppError('VIDEO_REJECTED', '存在未定义的参数，请检查视频服务配置。', false, 'video-diagnostic-1'));
    for (const error of [encoded, new Error(`Error invoking remote method: ${encoded}`)]) {
      const message = motionComicVideoErrorMessage(error);
      expect(message).toContain('存在未定义的参数');
      expect(message).toContain('video-diagnostic-1');
      expect(message).not.toContain('__STORYDREAM_SAFE_APP_ERROR_V1__');
      expect(message).not.toContain('%');
    }
  });

  it('retains ordinary failure causes while redacting secrets', () => {
    const message = motionComicVideoErrorMessage(new Error('视频下载失败 api_key=secret-value', { cause: new Error('ECONNRESET') }));
    expect(message).toContain('视频下载失败');
    expect(message).toContain('ECONNRESET');
    expect(message).toContain('诊断号');
    expect(message).not.toContain('secret-value');
  });

  it('recognises content-policy failures', () => {
    expect(isContentPolicyFailure('OutputVideoSensitiveContentDetected')).toBe(true);
    expect(isContentPolicyFailure('request blocked by content policy')).toBe(true);
    expect(isContentPolicyFailure('内容涉嫌违规')).toBe(true);
  });

  it('does not flag ordinary failures', () => {
    expect(isContentPolicyFailure('network timeout')).toBe(false);
    expect(isContentPolicyFailure(undefined)).toBe(false);
    expect(videoFailureHint('network timeout')).toBe('');
  });

  it('suggests switching provider only for moderation failures', () => {
    expect(videoFailureHint('moderation rejected')).toContain('切换视频服务');
  });

  it('builds a diagnostics block without prompts or paths', () => {
    const text = buildVideoFailureDiagnostics({ shotTitle: '雨夜', jobId: 'job-1', providerLabel: 'Seedance', providerModel: 'v1', status: 'failed', error: 'boom' });
    expect(text.split('\n')).toEqual(['镜头：雨夜', '任务：job-1', '视频服务：Seedance · v1', '状态：failed', '错误：boom']);
    expect(buildVideoFailureDiagnostics({ shotTitle: 'a', providerLabel: 'p', providerModel: 'm', status: 'failed' })).toContain('任务：无');
  });
});
