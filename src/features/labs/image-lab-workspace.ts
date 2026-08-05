import type { ImageGenerationQuality, ImageLabSmartMode } from '../../shared/types';

export const IMAGE_LAB_WORKSPACE_STORAGE_KEY = 'storydream.image-lab-workspace.v1';
export const IMAGE_LAB_PROMPT_TEMPLATES_STORAGE_KEY = 'storydream.image-lab-prompt-templates.v1';
export const MAX_IMAGE_LAB_PROMPT_TEMPLATES = 24;

export type ImageLabTab = 'smart' | 'text' | 'reference';
export type ImageLabProviderChoice = 'gpt_image' | 'jimeng' | 'custom';
export type ImageLabResolution = '1K' | '2K' | '4K';

export interface ImageLabWorkspaceDraft {
  version: 1;
  savedAt: string;
  tab: ImageLabTab;
  smartMode: ImageLabSmartMode;
  prompt: string;
  selectedRatios: string[];
  selectedStyles: string[];
  provider: ImageLabProviderChoice;
  resolution: ImageLabResolution;
  quality: ImageGenerationQuality;
  referenceImagePath: string;
  outputCount: number;
}

export interface ImageLabPromptTemplate {
  id: string;
  name: string;
  mode: ImageLabSmartMode;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface ImageLabPromptTemplateCollection {
  version: 1;
  templates: ImageLabPromptTemplate[];
}

const imageLabTabs = new Set<ImageLabTab>(['smart', 'text', 'reference']);
const imageLabProviders = new Set<ImageLabProviderChoice>(['gpt_image', 'jimeng', 'custom']);
const imageLabResolutions = new Set<ImageLabResolution>(['1K', '2K', '4K']);
const imageLabQualities = new Set<ImageGenerationQuality>(['low', 'medium', 'high']);
const imageLabSmartModes = new Set<ImageLabSmartMode>([
  'text-to-image',
  'cover',
  'blog-cover',
  'podcast-cover',
  'video-narration',
  'two-host-podcast',
  'reference-edit',
]);

export function readImageLabWorkspaceDraft(storage: Pick<Storage, 'getItem'>): ImageLabWorkspaceDraft | null {
  try {
    const raw = storage.getItem(IMAGE_LAB_WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ImageLabWorkspaceDraft>;
    if (
      value.version !== 1
      || typeof value.savedAt !== 'string'
      || !imageLabTabs.has(value.tab as ImageLabTab)
      || !imageLabSmartModes.has(value.smartMode as ImageLabSmartMode)
      || !imageLabProviders.has(value.provider as ImageLabProviderChoice)
      || !imageLabResolutions.has(value.resolution as ImageLabResolution)
      || !imageLabQualities.has(value.quality as ImageGenerationQuality)
    ) return null;
    return {
      version: 1,
      savedAt: value.savedAt,
      tab: value.tab as ImageLabTab,
      smartMode: value.smartMode as ImageLabSmartMode,
      prompt: normalizeBoundedText(value.prompt, 20_000),
      selectedRatios: normalizeStringList(value.selectedRatios, 12),
      selectedStyles: normalizeStringList(value.selectedStyles, 24),
      provider: value.provider as ImageLabProviderChoice,
      resolution: value.resolution as ImageLabResolution,
      quality: value.quality as ImageGenerationQuality,
      referenceImagePath: normalizeBoundedText(value.referenceImagePath, 20_000),
      outputCount: clampInteger(value.outputCount, 1, 10, 3),
    };
  } catch {
    return null;
  }
}

export function writeImageLabWorkspaceDraft(
  storage: Pick<Storage, 'setItem'>,
  draft: ImageLabWorkspaceDraft,
): void {
  storage.setItem(IMAGE_LAB_WORKSPACE_STORAGE_KEY, JSON.stringify(draft));
}

export function createImageLabPromptTemplate(input: {
  id: string;
  name: string;
  mode: ImageLabSmartMode;
  body: string;
  createdAt?: string;
  updatedAt: string;
}): ImageLabPromptTemplate {
  const id = input.id.trim();
  const name = normalizeTemplateName(input.name);
  const body = normalizeBoundedText(input.body, 20_000).trim();
  const updatedAt = normalizeTimestamp(input.updatedAt, 'UPDATED_AT');
  const createdAt = normalizeTimestamp(input.createdAt ?? updatedAt, 'CREATED_AT');
  if (!id) throw new Error('IMAGE_LAB_PROMPT_TEMPLATE_ID_INVALID: Template id is required.');
  if (!imageLabSmartModes.has(input.mode)) throw new Error('IMAGE_LAB_PROMPT_TEMPLATE_MODE_INVALID: Template mode is invalid.');
  if (!body) throw new Error('IMAGE_LAB_PROMPT_TEMPLATE_BODY_INVALID: Prompt body is required.');
  return {
    id,
    name,
    mode: input.mode,
    body,
    createdAt,
    updatedAt,
  };
}

export function readImageLabPromptTemplates(storage: Pick<Storage, 'getItem'>): ImageLabPromptTemplate[] {
  try {
    const raw = storage.getItem(IMAGE_LAB_PROMPT_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const collection = JSON.parse(raw) as Partial<ImageLabPromptTemplateCollection>;
    if (collection.version !== 1 || !Array.isArray(collection.templates)) return [];
    return collection.templates.flatMap((template) => {
      try {
        return [createImageLabPromptTemplate(template)];
      } catch {
        return [];
      }
    }).slice(0, MAX_IMAGE_LAB_PROMPT_TEMPLATES);
  } catch {
    return [];
  }
}

export function writeImageLabPromptTemplates(
  storage: Pick<Storage, 'setItem'>,
  templates: readonly ImageLabPromptTemplate[],
): void {
  const collection: ImageLabPromptTemplateCollection = {
    version: 1,
    templates: templates.map((template) => createImageLabPromptTemplate(template)).slice(0, MAX_IMAGE_LAB_PROMPT_TEMPLATES),
  };
  storage.setItem(IMAGE_LAB_PROMPT_TEMPLATES_STORAGE_KEY, JSON.stringify(collection));
}

export function upsertImageLabPromptTemplate(
  templates: readonly ImageLabPromptTemplate[],
  template: ImageLabPromptTemplate,
): ImageLabPromptTemplate[] {
  const normalizedName = template.name.toLocaleLowerCase();
  return [
    template,
    ...templates.filter((item) => item.id !== template.id && item.name.toLocaleLowerCase() !== normalizedName),
  ].slice(0, MAX_IMAGE_LAB_PROMPT_TEMPLATES);
}

export function deleteImageLabPromptTemplate(
  templates: readonly ImageLabPromptTemplate[],
  id: string,
): ImageLabPromptTemplate[] {
  return templates.filter((template) => template.id !== id);
}

export function imageLabTabForPromptMode(mode: ImageLabSmartMode): ImageLabTab {
  if (mode === 'text-to-image') return 'text';
  if (mode === 'reference-edit') return 'reference';
  return 'smart';
}

function normalizeTemplateName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').slice(0, 60) : '';
  if (!name) throw new Error('IMAGE_LAB_PROMPT_TEMPLATE_NAME_INVALID: Template name is required.');
  return name;
}

function normalizeBoundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function normalizeTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new Error(`IMAGE_LAB_PROMPT_TEMPLATE_${field}_INVALID: Template timestamp is invalid.`);
  }
  return value;
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)))
    .slice(0, limit);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
