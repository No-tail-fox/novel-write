/**
 * Shared contracts for media workflows that outgrow the legacy Task shape.
 * Workflow-specific documents should reference these IDs instead of embedding
 * provider payloads or renderer-specific fields in Task.
 */

export const PRODUCTION_WORKFLOW_KINDS = [
  'standard',
  'html-video',
  'editorial-collage',
  'motion-comic',
] as const;

export type ProductionWorkflowKind = (typeof PRODUCTION_WORKFLOW_KINDS)[number];

export type ProductionJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ProductionAssetKind = 'image' | 'video' | 'audio' | 'font' | 'data' | 'document';
export type ProductionQualityStatus = 'pending' | 'passed' | 'failed' | 'waived';

export interface ProductionAssetVersion {
  id: string;
  assetId: string;
  kind: ProductionAssetKind;
  uri?: string;
  localPath?: string;
  sha256?: string;
  prompt?: string;
  providerJobId?: string;
  provider?: string;
  model?: string;
  license?: string;
  createdAt: string;
  selected?: boolean;
  pinned?: boolean;
  /** Render scope for derived assets. Motion-comic assets are episode-owned. */
  episodeId?: string;
  /** Fingerprint of the exact inputs consumed by a deterministic render. */
  renderFingerprint?: string;
  /** Measured media duration for audio/video assets, in milliseconds. */
  durationMs?: number;
}

export interface ProductionProviderJob {
  id: string;
  workflowKind: ProductionWorkflowKind;
  nodeId: string;
  providerId: string;
  model: string;
  capability: string;
  status: ProductionJobStatus;
  inputHash: string;
  idempotencyKey: string;
  estimatedCost: number;
  actualCost?: number;
  attempt: number;
  remoteTaskId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  episodeId?: string;
  renderFingerprint?: string;
}

/**
 * Resolve the authoritative provider job for one logical target. Provider
 * history is append-only, so a completed/failed attempt must not win over a
 * newer running retry simply because it happens to be present in the list.
 */
export function latestProductionProviderJob(
  jobs: readonly ProductionProviderJob[],
  nodeId: string,
  capability: string,
  episodeId?: string,
): ProductionProviderJob | undefined {
  let latest: ProductionProviderJob | undefined;
  let latestIndex = -1;
  jobs.forEach((job, index) => {
    if (job.nodeId !== nodeId || job.capability !== capability) return;
    if (episodeId !== undefined && job.episodeId !== episodeId) return;
    if (!latest || compareProviderJobOrder(job, latest) > 0 || (compareProviderJobOrder(job, latest) === 0 && index > latestIndex)) {
      latest = job;
      latestIndex = index;
    }
  });
  return latest;
}

function compareProviderJobOrder(left: ProductionProviderJob, right: ProductionProviderJob): number {
  if (left.attempt !== right.attempt) return left.attempt - right.attempt;
  const leftUpdated = Date.parse(left.updatedAt) || 0;
  const rightUpdated = Date.parse(right.updatedAt) || 0;
  if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated;
  const leftCreated = Date.parse(left.createdAt) || 0;
  const rightCreated = Date.parse(right.createdAt) || 0;
  return leftCreated - rightCreated;
}

export interface ProductionTimelineClip {
  id: string;
  shotId: string;
  startMs: number;
  durationMs: number;
  assetVersionIds: string[];
  subtitleCueIds: string[];
  source: 'deterministic' | 'ai-video' | 'local' | 'mixed';
}

export interface ProductionQualityCheck {
  id: string;
  label: string;
  status: ProductionQualityStatus;
  /** Gate class used by the review surface to separate blockers from follow-up review. */
  severity?: 'blocking' | 'warning' | 'manual';
  detail?: string;
  /** Exact authored scope that must be checked again after a fix. */
  recheckScope?: ProductionQualityRecheckScope;
}

export interface ProductionQualityRecheckScope {
  kind: 'project' | 'shot' | 'asset' | 'subtitle' | 'audio' | 'media';
  shotIds?: string[];
  assetVersionIds?: string[];
  cueIds?: string[];
  startMs?: number;
  endMs?: number;
}

export interface ProductionQualityManualReview {
  reportId: string;
  renderFingerprint: string;
  scope: ProductionQualityRecheckScope;
  confirmedAt: string;
}

export interface ProductionQualityReport {
  id: string;
  workflowKind: ProductionWorkflowKind;
  stage: string;
  providerJobId?: string;
  episodeId?: string;
  renderFingerprint?: string;
  manualReview?: ProductionQualityManualReview;
  status: ProductionQualityStatus;
  checks: ProductionQualityCheck[];
  /** Machine-readable media evidence retained with the review report. */
  evidence?: {
    subtitleLayout?: import('./production-subtitle-layout').ProductionSubtitleLayoutEvidence;
    audioMeanVolumeDb?: number;
    audioPeakDb?: number;
    audioLufs?: number;
    audioTruePeakDb?: number;
    /** True only when the completed media probe measures zero signal. */
    audioIsSilent?: boolean;
    blackIntervalsMs?: Array<{ startMs: number; endMs: number }>;
    visualContinuity?: import('./production-visual-continuity').ProductionVisualContinuityEvidence;
    audioQualityStatus?: 'ok' | 'failed' | 'unavailable';
    audioQualityError?: string;
    blackDetectionStatus?: 'ok' | 'failed' | 'unavailable';
    blackDetectionError?: string;
    narrationAlignment?: import('./production-audio-alignment').ProductionNarrationAlignmentEvidence;
  };
  createdAt: string;
}

export interface ProductionTimeline {
  durationMs: number;
  clips: ProductionTimelineClip[];
  audioAssetVersionIds: string[];
  /** Optional non-destructive multi-track audio edits. */
  audioClips?: import('./production-audio').ProductionAudioClip[];
}

/**
 * The source of a word-level subtitle alignment.
 *
 * `estimated` is intentionally explicit: a timeline created by distributing
 * words over a cue must never look like a provider/Whisper transcript.
 */
export type ProductionSubtitleAlignmentSource = 'provider' | 'whisper' | 'manual' | 'estimated';

/** A single word/token in a subtitle cue's optional fine-grained timeline. */
export interface ProductionSubtitleToken {
  /** Stable token id when a provider supplies one. */
  id?: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface ProductionSubtitleCue {
  id: string;
  shotId?: string;
  sourceId?: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Optional word-level timeline. */
  tokens?: ProductionSubtitleToken[];
  /** Provider/Whisper/manual alignments are distinct from estimated fallback. */
  alignmentSource?: ProductionSubtitleAlignmentSource;
  /** Fingerprint of the exact cue text used for alignment. */
  textHash?: string;
  /** Audio asset/version consumed while producing the alignment. */
  audioAssetVersionId?: string;
  /** Voice identity and speed are alignment inputs because they alter timing. */
  voiceId?: string;
  voiceSpeed?: number;
  /** Optional style reference used by subtitle renderers. */
  styleRef?: string;
  /** Stable fingerprint of text, cue range, audio, voice and rate inputs. */
  alignmentFingerprint?: string;
}

export interface ProductionProjectionSource {
  taskId: string;
  taskType: 'standard' | 'html-video';
  readOnly: true;
  revision?: number;
  updatedAt?: string;
}

export interface ProductionDocumentBase {
  version: 1;
  id: string;
  workflowKind: ProductionWorkflowKind;
  title: string;
  ratio: '9:16' | '16:9' | '1:1' | '4:3';
  createdAt: string;
  updatedAt: string;
  assets: ProductionAssetVersion[];
  providerJobs: ProductionProviderJob[];
  timeline?: ProductionTimeline;
  qualityReports: ProductionQualityReport[];
}

export interface StandardWorkflowShotSpec {
  id: string;
  sceneId: number;
  title: string;
  prompt: string;
  durationMs: number;
  segmentIds: string[];
  visualAssetVersionIds: string[];
  narrationAssetVersionIds: string[];
  subtitleCueIds: string[];
}

export interface StandardWorkflowDocument extends ProductionDocumentBase {
  workflowKind: 'standard';
  source: ProductionProjectionSource & { taskType: 'standard' };
  shots: StandardWorkflowShotSpec[];
  subtitleCues: ProductionSubtitleCue[];
}

export type HtmlVideoDurationSource = 'composition' | 'voice' | 'pending';

export interface HtmlVideoWorkflowSceneSpec {
  id: string;
  sceneIndex: number;
  title: string;
  narration: string;
  captionTexts: string[];
  durationMs: number;
  durationSource: HtmlVideoDurationSource;
  layerAssetVersionIds: string[];
  compositionAssetVersionId?: string;
  subtitleCueIds: string[];
}

export interface HtmlVideoWorkflowDocument extends ProductionDocumentBase {
  workflowKind: 'html-video';
  source: ProductionProjectionSource & { taskType: 'html-video' };
  scenes: HtmlVideoWorkflowSceneSpec[];
  subtitleCues: ProductionSubtitleCue[];
}

/** The concrete motion-comic contract owns series-level Bibles and episode timelines. */
export type MotionComicCharacterVariant = import('./motion-comic').MotionComicCharacterLook;
export type MotionComicShotSpec = import('./motion-comic').MotionComicShot;
export type MotionComicWorkflowDocument = import('./motion-comic').MotionComicPipelineData;
