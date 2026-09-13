import { z } from 'zod';
import { productionNarrationAlignmentEvidenceSchema } from './production-audio-alignment';
import { productionSubtitleLayoutEvidenceSchema } from './production-subtitle-layout';
import { productionVisualContinuityEvidenceSchema } from './production-visual-continuity';
import type { ProductionAssetVersion, ProductionDocumentBase, ProductionProviderJob, ProductionSubtitleCue, ProductionTimeline } from './production-workflow';
import { productionSubtitleCueSchema, validatePersistedSubtitleCue } from './production-subtitle-schema';
import { productionAudioFadeEnvelopeSchema, validateProductionAudioTimeline } from './production-audio';
import { hashSubtitleAlignment, invalidateSubtitleAlignment, isSubtitleAlignmentValid } from './audio-alignment';
import { MAX_PRODUCTION_HISTORY_ITEMS } from './production-history';

export const MOTION_COMIC_TASK_TYPE = 'motion-comic' as const;
export const MOTION_COMIC_PIPELINE_VERSION = 1 as const;
export const MOTION_COMIC_RATIOS = ['9:16', '16:9', '1:1', '4:3'] as const;
export const MOTION_COMIC_STAGES = [
  'draft',
  'series-bible',
  'character-bible',
  'episode-script',
  'shot-board',
  'keyframes',
  'audio',
  'assembly',
  'qa',
  'completed',
  'failed',
] as const;

export type MotionComicStage = (typeof MOTION_COMIC_STAGES)[number];

export interface MotionComicSeriesBible {
  id: string;
  title: string;
  premise: string;
  genre: string;
  tone: string;
  audience: string;
  worldRules: string[];
  visualRules: string[];
  negativePrompt: string;
  characterIds: string[];
  sceneAssetIds: string[];
  propAssetIds: string[];
}

export interface MotionComicCharacterLook {
  id: string;
  characterId: string;
  label: string;
  appearancePrompt: string;
  wardrobe: string;
  continuityNotes: string;
  referenceAssetVersionIds: string[];
  pinned: boolean;
}

export interface MotionComicCharacter {
  id: string;
  name: string;
  role: string;
  identityPrompt: string;
  personality: string;
  voiceNotes: string;
  voiceProvider?: 'volcengine' | 'minimax';
  voiceId?: string;
  voiceSpeed?: number;
  looks: MotionComicCharacterLook[];
}

export interface MotionComicSceneAsset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  continuityNotes: string;
  referenceAssetVersionIds: string[];
}

export interface MotionComicPropAsset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  referenceAssetVersionIds: string[];
}

export interface MotionComicDialogueCue extends ProductionSubtitleCue {
  shotId: string;
  characterId?: string;
  emotion: string;
  /** Legacy dialogue audio reference; new word alignment uses audioAssetVersionId. */
  voiceAssetVersionId?: string;
}

export interface MotionComicShot {
  id: string;
  episodeId: string;
  sceneId: string;
  index: number;
  title: string;
  durationMs: number;
  prompt: string;
  motionPrompt: string;
  framing: string;
  characterLookIds: string[];
  sceneAssetId: string;
  propAssetIds: string[];
  firstFrameAssetVersionId?: string;
  lastFrameAssetVersionId?: string;
  videoJobId?: string;
  dialogueCueIds: string[];
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

export interface MotionComicDramaticScene {
  id: string;
  episodeId: string;
  index: number;
  title: string;
  summary: string;
  locationAssetId: string;
  shots: MotionComicShot[];
}

export interface MotionComicEpisode {
  id: string;
  seriesId: string;
  number: number;
  title: string;
  logline: string;
  script: string;
  status: 'draft' | 'boarded' | 'keyframes' | 'audio' | 'assembled' | 'completed';
  scenes: MotionComicDramaticScene[];
  dialogueCues: MotionComicDialogueCue[];
  timeline: ProductionTimeline;
}

export interface MotionComicPipelineData extends Omit<ProductionDocumentBase, 'workflowKind' | 'timeline'> {
  version: 1;
  workflowKind: 'motion-comic';
  stage: MotionComicStage;
  series: MotionComicSeriesBible;
  characters: MotionComicCharacter[];
  sceneAssets: MotionComicSceneAsset[];
  props: MotionComicPropAsset[];
  episodes: MotionComicEpisode[];
  activeEpisodeId: string;
  estimatedCost: number;
  actualCost?: number;
  costApprovedAt?: string;
  costSummary?: string;
}

export interface MotionComicDraftInput {
  id: string;
  title: string;
  premise: string;
  ratio?: MotionComicPipelineData['ratio'];
  now?: string;
}

export interface MotionComicCreateInput {
  title: string;
  premise: string;
  episodeTitle?: string;
  ratio?: MotionComicPipelineData['ratio'];
}

export interface MotionComicSaveInput {
  id: string;
  expectedUpdatedAt: string;
  document: MotionComicPipelineData;
}

export interface MotionComicValidationIssue {
  path: string;
  message: string;
}

const MAX_TEXT = 1_000_000;
const MAX_ITEMS = 500;
const MAX_EPISODES = 100;
const MAX_SCENES_PER_EPISODE = 100;
const MAX_SHOTS_PER_SCENE = 100;
const MAX_RULES = 100;
const MAX_REFERENCES = 100;
const idSchema = z.string().trim().min(1).max(256);
const boundedText = (max = MAX_TEXT) => z.string().max(max);
const timestampSchema = z.string().max(64).refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp.');
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();

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
  workflowKind: z.literal(MOTION_COMIC_TASK_TYPE),
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

const timelineSchema = z.object({
  durationMs: nonNegativeNumber,
  clips: z.array(z.object({
    id: idSchema,
    shotId: idSchema,
    startMs: nonNegativeNumber,
    durationMs: nonNegativeNumber,
    assetVersionIds: z.array(idSchema).max(MAX_REFERENCES),
    subtitleCueIds: z.array(idSchema).max(MAX_REFERENCES),
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
  workflowKind: z.literal(MOTION_COMIC_TASK_TYPE),
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
      assetVersionIds: z.array(idSchema).max(MAX_REFERENCES).optional(),
      cueIds: z.array(idSchema).max(MAX_REFERENCES).optional(),
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

const seriesSchema = z.object({
  id: idSchema,
  title: z.string().max(512),
  premise: boundedText(),
  genre: z.string().max(256),
  tone: z.string().max(256),
  audience: z.string().max(256),
  worldRules: z.array(boundedText(4096)).max(MAX_RULES),
  visualRules: z.array(boundedText(4096)).max(MAX_RULES),
  negativePrompt: boundedText(65_536),
  characterIds: z.array(idSchema).max(MAX_REFERENCES),
  sceneAssetIds: z.array(idSchema).max(MAX_REFERENCES),
  propAssetIds: z.array(idSchema).max(MAX_REFERENCES),
}).strict();

const lookSchema = z.object({
  id: idSchema,
  characterId: idSchema,
  label: z.string().max(512),
  appearancePrompt: boundedText(65_536),
  wardrobe: boundedText(65_536),
  continuityNotes: boundedText(65_536),
  referenceAssetVersionIds: z.array(idSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  pinned: z.boolean(),
}).strict();

const characterSchema = z.object({
  id: idSchema,
  name: z.string().max(512),
  role: z.string().max(512),
  identityPrompt: boundedText(65_536),
  personality: boundedText(65_536),
  voiceNotes: boundedText(65_536),
  voiceProvider: z.enum(['volcengine', 'minimax']).optional(),
  voiceId: z.string().min(1).max(512).optional(),
  voiceSpeed: z.number().finite().min(0.5).max(2).optional(),
  looks: z.array(lookSchema).max(50),
}).strict();

const sceneAssetSchema = z.object({
  id: idSchema,
  label: z.string().max(512),
  description: boundedText(65_536),
  prompt: boundedText(65_536),
  continuityNotes: boundedText(65_536),
  referenceAssetVersionIds: z.array(idSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
}).strict();

const propSchema = z.object({
  id: idSchema,
  label: z.string().max(512),
  description: boundedText(65_536),
  prompt: boundedText(65_536),
  referenceAssetVersionIds: z.array(idSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
}).strict();

const dialogueCueSchema = productionSubtitleCueSchema.safeExtend({
  shotId: idSchema,
  characterId: idSchema.optional(),
  emotion: z.string().max(256),
  voiceAssetVersionId: idSchema.optional(),
}).strict();

const shotSchema = z.object({
  id: idSchema,
  episodeId: idSchema,
  sceneId: idSchema,
  index: z.number().int().min(1).max(MAX_SHOTS_PER_SCENE),
  title: z.string().max(512),
  durationMs: finiteNumber.positive().max(60_000),
  prompt: boundedText(65_536),
  motionPrompt: boundedText(65_536),
  framing: z.string().max(512),
  characterLookIds: z.array(idSchema).max(MAX_REFERENCES),
  sceneAssetId: idSchema,
  propAssetIds: z.array(idSchema).max(MAX_REFERENCES),
  firstFrameAssetVersionId: idSchema.optional(),
  lastFrameAssetVersionId: idSchema.optional(),
  videoJobId: idSchema.optional(),
  dialogueCueIds: z.array(idSchema).max(MAX_REFERENCES),
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

const dramaticSceneSchema = z.object({
  id: idSchema,
  episodeId: idSchema,
  index: z.number().int().min(1).max(MAX_SCENES_PER_EPISODE),
  title: z.string().max(512),
  summary: boundedText(65_536),
  locationAssetId: idSchema,
  shots: z.array(shotSchema).max(MAX_SHOTS_PER_SCENE),
}).strict();

const episodeSchema = z.object({
  id: idSchema,
  seriesId: idSchema,
  number: z.number().int().min(1).max(MAX_EPISODES),
  title: z.string().max(512),
  logline: boundedText(65_536),
  script: boundedText(),
  status: z.enum(['draft', 'boarded', 'keyframes', 'audio', 'assembled', 'completed']),
  scenes: z.array(dramaticSceneSchema).max(MAX_SCENES_PER_EPISODE),
  dialogueCues: z.array(dialogueCueSchema).max(MAX_ITEMS),
  timeline: timelineSchema,
}).strict();

export const motionComicPipelineSchema = z.object({
  version: z.literal(MOTION_COMIC_PIPELINE_VERSION),
  id: idSchema,
  workflowKind: z.literal(MOTION_COMIC_TASK_TYPE),
  title: z.string().max(512),
  ratio: z.enum(MOTION_COMIC_RATIOS),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  stage: z.enum(MOTION_COMIC_STAGES),
  series: seriesSchema,
  characters: z.array(characterSchema).max(MAX_ITEMS),
  sceneAssets: z.array(sceneAssetSchema).max(MAX_ITEMS),
  props: z.array(propSchema).max(MAX_ITEMS),
  episodes: z.array(episodeSchema).max(MAX_EPISODES),
  activeEpisodeId: idSchema,
  assets: z.array(assetVersionSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  providerJobs: z.array(providerJobSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  qualityReports: z.array(qualityReportSchema).max(MAX_PRODUCTION_HISTORY_ITEMS),
  estimatedCost: nonNegativeNumber,
  actualCost: nonNegativeNumber.optional(),
  costApprovedAt: timestampSchema.optional(),
  costSummary: boundedText(65_536).optional(),
}).strict();

export const motionComicCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(512),
  premise: z.string().trim().min(1).max(MAX_TEXT),
  episodeTitle: z.string().trim().min(1).max(512).optional(),
  ratio: z.enum(MOTION_COMIC_RATIOS).optional(),
}).strict();

export const motionComicSaveInputSchema = z.object({
  id: idSchema,
  expectedUpdatedAt: timestampSchema,
  document: motionComicPipelineSchema,
}).strict();

export function createMotionComicDraft(input: MotionComicDraftInput): MotionComicPipelineData {
  const now = input.now ?? new Date().toISOString();
  const title = input.title.trim();
  return {
    version: MOTION_COMIC_PIPELINE_VERSION,
    id: input.id,
    workflowKind: MOTION_COMIC_TASK_TYPE,
    title,
    ratio: input.ratio ?? '9:16',
    createdAt: now,
    updatedAt: now,
    stage: 'draft',
    series: {
      id: `series-${input.id}`,
      title,
      premise: input.premise.trim(),
      genre: '都市奇幻',
      tone: '悬念、克制、电影感',
      audience: '短视频剧情观众',
      worldRules: ['超自然规则必须可追踪，不能为反转临时改写。'],
      visualRules: ['角色脸型、发型和关键配饰跨镜头保持一致。', '同一场景保持主光方向和色温连续。'],
      negativePrompt: 'identity drift, costume drift, extra fingers, inconsistent props, unreadable text',
      characterIds: [],
      sceneAssetIds: [],
      propAssetIds: [],
    },
    characters: [],
    sceneAssets: [],
    props: [],
    episodes: [],
    activeEpisodeId: `episode-${input.id}-1`,
    assets: [],
    providerJobs: [],
    qualityReports: [],
    estimatedCost: 0,
  };
}

export function createMotionComicStarterProject(
  draft: MotionComicPipelineData,
  episodeTitle = '第一集',
  now = draft.updatedAt,
): MotionComicPipelineData {
  const episodeId = `episode-${draft.id}-1`;
  const protagonistId = `character-${draft.id}-protagonist`;
  const counterpartId = `character-${draft.id}-counterpart`;
  const protagonistLookId = `${protagonistId}-look-daily`;
  const counterpartLookId = `${counterpartId}-look-daily`;
  const sceneAssets: MotionComicSceneAsset[] = ['起点', '转折地', '揭示地'].map((label, index) => ({
    id: `scene-asset-${draft.id}-${index + 1}`,
    label,
    description: `${draft.series.premise}的第${index + 1}个固定场景`,
    prompt: `cinematic comic background, ${label}, stable architecture and lighting, no characters`,
    continuityNotes: '记录门窗、主光方向、时间与天气，跨镜头不得漂移。',
    referenceAssetVersionIds: [],
  }));
  const props: MotionComicPropAsset[] = [{
    id: `prop-${draft.id}-clue`,
    label: '关键线索',
    description: '推动本集反转的可见物件。',
    prompt: 'hero story prop, recognizable silhouette, consistent material and markings',
    referenceAssetVersionIds: [],
  }];
  const characters: MotionComicCharacter[] = [
    {
      id: protagonistId,
      name: '主角',
      role: '推动事件并承担选择的人',
      identityPrompt: 'young Chinese protagonist, distinctive eyes and stable facial proportions',
      personality: '敏锐、克制，遇到异常先观察再行动。',
      voiceNotes: '自然、低声、反应真实。',
      looks: [{
        id: protagonistLookId,
        characterId: protagonistId,
        label: '日常造型',
        appearancePrompt: 'stable face identity, dark straight hair, understated expression',
        wardrobe: '深色短外套、浅色内搭，固定衣领与袖口细节。',
        continuityNotes: '保留发型分缝、眼睛形状和外套轮廓。',
        referenceAssetVersionIds: [],
        pinned: true,
      }],
    },
    {
      id: counterpartId,
      name: '关键人物',
      role: '掌握信息并改变主角判断的人',
      identityPrompt: 'Chinese supporting character, calm gaze, stable facial geometry',
      personality: '信息克制，行动目的不完全公开。',
      voiceNotes: '语速平稳，关键句留停顿。',
      looks: [{
        id: counterpartLookId,
        characterId: counterpartId,
        label: '首次登场',
        appearancePrompt: 'stable face identity, neat silhouette, composed expression',
        wardrobe: '中性长外套，固定领口与配饰。',
        continuityNotes: '固定脸型、发际线与外套长度。',
        referenceAssetVersionIds: [],
        pinned: true,
      }],
    },
  ];

  const sceneTitles = ['异常出现', '线索升级', '选择与钩子'];
  const sceneSummaries = [
    `主角在日常环境里发现异常：${draft.series.premise}`,
    '关键人物出现，给出一条能被画面验证的新线索。',
    '主角作出选择，本集形成小闭环并留下下一集问题。',
  ];
  let timelineOffset = 0;
  const dialogueCues: MotionComicDialogueCue[] = [];
  const timelineClips: ProductionTimeline['clips'] = [];
  const scenes = sceneTitles.map((title, sceneIndex): MotionComicDramaticScene => {
    const sceneId = `${episodeId}-scene-${sceneIndex + 1}`;
    const shots = [0, 1].map((shotIndex): MotionComicShot => {
      const shotId = `${sceneId}-shot-${shotIndex + 1}`;
      const durationMs = sceneIndex === 0 && shotIndex === 0 ? 5_000 : 7_000;
      const dialogueCount = shotIndex === 0 ? 2 : 1;
      const cueIds = Array.from({ length: dialogueCount }, (_, cueIndex) => {
        const cueId = `${shotId}-cue-${cueIndex + 1}`;
        const cueStart = timelineOffset + Math.round((durationMs / dialogueCount) * cueIndex);
        const cueEnd = timelineOffset + Math.round((durationMs / dialogueCount) * (cueIndex + 1));
        dialogueCues.push({
          id: cueId,
          shotId,
          characterId: cueIndex === 0 ? protagonistId : counterpartId,
          startMs: cueStart,
          endMs: cueEnd,
          text: cueIndex === 0 ? `${title}，事情和预想的不一样。` : '先别下结论，看清楚这个细节。',
          emotion: sceneIndex === 0 ? '警觉' : sceneIndex === 1 ? '试探' : '坚定',
        });
        return cueId;
      });
      const shot: MotionComicShot = {
        id: shotId,
        episodeId,
        sceneId,
        index: shotIndex + 1,
        title: shotIndex === 0 ? `${title} · 建立` : `${title} · 推进`,
        durationMs,
        prompt: `cinematic motion comic panel, ${sceneSummaries[sceneIndex]}, coherent character identity`,
        motionPrompt: shotIndex === 0 ? 'slow camera push, restrained breathing and eye movement' : 'subtle parallax, controlled gesture, preserve face and costume',
        framing: shotIndex === 0 ? '中景建立' : '近景反应',
        characterLookIds: sceneIndex === 0 ? [protagonistLookId] : [protagonistLookId, counterpartLookId],
        sceneAssetId: sceneAssets[sceneIndex].id,
        propAssetIds: sceneIndex > 0 ? [props[0].id] : [],
        dialogueCueIds: cueIds,
      };
      timelineClips.push({
        id: `clip-${shotId}`,
        shotId,
        startMs: timelineOffset,
        durationMs,
        assetVersionIds: [],
        subtitleCueIds: cueIds,
        source: 'deterministic',
      });
      timelineOffset += durationMs;
      return shot;
    });
    return {
      id: sceneId,
      episodeId,
      index: sceneIndex + 1,
      title,
      summary: sceneSummaries[sceneIndex],
      locationAssetId: sceneAssets[sceneIndex].id,
      shots,
    };
  });
  const episode: MotionComicEpisode = {
    id: episodeId,
    seriesId: draft.series.id,
    number: 1,
    title: episodeTitle.trim() || '第一集',
    logline: draft.series.premise,
    script: `${draft.series.premise}\n\n异常出现，线索升级，主角作出选择并留下新的问题。`,
    status: 'boarded',
    scenes,
    dialogueCues,
    timeline: { durationMs: timelineOffset, clips: timelineClips, audioAssetVersionIds: [] },
  };

  return {
    ...draft,
    updatedAt: now,
    stage: 'shot-board',
    series: {
      ...draft.series,
      characterIds: characters.map((character) => character.id),
      sceneAssetIds: sceneAssets.map((scene) => scene.id),
      propAssetIds: props.map((prop) => prop.id),
    },
    characters,
    sceneAssets,
    props,
    episodes: [episode],
    activeEpisodeId: episode.id,
  };
}

export function appendMotionComicEpisode(
  document: MotionComicPipelineData,
  input: { id?: string; title?: string; now?: string } = {},
): MotionComicPipelineData {
  const source = document.episodes.find((episode) => episode.id === document.activeEpisodeId) ?? document.episodes[0];
  if (!source) throw new Error('MOTION_COMIC_EPISODE_MISSING: Cannot append an episode without a source episode.');
  const episodeNumber = document.episodes.length + 1;
  const episodeId = input.id ?? `episode-${document.id}-${episodeNumber}`;
  if (document.episodes.some((episode) => episode.id === episodeId)) throw new Error(`MOTION_COMIC_DUPLICATE_ID: Episode ${episodeId} already exists.`);
  const sceneIdMap = new Map<string, string>();
  const shotIdMap = new Map<string, string>();
  const cueIdMap = new Map<string, string>();
  const scenes = source.scenes.map((scene) => {
    const nextSceneId = `${episodeId}-${scene.index}`;
    sceneIdMap.set(scene.id, nextSceneId);
    return {
      ...scene,
      id: nextSceneId,
      episodeId,
      shots: scene.shots.map((shot) => {
        const nextShotId = `${nextSceneId}-shot-${shot.index}`;
        shotIdMap.set(shot.id, nextShotId);
        return {
          ...shot,
          id: nextShotId,
          episodeId,
          sceneId: nextSceneId,
          firstFrameAssetVersionId: undefined,
          lastFrameAssetVersionId: undefined,
          videoJobId: undefined,
          voiceAssetVersionId: undefined,
          dialogueCueIds: shot.dialogueCueIds.map((cueId, cueIndex) => {
            const nextCueId = `${nextShotId}-cue-${cueIndex + 1}`;
            cueIdMap.set(cueId, nextCueId);
            return nextCueId;
          }),
        };
      }),
    };
  });
  let offsetMs = 0;
  const dialogueCues = source.dialogueCues.map((cue) => {
    const nextCueId = cueIdMap.get(cue.id) ?? `${episodeId}-cue-${cue.id}`;
    const nextShotId = shotIdMap.get(cue.shotId) ?? cue.shotId;
    const shot = scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === nextShotId);
    const durationMs = shot ? Math.max(1, Math.round((shot.durationMs / Math.max(1, source.dialogueCues.filter((item) => item.shotId === cue.shotId).length)))) : Math.max(1, cue.endMs - cue.startMs);
    const shotStartMs = scenes.flatMap((scene) => scene.shots).slice(0, scenes.flatMap((candidate) => candidate.shots).findIndex((candidate) => candidate.id === nextShotId)).reduce((total, candidate) => total + candidate.durationMs, 0);
    const cueIndex = source.dialogueCues.filter((item) => item.shotId === cue.shotId).findIndex((item) => item.id === cue.id);
    const startMs = shotStartMs + cueIndex * durationMs;
    offsetMs = Math.max(offsetMs, startMs + durationMs);
    const next = invalidateSubtitleAlignment({ ...cue, id: nextCueId, shotId: nextShotId, startMs, endMs: startMs + durationMs }, { audioAssetVersionId: null }) as MotionComicDialogueCue;
    delete next.voiceAssetVersionId;
    return next;
  });
  const clips: ProductionTimeline['clips'] = [];
  let timelineOffset = 0;
  scenes.forEach((scene) => scene.shots.forEach((shot) => {
    const subtitleCueIds = shot.dialogueCueIds;
    clips.push({ id: `clip-${shot.id}`, shotId: shot.id, startMs: timelineOffset, durationMs: shot.durationMs, assetVersionIds: [], subtitleCueIds, source: 'deterministic' });
    timelineOffset += shot.durationMs;
  }));
  const episode: MotionComicEpisode = {
    id: episodeId,
    seriesId: document.series.id,
    number: episodeNumber,
    title: input.title?.trim() || `第${episodeNumber}集`,
    logline: source.logline,
    script: source.script,
    status: 'boarded',
    scenes,
    dialogueCues,
    timeline: { durationMs: timelineOffset, clips, audioAssetVersionIds: [] },
  };
  return { ...document, stage: 'shot-board', episodes: [...document.episodes, episode], activeEpisodeId: episodeId };
}

/** Rebuilds the canonical episode projection after any shot structure edit. */
export function rebuildMotionComicEpisode(episode: MotionComicEpisode): MotionComicEpisode {
  const shots = episode.scenes.flatMap((scene) => scene.shots);
  const oldClips = new Map(episode.timeline.clips.map((clip) => [clip.shotId, clip]));
  const oldCues = new Map(episode.dialogueCues.map((cue) => [cue.id, cue]));
  let offsetMs = 0;
  const clips: ProductionTimeline['clips'] = [];
  const dialogueCues: MotionComicDialogueCue[] = [];
  for (const shot of shots) {
    const previous = oldClips.get(shot.id);
    const oldStart = previous?.startMs ?? 0;
    const timeScale = previous ? shot.durationMs / previous.durationMs : 1;
    for (const cueId of shot.dialogueCueIds) {
      const cue = oldCues.get(cueId);
      if (!cue) continue;
      // New shots use local cue times. Existing shots retain their relative
      // timing on moves; resizing scales cue boundaries as one sequence.
      const startMs = offsetMs + Math.max(0, Math.min(shot.durationMs - 1, Math.round((cue.startMs - oldStart) * timeScale)));
      const endMs = Math.max(startMs + 1, offsetMs + Math.min(shot.durationMs, Math.round((cue.endMs - oldStart) * timeScale)));
      const next = { ...cue, startMs, endMs };
      if (cue.startMs === startMs && cue.endMs === endMs) dialogueCues.push(next);
      else if (timeScale === 1 && endMs - startMs === cue.endMs - cue.startMs && isSubtitleAlignmentValid(cue)) {
        const delta = startMs - cue.startMs;
        dialogueCues.push({ ...next, tokens: cue.tokens?.map((token) => ({ ...token, startMs: token.startMs + delta, endMs: token.endMs + delta })), alignmentFingerprint: hashSubtitleAlignment(next) });
      } else dialogueCues.push(invalidateSubtitleAlignment(next) as MotionComicDialogueCue);
    }
    clips.push({
      id: previous?.id ?? `clip-${shot.id}`,
      shotId: shot.id,
      startMs: offsetMs,
      durationMs: shot.durationMs,
      assetVersionIds: previous?.assetVersionIds.slice() ?? [],
      subtitleCueIds: shot.dialogueCueIds.slice(),
      source: previous?.source ?? 'deterministic',
    });
    offsetMs += shot.durationMs;
  }
  const validShotIds = new Set(shots.map((shot) => shot.id));
  const oldAudio = episode.timeline.audioClips ?? [];
  const audioClips = oldAudio
    .filter((clip) => !clip.shotId || validShotIds.has(clip.shotId))
    .flatMap((clip) => {
      if (!clip.shotId) return [{ ...clip }];
      const oldStart = oldClips.get(clip.shotId)?.startMs;
      const nextClip = clips.find((candidate) => candidate.shotId === clip.shotId);
      if (oldStart === undefined || !nextClip) return [];
      const relativeStart = Math.max(0, clip.startMs - oldStart);
      if (relativeStart >= nextClip.durationMs) return [];
      const available = nextClip.durationMs - relativeStart;
      const requested = clip.durationMs ?? clip.sourceDurationMs;
      const durationMs = Math.max(1, Math.min(requested ?? available, available));
      return [{
        ...clip,
        startMs: nextClip.startMs + relativeStart,
        ...(requested === undefined ? {} : { durationMs }),
        ...(clip.fadeInMs === undefined ? {} : { fadeInMs: Math.min(clip.fadeInMs, durationMs) }),
        ...(clip.fadeOutMs === undefined ? {} : { fadeOutMs: Math.min(clip.fadeOutMs, durationMs) }),
      }];
    });
  return {
    ...episode,
    scenes: episode.scenes.map((scene, sceneIndex) => ({
      ...scene,
      index: sceneIndex + 1,
      shots: scene.shots.map((shot, shotIndex) => ({ ...shot, index: shotIndex + 1 })),
    })),
    dialogueCues,
    timeline: {
      ...episode.timeline, durationMs: offsetMs, clips,
      audioAssetVersionIds: [...new Set([
        ...shots.flatMap((shot) => shot.voiceAssetVersionId ?? []),
        ...dialogueCues.flatMap((cue) => [cue.voiceAssetVersionId, cue.audioAssetVersionId].filter((id): id is string => Boolean(id))),
        ...audioClips.map((clip) => clip.assetVersionId),
      ])],
      ...(episode.timeline.audioClips ? { audioClips } : {}),
    },
  };
}

function invalidateMotionComicEpisodeOutput(document: MotionComicPipelineData, episodeId: string): ProductionAssetVersion[] {
  return document.assets.map((asset) => asset.assetId === 'director-final-video' && asset.episodeId === episodeId
    ? { ...asset, selected: false, pinned: false }
    : asset);
}

export function updateMotionComicShotDuration(
  document: MotionComicPipelineData,
  episodeId: string,
  shotId: string,
  durationMs: number,
): MotionComicPipelineData {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 60_000) throw new Error('MOTION_COMIC_INVALID_DURATION: Shot duration must be an integer between 1 and 60000 ms.');
  const owner = document.episodes.find((episode) => episode.id === episodeId);
  const shot = owner?.scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === shotId);
  if (!owner || !shot) throw new Error(`MOTION_COMIC_SHOT_MISSING: ${shotId}`);
  if (durationMs === shot.durationMs) return document;
  if (durationMs < shot.dialogueCueIds.length) throw new Error('MOTION_COMIC_INVALID_DURATION: Duration must allow at least one millisecond per dialogue cue.');
  const staleAudioIds = new Set([shot.voiceAssetVersionId, ...owner.dialogueCues.filter((cue) => cue.shotId === shotId).flatMap((cue) => [cue.voiceAssetVersionId, cue.audioAssetVersionId])].filter(Boolean));
  const episodes = document.episodes.map((episode) => {
    if (episode.id !== episodeId) return episode;
    const next: MotionComicEpisode = {
      ...episode, status: 'boarded',
      scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((candidate) => candidate.id === shotId
        ? { ...candidate, durationMs, videoJobId: undefined, voiceAssetVersionId: undefined }
        : candidate) })),
      dialogueCues: episode.dialogueCues.map((cue) => {
        if (cue.shotId !== shotId) return cue;
        const nextCue = invalidateSubtitleAlignment(cue, { audioAssetVersionId: null }) as MotionComicDialogueCue;
        delete nextCue.voiceAssetVersionId;
        return nextCue;
      }),
      timeline: {
        ...episode.timeline,
        clips: episode.timeline.clips.map((clip) => clip.shotId === shotId ? { ...clip, assetVersionIds: clip.assetVersionIds.filter((id) => !staleAudioIds.has(id)) } : clip),
        ...(episode.timeline.audioClips ? { audioClips: episode.timeline.audioClips.filter((clip) => clip.shotId !== shotId || !['dialogue', 'narration'].includes(clip.trackType)) } : {}),
      },
    };
    return rebuildMotionComicEpisode(next);
  });
  return {
    ...document,
    stage: 'shot-board',
    activeEpisodeId: episodeId,
    assets: invalidateMotionComicEpisodeOutput(document, episodeId),
    episodes,
  };
}

export function removeMotionComicShot(
  document: MotionComicPipelineData,
  episodeId: string,
  shotId: string,
): MotionComicPipelineData {
  let found = false;
  const episodes = document.episodes.map((episode) => {
    if (episode.id !== episodeId) return episode;
    const target = episode.scenes.some((scene) => scene.shots.some((shot) => shot.id === shotId));
    if (!target) return episode;
    found = true;
    if (episode.scenes.flatMap((scene) => scene.shots).length <= 1) throw new Error('MOTION_COMIC_LAST_SHOT: Keep at least one shot in the episode.');
    const next: MotionComicEpisode = { ...episode, status: 'boarded', scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.filter((shot) => shot.id !== shotId) })), dialogueCues: episode.dialogueCues.filter((cue) => cue.shotId !== shotId) };
    return rebuildMotionComicEpisode(next);
  });
  if (!found) throw new Error(`MOTION_COMIC_SHOT_MISSING: ${shotId}`);
  return { ...document, stage: 'shot-board', activeEpisodeId: episodeId, assets: invalidateMotionComicEpisodeOutput(document, episodeId), episodes };
}

export function reorderMotionComicShot(
  document: MotionComicPipelineData,
  episodeId: string,
  shotId: string,
  targetSceneId: string,
  targetIndex: number,
): MotionComicPipelineData {
  if (!Number.isFinite(targetIndex) || !Number.isInteger(targetIndex)) throw new Error('MOTION_COMIC_INVALID_INDEX: Shot order must be an integer.');
  const episode = document.episodes.find((candidate) => candidate.id === episodeId);
  if (!episode) throw new Error(`MOTION_COMIC_EPISODE_MISSING: ${episodeId}`);
  const sourceScene = episode.scenes.find((scene) => scene.shots.some((shot) => shot.id === shotId));
  const targetScene = episode.scenes.find((scene) => scene.id === targetSceneId);
  if (!sourceScene || !targetScene) throw new Error(`MOTION_COMIC_SHOT_MISSING: ${shotId}`);
  const shot = sourceScene.shots.find((candidate) => candidate.id === shotId)!;
  const scenes = episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.filter((candidate) => candidate.id !== shotId) }));
  const destination = scenes.find((scene) => scene.id === targetSceneId)!;
  const index = Math.max(0, Math.min(targetIndex, destination.shots.length));
  destination.shots.splice(index, 0, { ...shot, sceneId: targetSceneId });
  const next = rebuildMotionComicEpisode({ ...episode, status: 'boarded', scenes });
  return { ...document, stage: 'shot-board', activeEpisodeId: episodeId, assets: invalidateMotionComicEpisodeOutput(document, episodeId), episodes: document.episodes.map((candidate) => candidate.id === episodeId ? next : candidate) };
}

export function appendMotionComicScene(
  document: MotionComicPipelineData,
  episodeId: string,
  input: { id?: string; title?: string; now?: string } = {},
): MotionComicPipelineData {
  const episode = document.episodes.find((candidate) => candidate.id === episodeId);
  if (!episode) throw new Error(`MOTION_COMIC_EPISODE_MISSING: ${episodeId}`);
  const sceneIndex = episode.scenes.length + 1;
  const sceneId = input.id ?? `${episodeId}-scene-${sceneIndex}`;
  const shotId = `${sceneId}-shot-1`;
  const cueId = `${shotId}-cue-1`;
  const sceneAssetId = document.sceneAssets[0]?.id;
  const lookIds = document.characters.flatMap((character) => character.looks.filter((look) => look.pinned).map((look) => look.id)).slice(0, 2);
  if (!sceneAssetId || lookIds.length === 0) throw new Error('MOTION_COMIC_CONSISTENCY_MISSING: Add a scene asset and pinned character look first.');
  const durationMs = 6_000;
  const scene: MotionComicDramaticScene = {
    id: sceneId,
    episodeId,
    index: sceneIndex,
    title: input.title?.trim() || `场景 ${sceneIndex}`,
    summary: '新增场景，等待补充剧情与一致性引用。',
    locationAssetId: sceneAssetId,
    shots: [{
      id: shotId,
      episodeId,
      sceneId,
      index: 1,
      title: '新增镜头',
      durationMs,
      prompt: 'cinematic motion comic establishing panel, preserve all pinned character and location references',
      motionPrompt: 'subtle parallax, restrained camera push',
      framing: '中景建立',
      characterLookIds: lookIds,
      sceneAssetId,
      propAssetIds: [],
      dialogueCueIds: [cueId],
    }],
  };
  const cue: MotionComicDialogueCue = { id: cueId, shotId, characterId: document.characters[0]?.id, startMs: 0, endMs: durationMs, text: '新的线索出现了。', emotion: '警觉' };
  return {
    ...document,
    stage: 'shot-board',
    activeEpisodeId: episodeId,
    assets: invalidateMotionComicEpisodeOutput(document, episodeId),
    episodes: document.episodes.map((candidate) => candidate.id !== episodeId ? candidate : rebuildMotionComicEpisode({
      ...candidate, status: 'boarded', scenes: [...candidate.scenes, scene], dialogueCues: [...candidate.dialogueCues, cue],
    })),
  };
}

export function appendMotionComicShot(
  document: MotionComicPipelineData,
  episodeId: string,
  sceneId: string,
  input: { id?: string; title?: string; now?: string } = {},
): MotionComicPipelineData {
  const episode = document.episodes.find((candidate) => candidate.id === episodeId);
  const scene = episode?.scenes.find((candidate) => candidate.id === sceneId);
  if (!episode || !scene) throw new Error(`MOTION_COMIC_SCENE_MISSING: ${sceneId}`);
  const shotIndex = scene.shots.length + 1;
  const shotId = input.id ?? `${sceneId}-shot-${shotIndex}`;
  const cueId = `${shotId}-cue-1`;
  const durationMs = 6_000;
  const template = scene.shots[0];
  if (!template) throw new Error('MOTION_COMIC_SCENE_EMPTY: Add a scene before adding a shot.');
  const shot: MotionComicShot = { ...template, id: shotId, index: shotIndex, title: input.title?.trim() || `镜头 ${shotIndex}`, durationMs, dialogueCueIds: [cueId], firstFrameAssetVersionId: undefined, lastFrameAssetVersionId: undefined, videoJobId: undefined, voiceAssetVersionId: undefined };
  const cue: MotionComicDialogueCue = { id: cueId, shotId, characterId: document.characters[0]?.id, startMs: 0, endMs: durationMs, text: '镜头里的细节改变了判断。', emotion: '试探' };
  return {
    ...document,
    stage: 'shot-board',
    activeEpisodeId: episodeId,
    assets: invalidateMotionComicEpisodeOutput(document, episodeId),
    episodes: document.episodes.map((candidate) => candidate.id !== episodeId ? candidate : rebuildMotionComicEpisode({
      ...candidate, status: 'boarded',
      scenes: candidate.scenes.map((currentScene) => currentScene.id !== sceneId ? currentScene : { ...currentScene, shots: [...currentScene.shots, shot] }),
      dialogueCues: [...candidate.dialogueCues, cue],
    })),
  };
}

export function removeMotionComicShot(
  document: MotionComicPipelineData,
  episodeId: string,
  sceneId: string,
  shotId: string,
): MotionComicPipelineData {
  const episode = document.episodes.find((candidate) => candidate.id === episodeId);
  const scene = episode?.scenes.find((candidate) => candidate.id === sceneId);
  const shot = scene?.shots.find((candidate) => candidate.id === shotId);
  if (!episode || !scene || !shot) throw new Error(`MOTION_COMIC_SHOT_MISSING: ${shotId}`);
  const remainingShotCount = episode.scenes.reduce((total, candidate) => total + candidate.shots.length, 0) - 1;
  if (remainingShotCount < 1) throw new Error('MOTION_COMIC_SHOT_REQUIRED: 至少保留一个镜头。');
  const cueIds = new Set(shot.dialogueCueIds);
  const jobIds = new Set(document.providerJobs.filter((job) => job.nodeId === shot.id).map((job) => job.id));
  const assetIds = new Set(document.assets.filter((asset) => asset.providerJobId && jobIds.has(asset.providerJobId)).map((asset) => asset.id));
  return normalizeMotionComicTimeline({
    ...document,
    stage: 'shot-board',
    episodes: document.episodes.map((candidate) => candidate.id !== episodeId ? candidate : {
      ...candidate,
      scenes: candidate.scenes.map((currentScene) => currentScene.id !== sceneId ? currentScene : { ...currentScene, shots: currentScene.shots.filter((currentShot) => currentShot.id !== shotId) }),
      dialogueCues: candidate.dialogueCues.filter((cue) => !cueIds.has(cue.id)),
    }),
    providerJobs: document.providerJobs.filter((job) => !jobIds.has(job.id)),
    assets: document.assets.filter((asset) => !assetIds.has(asset.id)),
    qualityReports: [],
  });
}

export function moveMotionComicShot(
  document: MotionComicPipelineData,
  episodeId: string,
  sceneId: string,
  shotId: string,
  direction: -1 | 1,
): MotionComicPipelineData {
  const episode = document.episodes.find((candidate) => candidate.id === episodeId);
  const scene = episode?.scenes.find((candidate) => candidate.id === sceneId);
  const index = scene?.shots.findIndex((shot) => shot.id === shotId) ?? -1;
  const target = index + direction;
  if (!episode || !scene || index < 0) throw new Error(`MOTION_COMIC_SHOT_MISSING: ${shotId}`);
  if (target < 0 || target >= scene.shots.length) return document;
  const shots = [...scene.shots];
  [shots[index], shots[target]] = [shots[target], shots[index]];
  return normalizeMotionComicTimeline({
    ...document,
    stage: 'shot-board',
    episodes: document.episodes.map((candidate) => candidate.id !== episodeId ? candidate : { ...candidate, scenes: candidate.scenes.map((currentScene) => currentScene.id === sceneId ? { ...currentScene, shots } : currentScene) }),
    qualityReports: [],
  });
}

function normalizeMotionComicTimeline(document: MotionComicPipelineData): MotionComicPipelineData {
  const episodes = document.episodes.map((episode, episodeIndex) => {
    let cursor = 0;
    const dialogueCues = episode.dialogueCues.map((cue) => ({ ...cue }));
    const priorClips = new Map(episode.timeline.clips.map((clip) => [clip.shotId, clip] as const));
    const scenes = episode.scenes.map((scene, sceneIndex) => {
      const shots = scene.shots.map((shot, shotIndex) => {
        const startMs = cursor;
        const durationMs = Math.max(1, shot.durationMs);
        const cues = shot.dialogueCueIds.flatMap((cueId) => {
          const cue = dialogueCues.find((candidate) => candidate.id === cueId);
          return cue ? [cue] : [];
        });
        cues.forEach((cue, cueIndex) => {
          cue.startMs = startMs + Math.round(durationMs * cueIndex / Math.max(1, cues.length));
          cue.endMs = startMs + Math.round(durationMs * (cueIndex + 1) / Math.max(1, cues.length));
        });
        cursor += durationMs;
        return { ...shot, index: shotIndex + 1, durationMs };
      });
      return { ...scene, index: sceneIndex + 1, shots };
    });
    const clips = scenes.flatMap((scene) => scene.shots.map((shot) => {
      const startMs = scenes.slice(0, scenes.findIndex((candidate) => candidate.id === scene.id)).flatMap((candidate) => candidate.shots).reduce((sum, candidate) => sum + candidate.durationMs, 0)
        + scene.shots.slice(0, scene.shots.findIndex((candidate) => candidate.id === shot.id)).reduce((sum, candidate) => sum + candidate.durationMs, 0);
      const prior = priorClips.get(shot.id);
      return { id: `clip-${shot.id}`, shotId: shot.id, startMs, durationMs: shot.durationMs, assetVersionIds: prior?.assetVersionIds ?? [], subtitleCueIds: shot.dialogueCueIds, source: prior?.source ?? 'deterministic' as const };
    }));
    return { ...episode, number: episodeIndex + 1, scenes, dialogueCues, timeline: { ...episode.timeline, durationMs: cursor, clips } };
  });
  return { ...document, episodes, activeEpisodeId: episodes.some((episode) => episode.id === document.activeEpisodeId) ? document.activeEpisodeId : episodes[0]?.id ?? '' };
}

export function parseMotionComicPipelineData(input: unknown): MotionComicPipelineData {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new Error('MOTION_COMIC_INVALID_JSON: Motion comic project data is not valid JSON.');
    }
  }
  const parsed = motionComicPipelineSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`MOTION_COMIC_INVALID_DATA: ${issue.path.join('.') || 'document'} ${issue.message}`);
  }
  const document = parsed.data as MotionComicPipelineData;
  // Repair the old append-to-episode bug only when all original clips are
  // present, contiguous and correctly sized. Unknown corruption still fails.
  document.episodes = document.episodes.map((episode) => {
    const ordered = episode.scenes.flatMap((scene) => scene.shots);
    if (episode.timeline.clips.every((clip, index) => clip.shotId === ordered[index]?.id)) return episode;
    let endMs = 0;
    const seen = new Set<string>();
    const canRepair = episode.timeline.clips.length === ordered.length && episode.timeline.clips.every((clip) => {
      const shot = ordered.find((candidate) => candidate.id === clip.shotId);
      const valid = shot && !seen.has(clip.shotId) && clip.startMs === endMs && clip.durationMs === shot.durationMs;
      seen.add(clip.shotId);
      endMs += clip.durationMs;
      return valid;
    }) && endMs === episode.timeline.durationMs;
    return canRepair ? rebuildMotionComicEpisode(episode) : episode;
  });
  const issues = validateMotionComicPipeline(document);
  if (issues.length > 0) throw new Error(`MOTION_COMIC_INVALID_DATA: ${issues[0].path} ${issues[0].message}`);
  return document;
}

export function motionComicReferencesImageLabRecord(data: MotionComicPipelineData, recordId: string): boolean {
  const uri = `storydream:image-lab/${recordId}`;
  return data.assets.some((asset) => asset.uri === uri);
}

export function validateMotionComicPipeline(
  data: MotionComicPipelineData,
  options: { ready?: boolean } = {},
): MotionComicValidationIssue[] {
  const issues: MotionComicValidationIssue[] = [];
  const ready = options.ready ?? false;
  const assets = uniqueIdMap(data.assets, 'assets', issues);
  const jobs = uniqueIdMap(data.providerJobs, 'providerJobs', issues);
  const characters = uniqueIdMap(data.characters, 'characters', issues);
  const sceneAssets = uniqueIdMap(data.sceneAssets, 'sceneAssets', issues);
  const props = uniqueIdMap(data.props, 'props', issues);
  const episodes = uniqueIdMap(data.episodes, 'episodes', issues);
  const shotFrameAssetVersionIds = new Set(data.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots.flatMap((shot) => [
    shot.firstFrameAssetVersionId,
    shot.lastFrameAssetVersionId,
  ].filter((id): id is string => Boolean(id))))));

  if (!data.title.trim()) issues.push({ path: 'title', message: 'A project title is required.' });
  if (!episodes.has(data.activeEpisodeId)) issues.push({ path: 'activeEpisodeId', message: 'The active episode must exist.' });
  validateReferenceList(data.series.characterIds, characters, 'series.characterIds', issues);
  validateReferenceList(data.series.sceneAssetIds, sceneAssets, 'series.sceneAssetIds', issues);
  validateReferenceList(data.series.propAssetIds, props, 'series.propAssetIds', issues);
  if (ready && (!data.series.premise.trim() || data.series.worldRules.length === 0 || data.series.visualRules.length === 0)) {
    issues.push({ path: 'series', message: 'A ready series needs a premise plus world and visual rules.' });
  }

  const looks = new Map<string, MotionComicCharacterLook>();
  data.characters.forEach((character, characterIndex) => {
    const lookIds = new Set<string>();
    character.looks.forEach((look, lookIndex) => {
      const path = `characters[${characterIndex}].looks[${lookIndex}]`;
      if (lookIds.has(look.id) || looks.has(look.id)) issues.push({ path: `${path}.id`, message: 'Character look ids must be globally unique.' });
      lookIds.add(look.id);
      looks.set(look.id, look);
      if (look.characterId !== character.id) issues.push({ path: `${path}.characterId`, message: 'A look must reference its owning character.' });
      validateMotionComicReferenceList(
        look.referenceAssetVersionIds,
        assets,
        jobs,
        shotFrameAssetVersionIds,
        { kind: 'look', id: look.id },
        `${path}.referenceAssetVersionIds`,
        issues,
      );
    });
    if (ready && !character.looks.some((look) => look.pinned && look.referenceAssetVersionIds.length > 0)) {
      issues.push({ path: `characters[${characterIndex}].looks`, message: 'Each ready character needs a pinned look with reference assets.' });
    }
  });
  data.sceneAssets.forEach((scene, index) => validateMotionComicReferenceList(
    scene.referenceAssetVersionIds,
    assets,
    jobs,
    shotFrameAssetVersionIds,
    { kind: 'scene', id: scene.id },
    `sceneAssets[${index}].referenceAssetVersionIds`,
    issues,
  ));
  data.props.forEach((prop, index) => validateMotionComicReferenceList(
    prop.referenceAssetVersionIds,
    assets,
    jobs,
    shotFrameAssetVersionIds,
    { kind: 'prop', id: prop.id },
    `props[${index}].referenceAssetVersionIds`,
    issues,
  ));

  const allShots = new Map<string, MotionComicShot>();
  data.episodes.forEach((episode, episodeIndex) => {
    const episodePath = `episodes[${episodeIndex}]`;
    if (episode.seriesId !== data.series.id) issues.push({ path: `${episodePath}.seriesId`, message: 'Episode must reference this series.' });
    if (episode.number !== episodeIndex + 1) issues.push({ path: `${episodePath}.number`, message: 'Episode numbers must be contiguous and 1-based.' });
    const sceneIds = new Set<string>();
    const dialogue = uniqueIdMap(episode.dialogueCues, `${episodePath}.dialogueCues`, issues);
    const episodeShots = new Map<string, MotionComicShot>();
    episode.scenes.forEach((scene, sceneIndex) => {
      const scenePath = `${episodePath}.scenes[${sceneIndex}]`;
      if (sceneIds.has(scene.id)) issues.push({ path: `${scenePath}.id`, message: 'Scene ids must be unique inside an episode.' });
      sceneIds.add(scene.id);
      if (scene.episodeId !== episode.id) issues.push({ path: `${scenePath}.episodeId`, message: 'Scene must reference its owning episode.' });
      if (scene.index !== sceneIndex + 1) issues.push({ path: `${scenePath}.index`, message: 'Scene indexes must be contiguous and 1-based.' });
      if (!sceneAssets.has(scene.locationAssetId)) issues.push({ path: `${scenePath}.locationAssetId`, message: 'Scene location must reference a series scene asset.' });
      scene.shots.forEach((shot, shotIndex) => {
        const shotPath = `${scenePath}.shots[${shotIndex}]`;
        if (allShots.has(shot.id)) issues.push({ path: `${shotPath}.id`, message: 'Shot ids must be globally unique.' });
        allShots.set(shot.id, shot);
        episodeShots.set(shot.id, shot);
        if (shot.episodeId !== episode.id || shot.sceneId !== scene.id) issues.push({ path: shotPath, message: 'Shot ownership references must match its episode and scene.' });
        if (shot.index !== shotIndex + 1) issues.push({ path: `${shotPath}.index`, message: 'Shot indexes must be contiguous and 1-based inside a scene.' });
        validateReferenceList(shot.characterLookIds, looks, `${shotPath}.characterLookIds`, issues);
        if (!sceneAssets.has(shot.sceneAssetId)) issues.push({ path: `${shotPath}.sceneAssetId`, message: 'Shot must reference a series scene asset.' });
        validateReferenceList(shot.propAssetIds, props, `${shotPath}.propAssetIds`, issues);
        validateReferenceList(shot.dialogueCueIds, dialogue, `${shotPath}.dialogueCueIds`, issues);
        for (const cueId of shot.dialogueCueIds) {
          if (dialogue.get(cueId)?.shotId !== shot.id) issues.push({ path: `${shotPath}.dialogueCueIds`, message: 'Dialogue cues must belong to the referencing shot.' });
        }
        validateMotionComicFrameAsset(shot.firstFrameAssetVersionId, assets, `${shotPath}.firstFrameAssetVersionId`, 'First', issues);
        validateMotionComicFrameAsset(shot.lastFrameAssetVersionId, assets, `${shotPath}.lastFrameAssetVersionId`, 'Last', issues);
        if (shot.videoJobId && !jobs.has(shot.videoJobId)) issues.push({ path: `${shotPath}.videoJobId`, message: 'Video job does not exist.' });
        if (shot.voiceAssetVersionId && !assets.has(shot.voiceAssetVersionId)) issues.push({ path: `${shotPath}.voiceAssetVersionId`, message: 'Shot voice asset does not exist.' });
        if (ready) {
          if (shot.characterLookIds.length === 0) issues.push({ path: `${shotPath}.characterLookIds`, message: 'A ready shot needs at least one character look.' });
          if (shot.characterLookIds.some((lookId) => !looks.get(lookId)?.pinned)) issues.push({ path: `${shotPath}.characterLookIds`, message: 'Ready shots may only use pinned looks.' });
          if (!shot.firstFrameAssetVersionId) issues.push({ path: `${shotPath}.firstFrameAssetVersionId`, message: 'A ready shot needs an approved first frame.' });
        }
      });
    });
    episode.dialogueCues.forEach((cue, cueIndex) => {
      const path = `${episodePath}.dialogueCues[${cueIndex}]`;
      if (!episodeShots.has(cue.shotId)) issues.push({ path: `${path}.shotId`, message: 'Dialogue cue must reference a shot in this episode.' });
      if (cue.characterId && !characters.has(cue.characterId)) issues.push({ path: `${path}.characterId`, message: 'Dialogue character does not exist.' });
      if (cue.endMs <= cue.startMs || cue.endMs > episode.timeline.durationMs) issues.push({ path, message: 'Dialogue timing must be positive and remain inside the episode timeline.' });
      if (cue.voiceAssetVersionId && !assets.has(cue.voiceAssetVersionId)) issues.push({ path: `${path}.voiceAssetVersionId`, message: 'Dialogue voice asset does not exist.' });
      for (const issue of validatePersistedSubtitleCue(cue)) issues.push({ path: `${path}.${issue.path}`, message: issue.message });
      if (cue.audioAssetVersionId && assets.get(cue.audioAssetVersionId)?.kind !== 'audio') issues.push({ path: `${path}.audioAssetVersionId`, message: 'Dialogue audio reference must point to an existing audio asset.' });
      const clip = episode.timeline.clips.find((item) => item.shotId === cue.shotId);
      if (clip && (cue.startMs < clip.startMs || cue.endMs > clip.startMs + clip.durationMs)) issues.push({ path, message: 'Dialogue cues must stay inside their owning shot timeline clip.' });
    });
    validateEpisodeTimeline(episode, episodeShots, dialogue, assets, issues, episodePath);
  });
  return issues;
}

function validateEpisodeTimeline(
  episode: MotionComicEpisode,
  shots: Map<string, MotionComicShot>,
  dialogue: Map<string, MotionComicDialogueCue>,
  assets: Map<string, ProductionAssetVersion>,
  issues: MotionComicValidationIssue[],
  episodePath: string,
) {
  let expectedStartMs = 0;
  const timelineShots = new Set<string>();
  const orderedShots = episode.scenes.flatMap((scene) => scene.shots);
  episode.timeline.clips.forEach((clip, index) => {
    const path = `${episodePath}.timeline.clips[${index}]`;
    const shot = shots.get(clip.shotId);
    if (!shot) issues.push({ path: `${path}.shotId`, message: 'Timeline clip must reference an episode shot.' });
    if (timelineShots.has(clip.shotId)) issues.push({ path: `${path}.shotId`, message: 'Each shot may appear once on the episode timeline.' });
    if (clip.shotId !== orderedShots[index]?.id) issues.push({ path: `${path}.shotId`, message: 'Timeline order must match the scene shot order.' });
    timelineShots.add(clip.shotId);
    if (clip.startMs !== expectedStartMs) issues.push({ path: `${path}.startMs`, message: 'Timeline clips must be continuous.' });
    if (shot && clip.durationMs !== shot.durationMs) issues.push({ path: `${path}.durationMs`, message: 'Timeline clip duration must match its shot.' });
    validateReferenceList(clip.assetVersionIds, assets, `${path}.assetVersionIds`, issues);
    validateReferenceList(clip.subtitleCueIds, dialogue, `${path}.subtitleCueIds`, issues);
    if (clip.subtitleCueIds.some((id) => dialogue.get(id)?.shotId !== clip.shotId)) issues.push({ path: `${path}.subtitleCueIds`, message: 'Timeline subtitles must belong to their clip shot.' });
    expectedStartMs += clip.durationMs;
  });
  if (expectedStartMs !== episode.timeline.durationMs) issues.push({ path: `${episodePath}.timeline.durationMs`, message: 'Timeline duration must equal the sum of clips.' });
  if (timelineShots.size !== shots.size) issues.push({ path: `${episodePath}.timeline.clips`, message: 'Every episode shot must appear on the timeline.' });
  validateReferenceList(episode.timeline.audioAssetVersionIds, assets, `${episodePath}.timeline.audioAssetVersionIds`, issues);
  issues.push(...validateProductionAudioTimeline(episode.timeline, assets, `${episodePath}.timeline`));
}

function uniqueIdMap<T extends { id: string }>(items: readonly T[], path: string, issues: MotionComicValidationIssue[]): Map<string, T> {
  const result = new Map<string, T>();
  items.forEach((item, index) => {
    if (result.has(item.id)) issues.push({ path: `${path}[${index}].id`, message: 'Ids must be unique.' });
    result.set(item.id, item);
  });
  return result;
}

function validateReferenceList<T>(ids: readonly string[], targets: ReadonlyMap<string, T>, path: string, issues: MotionComicValidationIssue[]) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push({ path, message: `Reference ${id} is duplicated.` });
    seen.add(id);
    if (!targets.has(id)) issues.push({ path, message: `Reference ${id} does not exist.` });
  }
}

type MotionComicReferenceTarget = { kind: 'look' | 'scene' | 'prop'; id: string };

const MOTION_COMIC_REFERENCE_ASSET_PREFIX = 'motion-comic-reference-';
const MOTION_COMIC_SHOT_KEYFRAME_ASSET_PREFIX = 'shot-keyframe-';

function validateMotionComicReferenceList(
  ids: readonly string[],
  assets: ReadonlyMap<string, ProductionAssetVersion>,
  jobs: ReadonlyMap<string, ProductionProviderJob>,
  shotFrameAssetVersionIds: ReadonlySet<string>,
  target: MotionComicReferenceTarget,
  path: string,
  issues: MotionComicValidationIssue[],
) {
  validateReferenceList(ids, assets, path, issues);
  const expectedAssetId = `${MOTION_COMIC_REFERENCE_ASSET_PREFIX}${target.kind}-${target.id}`;
  ids.forEach((id, index) => {
    const asset = assets.get(id);
    if (!asset) return;
    const itemPath = `${path}[${index}]`;
    if (asset.kind !== 'image') {
      issues.push({ path: itemPath, message: 'Series consistency references must point to image assets.' });
    }
    if (asset.providerJobId && !jobs.has(asset.providerJobId)) {
      issues.push({ path: itemPath, message: `Reference asset provider job ${asset.providerJobId} does not exist.` });
    }
    if (shotFrameAssetVersionIds.has(id) || asset.assetId.startsWith(MOTION_COMIC_SHOT_KEYFRAME_ASSET_PREFIX)) {
      issues.push({ path: itemPath, message: 'Series consistency references cannot reuse shot keyframe assets.' });
    }
    // Older projects may use arbitrary logical asset ids; enforce ownership for the current namespaced format.
    if (asset.assetId.startsWith(MOTION_COMIC_REFERENCE_ASSET_PREFIX) && asset.assetId !== expectedAssetId) {
      issues.push({ path: itemPath, message: `Reference asset belongs to a different ${target.kind} target.` });
    }
  });
}

function validateMotionComicFrameAsset(
  id: string | undefined,
  assets: ReadonlyMap<string, ProductionAssetVersion>,
  path: string,
  label: 'First' | 'Last',
  issues: MotionComicValidationIssue[],
) {
  if (!id) return;
  const asset = assets.get(id);
  if (!asset) {
    issues.push({ path, message: `${label} frame asset does not exist.` });
    return;
  }
  if (asset.kind !== 'image') {
    issues.push({ path, message: `${label} frame must reference an image asset.` });
  }
  if (asset.assetId.startsWith(MOTION_COMIC_REFERENCE_ASSET_PREFIX)) {
    issues.push({ path, message: `${label} frame cannot use a series consistency reference asset.` });
  }
}
