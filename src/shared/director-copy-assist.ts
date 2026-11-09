import { workflowPrompt } from './workflow-prompt-runtime';
import type { ResearchCopyComposeInput } from './types';
import type { EditorialScriptDuration } from './editorial-script';
import { editorialWritingStyle, type EditorialWritingStyleId } from './editorial-writing-styles';

export type DirectorCopyAssistIntent = 'create' | 'revise';
export type DirectorCopyAssistMode = 'vox' | 'motion-comic';

export interface DirectorCopyAssistRequestInput {
  mode: DirectorCopyAssistMode;
  intent: DirectorCopyAssistIntent;
  title: string;
  copy: string;
  requirements?: string;
  writingStyleId?: EditorialWritingStyleId;
  track?: string;
  durationMs?: EditorialScriptDuration;
}

export function buildDirectorCopyAssistRequest(input: DirectorCopyAssistRequestInput): ResearchCopyComposeInput {
  const title = input.title.trim();
  const copy = input.copy.trim();
  const requirements = input.requirements?.trim();
  if (input.intent === 'create' && !title) {
    throw new Error(input.mode === 'vox' ? '请先填写项目标题，再使用 AI 创作。' : '请先填写系列名称，再使用 AI 创作。');
  }
  if (input.intent === 'revise' && !copy) {
    throw new Error(input.mode === 'vox' ? '请先填写需要修改的原始文案。' : '请先填写需要修改的核心设定。');
  }

  const isVox = input.mode === 'vox';
  const isRevision = input.intent === 'revise';
  const fullText = input.durationMs === 'auto';
  const voxSeconds = (typeof input.durationMs === 'number' ? input.durationMs : 30_000) / 1000;
  const voxTargetLength = fullText && isRevision ? copy.length : voxSeconds * 3;
  const voxFormat = fullText
    ? workflowPrompt("director-format-1", `输出解释型视频的中文旁白文案。${isRevision ? workflowPrompt("director-copy-1", '保留原文全部事实与上下文，篇幅与原稿相当，不为固定视频时长删减内容。', {}, isVox ? 'editorial-collage' : 'motion-comic') : `约 ${voxTargetLength} 字，时长随正文分配。`}`, { value1: (isRevision ? workflowPrompt("director-copy-1", '保留原文全部事实与上下文，篇幅与原稿相当，不为固定视频时长删减内容。', {}, isVox ? 'editorial-collage' : 'motion-comic') : `约 ${voxTargetLength} 字，时长随正文分配。`) })
    : workflowPrompt("director-format-2", `输出一段适合 ${voxSeconds} 秒解释型视频的中文旁白文案，约 ${voxTargetLength} 字，最多 ${Math.floor(voxSeconds * 3.5)} 字。`, { voxSeconds: (voxSeconds), voxTargetLength: (voxTargetLength), value3: (Math.floor(voxSeconds * 3.5)) });
  const formatRequirements = isVox
    ? workflowPrompt("director-format-output", `${voxFormat}按所选风格组织开场、信息推进和收束，不强制套用同一种四段式。只输出可直接配音的正文，不写标题、分段标签或说明。`, { voxFormat: (voxFormat) })
    : workflowPrompt("director-copy-2", '输出一条 60-120 字的 AI 漫剧核心设定，必须明确主角、异常事件、核心冲突和可连续推进的悬念。只输出一段设定正文，不要扩写成完整剧本、分镜或人物小传。', {}, isVox ? 'editorial-collage' : 'motion-comic');
  const revisionRequirements = isRevision
    ? isVox
      ? workflowPrompt("director-copy-3", '严格基于当前原始文案修改，在不改变已有事实和核心观点的前提下增强节奏、清晰度和开头吸引力，不添加未经原文支持的事实。', {}, isVox ? 'editorial-collage' : 'motion-comic')
      : workflowPrompt("director-copy-4", '严格基于当前核心设定修改，保留已有角色和世界前提，强化因果、冲突与悬念，不擅自替换故事主题。', {}, isVox ? 'editorial-collage' : 'motion-comic')
    : workflowPrompt("director-original", '围绕项目标题进行原创，避免空泛套话和与主题无关的延伸。', {}, isVox ? 'editorial-collage' : 'motion-comic');

  return {
    directorCopyAssist: { ...input, title, copy, requirements: requirements || undefined },
    channel: isVox ? 'editorial-collage' : 'motion-comic',
    track: isVox ? input.track : undefined,
    intent: isRevision ? 'refine' : 'draft',
    keyword: title || (isVox ? 'VOX 解释型视频' : 'AI 漫剧系列'),
    extraRequirements: [
      revisionRequirements,
      ...(isVox ? [`文案创作风格：${editorialWritingStyle(input.writingStyleId).label}。${workflowPrompt(`writing-style:${editorialWritingStyle(input.writingStyleId).id}`, editorialWritingStyle(input.writingStyleId).guidance, {}, 'editorial-collage')}`] : []),
      ...(requirements ? [`用户创作方向与要求：\n${requirements}${isVox ? workflowPrompt("director-copy-5", '\n如表达偏好与预设风格冲突，以用户的具体要求为准；保持事实准确和正文输出格式。', {}, isVox ? 'editorial-collage' : 'motion-comic') : ''}`] : []),
      formatRequirements,
    ].join('\n'),
    selectedSources: isRevision ? [{
      source: 'user-draft',
      title: isVox ? '当前原始文案' : '当前核心设定',
      content: copy,
    }] : [],
    useBuiltinKnowledge: !isRevision,
    targetLength: isVox ? voxTargetLength : 90,
  };
}


