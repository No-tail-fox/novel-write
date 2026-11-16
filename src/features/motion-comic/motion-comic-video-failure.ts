import { describeErrorCause, formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';

/** Decode safe IPC errors before displaying them; retain a redacted cause for ordinary errors. */
export function motionComicVideoErrorMessage(error: unknown): string {
  return formatAppErrorMessage(normalizeAppError(error, { message: describeErrorCause(error) }));
}

/** Mirrors the content-policy matcher in src/shared/provider-failure.ts so UI text and adapter classification agree. */
const CONTENT_POLICY_PATTERN = /content[_ ]policy|safety|moderation|sensitive|违规|敏感|审核/iu;

export function isContentPolicyFailure(message: string | undefined): boolean {
  return Boolean(message && CONTENT_POLICY_PATTERN.test(message));
}

export function videoFailureHint(message: string | undefined): string {
  return isContentPolicyFailure(message)
    ? '内容未通过服务商审核。各服务商审核尺度不同，可调整镜头描述，或在「制作设置」中切换视频服务后重试。'
    : '';
}

export function buildVideoFailureDiagnostics(input: {
  shotTitle: string;
  jobId?: string;
  providerLabel: string;
  providerModel: string;
  status: string;
  error?: string;
}): string {
  return [
    `镜头：${input.shotTitle}`,
    `任务：${input.jobId || '无'}`,
    `视频服务：${input.providerLabel} · ${input.providerModel}`,
    `状态：${input.status}`,
    `错误：${input.error || '无'}`,
  ].join('\n');
}
