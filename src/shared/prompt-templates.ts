import type { AiSourceContext, CustomStyle, PipelineArtifact, PromptStepTemplateType, PromptTemplate, StoryboardScene, Task } from './types';

export interface PromptTemplateSelectionInput {
  track?: string;
  promptTemplateId?: string | null;
}

export interface PromptRenderContext {
  task?: Partial<Task>;
  taskTemplate?: PromptTemplate | null;
  sourceContext?: AiSourceContext | null;
  reviewedText?: string;
  rewrittenCopy?: string;
  scenes?: Array<Pick<StoryboardScene, 'id' | 'cap' | 'descPrompt' | 'durationMs'>>;
  artifact?: Partial<PipelineArtifact>;
}

export type TemplateOption = [id: string, label: string, hint: string];

const fallbackTaskTrack = 'general-story';
const fallbackStyleId = 'photo-real';
const styleLabelToId = new Map([
  ['黑白摄影', 'black-white'],
  ['写实彩色', 'photo-real'],
  ['油画风格', 'oil-paint'],
  ['现代电影', 'modern-film'],
  ['古风电影', 'ancient-film'],
  ['复古胶片', 'retro-film'],
  ['水彩治愈', 'watercolor'],
  ['杂志插画', 'magazine'],
  ['皮克斯 3D', 'pixar-3d'],
  ['中国水墨', 'ink'],
  ['民间故事工笔风', 'folk'],
  ['吉卜力', 'ghibli'],
]);
const knownStyleIds = new Set([...styleLabelToId.values()]);
const placeholderAliases = new Map([
  ['原文素材', 'inputText'],
  ['标题', 'title'],
  ['联网资料', 'sourceContext'],
  ['资料来源', 'sourceContext'],
  ['预审结果', 'reviewedText'],
  ['改写正文', 'rewrittenCopy'],
  ['分镜数据', 'scenesJson'],
  ['内容赛道', 'track'],
  ['画风', 'style'],
  ['画面比例', 'ratio'],
  ['额外要求', 'extraRequirements'],
  ['任务模板指令', 'taskTemplateContent'],
  ['任务模板名称', 'taskTemplateName'],
  ['默认图像模板', 'defaultStyles'],
  ['默认画风', 'defaultStyles'],
  ['默认草稿模板', 'defaultDraftTemplateId'],
  ['主角档案', 'characterPolicy'],
  ['Step 3 骨架', 'step3SkeletonModules'],
  ['参考图类型', 'referenceKind'],
  ['改写强度', 'rewriteIntensity'],
  ['叙事视角', 'narrativePov'],
  ['保留带货', 'keepPromotion'],
  ['AI 关键词', 'aiKeyword'],
]);

export function selectTaskPromptTemplate(templates: PromptTemplate[], input: PromptTemplateSelectionInput): PromptTemplate | null {
  if (input.promptTemplateId) {
    const explicit = templates.find((template) => template.id === input.promptTemplateId && template.type === 'task');
    if (explicit) return explicit;
  }
  const track = input.track || fallbackTaskTrack;
  return (
    templates.find((template) => template.type === 'task' && template.baseTrack === track) ??
    templates.find((template) => template.type === 'task' && template.baseTrack === fallbackTaskTrack) ??
    templates.find((template) => template.type === 'task') ??
    null
  );
}

export function buildStoryTemplateTrackOptions(templates: PromptTemplate[]): TemplateOption[] {
  const options: TemplateOption[] = [];
  const seenTracks = new Set<string>();
  templates.forEach((template) => {
    if (template.type !== 'task') return;
    const track = (template.baseTrack || fallbackTaskTrack).trim();
    if (!track || seenTracks.has(track)) return;
    seenTracks.add(track);
    options.push([track, template.name, compactOptionHint(template.description || template.marketTags?.join(' / ') || track)]);
  });
  return options.length ? options : [[fallbackTaskTrack, '通用故事', '通用写实风格']];
}

export function buildImageTemplateStyleOptions(styles: CustomStyle[]): TemplateOption[] {
  const seenStyles = new Set<string>();
  const options = styles.reduce<TemplateOption[]>((items, style) => {
    const id = style.id.trim();
    if (!id || seenStyles.has(id)) return items;
    seenStyles.add(id);
    items.push([id, style.name, compactOptionHint(style.tag || style.description || id)]);
    return items;
  }, []);
  return options.length ? options : [[fallbackStyleId, '写实彩色', '质感胶片']];
}

export function resolvePromptTemplateDefaultStyleIds(template: Pick<PromptTemplate, 'defaultStyles'> | null | undefined, availableStyleIds?: string[]): string[] {
  const allowedStyleIds = availableStyleIds ? new Set([...knownStyleIds, ...availableStyleIds]) : knownStyleIds;
  const ids = (template?.defaultStyles ?? [])
    .map((style) => styleLabelToId.get(style) ?? style)
    .filter((style) => allowedStyleIds.has(style));
  return [...new Set(ids)];
}

export function resolvePromptTemplateDefaultStyleId(template: Pick<PromptTemplate, 'defaultStyles'> | null | undefined, availableStyleIds?: string[]): string {
  return resolvePromptTemplateDefaultStyleIds(template, availableStyleIds)[0] ?? fallbackStyleId;
}

export function resolvePromptTemplateDefaultDraftTemplateId(
  template: Pick<PromptTemplate, 'defaultDraftTemplateId'> | null | undefined,
  availableDraftTemplateIds: string[] = [],
  fallbackDraftTemplateId = 'default-portrait-9-16',
): string {
  const available = new Set(availableDraftTemplateIds);
  if (template?.defaultDraftTemplateId && (!available.size || available.has(template.defaultDraftTemplateId))) {
    return template.defaultDraftTemplateId;
  }
  if (!available.size || available.has(fallbackDraftTemplateId)) {
    return fallbackDraftTemplateId;
  }
  return availableDraftTemplateIds[0] ?? fallbackDraftTemplateId;
}

export function selectStepPromptTemplate(templates: PromptTemplate[], type: PromptStepTemplateType, taskTemplate?: PromptTemplate | null): PromptTemplate | null {
  if (taskTemplate?.type === 'task') {
    const taskStepPrompt = taskTemplate.stepPrompts?.[type];
    if (taskStepPrompt?.trim()) {
      return {
        id: `${taskTemplate.id}:${type}`,
        name: `${taskTemplate.name} ${type}`,
        type,
        description: `${taskTemplate.name} task-level ${type} prompt override`,
        content: taskStepPrompt,
        isBuiltin: false,
        updatedAt: taskTemplate.updatedAt,
        baseTemplateId: taskTemplate.id,
        origin: taskTemplate.origin ?? 'custom',
      };
    }
  }
  return templates.find((template) => template.type === type && template.isBuiltin) ?? templates.find((template) => template.type === type) ?? null;
}

export function renderPromptTemplate(template: Pick<PromptTemplate, 'content'>, context: PromptRenderContext): string {
  const values = buildTemplateValues(context);
  return replacePlaceholders(template.content, values);
}

export function buildPromptRenderContext(input: {
  task: Task;
  taskTemplate: PromptTemplate | null;
  sourceContext?: AiSourceContext | null;
  artifact?: Partial<PipelineArtifact>;
}): PromptRenderContext {
  return {
    task: input.task,
    taskTemplate: input.taskTemplate,
    sourceContext: input.sourceContext,
    artifact: input.artifact,
    reviewedText: input.artifact?.reviewedText,
    rewrittenCopy: input.artifact?.rewrittenCopy,
    scenes: input.artifact?.scenes,
  };
}

function buildTemplateValues(context: PromptRenderContext): Record<string, string> {
  const task = context.task ?? {};
  const taskTemplate = context.taskTemplate ?? null;
  const sourceContext = context.sourceContext ?? context.artifact?.sourceContext ?? null;
  const scenes = context.scenes ?? context.artifact?.scenes ?? [];
  const reviewedText = context.reviewedText ?? context.artifact?.reviewedText ?? '';
  const rewrittenCopy = context.rewrittenCopy ?? context.artifact?.rewrittenCopy ?? '';

  const values: Record<string, string> = {
    inputText: String(task.inputText ?? ''),
    title: String(task.title ?? ''),
    track: String(task.track ?? ''),
    style: String(task.style ?? ''),
    ratio: String(task.ratio ?? ''),
    extraRequirements: String(task.extraRequirements ?? ''),
    rewriteIntensity: String(task.rewriteIntensity ?? ''),
    narrativePov: String(task.narrativePov ?? ''),
    keepPromotion: String(task.keepPromotion ?? ''),
    aiKeyword: String(task.aiKeyword ?? ''),
    reviewedText,
    rewrittenCopy,
    scenesJson: JSON.stringify(scenes ?? []),
    sourceContext: formatSourceContext(sourceContext),
    taskTemplateName: taskTemplate?.name ?? '',
    taskTemplateContent: '',
    defaultStyles: (taskTemplate?.defaultStyles ?? []).join('、'),
    defaultDraftTemplateId: taskTemplate?.defaultDraftTemplateId ?? '',
    characterPolicy: taskTemplate?.characterPolicy ?? '',
    step3SkeletonModules: (taskTemplate?.step3SkeletonModules ?? []).join('、'),
    referenceKind: taskTemplate?.referenceKind ?? '',
  };
  values.taskTemplateContent = taskTemplate ? replacePlaceholders(taskTemplate.content, values) : '';
  return values;
}

function replacePlaceholders(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (_match, key: string) => values[placeholderKey(key)] ?? '').trim();
}

function placeholderKey(key: string): string {
  const normalized = key.trim();
  return placeholderAliases.get(normalized) ?? normalized;
}

function compactOptionHint(value: string): string {
  return value.trim().replace(/[。.!！；;]+$/u, '');
}

function formatSourceContext(context: AiSourceContext | null): string {
  if (!context) return '';
  const sections = context.sections
    .map((section, index) => {
      const url = section.url ? `\nURL: ${section.url}` : '';
      return `${index + 1}. [${section.source}] ${section.title}${url}\n${section.content || section.snippet || ''}`;
    })
    .join('\n\n');
  const warnings = context.warnings.length > 0 ? `\n\nWarnings:\n${context.warnings.map((warning) => `- ${warning}`).join('\n')}` : '';
  return [`Query: ${context.query}`, sections, warnings].filter(Boolean).join('\n\n');
}
