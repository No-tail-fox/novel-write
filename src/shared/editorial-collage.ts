import { z } from 'zod';
import type { ProductionDocumentBase } from './production-workflow';

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

export interface EditorialSubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

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
const MAX_TOTAL_DURATION_MS = 120_000;
const MAX_SHOT_DURATION_MS = 15_000;
const MAX_LAYERS_PER_SHOT = 6;
const MAX_TEXT = 1_000_000;
const MAX_ITEMS = 500;

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
  attempt: z.number().int().min(1).max(100),
  remoteTaskId: z.string().max(512).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  error: boundedText(65_536).optional(),
}).strict();

const subtitleCueSchema = z.object({
  id: idSchema,
  startMs: nonNegativeNumber,
  endMs: nonNegativeNumber,
  text: boundedText(10_000),
}).strict();

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
  audioAssetVersionIds: z.array(idSchema).max(MAX_ITEMS),
}).strict();

const qualityReportSchema = z.object({
  id: idSchema,
  workflowKind: z.literal(EDITORIAL_COLLAGE_TASK_TYPE),
  stage: z.string().max(256),
  status: z.enum(['pending', 'passed', 'failed', 'waived']),
  checks: z.array(z.object({
    id: idSchema,
    label: z.string().max(512),
    status: z.enum(['pending', 'passed', 'failed', 'waived']),
    detail: boundedText(65_536).optional(),
  }).strict()).max(MAX_ITEMS),
  createdAt: timestampSchema,
}).strict();

export const editorialCollagePipelineSchema = z.object({
  version: z.literal(EDITORIAL_COLLAGE_PIPELINE_VERSION),
  id: idSchema,
  workflowKind: z.literal(EDITORIAL_COLLAGE_TASK_TYPE),
  title: z.string().max(512),
  ratio: z.enum(EDITORIAL_COLLAGE_RATIOS),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  stage: z.enum(EDITORIAL_COLLAGE_STAGES),
  styleCandidates: z.array(styleCandidateSchema).max(20),
  selectedStyleId: idSchema.optional(),
  beats: z.array(beatSchema).max(MAX_BEATS),
  assets: z.array(assetVersionSchema).max(MAX_ITEMS),
  providerJobs: z.array(providerJobSchema).max(MAX_ITEMS),
  qualityReports: z.array(qualityReportSchema).max(MAX_ITEMS),
  estimatedCost: nonNegativeNumber,
  actualCost: nonNegativeNumber.optional(),
  costApprovedAt: timestampSchema.optional(),
  costSummary: boundedText(65_536).optional(),
  timeline: timelineSchema.optional(),
}).strict();

export const editorialCollageCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(512),
  sourceText: z.string().trim().min(1).max(MAX_TEXT),
  ratio: z.enum(EDITORIAL_COLLAGE_RATIOS).optional(),
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
): EditorialCollagePipelineData {
  const sourceSegments = partitionEditorialSource(sourceText, 4);
  const beatDurations = [3_000, 9_000, 9_000, 9_000] as const;
  const beatTitles = ['钩子', '背景', '证据', '结论'] as const;
  const fallbackNarration = ['提出核心问题。', '交代背景和冲突。', '补充事实、证据与对照。', '回到结论与行动。'] as const;
  let startMs = 0;
  const beats = beatDurations.map((durationMs, index): EditorialCollageBeat => {
    const beatId = `beat-${index + 1}`;
    const shotId = `shot-${index + 1}`;
    const narration = sourceSegments[index] || fallbackNarration[index];
    const cueTexts = splitEditorialCueText(narration);
    const cueDuration = durationMs / cueTexts.length;
    const subtitleCues = cueTexts.map((text, cueIndex): EditorialSubtitleCue => ({
      id: `${beatId}-cue-${cueIndex + 1}`,
      startMs: Math.round(startMs + cueDuration * cueIndex),
      endMs: Math.round(startMs + cueDuration * (cueIndex + 1)),
      text,
    }));
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
        label: index === 2 ? '证据切片' : '主体切片',
        kind: index === 2 ? 'archival' : 'subject',
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
        label: beatTitles[index],
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
      title: beatTitles[index],
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

  return {
    ...draft,
    updatedAt: now,
    stage: 'style-approved',
    styleCandidates: draft.styleCandidates.map((candidate, index) => ({ ...candidate, selected: index === 0 })),
    selectedStyleId: draft.styleCandidates[0]?.id,
    beats,
    timeline: {
      durationMs: startMs,
      clips: beats.flatMap((beat) => beat.shots.map((shot) => ({
        id: `clip-${shot.id}`,
        shotId: shot.id,
        startMs: beat.startMs,
        durationMs: shot.durationMs,
        assetVersionIds: shot.layers.flatMap((layer) => layer.assetVersionId ? [layer.assetVersionId] : []),
        subtitleCueIds: shot.subtitleCueIds,
        source: 'deterministic' as const,
      }))),
      audioAssetVersionIds: [],
    },
  };
}

export function validateEditorialCollagePipeline(
  data: EditorialCollagePipelineData,
  options: { ready?: boolean } = {},
): EditorialCollageValidationIssue[] {
  const issues: EditorialCollageValidationIssue[] = [];
  const ready = options.ready ?? false;
  const assetIds = new Set(data.assets.map((asset) => asset.id));
  const jobIds = new Set(data.providerJobs.map((job) => job.id));

  if (data.version !== EDITORIAL_COLLAGE_PIPELINE_VERSION) issues.push({ path: 'version', message: 'Unsupported editorial collage pipeline version.' });
  if (!data.title.trim()) issues.push({ path: 'title', message: 'A title is required.' });
  if (!Number.isFinite(data.estimatedCost) || data.estimatedCost < 0) issues.push({ path: 'estimatedCost', message: 'Estimated cost must be a non-negative finite number.' });
  if (data.beats.length > MAX_BEATS) issues.push({ path: 'beats', message: `A short can contain at most ${MAX_BEATS} beats.` });

  const beatIds = new Set<string>();
  const shotIds = new Set<string>();
  let expectedStartMs = 0;
  for (const [beatIndex, beat] of data.beats.entries()) {
    const beatPath = `beats[${beatIndex}]`;
    if (beatIds.has(beat.id)) issues.push({ path: `${beatPath}.id`, message: 'Beat ids must be unique.' });
    beatIds.add(beat.id);
    if (beat.index !== beatIndex + 1) issues.push({ path: `${beatPath}.index`, message: 'Beat indexes must be contiguous and 1-based.' });
    if (beat.startMs !== expectedStartMs) issues.push({ path: `${beatPath}.startMs`, message: 'Beat start times must form one continuous timeline.' });
    if (beat.durationMs <= 0) issues.push({ path: `${beatPath}.durationMs`, message: 'Beat duration must be positive.' });
    if (beat.shots.length === 0 && ready) issues.push({ path: `${beatPath}.shots`, message: 'Approved beats need at least one shot.' });
    if (beatIndex === 0 && beat.durationMs > 3_000) issues.push({ path: `${beatPath}.durationMs`, message: 'The first beat must land the hook within three seconds.' });

    let shotOffsetMs = 0;
    for (const [shotIndex, shot] of beat.shots.entries()) {
      const shotPath = `${beatPath}.shots[${shotIndex}]`;
      if (shotIds.has(shot.id)) issues.push({ path: `${shotPath}.id`, message: 'Shot ids must be unique.' });
      shotIds.add(shot.id);
      if (shot.durationMs <= 0 || shot.durationMs > MAX_SHOT_DURATION_MS) issues.push({ path: `${shotPath}.durationMs`, message: 'Shot duration must be between 1ms and 15s.' });
      if (shot.beatId !== beat.id) issues.push({ path: `${shotPath}.beatId`, message: 'Shot must reference its owning beat.' });
      if (shot.providerJobId && !jobIds.has(shot.providerJobId)) issues.push({ path: `${shotPath}.providerJobId`, message: 'Shot provider job does not exist.' });
      if (shot.voiceAssetVersionId && !assetIds.has(shot.voiceAssetVersionId)) issues.push({ path: `${shotPath}.voiceAssetVersionId`, message: 'Shot voice asset does not exist.' });
      if (shot.layers.length > MAX_LAYERS_PER_SHOT) issues.push({ path: `${shotPath}.layers`, message: `A shot can contain at most ${MAX_LAYERS_PER_SHOT} layers.` });
      if (ready && shot.layers.length < 2) issues.push({ path: `${shotPath}.layers`, message: 'A ready collage shot needs at least a background and one foreground layer.' });
      if (ready && shot.camera.length === 0) issues.push({ path: `${shotPath}.camera`, message: 'A ready collage shot needs camera keyframes.' });
      validateKeyframes(shot.camera, shot.durationMs, `${shotPath}.camera`, issues);
      const layerIds = new Set<string>();
      for (const [layerIndex, layer] of shot.layers.entries()) {
        if (layerIds.has(layer.id)) issues.push({ path: `${shotPath}.layers[${layerIndex}].id`, message: 'Layer ids must be unique inside a shot.' });
        layerIds.add(layer.id);
        validateKeyframes(layer.motion, shot.durationMs, `${shotPath}.layers[${layerIndex}].motion`, issues);
        if (layer.assetVersionId && !assetIds.has(layer.assetVersionId)) issues.push({ path: `${shotPath}.layers[${layerIndex}].assetVersionId`, message: 'Layer asset version does not exist.' });
        if (ready && !layer.assetVersionId && layer.source !== 'svg') issues.push({ path: `${shotPath}.layers[${layerIndex}].assetVersionId`, message: 'Every generated or local layer must point to an asset version before rendering.' });
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
      if (cue.startMs < beat.startMs || cue.endMs > beat.startMs + beat.durationMs || cue.endMs <= cue.startMs) issues.push({ path: cuePath, message: 'Subtitle cues must stay inside their beat and have positive duration.' });
    }
    expectedStartMs += beat.durationMs;
  }

  if (expectedStartMs > MAX_TOTAL_DURATION_MS) issues.push({ path: 'beats', message: `A collage short cannot exceed ${MAX_TOTAL_DURATION_MS / 1000}s.` });
  const selectedCandidates = data.styleCandidates.filter((candidate) => candidate.selected);
  if (data.selectedStyleId && !data.styleCandidates.some((candidate) => candidate.id === data.selectedStyleId)) {
    issues.push({ path: 'selectedStyleId', message: 'Selected style must reference a style candidate.' });
  }
  if (data.selectedStyleId && (selectedCandidates.length !== 1 || selectedCandidates[0].id !== data.selectedStyleId)) {
    issues.push({ path: 'styleCandidates', message: 'Exactly one style candidate must match the selected style.' });
  }
  if (ready) {
    if (!data.selectedStyleId) issues.push({ path: 'selectedStyleId', message: 'A style candidate must be selected before rendering.' });
    if (data.estimatedCost > 0 && !data.costApprovedAt) issues.push({ path: 'costApprovedAt', message: 'Paid generation requires an explicit cost approval timestamp.' });
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

function partitionEditorialSource(sourceText: string, count: number): string[] {
  const normalized = sourceText.replace(/\s+/gu, ' ').trim();
  const sentences = normalized.split(/(?<=[。！？!?；;])\s*/u).map((part) => part.trim()).filter(Boolean);
  if (sentences.length >= count) {
    const groups = Array.from({ length: count }, () => [] as string[]);
    sentences.forEach((sentence, index) => groups[Math.min(count - 1, Math.floor(index * count / sentences.length))].push(sentence));
    return groups.map((group) => group.join(' '));
  }
  const characters = [...normalized];
  const chunkSize = Math.max(1, Math.ceil(characters.length / count));
  return Array.from({ length: count }, (_, index) => characters.slice(index * chunkSize, (index + 1) * chunkSize).join('').trim());
}

function splitEditorialCueText(text: string): string[] {
  const characters = [...text.trim()];
  if (characters.length < 12) return [text.trim()];
  const midpoint = Math.ceil(characters.length / 2);
  return [characters.slice(0, midpoint).join('').trim(), characters.slice(midpoint).join('').trim()].filter(Boolean);
}
