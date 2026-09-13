/** Browser-safe, deterministic subtitle/audio alignment primitives. */

import type {
  ProductionSubtitleAlignmentSource,
  ProductionSubtitleCue,
  ProductionSubtitleToken,
} from './production-workflow';

export const PRODUCTION_SUBTITLE_ALIGNMENT_SOURCES = [
  'provider',
  'whisper',
  'manual',
  'estimated',
] as const satisfies readonly ProductionSubtitleAlignmentSource[];

export type SubtitleAlignmentSource = ProductionSubtitleAlignmentSource;
export type SubtitleTimestampUnit = 'seconds' | 'milliseconds';
export type SubtitleTimestampOrigin = 'absolute' | 'cue';

/** Provider/Whisper timestamp input. Unsuffixed fields require explicit unit/origin. */
export interface ExternalSubtitleTimestamp {
  id?: string;
  text?: string;
  word?: string;
  token?: string;
  start?: number;
  end?: number;
  duration?: number;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  confidence?: number;
}

/** A local transcript/timestamp file after parsing. All entries use absolute milliseconds. */
export interface ParsedSubtitleTimestampFile {
  format: 'json' | 'srt' | 'vtt';
  timestamps: ExternalSubtitleTimestamp[];
  issues: string[];
}

export type SubtitleTimestampLike = ExternalSubtitleTimestamp | readonly [number, number];

/**
 * Parse a local Whisper/OpenAI-style JSON transcript or an SRT/VTT file.
 * This adapter deliberately does not perform network I/O or infer units: the
 * returned entries always carry explicit `startMs`/`endMs` fields, so callers
 * can safely feed them into `alignSubtitleCue` with `source: 'whisper'`.
 */
export function parseSubtitleTimestampFile(contents: string, fileName = ''): ParsedSubtitleTimestampFile {
  const extension = fileName.trim().toLowerCase().split('.').pop();
  if (extension === 'srt' || extension === 'vtt' || (!extension && /^\s*(?:WEBVTT|\d+\s*\r?\n)/u.test(contents))) {
    return parseTimedTextFile(contents, extension === 'vtt' ? 'vtt' : 'srt');
  }
  try {
    const value: unknown = JSON.parse(contents);
    const timestamps: ExternalSubtitleTimestamp[] = [];
    collectJsonTimestamps(value, timestamps);
    return { format: 'json', timestamps, issues: timestamps.length ? [] : ['json-no-timestamps'] };
  } catch {
    return { format: 'json', timestamps: [], issues: ['json-invalid'] };
  }
}

function collectJsonTimestamps(value: unknown, output: ExternalSubtitleTimestamp[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonTimestamps(item, output));
    return;
  }
  if (!isRecord(value)) return;
  const nested = [value.words, value.tokens].find(Array.isArray);
  if (nested) {
    nested.forEach((item) => collectJsonTimestamps(item, output));
    return;
  }
  const start = finite(value.startMs) ? value.startMs : finite(value.start) ? Number(value.start) * 1000 : undefined;
  const end = finite(value.endMs) ? value.endMs : finite(value.end) ? Number(value.end) * 1000 : undefined;
  if (start !== undefined && end !== undefined && end > start) {
    const text = typeof value.word === 'string' ? value.word : typeof value.token === 'string' ? value.token : typeof value.text === 'string' ? value.text : undefined;
    output.push({ ...(text === undefined ? {} : { text }), startMs: Math.round(start), endMs: Math.round(end), ...(finite(value.confidence) ? { confidence: clamp(Number(value.confidence), 0, 1) } : {}) });
    return;
  }
  const segments = value.segments;
  if (Array.isArray(segments)) segments.forEach((item) => collectJsonTimestamps(item, output));
}

function parseTimedTextFile(contents: string, format: 'srt' | 'vtt'): ParsedSubtitleTimestampFile {
  const timestamps: ExternalSubtitleTimestamp[] = [];
  const blocks = contents.replace(/^\uFEFF?WEBVTT[^\n]*\r?\n?/iu, '').split(/\r?\n\s*\r?\n/u);
  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/u.test(line));
    if (timingIndex < 0) return;
    const match = lines[timingIndex].match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/u);
    if (!match) return;
    const startMs = parseTimedTextTime(match[1]);
    const endMs = parseTimedTextTime(match[2]);
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/gu, '').trim();
    if (startMs !== undefined && endMs !== undefined && endMs > startMs && text) timestamps.push({ text, startMs, endMs });
  });
  return { format, timestamps, issues: timestamps.length ? [] : ['timed-text-no-timestamps'] };
}

function parseTimedTextTime(value: string): number | undefined {
  const match = value.trim().replace(',', '.').match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/u);
  if (!match) return undefined;
  const milliseconds = (((Number(match[1]) * 60) + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

export interface SubtitleAlignmentDependencies {
  text?: string;
  startMs?: number;
  endMs?: number;
  audioAssetVersionId?: string | null;
  voiceId?: string | null;
  voiceSpeed?: number | null;
  /** Style is metadata only and intentionally does not invalidate timing. */
  styleRef?: string | null;
}

export interface SubtitleAlignmentOptions extends SubtitleAlignmentDependencies {
  timestamps?: readonly SubtitleTimestampLike[] | null;
  source?: SubtitleAlignmentSource;
  timestampUnit?: SubtitleTimestampUnit;
  timestampOrigin?: SubtitleTimestampOrigin;
}

export interface NormalizeSubtitleTimestampOptions {
  cueStartMs: number;
  cueEndMs: number;
  timestampUnit?: SubtitleTimestampUnit;
  timestampOrigin?: SubtitleTimestampOrigin;
}

export interface SubtitleAlignmentResult {
  tokens: ProductionSubtitleToken[];
  source: SubtitleAlignmentSource;
  estimated: boolean;
  textHash: string;
  alignmentFingerprint: string;
  issues: string[];
}

export interface ProductionSubtitleCueValidationIssue {
  path: string;
  message: string;
}

const MAX_CUE_DURATION_MS = 24 * 60 * 60 * 1000;
const MIN_TOKEN_DURATION_MS = 1;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

/** Split Han characters while keeping Latin/number runs together. */
export function tokenizeSubtitleText(text: string): string[] {
  const graphemes = segmentGraphemes(normalizeText(text));
  const result: string[] = [];
  let run = '';
  const flush = (): void => {
    if (run) result.push(run);
    run = '';
  };
  graphemes.forEach((grapheme, index) => {
    if (/^\s+$/u.test(grapheme)) {
      flush();
    } else if (isHan(grapheme)) {
      flush();
      result.push(grapheme);
    } else if (isWord(grapheme) || isWordJoiner(graphemes, index)) {
      run += grapheme;
    } else {
      flush();
      result.push(grapheme);
    }
  });
  flush();
  return result;
}

/**
 * Convert provider timestamps into clamped, strictly positive, monotonic ms
 * ranges. Any malformed/ambiguous entry invalidates the complete input rather
 * than being silently filtered out.
 */
export function normalizeSubtitleTimestamps(
  timestamps: readonly SubtitleTimestampLike[],
  options: NormalizeSubtitleTimestampOptions,
): ProductionSubtitleToken[] {
  const cueStartMs = finite(options.cueStartMs) ? Math.round(options.cueStartMs) : 0;
  const cueEndMs = finite(options.cueEndMs) ? Math.round(options.cueEndMs) : cueStartMs;
  if (cueEndMs <= cueStartMs || cueEndMs - cueStartMs > MAX_CUE_DURATION_MS) return [];

  const parsed = timestamps.map((entry, index) => parseTimestamp(entry, options, cueStartMs, index));
  if (parsed.some((entry): entry is undefined => entry === undefined)) return [];
  const ordered = parsed as ParsedTimestamp[];
  ordered.sort((left, right) => left.startMs - right.startMs || left.index - right.index);

  const result: ProductionSubtitleToken[] = [];
  let previousEnd = cueStartMs;
  for (const entry of ordered) {
    // A timestamp entirely outside the cue is invalid, not a reason to drop a
    // word and accidentally label the remaining partial alignment as real.
    if (entry.endMs <= cueStartMs || entry.startMs >= cueEndMs) return [];
    const start = Math.max(previousEnd, cueStartMs, Math.round(entry.startMs));
    const end = Math.min(cueEndMs, Math.round(entry.endMs));
    if (end <= start) return [];
    result.push({
      ...(entry.id === undefined ? {} : { id: entry.id }),
      text: entry.text ?? '',
      startMs: start,
      endMs: end,
      ...(entry.confidence === undefined ? {} : { confidence: entry.confidence }),
    });
    previousEnd = end;
  }
  return result;
}

/** Estimate a complete cue timeline; estimation is always labelled explicitly. */
export function estimateSubtitleTokenTimings(text: string, startMs: number, endMs: number): ProductionSubtitleToken[] {
  const tokenTexts = tokenizeSubtitleText(text);
  const start = finite(startMs) ? Math.round(startMs) : 0;
  const end = finite(endMs) ? Math.round(endMs) : start;
  if (tokenTexts.length === 0 || end <= start) return [];

  const maxCount = Math.max(1, Math.floor((end - start) / MIN_TOKEN_DURATION_MS));
  const texts = tokenTexts.length <= maxCount ? tokenTexts : compressTokenTexts(tokenTexts, maxCount);
  const weights = texts.map(tokenWeight);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || texts.length;
  const remaining = end - start - texts.length * MIN_TOKEN_DURATION_MS;
  const durations = weights.map((weight) => MIN_TOKEN_DURATION_MS + Math.floor((remaining * weight) / totalWeight));
  let assigned = durations.reduce((sum, value) => sum + value, 0);
  for (let index = 0; assigned < end - start; index = (index + 1) % durations.length) {
    durations[index] += 1;
    assigned += 1;
  }

  let cursor = start;
  return texts.map((tokenText, index) => {
    const token = { text: tokenText, startMs: cursor, endMs: cursor + durations[index] };
    cursor = token.endMs;
    return token;
  });
}

/** Align a cue with provider timestamps or an explicit estimated fallback. */
export function alignSubtitleCue(cue: ProductionSubtitleCue, options: SubtitleAlignmentOptions = {}): ProductionSubtitleCue {
  const result = alignSubtitleCueDetailed(cue, options);
  const next: ProductionSubtitleCue = {
    ...cue,
    ...(options.text === undefined ? {} : { text: options.text }),
    ...(options.startMs === undefined ? {} : { startMs: options.startMs }),
    ...(options.endMs === undefined ? {} : { endMs: options.endMs }),
    tokens: result.tokens,
    alignmentSource: result.source,
    textHash: result.textHash,
    alignmentFingerprint: result.alignmentFingerprint,
  };
  applyDependency(next, 'audioAssetVersionId', options.audioAssetVersionId, cue.audioAssetVersionId);
  applyDependency(next, 'voiceId', options.voiceId, cue.voiceId);
  applyDependency(next, 'voiceSpeed', options.voiceSpeed, cue.voiceSpeed);
  applyDependency(next, 'styleRef', options.styleRef, cue.styleRef);
  return next;
}

/**
 * Align one authored cue from a parsed local transcript. Entries outside the
 * cue are ignored so a full-file transcript can be imported one sentence at a
 * time; an incomplete/mismatched slice still falls back to `estimated` and
 * remains visibly distinguishable in the inspector.
 */
export function alignSubtitleCueFromTimestampFile(
  cue: ProductionSubtitleCue,
  contents: string,
  fileName = '',
): { cue: ProductionSubtitleCue; file: ParsedSubtitleTimestampFile; issues: string[] } {
  const file = parseSubtitleTimestampFile(contents, fileName);
  const timestamps = file.timestamps.filter((entry) => {
    const start = Number(entry.startMs);
    const end = Number(entry.endMs);
    return Number.isFinite(start) && Number.isFinite(end) && end > cue.startMs && start < cue.endMs;
  });
  const aligned = alignSubtitleCue(cue, {
    source: 'whisper',
    timestamps,
    timestampUnit: 'milliseconds',
    timestampOrigin: 'absolute',
    audioAssetVersionId: cue.audioAssetVersionId,
    voiceId: cue.voiceId,
    voiceSpeed: cue.voiceSpeed,
  });
  const issues = [...file.issues];
  if (timestamps.length === 0) issues.push('cue-no-overlapping-timestamps');
  if (aligned.alignmentSource !== 'whisper') issues.push('cue-text-or-timestamps-mismatch');
  return { cue: aligned, file, issues: [...new Set(issues)] };
}

export function alignSubtitleCueDetailed(cue: ProductionSubtitleCue, options: SubtitleAlignmentOptions = {}): SubtitleAlignmentResult {
  const text = options.text ?? cue.text;
  const startMs = options.startMs ?? cue.startMs;
  const endMs = options.endMs ?? cue.endMs;
  const tokenTexts = tokenizeSubtitleText(text);
  const issues: string[] = [];
  const supplied = options.timestamps;
  const hasSupplied = supplied !== undefined && supplied !== null;
  let tokens: ProductionSubtitleToken[] = [];
  let source: SubtitleAlignmentSource = 'estimated';

  if (hasSupplied && supplied && supplied.length > 0 && options.source !== 'estimated') {
    const normalized = normalizeSubtitleTimestamps(supplied, {
      cueStartMs: startMs,
      cueEndMs: endMs,
      timestampUnit: options.timestampUnit,
      timestampOrigin: options.timestampOrigin,
    });
    const suppliedText = supplied.map((entry) => externalText(entry));
    const hasText = suppliedText.some((value) => value !== undefined);
    const completeText = suppliedText.every((value) => typeof value === 'string' && value.trim().length > 0);
    if (normalized.length > 0 && (!hasText || completeText)
      && (hasText ? tokenTextCoverage(normalized, text) : normalized.length === tokenTexts.length)) {
      tokens = hasText
        ? normalized
        : normalized.map((token, index) => ({ ...token, text: tokenTexts[index] }));
      source = options.source ?? 'provider';
    } else {
      issues.push(normalized.length === 0 ? 'external-timestamps-invalid' : 'external-text-mismatch');
    }
  }

  // Reopen a saved provider cue only when all timing dependencies still match.
  // This preserves whole-word Chinese boundaries even if the local tokenizer
  // would split the same text into characters.
  if (tokens.length === 0 && !hasSupplied && dependenciesMatch(cue, options, text, startMs, endMs)) {
    const existing = cue.tokens;
    if (existing && existing.length > 0 && tokenTextCoverage(existing, text)
      && validateSubtitleTokens(existing, startMs, endMs).length === 0) {
      tokens = existing.map((token) => ({ ...token }));
      source = cue.alignmentSource ?? 'manual';
    }
  }

  if (tokens.length === 0) {
    tokens = estimateSubtitleTokenTimings(text, startMs, endMs);
    source = 'estimated';
    if (tokenTexts.length > 0 && endMs <= startMs) issues.push('cue-range-invalid');
  }

  const dependencies = mergeDependencies(cue, options, text, startMs, endMs);
  return {
    tokens,
    source,
    estimated: source === 'estimated',
    textHash: hashSubtitleText(text),
    alignmentFingerprint: hashSubtitleAlignment(dependencies),
    issues,
  };
}

/** Lightweight browser-safe identity hash for text and dependency fingerprints. */
export function hashSubtitleText(text: string): string {
  return fnv1a64(normalizeText(text));
}

export function hashSubtitleAlignment(dependencies: SubtitleAlignmentDependencies): string {
  return fnv1a64(JSON.stringify({
    text: normalizeText(dependencies.text ?? ''),
    startMs: finite(dependencies.startMs) ? dependencies.startMs : null,
    endMs: finite(dependencies.endMs) ? dependencies.endMs : null,
    audioAssetVersionId: dependencies.audioAssetVersionId ?? null,
    voiceId: dependencies.voiceId ?? null,
    voiceSpeed: normalizeRate(dependencies.voiceSpeed),
  }));
}

export function validateSubtitleTokens(tokens: readonly ProductionSubtitleToken[], cueStartMs: number, cueEndMs: number): ProductionSubtitleCueValidationIssue[] {
  if (!finite(cueStartMs) || !finite(cueEndMs) || cueEndMs <= cueStartMs) {
    return [{ path: 'range', message: 'Subtitle cue range must be finite and positive.' }];
  }
  const issues: ProductionSubtitleCueValidationIssue[] = [];
  let previousEnd = cueStartMs;
  tokens.forEach((token, index) => {
    const path = `tokens[${index}]`;
    if (!token || typeof token.text !== 'string' || token.text.trim().length === 0) issues.push({ path: `${path}.text`, message: 'Subtitle token text must be non-empty.' });
    if (!token) return;
    if (!finite(token.startMs) || !finite(token.endMs)) {
      issues.push({ path, message: 'Subtitle token timestamps must be finite.' });
      return;
    }
    if (token.startMs < cueStartMs || token.endMs > cueEndMs) issues.push({ path, message: 'Subtitle token must remain inside its cue.' });
    if (token.endMs <= token.startMs) issues.push({ path, message: 'Subtitle token duration must be positive.' });
    if (token.startMs < previousEnd) issues.push({ path, message: 'Subtitle token timestamps must be monotonic and non-overlapping.' });
    if (token.confidence !== undefined && (!finite(token.confidence) || token.confidence < 0 || token.confidence > 1)) issues.push({ path: `${path}.confidence`, message: 'Subtitle token confidence must be between 0 and 1.' });
    previousEnd = Math.max(previousEnd, token.endMs);
  });
  return issues;
}

export function validateProductionSubtitleCue(value: unknown): ProductionSubtitleCueValidationIssue[] {
  if (!isRecord(value)) return [{ path: '', message: 'Subtitle cue must be an object.' }];
  const issues: ProductionSubtitleCueValidationIssue[] = [];
  if (typeof value.id !== 'string' || value.id.trim().length === 0) issues.push({ path: 'id', message: 'Subtitle cue id is required.' });
  if (typeof value.text !== 'string') issues.push({ path: 'text', message: 'Subtitle cue text is required.' });
  if (!finite(value.startMs) || !finite(value.endMs) || value.endMs <= value.startMs) issues.push({ path: 'range', message: 'Subtitle cue range must be finite and positive.' });
  if (value.alignmentSource !== undefined && !PRODUCTION_SUBTITLE_ALIGNMENT_SOURCES.includes(value.alignmentSource as SubtitleAlignmentSource)) issues.push({ path: 'alignmentSource', message: 'Unknown subtitle alignment source.' });
  if (value.tokens !== undefined) {
    if (!Array.isArray(value.tokens)) issues.push({ path: 'tokens', message: 'Subtitle tokens must be an array.' });
    else if (value.tokens.some((token) => !isRecord(token))) issues.push({ path: 'tokens', message: 'Subtitle tokens must be objects.' });
    else issues.push(...validateSubtitleTokens(value.tokens as ProductionSubtitleToken[], Number(value.startMs), Number(value.endMs)));
  }
  if (value.voiceSpeed !== undefined && (!finite(value.voiceSpeed) || value.voiceSpeed <= 0)) issues.push({ path: 'voiceSpeed', message: 'Voice speed must be positive.' });
  return issues;
}

export function isProductionSubtitleCue(value: unknown): value is ProductionSubtitleCue {
  return validateProductionSubtitleCue(value).length === 0;
}

export function normalizeProductionSubtitleCue(value: unknown): ProductionSubtitleCue {
  const issues = validateProductionSubtitleCue(value);
  if (issues.length > 0) throw new Error(`Invalid subtitle cue: ${issues.map((issue) => issue.message).join(' ')}`);
  const source = value as Record<string, unknown>;
  const cue: ProductionSubtitleCue = {
    id: source.id as string,
    startMs: source.startMs as number,
    endMs: source.endMs as number,
    text: source.text as string,
  };
  const stringFields: Array<keyof ProductionSubtitleCue> = ['shotId', 'sourceId', 'alignmentSource', 'textHash', 'audioAssetVersionId', 'voiceId', 'styleRef', 'alignmentFingerprint'];
  stringFields.forEach((field) => {
    if (typeof source[field] === 'string') (cue as unknown as Record<string, unknown>)[field] = source[field];
  });
  if (finite(source.voiceSpeed)) cue.voiceSpeed = source.voiceSpeed;
  if (Array.isArray(source.tokens)) cue.tokens = source.tokens.map((token) => ({ ...(token as ProductionSubtitleToken) }));
  return cue;
}

export function subtitleAlignmentInvalidationReasons(cue: ProductionSubtitleCue, dependencies: SubtitleAlignmentDependencies = {}): string[] {
  const reasons: string[] = [];
  const expectedText = dependencies.text ?? cue.text;
  const expectedStart = dependencies.startMs ?? cue.startMs;
  const expectedEnd = dependencies.endMs ?? cue.endMs;
  if ((!cue.tokens || cue.tokens.length === 0) && compactText(cue.text).length > 0) reasons.push('missing-tokens');
  else if (cue.tokens && validateSubtitleTokens(cue.tokens, cue.startMs, cue.endMs).length > 0) reasons.push('timeline-invalid');
  if (cue.textHash && cue.textHash !== hashSubtitleText(expectedText)) reasons.push('text-changed');
  else if (!cue.textHash && dependencies.text !== undefined && dependencies.text !== cue.text) reasons.push('text-changed');
  if (dependencies.audioAssetVersionId !== undefined && dependencies.audioAssetVersionId !== (cue.audioAssetVersionId ?? null)) reasons.push('audio-changed');
  if (dependencies.voiceId !== undefined && dependencies.voiceId !== (cue.voiceId ?? null)) reasons.push('voice-changed');
  if (dependencies.voiceSpeed !== undefined && normalizeRate(dependencies.voiceSpeed) !== normalizeRate(cue.voiceSpeed)) reasons.push('rate-changed');
  if (dependencies.startMs !== undefined && dependencies.startMs !== cue.startMs) reasons.push('range-changed');
  if (dependencies.endMs !== undefined && dependencies.endMs !== cue.endMs) reasons.push('range-changed');
  if (cue.alignmentFingerprint && cue.alignmentFingerprint !== hashSubtitleAlignment({
    text: expectedText,
    startMs: expectedStart,
    endMs: expectedEnd,
    audioAssetVersionId: dependencies.audioAssetVersionId !== undefined ? dependencies.audioAssetVersionId : cue.audioAssetVersionId,
    voiceId: dependencies.voiceId !== undefined ? dependencies.voiceId : cue.voiceId,
    voiceSpeed: dependencies.voiceSpeed !== undefined ? dependencies.voiceSpeed : cue.voiceSpeed,
  })) reasons.push('fingerprint-mismatch');
  return [...new Set(reasons)];
}

export function isSubtitleAlignmentValid(cue: ProductionSubtitleCue, dependencies: SubtitleAlignmentDependencies = {}): boolean {
  return subtitleAlignmentInvalidationReasons(cue, dependencies).length === 0;
}

export function invalidateSubtitleAlignment(cue: ProductionSubtitleCue, updates: SubtitleAlignmentDependencies = {}): ProductionSubtitleCue {
  const { tokens: _tokens, alignmentSource: _source, textHash: _textHash, alignmentFingerprint: _fingerprint, ...base } = cue;
  const next: ProductionSubtitleCue = {
    ...base,
    ...(updates.text === undefined ? {} : { text: updates.text }),
    ...(updates.startMs === undefined ? {} : { startMs: updates.startMs }),
    ...(updates.endMs === undefined ? {} : { endMs: updates.endMs }),
  };
  applyDependency(next, 'audioAssetVersionId', updates.audioAssetVersionId, cue.audioAssetVersionId);
  applyDependency(next, 'voiceId', updates.voiceId, cue.voiceId);
  applyDependency(next, 'voiceSpeed', updates.voiceSpeed, cue.voiceSpeed);
  applyDependency(next, 'styleRef', updates.styleRef, cue.styleRef);
  return next;
}

interface ParsedTimestamp {
  index: number;
  id?: string;
  text?: string;
  confidence?: number;
  startMs: number;
  endMs: number;
}

function parseTimestamp(entry: SubtitleTimestampLike, options: NormalizeSubtitleTimestampOptions, cueStartMs: number, index: number): ParsedTimestamp | undefined {
  if (Array.isArray(entry)) {
    if (!options.timestampUnit || !options.timestampOrigin) return undefined;
    const start = convertTime(entry[0], options.timestampUnit, options.timestampOrigin, cueStartMs);
    const end = convertTime(entry[1], options.timestampUnit, options.timestampOrigin, cueStartMs);
    return validRange(start, end) ? { index, startMs: start, endMs: end } : undefined;
  }
  if (!isRecord(entry)) return undefined;
  const objectEntry = entry as ExternalSubtitleTimestamp;
  const hasMs = objectEntry.startMs !== undefined || objectEntry.endMs !== undefined || objectEntry.durationMs !== undefined;
  const hasRaw = objectEntry.start !== undefined || objectEntry.end !== undefined || objectEntry.duration !== undefined;
  if (hasMs && hasRaw) return undefined;
  if (hasRaw && (!options.timestampUnit || !options.timestampOrigin)) return undefined;
  const unit: SubtitleTimestampUnit = hasMs ? 'milliseconds' : options.timestampUnit as SubtitleTimestampUnit;
  const origin: SubtitleTimestampOrigin = hasMs ? 'absolute' : options.timestampOrigin as SubtitleTimestampOrigin;
  const startRaw = hasMs ? objectEntry.startMs : objectEntry.start;
  const endRaw = hasMs ? objectEntry.endMs : objectEntry.end;
  const durationRaw = hasMs ? objectEntry.durationMs : objectEntry.duration;
  if (!finite(startRaw)) return undefined;
  const start = convertTime(startRaw, unit, origin, cueStartMs);
  const end = finite(endRaw) ? convertTime(endRaw, unit, origin, cueStartMs)
    : finite(durationRaw) ? start + convertDuration(durationRaw, unit) : Number.NaN;
  if (!validRange(start, end)) return undefined;
  const text = externalText(objectEntry);
  const id = typeof objectEntry.id === 'string' && objectEntry.id.trim() ? objectEntry.id : undefined;
  const confidence = finite(objectEntry.confidence) ? clamp(objectEntry.confidence, 0, 1) : undefined;
  return { index, ...(id === undefined ? {} : { id }), ...(text === undefined ? {} : { text }), ...(confidence === undefined ? {} : { confidence }), startMs: start, endMs: end };
}

function convertTime(value: number, unit: SubtitleTimestampUnit, origin: SubtitleTimestampOrigin, cueStartMs: number): number {
  const milliseconds = unit === 'seconds' ? value * 1000 : value;
  return Math.round(milliseconds + (origin === 'cue' ? cueStartMs : 0));
}

function convertDuration(value: number, unit: SubtitleTimestampUnit): number {
  return unit === 'seconds' ? value * 1000 : value;
}

function validRange(startMs: number, endMs: number): boolean {
  return finite(startMs) && finite(endMs) && endMs > startMs;
}

function tokenTextCoverage(tokens: readonly ProductionSubtitleToken[], text: string): boolean {
  const joined = tokens.map((token) => token.text).join('');
  return joined.length > 0 && compactText(joined) === compactText(text);
}

function dependenciesMatch(cue: ProductionSubtitleCue, options: SubtitleAlignmentOptions, text: string, startMs: number, endMs: number): boolean {
  if (options.text !== undefined && options.text !== cue.text) return false;
  if (options.startMs !== undefined && options.startMs !== cue.startMs) return false;
  if (options.endMs !== undefined && options.endMs !== cue.endMs) return false;
  if (options.audioAssetVersionId !== undefined && options.audioAssetVersionId !== (cue.audioAssetVersionId ?? null)) return false;
  if (options.voiceId !== undefined && options.voiceId !== (cue.voiceId ?? null)) return false;
  if (options.voiceSpeed !== undefined && normalizeRate(options.voiceSpeed) !== normalizeRate(cue.voiceSpeed)) return false;
  if (cue.textHash && cue.textHash !== hashSubtitleText(text)) return false;
  if (cue.alignmentFingerprint && cue.alignmentFingerprint !== hashSubtitleAlignment(mergeDependencies(cue, options, text, startMs, endMs))) return false;
  return true;
}

function mergeDependencies(cue: ProductionSubtitleCue, options: SubtitleAlignmentOptions, text: string, startMs: number, endMs: number): SubtitleAlignmentDependencies {
  return {
    text,
    startMs,
    endMs,
    audioAssetVersionId: options.audioAssetVersionId !== undefined ? options.audioAssetVersionId : cue.audioAssetVersionId,
    voiceId: options.voiceId !== undefined ? options.voiceId : cue.voiceId,
    voiceSpeed: options.voiceSpeed !== undefined ? options.voiceSpeed : cue.voiceSpeed,
  };
}

function applyDependency(target: ProductionSubtitleCue, key: 'audioAssetVersionId' | 'voiceId' | 'voiceSpeed' | 'styleRef', value: string | number | null | undefined, fallback: string | number | undefined): void {
  const next = value === undefined ? fallback : value;
  if (next === null || next === undefined) delete target[key];
  else (target as unknown as Record<string, unknown>)[key] = next;
}

function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/gu, '');
}

function normalizeText(value: string): string {
  return String(value ?? '').replace(/\r\n?/gu, '\n').normalize('NFC');
}

function externalText(entry: SubtitleTimestampLike): string | undefined {
  if (Array.isArray(entry) || !isRecord(entry)) return undefined;
  const objectEntry = entry as ExternalSubtitleTimestamp;
  return [objectEntry.text, objectEntry.word, objectEntry.token].find((value): value is string => typeof value === 'string');
}

function compressTokenTexts(values: readonly string[], count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * values.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / count));
    return values.slice(start, end).join('');
  });
}

function tokenWeight(value: string): number {
  return /^[\p{P}\p{S}]+$/u.test(value) ? 0.35 : Math.max(1, segmentGraphemes(value).length);
}

function segmentGraphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locales?: string | string[], options?: { granularity?: string }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    try {
      return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (part) => part.segment);
    } catch {
      // Fall through for older WebViews.
    }
  }
  return Array.from(value);
}

function isHan(value: string): boolean {
  return /^\p{Script=Han}$/u.test(value);
}

function isWord(value: string): boolean {
  return /^[\p{L}\p{N}\p{M}]$/u.test(value);
}

function isWordJoiner(values: readonly string[], index: number): boolean {
  const value = values[index];
  return /^[\u0027\u2019\u002D\u2010\u2011]$/u.test(value)
    && index > 0 && index + 1 < values.length && isWord(values[index - 1]) && isWord(values[index + 1]);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRate(value: number | null | undefined): number | null {
  return finite(value) ? Math.round(value * 10_000) / 10_000 : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fnv1a64(value: string): string {
  let hash = FNV_OFFSET;
  for (const byte of utf8Bytes(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  return Uint8Array.from(bytes);
}
