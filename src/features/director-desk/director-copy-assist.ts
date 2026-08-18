import { AppError, normalizeAppError } from '../../shared/app-error';
import type { ResearchCopyComposeInput } from '../../shared/types';

export type DirectorCopyAssistIntent = 'create' | 'revise';
export type DirectorCopyAssistMode = 'vox' | 'motion-comic';

export interface DirectorCopyAssistRequestInput {
  mode: DirectorCopyAssistMode;
  intent: DirectorCopyAssistIntent;
  title: string;
  copy: string;
}

export function buildDirectorCopyAssistRequest(input: DirectorCopyAssistRequestInput): ResearchCopyComposeInput {
  const title = input.title.trim();
  const copy = input.copy.trim();
  if (input.intent === 'create' && !title) {
    throw new Error(input.mode === 'vox' ? '请先填写项目标题，再使用 AI 创作。' : '请先填写系列名称，再使用 AI 创作。');
  }
  if (input.intent === 'revise' && !copy) {
    throw new Error(input.mode === 'vox' ? '请先填写需要修改的原始文案。' : '请先填写需要修改的核心设定。');
  }

  const isVox = input.mode === 'vox';
  const isRevision = input.intent === 'revise';
  const formatRequirements = isVox
    ? '输出一段适合 30 秒解释型视频的中文旁白文案，约 180-260 字。结构必须包含钩子、背景、证据和结论。只输出可直接配音的正文，不写标题、分段标签或说明。'
    : '输出一条 60-120 字的 AI 漫剧核心设定，必须明确主角、异常事件、核心冲突和可连续推进的悬念。只输出一段设定正文，不要扩写成完整剧本、分镜或人物小传。';
  const revisionRequirements = isRevision
    ? isVox
      ? '严格基于当前原始文案修改，在不改变已有事实和核心观点的前提下增强节奏、清晰度和开头吸引力，不添加未经原文支持的事实。'
      : '严格基于当前核心设定修改，保留已有角色和世界前提，强化因果、冲突与悬念，不擅自替换故事主题。'
    : '围绕项目标题进行原创，避免空泛套话和与主题无关的延伸。';

  return {
    keyword: title || (isVox ? 'VOX 解释型视频' : 'AI 漫剧系列'),
    extraRequirements: `${revisionRequirements}\n${formatRequirements}`,
    selectedSources: isRevision ? [{
      source: 'user-draft',
      title: isVox ? '当前原始文案' : '当前核心设定',
      content: copy,
    }] : [],
    useBuiltinKnowledge: !isRevision,
    targetLength: isVox ? 220 : 90,
  };
}

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
