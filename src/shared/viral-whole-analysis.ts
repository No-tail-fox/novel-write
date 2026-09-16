import { mkdir, statfs } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { emptyRecreation, type CompletedViralAnalysisRun, type RunViralAnalysisOptions } from './viral-analysis';
import {
  REFERENCE_TRACKS, REFERENCE_TRACK_LABELS, createUnanalyzedReferenceCoverage, planReferenceWindows,
  referenceManifestSchema, referencePartSchema, summarizeReferenceCoverage, validateReferenceDocument,
  type ReferenceEvidence, type ReferenceManifest, type ReferenceObservation, type ReferencePart,
  type ReferencePartRef, type ReferenceTimeRange, type ReferenceTranscriptSegment, type ReferenceTrack,
} from './viral-reference';
import { extractReferenceWindow, scanReferenceMedia } from './viral-reference-media';
import { ReferenceRequestLedger, writeReferenceControl } from './viral-reference-requests';
import {
  readReferenceJson, readReferenceManifest, readReferencePart, referenceHash, referenceManagedFile,
  registerReferenceMedia, writeReferenceJson, type ReferenceIndexPointer,
} from './viral-reference-store';
import type { ReferenceObservationDraft, ReferenceProviders, ReferenceSummary } from './viral-reference-provider-types';
import type { ViralAnalysisRecord, ViralAnalysisResult, ViralTranscriptSegment } from './types';

export interface WholeReferenceOptions extends Pick<RunViralAnalysisOptions, 'workDir' | 'signal' | 'resumeFrom' | 'persistCheckpoint' | 'emit'> {
  providers: ReferenceProviders;
  download?: RunViralAnalysisOptions['download'];
  publishIndex: (expectedRevision: number, pointer: ReferenceIndexPointer) => Promise<void>;
  scan?: typeof scanReferenceMedia;
  extractWindow?: typeof extractReferenceWindow;
}

const unitPointerSchema = z.object({ path: z.string(), hash: z.string() });
const PROMPT_VERSION = 'whole-reference-v1';

/** Whole source scan + bounded units + evidence-backed report; never generates a remake. */
export async function runWholeReferenceAnalysis(record: ViralAnalysisRecord, options: WholeReferenceOptions): Promise<CompletedViralAnalysisRun & { partial: boolean }> {
  const { workDir, signal, providers } = options;
  await mkdir(workDir, { recursive: true });
  const generation = record.runGeneration ?? 0;
  const checkpoint = structuredClone(options.resumeFrom ?? { runGeneration: generation });
  if (checkpoint.runGeneration !== generation) throw new Error('STALE_VIRAL_RUN');
  const persist = async () => options.persistCheckpoint?.(structuredClone(checkpoint));
  const emit = async (detail: string, progress: number, stage = 'analyzing_frames') => {
    signal?.throwIfAborted();
    await options.emit?.({ type: 'stage_progress', stage, detail, progress });
  };
  if (!checkpoint.downloaded) {
    if (!options.download) throw new Error('缺少原视频，请重新导入。');
    await emit('正在获取原视频', 0.03, 'downloading');
    checkpoint.downloaded = await options.download(record, workDir, signal);
    await persist();
  }
  const downloaded = checkpoint.downloaded;
  const videoPath = await referenceManagedFile(workDir, downloaded.videoPath);
  const scan = await (options.scan ?? scanReferenceMedia)(videoPath, workDir, signal, async (processed, duration) => {
    await emit(`扫描全片：${(processed / 1000).toFixed(1)} / ${(duration / 1000).toFixed(1)} 秒`, 0.05 + processed / duration * 0.12, 'extracting');
  });
  const { durationMs, hasAudio } = scan.probe;
  const plans = planReferenceWindows({ durationMs, candidateBoundariesMs: scan.candidateBoundariesMs });
  const available = await statfs(workDir, { bigint: true });
  const estimate = BigInt(Math.ceil(durationMs / 1000 * 128000 + plans.reduce((n, plan) => n + plan.unitRanges.length, 0) * 1024 * 1024 + 64 * 1024 * 1024));
  if (available.bavail * available.bsize < estimate) throw new Error('VIRAL_REFERENCE_DISK_SPACE: 工作磁盘剩余空间不足以提取全片观察媒体，请释放空间后继续。');
  const planHash = referenceHash(JSON.stringify({ version: PROMPT_VERSION, source: scan.sourceSha256, scan: scan.scanVersion, plans }));
  const fingerprint = referenceHash(JSON.stringify({ providers: providers.fingerprint, version: PROMPT_VERSION }));
  const sourceMediaId = `source-${scan.sourceSha256.slice(0, 24)}`;
  const sourceMime = ({ '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo' } as Record<string, string>)[extname(videoPath).toLowerCase()] ?? 'video/mp4';
  await registerReferenceMedia(workDir, sourceMediaId, videoPath, sourceMime);
  await registerReferenceMedia(workDir, 'source', videoPath, sourceMime);
  let currentPointer = record.referenceIndex ?? checkpoint.referenceIndex;
  let manifest = currentPointer ? await readReferenceManifest(workDir, currentPointer) : undefined;
  if (manifest && (manifest.sourceMediaSha256 !== scan.sourceSha256 || manifest.scanPlanHash !== planHash)) {
    throw new Error('VIRAL_REFERENCE_SOURCE_CHANGED: 原片或扫描计划已改变，请创建新的分析以保留原有修订。');
  }
  const parts: ReferencePart[] = [];
  for (const plan of plans) {
    parts.push(manifest ? await readReferencePart(workDir, manifest, plan.partId) : {
      schemaVersion: 1, partId: plan.partId, sourceMediaSha256: scan.sourceSha256, durationMs,
      coreRange: plan.coreRange, contextRange: plan.contextRange,
      evidence: [], observations: [], shots: [], transcript: [],
      coverage: createUnanalyzedReferenceCoverage(plan.coreRange),
    });
  }
  if (manifest && validateReferenceDocument(manifest, parts).length) throw new Error('VIRAL_REFERENCE_CORRUPT: 索引与分片不一致。');
  const publishedParts = new WeakMap<ReferencePart, ReferencePartRef>();
  if (manifest) parts.forEach(part => { const entry = manifest!.parts.find(item => item.partId === part.partId); if (entry) publishedParts.set(part, entry); });
  const publish = async (summary?: ReferenceSummary) => {
    signal?.throwIfAborted();
    const refs: ReferencePartRef[] = [];
    for (const part of parts) {
      const existing = publishedParts.get(part);
      if (existing) { refs.push(existing); continue; }
      referencePartSchema.parse(part);
      const artifact = await writeReferenceJson(workDir, 'part', part);
      refs.push({ partId: part.partId, coreRange: part.coreRange, contextRange: part.contextRange,
        artifactPath: artifact.path, artifactHash: artifact.hash, shotCount: part.shots.length,
        evidenceCount: part.evidence.length, observationCount: part.observations.length + part.shots.reduce((n, shot) => n + shot.observations.length, 0) });
      publishedParts.set(part, refs[refs.length - 1]);
    }
    const coverageSummary = summarizeReferenceCoverage(parts.flatMap(part => part.coverage), durationMs);
    const next = referenceManifestSchema.parse({ schemaVersion: 1, revision: (currentPointer?.revision ?? 0) + 1,
      basedOnRunGeneration: generation, sourceMediaId, sourceMediaSha256: scan.sourceSha256, durationMs,
      scope: 'whole-video', scanPlanHash: planHash, parts: refs, coverageSummary,
      coverageState: coverageSummary.every(item => item.notAnalyzedMs === 0) ? 'complete' : 'partial',
      totals: { shots: new Set(parts.flatMap(part => part.shots.map(shot => shot.id))).size,
        evidence: refs.reduce((n, part) => n + part.evidenceCount, 0), observations: refs.reduce((n, part) => n + part.observationCount, 0) },
      createdAt: new Date().toISOString(), ...(summary ? { summary } : {}),
    });
    const artifact = await writeReferenceJson(workDir, 'index', next);
    const pointer = { ...artifact, revision: next.revision };
    await options.publishIndex(currentPointer?.revision ?? 0, pointer);
    currentPointer = pointer;
    manifest = next;
    checkpoint.referenceIndex = pointer;
    await persist();
  };
  if (!manifest) await publish();
  const ledger = new ReferenceRequestLedger(workDir, record.settings.maxAnalysisRequests ?? 200, signal);
  const unitCount = plans.reduce((n, plan) => n + plan.unitRanges.length, 0);
  let processed = 0;
  for (const [partIndex, plan] of plans.entries()) {
    const prior = parts[partIndex];
    if (prior.analysisFingerprint === fingerprint && prior.coverage.every(cell => cell.reason !== 'pending' && cell.reason !== 'budget')) {
      processed += plan.unitRanges.length;
      continue;
    }
    const units: ReferencePart[] = [];
    for (const [unitIndex, range] of plan.unitRanges.entries()) {
      signal?.throwIfAborted();
      const unitId = `${plan.partId}-unit-${unitIndex + 1}`;
      await emit(`分析全片单元 ${processed + 1} / ${unitCount}（${(range.startMs / 1000).toFixed(1)}–${(range.endMs / 1000).toFixed(1)} 秒）`, 0.18 + processed / unitCount * 0.72);
      const unitKey = referenceHash(JSON.stringify({ planHash, fingerprint, range }));
      const cached = await readReferenceJson(workDir, `reference-units/${unitKey}.json`, unitPointerSchema).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      let unit: ReferencePart;
      if (cached) {
        unit = await readReferenceJson(workDir, cached.path, referencePartSchema, cached.hash);
        if (unit.analysisFingerprint !== fingerprint || unit.partId !== unitId || unit.sourceMediaSha256 !== scan.sourceSha256) throw new Error('VIRAL_REFERENCE_CORRUPT: 单元缓存不匹配。');
      } else {
        const contextRange = { startMs: Math.max(0, range.startMs - 1000), endMs: Math.min(durationMs, range.endMs + 1000) };
        const media = await (options.extractWindow ?? extractReferenceWindow)(videoPath, workDir, { id: unitId, coreRange: range, contextRange }, signal);
        unit = await analyzeUnit({ unitId, range, contextRange, durationMs, sourceMediaId, sourceHash: scan.sourceSha256, fingerprint,
          hasAudio, candidateBoundariesMs: scan.candidateBoundariesMs, media, providers, workDir, ledger, signal });
        const artifact = await writeReferenceJson(workDir, 'unit', unit);
        await writeReferenceControl(workDir, 'reference-units', `${unitKey}.json`, artifact);
      }
      units.push(unit);
      processed++;
      // Publish each completed unit. Pending remainder stays explicit, including interrupted batches.
      const remaining = plan.unitRanges.slice(unitIndex + 1).flatMap(item => createUnanalyzedReferenceCoverage(item));
      parts[partIndex] = mergeUnits(plan, units, remaining, prior, scan.sourceSha256, durationMs, unitIndex === plan.unitRanges.length - 1 ? fingerprint : undefined);
      await publish();
    }
  }
  const gaps = manifest!.coverageSummary.filter(track => track.notAnalyzedMs > 0).map(track => `${REFERENCE_TRACK_LABELS[track.track]}：${(track.notAnalyzedMs / 1000).toFixed(1)} 秒未分析`);
  let summary = manifest!.summary;
  if (!summary) {
    const observations = parts.flatMap(part => [...part.observations, ...part.shots.flatMap(shot => shot.observations)]);
    let chunks = observations.filter(item => item.state !== 'not-analyzed').map(item => `[${item.range.startMs}–${item.range.endMs}ms ${item.track}/${item.state}] ${item.text}`);
    // Hierarchical reduction consumes every unit with a bounded prompt at each level.
    if (providers.summarize && chunks.length) {
      let level = 0;
      do {
        const groups = boundedGroups(chunks, 16000);
        const next: ReferenceSummary[] = [];
        for (const [index, group] of groups.entries()) {
          await emit(`汇总全片结构（层级 ${level + 1}，${index + 1}/${groups.length}）`, 0.94, 'breaking_down');
          next.push(await ledger.run({ fingerprint: providers.fingerprints?.summary ?? fingerprint, planHash, step: 'summary', level, index, input: group, partial: gaps.length > 0 }, () => providers.summarize!({ summaries: group, partial: gaps.length > 0 }, signal)));
        }
        if (next.length === 1) { summary = next[0]; break; }
        chunks = next.map(item => JSON.stringify(item));
        level++;
        if (level > 8) throw new Error('VIRAL_REFERENCE_SUMMARY_LIMIT: 分层摘要未收敛，逐段报告已保存。');
      } while (chunks.length);
    }
    summary ??= { overview: `已扫描 ${(durationMs / 1000).toFixed(1)} 秒原片，共 ${unitCount} 个候选镜头单元。`,
      narrative: '未配置可用的汇总模型；请查看逐段观察。', rhythm: `平均候选镜头单元 ${(durationMs / unitCount / 1000).toFixed(2)} 秒；分段界限不一定是剪辑点。`, productionRules: [], limitations: [] };
    summary.limitations = [...new Set([...summary.limitations, ...gaps, '候选切点来自画面变化检测；不等同于已确认的镜头边界。'])];
    await publish(summary);
  }
  const result: ViralAnalysisResult = {
    schemaVersion: 2, recreationState: 'not-requested', referenceAnalysisRef: currentPointer,
    source: { ...downloaded.source, duration: durationMs / 1000 }, frames: [],
    transcript: parts.flatMap(part => part.transcript).map(segment => ({ text: segment.text, start: (segment.range?.startMs ?? 0) / 1000, end: (segment.range?.endMs ?? 0) / 1000, words: [] })),
    contentBreakdown: { topic: summary.overview, title: { original: downloaded.source.title, pattern: '', suggestions: [] },
      cover: { observed: '', pattern: '', suggestions: [] }, opening: { type: '', analysis: summary.narrative, reusablePattern: '' },
      structure: { type: '', analysis: summary.narrative, outline: summary.productionRules }, ending: { type: '', analysis: '', reusablePattern: '' },
      viralPoint: { summary: summary.overview, evidence: summary.limitations, reusablePattern: summary.productionRules.join('\n') } },
    recreation: emptyRecreation(record.settings), createdAt: new Date().toISOString(),
  };
  const resultArtifact = await writeReferenceJson(workDir, 'result', result);
  return { result, resultPath: join(workDir, resultArtifact.path), videoPath, partial: manifest!.coverageState === 'partial' };
}

function mergeUnits(plan: { partId: string; coreRange: ReferenceTimeRange; contextRange: ReferenceTimeRange }, units: ReferencePart[], remaining: ReferencePart['coverage'], prior: ReferencePart, sourceHash: string, durationMs: number, fingerprint?: string): ReferencePart {
  const userEdits = new Map([...prior.observations, ...prior.shots.flatMap(shot => shot.observations)].filter(item => item.origin === 'user').map(item => [item.id, item]));
  const preserve = (item: ReferenceObservation) => userEdits.has(item.id) ? { ...item, text: userEdits.get(item.id)!.text, origin: 'user' as const } : item;
  return referencePartSchema.parse({ schemaVersion: 1, analysisFingerprint: fingerprint, partId: plan.partId,
    sourceMediaSha256: sourceHash, durationMs, coreRange: plan.coreRange, contextRange: plan.contextRange,
    evidence: units.flatMap(unit => unit.evidence), observations: units.flatMap(unit => unit.observations).map(preserve),
    shots: units.flatMap(unit => unit.shots).map(shot => ({ ...shot, observations: shot.observations.map(preserve) })),
    transcript: units.flatMap(unit => unit.transcript), coverage: [...units.flatMap(unit => unit.coverage), ...remaining] });
}

interface UnitOptions {
  unitId: string; range: ReferenceTimeRange; contextRange: ReferenceTimeRange; durationMs: number;
  sourceMediaId: string; sourceHash: string; fingerprint: string; hasAudio: boolean;
  candidateBoundariesMs: number[];
  media: Awaited<ReturnType<typeof extractReferenceWindow>>; providers: ReferenceProviders;
  workDir: string; ledger: ReferenceRequestLedger; signal?: AbortSignal;
}

async function analyzeUnit(o: UnitOptions): Promise<ReferencePart> {
  const { unitId, range, providers, media, fingerprint, ledger, signal } = o;
  const evidence: ReferenceEvidence[] = [];
  const observations: ReferenceObservation[] = [];
  const consume = (analyzerId: string, consumedRange = range) => [{ analyzerId, capabilityVersion: PROMPT_VERSION,
    inputHash: referenceHash(JSON.stringify({ fingerprint, source: o.sourceHash, range: consumedRange, analyzerId })), consumedRange }];
  const signalId = `${unitId}-scan`;
  evidence.push({ id: signalId, kind: 'signal-measurement', range, mediaId: o.sourceMediaId, presentation: 'signal', measurement: 'scene-change', consumedBy: consume('decoded-scene-scan') });
  const add = (draft: ReferenceObservationDraft, evidenceIds: string[], origin: 'model' | 'detector' = 'model') => {
    const sameTrack = observations.filter(item => item.track === draft.track).length;
    observations.push({ ...draft, id: `${unitId}-${draft.track}-${sameTrack}`, range, evidenceIds,
      confidence: draft.state === 'observed' ? 'medium' : 'low', origin,
      ...(draft.state === 'not-analyzed' || draft.presence === 'unknown' ? { reason: 'insufficient-evidence' as const } : {}) });
  };
  add({ track: 'rhythm', text: `此候选镜头单元持续 ${((range.endMs - range.startMs) / 1000).toFixed(2)} 秒；分段可能来自检测切点或最长窗口限制。`, state: 'inferred', presence: 'present' }, [signalId], 'detector');
  add({ track: 'transition', text: '画面变化扫描仅提供候选边界；转场类型仍待连续画面分析确认。', state: 'inferred', presence: 'unknown' }, [signalId], 'detector');
  if (!o.hasAudio) {
    const noAudioId = `${unitId}-no-audio`;
    evidence.push({ id: noAudioId, kind: 'signal-measurement', range, mediaId: o.sourceMediaId,
      presentation: 'signal', measurement: 'audio-track-absence', consumedBy: consume('media-stream-probe') });
    for (const track of ['speech', 'music', 'sfx', 'av-sync'] as const) add({ track, text: '媒体探测确认原片没有音轨，此声音维度不存在。', state: 'observed', presence: 'absent' }, [noAudioId], 'detector');
  }
  let transcript: ReferenceTranscriptSegment[] = [];
  const request = <T>(step: 'visual' | 'audio' | 'transcribe', run: () => Promise<T>) => ledger.run({
    fingerprint: providers.fingerprints?.[step] ?? fingerprint, version: PROMPT_VERSION, sourceHash: o.sourceHash, unitId, range, step,
  }, run);
  let audioId: string | undefined;
  if (media.audioPath) {
    const mediaId = `${unitId}-audio`;
    await registerReferenceMedia(o.workDir, mediaId, media.audioPath, 'audio/wav');
    audioId = `${unitId}-audio-evidence`;
    evidence.push({ id: audioId, mediaId, kind: 'audio-range', range, presentation: 'continuous-audio', consumedBy: [] });
    if (providers.transcribe) {
      const raw = await request('transcribe', () => providers.transcribe!(media.audioPath!, signal));
      transcript = absoluteTranscript(raw, range, unitId);
      // ASR is only cited via its transcript; its audio consumption never proves music/SFX.
      const transcriptId = `${unitId}-transcript-evidence`;
      evidence.push({ id: transcriptId, mediaId, kind: 'transcript-range', range, presentation: 'transcript', transcriptSegmentIds: transcript.map(item => item.id), consumedBy: consume('speech-transcription') });
      add({ track: 'speech', text: transcript.length ? transcript.map(item => item.text).join('\n') : '转写未返回文字；这不能证明片段没有人声。', state: transcript.length ? 'observed' : 'inferred', presence: transcript.length ? 'present' : 'unknown' }, [transcriptId]);
    }
  }
  const input = { unitId, range, contextRange: o.contextRange, ...media, transcript };
  const visualIds: string[] = [];
  for (const [index, frame] of media.frames.entries()) {
    await registerReferenceMedia(o.workDir, frame.mediaId, frame.path, 'image/jpeg');
    const id = `${unitId}-frame-${index}`;
    evidence.push({ id, kind: 'frame', range: o.contextRange, mediaId: frame.mediaId, frameTimeMs: frame.timeMs, presentation: 'still', reason: 'uniform', consumedBy: [] });
    visualIds.push(id);
  }
  const videoId = `${unitId}-video-evidence`;
  const videoMediaId = `${unitId}-video`;
  await registerReferenceMedia(o.workDir, videoMediaId, media.videoPath, 'video/mp4');
  evidence.push({ id: videoId, kind: 'video-range', range, mediaId: videoMediaId, presentation: 'continuous-video', consumedBy: [] });
  if (providers.analyzeVisual) {
    const drafts = await request('visual', () => providers.analyzeVisual!(input, signal));
    const used = providers.visualMode === 'video' ? [videoId] : visualIds;
    evidence.filter(item => used.includes(item.id)).forEach(item => { item.consumedBy = consume('visual-observer'); });
    for (const draft of drafts) {
      if (['music', 'sfx', 'speech'].includes(draft.track)) continue;
      if (providers.visualMode !== 'video' && (['transition', 'layer-motion'].includes(draft.track) || ['camera-motion', 'subject-motion'].includes(draft.aspect ?? ''))) continue;
      if (draft.track === 'av-sync') {
        if (!transcript.some(segment => segment.range)) continue;
        add({ ...draft, state: 'inferred' }, [...used, `${unitId}-transcript-evidence`]);
      } else {
        // A whole interval inferred from sparse stills is never labelled continuously observed.
        add({ ...draft, state: (providers.visualMode === 'frames' || ['narrative', 'rhythm'].includes(draft.track)) && draft.state === 'observed' ? 'inferred' : draft.state }, used);
      }
    }
  }
  if (audioId && providers.analyzeAudio) {
    const drafts = await request('audio', () => providers.analyzeAudio!(input, signal));
    evidence.find(item => item.id === audioId)!.consumedBy = consume('audio-observer');
    for (const draft of drafts) if (['music', 'sfx', 'speech'].includes(draft.track)) add(draft, [audioId]);
  }
  const coverage = REFERENCE_TRACKS.map(track => {
    const matches = observations.filter(item => item.track === track && item.state !== 'not-analyzed' && item.presence !== 'unknown');
    const chosen = matches.find(item => item.state === 'observed') ?? matches[0];
    if (chosen) return { range, track, state: chosen.state, presence: chosen.presence, evidenceIds: chosen.evidenceIds };
    return { range, track, state: 'not-analyzed' as const, presence: 'unknown' as const, evidenceIds: [], reason: (!o.hasAudio && ['speech', 'music', 'sfx', 'av-sync'].includes(track) ? 'not-applicable' : 'missing-capability') as 'not-applicable' | 'missing-capability' };
  });
  for (const cell of coverage.filter(cell => cell.state === 'not-analyzed')) {
    observations.push({ id: `${unitId}-gap-${cell.track}`, track: cell.track, range, state: 'not-analyzed', presence: 'unknown',
      text: cell.reason === 'not-applicable' ? '来源没有音轨，不适用声音内容分析。' : `${REFERENCE_TRACK_LABELS[cell.track]}尚无足够的已消费证据，请配置对应视听能力。`,
      evidenceIds: [], confidence: 'low', origin: 'detector', reason: cell.reason });
  }
  return referencePartSchema.parse({ schemaVersion: 1, analysisFingerprint: fingerprint, partId: unitId, sourceMediaSha256: o.sourceHash,
    durationMs: o.durationMs, coreRange: range, contextRange: o.contextRange, evidence, observations: [],
    shots: [{ id: `${unitId}-shot`, range, boundary: {
      startState: range.startMs === 0 ? 'observed' : o.candidateBoundariesMs.includes(range.startMs) ? 'inferred' : 'not-analyzed',
      endState: range.endMs === o.durationMs ? 'observed' : o.candidateBoundariesMs.includes(range.endMs) ? 'inferred' : 'not-analyzed',
      evidenceIds: [signalId], uncertaintyMs: 0,
    }, observations, label: '候选镜头单元' }],
    transcript, coverage });
}

export function absoluteTranscript(segments: ViralTranscriptSegment[], core: ReferenceTimeRange, prefix: string): ReferenceTranscriptSegment[] {
  const localDuration = core.endMs - core.startMs;
  const toRange = (start: number, end: number): ReferenceTimeRange | null => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || Math.round(start * 1000) >= localDuration) return null;
    return { startMs: core.startMs + Math.round(start * 1000), endMs: core.startMs + Math.min(localDuration, Math.round(end * 1000)) };
  };
  return segments.filter(segment => segment.text.trim()).map((segment, index) => {
    const range = toRange(segment.start, segment.end);
    const words = range ? segment.words.map((word, i) => ({ id: `${prefix}-word-${index}-${i}`, text: word.word,
      range: toRange(word.start, word.end) })).filter(word => word.text && word.range && word.range.startMs >= range.startMs && word.range.endMs <= range.endMs) : [];
    return { id: `${prefix}-transcript-${index}`, text: segment.text, range,
      timingQuality: range ? words.length ? 'provider-word' as const : 'provider-segment' as const : 'missing' as const, words };
  });
}

function boundedGroups(items: string[], maxChars: number): string[][] {
  const groups: string[][] = [];
  let group: string[] = [], length = 0;
  for (const item of items) {
    // Long model values are retained by splitting, not silently truncated.
    for (let offset = 0; offset < item.length; offset += maxChars) {
      const piece = item.slice(offset, offset + maxChars);
      if (length + piece.length > maxChars && group.length) { groups.push(group); group = []; length = 0; }
      group.push(piece); length += piece.length;
    }
  }
  if (group.length) groups.push(group);
  return groups;
}
