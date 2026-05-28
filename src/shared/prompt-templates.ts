import type { AiSourceContext, PipelineArtifact, PromptTemplate, PromptTemplateType, StoryboardScene, Task } from './types';

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

const fallbackTaskTrack = 'general-story';

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

export function selectStepPromptTemplate(templates: PromptTemplate[], type: Exclude<PromptTemplateType, 'task'>): PromptTemplate | null {
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
    characterPolicy: taskTemplate?.characterPolicy ?? '',
    step3SkeletonModules: (taskTemplate?.step3SkeletonModules ?? []).join('、'),
    referenceKind: taskTemplate?.referenceKind ?? '',
  };
  values.taskTemplateContent = taskTemplate ? replacePlaceholders(taskTemplate.content, values) : '';
  return values;
}

function replacePlaceholders(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => values[key] ?? '').trim();
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
