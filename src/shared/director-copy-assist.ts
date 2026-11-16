import { workflowPrompt } from './workflow-prompt-runtime';
import type { ResearchCopyComposeInput } from './types';
import { EDITORIAL_MAX_DURATION_MS, type EditorialScriptDuration } from './editorial-script';
import { TARGET_LENGTH_MAX } from './content-metrics';
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
  /**
   * Word count the creator asked for inside the direction text (e.g. "1500 字").
   * An explicit direction is a length requirement, so it wins over the duration preset.
   */
  requestedCharacters?: number;
}

export interface DirectorCopyAssistTarget {
  targetLength: number;
  minimumLength: number;
  /** True when the target came from the creator's direction instead of the duration preset. */
  fromRequirements: boolean;
}

/** Shorter requests are ignored: a direction mentioning "2 字" is not a script length. */
export const DIRECTOR_COPY_REQUIREMENT_COUNT_MIN = 50;
/** Shortest narration the length guidance will ask for; below this the 100-char floor would drop it. */
export const DIRECTOR_COPY_LENGTH_GUIDANCE_MIN = 100;

/** Matches "1500 字", "1500个字", "1500 个汉字"; "1500 节" or "1500 字以内" never match. */
const explicitCharacterCountPatterns = [
  /(?:字数|篇幅|正文)\D{0,6}?(\d{2,6})[\s个]*(?:汉字|字符|字)(?![节号幕集片刻频张页幅段时间])/u,
  /(\d{2,6})[\s个]*(?:汉字|字符)(?![节号幕集片刻频张页幅段时间])/u,
  /(\d{2,6})[\s个]*字(?![节号幕集片刻频张页幅段时间])/u,
];

/** True when the direction asks to stay under a count instead of reaching one. */
function isUpperBoundRequest(text: string): boolean {
  return /(?:以内|以下|之内|不超过|不多于|少于|控制在)/u.test(text);
}

/** Read the only explicit word count in the creator direction; conflicting counts are ignored. */
export function directorCopyRequestedCharacters(requirements?: string): number | null {
  const text = (requirements ?? '').trim();
  if (!text || isUpperBoundRequest(text)) return null;
  for (const pattern of explicitCharacterCountPatterns) {
    const counts = [...new Set([...text.matchAll(new RegExp(pattern.source, 'gu'))]
      .map(match => Number(match[1] ?? match[2]))
      .filter(value => Number.isFinite(value) && value >= DIRECTOR_COPY_REQUIREMENT_COUNT_MIN && value <= TARGET_LENGTH_MAX))];
    if (counts.length === 1) return counts[0];
    if (counts.length > 1) return null;
  }
  return null;
}

/**
 * Resolve the word count that creation must actually reach. Duration presets are narration
 * estimates (~3 characters per second); an explicit user direction replaces them instead of
 * being silently overridden by the preset.
 */
export function resolveDirectorCopyAssistTarget(
  durationMs: EditorialScriptDuration | undefined,
  requestedCharacters: number | null,
): DirectorCopyAssistTarget {
  const explicit = requestedCharacters && requestedCharacters >= DIRECTOR_COPY_REQUIREMENT_COUNT_MIN
    ? Math.min(TARGET_LENGTH_MAX, Math.round(requestedCharacters))
    : null;
  if (explicit) {
    return { targetLength: explicit, minimumLength: explicit, fromRequirements: true };
  }
  // Full-length revisions must never exceed a 120-minute project, whatever the draft size.
  const ceiling = Math.floor(EDITORIAL_MAX_DURATION_MS / 1000 * 3);
  // Presets shorter than the guidance floor would otherwise produce "不少于 100 字，目标约 90 字".
  const seconds = (typeof durationMs === 'number' ? durationMs : 30_000) / 1000;
  const target = Math.min(ceiling, Math.max(DIRECTOR_COPY_LENGTH_GUIDANCE_MIN, Math.round(seconds * 3)));
  return { targetLength: target, minimumLength: target, fromRequirements: false };
}

function copyLengthGuidance(target: DirectorCopyAssistTarget): string {
  const { targetLength, minimumLength } = target;
  const minimum = Math.min(targetLength, Math.max(DIRECTOR_COPY_LENGTH_GUIDANCE_MIN, Math.round(minimumLength * 0.9)));
  return [
    `全文字数：不少于 ${minimum} 字，目标约 ${targetLength} 字。`,
    '这是必须达到的下限，写完初稿后请核对字数，不足时补充素材中的具体事实、细节、因果与例证，不得用重复表述、空话或排比凑字。',
  ].join('');
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
  const requestedCharacters = input.requestedCharacters ?? directorCopyRequestedCharacters(requirements);
  const target = resolveDirectorCopyAssistTarget(input.durationMs, requestedCharacters);
  // "按全文分配时长" revisions keep the original length unless the creator asked for another one.
  // The 120-minute project ceiling caps that inherited length, so planning never rejects the result.
  const inheritedLength = Math.min(copy.length, TARGET_LENGTH_MAX);
  const voxTargetLength = fullText && isRevision && !target.fromRequirements ? inheritedLength : target.targetLength;
  const fixedLength = copyLengthGuidance({ ...target, targetLength: voxTargetLength, minimumLength: voxTargetLength });
  const voxFormat = fullText
    ? workflowPrompt("director-format-1", `输出解释型视频的中文旁白文案。${target.fromRequirements || !isRevision ? `${fixedLength}时长按正文长度分配。` : workflowPrompt("director-copy-1", '保留原文全部事实与上下文，篇幅与原稿相当，不为固定视频时长删减内容。', {}, isVox ? 'editorial-collage' : 'motion-comic')}`, { value1: (target.fromRequirements || !isRevision ? `${fixedLength}时长按正文长度分配。` : workflowPrompt("director-copy-1", '保留原文全部事实与上下文，篇幅与原稿相当，不为固定视频时长删减内容。', {}, isVox ? 'editorial-collage' : 'motion-comic')) })
    // The saved template renders {{value1}}, so both spellings must resolve to the same length clause.
    : workflowPrompt("director-format-2", `输出一段适合 ${voxSeconds} 秒解释型视频的中文旁白文案，按每秒约 3 字估算，${fixedLength}`, { voxSeconds: (voxSeconds), voxTargetLength: fixedLength, value1: fixedLength, value3: (Math.floor(voxSeconds * 3.5)) });
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
    // Keep the composer's targetLength above its normalization floor; an explicit direction
    // may ask for a long script, and the floor must not shrink it again at the boundary.
    targetLength: isVox ? Math.max(voxTargetLength, DIRECTOR_COPY_LENGTH_GUIDANCE_MIN) : 90,
    channel: isVox ? 'editorial-collage' : 'motion-comic',
    track: isVox ? input.track : undefined,
    intent: isRevision ? 'refine' : 'draft',
    keyword: title || (isVox ? 'VOX 解释型视频' : 'AI 漫剧系列'),
    extraRequirements: [
      revisionRequirements,
      ...(isVox ? [`文案创作风格：${editorialWritingStyle(input.writingStyleId).label}。${workflowPrompt(`writing-style:${editorialWritingStyle(input.writingStyleId).id}`, editorialWritingStyle(input.writingStyleId).guidance, {}, 'editorial-collage')}`] : []),
      ...(requirements ? [`用户创作方向与要求：\n${requirements}${isVox ? workflowPrompt("director-copy-5", '\n如表达偏好与预设风格冲突，以用户的具体要求为准；字数要求同样以用户要求为准；保持事实准确和正文输出格式。', {}, isVox ? 'editorial-collage' : 'motion-comic') : ''}`] : []),
      formatRequirements,
    ].join('\n'),
    selectedSources: isRevision ? [{
      source: 'user-draft',
      title: isVox ? '当前原始文案' : '当前核心设定',
      content: copy,
    }] : [],
    useBuiltinKnowledge: !isRevision,
  };
}
