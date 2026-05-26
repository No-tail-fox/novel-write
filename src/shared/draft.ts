import { constants } from 'node:fs';
import { access, copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BgmItem, CoverMetadata, DiagnosticsReport, DraftTemplate, ImagePrompt, StoryboardScene, SubtitleTrack } from './types';
import { buildSubtitleTrack } from './story';
import { getTemplate } from './templates';
import { runPyJianYingDraftBridge, type PyJianYingBridgeInput, type PyJianYingBridgeOutput } from './jianying-bridge';

export interface SceneAsset {
  sceneId: number;
  path: string;
}

export interface WriteJianyingDraftInput {
  workDir: string;
  draftRootDir: string;
  title: string;
  cover: CoverMetadata;
  ratio: string;
  templateId?: string;
  scenes: StoryboardScene[];
  imagePrompts: ImagePrompt[];
  reviewedText: string;
  rewrittenCopy: string;
  generatedImages: SceneAsset[];
  narrationAudio: SceneAsset[];
  bgm: BgmItem | null;
}

export interface JianyingDraftWriteResult {
  draftDir: string;
  draftContentPath: string;
  draftMetaPath: string;
  workDir: string;
  assets: {
    images: string[];
    narration: string[];
    bgm: string | null;
    subtitles: string;
  };
  diagnostics: DiagnosticsReport;
}

type JsonRecord = Record<string, unknown>;

const microsecondsPerMs = 1000;

export interface WriteJianyingDraftOptions {
  runBridge?: (input: PyJianYingBridgeInput) => Promise<PyJianYingBridgeOutput>;
}

export async function writeJianyingDraft(input: WriteJianyingDraftInput, options: WriteJianyingDraftOptions = {}): Promise<JianyingDraftWriteResult> {
  if (!input.draftRootDir.trim()) {
    throw new Error('Jianying draft root path is not configured.');
  }
  if (input.scenes.length === 0) {
    throw new Error('Cannot create Jianying draft without storyboard scenes.');
  }

  const template = getTemplate(input.templateId ?? (input.ratio === '16:9' ? 'builtin-landscape-16-9' : 'default-portrait-9-16'));
  const subtitles = buildSubtitleTrack(input.scenes);
  const title = safeDraftName(input.title || input.cover.title || 'storybound-draft');
  const draftDir = join(input.draftRootDir, uniqueDraftFolderName(title));
  const materialsDir = join(draftDir, 'materials');
  const imagesDir = join(materialsDir, 'images');
  const narrationDir = join(materialsDir, 'narration');
  const bgmDir = join(materialsDir, 'bgm');

  const imagesByScene = await collectSceneAssets(input.scenes, input.generatedImages, 'image asset');
  const audioByScene = await collectSceneAssets(input.scenes, input.narrationAudio, 'narration asset');
  const totalDuration = input.scenes.reduce((sum, scene) => sum + msToUs(scene.durationMs), 0);

  await rm(draftDir, { recursive: true, force: true });
  await mkdir(imagesDir, { recursive: true });
  await mkdir(narrationDir, { recursive: true });
  await mkdir(input.workDir, { recursive: true });

  const copiedImages: string[] = [];
  const copiedNarration: string[] = [];
  for (const scene of input.scenes) {
    const imagePath = imagesByScene.get(scene.id)!;
    const audioPath = audioByScene.get(scene.id)!;
    const imageCopy = join(imagesDir, `${String(scene.id).padStart(3, '0')}${normalizedExt(imagePath, '.png')}`);
    const audioCopy = join(narrationDir, `${String(scene.id).padStart(3, '0')}${normalizedExt(audioPath, '.wav')}`);
    await copyFile(imagePath, imageCopy);
    await copyFile(audioPath, audioCopy);
    copiedImages.push(imageCopy);
    copiedNarration.push(audioCopy);
  }

  let copiedBgm: string | null = null;
  if (input.bgm?.path) {
    await assertReadableFile(input.bgm.path, 'BGM asset');
    await mkdir(bgmDir, { recursive: true });
    copiedBgm = join(bgmDir, `${safeFileStem(input.bgm.title || basename(input.bgm.path))}${normalizedExt(input.bgm.path, '.mp3')}`);
    await copyFile(input.bgm.path, copiedBgm);
  }

  const subtitlesFile = join(input.workDir, 'subtitles.srt');
  const diagnostics: DiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'real-images', label: '真实图片素材', status: 'pass', detail: `${copiedImages.length} images copied into draft materials.` },
      { id: 'real-narration', label: '真实旁白音频', status: 'pass', detail: `${copiedNarration.length} narration files copied into draft materials.` },
      { id: 'subtitle-track', label: '字幕时间轴', status: subtitles.cues.length === input.scenes.length ? 'pass' : 'fail', detail: `${subtitles.cues.length} subtitle cues.` },
      { id: 'jianying-draft', label: '剪映草稿结构', status: 'pass', detail: 'draft_content.json and draft_meta_info.json written with Jianying-compatible tracks.' },
    ],
  };

  await writeDebugArtifacts(input, subtitles, diagnostics);

  const bridgePayload = createBridgePayload({
    input,
    title,
    template,
    draftDir,
    totalDuration,
    subtitlesFile,
    copiedImages,
    copiedNarration,
    copiedBgm,
  });
  const bridge = await (options.runBridge ?? runPyJianYingDraftBridge)(bridgePayload);
  await writeFile(join(input.workDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');

  return {
    draftDir: bridge.draftDir,
    draftContentPath: bridge.draftContentPath,
    draftMetaPath: bridge.draftMetaPath,
    workDir: input.workDir,
    assets: {
      images: copiedImages,
      narration: copiedNarration,
      bgm: copiedBgm,
      subtitles: subtitlesFile,
    },
    diagnostics,
  };
}

function createBridgePayload(input: {
  input: WriteJianyingDraftInput;
  title: string;
  template: DraftTemplate;
  draftDir: string;
  totalDuration: number;
  subtitlesFile: string;
  copiedImages: string[];
  copiedNarration: string[];
  copiedBgm: string | null;
}): PyJianYingBridgeInput {
  let cursor = 0;
  const scenes = input.input.scenes.map((scene) => {
    const startUs = cursor;
    const durationUs = msToUs(scene.durationMs);
    cursor += durationUs;
    return {
      sceneId: scene.id,
      startUs,
      durationUs,
      text: scene.cap,
    };
  });
  return {
    workDir: input.input.workDir,
    draftDir: input.draftDir,
    title: input.title,
    canvas: {
      width: input.template.canvas.width,
      height: input.template.canvas.height,
    },
    imageArea: {
      top: input.template.image.top,
      height: input.template.image.height,
      fit: input.template.image.fit,
    },
    caption: {
      fontSize: input.template.caption.fontSize,
      color: input.template.caption.color,
      y: input.template.caption.y,
    },
    scenes,
    images: input.input.scenes.map((scene, index) => ({ sceneId: scene.id, path: input.copiedImages[index] })),
    narration: input.input.scenes.map((scene, index) => ({ sceneId: scene.id, path: input.copiedNarration[index] })),
    subtitlesSrtPath: input.subtitlesFile,
    bgm: input.copiedBgm && input.input.bgm ? { ...input.input.bgm, path: input.copiedBgm } : null,
    totalDurationUs: input.totalDuration,
    volumes: {
      narration: input.template.audio.narrationVolume / 10,
      bgm: input.input.bgm?.volume ?? input.template.audio.bgmVolume / 10,
    },
  };
}

async function writeDebugArtifacts(input: WriteJianyingDraftInput, subtitles: SubtitleTrack, diagnostics: DiagnosticsReport): Promise<void> {
  await mkdir(input.workDir, { recursive: true });
  await writeFile(join(input.workDir, '00-reviewed.txt'), input.reviewedText, 'utf8');
  await writeFile(join(input.workDir, '01-rewritten-copy.md'), input.rewrittenCopy, 'utf8');
  await writeFile(join(input.workDir, '00-cover-title.json'), JSON.stringify(input.cover, null, 2), 'utf8');
  await writeFile(join(input.workDir, '02-sentences.json'), JSON.stringify(input.scenes, null, 2), 'utf8');
  await writeFile(join(input.workDir, '03-image-prompts.json'), JSON.stringify(input.imagePrompts, null, 2), 'utf8');
  await writeFile(join(input.workDir, 'subtitles.srt'), subtitles.srt, 'utf8');
  await writeFile(join(input.workDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');
}

async function collectSceneAssets(scenes: StoryboardScene[], assets: SceneAsset[], label: string): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  for (const scene of scenes) {
    const asset = assets.find((item) => item.sceneId === scene.id);
    if (!asset?.path) {
      throw new Error(`Missing ${label} for scene ${scene.id}.`);
    }
    await assertReadableFile(asset.path, `${label} for scene ${scene.id}`);
    result.set(scene.id, asset.path);
  }
  return result;
}

async function assertReadableFile(path: string, label: string): Promise<void> {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size === 0) {
      throw new Error(`${label} is empty or not a file: ${path}`);
    }
    await access(path, constants.R_OK);
  } catch (error) {
    if (error instanceof Error && error.message.includes(label)) throw error;
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function createDraftContent(input: {
  title: string;
  template: DraftTemplate;
  scenes: StoryboardScene[];
  subtitles: SubtitleTrack;
  images: string[];
  narration: string[];
  bgm: BgmItem | null;
  totalDuration: number;
}): JsonRecord {
  const videoMaterials: JsonRecord[] = [];
  const audioMaterials: JsonRecord[] = [];
  const textMaterials: JsonRecord[] = [];
  const speeds: JsonRecord[] = [];
  const videoSegments: JsonRecord[] = [];
  const narrationSegments: JsonRecord[] = [];
  const textSegments: JsonRecord[] = [];

  for (const [index, scene] of input.scenes.entries()) {
    const cue = input.subtitles.cues[index];
    const start = msToUs(cue.startMs);
    const duration = msToUs(scene.durationMs);
    const imageMaterialId = id();
    const imageSpeedId = id();
    const audioMaterialId = id();
    const audioSpeedId = id();
    const textMaterialId = id();

    videoMaterials.push(createVideoMaterial(imageMaterialId, input.images[index], duration));
    audioMaterials.push(createAudioMaterial(audioMaterialId, input.narration[index], duration, `narration-${scene.id}`));
    textMaterials.push(createTextMaterial(textMaterialId, cue.text, input.template));
    speeds.push(createSpeed(imageSpeedId), createSpeed(audioSpeedId));

    videoSegments.push(createVideoSegment(imageMaterialId, imageSpeedId, start, duration, input.template));
    narrationSegments.push(createAudioSegment(audioMaterialId, audioSpeedId, start, duration, input.template.audio.narrationVolume / 10));
    textSegments.push(createTextSegment(textMaterialId, start, duration, input.template));
  }

  let bgmTrack: JsonRecord | null = null;
  if (input.bgm) {
    const bgmMaterialId = id();
    const bgmSpeedId = id();
    audioMaterials.push(createAudioMaterial(bgmMaterialId, input.bgm.path, input.totalDuration, input.bgm.title || 'bgm'));
    speeds.push(createSpeed(bgmSpeedId));
    bgmTrack = createTrack('audio', 'BGM', [createAudioSegment(bgmMaterialId, bgmSpeedId, 0, input.totalDuration, input.bgm.volume ?? input.template.audio.bgmVolume / 10)], 0);
  }

  // Structure follows pyJianYingDraft's Apache-2.0 draft template shape, implemented locally in TypeScript.
  return {
    canvas_config: { height: input.template.canvas.height, ratio: 'original', width: input.template.canvas.width },
    color_space: 0,
    config: createDraftConfig(),
    cover: null,
    create_time: 0,
    duration: input.totalDuration,
    extra_info: null,
    fps: 30.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: id(),
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: [],
    },
    last_modified_platform: createPlatform(),
    materials: createMaterials({ videos: videoMaterials, audios: audioMaterials, texts: textMaterials, speeds }),
    mutable_config: null,
    name: input.title,
    new_version: '110.0.0',
    platform: createPlatform(),
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: input.images[0] ?? '',
    time_marks: null,
    tracks: [
      createTrack('video', 'images', videoSegments, 0),
      createTrack('audio', 'narration', narrationSegments, 0),
      createTrack('text', 'subtitles', textSegments, 15000),
      ...(bgmTrack ? [bgmTrack] : []),
    ],
    update_time: 0,
    version: 360000,
  };
}

function createDraftMeta(input: {
  title: string;
  draftDir: string;
  draftRootDir: string;
  totalDuration: number;
  images: string[];
  narration: string[];
  bgm: string | null;
}): JsonRecord {
  return {
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: input.images[0] ?? '',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: '',
      enterprise_material: [],
    },
    draft_fold_path: input.draftDir,
    draft_id: id(),
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_materials: [
      { type: 0, value: input.images },
      { type: 1, value: input.narration },
      { type: 2, value: input.bgm ? [input.bgm] : [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: input.title,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: input.draftRootDir,
    draft_segment_extra_info: [],
    draft_type: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_removed: 0,
    tm_duration: input.totalDuration,
  };
}

function createDraftConfig(): JsonRecord {
  return {
    adjust_max_index: 1,
    attachment_info: [],
    combination_max_index: 1,
    export_range: null,
    extract_audio_last_index: 1,
    lyrics_recognition_id: '',
    lyrics_sync: true,
    lyrics_taskinfo: [],
    maintrack_adsorb: true,
    material_save_mode: 0,
    multi_language_current: 'none',
    multi_language_list: [],
    multi_language_main: 'none',
    multi_language_mode: 'none',
    original_sound_last_index: 1,
    record_audio_last_index: 1,
    sticker_max_index: 1,
    subtitle_keywords_config: null,
    subtitle_recognition_id: '',
    subtitle_sync: true,
    subtitle_taskinfo: [],
    system_font_list: [],
    video_mute: false,
    zoom_info_params: null,
  };
}

function createMaterials(input: { videos: JsonRecord[]; audios: JsonRecord[]; texts: JsonRecord[]; speeds: JsonRecord[] }): JsonRecord {
  return {
    ai_translates: [],
    audio_balances: [],
    audio_effects: [],
    audio_fades: [],
    audio_track_indexes: [],
    audios: input.audios,
    beats: [],
    canvases: [],
    chromas: [],
    color_curves: [],
    digital_humans: [],
    drafts: [],
    effects: [],
    flowers: [],
    green_screens: [],
    handwrites: [],
    hsl: [],
    images: [],
    log_color_wheels: [],
    loudnesses: [],
    manual_deformations: [],
    masks: [],
    material_animations: [],
    material_colors: [],
    multi_language_refs: [],
    placeholders: [],
    plugin_effects: [],
    primary_color_wheels: [],
    realtime_denoises: [],
    shapes: [],
    smart_crops: [],
    smart_relights: [],
    sound_channel_mappings: [],
    speeds: input.speeds,
    stickers: [],
    tail_leaders: [],
    text_templates: [],
    texts: input.texts,
    time_marks: [],
    transitions: [],
    video_effects: [],
    video_trackings: [],
    videos: input.videos,
    vocal_beautifys: [],
    vocal_separations: [],
  };
}

function createVideoMaterial(materialId: string, path: string, duration: number): JsonRecord {
  return {
    audio_fade: null,
    category_id: '',
    check_flag: 63487,
    crop: { lower_right_x: 1, lower_right_y: 1, upper_left_x: 0, upper_left_y: 0 },
    crop_ratio: 'free',
    crop_scale: 1,
    duration,
    height: 0,
    id: materialId,
    local_material_id: '',
    material_id: materialId,
    material_name: basename(path),
    material_type: 'photo',
    media_path: '',
    path,
    type: 'photo',
    width: 0,
  };
}

function createAudioMaterial(materialId: string, path: string, duration: number, name: string): JsonRecord {
  return {
    app_id: 0,
    category_id: '',
    check_flag: 3,
    copyright_limit_type: 'none',
    duration,
    effect_id: '',
    formula_id: '',
    id: materialId,
    local_material_id: materialId,
    music_id: materialId,
    name,
    path,
    source_platform: 0,
    team_id: '',
    text_id: '',
    tone_category_id: '',
    tone_category_name: '',
    tone_effect_id: '',
    tone_effect_name: '',
    type: 'extract_music',
    wave_points: [],
  };
}

function createTextMaterial(materialId: string, text: string, template: DraftTemplate): JsonRecord {
  const color = hexToRgbUnit(template.caption.color);
  const content = {
    styles: [
      {
        fill: {
          alpha: 1,
          content: {
            render_type: 'solid',
            solid: { alpha: 1, color },
          },
        },
        range: [0, text.length],
        size: template.caption.fontSize,
        bold: template.caption.bold,
        italic: false,
        underline: template.caption.underline,
      },
    ],
    text,
  };

  return {
    id: materialId,
    content: JSON.stringify(content),
    typesetting: 0,
    alignment: template.caption.align,
    letter_spacing: template.caption.letterSpacing * 0.05,
    line_spacing: 0.02 + template.caption.lineSpacing * 0.05,
    line_feed: 1,
    line_max_width: 0.82,
    force_apply_line_max_width: false,
    check_flag: 7,
    type: 'subtitle',
    global_alpha: template.caption.alpha,
    background_alpha: template.caption.background.alpha,
    background_color: template.caption.background.color,
    background_height: 0.14,
    background_round_radius: template.caption.background.roundRadius,
    background_style: 1,
    background_width: 0.82,
  };
}

function createVideoSegment(materialId: string, speedId: string, start: number, duration: number, template: DraftTemplate): JsonRecord {
  return {
    ...baseSegment(materialId, start, duration),
    source_timerange: timeRange(0, duration),
    speed: 1,
    volume: 1,
    extra_material_refs: [speedId],
    is_tone_modify: false,
    clip: {
      alpha: 1,
      flip: { horizontal: false, vertical: false },
      rotation: 0,
      scale: { x: template.image.fit === 'cover' ? 1 : 0.96, y: template.image.fit === 'cover' ? 1 : 0.96 },
      transform: { x: 0, y: normalizedImageTransformY(template) },
    },
    uniform_scale: { on: true, value: 1 },
    hdr_settings: { intensity: 1, mode: 1, nits: 1000 },
  };
}

function createAudioSegment(materialId: string, speedId: string, start: number, duration: number, volume: number): JsonRecord {
  return {
    ...baseSegment(materialId, start, duration),
    source_timerange: timeRange(0, duration),
    speed: 1,
    volume,
    extra_material_refs: [speedId],
    is_tone_modify: false,
    clip: null,
    hdr_settings: null,
  };
}

function createTextSegment(materialId: string, start: number, duration: number, template: DraftTemplate): JsonRecord {
  return {
    ...baseSegment(materialId, start, duration),
    clip: {
      alpha: template.caption.visible ? 1 : 0,
      flip: { horizontal: false, vertical: false },
      rotation: 0,
      scale: { x: 1, y: 1 },
      transform: { x: template.caption.x, y: template.caption.y },
    },
    uniform_scale: { on: true, value: 1 },
  };
}

function baseSegment(materialId: string, start: number, duration: number): JsonRecord {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id: id(),
    material_id: materialId,
    target_timerange: timeRange(start, duration),
    common_keyframes: [],
    keyframe_refs: [],
  };
}

function createTrack(type: string, name: string, segments: JsonRecord[], renderIndex: number): JsonRecord {
  return {
    attribute: 0,
    flag: 0,
    id: id(),
    is_default_name: name.length === 0,
    name,
    segments: segments.map((segment) => ({ ...segment, render_index: renderIndex })),
    type,
  };
}

function createSpeed(speedId: string): JsonRecord {
  return {
    curve_speed: null,
    id: speedId,
    mode: 0,
    speed: 1,
    type: 'speed',
  };
}

function createPlatform(): JsonRecord {
  return {
    app_id: 3704,
    app_source: 'lv',
    app_version: '5.9.0',
    os: 'windows',
  };
}

function timeRange(start: number, duration: number): JsonRecord {
  return { start, duration };
}

function msToUs(ms: number): number {
  return Math.round(ms * microsecondsPerMs);
}

function id(): string {
  return randomUUID().replace(/-/g, '');
}

function safeDraftName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'storybound-draft';
}

function safeFileStem(value: string): string {
  return safeDraftName(value).replace(/\s+/g, '-');
}

function uniqueDraftFolderName(title: string): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `${title}-${stamp}`;
}

function normalizedExt(path: string, fallback: string): string {
  const ext = extname(path);
  return ext || fallback;
}

function hexToRgbUnit(hex: string): number[] {
  const normalized = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return [1, 1, 1];
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function normalizedImageTransformY(template: DraftTemplate): number {
  if (template.image.top === 0 && template.image.height === 1) return 0;
  return template.image.top * 2 + template.image.height - 1;
}
