// Row ↔ record mappers and column normalizers for FileDatabase, split out of storage.ts (O-5). Pure: no I/O.
import { shortVideoMaterialsSchema } from './short-video-materials';
import { pixelleRefSchema, pixelleOptionsSchema } from './pixelle-task';
import { projectModelsSchema } from './project-models';
import { withoutStaleCustomStylePreview } from './custom-style-preview';
import type { BenchmarkGroup, BenchmarkPost, BookSelectionRecord, CreditTransaction, CustomCoverTemplate, CustomStyle, DraftTemplate, DraftTemplateSummary, HistoryFamily, ImageLabRecord, ImageLabSummary, MinimaxCloneVoice, OrdinaryTaskCoverAsset, PromptTemplate, PromptTemplateSummary, SequencedTaskEvent, Task, TaskEvent, TaskSummary, TaskStatus, ViralAnalysisEvent, ViralAnalysisCheckpoint, ViralAnalysisRecord, ViralAnalysisSummary, VoiceLabRecord, VoiceLabSummary } from './types';
import { restoreEditorialCollagePipelineData } from './editorial-collage';
import { normalizeOrdinaryTaskCoverPageText, validateOrdinaryTaskCoverAsset } from './ordinary-task-cover';
import { draftTemplates, normalizeDraftTemplate } from './templates';
import { normalizeTaskOutputTargets } from './task-output';
import { editorialTemplateRouteSql, editorialProductionRouteFromPipelineData, type EditorialProductionRoute } from './creative-animation/production-route';
import type { HistoryTombstone } from './storage';
import type { SqlValue } from 'sql.js';

export const TASK_INPUT_PREVIEW_LIMIT = 160;

export function json<T>(value: T): string {
  return JSON.stringify(value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function rowToTaskSummary(row: Record<string, unknown>): TaskSummary {
  const task = rowToTask(row);
  const {
    inputText,
    pausePoints: _pausePoints,
    aiSources: _aiSources,
    selectedSources: _selectedSources,
    extraRequirements: _extraRequirements,
    imagePromptReference: _imagePromptReference,
    step3PromptSnapshot: _step3PromptSnapshot,
    musicMv: _musicMv,
    pipelineData: _pipelineData,
    productInfo: _productInfo,
    materialPerson: _materialPerson,
    fixedIntro: _fixedIntro,
    outroCta: _outroCta,
    podcastSpeakers: _podcastSpeakers,
    ...summary
  } = task;
  const projectCoverPath = typeof row.project_cover_path === 'string' ? row.project_cover_path.trim() : '';
  return {
    ...summary,
    ...(projectCoverPath ? { projectCover: { path: projectCoverPath, revision: '' } } : {}),
    inputPreview: String(row.input_preview ?? inputText).replace(/\s+/gu, ' ').trim().slice(0, TASK_INPUT_PREVIEW_LIMIT),
  };
}

export function rowToSequencedTaskEvent(row: Record<string, unknown>): SequencedTaskEvent {
  const event = rowToEvent(row);
  if (!Number.isSafeInteger(event.seq)) throw new Error('TASK_EVENT_SEQUENCE_INVALID: Persisted event has no sequence.');
  return { ...event, seq: Number(event.seq) };
}

export function rowToPromptTemplateSummary(row: Record<string, unknown>): PromptTemplateSummary {
  const stored = parseJson<Partial<PromptTemplateSummary>>(row.summary_json, {});
  return {
    ...stored,
    id: String(row.id),
    name: String(row.name ?? ''),
    type: String(row.type ?? 'task') as PromptTemplate['type'],
    description: String(row.description ?? ''),
    isBuiltin: Number(row.is_builtin) === 1,
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function promptTemplateSummary(template: PromptTemplate): PromptTemplateSummary {
  const {
    content: _content,
    stepPrompts: _stepPrompts,
    imageSeedPoolsJson: _imageSeedPoolsJson,
    ...summary
  } = template;
  return summary;
}

export function rowToDraftTemplateSummary(row: Record<string, unknown>): DraftTemplateSummary {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    isDefault: Number(row.is_builtin ?? 0) === 1,
    canvas: {
      width: Number(row.canvas_width ?? 1080),
      height: Number(row.canvas_height ?? 1920),
      ratio: String(row.canvas_ratio ?? '9:16'),
    },
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function rowToBookSelectionRecord(row: Record<string, unknown>): BookSelectionRecord {
  return {
    theme: String(row.theme ?? ''),
    bookId: String(row.book_id ?? ''),
    data: parseJson<BookSelectionRecord['data']>(row.data, { name: '' }),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function rowToBenchmarkGroup(row: Record<string, unknown>): BenchmarkGroup {
  return parseJson<BenchmarkGroup>(row.data, {
    id: String(row.id ?? ''),
    name: '',
    track: '',
    tags: [],
    notes: '',
    refreshPolicy: 'manual',
    accounts: [],
    createdAt: Number(row.updated_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  });
}

export function rowToBenchmarkPost(row: Record<string, unknown>): BenchmarkPost {
  return parseJson<BenchmarkPost>(row.data, {
    id: String(row.id ?? ''),
    groupId: String(row.group_id ?? ''),
    platform: 'douyin',
    sourceUrl: '',
    title: '',
    author: '',
    accountUrl: '',
    coverUrl: '',
    publishedAt: null,
    durationSeconds: null,
    transcript: '',
    tags: [],
    metrics: {},
    snapshots: [],
    isFavorite: false,
    workflowStatus: 'new',
    note: '',
    createdAt: Number(row.updated_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  });
}

export function rowToTask(row: Record<string, unknown>): Task {
  let pipelineData = String(row.pipeline_data ?? '{}');
  const editorial = normalizeLegacyTaskType(row.task_type, row.task_kind) === 'editorial-collage';
  if (editorial) {
    try { pipelineData = JSON.stringify(restoreEditorialCollagePipelineData(pipelineData)); }
    catch { /* Preserve invalid source data for the project's recovery/error view. */ }
  }
  // The trigger-maintained column is authoritative; a row read before the backfill derives it from the stored settings.
  const productionRoute: EditorialProductionRoute | undefined = !editorial || normalizeTaskKind(row.task_kind) === 'music-mv' ? undefined
    : row.production_route === 'template' || row.production_route === 'lemo' ? row.production_route
    : editorialProductionRouteFromPipelineData(String(row.pipeline_data ?? ''));
  return {
    ...(productionRoute ? { productionRoute } : {}),
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    isFavorite: Number(row.is_favorite ?? 0) === 1,
    title: String(row.title ?? ''),
    inputText: String(row.input_text ?? ''),
    taskKind: normalizeTaskKind(row.task_kind),
    processingMode: normalizeProcessingMode(row.processing_mode),
    status: String(row.status ?? 'pending') as TaskStatus,
    currentStep: Number(row.current_step ?? 0),
    runGeneration: Number(row.run_generation ?? 0),
    track: String(row.track ?? 'character-story'),
    style: String(row.style ?? 'photo-real'),
    speaker: String(row.speaker ?? '灿博小叔'),
    ratio: String(row.ratio ?? '9:16'),
    templateId: String(row.template_id ?? 'default-portrait-9-16'),
    bgmId: String(row.bgm_id ?? ''),
    pausePoints: parseJson(String(row.pause_points ?? '[]'), []),
    outputDir: String(row.output_dir ?? ''),
    outputTargets: row.output_targets_json ? normalizeTaskOutputTargets(parseJson(String(row.output_targets_json), null)) : undefined,
    visualTemplateRef: row.visual_template_ref_json ? pixelleRefSchema.parse(parseJson(String(row.visual_template_ref_json), null)) : undefined,
    shortVideoMaterials: row.short_video_materials_json ? shortVideoMaterialsSchema.parse(parseJson(String(row.short_video_materials_json), null)) : undefined,
    pixelleOptions: row.pixelle_options_json ? pixelleOptionsSchema.parse(parseJson(String(row.pixelle_options_json), null)) : undefined,
    deliverables: parseJson(String(row.deliverables_json ?? '{}'), {}),
    errorMessage: String(row.error_message ?? ''),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
    mode: String(row.mode ?? 'paste') as Task['mode'],
    aiKeyword: String(row.ai_keyword ?? ''),
    aiSources: parseJson(String(row.ai_sources ?? '[]'), []),
    selectedSources: parseJson(String(row.selected_sources ?? '[]'), []),
    extraRequirements: String(row.extra_requirements ?? ''),
    imagePromptReference: String(row.image_prompt_reference ?? ''),
    promptTemplateId: row.prompt_template_id ? String(row.prompt_template_id) : null,
    promptTemplateType: row.prompt_template_type ? String(row.prompt_template_type) : null,
    referenceImagePath: String(row.reference_image_path ?? ''),
    rewriteIntensity: String(row.rewrite_intensity ?? 'standard') as Task['rewriteIntensity'],
    narrativePov: String(row.narrative_pov ?? 'keep-original') as Task['narrativePov'],
    keepPromotion: Number(row.keep_promotion ?? 0) === 1,
    ttsProvider: String(row.tts_provider ?? 'volcengine') as Task['ttsProvider'],
    ttsSpeed: Number(row.tts_speed ?? 1),
    storyboardSceneCount: row.storyboard_scene_count === null || row.storyboard_scene_count === undefined ? undefined : Number(row.storyboard_scene_count),
    step3PromptSnapshot: String(row.step3_prompt_snapshot ?? ''),
    musicMv: normalizeMusicMvSettings(parseJson(String(row.music_mv_json ?? '{}'), {})),
    failedStep: row.failed_step === null || row.failed_step === undefined ? null : Number(row.failed_step),
    retryFromStep: row.retry_from_step === null || row.retry_from_step === undefined ? null : Number(row.retry_from_step),
    artifactStatePath: String(row.artifact_state_path ?? ''),
    videoForm: normalizeVideoForm(row.video_form),
    projectModels: projectModelsSchema.safeParse(parseJson(String(row.project_models_json ?? 'null'), null)).data,
    llmProfileId: row.llm_profile_id === null || row.llm_profile_id === undefined || row.llm_profile_id === '' ? null : String(row.llm_profile_id),
    imageQuality: row.image_quality === 'low' || row.image_quality === 'medium' || row.image_quality === 'high' ? row.image_quality : null,
    materialSource: String(row.material_source ?? 'ai'),
    productInfo: row.product_info === null || row.product_info === undefined ? null : String(row.product_info),
    materialPerson: row.material_person === null || row.material_person === undefined ? null : String(row.material_person),
    draftDir: row.draft_dir === null || row.draft_dir === undefined ? null : String(row.draft_dir),
    fixedIntro: row.fixed_intro === null || row.fixed_intro === undefined ? null : String(row.fixed_intro),
    outroCta: row.outro_cta === null || row.outro_cta === undefined ? null : String(row.outro_cta),
    lockIntroSentences: normalizeLockIntroSentences(row.lock_intro_sentences),
    taskType: normalizeLegacyTaskType(row.task_type, row.task_kind),
    pipelineStep: String(row.pipeline_step ?? 'new'),
    pipelineData,
    targetLength: row.target_length === null || row.target_length === undefined ? undefined : Number(row.target_length),
    targetScenes: row.target_scenes === null || row.target_scenes === undefined ? undefined : Number(row.target_scenes),
    publishMode: String(row.publish_mode ?? 'review-rewrite') as Task['publishMode'],
    scriptFormat: String(row.script_format ?? 'narration'),
    podcastImageMode: String(row.podcast_image_mode ?? 'multi'),
    podcastSpeakers: row.podcast_speakers === null || row.podcast_speakers === undefined ? null : String(row.podcast_speakers),
    podcastSpeakerA: row.podcast_speaker_a === null || row.podcast_speaker_a === undefined ? null : String(row.podcast_speaker_a),
    podcastSpeakerB: row.podcast_speaker_b === null || row.podcast_speaker_b === undefined ? null : String(row.podcast_speaker_b),
    coverImageMode: String(row.cover_image_mode ?? 'off'),
    coverTemplateId: String(row.cover_template_id ?? 'cinematic-poster'),
    coverPageEnabled: Number(row.cover_page_enabled ?? 0) === 1,
    coverPageText: normalizeOrdinaryTaskCoverPageText(row.cover_page_text),
    ordinaryCoverAsset: parseOrdinaryCoverAsset(row.ordinary_cover_asset_json),
    autoBorrowImage: Number(row.auto_borrow_image ?? 0) === 1,
    htmlVideoForeground: row.html_video_foreground === null || row.html_video_foreground === undefined
      ? undefined
      : Number(row.html_video_foreground) === 1,
  };
}

export function parseOrdinaryCoverAsset(value: unknown): OrdinaryTaskCoverAsset | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return validateOrdinaryTaskCoverAsset(JSON.parse(value));
  } catch {
    return null;
  }
}

/** 创意动画 (lemo) / 模板动画 (template) of an editorial row, NULL for every other row. */
export function productionRouteSql(prefix = ''): string {
  return `CASE WHEN trim(coalesce(${prefix}task_type, '')) = 'editorial-collage' AND coalesce(${prefix}task_kind, '') != 'music-mv'
    THEN CASE WHEN ${editorialTemplateRouteSql(`pipeline_data`)} THEN 'template' ELSE 'lemo' END END`;
}

export function normalizedTaskTypeSql(): string {
  return `CASE
    WHEN trim(coalesce(task_type, '')) = '' THEN CASE WHEN task_kind = 'music-mv' THEN 'music-mv' ELSE 'story' END
    ELSE trim(task_type)
  END`;
}

export function normalizeLegacyTaskType(value: unknown, taskKind: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || normalizeTaskKind(taskKind);
}

export function normalizeTaskKind(value: unknown): Task['taskKind'] {
  return value === 'music-mv' ? value : 'story';
}

export function normalizeVideoForm(value: unknown): Task['videoForm'] {
  return value === 'two-host-podcast' ? 'two-host-podcast' : 'narration';
}

export function normalizeProcessingMode(value: unknown): Task['processingMode'] {
  return value === 'milestone-review' || value === 'scene-review' || value === 'manual' || value === 'semi-auto' || value === 'clip-only'
    ? value
    : 'full-auto';
}

export function normalizeLockIntroSentences(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : 0;
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(20, Math.max(0, Math.trunc(numericValue)));
}

export function normalizeMusicMvSettings(value: unknown): Task['musicMv'] {
  const input = value && typeof value === 'object' ? (value as Partial<Task['musicMv']>) : {};
  const rhythmMode =
    input.rhythmMode === 'fast-cut' || input.rhythmMode === 'slow-cinematic' || input.rhythmMode === 'lyric-sync'
      ? input.rhythmMode
      : 'lyric-sync';
  const captionStyle = input.captionStyle === 'minimal' || input.captionStyle === 'none' || input.captionStyle === 'karaoke' ? input.captionStyle : 'karaoke';
  return {
    rhythmMode,
    captionStyle,
    visualMotif: String(input.visualMotif ?? ''),
    audioPath: String(input.audioPath ?? ''),
  };
}

export function rowToEvent(row: Record<string, unknown>): TaskEvent {
  return {
    seq: Number(row.seq),
    taskId: String(row.task_id),
    runGeneration: Number(row.run_generation ?? 0),
    type: String(row.type),
    step: row.step === null || row.step === undefined ? null : Number(row.step),
    agent: row.agent === null || row.agent === undefined ? null : String(row.agent),
    tool: row.tool === null || row.tool === undefined ? null : String(row.tool),
    detail: String(row.detail ?? ''),
    dataJson: row.data_json === null || row.data_json === undefined ? null : String(row.data_json),
    ts: Number(row.ts),
  };
}

export function boundViralStorageText(value: unknown, maxChars: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}...[truncated]`;
}

export function boundViralEventDataJson(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    JSON.parse(value);
  } catch {
    return json({ invalid: true, preview: value.slice(0, 4096) });
  }
  if (value.length <= 262_144) return value;
  return json({ truncated: true, preview: value.slice(0, 4096) });
}

export function serializeViralCheckpoint(checkpoint: ViralAnalysisCheckpoint | null | undefined): string | null {
  if (!checkpoint) return null;
  const serialized = json(checkpoint);
  if (serialized.length > 2 * 1024 * 1024) throw new Error('VIRAL_CHECKPOINT_TOO_LARGE: Recovery checkpoint exceeds 2 MiB.');
  return serialized;
}

export function viralPatchSqlValue(key: string, value: unknown): SqlValue {
  if (key === 'checkpoint') return serializeViralCheckpoint(value as ViralAnalysisCheckpoint | null | undefined);
  if (key === 'errorMessage') return boundViralStorageText(value, 4096);
  return value === null || value === undefined ? null : typeof value === 'number' ? value : String(value);
}

export function rowToViralAnalysis(row: Record<string, unknown>): ViralAnalysisRecord {
  return {
    id: String(row.id),
    referenceIndex: row.reference_index_json ? parseJson(String(row.reference_index_json), null) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    url: String(row.url ?? ''),
    platform: String(row.platform ?? 'unknown') as ViralAnalysisRecord['platform'],
    title: String(row.title ?? ''),
    status: String(row.status ?? 'pending') as ViralAnalysisRecord['status'],
    currentStage: String(row.current_stage ?? 'queued') as ViralAnalysisRecord['currentStage'],
    progress: Number(row.progress ?? 0),
    runGeneration: Number(row.run_generation ?? 0),
    resultGeneration: row.result_generation === null || row.result_generation === undefined ? null : Number(row.result_generation),
    settings: parseJson(String(row.settings_json ?? '{}'), {
      track: 'general-story',
      style: 'photo-real',
      ratio: '9:16',
      templateId: 'default-portrait-9-16',
    }),
    checkpoint: row.checkpoint_json ? parseJson<ViralAnalysisCheckpoint | null>(String(row.checkpoint_json), null) : null,
    resultPath: String(row.result_path ?? ''),
    videoPath: String(row.video_path ?? ''),
    errorMessage: String(row.error_message ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
  };
}

export function rowToViralAnalysisSummary(row: Record<string, unknown>): ViralAnalysisSummary {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    url: String(row.url ?? ''),
    platform: String(row.platform ?? 'unknown') as ViralAnalysisRecord['platform'],
    title: String(row.title ?? ''),
    status: String(row.status ?? 'pending') as ViralAnalysisRecord['status'],
    currentStage: String(row.current_stage ?? 'queued') as ViralAnalysisRecord['currentStage'],
    progress: Number(row.progress ?? 0),
    runGeneration: Number(row.run_generation ?? 0),
    resultGeneration: row.result_generation === null || row.result_generation === undefined ? null : Number(row.result_generation),
    errorMessage: String(row.error_message ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
  };
}

export function rowToViralEvent(row: Record<string, unknown>): ViralAnalysisEvent {
  return {
    seq: Number(row.seq),
    analysisId: String(row.analysis_id),
    runGeneration: Number(row.run_generation ?? 0),
    type: String(row.type),
    stage: String(row.stage),
    detail: String(row.detail ?? ''),
    dataJson: row.data_json === null || row.data_json === undefined ? null : String(row.data_json),
    ts: Number(row.ts),
  };
}

export function rowToPromptTemplate(row: Record<string, unknown>): PromptTemplate {
  const stored = parseJson<Partial<PromptTemplate>>(row.data_json, {});
  const template: PromptTemplate = {
    id: String(row.id),
    name: String(row.name ?? ''),
    type: String(row.type ?? 'rewrite') as PromptTemplate['type'],
    description: String(row.description ?? ''),
    content: String(row.content ?? ''),
    isBuiltin: Number(row.is_builtin ?? 0) === 1,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    ...stored,
    imageSeedPoolsJson: stored.imageSeedPoolsJson ?? '',
  };
  return withBuiltinPromptTemplateMigrations(template);
}

export function withBuiltinPromptTemplateMigrations(template: PromptTemplate): PromptTemplate {
  if (template.id !== 'builtin-image-prompt' || template.content.includes('{{imagePromptReference}}')) return template;
  return {
    ...template,
    content: `${template.content}\n\n爆款复刻画面提示词参考：{{imagePromptReference}}`,
  };
}

export function rowToDraftTemplate(row: Record<string, unknown>): DraftTemplate {
  const template = normalizeDraftTemplate(parseJson(String(row.data), draftTemplates[0]));
  return { ...template, updatedAt: String(row.updated_at ?? template.updatedAt ?? '') };
}

export function rowToImageLabRecord(row: Record<string, unknown>): ImageLabRecord {
  return {
    id: String(row.id),
    imageProfileId: row.image_profile_id ? String(row.image_profile_id) : undefined,
    modelName: row.model_name ? String(row.model_name) : undefined,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    prompt: String(row.prompt ?? ''),
    ratio: String(row.ratio ?? '9:16'),
    style: String(row.style ?? 'photo-real'),
    provider: String(row.provider ?? 'mock'),
    imagePath: String(row.image_path ?? ''),
    originalImagePath: String(row.original_image_path ?? row.image_path ?? '') || undefined,
    originalImageSha256: String(row.original_image_sha256 ?? '') || undefined,
    cutoutImagePath: String(row.cutout_image_path ?? '') || undefined,
    cutoutMethod: row.cutout_method ? String(row.cutout_method) as ImageLabRecord['cutoutMethod'] : null,
    cutoutModel: String(row.cutout_model ?? '') || undefined,
    cutoutModelVersion: String(row.cutout_model_version ?? '') || undefined,
    cutoutModelSha256: String(row.cutout_model_sha256 ?? '') || undefined,
    cutoutSourceSha256: String(row.cutout_source_sha256 ?? '') || undefined,
    cutoutOutputSha256: String(row.cutout_output_sha256 ?? '') || undefined,
    cutoutTransparentFraction: row.cutout_transparent_fraction === null || row.cutout_transparent_fraction === undefined ? null : Number(row.cutout_transparent_fraction),
    cutoutForegroundFraction: row.cutout_foreground_fraction === null || row.cutout_foreground_fraction === undefined ? null : Number(row.cutout_foreground_fraction),
    cutoutEdgeFraction: row.cutout_edge_fraction === null || row.cutout_edge_fraction === undefined ? null : Number(row.cutout_edge_fraction),
    cutoutQuality: row.cutout_quality ? String(row.cutout_quality) as ImageLabRecord['cutoutQuality'] : null,
    cutoutErrorCode: String(row.cutout_error_code ?? '') || undefined,
    cutoutErrorMessage: String(row.cutout_error_message ?? '') || undefined,
    status: String(row.status ?? 'mock') as ImageLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    resolution: String(row.resolution ?? '2K') as ImageLabRecord['resolution'],
    quality: (row.quality === 'low' || row.quality === 'high' ? row.quality : 'medium') as ImageLabRecord['quality'],
    smartMode: String(row.smart_mode ?? 'text-to-image') as ImageLabRecord['smartMode'],
    referenceImagePaths: parseJson(row.reference_image_paths_json, [] as string[]),
    referenceImagePath: String(row.reference_image_path ?? ''),
    upstreamTaskId: row.upstream_task_id ? String(row.upstream_task_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

export function rowToImageLabSummary(row: Record<string, unknown>): ImageLabSummary {
  return {
    imageProfileId: row.image_profile_id ? String(row.image_profile_id) : undefined,
    modelName: row.model_name ? String(row.model_name) : undefined,
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    promptPreview: String(row.prompt_preview ?? ''),
    ratio: String(row.ratio ?? '9:16'),
    style: String(row.style ?? 'photo-real'),
    provider: String(row.provider ?? 'mock'),
    imagePath: String(row.image_path ?? ''),
    originalImagePath: String(row.original_image_path ?? row.image_path ?? '') || undefined,
    originalImageSha256: String(row.original_image_sha256 ?? '') || undefined,
    cutoutImagePath: String(row.cutout_image_path ?? '') || undefined,
    cutoutMethod: row.cutout_method ? String(row.cutout_method) as ImageLabRecord['cutoutMethod'] : null,
    cutoutModel: String(row.cutout_model ?? '') || undefined,
    cutoutModelVersion: String(row.cutout_model_version ?? '') || undefined,
    cutoutModelSha256: String(row.cutout_model_sha256 ?? '') || undefined,
    cutoutSourceSha256: String(row.cutout_source_sha256 ?? '') || undefined,
    cutoutOutputSha256: String(row.cutout_output_sha256 ?? '') || undefined,
    cutoutTransparentFraction: row.cutout_transparent_fraction === null || row.cutout_transparent_fraction === undefined ? null : Number(row.cutout_transparent_fraction),
    cutoutForegroundFraction: row.cutout_foreground_fraction === null || row.cutout_foreground_fraction === undefined ? null : Number(row.cutout_foreground_fraction),
    cutoutEdgeFraction: row.cutout_edge_fraction === null || row.cutout_edge_fraction === undefined ? null : Number(row.cutout_edge_fraction),
    cutoutQuality: row.cutout_quality ? String(row.cutout_quality) as ImageLabRecord['cutoutQuality'] : null,
    cutoutErrorCode: String(row.cutout_error_code ?? '') || undefined,
    cutoutErrorMessage: String(row.cutout_error_message ?? '') || undefined,
    status: String(row.status ?? 'mock') as ImageLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    resolution: String(row.resolution ?? '2K') as ImageLabRecord['resolution'],
    quality: (row.quality === 'low' || row.quality === 'high' ? row.quality : 'medium') as ImageLabRecord['quality'],
    smartMode: String(row.smart_mode ?? 'text-to-image') as ImageLabRecord['smartMode'],
    upstreamTaskId: row.upstream_task_id ? String(row.upstream_task_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

export function rowToVoiceLabRecord(row: Record<string, unknown>): VoiceLabRecord {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    text: String(row.text ?? ''),
    provider: String(row.provider ?? 'volcengine') as VoiceLabRecord['provider'],
    voiceId: String(row.voice_id ?? ''),
    voiceLabel: String(row.voice_label ?? row.voice_id ?? ''),
    speed: Number(row.speed ?? 1),
    audioPath: String(row.audio_path ?? ''),
    status: String(row.status ?? 'generated') as VoiceLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

export function rowToVoiceLabSummary(row: Record<string, unknown>): VoiceLabSummary {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    textPreview: String(row.text_preview ?? ''),
    provider: String(row.provider ?? 'volcengine') as VoiceLabRecord['provider'],
    voiceId: String(row.voice_id ?? ''),
    voiceLabel: String(row.voice_label ?? row.voice_id ?? ''),
    speed: Number(row.speed ?? 1),
    audioPath: String(row.audio_path ?? ''),
    status: String(row.status ?? 'generated') as VoiceLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

export function rowToHistoryTombstone(row: Record<string, unknown>): HistoryTombstone {
  return {
    family: String(row.family) as HistoryFamily,
    id: String(row.entity_id),
    managedStorageKey: row.managed_storage_key === null || row.managed_storage_key === undefined
      ? null
      : String(row.managed_storage_key),
    cleanupState: String(row.cleanup_state ?? 'pending'),
    quarantineName: row.quarantine_name === null || row.quarantine_name === undefined
      ? null
      : String(row.quarantine_name),
    quarantineIdentityJson: String(row.quarantine_identity_json ?? '{}'),
    diagnostic: String(row.diagnostic ?? ''),
    deletedAt: String(row.deleted_at),
  };
}

export function rowToCustomStyle(row: Record<string, unknown>): CustomStyle {
  return withoutStaleCustomStylePreview({
    id: String(row.id),
    name: String(row.name),
    tag: String(row.tag),
    shortName: String(row.short_name),
    prefix: String(row.prefix),
    suffix: String(row.suffix),
    negativePrompt: String(row.negative_prompt),
    allowColor: Number(row.allow_color) === 1,
    description: String(row.description ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    preview: parseJson<CustomStyle['preview']>(String(row.preview_json ?? 'null'), undefined),
  });
}

export function rowToCustomCoverTemplate(row: Record<string, unknown>): CustomCoverTemplate {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    directions: String(row.directions ?? ''),
    compositionRule: String(row.composition_rule ?? ''),
    titleLayout: String(row.title_layout ?? ''),
    subtitleLayout: String(row.subtitle_layout ?? ''),
    plainHint: String(row.plain_hint ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function rowToCreditTransaction(row: Record<string, unknown>): CreditTransaction {
  return {
    id: Number(row.id),
    type: String(row.type),
    amount: Number(row.amount),
    balance: Number(row.balance),
    taskId: row.task_id ? String(row.task_id) : null,
    description: String(row.description ?? ''),
    createdAt: String(row.created_at),
  };
}

export function rowToMinimaxCloneVoice(row: Record<string, unknown>): MinimaxCloneVoice {
  return {
    voiceId: String(row.voice_id),
    displayName: String(row.display_name),
    sourceAudioPath: String(row.source_audio_path ?? ''),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
  };
}
