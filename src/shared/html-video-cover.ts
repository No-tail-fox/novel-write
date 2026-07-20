import type {
  CustomCoverTemplate,
  HtmlVideoCoverAsset,
  HtmlVideoCoverMode,
  HtmlVideoCoverRatio,
} from './types';

export const HTML_VIDEO_COVER_MODES = ['off', 'auto', 'manual'] as const satisfies readonly HtmlVideoCoverMode[];
export const HTML_VIDEO_COVER_RATIOS = ['3:4', '1:1', '16:9', '9:16'] as const satisfies readonly HtmlVideoCoverRatio[];
export const MAX_HTML_VIDEO_COVER_BYTES = 32 * 1024 * 1024;

const coverDimensions: Record<HtmlVideoCoverRatio, { width: number; height: number }> = {
  '3:4': { width: 768, height: 1024 },
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
};

const supportedCoverMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
type HtmlVideoCoverMimeType = typeof supportedCoverMimeTypes[number];

export interface HtmlVideoCoverInspection {
  sourcePath: string;
  exists: boolean;
  isFile: boolean;
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: string;
}

export interface HtmlVideoPreparedCoverImage {
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: 'image/png';
  sha256: string;
}

export type HtmlVideoCoverImageProcessor = (input: {
  sourcePath: string;
  destinationPath: string;
  dimensions: { width: number; height: number };
  signal?: AbortSignal;
}) => Promise<HtmlVideoPreparedCoverImage>;

export interface CreateHtmlVideoCoverAssetInput extends Omit<HtmlVideoCoverAsset, 'version'> {}

export function normalizeHtmlVideoCoverMode(value: unknown): HtmlVideoCoverMode {
  if (value === 'titled') return 'auto';
  if (typeof value === 'string' && HTML_VIDEO_COVER_MODES.includes(value as HtmlVideoCoverMode)) {
    return value as HtmlVideoCoverMode;
  }
  throw new Error('HTML video cover mode is invalid.');
}

export function normalizeHtmlVideoCoverRatio(value: unknown): HtmlVideoCoverRatio {
  if (typeof value === 'string' && HTML_VIDEO_COVER_RATIOS.includes(value as HtmlVideoCoverRatio)) {
    return value as HtmlVideoCoverRatio;
  }
  throw new Error('HTML video cover ratio is invalid.');
}

export function htmlVideoCoverDimensions(ratio: HtmlVideoCoverRatio): { width: number; height: number } {
  const normalized = normalizeHtmlVideoCoverRatio(ratio);
  return { ...coverDimensions[normalized] };
}

export function resolveHtmlVideoCoverTemplate(
  templates: readonly CustomCoverTemplate[],
  id: string,
): CustomCoverTemplate {
  const template = templates.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`HTML video cover template is missing: ${id}`);
  return cloneValidatedTemplate(template);
}

export function buildHtmlVideoCoverPrompt(input: {
  taskTitle: string;
  summary: string;
  template: CustomCoverTemplate;
  ratio: HtmlVideoCoverRatio;
}): string {
  const template = cloneValidatedTemplate(input.template);
  const dimensions = htmlVideoCoverDimensions(input.ratio);
  return [
    `Template: ${template.name}`,
    `Description: ${template.description}`,
    `Directions: ${template.directions}`,
    `Composition: ${template.compositionRule}`,
    `Title layout: ${template.titleLayout}`,
    `Subtitle layout: ${template.subtitleLayout}`,
    `Plain hint: ${template.plainHint}`,
    `Task title: ${boundedText(input.taskTitle, 'task title')}`,
    `Summary: ${boundedText(input.summary, 'summary')}`,
    `Output: ${dimensions.width}x${dimensions.height} (${input.ratio})`,
    'Create a clean video cover image. Do not add watermarks, account names, QR codes, or platform UI.',
  ].join('\n');
}

export function validateHtmlVideoCoverInspection(
  value: HtmlVideoCoverInspection,
  ratio: HtmlVideoCoverRatio,
): HtmlVideoCoverInspection & { mimeType: HtmlVideoCoverMimeType } {
  const dimensions = htmlVideoCoverDimensions(ratio);
  if (!value.exists || !value.isFile || !value.sourcePath.trim()) {
    throw new Error('HTML video cover source file is missing or invalid.');
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error(`HTML video cover source size must be from 1 to ${MAX_HTML_VIDEO_COVER_BYTES} bytes.`);
  }
  if (value.width !== dimensions.width || value.height !== dimensions.height) {
    throw new Error(`HTML video cover dimensions must be exactly ${dimensions.width}x${dimensions.height}.`);
  }
  if (!supportedCoverMimeTypes.includes(value.mimeType as HtmlVideoCoverMimeType)) {
    throw new Error('HTML video cover image type is unsupported.');
  }
  return { ...value, sourcePath: value.sourcePath.trim(), mimeType: value.mimeType as HtmlVideoCoverMimeType };
}

export function createHtmlVideoCoverAsset(input: CreateHtmlVideoCoverAssetInput): HtmlVideoCoverAsset {
  return validateHtmlVideoCoverAsset({ version: 1, ...input });
}

export function validateHtmlVideoCoverAsset(value: unknown): HtmlVideoCoverAsset {
  if (!isRecord(value) || value.version !== 1) throw new Error('HTML video cover artifact version is invalid.');
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
    throw new Error('HTML video cover artifact revision is invalid.');
  }
  if (value.mode !== 'auto' && value.mode !== 'manual') {
    throw new Error('HTML video cover artifact mode is invalid.');
  }
  const ratio = normalizeHtmlVideoCoverRatio(value.ratio);
  const dimensions = htmlVideoCoverDimensions(ratio);
  if (value.width !== dimensions.width || value.height !== dimensions.height) {
    throw new Error('HTML video cover artifact dimensions do not match its ratio.');
  }
  if (typeof value.path !== 'string' || !/^covers\/[A-Za-z0-9][A-Za-z0-9._-]*\.png$/u.test(value.path)) {
    throw new Error('HTML video cover artifact path must be task-managed.');
  }
  if (!Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) <= 0 || Number(value.sizeBytes) > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error('HTML video cover artifact size is invalid.');
  }
  if (!supportedCoverMimeTypes.includes(value.mimeType as HtmlVideoCoverMimeType)) {
    throw new Error('HTML video cover artifact image type is unsupported.');
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    throw new Error('HTML video cover artifact SHA-256 digest is invalid.');
  }
  if (typeof value.createdAt !== 'string' || !value.createdAt || value.createdAt.length > 128) {
    throw new Error('HTML video cover artifact creation time is invalid.');
  }
  if (value.templateId !== undefined && (typeof value.templateId !== 'string' || !value.templateId || value.templateId.length > 256)) {
    throw new Error('HTML video cover artifact template id is invalid.');
  }
  return {
    version: 1,
    revision: Number(value.revision),
    mode: value.mode,
    path: value.path,
    sizeBytes: Number(value.sizeBytes),
    width: dimensions.width,
    height: dimensions.height,
    mimeType: value.mimeType as HtmlVideoCoverMimeType,
    sha256: value.sha256,
    ratio,
    createdAt: value.createdAt,
    ...(value.templateId === undefined ? {} : { templateId: value.templateId }),
  };
}

function cloneValidatedTemplate(value: CustomCoverTemplate): CustomCoverTemplate {
  if (!isRecord(value)) throw new Error('HTML video cover template is invalid.');
  const fields = [
    'id',
    'name',
    'description',
    'directions',
    'compositionRule',
    'titleLayout',
    'subtitleLayout',
    'plainHint',
    'createdAt',
    'updatedAt',
  ] as const;
  const output = {} as CustomCoverTemplate;
  for (const field of fields) {
    const text = value[field];
    if (typeof text !== 'string' || text.length > 16_384 || (field === 'id' && !text)) {
      throw new Error(`HTML video cover template ${field} is invalid.`);
    }
    Object.assign(output, { [field]: text });
  }
  return output;
}

function boundedText(value: string, field: string): string {
  if (typeof value !== 'string' || value.length > 16_384) throw new Error(`HTML video cover ${field} is invalid.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
