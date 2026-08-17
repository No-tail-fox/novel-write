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
  detail?: string;
}

export interface ProductionQualityReport {
  id: string;
  workflowKind: ProductionWorkflowKind;
  stage: string;
  status: ProductionQualityStatus;
  checks: ProductionQualityCheck[];
  createdAt: string;
}

export interface ProductionTimeline {
  durationMs: number;
  clips: ProductionTimelineClip[];
  audioAssetVersionIds: string[];
}

export interface ProductionSubtitleCue {
  id: string;
  shotId?: string;
  sourceId?: string;
  startMs: number;
  endMs: number;
  text: string;
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
