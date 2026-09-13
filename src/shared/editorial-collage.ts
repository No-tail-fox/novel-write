import { z } from 'zod';
import { productionNarrationAlignmentEvidenceSchema } from './production-audio-alignment';
import type { ProductionDocumentBase, ProductionSubtitleCue, ProductionTimeline } from './production-workflow';
import { productionSubtitleCueSchema, validatePersistedSubtitleCue } from './production-subtitle-schema';
import { productionSubtitleLayoutEvidenceSchema } from './production-subtitle-layout';
import { productionVisualContinuityEvidenceSchema } from './production-visual-continuity';
import { materializeProductionAudioClipsForShot, productionAudioFadeEnvelopeSchema, sliceProductionAudioClip, validateProductionAudioTimeline } from './production-audio';
import { hashSubtitleAlignment, invalidateSubtitleAlignment, isSubtitleAlignmentValid } from './audio-alignment';
import { EDITORIAL_MAX_DURATION_MS, planEditorialScript, type EditorialScriptDuration } from './editorial-script';
import { MAX_PRODUCTION_HISTORY_ITEMS } from './production-history';

export const EDITORIAL_COLLAGE_TASK_TYPE = 'editorial-collage' as const;
export const EDITORIAL_COLLAGE_PIPELINE_VERSION = 1 as const;

export const EDITORIAL_COLLAGE_RATIOS = ['9:16', '16:9', '1:1', '4:3'] as const;
export const EDITORIAL_COLLAGE_STAGES = [
  'draft',
  'script-approved',
  'style-approved',
  'assets',
  'rendering',
  'qa',
  'completed',
  'failed',
] as const;
export const EDITORIAL_RENDER_STRATEGIES = ['deterministic-layers', 'living-poster', 'hybrid'] as const;
export const EDITORIAL_LAYER_KINDS = ['background', 'subject', 'archival', 'map', 'label', 'shape', 'texture'] as const;
export const EDITORIAL_LAYER_SOURCES = ['generated-image', 'local-file', 'html', 'svg'] as const;

export const EDITORIAL_STYLE_PRESETS = [
  { id: 'archival-red', label: '档案红黑', prompt: 'archival paper collage, black ink, restrained red accent, documentary editorial layout' },
  { id: 'swiss-signal', label: '瑞士信号', prompt: 'Swiss editorial grid, bold geometric type blocks, high contrast photography and signal colors' },
  { id: 'museum-paper', label: '博物馆纸本', prompt: 'museum catalogue collage, aged paper, precise labels, quiet neutral photography' },
] as const;

export type EditorialCollageStage = (typeof EDITORIAL_COLLAGE_STAGES)[number];

export type EditorialRenderStrategy = (typeof EDITORIAL_RENDER_STRATEGIES)[number];
export type EditorialLayerKind = (typeof EDITORIAL_LAYER_KINDS)[number];
export type EditorialLayerSource = (typeof EDITORIAL_LAYER_SOURCES)[number];

export interface EditorialSubtitleCue extends ProductionSubtitleCue {}

export interface EditorialLayerMotionKeyframe {
  atMs: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface EditorialCameraKeyframe {
  atMs: number;
  x: number;
  y: number;
  zoom: number;
}

export interface EditorialCollageLayer {
  id: string;
  label: string;
  kind: EditorialLayerKind;
  source: EditorialLayerSource;
  zIndex: number;
  visible?: boolean;
  depth: number;
  prompt?: string;
  assetVersionId?: string;
  motion: EditorialLayerMotionKeyframe[];
}

export interface EditorialCollageShot {
  id: string;
  beatId: string;
  durationMs: number;
  renderStrategy: EditorialRenderStrategy;
  scenePrompt: string;
  motionPrompt: string;
  layers: EditorialCollageLayer[];
  camera: EditorialCameraKeyframe[];
  subtitleCueIds: string[];
  providerJobId?: string;
  videoAssetVersionId?: string;
  videoJobId?: string;
  voiceId?: string;
  voiceLabel?: string;
  voiceSpeed?: number;
  voiceAssetVersionId?: string;
  layoutTemplate?: '对比拼贴 · 纸张撕裂' | '纪录片 · 纯画面' | '漫画分格 · 角色优先';
  motionPreset?: '平移 + 缓慢推进' | '轻微视差' | '固定机位';
  subtitleStyle?: string;
  seed?: string;
  seedLocked?: boolean;
}

export interface EditorialCollageBeat {
  id: string;
  index: number;
  title: string;
  narration: string;
  startMs: number;
  durationMs: number;
  shots: EditorialCollageShot[];
  subtitleCues: EditorialSubtitleCue[];
}

export interface EditorialStyleCandidate {
  id: string;
  label: string;
  prompt: string;
  assetVersionId?: string;
  selected: boolean;
}

export interface EditorialCollagePipelineData extends Omit<ProductionDocumentBase, 'workflowKind' | 'timeline'> {
  version: 1;
  workflowKind: 'editorial-collage';
  /** Original authoring text retained so structural edits never lose content. */
  sourceText?: string;
  stage: EditorialCollageStage;
  styleCandidates: EditorialStyleCandidate[];
  selectedStyleId?: string;
  beats: EditorialCollageBeat[];
  estimatedCost: number;
  actualCost?: number;
  costApprovedAt?: string;
  /** A short explanation shown before any paid batch starts. */
  costSummary?: string;
  timeline?: ProductionDocumentBase['timeline'];
}

export interface EditorialCollageDraftInput {
  id: string;
  title: string;
  ratio?: EditorialCollagePipelineData['ratio'];
  now?: string;
}

export interface EditorialCollageCreateInput {
  title: string;
  sourceText: string;
  ratio?: EditorialCollagePipelineData['ratio'];
  durationMs?: EditorialCollageStarterDurationMs;
}

export interface EditorialCollageSaveInput {
  id: string;
  expectedUpdatedAt: string;
  document: EditorialCollagePipelineData;
}

export interface EditorialCollageValidationIssue {
  path: string;
  message: string;
}

const MAX_BEATS = 12;
const MAX_TOTAL_DURATION_MS = EDITORIAL_MAX_DURATION_MS;
const MAX_SHOT_DURATION_MS = 15_000;
const MAX_LAYERS_PER_SHOT = 6;
const MAX_TEXT = 1_000_000;
const MAX_ITEMS = 500;
export const EDITORIAL_STARTER_DURATIONS_MS = [15_000, 30_000, 60_000] as const;
export type EditorialCollageStarterDurationMs = EditorialScriptDuration;

const idSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.string().max(64).refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp.');
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const boundedText = (max = MAX_TEXT) => z.string().max(max);

const assetVersionSchema = z.object({
  id: idSchema,
  assetId: idSchema,
  kind: z.enum(['image', 'video', 'audio', 'font', 'data', 'document']),
  uri: boundedText(4096).optional(),
  localPath: boundedText(4096).optional(),
  sha256: z.string().max(128).optional(),
  prompt: boundedText().optional(),
  providerJobId: idSchema.optional(),
  provider: z.string().max(256).optional(),
  model: z.string().max(512).optional(),
  license: z.string().max(512).optional(),
  createdAt: timestampSchema,
  selected: z.boolean().optional(),
  pinned: z.boolean().optional(),
  episodeId: idSchema.optional(),
  renderFingerprint: z.string().max(256).optional(),
  durationMs: nonNegativeNumber.positive().optional(),
}).strict();

const providerJobSchema = z.object({
  id: idSchema,
  workflowKind: z.literal(EDITORIAL_COLLAGE_TASK_TYPE),
  nodeId: idSchema,
  providerId: idSchema,
  model: z.string().max(512),
  capability: z.string().max(256),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  inputHash: z.string().max(256),
  idempotencyKey: z.string().max(512),
  estimatedCost: nonNegativeNumber,
  actualCost: nonNegativeNumber.optional(),
  attempt: z.number().int().min(1).max(MAX_PRODUCTION_HISTORY_ITEMS),
  remoteTaskId: z.string().max(512).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  error: boundedText(65_536).optional(),
  episodeId: idSchema.optional(),
  renderFingerprint: z.string().max(256).optional(),
}).strict();

const subtitleCueSchema = productionSubtitleCueSchema;

const layerKeyframeSchema = z.object({
  atMs: nonNegativeNumber,
  x: finiteNumber.min(-10).max(10),
  y: finiteNumber.min(-10).max(10),
  scale: finiteNumber.min(0.01).max(20),
  rotation: finiteNumber.min(-3_600).max(3_600),
  opacity: finiteNumber.min(0).max(1),
}).strict();

const cameraKeyframeSchema = z.object({
  atMs: nonNegativeNumber,
  x: finiteNumber.min(-10).max(10),
  y: finiteNumber.min(-10).max(10),
  zoom: finiteNumber.min(0.01).max(20),
}).strict();

const layerSchema = z.object({
  id: idSchema,
  label: z.string().max(512),
  kind: z.enum(EDITORIAL_LAYER_KINDS),
  source: z.enum(EDITORIAL_LAYER_SOURCES),
  zIndex: z.number().int().min(-1_000).max(1_000),
  visible: z.boolean().optional(),
  depth: finiteNumber.min(-10).max(10),
  prompt: boundedText().optional(),
  assetVersionId: idSchema.optional(),
  motion: z.array(layerKeyframeSchema).max(100),
}).strict();

const shotSchema = z.object({
  id: idSchema,
  beatId: idSchema,
  durationMs: nonNegativeNumber,
  renderStrategy: z.enum(EDITORIAL_RENDER_STRATEGIES),
  scenePrompt: boundedText(),
  motionPrompt: boundedText(),
  layers: z.array(layerSchema).max(MAX_LAYERS_PER_SHOT),
  camera: z.array(cameraKeyframeSchema).max(100),
  subtitleCueIds: z.array(idSchema).max(100),
  providerJobId: idSchema.optional(),
  videoAssetVersionId: idSchema.optional(),
  videoJobId: idSchema.optional(),
  voiceId: z.string().max(512).optional(),
  voiceLabel: z.string().max(512).optional(),
  voiceSpeed: finiteNumber.min(0.5).max(2).optional(),
  voiceAssetVersionId: idSchema.optional(),
  layoutTemplate: z.enum(['对比拼贴 · 纸张撕裂', '纪录片 · 纯画面', '漫画分格 · 角色优先']).optional(),
  motionPreset: z.enum(['平移 + 缓慢推进', '轻微视差', '固定机位']).optional(),
  subtitleStyle: z.string().max(256).optional(),
  seed: z.string().max(128).optional(),
  seedLocked: z.boolean().optional(),
}).strict();

const beatSchema = z.object({
  id: idSchema,
  index: z.number().int().min(1).max(MAX_BEATS),
  title: z.string().max(512),
  narration: boundedText(),
  startMs: nonNegativeNumber,
  durationMs: nonNegativeNumber,
  shots: z.array(shotSchema).max(100),
  subtitleCues: z.array(subtitleCueSchema).max(200),
}).strict();

const styleCandidateSchema = z.object({
  id: idSchema,
  label: z.string().max(512),
  prompt: boundedText(),
  assetVersionId: idSchema.optional(),
  selected: z.boolean(),
}).strict();

const timelineSchema = z.object({
  durationMs: nonNegativeNumber,
  clips: z.array(z.object({
    id: idSchema,
    shotId: idSchema,
    startMs: nonNegativeNumber,
    durationMs: nonNegativeNumber,
    assetVersionIds: z.array(idSchema).max(MAX_ITEMS),
    subtitleCueIds: z.array(idSchema).max(MAX_ITEMS),
    source: z.enum(['deterministic', 'ai-video', 'local', 'mixed']),
  }).strict()).max(MAX_ITEMS),
  audioAssetVersionIds: z.array(idSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  audioClips: z.array(z.object({
    id: idSchema,
    assetVersionId: idSchema,
    shotId: idSchema.optional(),
    trackType: z.enum(['dialogue', 'narration', 'sfx', 'ambience', 'music', 'foley']),
    startMs: nonNegativeNumber,
    sourceStartMs: nonNegativeNumber.optional(),
    sourceDurationMs: nonNegativeNumber.optional(),
    sourceMediaDurationMs: nonNegativeNumber.optional(),
    durationMs: nonNegativeNumber.optional(),
    gainDb: z.number().min(-60).max(24).optional(),
    fadeInMs: nonNegativeNumber.optional(),
    fadeOutMs: nonNegativeNumber.optional(),
    fadeEnvelope: productionAudioFadeEnvelopeSchema.optional(),
    muted: z.boolean().optional(),
  }).strict()).max(MAX_PRODUCTION_HISTORY_ITEMS).optional(),
}).strict();

const qualityReportSchema = z.object({
  id: idSchema,
  workflowKind: z.literal(EDITORIAL_COLLAGE_TASK_TYPE),
  stage: z.string().max(256),
  providerJobId: idSchema.optional(),
  episodeId: idSchema.optional(),
  renderFingerprint: z.string().max(256).optional(),
  manualReview: z.object({
    reportId: idSchema,
    renderFingerprint: z.string().max(256),
    scope: z.object({
      kind: z.enum(['project', 'shot', 'asset', 'subtitle', 'audio', 'media']),
      shotIds: z.array(idSchema).max(MAX_ITEMS).optional(),
      assetVersionIds: z.array(idSchema).max(MAX_ITEMS).optional(),
      cueIds: z.array(idSchema).max(MAX_ITEMS).optional(),
      startMs: nonNegativeNumber.optional(),
      endMs: nonNegativeNumber.optional(),
    }).strict(),
    confirmedAt: timestampSchema,
  }).strict().optional(),
  status: z.enum(['pending', 'passed', 'failed', 'waived']),
  checks: z.array(z.object({
    id: idSchema,
    label: z.string().max(512),
    status: z.enum(['pending', 'passed', 'failed', 'waived']),
    severity: z.enum(['blocking', 'warning', 'manual']).optional(),
    detail: boundedText(65_536).optional(),
    recheckScope: z.object({
      kind: z.enum(['project', 'shot', 'asset', 'subtitle', 'audio', 'media']),
      shotIds: z.array(idSchema).max(MAX_ITEMS).optional(),
      assetVersionIds: z.array(idSchema).max(MAX_ITEMS).optional(),
      cueIds: z.array(idSchema).max(MAX_ITEMS).optional(),
      startMs: nonNegativeNumber.optional(),
      endMs: nonNegativeNumber.optional(),
    }).strict().optional(),
  }).strict()).max(MAX_ITEMS),
  evidence: z.object({
    subtitleLayout: productionSubtitleLayoutEvidenceSchema.optional(),
    audioMeanVolumeDb: z.number().finite().optional(),
    audioPeakDb: z.number().finite().optional(),
    audioLufs: z.number().finite().optional(),
    audioTruePeakDb: z.number().finite().optional(),
    audioIsSilent: z.boolean().optional(),
    blackIntervalsMs: z.array(z.object({ startMs: nonNegativeNumber, endMs: nonNegativeNumber }).strict()).max(64).optional(),
    visualContinuity: productionVisualContinuityEvidenceSchema.optional(),
    audioQualityStatus: z.enum(['ok', 'failed', 'unavailable']).optional(),
    audioQualityError: boundedText(2_000).optional(),
    blackDetectionStatus: z.enum(['ok', 'failed', 'unavailable']).optional(),
    blackDetectionError: boundedText(2_000).optional(),
    narrationAlignment: productionNarrationAlignmentEvidenceSchema.optional(),
  }).strict().optional(),
  createdAt: timestampSchema,
}).strict();

export const editorialCollagePipelineSchema = z.object({
  version: z.literal(EDITORIAL_COLLAGE_PIPELINE_VERSION),
  id: idSchema,
  workflowKind: z.literal(EDITORIAL_COLLAGE_TASK_TYPE),
  title: z.string().max(512),
  sourceText: boundedText().optional(),
  ratio: z.enum(EDITORIAL_COLLAGE_RATIOS),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  stage: z.enum(EDITORIAL_COLLAGE_STAGES),
  styleCandidates: z.array(styleCandidateSchema).max(20),
  selectedStyleId: idSchema.optional(),
  beats: z.array(beatSchema).max(MAX_BEATS),
  assets: z.array(assetVersionSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  providerJobs: z.array(providerJobSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  qualityReports: z.array(qualityReportSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  estimatedCost: nonNegativeNumber,
  actualCost: nonNegativeNumber.optional(),
  costApprovedAt: timestampSchema.optional(),
  costSummary: boundedText(65_536).optional(),
  timeline: timelineSchema.optional(),
}).strict();

export const editorialCollageCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(512),
  sourceText: z.string().min(1).max(MAX_TEXT).refine((value) => value.trim().length > 0, 'A source text is required.'),
  ratio: z.enum(EDITORIAL_COLLAGE_RATIOS).optional(),
  durationMs: z.union([z.literal(15_000), z.literal(30_000), z.literal(60_000), z.literal('auto')]).optional(),
}).strict();

export const editorialCollageSaveInputSchema = z.object({
  id: idSchema,
  expectedUpdatedAt: timestampSchema,
  document: editorialCollagePipelineSchema,
}).strict();

export function createEditorialCollageDraft(input: EditorialCollageDraftInput): EditorialCollagePipelineData {
  const now = input.now ?? new Date().toISOString();
  return {
    version: EDITORIAL_COLLAGE_PIPELINE_VERSION,
    id: input.id,
    workflowKind: EDITORIAL_COLLAGE_TASK_TYPE,
    title: input.title.trim(),
    ratio: input.ratio ?? '9:16',
    createdAt: now,
    updatedAt: now,
    stage: 'draft',
    styleCandidates: EDITORIAL_STYLE_PRESETS.map((candidate) => ({ ...candidate, selected: false })),
    beats: [],
    assets: [],
    providerJobs: [],
    qualityReports: [],
    estimatedCost: 0,
  };
}

export function parseEditorialCollagePipelineData(input: unknown): EditorialCollagePipelineData {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new Error('EDITORIAL_COLLAGE_INVALID_JSON: VOX project data is not valid JSON.');
    }
  }
  const parsed = editorialCollagePipelineSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`EDITORIAL_COLLAGE_INVALID_DATA: ${issue.path.join('.') || 'document'} ${issue.message}`);
  }
  const document = parsed.data as EditorialCollagePipelineData;
  const issues = validateEditorialCollagePipeline(document);
  if (issues.length > 0) {
    throw new Error(`EDITORIAL_COLLAGE_INVALID_DATA: ${issues[0].path} ${issues[0].message}`);
  }
  return document;
}

export function createEditorialCollageStarterPlan(
  draft: EditorialCollagePipelineData,
  sourceText: string,
  now = new Date().toISOString(),
  durationMs: EditorialCollageStarterDurationMs = 30_000,
): EditorialCollagePipelineData {
  const plan = planEditorialScript(sourceText, durationMs);
  let startMs = 0;
  const beats = plan.beats.map((plannedBeat, index): EditorialCollageBeat => {
    const { durationMs, narration } = plannedBeat;
    const beatId = `beat-${index + 1}`;
    const shotId = `shot-${index + 1}`;
    let shotStartMs = startMs;
    let nextCue = 1;
    const subtitleCues = plannedBeat.shots.flatMap((shot) => {
      let cueStartMs = shotStartMs;
      shotStartMs += shot.durationMs;
      return shot.cues.map((cue): EditorialSubtitleCue => {
        const value = { id: `${beatId}-cue-${nextCue++}`, startMs: cueStartMs, endMs: cueStartMs + cue.durationMs, text: cue.text };
        cueStartMs += cue.durationMs;
        return value;
      });
    });
    const layers: EditorialCollageLayer[] = [
      {
        id: `${shotId}-background`,
        label: '纸张底板',
        kind: 'background',
        source: 'svg',
        zIndex: 0,
        depth: -0.08,
        prompt: `editorial paper background for ${narration}`,
        motion: [
          { atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
          { atMs: durationMs, x: 0.5, y: 0.5, scale: 1.04, rotation: 0, opacity: 1 },
        ],
      },
      {
        id: `${shotId}-subject`,
        label: plannedBeat.sectionIndex === 2 ? '证据切片' : '主体切片',
        kind: plannedBeat.sectionIndex === 2 ? 'archival' : 'subject',
        source: 'svg',
        zIndex: 10,
        depth: 0.12,
        prompt: `cutout editorial subject for ${narration}`,
        motion: [
          { atMs: 0, x: index % 2 === 0 ? 0.62 : 0.38, y: 0.5, scale: 0.96, rotation: index % 2 === 0 ? -2 : 2, opacity: 0.92 },
          { atMs: durationMs, x: 0.5, y: 0.5, scale: 1.02, rotation: 0, opacity: 1 },
        ],
      },
      {
        id: `${shotId}-label`,
        label: plannedBeat.title,
        kind: 'label',
        source: 'svg',
        zIndex: 20,
        depth: 0.2,
        motion: [
          { atMs: 0, x: 0.12, y: 0.16, scale: 0.92, rotation: 0, opacity: 0 },
          { atMs: Math.min(500, durationMs), x: 0.12, y: 0.16, scale: 1, rotation: 0, opacity: 1 },
        ],
      },
    ];
    const beat: EditorialCollageBeat = {
      id: beatId,
      index: index + 1,
      title: plannedBeat.title,
      narration,
      startMs,
      durationMs,
      shots: [{
        id: shotId,
        beatId,
        durationMs,
        renderStrategy: 'deterministic-layers',
        scenePrompt: `vertical editorial collage, ${narration}`,
        motionPrompt: 'restrained parallax, cutout slide, gentle camera push',
        layers,
        camera: [
          { atMs: 0, x: 0.5, y: 0.5, zoom: 1 },
          { atMs: durationMs, x: 0.5, y: 0.48, zoom: 1.06 },
        ],
        subtitleCueIds: subtitleCues.map((cue) => cue.id),
      }],
      subtitleCues,
    };
    startMs += durationMs;
    return beat;
  });

  const expandedBeats = beats.map((beat, beatIndex) => {
    const sourceShot = beat.shots[0];
    const plannedShots = plan.beats[beatIndex].shots;
    let cueIndex = 0;
    const shots = plannedShots.map((plannedShot, index) => {
      const id = plannedShots.length === 1 ? sourceShot.id : `${sourceShot.id}-${index === 0 ? 'a' : index === 1 ? 'b' : index + 1}`;
      const shot = plannedShots.length === 1 ? sourceShot : cloneEditorialShotForEdit(sourceShot, id, beat.id, plannedShot.durationMs);
      const cues = beat.subtitleCues.slice(cueIndex, cueIndex + plannedShot.cues.length);
      cueIndex += plannedShot.cues.length;
      const narration = plannedShot.cues.map((cue) => cue.text).join('');
      return {
        ...shot, subtitleCueIds: cues.map((cue) => cue.id), scenePrompt: `vertical editorial collage, ${narration || beat.title}`,
        layers: shot.layers.map((layer) => ({ ...layer, ...(layer.prompt ? { prompt: `${layer.kind === 'background' ? 'editorial paper background' : 'cutout editorial subject'} for ${narration || beat.title}` } : {}) })),
      };
    });
    const owners = new Map(shots.flatMap((shot) => shot.subtitleCueIds.map((cueId) => [cueId, shot.id] as const)));
    return { ...beat, shots, subtitleCues: beat.subtitleCues.map((cue) => ({ ...cue, shotId: owners.get(cue.id) })) };
  });

  return rebuildEditorialTimeline({
    ...draft,
    sourceText,
    updatedAt: now,
    stage: 'style-approved',
    styleCandidates: draft.styleCandidates.map((candidate, index) => ({ ...candidate, selected: index === 0 })),
    selectedStyleId: draft.styleCandidates[0]?.id,
    beats: expandedBeats,
  });
}

export function rebuildEditorialTimeline(data: EditorialCollagePipelineData): EditorialCollagePipelineData {
  let startMs = 0;
  const clips: ProductionTimeline['clips'] = [];
  const audioAssetVersionIds: string[] = [];
  for (const beat of data.beats) {
    for (const shot of beat.shots) {
      const layerAssetVersionIds = shot.layers.flatMap((layer) => layer.visible !== false && layer.assetVersionId ? [layer.assetVersionId] : []);
      const assetVersionIds = shot.renderStrategy === 'deterministic-layers'
        ? layerAssetVersionIds
        : shot.renderStrategy === 'living-poster'
          ? (shot.videoAssetVersionId ? [shot.videoAssetVersionId] : [])
          : [...layerAssetVersionIds, ...(shot.videoAssetVersionId ? [shot.videoAssetVersionId] : [])];
      clips.push({
        id: `clip-${shot.id}`,
        shotId: shot.id,
        startMs,
        durationMs: shot.durationMs,
        assetVersionIds: [...new Set(assetVersionIds)],
        subtitleCueIds: [...shot.subtitleCueIds],
        source: shot.renderStrategy === 'deterministic-layers'
          ? 'deterministic'
          : shot.renderStrategy === 'living-poster' ? 'ai-video' : 'mixed',
      });
      if (shot.voiceAssetVersionId && !audioAssetVersionIds.includes(shot.voiceAssetVersionId)) {
        audioAssetVersionIds.push(shot.voiceAssetVersionId);
      }
      startMs += shot.durationMs;
    }
  }
  for (const clip of data.timeline?.audioClips ?? []) {
    if (clip.assetVersionId && !audioAssetVersionIds.includes(clip.assetVersionId)) audioAssetVersionIds.push(clip.assetVersionId);
  }
  const audioClips = data.timeline?.audioClips;
  return {
    ...data,
    timeline: { durationMs: startMs, clips, audioAssetVersionIds, ...(audioClips?.length ? { audioClips: audioClips.map((clip) => ({ ...clip })) } : {}) },
  };
}

function editorialBeatId(data: EditorialCollagePipelineData, base: string): string {
  return uniqueEditorialId(base, data.beats.map((beat) => beat.id));
}

export function insertEditorialBeat(
  data: EditorialCollagePipelineData,
  index = data.beats.length,
  templateBeatId?: string,
  durationMs = 3_000,
  title = '新节拍',
  narration = '',
): EditorialCollagePipelineData {
  assertEditableShotDuration(durationMs);
  if (data.beats.length >= MAX_BEATS) throw new Error(`EDITORIAL_TOO_MANY_BEATS: 一个项目最多包含 ${MAX_BEATS} 个节拍。`);
  const insertionIndex = Math.max(0, Math.min(index, data.beats.length));
  const template = (templateBeatId ? data.beats.find((beat) => beat.id === templateBeatId) : undefined) ?? data.beats[insertionIndex] ?? data.beats.at(-1);
  if (!template?.shots[0]) throw new Error('EDITORIAL_BEAT_EMPTY: 当前项目没有可复制的镜头模板。');
  const beatId = editorialBeatId(data, `beat-${insertionIndex + 1}`);
  const shotId = uniqueEditorialId(`${beatId}-shot-1`, data.beats.flatMap((beat) => beat.shots).map((shot) => shot.id));
  const cueId = uniqueEditorialId(`${beatId}-cue-1`, data.beats.flatMap((beat) => beat.subtitleCues).map((cue) => cue.id));
  const narrationText = narration.trim();
  const shot = { ...cloneEditorialShotForEdit(template.shots[0], shotId, beatId, durationMs), subtitleCueIds: narrationText ? [cueId] : [] };
  const beat: EditorialCollageBeat = {
    id: beatId, index: insertionIndex + 1, title: title.trim() || '新节拍', narration: narrationText, startMs: 0, durationMs,
    shots: [shot], subtitleCues: narrationText ? [{ id: cueId, startMs: 0, endMs: durationMs, text: narrationText, shotId }] : [],
  };
  const beats = [...data.beats];
  beats.splice(insertionIndex, 0, beat);
  return reflowEditorialStructure(data, beats);
}

export function removeEditorialBeat(data: EditorialCollagePipelineData, beatId: string): EditorialCollagePipelineData {
  const index = data.beats.findIndex((beat) => beat.id === beatId);
  if (index < 0) throw new Error(`EDITORIAL_BEAT_NOT_FOUND: ${beatId}`);
  if (data.beats.length <= 1) throw new Error('EDITORIAL_LAST_BEAT: 项目至少需要保留一个节拍。');
  const removedShotIds = new Set(data.beats[index].shots.map((shot) => shot.id));
  const beats = data.beats.filter((beat) => beat.id !== beatId);
  const timeline = data.timeline?.audioClips ? { ...data.timeline, audioClips: data.timeline.audioClips.filter((clip) => !removedShotIds.has(clip.shotId ?? '')) } : data.timeline;
  return reflowEditorialStructure({ ...data, timeline }, beats);
}

export function reorderEditorialBeat(data: EditorialCollagePipelineData, beatId: string, targetIndex: number): EditorialCollagePipelineData {
  const currentIndex = data.beats.findIndex((beat) => beat.id === beatId);
  if (currentIndex < 0) throw new Error(`EDITORIAL_BEAT_NOT_FOUND: ${beatId}`);
  const beats = [...data.beats];
  const [beat] = beats.splice(currentIndex, 1);
  beats.splice(Math.max(0, Math.min(targetIndex, beats.length)), 0, beat);
  return reflowEditorialStructure(data, beats);
}

export function moveEditorialShot(data: EditorialCollagePipelineData, shotId: string, direction: 'up' | 'down'): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shotId);
  const targetIndex = location.shotIndex + (direction === 'up' ? -1 : 1);
  if (targetIndex >= 0 && targetIndex < location.beat.shots.length) return reorderEditorialShot(data, shotId, targetIndex);
  const targetBeatIndex = location.beatIndex + (direction === 'up' ? -1 : 1);
  const targetBeat = data.beats[targetBeatIndex];
  if (!targetBeat || location.beat.shots.length <= 1) throw new Error('EDITORIAL_CROSS_BEAT_BOUNDARY: 跨节拍移动需要源节拍保留至少一个镜头。');
  const insertAt = direction === 'up' ? targetBeat.shots.length : 0;
  const movedShot = { ...location.shot, beatId: targetBeat.id };
  const movedCueIds = new Set(location.shot.subtitleCueIds);
  const sourceShotStart = findShotStart(location.beat, shotId);
  const targetShotStart = targetBeat.shots.slice(0, insertAt).reduce((sum, shot) => sum + shot.durationMs, 0);
  const movedCues = location.beat.subtitleCues
    .filter((cue) => movedCueIds.has(cue.id))
    .map((cue) => {
      const localStart = Math.max(0, cue.startMs - location.beat.startMs - sourceShotStart);
      const localEnd = Math.max(localStart + 1, cue.endMs - location.beat.startMs - sourceShotStart);
      return {
        ...retimeEditorialCue(cue, targetBeat.startMs + targetShotStart + localStart, targetBeat.startMs + targetShotStart + localEnd),
        shotId: movedShot.id,
      };
    });
  const sourceBeat = reflowEditorialBeat({
    ...location.beat,
    shots: location.beat.shots.filter((shot) => shot.id !== shotId),
    subtitleCues: location.beat.subtitleCues.filter((cue) => !movedCueIds.has(cue.id)),
  }, location.beat);
  const targetShots = [...targetBeat.shots];
  targetShots.splice(insertAt, 0, movedShot);
  // Retime existing cues against the original shot order before changing beat starts.
  const reflowedTarget = reflowEditorialBeat({ ...targetBeat, shots: targetShots }, targetBeat);
  const targetBeatNext = { ...reflowedTarget, subtitleCues: [...reflowedTarget.subtitleCues, ...movedCues].sort((left, right) => left.startMs - right.startMs) };
  const beats = data.beats.map((beat, index) => index === location.beatIndex ? sourceBeat : index === targetBeatIndex ? targetBeatNext : beat);
  return reflowEditorialStructure(data, beats);
}

/**
 * Edit the shot structure while keeping beat starts, subtitle cues and the
 * authoritative timeline on one clock.  These operations intentionally clear
 * provider jobs for derived shots: a job belongs to the original node id and
 * must not be silently reused after a structural edit.
 */
export function insertEditorialShot(
  data: EditorialCollagePipelineData,
  beatId: string,
  index?: number,
  templateShotId?: string,
  durationMs = 3_000,
): EditorialCollagePipelineData {
  assertEditableShotDuration(durationMs);
  const beatIndex = data.beats.findIndex((beat) => beat.id === beatId);
  if (beatIndex < 0) throw new Error(`EDITORIAL_SHOT_NOT_FOUND: ${beatId}`);
  const beat = data.beats[beatIndex];
  const template = beat.shots.find((shot) => shot.id === templateShotId) ?? beat.shots[0];
  if (!template) throw new Error(`EDITORIAL_BEAT_EMPTY: ${beatId}`);
  const insertionIndex = Math.max(0, Math.min(index ?? beat.shots.length, beat.shots.length));
  const id = uniqueEditorialId(`${beatId}-shot-${insertionIndex + 1}`, data.beats.flatMap((item) => item.shots).map((shot) => shot.id));
  const shot = cloneEditorialShotForEdit(template, id, beatId, durationMs);
  const shots = [...beat.shots];
  shots.splice(insertionIndex, 0, shot);
  return reflowEditorialStructure(data, data.beats.map((item, currentIndex) => currentIndex === beatIndex ? reflowEditorialBeat({ ...item, shots }, beat) : item));
}

export function removeEditorialShot(data: EditorialCollagePipelineData, shotId: string): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shotId);
  if (location.beat.shots.length <= 1) throw new Error(`EDITORIAL_LAST_SHOT: ${shotId}`);
  const shots = location.beat.shots.filter((shot) => shot.id !== shotId);
  const cueIds = new Set(location.beat.shots.find((shot) => shot.id === shotId)?.subtitleCueIds ?? []);
  const beat = { ...location.beat, shots, subtitleCues: location.beat.subtitleCues.filter((cue) => !cueIds.has(cue.id)) };
  const timeline = data.timeline?.audioClips ? {
    ...data.timeline,
    audioClips: data.timeline.audioClips.filter((clip) => clip.shotId !== shotId),
  } : data.timeline;
  return reflowEditorialStructure({ ...data, timeline }, data.beats.map((item, index) => index === location.beatIndex ? reflowEditorialBeat(beat, location.beat) : item));
}

export function reorderEditorialShot(data: EditorialCollagePipelineData, shotId: string, targetIndex: number): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shotId);
  const shots = [...location.beat.shots];
  const currentIndex = shots.findIndex((shot) => shot.id === shotId);
  shots.splice(currentIndex, 1);
  shots.splice(Math.max(0, Math.min(targetIndex, shots.length)), 0, location.beat.shots[currentIndex]);
  return reflowEditorialStructure(data, data.beats.map((item, index) => index === location.beatIndex ? reflowEditorialBeat({ ...item, shots }, location.beat) : item));
}

export type EditorialLayerOrderDirection = 'up' | 'down';

export type EditorialMotionEdit =
  | { kind: 'layer-visibility'; layerId: string; visible: boolean }
  | { kind: 'layer-order'; layerId: string; direction: EditorialLayerOrderDirection }
  | { kind: 'camera-frame'; index: number; patch: Partial<EditorialCameraKeyframe> }
  | { kind: 'layer-frame'; layerId: string; index: number; patch: Partial<EditorialLayerMotionKeyframe> }
  | { kind: 'insert-frame'; layerId?: string; atMs: number }
  | { kind: 'remove-frame'; layerId?: string; index: number };

export function editorialCameraPreset(durationMs: number, preset: NonNullable<EditorialCollageShot['motionPreset']>): EditorialCameraKeyframe[] {
  const start = { atMs: 0, x: 0.5, y: 0.5, zoom: 1 };
  const end = preset === '固定机位' ? start : preset === '轻微视差' ? { x: 0.505, y: 0.495, zoom: 1.03 } : { x: 0.49, y: 0.495, zoom: 1.06 };
  return [start, { ...end, atMs: durationMs }];
}

export function editEditorialShotMotion(data: EditorialCollagePipelineData, shotId: string, edit: EditorialMotionEdit): EditorialCollagePipelineData {
  const { shot } = findEditorialShot(data, shotId);
  if (shot.renderStrategy !== 'deterministic-layers') {
    throw new Error('请切换到本地关键帧，再编辑图层与相机。');
  }
  if (edit.kind === 'layer-visibility') return setEditorialLayerVisibility(data, shotId, edit.layerId, edit.visible);
  if (edit.kind === 'layer-order') return reorderEditorialLayer(data, shotId, edit.layerId, edit.direction);
  if (edit.kind === 'camera-frame') return updateEditorialCameraKeyframe(data, shotId, edit.index, edit.patch);
  const layer = edit.layerId ? shot.layers.find((candidate) => candidate.id === edit.layerId) : undefined;
  if (edit.layerId && !layer) throw new Error('图层不存在，请重新选择。');
  const frames = layer ? layer.motion : shot.camera;
  let nextFrames: (EditorialCameraKeyframe | EditorialLayerMotionKeyframe)[] = frames;
  if (edit.kind === 'layer-frame') {
    const original = layer?.motion[edit.index];
    const parsed = original && layerKeyframeSchema.safeParse({ ...original, ...edit.patch });
    if (!parsed || !parsed.success) throw new Error('图层关键帧参数无效。');
    assertMotionFrameTime(frames, edit.index, parsed.data.atMs, shot.durationMs);
    nextFrames = frames.map((frame, index) => index === edit.index ? parsed.data : frame);
  } else if (edit.kind === 'insert-frame') {
    if (!Number.isFinite(edit.atMs) || edit.atMs < 0 || edit.atMs > shot.durationMs) throw new Error('关键帧时间超出镜头。');
    if (frames.some((frame) => frame.atMs === edit.atMs)) throw new Error('此时间已有关键帧。');
    if (frames.length >= 100) throw new Error('每条轨道最多 100 个关键帧。');
    const fallback = layer ? { atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 } : { atMs: 0, x: 0.5, y: 0.5, zoom: 1 };
    const sampled = sampleEditorialFrame<EditorialCameraKeyframe | EditorialLayerMotionKeyframe>(frames, edit.atMs, fallback);
    nextFrames = [...frames, sampled].sort((left, right) => left.atMs - right.atMs);
  } else {
    const frame = frames[edit.index];
    if (!frame || !Number.isInteger(edit.index)) throw new Error('关键帧不存在。');
    if (frame.atMs === 0 || frame.atMs === shot.durationMs || frames.length <= 1) throw new Error('首尾关键帧需要保留。');
    nextFrames = frames.filter((_, index) => index !== edit.index);
  }
  return replaceEditorialShot(data, layer
    ? { ...shot, layers: shot.layers.map((candidate) => candidate.id === layer.id ? { ...candidate, motion: nextFrames as EditorialLayerMotionKeyframe[] } : candidate) }
    : { ...shot, camera: nextFrames as EditorialCameraKeyframe[] });
}

function sampleEditorialFrame<T extends EditorialCameraKeyframe | EditorialLayerMotionKeyframe>(frames: readonly T[], atMs: number, fallback: T): T {
  const before = [...frames].reverse().find((frame) => frame.atMs <= atMs) ?? frames[0] ?? fallback;
  const after = frames.find((frame) => frame.atMs > atMs) ?? frames.at(-1) ?? fallback;
  const ratio = after.atMs > before.atMs ? Math.max(0, (atMs - before.atMs) / (after.atMs - before.atMs)) : 0;
  return Object.fromEntries(Object.entries(before).map(([key, value]) => [key, key === 'atMs' ? atMs : value + ((after as unknown as Record<string, number>)[key] - value) * ratio])) as unknown as T;
}

function sliceEditorialFrames<T extends EditorialCameraKeyframe | EditorialLayerMotionKeyframe>(frames: readonly T[], startMs: number, endMs: number, fallback: T): T[] {
  const retained = frames.filter((frame) => frame.atMs >= startMs && frame.atMs <= endMs);
  if (!retained.some((frame) => frame.atMs === startMs)) retained.unshift(sampleEditorialFrame(frames, startMs, fallback));
  if (!retained.some((frame) => frame.atMs === endMs)) retained.push(sampleEditorialFrame(frames, endMs, fallback));
  return retained.map((frame) => ({ ...frame, atMs: frame.atMs - startMs }));
}

function retimeEditorialCue(cue: EditorialSubtitleCue, startMs: number, endMs: number): EditorialSubtitleCue {
  if (cue.startMs === startMs && cue.endMs === endMs) return cue;
  const next = { ...cue, startMs, endMs };
  if (endMs - startMs === cue.endMs - cue.startMs && isSubtitleAlignmentValid(cue)) {
    const delta = startMs - cue.startMs;
    return { ...next, tokens: cue.tokens?.map((token) => ({ ...token, startMs: token.startMs + delta, endMs: token.endMs + delta })), alignmentFingerprint: hashSubtitleAlignment(next) };
  }
  return invalidateSubtitleAlignment(next, { audioAssetVersionId: null });
}

function assertMotionFrameTime(frames: readonly { atMs: number }[], index: number, atMs: number, durationMs: number): void {
  if (!Number.isInteger(index) || !frames[index]) throw new Error('关键帧不存在。');
  if (!Number.isFinite(atMs) || atMs < 0 || atMs > durationMs) throw new Error('关键帧时间超出镜头。');
  if (atMs === frames[index].atMs) return;
  if (frames[index].atMs === 0 || frames[index].atMs === durationMs) throw new Error('首尾关键帧时间固定。');
  if ((index > 0 && atMs <= frames[index - 1].atMs) || (index + 1 < frames.length && atMs >= frames[index + 1].atMs)) throw new Error('关键帧时间必须位于相邻关键帧之间。');
}

/** Update one shot's layer visibility without changing its authored order. */
export function setEditorialLayerVisibility(
  data: EditorialCollagePipelineData,
  shotId: string,
  layerId: string,
  visible: boolean,
): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shotId);
  if (!location.shot.layers.some((layer) => layer.id === layerId)) throw new Error(`EDITORIAL_LAYER_NOT_FOUND: ${layerId}`);
  const shot = {
    ...location.shot,
    layers: location.shot.layers.map((layer) => layer.id === layerId ? { ...layer, visible } : layer),
  };
  return replaceEditorialShot(data, shot);
}

/** Normalize the visual stack after moving, including legacy equal z-indices. */
export function reorderEditorialLayer(
  data: EditorialCollagePipelineData,
  shotId: string,
  layerId: string,
  direction: EditorialLayerOrderDirection,
): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shotId);
  const ordered = [...location.shot.layers].sort((left, right) => left.zIndex - right.zIndex);
  const index = ordered.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error(`EDITORIAL_LAYER_NOT_FOUND: ${layerId}`);
  const targetIndex = direction === 'up' ? index + 1 : index - 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return data;
  [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
  const layers = location.shot.layers.map((layer) => ({ ...layer, zIndex: ordered.findIndex((candidate) => candidate.id === layer.id) }));
  return replaceEditorialShot(data, { ...location.shot, layers });
}

/** Change one persisted camera keyframe while keeping the keyframe clock sorted. */
export function updateEditorialCameraKeyframe(
  data: EditorialCollagePipelineData,
  shotId: string,
  keyframeIndex: number,
  patch: Partial<Pick<EditorialCameraKeyframe, 'atMs' | 'x' | 'y' | 'zoom'>>,
): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shotId);
  if (!Number.isInteger(keyframeIndex) || !location.shot.camera[keyframeIndex]) throw new Error(`EDITORIAL_CAMERA_KEYFRAME_NOT_FOUND: ${shotId}:${keyframeIndex}`);
  const parsed = cameraKeyframeSchema.safeParse({ ...location.shot.camera[keyframeIndex], ...patch });
  if (!parsed.success || parsed.data.atMs > location.shot.durationMs) throw new Error('相机关键帧参数无效或时间超出镜头。');
  assertMotionFrameTime(location.shot.camera, keyframeIndex, parsed.data.atMs, location.shot.durationMs);
  const camera = location.shot.camera.map((frame, index) => index === keyframeIndex ? { ...frame, ...patch } : { ...frame });
  camera.sort((left, right) => left.atMs - right.atMs);
  return replaceEditorialShot(data, { ...location.shot, camera });
}

export function splitEditorialShot(data: EditorialCollagePipelineData, shotId: string, splitAtMs: number): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shotId);
  const shot = location.shot;
  if (shot.renderStrategy === 'living-poster') throw new Error(`EDITORIAL_SPLIT_VIDEO_SHOT: ${shotId}`);
  if (!Number.isFinite(splitAtMs) || splitAtMs <= 0 || splitAtMs >= shot.durationMs) throw new Error(`EDITORIAL_SPLIT_RANGE: ${shotId}`);
  const firstId = uniqueEditorialId(`${shot.id}-a`, data.beats.flatMap((beat) => beat.shots).map((item) => item.id).filter((id) => id !== shot.id));
  const secondId = uniqueEditorialId(`${shot.id}-b`, [...data.beats.flatMap((beat) => beat.shots).map((item) => item.id), firstId]);
  const first = cloneEditorialShotForEdit(shot, firstId, location.beat.id, splitAtMs, 0);
  const second = cloneEditorialShotForEdit(shot, secondId, location.beat.id, shot.durationMs - splitAtMs, splitAtMs);
  const sourceCues = location.beat.subtitleCues.filter((cue) => shot.subtitleCueIds.includes(cue.id));
  const splitCues: EditorialSubtitleCue[] = [];
  const firstCueIds: string[] = [];
  const secondCueIds: string[] = [];
  for (const cue of sourceCues) {
    const localStart = cue.startMs - location.beat.startMs - findShotStart(location.beat, shot.id);
    const localEnd = cue.endMs - location.beat.startMs - findShotStart(location.beat, shot.id);
    if (localEnd <= splitAtMs) {
      splitCues.push({ ...cue, shotId: firstId }); firstCueIds.push(cue.id);
    } else if (localStart >= splitAtMs) {
      splitCues.push({ ...cue, shotId: secondId }); secondCueIds.push(cue.id);
    } else {
      const firstCueId = `${cue.id}-a`;
      const secondCueId = `${cue.id}-b`;
      const absoluteSplit = location.beat.startMs + findShotStart(location.beat, shot.id) + splitAtMs;
      splitCues.push({ ...retimeEditorialCue(cue, cue.startMs, absoluteSplit), id: firstCueId, shotId: firstId });
      splitCues.push({ ...retimeEditorialCue(cue, absoluteSplit, cue.endMs), id: secondCueId, shotId: secondId });
      firstCueIds.push(firstCueId); secondCueIds.push(secondCueId);
    }
  }
  first.subtitleCueIds = firstCueIds;
  second.subtitleCueIds = secondCueIds;
  const shots = [...location.beat.shots];
  shots.splice(location.shotIndex, 1, first, second);
  const untouchedCues = location.beat.subtitleCues.filter((cue) => !shot.subtitleCueIds.includes(cue.id));
  const beat = reflowEditorialBeat({ ...location.beat, shots, subtitleCues: [...untouchedCues, ...splitCues] });
  const startMs = location.beat.startMs + findShotStart(location.beat, shot.id);
  const endMs = startMs + shot.durationMs;
  const audioClips = (data.timeline?.audioClips ?? []).filter((clip) => clip.shotId !== shot.id);
  const usedIds = (data.timeline?.audioClips ?? []).map((clip) => clip.id);
  for (const clip of materializeProductionAudioClipsForShot(data.timeline, shot)) {
    let retainedId = false;
    for (const [child, start, end] of [[first, startMs, startMs + splitAtMs], [second, startMs + splitAtMs, endMs]] as const) {
      const sliced = sliceProductionAudioClip(clip, start, end, endMs);
      if (!sliced) continue;
      const id = retainedId ? uniqueEditorialId(`${clip.id}-split`, usedIds) : clip.id;
      usedIds.push(id);
      retainedId = true;
      audioClips.push({ ...sliced, id, shotId: child.id });
    }
  }
  return reflowEditorialStructure({ ...data, timeline: { ...data.timeline!, audioClips } }, data.beats.map((item, index) => index === location.beatIndex ? beat : item));
}

export function mergeEditorialShots(data: EditorialCollagePipelineData, firstShotId: string, secondShotId: string): EditorialCollagePipelineData {
  const firstLocation = findEditorialShot(data, firstShotId);
  const secondLocation = findEditorialShot(data, secondShotId);
  if (firstLocation.beat.id !== secondLocation.beat.id || secondLocation.shotIndex !== firstLocation.shotIndex + 1) {
    throw new Error(`EDITORIAL_MERGE_ADJACENT_ONLY: ${firstShotId},${secondShotId}`);
  }
  if (firstLocation.shot.renderStrategy !== secondLocation.shot.renderStrategy || firstLocation.shot.renderStrategy === 'living-poster') {
    throw new Error(`EDITORIAL_MERGE_STRATEGY_MISMATCH: ${firstShotId},${secondShotId}`);
  }
  const mergedId = firstLocation.shot.id;
  const offset = firstLocation.shot.durationMs;
  const durationMs = offset + secondLocation.shot.durationMs;
  assertEditableShotDuration(durationMs);
  const mergedLayers = [firstLocation.shot, secondLocation.shot].flatMap((shot, part) => shot.layers.map((layer) => {
    const frames = sliceEditorialFrames(layer.motion, 0, shot.durationMs, { atMs: 0, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1 });
    // Equal-time frames encode the hard cut without fading either scene.
    const motion = part === 0
      ? [...frames, { ...frames.at(-1)!, atMs: offset, opacity: 0 }, { ...frames.at(-1)!, atMs: durationMs, opacity: 0 }]
      : [{ ...frames[0], atMs: 0, opacity: 0 }, { ...frames[0], atMs: offset, opacity: 0 }, ...frames.map((frame) => ({ ...frame, atMs: frame.atMs + offset }))];
    return { ...layer, motion };
  })).map((layer, index) => ({ ...layer, id: `${mergedId}-layer-${index + 1}` }));
  if (mergedLayers.length > MAX_LAYERS_PER_SHOT) throw new Error(`EDITORIAL_MERGE_TOO_MANY_LAYERS: 合并后超过 ${MAX_LAYERS_PER_SHOT} 个图层，请先精简图层。`);
  const camera = [firstLocation.shot, secondLocation.shot].flatMap((shot, part) => sliceEditorialFrames(
    shot.camera.length ? shot.camera : editorialCameraPreset(shot.durationMs, shot.motionPreset ?? '固定机位'), 0, shot.durationMs, { atMs: 0, x: .5, y: .5, zoom: 1 },
  ).map((frame) => ({ ...frame, atMs: frame.atMs + (part ? offset : 0) })));
  if (camera.length > 100 || mergedLayers.some((layer) => layer.motion.length > 100)) throw new Error('EDITORIAL_MERGE_TOO_MANY_FRAMES: 合并后每条轨道不能超过 100 个关键帧。');
  const merged: EditorialCollageShot = {
    ...firstLocation.shot,
    id: mergedId,
    durationMs,
    layers: mergedLayers,
    camera,
    subtitleCueIds: [...firstLocation.shot.subtitleCueIds, ...secondLocation.shot.subtitleCueIds],
    providerJobId: undefined,
    videoJobId: undefined,
    videoAssetVersionId: undefined,
    voiceAssetVersionId: undefined,
  };
  const shots = firstLocation.beat.shots.filter((shot) => shot.id !== secondShotId).map((shot) => shot.id === firstShotId ? merged : shot);
  const secondCueIds = new Set(secondLocation.shot.subtitleCueIds);
  const beat = reflowEditorialBeat({
    ...firstLocation.beat,
    shots,
    subtitleCues: firstLocation.beat.subtitleCues.map((cue) => secondCueIds.has(cue.id) ? ({ ...cue, shotId: mergedId }) : cue),
  });
  const audioClips = [
    ...(data.timeline?.audioClips ?? []).filter((clip) => clip.shotId !== firstShotId && clip.shotId !== secondShotId),
    ...[firstLocation.shot, secondLocation.shot].flatMap((shot) => materializeProductionAudioClipsForShot(data.timeline, shot).map((clip) => ({ ...clip, shotId: mergedId }))),
  ];
  return reflowEditorialStructure({ ...data, timeline: { ...data.timeline!, audioClips } }, data.beats.map((item, index) => index === firstLocation.beatIndex ? beat : item));
}

function assertEditableShotDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_SHOT_DURATION_MS) {
    throw new Error('EDITORIAL_SHOT_DURATION: 镜头时长须在 1 毫秒到 15 秒之间。');
  }
}

function uniqueEditorialId(base: string, existing: string[]): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function cloneEditorialShotForEdit(
  source: EditorialCollageShot,
  id: string,
  beatId: string,
  durationMs: number,
  sourceStartMs?: number,
): EditorialCollageShot {
  const scale = source.durationMs > 0 ? durationMs / source.durationMs : 1;
  return {
    ...source,
    id,
    beatId,
    durationMs,
    providerJobId: undefined,
    videoJobId: undefined,
    videoAssetVersionId: undefined,
    voiceAssetVersionId: undefined,
    subtitleCueIds: [],
    camera: sourceStartMs === undefined ? source.camera.map((frame) => ({ ...frame, atMs: Math.min(durationMs, Math.round(frame.atMs * scale)) })) : sliceEditorialFrames(source.camera.length ? source.camera : editorialCameraPreset(source.durationMs, source.motionPreset ?? '固定机位'), sourceStartMs, sourceStartMs + durationMs, { atMs: 0, x: .5, y: .5, zoom: 1 }),
    layers: source.layers.map((layer, layerIndex) => ({
      ...layer,
      id: `${id}-layer-${layerIndex + 1}`,
      assetVersionId: layer.assetVersionId,
      motion: sourceStartMs === undefined ? layer.motion.map((frame) => ({ ...frame, atMs: Math.min(durationMs, Math.round(frame.atMs * scale)) })) : sliceEditorialFrames(layer.motion, sourceStartMs, sourceStartMs + durationMs, { atMs: 0, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1 }),
    })),
  };
}

function findEditorialShot(data: EditorialCollagePipelineData, shotId: string): {
  beat: EditorialCollageBeat;
  beatIndex: number;
  shot: EditorialCollageShot;
  shotIndex: number;
} {
  for (const [beatIndex, beat] of data.beats.entries()) {
    const shotIndex = beat.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex >= 0) return { beat, beatIndex, shot: beat.shots[shotIndex], shotIndex };
  }
  throw new Error(`EDITORIAL_SHOT_NOT_FOUND: ${shotId}`);
}

function replaceEditorialShot(data: EditorialCollagePipelineData, shot: EditorialCollageShot): EditorialCollagePipelineData {
  const location = findEditorialShot(data, shot.id);
  const beats = data.beats.map((beat, beatIndex) => beatIndex === location.beatIndex
    ? { ...beat, shots: beat.shots.map((candidate) => candidate.id === shot.id ? shot : candidate) }
    : beat);
  return rebuildEditorialTimeline({ ...data, beats });
}

function findShotStart(beat: EditorialCollageBeat, shotId: string): number {
  return beat.shots.slice(0, beat.shots.findIndex((shot) => shot.id === shotId)).reduce((sum, shot) => sum + shot.durationMs, 0);
}

function reflowEditorialBeat(beat: EditorialCollageBeat, sourceBeat: EditorialCollageBeat = beat): EditorialCollageBeat {
  const durationMs = beat.shots.reduce((sum, shot) => sum + shot.durationMs, 0);
  let shotStart = 0;
  const shots = beat.shots.map((shot) => {
    const next = { ...shot, subtitleCueIds: [...shot.subtitleCueIds] };
    shotStart += shot.durationMs;
    return next;
  });
  const shotStarts = new Map<string, number>();
  let cursor = 0;
  for (const shot of shots) { shotStarts.set(shot.id, cursor); cursor += shot.durationMs; }
  const sourceShotStarts = new Map<string, number>();
  cursor = 0;
  for (const shot of sourceBeat.shots) { sourceShotStarts.set(shot.id, cursor); cursor += shot.durationMs; }
  const sourceCueOwners = new Map<string, string>();
  for (const shot of sourceBeat.shots) for (const cueId of shot.subtitleCueIds) sourceCueOwners.set(cueId, shot.id);
  const cues = beat.subtitleCues.map((cue) => {
    const owner = shots.find((shot) => shot.subtitleCueIds.includes(cue.id));
    if (!owner) return { ...cue };
    const ownerStart = shotStarts.get(owner.id) ?? 0;
    const sourceOwnerStart = sourceShotStarts.get(sourceCueOwners.get(cue.id) ?? '') ?? 0;
    const oldStart = sourceCueOwners.has(cue.id) ? Math.max(0, cue.startMs - sourceBeat.startMs - sourceOwnerStart) : Math.max(0, cue.startMs - beat.startMs);
    const oldEnd = sourceCueOwners.has(cue.id) ? Math.max(oldStart + 1, cue.endMs - sourceBeat.startMs - sourceOwnerStart) : Math.max(oldStart + 1, cue.endMs - beat.startMs);
    const nextStart = beat.startMs + ownerStart + Math.min(owner.durationMs - 1, oldStart);
    const nextEnd = beat.startMs + ownerStart + Math.min(owner.durationMs, Math.max(oldStart + 1, oldEnd));
    return { ...retimeEditorialCue(cue, nextStart, Math.max(nextStart + 1, nextEnd)), shotId: owner.id };
  });
  return { ...beat, durationMs, shots, subtitleCues: cues };
}

function reflowEditorialStructure(data: EditorialCollagePipelineData, beats: EditorialCollageBeat[]): EditorialCollagePipelineData {
  let startMs = 0;
  const normalized = beats.map((beat, index) => {
    const next = reflowEditorialBeat({ ...beat, index: index + 1, startMs }, beat);
    startMs += next.durationMs;
    return next;
  });
  // Keep the persisted revision until storage accepts these local edits.
  const rebuilt = rebuildEditorialTimeline({ ...data, beats: normalized, stage: 'assets',
    assets: data.assets.map((asset) => asset.assetId === 'director-final-video' ? { ...asset, selected: false, pinned: false } : asset),
  });
  const oldStarts = new Map(data.timeline?.clips.map((clip) => [clip.shotId, clip.startMs]));
  const newStarts = new Map(rebuilt.timeline!.clips.map((clip) => [clip.shotId, clip.startMs]));
  if (rebuilt.timeline!.audioClips) rebuilt.timeline!.audioClips = rebuilt.timeline!.audioClips.map((clip) => {
    const previous = oldStarts.get(clip.shotId ?? '');
    const next = newStarts.get(clip.shotId ?? '');
    return previous === undefined || next === undefined ? clip : { ...clip, startMs: clip.startMs + next - previous };
  });
  return parseEditorialCollagePipelineData(rebuilt);
}

export function validateEditorialCollagePipeline(
  data: EditorialCollagePipelineData,
  options: { ready?: boolean } = {},
): EditorialCollageValidationIssue[] {
  const issues: EditorialCollageValidationIssue[] = [];
  const ready = options.ready ?? false;
  const assets = new Map<string, EditorialCollagePipelineData['assets'][number]>();
  const jobs = new Map<string, EditorialCollagePipelineData['providerJobs'][number]>();

  data.providerJobs.forEach((job, index) => {
    if (jobs.has(job.id)) issues.push({ path: `providerJobs[${index}].id`, message: 'Provider job ids must be unique.' });
    jobs.set(job.id, job);
  });
  data.assets.forEach((asset, index) => {
    if (assets.has(asset.id)) issues.push({ path: `assets[${index}].id`, message: 'Asset version ids must be unique.' });
    assets.set(asset.id, asset);
    if (asset.providerJobId && !jobs.has(asset.providerJobId)) {
      issues.push({ path: `assets[${index}].providerJobId`, message: 'Asset provider job does not exist.' });
    }
  });

  if (data.version !== EDITORIAL_COLLAGE_PIPELINE_VERSION) issues.push({ path: 'version', message: 'Unsupported editorial collage pipeline version.' });
  if (!data.title.trim()) issues.push({ path: 'title', message: 'A title is required.' });
  if (!Number.isFinite(data.estimatedCost) || data.estimatedCost < 0) issues.push({ path: 'estimatedCost', message: 'Estimated cost must be a non-negative finite number.' });
  if (data.beats.length > MAX_BEATS) issues.push({ path: 'beats', message: `A short can contain at most ${MAX_BEATS} beats.` });

  const beatIds = new Set<string>();
  const shotIds = new Set<string>();
  const cueIds = new Set<string>();
  let expectedStartMs = 0;
  for (const [beatIndex, beat] of data.beats.entries()) {
    const beatPath = `beats[${beatIndex}]`;
    if (beatIds.has(beat.id)) issues.push({ path: `${beatPath}.id`, message: 'Beat ids must be unique.' });
    beatIds.add(beat.id);
    if (beat.index !== beatIndex + 1) issues.push({ path: `${beatPath}.index`, message: 'Beat indexes must be contiguous and 1-based.' });
    if (beat.startMs !== expectedStartMs) issues.push({ path: `${beatPath}.startMs`, message: 'Beat start times must form one continuous timeline.' });
    if (beat.durationMs <= 0) issues.push({ path: `${beatPath}.durationMs`, message: 'Beat duration must be positive.' });
    if (beat.shots.length === 0 && ready) issues.push({ path: `${beatPath}.shots`, message: 'Approved beats need at least one shot.' });

    let shotOffsetMs = 0;
    for (const [shotIndex, shot] of beat.shots.entries()) {
      const shotPath = `${beatPath}.shots[${shotIndex}]`;
      if (shotIds.has(shot.id)) issues.push({ path: `${shotPath}.id`, message: 'Shot ids must be unique.' });
      shotIds.add(shot.id);
      if (shot.durationMs <= 0 || shot.durationMs > MAX_SHOT_DURATION_MS) issues.push({ path: `${shotPath}.durationMs`, message: 'Shot duration must be between 1ms and 15s.' });
      if (shot.beatId !== beat.id) issues.push({ path: `${shotPath}.beatId`, message: 'Shot must reference its owning beat.' });
      const imageJob = shot.providerJobId ? jobs.get(shot.providerJobId) : undefined;
      const videoJob = shot.videoJobId ? jobs.get(shot.videoJobId) : undefined;
      const videoAsset = shot.videoAssetVersionId ? assets.get(shot.videoAssetVersionId) : undefined;
      const voiceAsset = shot.voiceAssetVersionId ? assets.get(shot.voiceAssetVersionId) : undefined;
      if (shot.providerJobId && !imageJob) issues.push({ path: `${shotPath}.providerJobId`, message: 'Shot provider job does not exist.' });
      if (imageJob && (imageJob.nodeId !== shot.id || imageJob.capability !== 'text-to-image')) {
        issues.push({ path: `${shotPath}.providerJobId`, message: 'Shot image job must belong to the shot and use text-to-image.' });
      }
      if (shot.videoJobId && !videoJob) issues.push({ path: `${shotPath}.videoJobId`, message: 'Shot video job does not exist.' });
      if (videoJob && (videoJob.nodeId !== shot.id || videoJob.capability !== 'image-to-video')) {
        issues.push({ path: `${shotPath}.videoJobId`, message: 'Shot video job must belong to the shot and use image-to-video.' });
      }
      if (shot.videoAssetVersionId && !videoAsset) issues.push({ path: `${shotPath}.videoAssetVersionId`, message: 'Shot video asset does not exist.' });
      if (videoAsset && videoAsset.kind !== 'video') issues.push({ path: `${shotPath}.videoAssetVersionId`, message: 'Shot video asset must be a video.' });
      if (videoAsset && shot.videoJobId && videoAsset.providerJobId !== shot.videoJobId) {
        issues.push({ path: `${shotPath}.videoAssetVersionId`, message: 'Shot video asset and video job must reference each other.' });
      }
      if (shot.voiceAssetVersionId && !voiceAsset) issues.push({ path: `${shotPath}.voiceAssetVersionId`, message: 'Shot voice asset does not exist.' });
      if (voiceAsset && voiceAsset.kind !== 'audio') issues.push({ path: `${shotPath}.voiceAssetVersionId`, message: 'Shot voice asset must be audio.' });
      if (shot.layers.length > MAX_LAYERS_PER_SHOT) issues.push({ path: `${shotPath}.layers`, message: `A shot can contain at most ${MAX_LAYERS_PER_SHOT} layers.` });
      const requiresLayers = shot.renderStrategy !== 'living-poster';
      const requiresVideo = shot.renderStrategy !== 'deterministic-layers';
      if (ready && requiresLayers && shot.layers.length < 2) issues.push({ path: `${shotPath}.layers`, message: 'A ready collage shot needs at least a background and one foreground layer.' });
      if (ready && requiresLayers && shot.camera.length === 0) issues.push({ path: `${shotPath}.camera`, message: 'A ready collage shot needs camera keyframes.' });
      if (ready && requiresVideo && !shot.videoAssetVersionId) issues.push({ path: `${shotPath}.videoAssetVersionId`, message: 'AI motion requires a generated video asset before rendering.' });
      if (ready && requiresVideo && !shot.videoJobId) issues.push({ path: `${shotPath}.videoJobId`, message: 'AI motion requires a completed image-to-video job before rendering.' });
      if (ready && requiresVideo && videoJob?.status !== 'completed') issues.push({ path: `${shotPath}.videoJobId`, message: 'AI motion video generation must complete before rendering.' });
      if (ready && requiresVideo && videoAsset && !videoAsset.localPath?.trim() && !videoAsset.uri?.trim()) {
        issues.push({ path: `${shotPath}.videoAssetVersionId`, message: 'AI motion video asset must have a readable location.' });
      }
      validateKeyframes(shot.camera, shot.durationMs, `${shotPath}.camera`, issues);
      const layerIds = new Set<string>();
      for (const [layerIndex, layer] of shot.layers.entries()) {
        if (layerIds.has(layer.id)) issues.push({ path: `${shotPath}.layers[${layerIndex}].id`, message: 'Layer ids must be unique inside a shot.' });
        layerIds.add(layer.id);
        validateKeyframes(layer.motion, shot.durationMs, `${shotPath}.layers[${layerIndex}].motion`, issues);
        const layerAsset = layer.assetVersionId ? assets.get(layer.assetVersionId) : undefined;
        if (layer.assetVersionId && !layerAsset) issues.push({ path: `${shotPath}.layers[${layerIndex}].assetVersionId`, message: 'Layer asset version does not exist.' });
        if (layerAsset && layerAsset.kind !== 'image') issues.push({ path: `${shotPath}.layers[${layerIndex}].assetVersionId`, message: 'Visual layers must point to image assets.' });
        if (ready && requiresLayers && layer.visible !== false && !layer.assetVersionId && layer.source !== 'svg') issues.push({ path: `${shotPath}.layers[${layerIndex}].assetVersionId`, message: 'Every generated or local layer must point to an asset version before rendering.' });
      }
      const beatCueIds = new Set(beat.subtitleCues.map((cue) => cue.id));
      if (shot.subtitleCueIds.some((cueId) => !beatCueIds.has(cueId))) {
        issues.push({ path: `${shotPath}.subtitleCueIds`, message: 'Shot subtitle references must belong to the owning beat.' });
      }
      shotOffsetMs += shot.durationMs;
    }
    if (beat.shots.length > 0 && shotOffsetMs !== beat.durationMs) issues.push({ path: `${beatPath}.shots`, message: 'Shot durations must add up to the beat duration.' });
    for (const [cueIndex, cue] of beat.subtitleCues.entries()) {
      const cuePath = `${beatPath}.subtitleCues[${cueIndex}]`;
      if (cueIds.has(cue.id)) issues.push({ path: `${cuePath}.id`, message: 'Subtitle cue ids must be globally unique.' });
      cueIds.add(cue.id);
      if (cue.startMs < beat.startMs || cue.endMs > beat.startMs + beat.durationMs || cue.endMs <= cue.startMs) issues.push({ path: cuePath, message: 'Subtitle cues must stay inside their beat and have positive duration.' });
      for (const issue of validatePersistedSubtitleCue(cue)) issues.push({ path: `${cuePath}.${issue.path}`, message: issue.message });
      if (cue.shotId && !beat.shots.some((shot) => shot.id === cue.shotId && shot.subtitleCueIds.includes(cue.id))) {
        issues.push({ path: `${cuePath}.shotId`, message: 'Subtitle cue must belong to its referencing shot.' });
      }
      if (cue.audioAssetVersionId && assets.get(cue.audioAssetVersionId)?.kind !== 'audio') {
        issues.push({ path: `${cuePath}.audioAssetVersionId`, message: 'Subtitle audio reference must point to an existing audio asset.' });
      }
      const owners = beat.shots.filter((shot) => shot.subtitleCueIds.includes(cue.id));
      const clip = owners.length === 1 ? data.timeline?.clips.find((item) => item.shotId === owners[0].id) : undefined;
      if (clip && (cue.startMs < clip.startMs || cue.endMs > clip.startMs + clip.durationMs)) {
        issues.push({ path: cuePath, message: 'Subtitle cues must stay inside their owning shot timeline clip.' });
      }
    }
    expectedStartMs += beat.durationMs;
  }

  if (expectedStartMs > MAX_TOTAL_DURATION_MS) issues.push({ path: 'beats', message: `A collage short cannot exceed ${MAX_TOTAL_DURATION_MS / 1000}s.` });
  const selectedCandidates = data.styleCandidates.filter((candidate) => candidate.selected);
  data.styleCandidates.forEach((candidate, index) => {
    if (!candidate.assetVersionId) return;
    const candidatePath = `styleCandidates[${index}].assetVersionId`;
    const asset = assets.get(candidate.assetVersionId);
    if (!asset) {
      issues.push({ path: candidatePath, message: 'Style candidate asset version does not exist.' });
      return;
    }
    if (asset.kind !== 'image') issues.push({ path: candidatePath, message: 'Style candidate sample must be an image asset.' });
    if (asset.providerJobId) {
      const job = jobs.get(asset.providerJobId);
      if (job && (job.nodeId !== `style-candidate:${candidate.id}` || job.capability !== 'style-sample')) {
        issues.push({ path: candidatePath, message: 'Style candidate sample must reference its style-sample provider job.' });
      }
    }
  });
  if (data.selectedStyleId && !data.styleCandidates.some((candidate) => candidate.id === data.selectedStyleId)) {
    issues.push({ path: 'selectedStyleId', message: 'Selected style must reference a style candidate.' });
  }
  if (data.selectedStyleId && (selectedCandidates.length !== 1 || selectedCandidates[0].id !== data.selectedStyleId)) {
    issues.push({ path: 'styleCandidates', message: 'Exactly one style candidate must match the selected style.' });
  }
  if (ready) {
    if (!data.selectedStyleId) issues.push({ path: 'selectedStyleId', message: 'A style candidate must be selected before rendering.' });
    if (data.estimatedCost > 0 && !data.costApprovedAt) issues.push({ path: 'costApprovedAt', message: 'Paid generation requires an explicit cost approval timestamp.' });
    if (!data.timeline) issues.push({ path: 'timeline', message: 'A render-ready project needs an authoritative timeline.' });
  }
  if (data.timeline) {
    const expectedTimeline = rebuildEditorialTimeline(data).timeline;
    if (JSON.stringify(data.timeline) !== JSON.stringify(expectedTimeline)) {
      issues.push({ path: 'timeline', message: 'Timeline must match the current shot strategies and asset versions.' });
    }
    data.timeline.clips.forEach((clip, index) => {
      clip.assetVersionIds.forEach((assetVersionId) => {
        if (!assets.has(assetVersionId)) issues.push({ path: `timeline.clips[${index}].assetVersionIds`, message: 'Timeline clip references a missing asset version.' });
      });
    });
    data.timeline.audioAssetVersionIds.forEach((assetVersionId, index) => {
      const asset = assets.get(assetVersionId);
      if (!asset) issues.push({ path: `timeline.audioAssetVersionIds[${index}]`, message: 'Timeline references a missing audio asset version.' });
      else if (asset.kind !== 'audio') issues.push({ path: `timeline.audioAssetVersionIds[${index}]`, message: 'Timeline audio references must point to audio assets.' });
    });
    issues.push(...validateProductionAudioTimeline(data.timeline, assets));
  }
  return issues;
}

function validateKeyframes(
  keyframes: Array<{ atMs: number }>,
  durationMs: number,
  path: string,
  issues: EditorialCollageValidationIssue[],
): void {
  let previous = -1;
  for (const [index, keyframe] of keyframes.entries()) {
    if (keyframe.atMs < 0 || keyframe.atMs > durationMs) issues.push({ path: `${path}[${index}].atMs`, message: 'Keyframes must stay inside the shot.' });
    if (keyframe.atMs < previous) issues.push({ path: `${path}[${index}].atMs`, message: 'Keyframes must be sorted by time.' });
    previous = keyframe.atMs;
  }
}

export function editorialCollageReady(data: EditorialCollagePipelineData): boolean {
  return validateEditorialCollagePipeline(data, { ready: true }).length === 0;
}
