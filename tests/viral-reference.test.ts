import { describe, expect, it } from 'vitest';
import {
  REFERENCE_TRACKS,
  createUnanalyzedReferenceCoverage,
  parseReferenceManifest,
  parseReferencePart,
  planReferenceWindows,
  referenceArtifactPathSchema,
  referenceEvidenceSchema,
  referenceObservationSchema,
  referenceTranscriptSegmentSchema,
  summarizeReferenceCoverage,
  validateReferenceCoverage,
  validateReferenceDocument,
  type ReferenceEvidence,
  type ReferenceManifest,
  type ReferenceObservation,
  type ReferencePart,
} from '@shared/viral-reference';

const sha = 'a'.repeat(64);
const range = { startMs: 0, endMs: 1000 };
function evidence(patch: Partial<ReferenceEvidence> = {}): ReferenceEvidence {
  return {
    id: 'evidence-frame-1', kind: 'frame', range, mediaId: 'frame-1', frameTimeMs: 500,
    presentation: 'still', consumedBy: [{ analyzerId: 'vision', capabilityVersion: '1', inputHash: sha, consumedRange: range }],
    ...patch,
  };
}
function observation(patch: Partial<ReferenceObservation> = {}): ReferenceObservation {
  return {
    id: 'observation-1', track: 'shot', range, state: 'observed', presence: 'present',
    text: '主体位于画面中央。', evidenceIds: ['evidence-frame-1'], confidence: 'high', origin: 'model', ...patch,
  };
}
function part(patch: Partial<ReferencePart> = {}): ReferencePart {
  return {
    schemaVersion: 1, partId: 'part-000001', sourceMediaSha256: sha, durationMs: 1000,
    coreRange: range, contextRange: range, evidence: [evidence()], observations: [observation()],
    shots: [{ id: 'shot-1', range, boundary: { startState: 'inferred', endState: 'inferred', evidenceIds: [], uncertaintyMs: 40 }, observations: [] }],
    transcript: [], coverage: createUnanalyzedReferenceCoverage(range), ...patch,
  };
}
function manifest(): ReferenceManifest {
  return {
    schemaVersion: 1, revision: 1, basedOnRunGeneration: 1, sourceMediaId: 'source', sourceMediaSha256: sha,
    durationMs: 1000, scope: 'whole-video', scanPlanHash: sha, parts: [{
      partId: 'part-000001', coreRange: range, contextRange: range, artifactPath: 'reference/part-000001.json',
      artifactHash: sha, shotCount: 1, evidenceCount: 1, observationCount: 1,
    }],
    coverageSummary: summarizeReferenceCoverage(createUnanalyzedReferenceCoverage(range), 1000),
    coverageState: 'partial', totals: { shots: 1, evidence: 1, observations: 1 }, createdAt: '2026-09-16T00:00:00.000Z',
  };
}

describe('whole-video reference planning', () => {
  it('covers a source longer than 120 seconds through its last millisecond', () => {
    const plans = planReferenceWindows({ durationMs: 185001 });
    expect(plans).toHaveLength(7);
    expect(plans[0].coreRange.startMs).toBe(0);
    expect(plans.at(-1)?.coreRange.endMs).toBe(185001);
    plans.forEach((plan, index) => {
      expect(plan.coreRange.endMs - plan.coreRange.startMs).toBeLessThanOrEqual(30000);
      expect(plan.unitRanges.length).toBeLessThanOrEqual(16);
      expect(plan.contextRange.startMs).toBe(Math.max(0, plan.coreRange.startMs - 1000));
      expect(plan.contextRange.endMs).toBe(Math.min(185001, plan.coreRange.endMs + 1000));
      if (index > 0) expect(plan.coreRange.startMs).toBe(plans[index - 1].coreRange.endMs);
    });
  });

  it('retains rapid cuts and creates additional batches for more than 16 shots', () => {
    const boundaries = Array.from({ length: 99 }, (_, index) => (index + 1) * 80);
    const plans = planReferenceWindows({ durationMs: 8000, candidateBoundariesMs: boundaries });
    expect(plans).toHaveLength(7);
    const units = plans.flatMap((plan) => plan.unitRanges);
    expect(units).toHaveLength(100);
    expect(units.map((unit) => unit.endMs)).toEqual([...boundaries, 8000]);
    expect(new Set(plans.map((plan) => plan.partId)).size).toBe(plans.length);
  });

  it('deduplicates unordered candidates and partitions a long shot without losing time', () => {
    const plans = planReferenceWindows({ durationMs: 65000, candidateBoundariesMs: [65000, 5, 0, 5, 60000] });
    expect(plans.flatMap((plan) => plan.unitRanges)).toEqual([
      { startMs: 0, endMs: 5 }, { startMs: 5, endMs: 30005 }, { startMs: 30005, endMs: 60000 }, { startMs: 60000, endMs: 65000 },
    ]);
    expect(plans.reduce((sum, plan) => sum + plan.coreRange.endMs - plan.coreRange.startMs, 0)).toBe(65000);
    expect(() => planReferenceWindows({ durationMs: 1000, candidateBoundariesMs: [1001] })).toThrow();
    expect(() => planReferenceWindows({ durationMs: 1000.1 })).toThrow();
    expect(() => planReferenceWindows({ durationMs: 1000, maxUnitsPerPart: 17 })).toThrow();
  });
});

describe('reference evidence and integrity', () => {
  it('preserves Unicode observations, rejects extra fields, bad units, and unknown versions', () => {
    const value = part({ observations: [observation({ text: '镜头 1：AI、中文和 emoji 🎬。' })] });
    expect(parseReferencePart(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(() => parseReferencePart({ ...value, schemaVersion: 2 })).toThrow();
    expect(() => parseReferencePart({ ...value, path: 'C:/secret' })).toThrow();
    expect(() => parseReferencePart({ ...value, coreRange: { startMs: 0.5, endMs: 1000 } })).toThrow();
    expect(() => parseReferencePart({ ...value, durationMs: 999 })).toThrow();
  });

  it('rejects dangling references, duplicate identities, and evidence that was never consumed', () => {
    expect(() => parseReferencePart(part({ observations: [observation({ evidenceIds: ['missing'] })] }))).toThrow();
    expect(() => parseReferencePart(part({ evidence: [evidence(), evidence()] }))).toThrow();
    expect(() => parseReferencePart(part({ evidence: [evidence({ consumedBy: [] })] }))).toThrow();
    expect(() => parseReferencePart(part({ observations: [observation({ relatedObservationIds: ['missing'] })] }))).toThrow();
  });

  it('does not let static appearance evidence prove motion or transitions', () => {
    for (const track of ['layer-motion', 'transition'] as const) {
      expect(() => parseReferencePart(part({ observations: [observation({ track })] }))).toThrow();
    }
    expect(() => parseReferencePart(part({ observations: [observation({ aspect: 'camera-motion' })] }))).toThrow();
    const video = evidence({ kind: 'video-range', presentation: 'continuous-video', frameTimeMs: undefined });
    expect(() => parseReferencePart(part({ evidence: [video], observations: [observation({ track: 'layer-motion' })] }))).not.toThrow();
  });

  it('does not turn sparse ordered images into continuous movement evidence', () => {
    const frames = evidence({ presentation: 'ordered-frames', frameTimeMs: undefined, sampleTimesMs: [0, 400, 900] });
    expect(() => parseReferencePart(part({ evidence: [frames], observations: [observation({ track: 'layer-motion' })] }))).toThrow();
    expect(() => referenceEvidenceSchema.parse({ ...frames, sampleTimesMs: [100, 10] })).toThrow();
    expect(() => referenceEvidenceSchema.parse({ ...frames, presentation: 'continuous-video' })).toThrow();
  });

  it('requires actual consumed sound for music and sound effects, not an ASR transcript', () => {
    const transcript = evidence({ kind: 'transcript-range', presentation: 'transcript', frameTimeMs: undefined });
    for (const track of ['music', 'sfx'] as const) {
      expect(() => parseReferencePart(part({ evidence: [transcript], observations: [observation({ track })] }))).toThrow();
      expect(() => parseReferencePart(part({ evidence: [evidence({ kind: 'audio-range', presentation: 'continuous-audio', frameTimeMs: undefined })], observations: [observation({ track })] }))).not.toThrow();
    }
    const partialAudio = evidence({ kind: 'audio-range', presentation: 'continuous-audio', frameTimeMs: undefined,
      consumedBy: [{ analyzerId: 'audio', capabilityVersion: '1', inputHash: sha, consumedRange: { startMs: 0, endMs: 50 } }] });
    expect(() => parseReferencePart(part({ evidence: [partialAudio], observations: [observation({ track: 'sfx' })] }))).toThrow();
  });

  it('retains scene-score changes as inferred candidates until continuous evidence confirms them', () => {
    const score = evidence({ kind: 'signal-measurement', presentation: 'signal', measurement: 'scene-change', frameTimeMs: undefined });
    expect(() => parseReferencePart(part({ evidence: [score], observations: [observation({ track: 'transition' })] }))).toThrow();
    expect(() => parseReferencePart(part({ evidence: [score], observations: [observation({ track: 'transition', state: 'inferred' })] }))).not.toThrow();
  });

  it('keeps unavailable timestamps explicit and validates word/segment time containment', () => {
    expect(referenceTranscriptSegmentSchema.parse({ id: 'speech-1', text: '无时间戳', range: null, timingQuality: 'missing', words: [] }).range).toBeNull();
    expect(() => referenceTranscriptSegmentSchema.parse({ id: 'speech-1', text: '错误', range, timingQuality: 'missing', words: [] })).toThrow();
    expect(() => referenceTranscriptSegmentSchema.parse({ id: 'speech-1', text: '错误', range, timingQuality: 'provider-word', words: [{ id: 'word-1', text: '错', range: { startMs: 900, endMs: 1200 } }] })).toThrow();
    expect(() => referenceObservationSchema.parse(observation({ state: 'not-analyzed', presence: 'present' }))).toThrow();
  });

  it('allows unknown tracks while distinguishing absence from missing analysis', () => {
    const value = part();
    value.coverage[1] = { track: 'shot', range, state: 'observed', presence: 'absent', evidenceIds: ['evidence-frame-1'] };
    expect(parseReferencePart(value).coverage[1].presence).toBe('absent');
    const summary = summarizeReferenceCoverage(value.coverage, 1000);
    expect(summary.find((entry) => entry.track === 'shot')).toMatchObject({ absentMs: 1000, observedMs: 1000, notAnalyzedMs: 0 });
    expect(summary.find((entry) => entry.track === 'sfx')).toMatchObject({ unknownMs: 1000, notAnalyzedMs: 1000 });
  });
});

describe('coverage and manifest', () => {
  it('detects both gaps and overlaps for every track', () => {
    const coverage = createUnanalyzedReferenceCoverage(range);
    expect(validateReferenceCoverage(coverage, range)).toEqual([]);
    expect(validateReferenceCoverage(coverage.slice(1), range)).toEqual([{ path: ['coverage', 'narrative'], message: '覆盖缺口 0–1000 ms' }]);
    expect(validateReferenceCoverage([...coverage, coverage[0]], range)[0].message).toContain('覆盖重复');
    expect(() => summarizeReferenceCoverage(coverage.slice(1), 1000)).toThrow();
    expect(REFERENCE_TRACKS).toHaveLength(10);
  });

  it('requires the manifest partitions and coverage to account for the full source', () => {
    expect(parseReferenceManifest(manifest())).toEqual(manifest());
    const incomplete = manifest();
    incomplete.parts[0].coreRange = { startMs: 0, endMs: 999 };
    expect(() => parseReferenceManifest(incomplete)).toThrow();
    const fakeComplete = { ...manifest(), coverageState: 'complete' };
    expect(() => parseReferenceManifest(fakeComplete)).toThrow();
    const duplicateTrack = manifest();
    duplicateTrack.coverageSummary[9] = duplicateTrack.coverageSummary[0];
    expect(() => parseReferenceManifest(duplicateTrack)).toThrow();
  });

  it('rejects unsafe artifact paths and inconsistent totals', () => {
    for (const path of ['../outside.json', '/outside.json', 'C:/outside.json', 'parts\\outside.json', 'a//b.json', 'a/%2e%2e/b.json', 'parts/a.json?x']) {
      expect(referenceArtifactPathSchema.safeParse(path).success, path).toBe(false);
    }
    expect(referenceArtifactPathSchema.safeParse('reference/parts/part-000001.r1.json').success).toBe(true);
    const value = manifest();
    value.totals.evidence += 1;
    expect(() => parseReferenceManifest(value)).toThrow();
  });

  it('checks actual loaded parts against manifest source, counts, and coverage totals', () => {
    expect(validateReferenceDocument(manifest(), [part()])).toEqual([]);
    expect(validateReferenceDocument(manifest(), [part({ sourceMediaSha256: 'b'.repeat(64) })]).map((issue) => issue.message)).toContain('分片与索引的来源不一致');
    const fakeTotals = manifest();
    fakeTotals.coverageSummary[1].notAnalyzedMs = 0;
    fakeTotals.coverageSummary[1].observedMs = 1000;
    expect(validateReferenceDocument(fakeTotals, [part()]).map((issue) => issue.message)).toContain('覆盖汇总与分片证据状态不一致');
  });
});
