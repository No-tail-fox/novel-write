import { z } from 'zod';
import { rebuildEditorialTimeline, type EditorialCameraKeyframe, type EditorialCollagePipelineData, type EditorialLayerMotionKeyframe } from './editorial-collage';
import type { MotionComicPipelineData } from './motion-comic';
import type { ProductionAssetVersion, ProductionProviderJob, ProductionQualityReport, ProductionQualityManualReview, ProductionQualityRecheckScope, ProductionSubtitleCue, ProductionSubtitleToken, ProductionTimeline } from './production-workflow';
import { isSubtitleAlignmentValid } from './audio-alignment';
import { productionAudioClipsForShot, resolveProductionAudioClips, validateProductionAudioTimeline, type ResolvedProductionAudioClip } from './production-audio';
import { evaluateDirectorSubtitleLayout, type ProductionSubtitleLayoutEvidence } from './production-subtitle-layout';
import { directorSceneLayoutClass, directorSceneSubtitleClass } from './director-scene-layout';
import { evaluateDirectorVisualContinuity, type ProductionVisualContinuityEvidence } from './production-visual-continuity';
import { measureProductionNarrationAlignment, type ProductionNarrationAlignmentEvidence } from './production-audio-alignment';

export interface DirectorRenderRequest {
  id: string;
  /** Optional explicit episode to render; defaults to the document's active episode. */
  episodeId?: string;
}

export interface DirectorSubtitleRecheckRequest {
  id: string;
  reportId: string;
  renderFingerprint: string;
  episodeId?: string;
  shotIds: string[];
  cueIds: string[];
  expectedUpdatedAt: string;
}

export interface DirectorSubtitleRecheckResult {
  reportId: string;
  renderFingerprint: string;
  checkedShotIds: string[];
  checkedCueIds: string[];
  report: ProductionQualityReport;
  result: DirectorRenderResult;
}

export interface DirectorMediaRecheckRequest {
  id: string;
  reportId: string;
  renderFingerprint: string;
  episodeId?: string;
  shotIds: string[];
  startMs?: number;
  endMs?: number;
  expectedUpdatedAt: string;
}

export interface DirectorMediaRecheckResult {
  reportId: string;
  renderFingerprint: string;
  checkedShotIds: string[];
  startMs?: number;
  endMs?: number;
  report: ProductionQualityReport;
  result: DirectorRenderResult;
}

/** Stable, browser-safe fingerprint of authored inputs used by the final render. */
export type DirectorRenderDocument = EditorialCollagePipelineData | MotionComicPipelineData;

export function directorDocumentRenderFingerprint(document: DirectorRenderDocument, explicitEpisodeId?: string): string {
  const source = document.workflowKind === 'motion-comic'
    ? motionComicRenderFingerprintSource(document, explicitEpisodeId)
    : {
        workflowKind: document.workflowKind,
        id: document.id,
        ratio: document.ratio,
        title: document.title,
        beats: document.beats.map((beat) => ({
          title: beat.title, narration: beat.narration, startMs: beat.startMs,
          shots: beat.shots.map((shot) => ({
            id: shot.id, durationMs: shot.durationMs, renderStrategy: shot.renderStrategy,
            scenePrompt: shot.scenePrompt, motionPrompt: shot.motionPrompt,
            layers: shot.layers, camera: shot.camera, subtitleCueIds: shot.subtitleCueIds,
            videoAssetVersionId: shot.videoAssetVersionId, videoJobId: shot.videoJobId,
            voiceAssetVersionId: shot.voiceAssetVersionId, voiceId: shot.voiceId, voiceSpeed: shot.voiceSpeed,
            layoutTemplate: shot.layoutTemplate, motionPreset: shot.motionPreset, subtitleStyle: shot.subtitleStyle,
          })),
          subtitleCues: beat.subtitleCues.filter((cue) => beat.shots.some((shot) => shot.subtitleCueIds.includes(cue.id))),
        })),
        timeline: renderTimelineInput(document.timeline),
        assets: referencedRenderAssets(document, document.beats.flatMap((beat) => beat.shots.flatMap((shot) => [
          shot.voiceAssetVersionId,
          shot.videoAssetVersionId,
          ...shot.layers.map((layer) => layer.assetVersionId),
          ...shot.subtitleCueIds.flatMap((id) => beat.subtitleCues.find((cue) => cue.id === id)?.audioAssetVersionId ?? []),
        ]).filter((id): id is string => Boolean(id))).concat((document.timeline?.audioClips ?? []).map((clip) => clip.assetVersionId))),
      };
  const value = JSON.stringify(source, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `director-v3-${hash.toString(16).padStart(16, '0')}`;
}

function renderTimelineInput(timeline?: ProductionTimeline) {
  return timeline && { durationMs: timeline.durationMs, clips: timeline.clips.map((clip) => ({ shotId: clip.shotId, startMs: clip.startMs, durationMs: clip.durationMs })), audioClips: timeline.audioClips };
}

function motionComicRenderFingerprintSource(document: MotionComicPipelineData, explicitEpisodeId?: string): unknown {
  const episodeId = explicitEpisodeId ?? document.activeEpisodeId;
  const episode = document.episodes.find((candidate) => candidate.id === episodeId);
  if (!episode) return { workflowKind: document.workflowKind, id: document.id, ratio: document.ratio, episodeId, episode: null, assets: [] };
  const shotIds = episode.scenes.flatMap((scene) => scene.shots);
  const referencedIds = new Set<string>();
  for (const shot of shotIds) {
    for (const id of [shot.firstFrameAssetVersionId, shot.lastFrameAssetVersionId, shot.voiceAssetVersionId]) if (id) referencedIds.add(id);
    for (const cue of episode.dialogueCues.filter((cue) => shot.dialogueCueIds.includes(cue.id))) {
      for (const id of [cue.audioAssetVersionId, cue.voiceAssetVersionId]) if (id) referencedIds.add(id);
    }
  }
  for (const clip of episode.timeline.audioClips ?? []) referencedIds.add(clip.assetVersionId);
  const usedCharacterIds = new Set<string>();
  for (const shot of shotIds) {
    for (const lookId of shot.characterLookIds) {
      const look = document.characters.flatMap((character) => character.looks).find((candidate) => candidate.id === lookId);
      if (look) usedCharacterIds.add(look.characterId);
    }
    for (const cue of episode.dialogueCues.filter((cue) => shot.dialogueCueIds.includes(cue.id))) if (cue.characterId) usedCharacterIds.add(cue.characterId);
  }
  const usedSceneIds = new Set(shotIds.map((shot) => shot.sceneAssetId).filter(Boolean));
  const usedPropIds = new Set(shotIds.flatMap((shot) => shot.propAssetIds));
  const usedLooks = document.characters.flatMap((character) => character.looks).filter((look) => shotIds.some((shot) => shot.characterLookIds.includes(look.id)));
  const reference = (ids: readonly string[]) => {
    const candidates = document.assets.filter((asset) => ids.includes(asset.id) && asset.kind === 'image' && asset.localPath);
    const selected = candidates.find((asset) => asset.selected && asset.pinned) ?? [...candidates].reverse().find((asset) => asset.pinned);
    if (selected) referencedIds.add(selected.id);
    return selected?.id ?? null;
  };
  const shared = {
    worldRules: document.series.worldRules, visualRules: document.series.visualRules, negativePrompt: document.series.negativePrompt,
    characters: document.characters.filter((character) => usedCharacterIds.has(character.id)).map((character) => ({
      id: character.id, name: character.name, role: character.role, identityPrompt: character.identityPrompt,
      voiceId: character.voiceId, voiceProvider: character.voiceProvider, voiceSpeed: character.voiceSpeed,
      looks: character.looks.filter((look) => usedLooks.includes(look)).map((look) => ({
        id: look.id, label: look.label, appearancePrompt: look.appearancePrompt, wardrobe: look.wardrobe,
        continuityNotes: look.continuityNotes, reference: reference(look.referenceAssetVersionIds),
      })),
    })),
    sceneAssets: document.sceneAssets.filter((asset) => usedSceneIds.has(asset.id)).map(({ referenceAssetVersionIds, ...asset }) => ({ ...asset, reference: reference(referenceAssetVersionIds) })),
    props: document.props.filter((prop) => usedPropIds.has(prop.id)).map(({ referenceAssetVersionIds, ...prop }) => ({ ...prop, reference: reference(referenceAssetVersionIds) })),
  };
  return {
    workflowKind: document.workflowKind,
    id: document.id,
    title: document.title,
    ratio: document.ratio,
    episodeId: episode.id,
    episode: {
      id: episode.id,
      scenes: episode.scenes.map((scene) => ({ id: scene.id, title: scene.title, shots: scene.shots.map(({ voiceLabel: _label, videoJobId: _videoJob, ...shot }) => ({ ...shot, layoutTemplate: shot.layoutTemplate ?? '漫画分格 · 角色优先' })) })),
      dialogueCues: episode.dialogueCues.filter((cue) => shotIds.some((shot) => shot.dialogueCueIds.includes(cue.id))),
      timeline: renderTimelineInput(episode.timeline),
    },
    assets: referencedRenderAssets(document, [...referencedIds]),
    // Only shared voice/reference records bound to this episode can make its
    // authored media stale; unrelated series edits must not invalidate it.
    shared,
  };
}

function referencedRenderAssets(document: { assets: Array<{ id: string; kind: string; localPath?: string; sha256?: string; assetId: string; durationMs?: number }> }, ids: readonly string[]) {
  const wanted = new Set(ids);
  return document.assets
    .filter((asset) => wanted.has(asset.id) && asset.assetId !== 'director-final-video')
    .map((asset) => ({ id: asset.id, kind: asset.kind, localPath: asset.localPath, sha256: asset.sha256, durationMs: asset.durationMs }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function directorRenderOutputs(document: DirectorRenderDocument, episodeId?: string) {
  const scope = document.workflowKind === 'motion-comic' ? episodeId ?? document.activeEpisodeId : undefined;
  const fingerprint = directorDocumentRenderFingerprint(document, scope);
  const history = document.assets.filter((asset) => asset.assetId === 'director-final-video' && asset.kind === 'video'
    && (scope ? asset.episodeId === scope : !asset.episodeId)).slice().reverse();
  return { history, current: history.find((asset) => asset.selected && asset.renderFingerprint === fingerprint) };
}

export interface DirectorQualityReview {
  report?: ProductionQualityReport;
  freshness: 'current' | 'stale' | 'unverified' | 'missing';
  unassignedCount: number;
}

export function directorQualityReview(document: DirectorRenderDocument, episodeId?: string): DirectorQualityReview {
  const scope = document.workflowKind === 'motion-comic' ? episodeId ?? document.activeEpisodeId : undefined;
  const fingerprint = directorDocumentRenderFingerprint(document, scope);
  const jobs = new Map(document.providerJobs.filter((job) => job.workflowKind === document.workflowKind && job.capability === 'deterministic-render').map((job) => [job.id, job]));
  const candidates: Array<{ report: ProductionQualityReport; freshness: DirectorQualityReview['freshness']; requestedAt: number; attempt: number; index: number }> = [];
  let unassignedCount = 0;
  document.qualityReports.forEach((report, index) => {
    if (report.workflowKind !== document.workflowKind || report.stage !== 'export') return;
    // Older exports used matching ID suffixes before reports stored their job ID.
    const legacyJobId = report.id.startsWith('director-quality-') ? `director-render-job-${report.id.slice('director-quality-'.length)}` : undefined;
    const job = jobs.get(report.providerJobId ?? legacyJobId ?? '');
    const conflict = Boolean((report.providerJobId && !job)
      || (job && report.episodeId !== undefined && report.episodeId !== job.episodeId)
      || (job && report.renderFingerprint !== undefined && report.renderFingerprint !== job.renderFingerprint));
    const owner = report.episodeId ?? job?.episodeId;
    if (document.workflowKind === 'motion-comic' && (!owner || conflict)) { unassignedCount += 1; return; }
    if (owner !== scope) return;
    const reportFingerprint = report.renderFingerprint ?? job?.renderFingerprint;
    const verified = !conflict && Boolean(job && reportFingerprint);
    candidates.push({ report, freshness: !verified ? 'unverified' : reportFingerprint === fingerprint ? 'current' : 'stale',
      requestedAt: Date.parse(job?.createdAt ?? report.createdAt) || 0, attempt: job?.attempt ?? 0, index });
  });
  candidates.sort((left, right) => right.requestedAt - left.requestedAt || right.attempt - left.attempt || right.index - left.index);
  const latest = candidates.find((candidate) => candidate.freshness === 'current') ?? candidates[0];
  return { ...(latest ? { report: latest.report } : {}), freshness: latest?.freshness ?? 'missing', unassignedCount };
}

export function canConfirmDirectorQualityReport(report: ProductionQualityReport): boolean {
  return (report.status === 'passed' || report.status === 'waived')
    && report.checks.every((check) => check.severity === 'warning' || check.severity === 'manual'
      || check.status === 'passed' || check.status === 'waived');
}

export function confirmDirectorQualityReview<T extends DirectorRenderDocument>(
  document: T,
  input: ProductionQualityManualReview,
  episodeId?: string,
): T {
  const scope = document.workflowKind === 'motion-comic' ? episodeId ?? document.activeEpisodeId : undefined;
  const fingerprint = directorDocumentRenderFingerprint(document, scope);
  if (input.renderFingerprint !== fingerprint) throw new Error('当前内容已变更，请重新生成并审片后再确认。');
  const review = directorQualityReview(document, scope);
  if (review.freshness !== 'current' || review.report?.id !== input.reportId) throw new Error('该审片报告已过期或无法核对当前分集，不能确认。');
  const index = document.qualityReports.findIndex((report) => report.id === input.reportId);
  if (index < 0) throw new Error('审片报告不存在，请重新生成并审片。');
  const report = document.qualityReports[index];
  const reportFingerprint = report.renderFingerprint;
  if (report.workflowKind !== document.workflowKind || report.stage !== 'export' || reportFingerprint !== fingerprint || (document.workflowKind === 'motion-comic' && report.episodeId !== scope)) {
    throw new Error('该审片报告已过期或无法核对当前分集，不能确认。');
  }
  if (!canConfirmDirectorQualityReport(report)) {
    throw new Error('报告仍有未通过的阻断项，修复并重新审片后才能确认。');
  }
  if (!Number.isFinite(Date.parse(input.confirmedAt))) throw new Error('人工复核确认时间无效。');
  const manualReview: ProductionQualityManualReview = {
    reportId: report.id,
    renderFingerprint: fingerprint,
    scope: { kind: 'project' },
    confirmedAt: input.confirmedAt,
  };
  return { ...document, qualityReports: document.qualityReports.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, manualReview } : candidate) } as T;
}

export interface DirectorRenderCompletion {
  asset?: ProductionAssetVersion;
  job: ProductionProviderJob;
  report: ProductionQualityReport;
}

/** Only append render-owned artifacts to a fresh revision, preserving authored edits. */
export function mergeDirectorRenderCompletion(document: DirectorRenderDocument, completion: DirectorRenderCompletion): DirectorRenderDocument {
  const { asset, job, report } = completion;
  if (document.providerJobs.some((candidate) => candidate.id === job.id)) return document;
  const currentFingerprint = directorDocumentRenderFingerprint(document, job.episodeId);
  const isCurrent = currentFingerprint === job.renderFingerprint;
  const scopeMatches = (candidate: ProductionAssetVersion) => candidate.assetId === 'director-final-video' && candidate.episodeId === job.episodeId;
  const newerCurrent = document.assets.some((candidate) => scopeMatches(candidate) && candidate.selected
    && candidate.renderFingerprint === currentFingerprint
    && Date.parse(document.providerJobs.find((owner) => owner.id === candidate.providerJobId)?.createdAt ?? candidate.createdAt) > Date.parse(job.createdAt));
  const select = Boolean(asset && isCurrent && !newerCurrent);
  const previousAssets = document.assets.map((candidate) => scopeMatches(candidate) && (select || (!asset && isCurrent && candidate.renderFingerprint !== currentFingerprint))
    ? { ...candidate, selected: false, pinned: false }
    : candidate);
  const assets = asset ? [...previousAssets, { ...asset, selected: select, pinned: select }] : previousAssets;
  const selectedForActive = document.workflowKind !== 'motion-comic' || document.activeEpisodeId === job.episodeId;
  const stage = select && selectedForActive ? 'completed' : !asset && isCurrent && !newerCurrent && selectedForActive ? 'failed' : document.stage;
  const records = { assets, providerJobs: [...document.providerJobs, job], qualityReports: [...document.qualityReports, report] };
  return document.workflowKind === 'motion-comic'
    ? { ...document, ...records, stage: stage as MotionComicPipelineData['stage'], episodes: document.episodes.map((episode) => select && episode.id === job.episodeId ? { ...episode, status: 'completed' } : episode) }
    : { ...document, ...records, stage: stage as EditorialCollagePipelineData['stage'] };
}

export async function persistDirectorRenderCompletion(
  completion: DirectorRenderCompletion,
  store: { load: () => Promise<DirectorRenderDocument>; save: (document: DirectorRenderDocument) => Promise<unknown> },
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latest = await store.load();
    const next = mergeDirectorRenderCompletion(latest, completion);
    if (next === latest) return;
    try { await store.save(next); return; }
    catch (error) {
      if (!(error instanceof Error && /^(?:EDITORIAL_COLLAGE|MOTION_COMIC)_STALE_WRITE:/u.test(error.message)) || attempt === 3) throw error;
    }
  }
}

export interface DirectorGenerateShotVideoRequest {
  /** Persisted VOX project identifier; renderer must not provide provider secrets or paths. */
  id: string;
  /** Persisted VOX shot identifier within the project. */
  shotId: string;
  /** Revision token returned with the project document for optimistic concurrency. */
  expectedUpdatedAt: string;
}

export interface DirectorGenerateShotVideoResult {
  videoAssetVersionId: string;
  videoJobId: string;
  providerId: string;
  providerName: string;
  model: string;
  estimatedCost: number;
  durationMs: number;
}

const directorIdentifierSchema = z
  .string()
  .max(256)
  .refine((value) => value.trim().length > 0, 'Value is required.');

/**
 * Minimal renderer-to-main request. Provider credentials, source paths,
 * prompts, budgets, and output locations are resolved in the main process.
 */
export const directorGenerateShotVideoRequestSchema = z
  .object({
    id: directorIdentifierSchema,
    shotId: directorIdentifierSchema,
    expectedUpdatedAt: z
      .string()
      .max(64)
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp.'),
  })
  .strict();

export interface DirectorRenderResult {
  subtitleLayout?: ProductionSubtitleLayoutEvidence;
  outputPath: string;
  durationMs: number;
  sizeBytes: number;
  width: number;
  height: number;
  hasAudio: true;
  hasVideo: true;
  hasNonBlackVideo: true;
  /** Optional FFmpeg evidence used by the review gate. */
  audioMeanVolumeDb?: number;
  audioPeakDb?: number;
  audioLufs?: number;
  audioTruePeakDb?: number;
  audioIsSilent?: boolean;
  blackIntervalsMs?: Array<{ startMs: number; endMs: number }>;
  visualContinuity?: ProductionVisualContinuityEvidence;
  audioQualityStatus?: 'ok' | 'failed' | 'unavailable';
  audioQualityError?: string;
  blackDetectionStatus?: 'ok' | 'failed' | 'unavailable';
  blackDetectionError?: string;
}

/** Product review targets, not a platform certification or an automatic gain adjustment. */
export const DIRECTOR_AUDIO_TARGETS = {
  integratedLufsMin: -20,
  integratedLufsMax: -14,
  truePeakMaxDbtp: -1,
} as const;

export function directorNarrationAlignment(
  document: DirectorRenderDocument,
  scenes: readonly DirectorRenderScene[],
  episodeId?: string,
  measuredAt = new Date().toISOString(),
): ProductionNarrationAlignmentEvidence {
  const episode = document.workflowKind === 'motion-comic'
    ? document.episodes.find((candidate) => candidate.id === (episodeId ?? document.activeEpisodeId))
    : undefined;
  const shots = document.workflowKind === 'motion-comic'
    ? episode?.scenes.flatMap((scene) => scene.shots) ?? []
    : document.beats.flatMap((beat) => beat.shots);
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  return measureProductionNarrationAlignment(scenes.map((scene) => {
    const shot = shotById.get(scene.id);
    // Use authored timeline clips for evidence, including muted speech. The
    // resolved scene clips intentionally omit muted tracks for actual mixing,
    // but a muted narration asset still has a real source duration to measure.
    const timeline = document.workflowKind === 'motion-comic' ? episode?.timeline : document.timeline;
    const authoredAudio = shot ? productionAudioClipsForShot(timeline, shot) : undefined;
    const authoredSpeech = authoredAudio?.filter((clip) => clip.trackType === 'dialogue' || clip.trackType === 'narration') ?? [];
    const authoredSpeechIds = authoredSpeech.map((clip) => clip.assetVersionId);
    const renderedSpeechIds = scene.audioClips?.filter((clip) => clip.trackType === 'dialogue' || clip.trackType === 'narration').map((clip) => clip.assetVersionId) ?? [];
    const speechIds = authoredSpeechIds.length > 0 ? authoredSpeechIds : renderedSpeechIds.length > 0 ? renderedSpeechIds : (shot?.voiceAssetVersionId ? [shot.voiceAssetVersionId] : []);
    const speechDurations = authoredSpeech.length > 0
      ? authoredSpeech.map((clip) => clip.sourceDurationMs)
      : undefined;
    return { id: scene.id, durationMs: scene.durationMs, subtitleCues: scene.subtitleCues, audioAssetVersionIds: speechIds,
      ...(speechDurations ? { audioDurationsMs: speechDurations } : {}) };
  }), new Map(document.assets.map((asset) => [asset.id, asset])), measuredAt);
}

export type DirectorRenderableStrategy = 'deterministic-layers' | 'living-poster';

export interface DirectorRenderLayer {
  id: string;
  label: string;
  imagePath: string;
  zIndex: number;
  visible?: boolean;
  depth: number;
  motion: EditorialLayerMotionKeyframe[];
}

export interface DirectorSceneHtmlLayer extends Omit<DirectorRenderLayer, 'imagePath'> {
  imageUrl: string;
}

export interface DirectorRenderScene {
  id: string;
  index: number;
  title: string;
  caption: string;
  subtitleCues?: DirectorRenderSubtitleCue[];
  durationMs: number;
  renderStrategy: DirectorRenderableStrategy;
  layers: DirectorRenderLayer[];
  camera: EditorialCameraKeyframe[];
  videoPath?: string;
  videoAssetVersionId?: string;
  videoJobId?: string;
  audioPath: string;
  /** Optional multi-track audio; when present this is the authoritative mix input. */
  audioClips?: DirectorRenderAudioClip[];
  layoutTemplate?: string;
  motionPreset?: string;
  subtitleStyle?: string;
}

export interface DirectorRenderAudioClip extends Omit<ResolvedProductionAudioClip, 'assetVersionId'> {
  assetVersionId: string;
}

export interface DirectorRenderSubtitleCue {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  tokens?: ProductionSubtitleToken[];
}

function sceneSubtitleCues(cues: readonly ProductionSubtitleCue[], startMs: number): DirectorRenderSubtitleCue[] {
  return cues.map((cue) => ({
    id: cue.id, text: cue.text, startMs: cue.startMs - startMs, endMs: cue.endMs - startMs,
    ...(cue.tokens && isSubtitleAlignmentValid(cue) ? { tokens: cue.tokens.map((token) => ({ ...token, startMs: token.startMs - startMs, endMs: token.endMs - startMs })) } : {}),
  }));
}

export interface DirectorRenderProbe {
  duration?: number;
  has_audio?: boolean;
  has_video?: boolean;
  has_nonblack_video?: boolean;
  width?: number;
  height?: number;
}

export function directorCanvasForRatio(ratio: string): { width: number; height: number } {
  if (ratio === '9:16') return { width: 1080, height: 1920 };
  if (ratio === '1:1') return { width: 1440, height: 1440 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function buildDirectorRenderScenes(
  document: EditorialCollagePipelineData | MotionComicPipelineData,
  explicitEpisodeId?: string,
  scope?: { shotIds?: readonly string[] },
): DirectorRenderScene[] {
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const jobs = new Map(document.providerJobs.map((job) => [job.id, job]));
  const issues: string[] = [];
  const scenes: DirectorRenderScene[] = [];

  const resolveAssetPath = (
    assetId: string | undefined,
    kind: 'image' | 'video' | 'audio',
    label: string,
  ): string => {
    if (!assetId) {
      issues.push(`${label}缺少已选${kind === 'image' ? '画面' : kind === 'video' ? '视频' : '旁白'}`);
      return '';
    }
    const asset = assets.get(assetId);
    if (!asset) {
      issues.push(`${label}引用的资产不存在`);
      return '';
    }
    if (asset.kind !== kind) {
      issues.push(`${label}引用的资产类型错误`);
      return '';
    }
    if (!asset.localPath?.trim()) {
      issues.push(`${label}引用的${kind === 'image' ? '画面' : kind === 'video' ? '视频' : '旁白'}没有本地文件`);
      return '';
    }
    return asset.localPath;
  };

  if (document.workflowKind === 'editorial-collage') {
    const expectedTimeline = rebuildEditorialTimeline(document).timeline;
    if (document.timeline) issues.push(...validateProductionAudioTimeline(document.timeline, assets).map((issue) => issue.message));
    if (!document.timeline || JSON.stringify(document.timeline) !== JSON.stringify(expectedTimeline)) {
      issues.push('VOX 时间线与当前镜头策略或资产版本不一致，请保存项目后重试');
    }

    const selectedShotIds = scope?.shotIds ? new Set(scope.shotIds) : undefined;
    document.beats.forEach((beat) => beat.shots.forEach((shot) => {
      if (selectedShotIds && !selectedShotIds.has(shot.id)) return;
      const index = scenes.length + 1;
      const shotLabel = `镜头 ${index}`;
      const subtitleCues = sceneSubtitleCues(shot.subtitleCueIds.flatMap((cueId) => beat.subtitleCues.find((cue) => cue.id === cueId) ?? []), document.timeline?.clips.find((clip) => clip.shotId === shot.id)?.startMs ?? beat.startMs);
      const caption = shot.subtitleCueIds
        .map((cueId) => beat.subtitleCues.find((cue) => cue.id === cueId)?.text)
        .filter((text): text is string => Boolean(text))
        .join(' ') || (beat.subtitleCues.length === 0 ? beat.narration : '');
      const authoredAudio = productionAudioClipsForShot(document.timeline, shot);
      const audioClips = resolveProductionAudioClips(
        authoredAudio?.map((clip) => ({
          ...clip,
          startMs: clip.startMs - (document.timeline?.clips.find((timelineClip) => timelineClip.shotId === shot.id)?.startMs ?? beat.startMs),
        })),
        assets,
        shot.durationMs,
      );
      const audioPath = authoredAudio !== undefined ? '' : resolveAssetPath(shot.voiceAssetVersionId, 'audio', shotLabel);

      if (shot.renderStrategy === 'hybrid') {
        issues.push(`${shotLabel}仍使用未完成的混合渲染模式，请改用本地关键帧运动或 AI 动态海报`);
        return;
      }

      if (shot.renderStrategy === 'living-poster') {
        const videoPath = resolveAssetPath(shot.videoAssetVersionId, 'video', shotLabel);
        const videoAsset = shot.videoAssetVersionId ? assets.get(shot.videoAssetVersionId) : undefined;
        const videoJob = shot.videoJobId ? jobs.get(shot.videoJobId) : undefined;
        if (!shot.videoJobId || !videoJob) issues.push(`${shotLabel}缺少 AI 动态海报任务`);
        else if (videoJob.nodeId !== shot.id || videoJob.capability !== 'image-to-video') issues.push(`${shotLabel}的 AI 视频任务归属或能力错误`);
        else if (videoJob.status !== 'completed') issues.push(`${shotLabel}的 AI 动态海报任务尚未成功完成`);
        if (videoAsset && videoAsset.providerJobId !== shot.videoJobId) issues.push(`${shotLabel}的视频资产与生成任务不匹配`);
        scenes.push({
          id: shot.id,
          index,
          title: beat.title,
          caption,
          subtitleCues,
          durationMs: shot.durationMs,
          renderStrategy: 'living-poster',
          layers: [],
          camera: [],
          videoPath,
          videoAssetVersionId: shot.videoAssetVersionId,
          videoJobId: shot.videoJobId,
          audioPath,
          ...(authoredAudio !== undefined ? { audioClips } : {}),
          layoutTemplate: shot.layoutTemplate,
          motionPreset: shot.motionPreset,
          subtitleStyle: shot.subtitleStyle,
        });
        return;
      }

      const layers: DirectorRenderLayer[] = [];
      shot.layers.forEach((layer) => {
        if (layer.visible === false) return;
        if (!layer.assetVersionId) {
          if (layer.source !== 'svg') issues.push(`${shotLabel}的图层“${layer.label}”缺少图片资产`);
          return;
        }
        const imagePath = resolveAssetPath(layer.assetVersionId, 'image', `${shotLabel}图层“${layer.label}”`);
        if (!imagePath) return;
        layers.push({
          id: layer.id,
          label: layer.label,
          imagePath,
          zIndex: layer.zIndex,
          depth: layer.depth,
          motion: layer.motion.map((frame) => ({ ...frame })),
        });
      });
      if (layers.length === 0) issues.push(`${shotLabel}没有可渲染的本地图层`);
      if (shot.camera.length === 0) issues.push(`${shotLabel}缺少持久化相机关键帧`);
      scenes.push({
        id: shot.id,
        index,
        title: beat.title,
        caption,
        subtitleCues,
        durationMs: shot.durationMs,
        renderStrategy: 'deterministic-layers',
        layers,
        camera: shot.camera.map((frame) => ({ ...frame })),
        audioPath,
        ...(authoredAudio !== undefined ? { audioClips } : {}),
        layoutTemplate: shot.layoutTemplate,
        motionPreset: shot.motionPreset,
        subtitleStyle: shot.subtitleStyle,
      });
    }));
  } else {
    const episode = document.episodes.find((candidate) => candidate.id === (explicitEpisodeId ?? document.activeEpisodeId));
    if (!episode) throw new Error('DIRECTOR_RENDER_EPISODE_MISSING: AI 漫剧没有可渲染的集。');
    issues.push(...validateProductionAudioTimeline(episode.timeline, assets).map((issue) => issue.message));
    const selectedShotIds = scope?.shotIds ? new Set(scope.shotIds) : undefined;
    episode.scenes.forEach((scene) => scene.shots.forEach((shot) => {
      if (selectedShotIds && !selectedShotIds.has(shot.id)) return;
      const index = scenes.length + 1;
      const shotLabel = `镜头 ${index}`;
      const imagePath = resolveAssetPath(shot.firstFrameAssetVersionId, 'image', shotLabel);
      const subtitleCues = sceneSubtitleCues(shot.dialogueCueIds.flatMap((cueId) => episode.dialogueCues.find((cue) => cue.id === cueId) ?? []), episode.timeline.clips.find((clip) => clip.shotId === shot.id)?.startMs ?? 0);
      const dialogue = shot.dialogueCueIds.flatMap((cueId) => episode.dialogueCues.find((cue) => cue.id === cueId && cue.text.trim()) ?? []);
      if (!shot.voiceAssetVersionId) {
        for (const cue of dialogue) {
          if (!cue.voiceAssetVersionId || !episode.timeline.audioClips?.some((clip) => clip.id === `dialogue-clip-${cue.id}` && clip.shotId === shot.id && clip.assetVersionId === cue.voiceAssetVersionId)) issues.push(`${shotLabel}的对白“${cue.text.slice(0, 18)}”尚未生成独立配音`);
        }
      }
      const authoredAudio = productionAudioClipsForShot(episode.timeline, shot);
      const audioClips = resolveProductionAudioClips(
        authoredAudio?.map((clip) => ({
          ...clip,
          startMs: clip.startMs - (episode.timeline.clips.find((timelineClip) => timelineClip.shotId === shot.id)?.startMs ?? 0),
        })),
        assets,
        shot.durationMs,
      );
      const audioPath = authoredAudio !== undefined ? '' : resolveAssetPath(shot.voiceAssetVersionId, 'audio', shotLabel);
      const caption = shot.dialogueCueIds
        .map((cueId) => episode.dialogueCues.find((cue) => cue.id === cueId)?.text)
        .filter((text): text is string => Boolean(text))
        .join(' ');
      scenes.push({
        id: shot.id,
        index,
        title: shot.title || scene.title,
        caption,
        subtitleCues,
        durationMs: shot.durationMs,
        renderStrategy: 'deterministic-layers',
        layers: imagePath ? [{
          id: `${shot.id}-first-frame`,
          label: 'AI 漫剧首帧',
          imagePath,
          zIndex: 0,
          depth: 0,
          motion: [],
        }] : [],
        camera: [],
        audioPath,
        ...(authoredAudio !== undefined ? { audioClips } : {}),
        layoutTemplate: shot.layoutTemplate ?? '漫画分格 · 角色优先',
        motionPreset: shot.motionPreset,
        subtitleStyle: shot.subtitleStyle,
      });
    }));
  }

  if (issues.length > 0) throw new Error(`DIRECTOR_RENDER_PREFLIGHT_FAILED: ${[...new Set(issues)].join('；')}。`);
  if (scenes.length === 0) throw new Error('DIRECTOR_RENDER_EMPTY: 当前项目没有可渲染的镜头。');
  return scenes;
}

export function assertDirectorRenderProbe(
  probe: DirectorRenderProbe,
  expected: { durationMs: number; width: number; height: number; fps: number },
): number {
  if (probe.has_video !== true) throw new Error('DIRECTOR_RENDER_VIDEO_STREAM_MISSING: 成片缺少视频流。');
  if (probe.has_audio !== true) throw new Error('DIRECTOR_RENDER_AUDIO_STREAM_MISSING: 成片缺少音频流。');
  if (probe.width !== expected.width || probe.height !== expected.height) {
    throw new Error(`DIRECTOR_RENDER_SIZE_MISMATCH: 成片尺寸应为 ${expected.width}x${expected.height}，实际为 ${probe.width ?? 0}x${probe.height ?? 0}。`);
  }
  const durationMs = Math.round((probe.duration ?? 0) * 1000);
  const toleranceMs = Math.max(160, Math.ceil(2_000 / Math.max(1, expected.fps)));
  if (!Number.isFinite(durationMs) || durationMs <= 0 || Math.abs(durationMs - expected.durationMs) > toleranceMs) {
    throw new Error(`DIRECTOR_RENDER_DURATION_MISMATCH: 成片时长应为 ${(expected.durationMs / 1000).toFixed(2)} 秒，实际为 ${(durationMs / 1000).toFixed(2)} 秒。`);
  }
  if (probe.has_nonblack_video !== true) throw new Error('DIRECTOR_RENDER_BLACK_OUTPUT: 成片没有检测到有效非黑画面。');
  return durationMs;
}

/**
 * Build the hard export quality gates from the exact scenes and render result
 * that were consumed by the local renderer.  The renderer already performs
 * these checks while staging media; keeping the evidence here makes the
 * persisted report explain why an export passed (or why it must be rejected)
 * instead of recording three unconditional `passed` rows.
 */
export function evaluateDirectorQuality(
  document: DirectorRenderDocument,
  scenes: readonly DirectorRenderScene[],
  result: DirectorRenderResult,
  renderFingerprint: string,
  episodeId?: string,
): import('./production-workflow').ProductionQualityCheck[] {
  const checks: import('./production-workflow').ProductionQualityCheck[] = [];
  const assetIssues: string[] = [];
  const subtitleIssues: string[] = [];
  const dialogueIssues: string[] = [];
  const continuityIssues: string[] = [];
  const assetShotIds = new Set<string>();
  const subtitleShotIds = new Set<string>();
  const subtitleCueIds = new Set<string>();
  const dialogueShotIds = new Set<string>();
  let subtitleStartMs = Number.POSITIVE_INFINITY;
  let subtitleEndMs = 0;
  let sceneStartMs = 0;

  for (const scene of scenes) {
    const label = `镜头 ${scene.index}`;
    const hasAudio = scene.audioClips !== undefined ? scene.audioClips.every((clip) => Boolean(clip.path?.trim())) : Boolean(scene.audioPath?.trim());
    if (!hasAudio) { assetIssues.push(`${label}缺少有效音频资产`); assetShotIds.add(scene.id); }
    if (scene.renderStrategy === 'living-poster' ? !scene.videoPath?.trim() : scene.layers.length === 0) {
      assetIssues.push(`${label}缺少有效画面资产`); assetShotIds.add(scene.id);
    }
    if (!Number.isFinite(scene.durationMs) || scene.durationMs <= 0) { assetIssues.push(`${label}时长无效`); assetShotIds.add(scene.id); }

    const nonSpeechMix = scene.audioClips !== undefined && scene.audioClips.every((clip) => clip.trackType !== 'dialogue' && clip.trackType !== 'narration');
    if (!scene.caption.trim() && (scene.subtitleCues?.length ?? 0) === 0 && !nonSpeechMix) { dialogueIssues.push(`${label}没有对白或旁白文本`); dialogueShotIds.add(scene.id); }
    for (const cue of scene.subtitleCues ?? []) {
      if (!cue.text.trim()) { subtitleIssues.push(`${label}字幕 ${cue.id} 文本为空`); subtitleShotIds.add(scene.id); subtitleCueIds.add(cue.id); }
      if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs > scene.durationMs || cue.endMs <= cue.startMs) {
        subtitleIssues.push(`${label}字幕 ${cue.id} 越界或时长无效`); subtitleShotIds.add(scene.id); subtitleCueIds.add(cue.id);
        if (Number.isFinite(cue.startMs)) subtitleStartMs = Math.min(subtitleStartMs, sceneStartMs + Math.max(0, cue.startMs));
        if (Number.isFinite(cue.endMs)) subtitleEndMs = Math.max(subtitleEndMs, sceneStartMs + Math.max(0, cue.endMs));
      }
      let cursor = 0;
      for (const token of cue.tokens ?? []) {
        const position = cue.text.indexOf(token.text, cursor);
        if (position < cursor || token.startMs < cue.startMs || token.endMs > cue.endMs || token.endMs <= token.startMs) {
          subtitleIssues.push(`${label}字幕 ${cue.id} 词级时间或正文截断`); subtitleShotIds.add(scene.id); subtitleCueIds.add(cue.id);
          if (Number.isFinite(token.startMs)) subtitleStartMs = Math.min(subtitleStartMs, sceneStartMs + Math.max(0, token.startMs));
          if (Number.isFinite(token.endMs)) subtitleEndMs = Math.max(subtitleEndMs, sceneStartMs + Math.max(0, token.endMs));
          break;
        }
        cursor = position + token.text.length;
      }
    }
    sceneStartMs += Number.isFinite(scene.durationMs) ? Math.max(0, scene.durationMs) : 0;
  }

  // Resolve the rendered episode, even if navigation has changed the active one.
  const timeline = document.workflowKind === 'motion-comic'
    ? document.episodes.find((episode) => episode.id === (episodeId ?? document.activeEpisodeId))?.timeline
    : document.timeline;
  if (!timeline) {
    continuityIssues.push('时间线不存在，无法确认镜头切点连续性');
  } else {
    const clips = timeline.clips;
    let cursorMs = 0;
    const clipIds = new Set<string>();
    const shotIds = new Set<string>();
    scenes.forEach((scene, index) => {
      const clip = clips[index];
      if (!clip || clip.shotId !== scene.id) {
        continuityIssues.push(`镜头 ${scene.index} 没有对应的时间线片段`);
        return;
      }
      if (clipIds.has(clip.id) || shotIds.has(clip.shotId)) continuityIssues.push(`镜头 ${scene.index} 的时间线片段重复`);
      clipIds.add(clip.id); shotIds.add(clip.shotId);
      if (!Number.isFinite(clip.startMs) || clip.startMs < 0 || Math.abs(clip.startMs - cursorMs) > 1) continuityIssues.push(`镜头 ${scene.index} 切点不连续（应从 ${cursorMs}ms 开始，实际 ${clip.startMs}ms）`);
      if (!Number.isFinite(clip.durationMs) || clip.durationMs <= 0 || Math.abs(clip.durationMs - scene.durationMs) > 1) continuityIssues.push(`镜头 ${scene.index} 时间线时长与画面时长不一致`);
      cursorMs += scene.durationMs;
    });
    if (clips.length !== scenes.length) continuityIssues.push(`时间线片段数量 ${clips.length} 与镜头数量 ${scenes.length} 不一致`);
    if (!Number.isFinite(timeline.durationMs) || timeline.durationMs <= 0 || Math.abs(timeline.durationMs - cursorMs) > 1) continuityIssues.push(`时间线总时长不连续（应为 ${cursorMs}ms，实际 ${timeline.durationMs}ms）`);
    continuityIssues.push(...validateProductionAudioTimeline(timeline, new Map(document.assets.map((asset) => [asset.id, asset])))
      .map((issue) => `音频时间线 ${issue.path}：${issue.message}`));
  }

  checks.push({
    id: 'asset-integrity',
    label: '镜头画面、音频和视频资产完整且可定位',
    severity: 'blocking',
    status: assetIssues.length === 0 ? 'passed' : 'failed',
    ...(assetIssues.length ? { detail: assetIssues.join('；') } : {}),
    ...(assetIssues.length ? { recheckScope: { kind: 'asset', shotIds: [...assetShotIds] } satisfies ProductionQualityRecheckScope } : {}),
  });
  checks.push({
    id: 'timeline-continuity',
    label: '镜头切点与音视频时间线连续',
    severity: 'blocking',
    status: continuityIssues.length === 0 ? 'passed' : 'failed',
    ...(continuityIssues.length ? { detail: continuityIssues.join('；') } : {}),
    ...(continuityIssues.length ? { recheckScope: { kind: 'media', shotIds: scenes.map((scene) => scene.id) } satisfies ProductionQualityRecheckScope } : {}),
  });
  checks.push({
    id: 'subtitle-timing',
    label: '字幕没有越界、空文本或词级截断',
    severity: 'blocking',
    status: subtitleIssues.length === 0 ? 'passed' : 'failed',
    ...(subtitleIssues.length ? { detail: subtitleIssues.join('；') } : {}),
    ...(subtitleIssues.length ? { recheckScope: {
      kind: 'subtitle',
      shotIds: [...subtitleShotIds],
      cueIds: [...subtitleCueIds],
      ...(Number.isFinite(subtitleStartMs) ? { startMs: subtitleStartMs } : {}),
      ...(subtitleEndMs > 0 ? { endMs: subtitleEndMs } : {}),
    } satisfies ProductionQualityRecheckScope } : {}),
  });
  checks.push(...evaluateDirectorSubtitleLayout(scenes, result.subtitleLayout, { width: result.width, height: result.height }));
  checks.push({
    id: 'dialogue-coverage',
    label: '对白和旁白文本与镜头声音配置一致',
    severity: 'blocking',
    status: dialogueIssues.length === 0 ? 'passed' : 'failed',
    ...(dialogueIssues.length ? { detail: dialogueIssues.join('；') } : {}),
    ...(dialogueIssues.length ? { recheckScope: { kind: 'shot', shotIds: [...dialogueShotIds] } satisfies ProductionQualityRecheckScope } : {}),
  });

  const narrationAlignment = directorNarrationAlignment(document, scenes, episodeId);
  checks.push({
    id: 'narration-alignment',
    label: '实际旁白时长与字幕规划可对齐',
    severity: 'manual',
    status: narrationAlignment.status === 'failed' ? 'failed' : narrationAlignment.status === 'pending' ? 'pending' : 'passed',
    ...(narrationAlignment.status === 'failed' ? { detail: narrationAlignment.samples.filter((sample) => sample.status === 'mismatch').map((sample) => `${sample.shotId}：${sample.detail || '实测音频与规划时长不一致'}`).join('；') } : narrationAlignment.status === 'pending' ? { detail: '部分旁白资产缺少实测时长，当前语速仅能作为规划值。' } : {}),
  });

  const expectedDurationMs = scenes.reduce((sum, scene) => sum + Math.max(800, scene.durationMs), 0);
  const durationToleranceMs = Math.max(160, Math.ceil(2_000 / 24));
  const expectedCanvas = directorCanvasForRatio(document.ratio);
  const mediaIssues = [
    !Number.isFinite(result.sizeBytes) || result.sizeBytes <= 0 ? '成片文件为空或大小无效' : '',
    result.width !== expectedCanvas.width || result.height !== expectedCanvas.height ? `成片尺寸与项目比例不一致（应为 ${expectedCanvas.width}x${expectedCanvas.height}，实际为 ${result.width}x${result.height}）` : '',
    !Number.isFinite(result.durationMs) || result.durationMs <= 0 || Math.abs(result.durationMs - expectedDurationMs) > durationToleranceMs ? `成片时长与时间线不一致（应为 ${expectedDurationMs}ms，实际为 ${result.durationMs}ms）` : '',
    result.hasAudio !== true ? '成片缺少音频流' : '',
    result.hasVideo !== true ? '成片缺少视频流' : '',
    result.hasNonBlackVideo !== true ? '成片没有有效非黑画面' : '',
  ].filter(Boolean);
  checks.push({
    id: 'media-output',
    label: '成片媒体可播放且时长、画面和音频有效',
    severity: 'blocking',
    status: mediaIssues.length === 0 ? 'passed' : 'failed',
    ...(mediaIssues.length ? { detail: mediaIssues.join('；') } : {}),
    ...(mediaIssues.length ? { recheckScope: { kind: 'media', shotIds: scenes.map((scene) => scene.id) } satisfies ProductionQualityRecheckScope } : {}),
  });
  const audioLevelIssues = [
    result.audioPeakDb !== undefined && result.audioPeakDb > -0.1 ? `音频峰值接近削顶（${result.audioPeakDb.toFixed(1)}dB）` : '',
    result.audioMeanVolumeDb !== undefined && result.audioMeanVolumeDb < -45 ? `音频平均电平过低（${result.audioMeanVolumeDb.toFixed(1)}dB）` : '',
    Number.isFinite(result.audioLufs) && (result.audioLufs! < DIRECTOR_AUDIO_TARGETS.integratedLufsMin || result.audioLufs! > DIRECTOR_AUDIO_TARGETS.integratedLufsMax)
      ? `整合响度超出 ${DIRECTOR_AUDIO_TARGETS.integratedLufsMin} 至 ${DIRECTOR_AUDIO_TARGETS.integratedLufsMax} LUFS（${result.audioLufs!.toFixed(1)} LUFS）` : '',
    Number.isFinite(result.audioTruePeakDb) && result.audioTruePeakDb! > DIRECTOR_AUDIO_TARGETS.truePeakMaxDbtp
      ? `真峰值超过 ${DIRECTOR_AUDIO_TARGETS.truePeakMaxDbtp} dBTP（${result.audioTruePeakDb!.toFixed(1)} dBTP）` : '',
  ].filter(Boolean);
  const silentAudio = result.audioIsSilent === true && result.audioLufs === undefined && result.audioTruePeakDb === undefined;
  const authoredSilence = scenes.length > 0 && scenes.every((scene) => scene.audioClips !== undefined
    && scene.audioClips.every((clip) => clip.muted || clip.sourceDurationMs === 0));
  const audioMetricsValid = Number.isFinite(result.audioMeanVolumeDb) && Number.isFinite(result.audioPeakDb)
    && (silentAudio || (result.audioIsSilent !== true && Number.isFinite(result.audioLufs) && Number.isFinite(result.audioTruePeakDb)));
  const audioAnalysisStatus = result.audioQualityStatus === 'ok' && audioMetricsValid
    ? (silentAudio ? authoredSilence ? 'passed' : 'failed' : audioLevelIssues.length === 0 ? 'passed' : 'failed')
    : result.audioQualityStatus === 'failed' || result.audioQualityStatus === 'ok'
      ? 'failed'
      : 'pending';
  const audioAnalysisDetail = result.audioQualityStatus === 'failed' || (result.audioQualityStatus === 'ok' && !audioMetricsValid)
    ? `响度探测失败：${result.audioQualityError || '未返回完整指标'}`
    : result.audioQualityStatus === 'unavailable'
      ? `响度探测不可用：${result.audioQualityError || '媒体没有音频流'}`
      : result.audioQualityStatus === undefined
        ? '尚未获得响度探测结果'
        : silentAudio ? authoredSilence ? '成片为全静音，与镜头静音设置一致；LUFS 和真峰值不适用' : '成片音轨为全静音，但镜头仍配置了可听音频，请复核源素材与混音'
        : audioLevelIssues.join('；') || `整合响度位于 ${DIRECTOR_AUDIO_TARGETS.integratedLufsMin} 至 ${DIRECTOR_AUDIO_TARGETS.integratedLufsMax} LUFS，真峰值不高于 ${DIRECTOR_AUDIO_TARGETS.truePeakMaxDbtp} dBTP`;
  checks.push({
    id: 'audio-level',
    label: '音频响度、真峰值与静音设置',
    severity: 'warning',
    status: audioAnalysisStatus,
    detail: audioAnalysisDetail,
    ...(audioAnalysisStatus !== 'passed' ? { recheckScope: { kind: 'audio', shotIds: scenes.map((scene) => scene.id) } satisfies ProductionQualityRecheckScope } : {}),
  });
  const blackMetricsValid = Array.isArray(result.blackIntervalsMs) && result.blackIntervalsMs.every((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.startMs >= 0 && interval.endMs > interval.startMs && interval.endMs <= result.durationMs);
  const blackIntervals = (result.blackIntervalsMs ?? []).filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.startMs >= 0 && interval.endMs > interval.startMs && interval.endMs <= result.durationMs).slice().sort((left, right) => left.startMs - right.startMs);
  const longBlackIntervals = blackIntervals.filter((interval) => interval.endMs - interval.startMs >= 500);
  const blackAnalysisStatus = result.blackDetectionStatus === 'ok' && blackMetricsValid
    ? (longBlackIntervals.length === 0 ? 'passed' : 'failed')
    : result.blackDetectionStatus === 'failed' || result.blackDetectionStatus === 'ok'
      ? 'failed'
      : 'pending';
  const blackAnalysisDetail = result.blackDetectionStatus === 'failed' || (result.blackDetectionStatus === 'ok' && !blackMetricsValid)
    ? `黑帧探测失败：${result.blackDetectionError || '未返回探测结果'}`
    : result.blackDetectionStatus === 'unavailable'
      ? `黑帧探测不可用：${result.blackDetectionError || '媒体没有视频流'}`
      : result.blackDetectionStatus === undefined
        ? '尚未获得黑帧探测结果'
        : longBlackIntervals.map((interval) => `${interval.startMs}-${interval.endMs}ms`).join('、');
  checks.push({
    id: 'black-intervals',
    label: '成片没有未解释的长黑帧区间',
    severity: 'warning',
    status: blackAnalysisStatus,
    ...(blackAnalysisStatus !== 'passed' ? { detail: blackAnalysisDetail } : {}),
    ...(blackAnalysisStatus !== 'passed' ? { recheckScope: { kind: 'media', ...(longBlackIntervals.length ? { startMs: longBlackIntervals[0].startMs, endMs: longBlackIntervals.at(-1)!.endMs } : {}), } satisfies ProductionQualityRecheckScope } : {}),
  });

  checks.push(evaluateDirectorVisualContinuity(scenes, result.visualContinuity));

  const outputPath = result.outputPath.replaceAll('\\', '/');
  const outputLocationValid = /(?:^|\/)director-renders\/[^/]+\/exports\/[^/]+\.mp4$/u.test(outputPath);
  checks.push({
    id: 'artifact-location',
    label: '成片写入本次渲染专属目录，旧产物可定位',
    severity: 'blocking',
    status: outputLocationValid ? 'passed' : 'failed',
    ...(outputLocationValid ? {} : { detail: `成片路径不在 director-renders/<render>/exports 下：${result.outputPath}` }),
    ...(!outputLocationValid ? { recheckScope: { kind: 'project' } satisfies ProductionQualityRecheckScope } : {}),
  });

  const currentFingerprint = directorDocumentRenderFingerprint(document, episodeId);
  checks.push({
    id: 'render-freshness',
    label: '成片输入指纹与当前项目一致，旧产物不会被误选',
    severity: 'blocking',
    status: currentFingerprint === renderFingerprint ? 'passed' : 'failed',
    ...(currentFingerprint !== renderFingerprint ? { detail: `当前指纹 ${currentFingerprint} 与成片指纹 ${renderFingerprint} 不一致` } : {}),
    ...(currentFingerprint !== renderFingerprint ? { recheckScope: { kind: 'project' } satisfies ProductionQualityRecheckScope } : {}),
  });
  return checks;
}

export function buildDirectorSceneHtml(input: {
  title: string;
  caption: string;
  subtitleCues?: readonly DirectorRenderSubtitleCue[];
  imageUrl?: string;
  layers?: readonly DirectorSceneHtmlLayer[];
  camera?: readonly EditorialCameraKeyframe[];
  videoUrl?: string;
  renderStrategy?: DirectorRenderableStrategy;
  durationMs: number;
  modeLabel: string;
  index: number;
  layoutTemplate?: string;
  motionPreset?: string;
  subtitleStyle?: string;
}): string {
  const durationSeconds = Math.max(0.8, input.durationMs / 1000);
  const title = escapeHtml(input.title);
  const caption = escapeHtml(input.caption);
  const modeLabel = escapeHtml(input.modeLabel);
  const shotIndex = String(input.index).padStart(2, '0');
  const layoutClass = directorSceneLayoutClass(input.layoutTemplate);
  const subtitleClass = directorSceneSubtitleClass(input.subtitleStyle);
  const subtitleMarkup = input.subtitleCues === undefined ? (input.caption.trim() ? `<div class="caption ${subtitleClass}">${caption}</div>` : '') : input.subtitleCues.map((cue) => {
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs > input.durationMs || cue.endMs <= cue.startMs) throw new Error('DIRECTOR_RENDER_SUBTITLE_RANGE: 字幕时间超出镜头范围。');
    let cursor = 0;
    const text = (cue.tokens ?? []).map((token) => {
      const position = cue.text.indexOf(token.text, cursor);
      if (position < cursor || token.startMs < cue.startMs || token.endMs > cue.endMs || token.endMs <= token.startMs) throw new Error('DIRECTOR_RENDER_SUBTITLE_TOKEN: 字幕词级时间或正文无效。');
      const prefix = escapeHtml(cue.text.slice(cursor, position));
      cursor = position + token.text.length;
      return `${prefix}<span data-word-start="${token.startMs}" data-word-end="${token.endMs}">${escapeHtml(token.text)}</span>`;
    }).join('') + escapeHtml(cue.text.slice(cursor));
    return `<div class="caption ${subtitleClass}" data-cue-id="${escapeHtml(cue.id)}" data-cue-start="${cue.startMs}" data-cue-end="${cue.endMs}" hidden>${text}</div>`;
  }).join('');
  const motionPreset = input.motionPreset ?? '平移 + 缓慢推进';
  const renderStrategy = input.renderStrategy ?? (input.videoUrl ? 'living-poster' : 'deterministic-layers');
  if (renderStrategy === 'living-poster' && !input.videoUrl) throw new Error('DIRECTOR_RENDER_VIDEO_REQUIRED: AI 动态海报镜头缺少视频。');

  const fallbackLayers: DirectorSceneHtmlLayer[] = input.imageUrl ? [{ id: 'scene-image', label: '镜头画面', imageUrl: input.imageUrl, zIndex: 0, depth: 0, motion: [] }] : [];
  const layers = renderStrategy === 'deterministic-layers' ? (input.layers ?? fallbackLayers).filter((layer) => layer.visible !== false) : [];
  if (renderStrategy === 'deterministic-layers' && layers.length === 0) throw new Error('DIRECTOR_RENDER_IMAGE_REQUIRED: 本地关键帧镜头缺少图片图层。');
  const normalizedLayers = layers.map((layer, index) => ({
    index,
    zIndex: finiteNumber(layer.zIndex, index),
    depth: finiteNumber(layer.depth, 0),
    motion: normalizeLayerFrames(layer.motion, input.durationMs),
  }));
  const normalizedCamera = renderStrategy === 'living-poster'
    ? [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }]
    : normalizeCameraFrames(input.camera ?? [], input.durationMs, motionPreset);
  const layerMarkup = layers.map((layer, index) => `<img class="scene-layer" data-layer-index="${index}" src="${escapeHtml(layer.imageUrl)}" alt="" />`).join('');
  const mediaMarkup = renderStrategy === 'living-poster'
    ? `<video id="scene-video" src="${escapeHtml(input.videoUrl ?? '')}" muted playsinline preload="auto"></video>`
    : layerMarkup;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src file: data: blob:; style-src 'nonce-director-render'; script-src 'nonce-director-render';" />
  <style nonce="director-render">
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#090b0c;color:#fff;font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif}
    .frame{position:relative;width:100%;height:100%;overflow:hidden;background:#090b0c}
    .frame.comic{inset:2%;width:96%;height:96%;border:8px solid #fff;box-sizing:border-box}
    .scene-stage{position:absolute;inset:-2%;overflow:hidden;transform-origin:center center}
    .scene-layer,#scene-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center center;will-change:transform,opacity}
    #scene-video{background:#090b0c}
    .shade{position:absolute;inset:0;background:rgba(6,8,9,.16);box-shadow:inset 0 -260px 160px rgba(6,8,9,.7)}
    .meta{position:absolute;top:4.2%;left:4.2%;display:flex;gap:12px;align-items:center;font-size:22px;font-weight:700;text-shadow:0 2px 8px #000}
    .meta b{color:#ff6255}
    .copy{position:absolute;left:8%;right:8%;bottom:6%;display:grid;gap:16px}
    .title{grid-area:1/1;min-width:0;font-size:clamp(36px,3.96vw,76px);font-weight:800;line-height:1.12;text-align:center;text-shadow:0 3px 14px #000;overflow-wrap:anywhere;white-space:pre-wrap}
    .frame.documentary .title{font-size:clamp(30px,3.02vw,58px);text-align:left;margin-right:24%}
    .frame.comic .title{text-align:left}
    .caption{grid-area:2/1;min-width:0;align-self:end;padding:.6em .9em;font-size:clamp(28px,2.5vw,48px);font-weight:650;line-height:1.35;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere}
    .caption[hidden]{display:block;visibility:hidden}
    .caption.backplate{background:rgba(7,9,10,.82);text-shadow:0 2px 5px #000}
    .caption.outline{background:transparent;color:#fff;text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000,0 3px 8px #000}
    .caption [data-active-word="true"]{color:#ff6255}
  </style>
</head>
<body>
  <div class="frame ${layoutClass}" data-render-strategy="${renderStrategy}">
    <div id="scene-stage" class="scene-stage">${mediaMarkup}</div>
    <div class="shade"></div>
    <div class="meta"><b>${modeLabel}</b><span>SHOT ${shotIndex}</span></div>
    <div class="copy"><div class="title">${title}</div>${subtitleMarkup}</div>
  </div>
  <script nonce="director-render">
    (() => {
      const duration = ${JSON.stringify(durationSeconds)};
      const durationMs = ${JSON.stringify(Math.max(1, input.durationMs))};
      const layers = ${safeScriptJson(normalizedLayers)};
      const camera = ${safeScriptJson(normalizedCamera)};
      const stage = document.getElementById('scene-stage');
      const video = document.getElementById('scene-video');
      const subtitles = Array.from(document.querySelectorAll('[data-cue-start]'));
      let current = 0;
      let playing = false;
      let startedAt = 0;
      let frame = 0;
      window.__ready = false;
      window.__mediaError = '';

      const interpolate = (from, to, progress) => from + (to - from) * progress;
      const frameWindow = (frames, atMs, fallback) => {
        if (!frames.length) return [fallback, fallback, 0];
        const first = frames[0];
        if (atMs < first.atMs) return [first, first, 0];
        for (let index = 1; index < frames.length; index += 1) {
          const next = frames[index];
          if (atMs < next.atMs) {
            const previous = frames[index - 1];
            const span = next.atMs - previous.atMs;
            return [previous, next, span > 0 ? Math.min(1, Math.max(0, (atMs - previous.atMs) / span)) : 1];
          }
        }
        const last = frames[frames.length - 1];
        return [last, last, 0];
      };
      const applyFrame = (seconds) => {
        const atMs = Math.max(0, Math.min(durationMs, seconds * 1000));
        for (const cue of subtitles) {
          cue.hidden = atMs < Number(cue.dataset.cueStart) || atMs >= Number(cue.dataset.cueEnd);
          for (const word of cue.querySelectorAll('[data-word-start]')) word.dataset.activeWord = String(atMs >= Number(word.dataset.wordStart) && atMs < Number(word.dataset.wordEnd));
        }
        const cameraFallback = { atMs: 0, x: .5, y: .5, zoom: 1 };
        const [cameraFrom, cameraTo, cameraProgress] = frameWindow(camera, atMs, cameraFallback);
        const cameraX = interpolate(cameraFrom.x, cameraTo.x, cameraProgress);
        const cameraY = interpolate(cameraFrom.y, cameraTo.y, cameraProgress);
        const cameraZoom = interpolate(cameraFrom.zoom, cameraTo.zoom, cameraProgress);
        stage.style.transform = 'translate3d(' + ((.5 - cameraX) * 100) + '%, ' + ((.5 - cameraY) * 100) + '%, 0) scale(' + cameraZoom + ')';
        for (const layer of layers) {
          const element = document.querySelector('[data-layer-index="' + layer.index + '"]');
          if (!element) continue;
          const fallback = { atMs: 0, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1 };
          const [from, to, progress] = frameWindow(layer.motion, atMs, fallback);
          const x = interpolate(from.x, to.x, progress);
          const y = interpolate(from.y, to.y, progress);
          const scale = interpolate(from.scale, to.scale, progress);
          const rotation = interpolate(from.rotation, to.rotation, progress);
          element.style.zIndex = String(layer.zIndex);
          element.style.opacity = String(interpolate(from.opacity, to.opacity, progress));
          element.style.transform = 'translate3d(' + (((x - .5) * 100) + layer.depth * 3) + '%, ' + (((y - .5) * 100) + layer.depth * 1.5) + '%, 0) scale(' + scale + ') rotate(' + rotation + 'deg)';
        }
      };
      const seekVideo = (seconds) => {
        if (!video || video.readyState < 1) return Promise.resolve();
        const maximum = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - .001) : duration;
        const target = Math.max(0, Math.min(maximum, seconds));
        if (Math.abs(video.currentTime - target) < .002) return Promise.resolve();
        return new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
            error ? reject(error) : resolve();
          };
          const onSeeked = () => finish();
          const onError = () => finish(new Error('Director scene video failed while seeking.'));
          const timeout = setTimeout(() => finish(new Error('Director scene video seek timed out.')), 10000);
          video.addEventListener('seeked', onSeeked, { once: true });
          video.addEventListener('error', onError, { once: true });
          try { video.currentTime = target; } catch (error) { finish(error); }
        });
      };
      const seek = (time) => {
        current = Math.max(0, Math.min(duration, Number(time) || 0));
        applyFrame(current);
        return seekVideo(current);
      };
      const tick = (now) => {
        if (!playing) return;
        if (video) current = Math.min(duration, Math.max(0, video.currentTime));
        else current = Math.min(duration, Math.max(0, (now - startedAt) / 1000));
        applyFrame(current);
        if (current >= duration || (video && video.ended)) { playing = false; return; }
        frame = requestAnimationFrame(tick);
      };
      const play = () => {
        cancelAnimationFrame(frame);
        playing = true;
        startedAt = performance.now() - current * 1000;
        if (video) void video.play().catch(() => undefined);
        frame = requestAnimationFrame(tick);
      };
      const pause = () => {
        playing = false;
        cancelAnimationFrame(frame);
        if (video) { current = Math.min(duration, Math.max(0, video.currentTime)); video.pause(); }
        applyFrame(current);
      };
      window.__tl = { seek, duration: () => duration, play, pause };
      const markReady = () => {
        video?.pause();
        current = 0;
        applyFrame(0);
        window.__ready = true;
      };
      if (!video) markReady();
      else if (video.readyState >= 2) markReady();
      else {
        video.addEventListener('loadeddata', markReady, { once: true });
        video.addEventListener('error', () => { window.__mediaError = 'Director scene video failed to load.'; }, { once: true });
        video.load();
      }
    })();
  </script>
</body>
</html>`;
}

function normalizeLayerFrames(frames: readonly EditorialLayerMotionKeyframe[], durationMs: number): EditorialLayerMotionKeyframe[] {
  if (frames.length === 0) return [{ atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }];
  return [...frames]
    .sort((left, right) => left.atMs - right.atMs)
    .map((frame) => ({
      atMs: clamp(finiteNumber(frame.atMs, 0), 0, Math.max(1, durationMs)),
      x: finiteNumber(frame.x, 0.5),
      y: finiteNumber(frame.y, 0.5),
      scale: finiteNumber(frame.scale, 1),
      rotation: finiteNumber(frame.rotation, 0),
      opacity: clamp(finiteNumber(frame.opacity, 1), 0, 1),
    }));
}

function normalizeCameraFrames(frames: readonly EditorialCameraKeyframe[], durationMs: number, motionPreset: string): EditorialCameraKeyframe[] {
  if (frames.length > 0) {
    return [...frames]
      .sort((left, right) => left.atMs - right.atMs)
      .map((frame) => ({
        atMs: clamp(finiteNumber(frame.atMs, 0), 0, Math.max(1, durationMs)),
        x: finiteNumber(frame.x, 0.5),
        y: finiteNumber(frame.y, 0.5),
        zoom: finiteNumber(frame.zoom, 1),
      }));
  }
  const end: EditorialCameraKeyframe = { atMs: Math.max(1, durationMs), x: 0.5, y: 0.5, zoom: 1 };
  if (motionPreset === '平移 + 缓慢推进') Object.assign(end, { x: 0.49, y: 0.495, zoom: 1.06 });
  if (motionPreset === '轻微视差') Object.assign(end, { x: 0.505, y: 0.495, zoom: 1.03 });
  return [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }, end];
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[character] ?? character);
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
