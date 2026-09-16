/** Browser-safe contracts for evidence-backed, whole-video decomposition. */
import { z } from 'zod';

export const REFERENCE_TRACKS = [
  'narrative', 'shot', 'onscreen-text', 'transition', 'layer-motion',
  'speech', 'music', 'sfx', 'av-sync', 'rhythm',
] as const;
export const REFERENCE_TRACK_LABELS: Record<ReferenceTrack, string> = {
  narrative: '内容与叙事', shot: '镜头与构图', 'onscreen-text': '字幕与版式',
  transition: '剪辑与转场', 'layer-motion': '图层与动效', speech: '配音与对白',
  music: '配乐', sfx: '音效', 'av-sync': '音画关联', rhythm: '全片节奏',
};

export const referenceIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
export const referenceHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const timeMs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const referenceTimeRangeSchema = z.object({ startMs: timeMs, endMs: timeMs }).strict()
  .refine((range) => range.endMs > range.startMs, '时间区间必须满足 startMs < endMs');
export const referenceTrackSchema = z.enum(REFERENCE_TRACKS);
export const referenceEvidenceStateSchema = z.enum(['observed', 'inferred', 'not-analyzed']);
export const referencePresenceSchema = z.enum(['present', 'absent', 'unknown']);
export const referenceCoverageReasonSchema = z.enum([
  'pending', 'budget', 'missing-capability', 'failed', 'insufficient-evidence', 'not-applicable',
]);

export const referenceCoverageCellSchema = z.object({
  range: referenceTimeRangeSchema,
  track: referenceTrackSchema,
  state: referenceEvidenceStateSchema,
  presence: referencePresenceSchema,
  evidenceIds: z.array(referenceIdSchema),
  reason: referenceCoverageReasonSchema.optional(),
}).strict().superRefine((cell, ctx) => {
  if (cell.state === 'not-analyzed' && cell.presence !== 'unknown') {
    ctx.addIssue({ code: 'custom', path: ['presence'], message: '未分析不能表示已发现或已排除元素' });
  }
  if ((cell.state === 'not-analyzed' || cell.presence === 'unknown') && !cell.reason) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: '未分析或未知状态必须说明原因' });
  }
  if (cell.state !== 'not-analyzed' && cell.evidenceIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['evidenceIds'], message: '已分析状态必须引用实际消费的证据' });
  }
});

export const referenceEvidenceSchema = z.object({
  id: referenceIdSchema,
  kind: z.enum(['frame', 'video-range', 'audio-range', 'transcript-range', 'signal-measurement']),
  range: referenceTimeRangeSchema,
  mediaId: referenceIdSchema,
  frameTimeMs: timeMs.optional(),
  sampleTimesMs: z.array(timeMs).optional(),
  presentation: z.enum(['still', 'ordered-frames', 'continuous-video', 'continuous-audio', 'transcript', 'signal']),
  reason: z.enum(['uniform', 'visual-change', 'audio-change', 'opening', 'boundary-check', 'motion-check', 'manual']).optional(),
  measurement: z.enum(['scene-change', 'optical-flow', 'audio-energy', 'audio-transient', 'beat', 'silence', 'duration', 'audio-track-absence']).optional(),
  transcriptSegmentIds: z.array(referenceIdSchema).optional(),
  consumedBy: z.array(z.object({
    analyzerId: referenceIdSchema,
    capabilityVersion: z.string().min(1).max(128),
    inputHash: referenceHashSchema,
    consumedRange: referenceTimeRangeSchema,
  }).strict()),
}).strict().superRefine((evidence, ctx) => {
  const presentations = {
    frame: ['still', 'ordered-frames'], 'video-range': ['continuous-video'],
    'audio-range': ['continuous-audio'], 'transcript-range': ['transcript'],
    'signal-measurement': ['signal'],
  };
  if (!presentations[evidence.kind].includes(evidence.presentation)) {
    ctx.addIssue({ code: 'custom', path: ['presentation'], message: '证据种类与展示形式不一致' });
  }
  if (evidence.presentation === 'still' && evidence.frameTimeMs === undefined) {
    ctx.addIssue({ code: 'custom', path: ['frameTimeMs'], message: '静帧必须记录实际采样时间' });
  }
  if (evidence.frameTimeMs !== undefined && !containsTime(evidence.range, evidence.frameTimeMs)) {
    ctx.addIssue({ code: 'custom', path: ['frameTimeMs'], message: '静帧时间超出证据区间' });
  }
  if (evidence.presentation === 'ordered-frames') {
    const samples = evidence.sampleTimesMs ?? [];
    if (samples.length < 2 || samples.some((time, index) => !containsTime(evidence.range, time) || (index > 0 && time <= samples[index - 1]))) {
      ctx.addIssue({ code: 'custom', path: ['sampleTimesMs'], message: '有序帧需要区间内严格递增的至少两个采样时间' });
    }
  }
  evidence.consumedBy.forEach((consumer, index) => {
    if (!containsRange(evidence.range, consumer.consumedRange)) {
      ctx.addIssue({ code: 'custom', path: ['consumedBy', index, 'consumedRange'], message: '分析器消费范围超出证据区间' });
    }
  });
});

export const referenceObservationSchema = z.object({
  id: referenceIdSchema,
  track: referenceTrackSchema,
  range: referenceTimeRangeSchema,
  state: referenceEvidenceStateSchema,
  presence: referencePresenceSchema,
  text: z.string().min(1).max(20000),
  evidenceIds: z.array(referenceIdSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  origin: z.enum(['detector', 'model', 'user']),
  aspect: z.enum(['general', 'appearance', 'camera-motion', 'subject-motion']).optional(),
  reason: referenceCoverageReasonSchema.optional(),
  relatedObservationIds: z.array(referenceIdSchema).optional(),
}).strict().superRefine((observation, ctx) => {
  if (observation.state === 'not-analyzed' && (observation.presence !== 'unknown' || !observation.reason)) {
    ctx.addIssue({ code: 'custom', message: '未分析观察必须为 unknown 且说明原因' });
  }
  if (observation.state !== 'not-analyzed' && observation.evidenceIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['evidenceIds'], message: '观察和推断必须引用证据' });
  }
});

export const referenceShotSchema = z.object({
  id: referenceIdSchema,
  range: referenceTimeRangeSchema,
  boundary: z.object({
    startState: referenceEvidenceStateSchema,
    endState: referenceEvidenceStateSchema,
    evidenceIds: z.array(referenceIdSchema),
    uncertaintyMs: timeMs,
  }).strict(),
  observations: z.array(referenceObservationSchema),
  label: z.string().max(200).optional(),
}).strict();

export const referenceTranscriptSegmentSchema = z.object({
  id: referenceIdSchema,
  text: z.string().min(1).max(20000),
  range: referenceTimeRangeSchema.nullable(),
  timingQuality: z.enum(['provider-word', 'provider-segment', 'estimated', 'missing']),
  words: z.array(z.object({ id: referenceIdSchema, text: z.string().min(1), range: referenceTimeRangeSchema.nullable() }).strict()),
}).strict().superRefine((segment, ctx) => {
  if ((segment.timingQuality === 'missing') !== (segment.range === null)) {
    ctx.addIssue({ code: 'custom', path: ['range'], message: 'missing 时间质量必须与空时间区间一致' });
  }
  segment.words.forEach((word, index) => {
    if (word.range && (!segment.range || !containsRange(segment.range, word.range))) {
      ctx.addIssue({ code: 'custom', path: ['words', index, 'range'], message: '词时间超出对应句区间' });
    }
    if (segment.timingQuality === 'provider-word' && !word.range) {
      ctx.addIssue({ code: 'custom', path: ['words', index, 'range'], message: '逐词对齐不能包含缺失词时间' });
    }
  });
});

export const referencePartSchema = z.object({
  schemaVersion: z.literal(1),
  analysisFingerprint: referenceHashSchema.optional(),
  partId: referenceIdSchema,
  sourceMediaSha256: referenceHashSchema,
  durationMs: timeMs.refine((value) => value > 0),
  coreRange: referenceTimeRangeSchema,
  contextRange: referenceTimeRangeSchema,
  evidence: z.array(referenceEvidenceSchema),
  observations: z.array(referenceObservationSchema),
  shots: z.array(referenceShotSchema),
  transcript: z.array(referenceTranscriptSegmentSchema),
  coverage: z.array(referenceCoverageCellSchema),
}).strict().superRefine((part, ctx) => {
  for (const issue of validateReferencePartContent(part)) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});

export const referenceArtifactPathSchema = z.string().min(1).max(240).refine((value) => {
  if (value.includes('\\') || value.includes(':') || value.startsWith('/') || /[%?#\u0000-\u001f]/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && /^[a-zA-Z0-9._-]+$/.test(segment));
}, '产物必须使用安全的相对路径');

export const referencePartRefSchema = z.object({
  partId: referenceIdSchema,
  coreRange: referenceTimeRangeSchema,
  contextRange: referenceTimeRangeSchema,
  artifactPath: referenceArtifactPathSchema,
  artifactHash: referenceHashSchema,
  shotCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
}).strict();

export const referenceCoverageSummarySchema = z.object({
  track: referenceTrackSchema,
  observedMs: timeMs,
  inferredMs: timeMs,
  notAnalyzedMs: timeMs,
  presentMs: timeMs,
  absentMs: timeMs,
  unknownMs: timeMs,
}).strict();

export const referenceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  basedOnRunGeneration: z.number().int().nonnegative(),
  sourceMediaId: referenceIdSchema,
  sourceMediaSha256: referenceHashSchema,
  durationMs: timeMs.refine((value) => value > 0),
  scope: z.literal('whole-video'),
  scanPlanHash: referenceHashSchema,
  parts: z.array(referencePartRefSchema).min(1),
  coverageSummary: z.array(referenceCoverageSummarySchema).length(REFERENCE_TRACKS.length),
  coverageState: z.enum(['complete', 'partial']),
  totals: z.object({ shots: z.number().int().nonnegative(), evidence: z.number().int().nonnegative(), observations: z.number().int().nonnegative() }).strict(),
  createdAt: z.string().datetime(),
  summary: z.object({
    overview: z.string().max(20000), narrative: z.string().max(20000), rhythm: z.string().max(20000),
    productionRules: z.array(z.string().max(8000)).max(100),
    limitations: z.array(z.string().max(8000)).max(100),
  }).strict().optional(),
}).strict().superRefine((manifest, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  partitionIssues(manifest.parts.map((part) => part.coreRange), { startMs: 0, endMs: manifest.durationMs })
    .forEach((message) => issue(['parts'], message));
  if (new Set(manifest.parts.map((part) => part.partId)).size !== manifest.parts.length) issue(['parts'], '分片 ID 重复');
  if (new Set(manifest.parts.map((part) => part.artifactPath)).size !== manifest.parts.length) issue(['parts'], '分片产物路径重复');
  manifest.parts.forEach((part, index) => {
    if (!containsRange({ startMs: 0, endMs: manifest.durationMs }, part.contextRange) || !containsRange(part.contextRange, part.coreRange)) {
      issue(['parts', index], '分片核心区间必须在上下文及来源时长内');
    }
  });
  if (new Set(manifest.coverageSummary.map((summary) => summary.track)).size !== REFERENCE_TRACKS.length) issue(['coverageSummary'], '每个轨道必须且只能汇总一次');
  manifest.coverageSummary.forEach((summary, index) => {
    if (summary.observedMs + summary.inferredMs + summary.notAnalyzedMs !== manifest.durationMs || summary.presentMs + summary.absentMs + summary.unknownMs !== manifest.durationMs) {
      issue(['coverageSummary', index], '每个轨道的状态与存在性统计必须分别覆盖全片');
    }
  });
  const complete = manifest.coverageSummary.every((summary) => summary.notAnalyzedMs === 0);
  if ((manifest.coverageState === 'complete') !== complete) issue(['coverageState'], '完成状态与未分析时长不一致');
  if (manifest.totals.evidence !== manifest.parts.reduce((total, part) => total + part.evidenceCount, 0)
      || manifest.totals.observations !== manifest.parts.reduce((total, part) => total + part.observationCount, 0)) {
    issue(['totals'], '证据和观察总数必须与分片清单一致');
  }
});

export type ReferenceTrack = z.infer<typeof referenceTrackSchema>;
export type ReferenceTimeRange = z.infer<typeof referenceTimeRangeSchema>;
export type ReferenceEvidenceState = z.infer<typeof referenceEvidenceStateSchema>;
export type ReferencePresence = z.infer<typeof referencePresenceSchema>;
export type ReferenceCoverageReason = z.infer<typeof referenceCoverageReasonSchema>;
export type ReferenceCoverageCell = z.infer<typeof referenceCoverageCellSchema>;
export type ReferenceEvidence = z.infer<typeof referenceEvidenceSchema>;
export type ReferenceObservation = z.infer<typeof referenceObservationSchema>;
export type ReferenceShot = z.infer<typeof referenceShotSchema>;
export type ReferenceTranscriptSegment = z.infer<typeof referenceTranscriptSegmentSchema>;
export type ReferencePart = z.infer<typeof referencePartSchema>;
export type ReferencePartRef = z.infer<typeof referencePartRefSchema>;
export type ReferenceCoverageSummary = z.infer<typeof referenceCoverageSummarySchema>;
export type ReferenceManifest = z.infer<typeof referenceManifestSchema>;
export interface ReferenceValidationIssue { path: (string | number)[]; message: string }
export interface ReferenceWindowPlan {
  partId: string;
  coreRange: ReferenceTimeRange;
  contextRange: ReferenceTimeRange;
  unitRanges: ReferenceTimeRange[];
}

function containsTime(range: ReferenceTimeRange, time: number): boolean {
  return time >= range.startMs && time < range.endMs;
}
function containsRange(outer: ReferenceTimeRange, inner: ReferenceTimeRange): boolean {
  return inner.startMs >= outer.startMs && inner.endMs <= outer.endMs;
}
function overlaps(left: ReferenceTimeRange, right: ReferenceTimeRange): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

/** No fixed full-video cap: dense candidates create more parts, never dropped shots. */
export function planReferenceWindows(input: {
  durationMs: number;
  candidateBoundariesMs?: readonly number[];
  maxCoreDurationMs?: number;
  contextMs?: number;
  maxUnitsPerPart?: number;
}): ReferenceWindowPlan[] {
  const durationMs = timeMs.refine((value) => value > 0).parse(input.durationMs);
  const maxCoreDurationMs = z.number().int().min(1).max(30000).parse(input.maxCoreDurationMs ?? 30000);
  const contextMs = z.number().int().min(0).max(1000).parse(input.contextMs ?? 1000);
  const maxUnitsPerPart = z.number().int().min(1).max(16).parse(input.maxUnitsPerPart ?? 16);
  const candidates = [...new Set((input.candidateBoundariesMs ?? []).map((time) => timeMs.parse(time)))].sort((a, b) => a - b);
  if (candidates.some((time) => time > durationMs)) throw new Error('镜头边界超出原片时长');
  const boundaries = [...new Set([0, ...candidates, durationMs])];
  const units: ReferenceTimeRange[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    for (let startMs = boundaries[index]; startMs < boundaries[index + 1]; startMs += maxCoreDurationMs) {
      units.push({ startMs, endMs: Math.min(startMs + maxCoreDurationMs, boundaries[index + 1]) });
    }
  }
  const plans: ReferenceWindowPlan[] = [];
  for (const unit of units) {
    let plan = plans[plans.length - 1];
    if (!plan || plan.unitRanges.length >= maxUnitsPerPart || unit.endMs - plan.coreRange.startMs > maxCoreDurationMs) {
      plan = { partId: `part-${String(plans.length + 1).padStart(6, '0')}`, coreRange: { ...unit }, contextRange: { ...unit }, unitRanges: [] };
      plans.push(plan);
    }
    plan.unitRanges.push(unit);
    plan.coreRange.endMs = unit.endMs;
    plan.contextRange = { startMs: Math.max(0, plan.coreRange.startMs - contextMs), endMs: Math.min(durationMs, plan.coreRange.endMs + contextMs) };
  }
  return plans;
}

function partitionIssues(ranges: readonly ReferenceTimeRange[], scope: ReferenceTimeRange): string[] {
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const issues: string[] = [];
  let next = scope.startMs;
  for (const range of sorted) {
    if (!containsRange(scope, range) || range.endMs <= range.startMs) issues.push('区间超出分析范围或为空');
    if (range.startMs > next) issues.push(`覆盖缺口 ${next}–${range.startMs} ms`);
    if (range.startMs < next) issues.push(`覆盖重复 ${range.startMs}–${Math.min(next, range.endMs)} ms`);
    next = Math.max(next, range.endMs);
  }
  if (next < scope.endMs) issues.push(`覆盖缺口 ${next}–${scope.endMs} ms`);
  return issues;
}

export function validateReferenceCoverage(cells: readonly ReferenceCoverageCell[], scope: ReferenceTimeRange): ReferenceValidationIssue[] {
  const issues: ReferenceValidationIssue[] = [];
  for (const track of REFERENCE_TRACKS) {
    for (const message of partitionIssues(cells.filter((cell) => cell.track === track).map((cell) => cell.range), scope)) {
      issues.push({ path: ['coverage', track], message });
    }
  }
  return issues;
}

export function summarizeReferenceCoverage(cells: readonly ReferenceCoverageCell[], durationMs: number): ReferenceCoverageSummary[] {
  const issues = validateReferenceCoverage(cells, { startMs: 0, endMs: durationMs });
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join('; '));
  return REFERENCE_TRACKS.map((track) => {
    const summary: ReferenceCoverageSummary = { track, observedMs: 0, inferredMs: 0, notAnalyzedMs: 0, presentMs: 0, absentMs: 0, unknownMs: 0 };
    for (const cell of cells.filter((candidate) => candidate.track === track)) {
      const duration = cell.range.endMs - cell.range.startMs;
      summary[cell.state === 'observed' ? 'observedMs' : cell.state === 'inferred' ? 'inferredMs' : 'notAnalyzedMs'] += duration;
      summary[cell.presence === 'present' ? 'presentMs' : cell.presence === 'absent' ? 'absentMs' : 'unknownMs'] += duration;
    }
    return summary;
  });
}

export function createUnanalyzedReferenceCoverage(range: ReferenceTimeRange, reason: ReferenceCoverageReason = 'pending'): ReferenceCoverageCell[] {
  referenceTimeRangeSchema.parse(range);
  return REFERENCE_TRACKS.map((track) => ({ range: { ...range }, track, state: 'not-analyzed', presence: 'unknown', evidenceIds: [], reason }));
}

/** Checks actual consumed evidence, not merely the existence of a playable source. */
function evidenceSupports(track: ReferenceTrack, aspect: ReferenceObservation['aspect'], range: ReferenceTimeRange, evidence: ReferenceEvidence[], state: ReferenceEvidenceState, presence?: ReferencePresence): boolean {
  const consumed = evidence.filter((entry) => entry.consumedBy.some((consumer) => overlaps(consumer.consumedRange, range)));
  if (!consumed.length) return false;
  const fullyConsumed = consumed.filter((entry) => entry.consumedBy.some((consumer) => containsRange(consumer.consumedRange, range)));
  if (presence === 'absent' && ['speech', 'music', 'sfx', 'av-sync'].includes(track)
    && fullyConsumed.some(entry => entry.kind === 'signal-measurement' && entry.measurement === 'audio-track-absence')) return true;
  if (track === 'music' || track === 'sfx') return fullyConsumed.some((entry) => entry.kind === 'audio-range' && entry.presentation === 'continuous-audio');
  if (track === 'layer-motion' || track === 'transition' || aspect === 'camera-motion' || aspect === 'subject-motion') {
    return fullyConsumed.some((entry) => entry.presentation === 'continuous-video'
      || (entry.presentation === 'signal' && (entry.measurement === 'optical-flow' || (track === 'transition' && state === 'inferred' && entry.measurement === 'scene-change')))
      || (entry.presentation === 'ordered-frames' && (entry.sampleTimesMs ?? []).length >= 3
        && entry.sampleTimesMs![0] <= range.startMs + 100
        && entry.sampleTimesMs!.at(-1)! >= range.endMs - 100
        && (entry.sampleTimesMs ?? []).every((time, index, samples) => index === 0 || time - samples[index - 1] <= 100)));
  }
  if (track === 'av-sync') {
    return consumed.some((entry) => ['continuous-audio', 'transcript'].includes(entry.presentation))
      && consumed.some((entry) => ['continuous-video', 'ordered-frames', 'still'].includes(entry.presentation));
  }
  return true;
}

function validateReferencePartContent(part: {
  durationMs: number; coreRange: ReferenceTimeRange; contextRange: ReferenceTimeRange;
  evidence: ReferenceEvidence[]; observations: ReferenceObservation[]; shots: ReferenceShot[];
  transcript: ReferenceTranscriptSegment[]; coverage: ReferenceCoverageCell[];
}): ReferenceValidationIssue[] {
  const issues: ReferenceValidationIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  const sourceRange = { startMs: 0, endMs: part.durationMs };
  if (!containsRange(sourceRange, part.contextRange) || !containsRange(part.contextRange, part.coreRange)) add(['coreRange'], '核心区间必须在上下文及来源时长内');
  const observations = [...part.observations, ...part.shots.flatMap((shot) => shot.observations)];
  const allIds = [...part.evidence, ...part.shots, ...observations, ...part.transcript, ...part.transcript.flatMap((segment) => segment.words)].map((entry) => entry.id);
  if (new Set(allIds).size !== allIds.length) add([], '分片内实体 ID 重复');
  const evidenceById = new Map(part.evidence.map((entry) => [entry.id, entry]));
  const transcriptById = new Set(part.transcript.map((entry) => entry.id));
  const observationById = new Set(observations.map((entry) => entry.id));
  const checkRange = (range: ReferenceTimeRange, path: (string | number)[]) => {
    if (!containsRange(sourceRange, range)) add(path, '时间超出来源时长');
  };
  const checkEvidence = (ids: string[], path: (string | number)[]) => {
    if (new Set(ids).size !== ids.length) add(path, '证据引用重复');
    for (const id of ids) if (!evidenceById.has(id)) add(path, `未知证据引用 ${id}`);
  };
  part.evidence.forEach((entry, index) => {
    checkRange(entry.range, ['evidence', index, 'range']);
    for (const id of entry.transcriptSegmentIds ?? []) if (!transcriptById.has(id)) add(['evidence', index, 'transcriptSegmentIds'], `未知逐字稿引用 ${id}`);
  });
  observations.forEach((entry, index) => {
    checkRange(entry.range, ['observations', index, 'range']);
    checkEvidence(entry.evidenceIds, ['observations', index, 'evidenceIds']);
    for (const id of entry.relatedObservationIds ?? []) if (!observationById.has(id)) add(['observations', index, 'relatedObservationIds'], `未知关联观察 ${id}`);
    if (entry.state !== 'not-analyzed' && !evidenceSupports(entry.track, entry.aspect, entry.range, entry.evidenceIds.flatMap((id) => evidenceById.has(id) ? [evidenceById.get(id)!] : []), entry.state, entry.presence)) {
      add(['observations', index, 'evidenceIds'], '已消费的证据不能支持该维度；静帧不证明连续动作，ASR 不证明音乐或音效');
    }
  });
  part.shots.forEach((shot, index) => {
    checkRange(shot.range, ['shots', index, 'range']);
    checkEvidence(shot.boundary.evidenceIds, ['shots', index, 'boundary', 'evidenceIds']);
  });
  part.transcript.forEach((segment, index) => { if (segment.range) checkRange(segment.range, ['transcript', index, 'range']); });
  part.coverage.forEach((cell, index) => {
    checkEvidence(cell.evidenceIds, ['coverage', index, 'evidenceIds']);
    if (cell.state !== 'not-analyzed' && !evidenceSupports(cell.track, undefined, cell.range, cell.evidenceIds.flatMap((id) => evidenceById.has(id) ? [evidenceById.get(id)!] : []), cell.state, cell.presence)) {
      add(['coverage', index, 'evidenceIds'], '覆盖结论缺少相应维度的实际消费证据');
    }
  });
  issues.push(...validateReferenceCoverage(part.coverage, part.coreRange));
  return issues;
}

export function parseReferencePart(value: unknown): ReferencePart { return referencePartSchema.parse(value); }
export function parseReferenceManifest(value: unknown): ReferenceManifest { return referenceManifestSchema.parse(value); }

/** Validates loaded artifact identities and aggregate claims after per-file hash checks. */
export function validateReferenceDocument(manifest: ReferenceManifest, parts: readonly ReferencePart[]): ReferenceValidationIssue[] {
  const issues: ReferenceValidationIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  if (parts.length !== manifest.parts.length || new Set(parts.map((part) => part.partId)).size !== parts.length) add(['parts'], '已载入分片与索引数量不一致或 ID 重复');
  const byId = new Map(parts.map((part) => [part.partId, part]));
  const shots = new Map<string, ReferenceShot>();
  manifest.parts.forEach((entry, index) => {
    const part = byId.get(entry.partId);
    if (!part) { add(['parts', index], '缺少索引声明的分片'); return; }
    if (part.sourceMediaSha256 !== manifest.sourceMediaSha256 || part.durationMs !== manifest.durationMs) add(['parts', index], '分片与索引的来源不一致');
    if (part.coreRange.startMs !== entry.coreRange.startMs || part.coreRange.endMs !== entry.coreRange.endMs
        || part.contextRange.startMs !== entry.contextRange.startMs || part.contextRange.endMs !== entry.contextRange.endMs) add(['parts', index], '分片时间范围与索引不一致');
    if (part.evidence.length !== entry.evidenceCount || part.shots.length !== entry.shotCount
        || part.observations.length + part.shots.reduce((count, shot) => count + shot.observations.length, 0) !== entry.observationCount) add(['parts', index], '分片内容数量与索引不一致');
    part.shots.forEach((shot) => {
      const previous = shots.get(shot.id);
      if (previous && (previous.range.startMs !== shot.range.startMs || previous.range.endMs !== shot.range.endMs)) add(['parts', index, 'shots'], '同一跨分片镜头 ID 的时间范围不一致');
      shots.set(shot.id, shot);
    });
  });
  if (shots.size !== manifest.totals.shots) add(['totals', 'shots'], '镜头总数必须按稳定 ID 去重');
  const coverage = parts.flatMap((part) => part.coverage);
  const coverageIssues = validateReferenceCoverage(coverage, { startMs: 0, endMs: manifest.durationMs });
  issues.push(...coverageIssues);
  if (!coverageIssues.length) {
    const calculated = summarizeReferenceCoverage(coverage, manifest.durationMs);
    for (const summary of calculated) {
      const claimed = manifest.coverageSummary.find((entry) => entry.track === summary.track);
      if (!claimed || Object.keys(summary).some((key) => claimed[key as keyof ReferenceCoverageSummary] !== summary[key as keyof ReferenceCoverageSummary])) {
        add(['coverageSummary', summary.track], '覆盖汇总与分片证据状态不一致');
      }
    }
  }
  return issues;
}
