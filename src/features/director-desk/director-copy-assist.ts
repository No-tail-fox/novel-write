import { AppError, normalizeAppError } from '../../shared/app-error';
export { buildDirectorCopyAssistRequest } from '../../shared/director-copy-assist';
export type { DirectorCopyAssistIntent, DirectorCopyAssistMode, DirectorCopyAssistRequestInput } from '../../shared/director-copy-assist';

export function normalizeDirectorCopyAssistError(error: unknown): AppError {
  const normalized = normalizeAppError(error);
  if (normalized.code !== 'UNEXPECTED_ERROR' && normalized.code !== 'IPC_HANDLER_FAILED') return normalized;
  return new AppError(
    'DIRECTOR_COPY_ASSIST_FAILED',
    'AI 文案生成失败，请检查系统设置中的 LLM 配置与网络后重试。',
    false,
    normalized.diagnosticId,
  );
}
