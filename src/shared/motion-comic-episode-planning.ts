import { z } from 'zod';

export const MOTION_COMIC_EPISODE_PLAN_VERSION = 1 as const;
export const MOTION_COMIC_EPISODE_UNIT_VERSION = 1 as const;
export const MOTION_COMIC_EPISODE_PLAN_MAX_SOURCE_LENGTH = 1_000_000;
export const MOTION_COMIC_EPISODE_PLAN_MAX_EPISODE_LENGTH = 30_000;
export const MOTION_COMIC_EPISODE_PLAN_MIN_TARGET_CHARACTERS = 500;
export const MOTION_COMIC_EPISODE_PLAN_MAX_TARGET_CHARACTERS = 20_000;

const boundedText = (max = 8_000) => z.string().trim().min(1).max(max);
const unitId = z.string().regex(/^U\d{4,}$/u, '原文单元 ID 格式无效');
const timestamp = z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)), '时间格式无效');

export const motionComicEpisodeSourceUnitSchema = z.object({
  id: unitId,
  index: z.number().int().min(1),
  text: z.string().min(1).max(4_096),
  characterCount: z.number().int().min(1).max(4_096),
  heading: z.string().trim().min(1).max(512).optional(),
}).strict();
export type MotionComicEpisodeSourceUnit = z.infer<typeof motionComicEpisodeSourceUnitSchema>;

export const motionComicEpisodeBoundarySchema = z.object({
  title: boundedText(512),
  startUnitId: unitId,
  endUnitId: unitId,
  splitReason: boundedText(2_000),
  continuityHook: boundedText(2_000),
}).strict();
export type MotionComicEpisodeBoundary = z.infer<typeof motionComicEpisodeBoundarySchema>;

export const motionComicEpisodeBoundaryPlanSchema = z.object({
  episodes: z.array(motionComicEpisodeBoundarySchema).min(1),
}).strict();
export type MotionComicEpisodeBoundaryPlan = z.infer<typeof motionComicEpisodeBoundaryPlanSchema>;

export const motionComicEpisodePlanInputSchema = z.object({
  sourceText: z.string().trim().min(1).max(MOTION_COMIC_EPISODE_PLAN_MAX_SOURCE_LENGTH),
  sourceKind: z.enum(['script', 'novel']),
  adaptationMode: z.enum(['faithful-script', 'novel-adaptation']),
  targetCharacters: z.number().int()
    .min(MOTION_COMIC_EPISODE_PLAN_MIN_TARGET_CHARACTERS)
    .max(MOTION_COMIC_EPISODE_PLAN_MAX_TARGET_CHARACTERS),
  targetDurationSec: z.number().finite().int().min(15).max(1_800).optional(),
  instructions: z.string().trim().max(4_000).optional(),
}).strict();
export type MotionComicEpisodePlanInput = z.infer<typeof motionComicEpisodePlanInputSchema>;

export const motionComicSourceSplitEvidenceSchema = z.object({
  version: z.literal(MOTION_COMIC_EPISODE_PLAN_VERSION),
  unitizationVersion: z.literal(MOTION_COMIC_EPISODE_UNIT_VERSION),
  strategy: z.enum(['chapter', 'length', 'ai-story']),
  sourceFingerprint: z.string().min(1).max(128),
  targetCharacters: z.number().int()
    .min(MOTION_COMIC_EPISODE_PLAN_MIN_TARGET_CHARACTERS)
    .max(MOTION_COMIC_EPISODE_PLAN_MAX_TARGET_CHARACTERS),
  targetDurationSec: z.number().finite().int().min(15).max(1_800).optional(),
  instructions: z.string().max(4_000).optional(),
  model: z.string().trim().min(1).max(512).optional(),
  createdAt: timestamp,
  repaired: z.boolean().optional(),
  sourceUnitCount: z.number().int().min(1).max(10_000).optional(),
  batchCount: z.number().int().min(1).optional(),
}).strict();
export type MotionComicSourceSplitEvidence = z.infer<typeof motionComicSourceSplitEvidenceSchema>;

export interface MotionComicEpisodeSplitDraft extends MotionComicEpisodeBoundary {
  sourceText: string;
}

export interface MotionComicEpisodePlanningIssue {
  path: string;
  message: string;
}

export interface MotionComicEpisodePlanResult {
  episodes: MotionComicEpisodeSplitDraft[];
  evidence: MotionComicSourceSplitEvidence;
  model: string;
  repaired: boolean;
  warnings: string[];
  summary: {
    episodes: number;
    sourceUnits: number;
    sourceCharacters: number;
    batches: number;
  };
}

export interface MotionComicEpisodePlanningBatch {
  index: number;
  units: MotionComicEpisodeSourceUnit[];
  characterCount: number;
}

const HEADING_PATTERN = /^\s*(第[^\s]{1,16}[章节集幕回卷]|(?:EP|Episode|Chapter)\s*\d+)\s*[:：.、\-]?\s*(.*)$/iu;
const SENTENCE_END = /[。！？!?；;]/u;

export function normalizeMotionComicEpisodeSource(sourceText: string): string {
  const normalized = sourceText.replace(/\r\n?/gu, '\n').trim();
  if (!normalized) throw new Error('MOTION_COMIC_EPISODE_SOURCE_REQUIRED: 请先导入完整原文。');
  if (normalized.length > MOTION_COMIC_EPISODE_PLAN_MAX_SOURCE_LENGTH) {
    throw new Error(`MOTION_COMIC_SOURCE_TOO_LONG: 原文不能超过 ${MOTION_COMIC_EPISODE_PLAN_MAX_SOURCE_LENGTH.toLocaleString('zh-CN')} 字。`);
  }
  return normalized;
}

export function fingerprintMotionComicEpisodeSource(sourceText: string): string {
  const normalized = normalizeMotionComicEpisodeSource(sourceText);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `motion-comic-source-v1-${normalized.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function consumeTrailingWhitespace(source: string, cut: number, limit: number): number {
  let next = cut;
  while (next < source.length && next < limit && /\s/u.test(source[next])) next += 1;
  return next;
}

function selectUnitEnd(source: string, start: number, maxUnitCharacters: number): number {
  const hardEnd = Math.min(source.length, start + maxUnitCharacters);
  if (hardEnd === source.length) return hardEnd;
  const minimumEnd = Math.min(hardEnd, start + Math.min(280, Math.floor(maxUnitCharacters / 2)));
  const paragraphBreak = source.lastIndexOf('\n\n', hardEnd - 1);
  if (paragraphBreak >= minimumEnd) return consumeTrailingWhitespace(source, paragraphBreak + 2, hardEnd + 32);
  const lineBreak = source.lastIndexOf('\n', hardEnd - 1);
  if (lineBreak >= minimumEnd) return consumeTrailingWhitespace(source, lineBreak + 1, hardEnd + 32);
  for (let index = hardEnd - 1; index >= minimumEnd; index -= 1) {
    if (SENTENCE_END.test(source[index])) return consumeTrailingWhitespace(source, index + 1, hardEnd + 32);
  }
  return hardEnd;
}

/** Stable units are the only positions the model may use as episode boundaries. */
export function buildMotionComicEpisodeSourceUnits(
  sourceText: string,
  maxUnitCharacters = 1_200,
): MotionComicEpisodeSourceUnit[] {
  const normalized = normalizeMotionComicEpisodeSource(sourceText);
  const boundedUnitSize = Math.max(320, Math.min(4_000, Math.round(maxUnitCharacters)));
  const units: MotionComicEpisodeSourceUnit[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = selectUnitEnd(normalized, start, boundedUnitSize);
    const value = normalized.slice(start, end);
    if (!value.trim()) {
      start = end;
      continue;
    }
    const firstLine = value.trimStart().split('\n', 1)[0]?.trim() ?? '';
    const headingMatch = firstLine.match(HEADING_PATTERN);
    units.push({
      id: `U${String(units.length + 1).padStart(4, '0')}`,
      index: units.length + 1,
      text: value,
      characterCount: value.trim().length,
      ...(headingMatch ? { heading: firstLine.slice(0, 512) } : {}),
    });
    start = end;
  }
  if (units.map((unit) => unit.text).join('') !== normalized) {
    throw new Error('MOTION_COMIC_EPISODE_UNITIZATION_FAILED: 原文单元化未能保持完整文本。');
  }
  return units;
}

export function buildMotionComicEpisodePlanningBatches(
  units: readonly MotionComicEpisodeSourceUnit[],
  maxBatchCharacters = 60_000,
): MotionComicEpisodePlanningBatch[] {
  const boundedMaximum = Math.max(1, Math.round(maxBatchCharacters));
  const batches: MotionComicEpisodePlanningBatch[] = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let characterCount = 0;
    while (end < units.length && (end === start || characterCount + units[end].text.length <= boundedMaximum)) {
      characterCount += units[end].text.length;
      end += 1;
    }
    if (end < units.length && end - start > 1) {
      let chapterStart = -1;
      let beforeChapterCharacters = 0;
      for (let candidate = start + 1; candidate < end; candidate += 1) {
        beforeChapterCharacters += units[candidate - 1].text.length;
        if (units[candidate].heading && beforeChapterCharacters >= boundedMaximum * 0.6) chapterStart = candidate;
      }
      if (chapterStart > start) {
        end = chapterStart;
        characterCount = units.slice(start, end).reduce((sum, unit) => sum + unit.text.length, 0);
      }
    }
    batches.push({ index: batches.length + 1, units: units.slice(start, end), characterCount });
    start = end;
  }
  return batches;
}

export function validateMotionComicEpisodeBoundaries(
  plan: MotionComicEpisodeBoundaryPlan,
  units: readonly MotionComicEpisodeSourceUnit[],
): MotionComicEpisodePlanningIssue[] {
  const issues: MotionComicEpisodePlanningIssue[] = [];
  const unitIndexes = new Map(units.map((unit, index) => [unit.id, index] as const));
  let expectedStart = 0;
  plan.episodes.forEach((episode, episodeIndex) => {
    const path = `episodes[${episodeIndex}]`;
    const start = unitIndexes.get(episode.startUnitId);
    const end = unitIndexes.get(episode.endUnitId);
    if (start === undefined) issues.push({ path: `${path}.startUnitId`, message: `起始单元不存在：${episode.startUnitId}` });
    if (end === undefined) issues.push({ path: `${path}.endUnitId`, message: `结束单元不存在：${episode.endUnitId}` });
    if (start === undefined || end === undefined) return;
    if (end < start) issues.push({ path, message: '结束单元不能早于起始单元。' });
    if (start !== expectedStart) {
      issues.push({
        path: `${path}.startUnitId`,
        message: start < expectedStart
          ? `与上一集重叠；本集必须从 ${units[expectedStart]?.id ?? '末尾之后'} 开始。`
          : `遗漏了原文单元 ${units[expectedStart]?.id ?? '未知'}；本集必须连续承接上一集。`,
      });
    }
    if (end >= start) {
      const sourceText = units.slice(start, end + 1).map((unit) => unit.text).join('').trim();
      if (!sourceText) issues.push({ path, message: '分集范围不能为空。' });
      if (sourceText.length > MOTION_COMIC_EPISODE_PLAN_MAX_EPISODE_LENGTH) {
        issues.push({ path, message: `本集原文 ${sourceText.length.toLocaleString('zh-CN')} 字，超过 ${MOTION_COMIC_EPISODE_PLAN_MAX_EPISODE_LENGTH.toLocaleString('zh-CN')} 字上限。` });
      }
      expectedStart = end + 1;
    }
  });
  if (expectedStart !== units.length) {
    issues.push({ path: 'episodes', message: `分集没有覆盖到最后一个原文单元 ${units.at(-1)?.id ?? ''}。` });
  }
  return issues;
}

export function materializeMotionComicEpisodePlan(
  plan: MotionComicEpisodeBoundaryPlan,
  units: readonly MotionComicEpisodeSourceUnit[],
): MotionComicEpisodeSplitDraft[] {
  const issues = validateMotionComicEpisodeBoundaries(plan, units);
  if (issues.length) {
    throw new Error(`MOTION_COMIC_EPISODE_PLAN_INVALID: ${issues.slice(0, 8).map((issue) => `${issue.path} ${issue.message}`).join('；')}`);
  }
  const unitIndexes = new Map(units.map((unit, index) => [unit.id, index] as const));
  return plan.episodes.map((episode) => {
    const start = unitIndexes.get(episode.startUnitId)!;
    const end = unitIndexes.get(episode.endUnitId)!;
    return { ...episode, sourceText: units.slice(start, end + 1).map((unit) => unit.text).join('').trim() };
  });
}

export function validateMotionComicEpisodeSplitDrafts(
  episodes: readonly MotionComicEpisodeSplitDraft[],
  units: readonly MotionComicEpisodeSourceUnit[],
): MotionComicEpisodePlanningIssue[] {
  const plan = { episodes: episodes.map(({ sourceText: _sourceText, ...episode }) => episode) };
  const parsed = motionComicEpisodeBoundaryPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || 'episodes', message: issue.message }));
  }
  const issues = validateMotionComicEpisodeBoundaries(parsed.data, units);
  if (issues.length) return issues;
  const materialized = materializeMotionComicEpisodePlan(parsed.data, units);
  episodes.forEach((episode, index) => {
    if (episode.sourceText.trim() !== materialized[index]?.sourceText) {
      issues.push({ path: `episodes[${index}].sourceText`, message: '分集正文与原文边界不一致；正文不能由模型改写。' });
    }
  });
  return issues;
}

export function createMotionComicRuleSplitEvidence(input: {
  sourceText: string;
  strategy: 'chapter' | 'length';
  targetCharacters: number;
  createdAt?: string;
}): MotionComicSourceSplitEvidence {
  return motionComicSourceSplitEvidenceSchema.parse({
    version: MOTION_COMIC_EPISODE_PLAN_VERSION,
    unitizationVersion: MOTION_COMIC_EPISODE_UNIT_VERSION,
    strategy: input.strategy,
    sourceFingerprint: fingerprintMotionComicEpisodeSource(input.sourceText),
    targetCharacters: input.targetCharacters,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}
