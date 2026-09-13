/** User-facing readiness summaries shared by the two director workspaces. */

export type DirectorSystemStatusTone = 'ok' | 'warning' | 'error';

export interface DirectorSystemStatus {
  tone: DirectorSystemStatusTone;
  label: string;
}

export function resolveEditorialSystemStatus(input: {
  actionError?: boolean;
  imageConnected: boolean;
  voiceConnected: boolean;
  videoRequired: boolean;
  videoConnected: boolean;
}): DirectorSystemStatus {
  if (input.actionError) return { tone: 'error', label: '项目需要处理' };
  if (!input.imageConnected) return { tone: 'warning', label: '图片服务待配置' };
  if (input.videoRequired && !input.videoConnected) return { tone: 'warning', label: '视频服务待配置' };
  if (!input.voiceConnected) return { tone: 'warning', label: '旁白服务待配置' };
  return { tone: 'ok', label: '生成服务正常' };
}

export function resolveMotionComicSystemStatus(input: {
  actionError?: boolean;
  imageConnected: boolean;
  supportsReferenceImages: boolean;
  consistencyReady: boolean;
  voiceConnected: boolean;
}): DirectorSystemStatus {
  if (input.actionError) return { tone: 'error', label: '项目需要处理' };
  if (!input.imageConnected) return { tone: 'warning', label: '图片服务待配置' };
  if (!input.supportsReferenceImages) return { tone: 'warning', label: '参考图能力不支持' };
  if (!input.consistencyReady) return { tone: 'warning', label: '一致性基准待建立' };
  if (!input.voiceConnected) return { tone: 'warning', label: '旁白服务待配置' };
  return { tone: 'ok', label: '生成服务正常' };
}
