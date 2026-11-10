// Storyboard LLM response parsing, split out of runner.ts (O-5). Pure: no I/O, no task state.
import type { StoryboardScene } from './types';
import { normalizeStoryboardSceneLengths } from './story';
import { countVisibleCharacters } from './content-metrics';

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`LLM JSON field ${label} is required.`);
  }
  return value;
}

function normalizeScenes(input: unknown): StoryboardScene[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('LLM storyboard response did not include scenes.');
  }
  const scenes = input.map((scene, index) => {
    const item = scene as Partial<StoryboardScene> & { desc_prompt?: unknown };
    const cap = requireString(item.cap, `scenes[${index}].cap`);
    return {
      id: Number(item.id ?? index + 1),
      cap,
      descPrompt: String(item.descPrompt ?? item.desc_prompt ?? cap),
      durationMs: Math.max(800, Number(item.durationMs ?? estimateSceneDurationMs(cap))),
    };
  });
  return normalizeStoryboardSceneLengths(scenes);
}

export function normalizeStoryboardResponse(input: unknown, raw = '', rewrittenCopy = ''): StoryboardScene[] {
  const responseError = extractStoryboardResponseError(input);
  if (responseError) {
    throw new Error(`LLM storyboard response reported an error: ${responseError}.${storyboardResponseDebugHint(input, raw)}`);
  }
  const anchors = extractStoryboardTailAnchors(input);
  if (anchors) {
    return normalizeStoryboardTailAnchors(anchors, rewrittenCopy, input, raw);
  }
  const scenes = extractStoryboardScenes(input);
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error(`LLM storyboard response did not include scenes.${storyboardResponseDebugHint(input, raw)}`);
  }
  return normalizeScenes(scenes);
}

function extractStoryboardResponseError(input: unknown): string | null {
  const parsedInput = maybeParseStoryboardJson(input);
  if (parsedInput !== input) return extractStoryboardResponseError(parsedInput);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of ['error', 'errors']) {
    if (!(key in record) || record[key] === null || record[key] === undefined) continue;
    const detail = storyboardResponseErrorDetail(record[key]);
    if (detail) return detail;
  }
  if (record.ok === false || record.success === false) {
    return storyboardResponseErrorDetail(record.message ?? record.detail ?? record.reason) || 'provider reported an unsuccessful storyboard response';
  }
  for (const key of ['data', 'result', 'output', 'response']) {
    const nested = record[key];
    if (!nested || typeof nested !== 'object') continue;
    const nestedError = extractStoryboardResponseError(nested);
    if (nestedError) return nestedError;
  }
  return null;
}

function storyboardResponseErrorDetail(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  try {
    const serialized = JSON.stringify(value);
    return (serialized ?? String(value)).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
}

function normalizeStoryboardTailAnchors(anchors: string[], rewrittenCopy: string, input: unknown, raw: string): StoryboardScene[] {
  const validationError = validateStoryboardTailAnchorArray(anchors);
  if (validationError) {
    throw new Error(`${validationError}${storyboardResponseDebugHint(input, raw)}`);
  }
  const copy = requireString(rewrittenCopy, 'rewrittenCopy');
  const extracted = extractScenesFromTailAnchors(copy, anchors);
  if (extracted.missed.length > 0) {
    throw new Error(`LLM storyboard tail anchors did not match rewritten copy: ${extracted.missed.join(' / ')}.${storyboardResponseDebugHint(input, raw)}`);
  }
  const coverageError = storyboardTextCoverageError(extracted.scenes, copy);
  if (coverageError) {
    throw new Error(`${coverageError}${storyboardResponseDebugHint(input, raw)}`);
  }
  if (extracted.scenes.length === 0) {
    throw new Error(`LLM storyboard response did not produce scenes from tail anchors.${storyboardResponseDebugHint(input, raw)}`);
  }
  return normalizeStoryboardSceneLengths(extracted.scenes);
}

const STORYBOARD_TAIL_ANCHOR_KEYS = new Set([
  'anchor',
  'anchors',
  'tailanchor',
  'tailanchors',
  'cutanchor',
  'cutanchors',
  'endinganchor',
  'endinganchors',
  '锚点',
  '尾锚',
  '尾锚点',
  '尾部锚点',
  '分镜锚点',
  '切分锚点',
  '句尾锚点',
]);

const STORYBOARD_TAIL_ANCHOR_CONTAINER_KEYS = new Set([
  'scene',
  'scenes',
  'storyboard',
  'storyboards',
  'scenelist',
  'sentences',
  'shots',
  'items',
  'list',
  'values',
  'data',
  'result',
  'output',
  'content',
  'response',
  '分镜',
  '分镜列表',
  '镜头',
  '镜头列表',
]);

function extractStoryboardTailAnchors(input: unknown, allowPlainText = false): string[] | undefined {
  const parsedInput = maybeParseStoryboardJson(input);
  if (parsedInput !== input) {
    return extractStoryboardTailAnchors(parsedInput, allowPlainText);
  }
  if (typeof input === 'string') {
    return allowPlainText ? parseStoryboardTailAnchorText(input) : undefined;
  }
  if (Array.isArray(input)) {
    return input.every((item) => typeof item === 'string') ? input.map((item) => item.trim()) : undefined;
  }
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const entries = Object.entries(record);

  for (const [key, value] of entries) {
    if (!STORYBOARD_TAIL_ANCHOR_KEYS.has(normalizeStoryboardResponseKey(key))) continue;
    const anchors = extractStoryboardTailAnchors(value, true);
    if (anchors) return anchors;
  }

  for (const [key, value] of entries) {
    if (!STORYBOARD_TAIL_ANCHOR_CONTAINER_KEYS.has(normalizeStoryboardResponseKey(key))) continue;
    const anchors = extractStoryboardTailAnchors(value);
    if (anchors) return anchors;
  }

  if (entries.length === 1) {
    return extractStoryboardTailAnchors(entries[0][1], true);
  }
  return undefined;
}

function normalizeStoryboardResponseKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/gu, '');
}

function parseStoryboardTailAnchorText(value: string): string[] | undefined {
  const lines = stripJsonCodeFence(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line
      .replace(/^(?:[-*•]\s*|\d+[.)、:：]\s*)/u, '')
      .replace(/^["'“](.*)["'”][,，]?$/u, '$1')
      .trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function validateStoryboardTailAnchorArray(anchors: string[]): string | null {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return 'LLM storyboard response did not include tail anchors.';
  }
  for (let index = 0; index < anchors.length; index += 1) {
    if (typeof anchors[index] !== 'string' || anchors[index].trim().length === 0) {
      return `LLM storyboard tail anchor ${index + 1} must be a non-empty string.`;
    }
  }
  return null;
}

function extractScenesFromTailAnchors(text: string, anchors: string[]): { scenes: StoryboardScene[]; matched: number; total: number; missed: string[] } {
  const indexed: Array<{ ch: string; origIdx: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '“' && text[index] !== '”') {
      indexed.push({ ch: text[index], origIdx: index });
    }
  }
  const normalizedText = indexed.map((item) => item.ch).join('');
  const scenes: StoryboardScene[] = [];
  const missed: string[] = [];
  let originalStart = 0;
  let normalizedSearchStart = 0;

  for (const anchor of anchors) {
    const cleanAnchor = anchor.trim().replace(/[“”]/gu, '');
    if (!cleanAnchor) continue;
    const normalizedEnd = findStoryboardAnchorEnd(normalizedText, normalizedSearchStart, cleanAnchor);
    if (normalizedEnd === null) {
      missed.push(cleanAnchor.length > 20 ? `${cleanAnchor.slice(0, 20)}…` : cleanAnchor);
      continue;
    }

    const indexedEnd = Math.min(normalizedEnd - 1, indexed.length - 1);
    const originalEndIndex = indexed[indexedEnd]?.origIdx;
    const originalEnd = originalEndIndex === undefined ? text.length : originalEndIndex + 1;
    const cap = text.slice(originalStart, originalEnd).trim();
    if (cap) scenes.push(sceneFromCap(cap, scenes.length));
    originalStart = originalEnd;
    normalizedSearchStart = normalizedEnd;
  }

  const tail = text.slice(originalStart).trim();
  if (tail) scenes.push(sceneFromCap(tail, scenes.length));
  const total = anchors.filter((anchor) => anchor.trim()).length;
  return { scenes, matched: total - missed.length, total, missed };
}

function findStoryboardAnchorEnd(text: string, searchStart: number, anchor: string): number | null {
  const exactIndex = text.indexOf(anchor, searchStart);
  if (exactIndex >= 0) {
    return exactIndex + anchor.length;
  }

  const compactAnchor = anchor.replace(/\s+/gu, '');
  if (compactAnchor.length >= 3) {
    const nonWhitespace = normalizedCharsFrom(text, searchStart);
    const compactIndex = nonWhitespace.map((item) => item.ch).join('').indexOf(compactAnchor);
    if (compactIndex >= 0) {
      return nonWhitespace[compactIndex + compactAnchor.length - 1].si + 1;
    }
  }

  const looseAnchor = anchor.replace(/[\s。！？，、；：…—\-.!?,;:]+$/gu, '').replace(/\s+/gu, '');
  if (looseAnchor.length >= 4) {
    const nonWhitespace = normalizedCharsFrom(text, searchStart);
    const looseIndex = nonWhitespace.map((item) => item.ch).join('').indexOf(looseAnchor);
    if (looseIndex >= 0) {
      let end = nonWhitespace[looseIndex + looseAnchor.length - 1].si;
      while (end + 1 < text.length && /[。！？，、；：…—\-.!?,;: \t]/u.test(text[end + 1])) {
        end += 1;
      }
      return end + 1;
    }
  }

  const punctuationlessAnchor = normalizedCharsFrom(anchor, 0, (char) => !isStoryboardIgnoredMatchChar(char))
    .map((item) => item.ch)
    .join('');
  if (punctuationlessAnchor.length >= 4) {
    const punctuationlessText = normalizedCharsFrom(text, searchStart, (char) => !isStoryboardIgnoredMatchChar(char));
    const punctuationlessIndex = punctuationlessText.map((item) => item.ch).join('').indexOf(punctuationlessAnchor);
    if (punctuationlessIndex >= 0) {
      let end = punctuationlessText[punctuationlessIndex + punctuationlessAnchor.length - 1].si;
      while (end + 1 < text.length && /[。！？，、；：…—\-.!?,;: \t]/u.test(text[end + 1])) {
        end += 1;
      }
      return end + 1;
    }
  }

  return null;
}

function normalizedCharsFrom(text: string, start: number, keepChar: (char: string) => boolean = (char) => char.trim().length > 0): Array<{ ch: string; si: number }> {
  const output: Array<{ ch: string; si: number }> = [];
  for (let index = start; index < text.length; index += 1) {
    if (keepChar(text[index])) output.push({ ch: text[index], si: index });
  }
  return output;
}

function isStoryboardIgnoredMatchChar(char: string): boolean {
  return /[\p{P}]/u.test(char);
}

function sceneFromCap(cap: string, index: number): StoryboardScene {
  return {
    id: index + 1,
    cap,
    descPrompt: cap,
    durationMs: estimateSceneDurationMs(cap),
  };
}

function estimateSceneDurationMs(cap: string): number {
  return Math.max(1200, Math.round((countVisibleCharacters(cap) / 5) * 1000));
}

function storyboardTextCoverageError(scenes: StoryboardScene[], rewrittenCopy: string): string | null {
  const joined = normalizeTextForStoryboardCompare(scenes.map((scene) => scene.cap).join(''));
  const original = normalizeTextForStoryboardCompare(rewrittenCopy);
  if (joined === original) return null;
  let mismatchIndex = -1;
  const limit = Math.min(joined.length, original.length);
  for (let index = 0; index < limit; index += 1) {
    if (joined[index] !== original[index]) {
      mismatchIndex = index;
      break;
    }
  }
  if (mismatchIndex < 0) mismatchIndex = limit;
  const start = Math.max(0, mismatchIndex - 10);
  const end = Math.min(Math.max(joined.length, original.length), mismatchIndex + 10);
  return `Storyboard tail-anchor extraction did not preserve rewritten copy (joined ${joined.length} chars / original ${original.length} chars, diff around ${mismatchIndex}). joined="${joined.slice(start, end)}", original="${original.slice(start, end)}".`;
}

function normalizeTextForStoryboardCompare(value: string): string {
  return value.replace(/[“”]/gu, '').replace(/\s+/gu, '');
}

function extractStoryboardScenes(input: unknown): unknown {
  const parsedInput = maybeParseStoryboardJson(input);
  if (parsedInput !== input) {
    const nested = extractStoryboardScenes(parsedInput);
    if (Array.isArray(nested)) return nested;
    if (nested !== undefined) return nested;
  }
  if (Array.isArray(input)) return input.every((item) => typeof item === 'string') ? undefined : input;
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ['scenes', 'storyboard', 'storyboards', 'sceneList', 'sentences', 'shots', '鍒嗛暅', '鍒嗛暅鍒楄〃', '闀滃ご', '闀滃ご鍒楄〃']) {
    const value = record[key];
    if (Array.isArray(value) && !value.every((item) => typeof item === 'string')) return value;
    const parsedValue = maybeParseStoryboardJson(value);
    if (parsedValue !== value) {
      const nested = extractStoryboardScenes(parsedValue);
      if (Array.isArray(nested)) return nested;
      if (nested !== undefined) return nested;
    }
  }
  for (const key of ['data', 'result', 'output']) {
    const nested = extractStoryboardScenes(record[key]);
    if (Array.isArray(nested)) return nested;
  }
  return undefined;
}

function maybeParseStoryboardJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (!trimmed) return input;
  const parsed = parseStoryboardJsonText(trimmed);
  return parsed.parsed ? parsed.value : input;
}

function parseStoryboardJsonText(text: string): { parsed: true; value: unknown } | { parsed: false } {
  const normalized = stripJsonCodeFence(text);
  for (const candidate of [normalized, ...extractStoryboardJsonCandidates(normalized)]) {
    const parsed = tryParseStoryboardJsonCandidate(candidate);
    if (parsed.parsed) return parsed;
  }
  return { parsed: false };
}

function stripJsonCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced ? fenced[1].trim() : text;
}

function extractStoryboardJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const end = findBalancedJsonEnd(text, start);
    if (end >= start) candidates.push(text.slice(start, end + 1));
  }
  return candidates;
}

function findBalancedJsonEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
      continue;
    }
    if (char === '}' || char === ']') {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function tryParseStoryboardJsonCandidate(candidate: string): { parsed: true; value: unknown } | { parsed: false } {
  const trimmed = candidate.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return { parsed: false };
  try {
    return { parsed: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    const repaired = stripTrailingJsonCommas(trimmed);
    if (repaired !== trimmed) {
      try {
        return { parsed: true, value: JSON.parse(repaired) as unknown };
      } catch {
        return { parsed: false };
      }
    }
    return { parsed: false };
  }
}

function stripTrailingJsonCommas(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  let changed = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      const next = input.slice(index + 1).match(/\S/u)?.[0];
      if (next === '}' || next === ']') {
        changed = true;
        continue;
      }
    }
    output += char;
  }
  return changed ? output : input;
}

function storyboardResponseDebugHint(input: unknown, raw: string): string {
  const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input as Record<string, unknown>).slice(0, 8) : [];
  const keyHint = keys.length ? ` Received keys: ${keys.join(', ')}.` : '';
  const rawPreview = raw.trim().slice(0, 300);
  return `${keyHint}${rawPreview ? ` Raw preview: ${rawPreview}` : ''}`;
}
