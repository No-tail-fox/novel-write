import { workflowPromptCatalog } from './workflow-prompt-catalog';
import type { PromptChannel, PromptTemplate } from './types';

export const promptChannelOptions: ReadonlyArray<{ value: PromptChannel; label: string }> = [
  { value: 'shared', label: '公共文案' }, { value: 'story', label: '短片生成' },
  { value: 'html-video', label: 'HTML 动画' }, { value: 'editorial-collage', label: '创意动画' },
  { value: 'motion-comic', label: 'AI 漫剧' }, { value: 'music-mv', label: '音乐 MV' },
];

let templateProvider: () => readonly PromptTemplate[] = () => [];
/** The host supplies its current persisted settings; generation never reads renderer summaries. */
export function setWorkflowPromptTemplateProvider(provider: () => readonly PromptTemplate[]): () => void {
  const previous = templateProvider;
  templateProvider = provider;
  return () => { if (templateProvider === provider) templateProvider = previous; };
}

export function workflowSlot(slot?: string) {
  return workflowPromptCatalog.find((entry) => entry.slot === slot);
}

export function workflowSlotChannels(slot?: string): PromptChannel[] {
  const entry = workflowSlot(slot);
  if (!entry) return [];
  if (entry.channel !== 'shared') return [entry.channel];
  // Shared defaults are offered only where the existing generation flow calls them.
  if (entry.slot.startsWith('writing-style:')) return ['shared', 'html-video', 'editorial-collage'];
  if (['director-copy-1', 'director-copy-3', 'director-copy-5'].includes(entry.slot)) return ['shared', 'editorial-collage'];
  if (['director-copy-2', 'director-copy-4'].includes(entry.slot)) return ['shared', 'motion-comic'];
  if (entry.slot === 'director-original') return ['shared', 'editorial-collage', 'motion-comic'];
  return ['shared', 'story', 'html-video', 'editorial-collage', 'motion-comic'];
}

export function selectWorkflowPrompt(
  templates: readonly PromptTemplate[], slot: string, channel: PromptChannel,
): PromptTemplate | undefined {
  return templates.filter((template) => template.type === 'workflow' && template.slot === slot
    && template.enabled !== false && (template.channel === channel || template.channel === 'shared'))
    .sort((a, b) => Number(b.channel === channel) - Number(a.channel === channel)
      || Number(!b.isBuiltin || b.builtinModified === true) - Number(!a.isBuiltin || a.builtinModified === true)
      || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
}

/** Defaults are the original source expression. Only saved overrides are rendered. */
export function workflowPrompt(
  slot: string, original: string, variables: Record<string, unknown> = {},
  channel: PromptChannel = workflowSlot(slot)?.channel ?? 'shared',
  templates: readonly PromptTemplate[] = templateProvider(),
): string {
  const selected = selectWorkflowPrompt(templates, slot, channel);
  if (!selected || (selected.isBuiltin && !selected.builtinModified)) return original;
  return selected.content.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (token, key: string) => {
    if (!(key in variables)) throw new Error(`提示词「${selected.name}」含未知变量 ${token}，请在提示词模板中修正。`);
    return variables[key] == null ? '' : String(variables[key]);
  });
}

export function validateWorkflowTemplate(template: PromptTemplate): void {
  if (template.type !== 'workflow') return;
  const slot = workflowSlot(template.slot);
  if (!slot || !template.channel || !workflowSlotChannels(slot.slot).includes(template.channel)) {
    throw new Error('请选择与提示词用途匹配的创作频道。');
  }
  if (!template.content.trim()) throw new Error('提示词内容不能为空。');
  for (const match of template.content.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g)) {
    if (!(match[1] in slot.variables)) throw new Error(`该用途不支持变量 {{${match[1]}}}。`);
  }
}

/** Protect builtin identity on both Electron and browser saves. */
export function preparePromptTemplateSave(input: PromptTemplate, builtin?: PromptTemplate): PromptTemplate {
  const template = builtin ? {
    ...input, id: builtin.id, isBuiltin: true, origin: 'system' as const,
    type: builtin.type, slot: builtin.slot, channel: builtin.channel, baseTrack: builtin.baseTrack,
    builtinModified: true,
  } : { ...input, isBuiltin: false, origin: 'custom' as const };
  validateWorkflowTemplate(template);
  return template;
}
