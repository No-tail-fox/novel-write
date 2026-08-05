import type {
  DraftTemplate,
  OrdinaryTaskCoverAsset,
  OrdinaryTaskCoverRatio,
  OrdinaryTaskCoverSelection,
} from './types';

export const ORDINARY_TASK_COVER_RATIOS = ['9:16', '4:3', '1:1', '16:9'] as const satisfies readonly OrdinaryTaskCoverRatio[];
export const MAX_ORDINARY_TASK_COVER_BYTES = 32 * 1024 * 1024;
export const ORDINARY_TASK_COVER_PAGE_DURATION_MS = 2000;
export const MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH = 80;

const dimensions: Record<OrdinaryTaskCoverRatio, { width: number; height: number }> = {
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1024, height: 768 },
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
};

const supportedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
type SupportedMimeType = typeof supportedMimeTypes[number];

export interface OrdinaryTaskCoverInspection {
  sourcePath: string;
  exists: boolean;
  isFile: boolean;
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: string;
  originalName?: string;
}

export interface OrdinaryTaskCoverPreparedImage {
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: 'image/png';
  sha256: string;
}

export type OrdinaryTaskCoverImageProcessor = (input: {
  sourcePath: string;
  sourceBytes: Uint8Array;
  destinationPath: string;
  dimensions: { width: number; height: number };
}) => Promise<OrdinaryTaskCoverPreparedImage>;

export function normalizeOrdinaryTaskCoverRatio(value: unknown): OrdinaryTaskCoverRatio {
  if (typeof value === 'string' && ORDINARY_TASK_COVER_RATIOS.includes(value as OrdinaryTaskCoverRatio)) {
    return value as OrdinaryTaskCoverRatio;
  }
  throw new Error('ORDINARY_MANUAL_COVER_RATIO_INVALID: Cover ratio is invalid.');
}

export function ordinaryTaskCoverDimensions(ratio: OrdinaryTaskCoverRatio): { width: number; height: number } {
  return { ...dimensions[normalizeOrdinaryTaskCoverRatio(ratio)] };
}

export function normalizeOrdinaryTaskCoverPageText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') {
    throw new Error('ORDINARY_COVER_PAGE_TEXT_INVALID: Cover page text must be a string.');
  }
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (normalized.length > MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH) {
    throw new Error(`ORDINARY_COVER_PAGE_TEXT_TOO_LONG: Cover page text cannot exceed ${MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH} characters.`);
  }
  return normalized;
}

export function resolveOrdinaryTaskCoverPageText(
  text: unknown,
  generatedTitle: unknown,
): string {
  const normalizedText = normalizeOrdinaryTaskCoverPageText(text);
  if (normalizedText) return normalizedText;
  if (typeof generatedTitle !== 'string') return '';
  return generatedTitle
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH);
}

export function resolveOrdinaryTaskCoverTitle(
  template: DraftTemplate,
  text: string,
  generatedTitle?: string,
): DraftTemplate['title'] {
  const normalizedText = resolveOrdinaryTaskCoverPageText(text, generatedTitle);
  const characters = Array.from(normalizedText.replace(/\s/gu, '')).length;
  const explicitLines = normalizedText ? normalizedText.split('\n').length : 1;
  const aspectRatio = template.canvas.width / Math.max(1, template.canvas.height);
  const landscape = aspectRatio > 1.2;
  const square = aspectRatio >= 0.85 && aspectRatio <= 1.2;
  const baseMaximum = landscape ? 16 : square ? 22 : 26;
  const lengthScale = characters > 56 ? 0.5 : characters > 36 ? 0.62 : characters > 20 ? 0.78 : 1;
  const lineScale = explicitLines > 5 ? 0.55 : explicitLines > 3 ? 0.72 : 1;
  const minimum = landscape ? 8 : square ? 10 : 12;
  const fontSize = Math.max(minimum, Math.min(template.title.fontSize, Math.floor(baseMaximum * Math.min(lengthScale, lineScale))));

  return {
    ...template.title,
    visible: Boolean(normalizedText),
    text: normalizedText,
    x: 0,
    y: landscape ? 0.18 : 0.2,
    width: landscape ? 0.78 : 0.88,
    fontSize,
    lineSpacing: Math.max(0, Math.min(template.title.lineSpacing, 2)),
  };
}

export function validateOrdinaryTaskCoverInspection(
  value: OrdinaryTaskCoverInspection,
  ratio: OrdinaryTaskCoverRatio,
): OrdinaryTaskCoverInspection & { mimeType: SupportedMimeType } {
  const expected = ordinaryTaskCoverDimensions(ratio);
  if (!value.exists || !value.isFile || !value.sourcePath.trim()) {
    throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: Cover source file is missing.');
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > MAX_ORDINARY_TASK_COVER_BYTES) {
    throw new Error(`ORDINARY_MANUAL_COVER_SIZE_INVALID: Cover size must be from 1 to ${MAX_ORDINARY_TASK_COVER_BYTES} bytes.`);
  }
  if (value.width !== expected.width || value.height !== expected.height) {
    throw new Error(`ORDINARY_MANUAL_COVER_DIMENSIONS_INVALID: Cover dimensions must be exactly ${expected.width}x${expected.height}.`);
  }
  if (!supportedMimeTypes.includes(value.mimeType as SupportedMimeType)) {
    throw new Error('ORDINARY_MANUAL_COVER_TYPE_INVALID: Cover image type is unsupported.');
  }
  return { ...value, sourcePath: value.sourcePath.trim(), mimeType: value.mimeType as SupportedMimeType };
}

export function createOrdinaryTaskCoverAsset(
  input: Omit<OrdinaryTaskCoverAsset, 'version' | 'mode'>,
): OrdinaryTaskCoverAsset {
  return validateOrdinaryTaskCoverAsset({ version: 1, mode: 'manual', ...input });
}

export function validateOrdinaryTaskCoverAsset(value: unknown): OrdinaryTaskCoverAsset {
  if (!isRecord(value) || value.version !== 1 || value.mode !== 'manual') {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Cover asset version or mode is invalid.');
  }
  const ratio = normalizeOrdinaryTaskCoverRatio(value.ratio);
  const expected = ordinaryTaskCoverDimensions(ratio);
  if (value.width !== expected.width || value.height !== expected.height) {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Cover asset dimensions are invalid.');
  }
  if (typeof value.path !== 'string' || value.path !== 'covers/cover-manual.png') {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Cover asset path must be task-managed.');
  }
  if (typeof value.originalName !== 'string' || !value.originalName || value.originalName.length > 512) {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Original name is invalid.');
  }
  if (!Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) <= 0 || Number(value.sizeBytes) > MAX_ORDINARY_TASK_COVER_BYTES) {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Cover asset size is invalid.');
  }
  if (value.mimeType !== 'image/png') {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Managed cover must be PNG.');
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Cover asset SHA-256 is invalid.');
  }
  if (typeof value.createdAt !== 'string' || !value.createdAt || value.createdAt.length > 128) {
    throw new Error('ORDINARY_MANUAL_COVER_ASSET_INVALID: Cover asset creation time is invalid.');
  }
  return {
    version: 1,
    mode: 'manual',
    path: value.path,
    originalName: value.originalName,
    sizeBytes: Number(value.sizeBytes),
    width: expected.width,
    height: expected.height,
    mimeType: 'image/png',
    sha256: value.sha256,
    ratio,
    createdAt: value.createdAt,
  };
}

export function createOrdinaryTaskCoverSelection(
  id: string,
  asset: OrdinaryTaskCoverAsset,
): OrdinaryTaskCoverSelection {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(id)) {
    throw new Error('ORDINARY_MANUAL_COVER_ID_INVALID: Cover asset id is invalid.');
  }
  const { version: _version, mode: _mode, path: _path, ...selection } = validateOrdinaryTaskCoverAsset(asset);
  return { id, ...selection };
}

export function validateOrdinaryTaskCoverSelection(value: unknown): OrdinaryTaskCoverSelection {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('ORDINARY_MANUAL_COVER_SELECTION_INVALID: Cover selection is invalid.');
  }
  const asset = createOrdinaryTaskCoverAsset({
    path: 'covers/cover-manual.png',
    originalName: value.originalName as string,
    sizeBytes: value.sizeBytes as number,
    width: value.width as number,
    height: value.height as number,
    mimeType: value.mimeType as 'image/png',
    sha256: value.sha256 as string,
    ratio: value.ratio as OrdinaryTaskCoverRatio,
    createdAt: value.createdAt as string,
  });
  return createOrdinaryTaskCoverSelection(value.id, asset);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
