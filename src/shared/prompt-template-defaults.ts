import type { PromptTemplate } from './types';
import { storyboundSystemTemplateVersionHash, storyboundSystemTemplates, type StoryboundSystemTemplate } from './storybound-system-templates';
import { storyboundStoryboardPrompt } from './storyboard-prompt';

const updatedAt = '2026-05-26T00:00:00.000Z';

function storyboundTemplateUpdatedAt(template: StoryboundSystemTemplate): string {
  return new Date(template.updatedAt * 1000).toISOString();
}

function storyboundCharacterPolicy(template: StoryboundSystemTemplate): PromptTemplate['characterPolicy'] {
  if (template.needsCharacterCard === 'force') return 'force-extract';
  if (template.needsCharacterCard === 'skip') return 'force-skip';
  return 'follow-template';
}

function storyboundReferenceKind(template: StoryboundSystemTemplate): PromptTemplate['referenceKind'] {
  if (template.referenceKind === 'character' || template.referenceKind === 'face') return 'face';
  if (template.referenceKind === 'product') return 'product';
  return 'none';
}

function storyboundTaskTemplateContent(template: StoryboundSystemTemplate): string {
  return [
    `StoryDream 系统模板：${template.name}`,
    `模板 ID：${template.templateId}`,
    `模板说明：${template.description}`,
    `默认画风：${template.defaultStyleId}`,
    `版本：${template.version}`,
    `模板源版本：${storyboundSystemTemplateVersionHash}`,
  ].join('\n');
}

const fallback = storyboundSystemTemplates.find((template) => template.templateId === 'general') ?? storyboundSystemTemplates[0];

const taskTemplates: PromptTemplate[] = storyboundSystemTemplates.map((template): PromptTemplate => ({
  id: `system-${template.templateId}`,
  name: template.name,
  type: 'task',
  description: template.description,
  content: storyboundTaskTemplateContent(template),
  isBuiltin: true,
  updatedAt: storyboundTemplateUpdatedAt(template),
  baseTrack: template.templateId,
  defaultStyles: [template.defaultStyleId],
  characterPolicy: storyboundCharacterPolicy(template),
  step3SkeletonModules: [...(template.step3SkeletonModules ?? [])],
  referenceKind: storyboundReferenceKind(template),
  stepPrompts: {
    rewrite: template.step1RewriteSystemPrompt,
    cover: template.step1MetadataSystemPrompt,
    storyboard: storyboundStoryboardPrompt,
    'image-prompt': template.step3SystemPrompt,
  },
  imageSeedPoolsJson: JSON.stringify(template.imageSeedPools ?? {}),
  origin: 'system',
}));

export const defaultPromptTemplates: PromptTemplate[] = [
  ...taskTemplates,
  {
    id: 'builtin-review',
    name: '预审整理',
    type: 'review',
    description: '清洗素材、去噪、压缩为适合短视频的事实文案。',
    content: [
      '任务模板：{{taskTemplateContent}}', '', '【原文素材】', '{{inputText}}', '', '【搜索资料内容】', '{{sourceContext}}', '',
      '请完成 Step 0 预审整理：',
      '1. 严格基于原文素材和搜索资料，去除重复、广告噪音、无关口号和不可验证猜测',
      '2. 保留人物、时间、地点、事件顺序、关键转折、明确因果和可验证细节',
      '3. 不要直接复述参考素材句子，改写成适合后续原创短视频口播稿的事实底稿',
      '4. 口语化、紧凑、信息密度高，但不要写成最终成片文案',
      '5. 不要标题、不要 markdown、不要“根据资料/综合以上”等元描述，只输出 reviewedText 字段内容',
    ].join('\n'),
    isBuiltin: true,
    updatedAt,
    origin: 'system',
  },
  { id: 'builtin-rewrite', name: 'StoryDream 通用改写', type: 'rewrite', description: 'StoryDream 通用故事赛道改写提示词兜底。', content: fallback.step1RewriteSystemPrompt, isBuiltin: true, updatedAt: storyboundTemplateUpdatedAt(fallback), origin: 'system' },
  { id: 'builtin-cover', name: 'StoryDream 通用封面信息', type: 'cover', description: 'StoryDream 通用故事赛道封面标题与视频简介提示词兜底。', content: fallback.step1MetadataSystemPrompt, isBuiltin: true, updatedAt: storyboundTemplateUpdatedAt(fallback), origin: 'system' },
  { id: 'builtin-storyboard', name: 'StoryDream 本地化分镜', type: 'storyboard', description: '按 Storybound 最新分镜规则输出尾部锚点，由 StoryDream 本地还原字幕分镜。', content: storyboundStoryboardPrompt, isBuiltin: true, updatedAt, origin: 'system' },
  { id: 'builtin-image-prompt', name: 'StoryDream 通用绘图提示词', type: 'image-prompt', description: 'StoryDream 通用故事赛道分镜绘画提示词兜底。', content: `${fallback.step3SystemPrompt}\n\n爆款复刻画面提示词参考：{{imagePromptReference}}`, isBuiltin: true, updatedAt: storyboundTemplateUpdatedAt(fallback), origin: 'system' },
];
