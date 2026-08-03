import { constants } from 'node:fs';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BgmItem, CoverMetadata, DiagnosticsReport, DraftTemplate, ImagePrompt, StoryboardScene, SubtitleTrack } from './types';
import { buildSubtitleTrack } from './story';
import { getTemplate, normalizeDraftTemplate } from './templates';
import { runPyJianYingDraftBridge, type PyJianYingBridgeInput, type PyJianYingBridgeOutput } from './jianying-bridge';
import { runStoryboundMediaSidecar, type StoryboundSidecarInput, type StoryboundSidecarResult } from './storybound-sidecar';

export interface SceneAsset {
  sceneId: number;
  path: string;
  borrowedFrom?: number;
  speaker?: 'A' | 'B';
  turnIndex?: number;
  text?: string;
}

export interface WriteJianyingDraftInput {
  workDir: string;
  draftRootDir: string;
  title: string;
  cover: CoverMetadata;
  ratio: string;
  templateId?: string;
  template?: DraftTemplate;
  scenes: StoryboardScene[];
  subtitles?: SubtitleTrack;
  imagePrompts: ImagePrompt[];
  reviewedText: string;
  rewrittenCopy: string;
  generatedImages: SceneAsset[];
  coverImagePath?: string;
  narrationAudio: SceneAsset[];
  bgm: BgmItem | null;
}

export interface JianyingDraftWriteResult {
  draftDir: string;
  draftContentPath: string;
  draftMetaPath: string;
  draftId?: string;
  sourceVideoPath?: string;
  workDir: string;
  assets: {
    images: string[];
    narration: string[];
    bgm: string | null;
    subtitles: string;
  };
  diagnostics: DiagnosticsReport;
}

const microsecondsPerMs = 1000;

export interface WriteJianyingDraftOptions {
  runBridge?: (input: PyJianYingBridgeInput) => Promise<PyJianYingBridgeOutput>;
  runSidecar?: (input: StoryboundSidecarInput) => Promise<StoryboundSidecarResult>;
}

export async function writeJianyingDraft(input: WriteJianyingDraftInput, options: WriteJianyingDraftOptions = {}): Promise<JianyingDraftWriteResult> {
  if (!input.draftRootDir.trim()) {
    throw new Error('Jianying draft root path is not configured.');
  }
  if (input.scenes.length === 0) {
    throw new Error('Cannot create Jianying draft without storyboard scenes.');
  }

  const template = normalizeDraftTemplate(input.template ?? getTemplate(input.templateId ?? (input.ratio === '16:9' ? 'builtin-landscape-16-9' : 'default-portrait-9-16')));
  const subtitles = input.subtitles ?? buildSubtitleTrack(input.scenes, { maxCharsPerLine: template.caption.maxCharsPerLine });
  const title = safeDraftName(input.title || input.cover.title || 'storydream-draft');
  const draftDir = join(input.draftRootDir, uniqueDraftFolderName(title));
  const imagesByScene = await collectSceneAssets(input.scenes, input.generatedImages, 'image asset');
  const audioByScene = await collectNarrationAssets(input.scenes, input.narrationAudio);
  const totalDuration = input.scenes.reduce((sum, scene) => sum + msToUs(scene.durationMs), 0);

  await mkdir(input.workDir, { recursive: true });

  const sourceImages = input.scenes.map((scene) => imagesByScene.get(scene.id)!);
  const sourceNarration = input.scenes.flatMap((scene) => audioByScene.get(scene.id)!);
  const coverImagePath = input.coverImagePath?.trim() || '';
  if (coverImagePath) {
    await assertReadableFile(coverImagePath, 'cover image asset');
  }

  let sourceBgm: BgmItem | null = null;
  if (input.bgm?.path) {
    await assertReadableFile(input.bgm.path, 'BGM asset');
    sourceBgm = input.bgm;
  }
  if (template.canvas.backgroundImage.trim()) {
    await assertReadableFile(template.canvas.backgroundImage, 'background image');
  }

  const subtitlesFile = join(input.workDir, 'subtitles.srt');
  const diagnostics: DiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'real-images', label: '真实图片素材', status: 'pass', detail: `${sourceImages.length} image files validated and handed to pyJianYingDraft.` },
      { id: 'real-narration', label: '真实旁白音频', status: 'pass', detail: `${sourceNarration.length} narration files validated and handed to pyJianYingDraft.` },
      {
        id: 'subtitle-track',
        label: '字幕时间轴',
        status: input.scenes.every((scene) => subtitles.cues.some((cue) => cue.sceneId === scene.id)) ? 'pass' : 'fail',
        detail: `${input.scenes.length} scenes expanded into ${subtitles.cues.length} short subtitle cues.`,
      },
      { id: 'jianying-draft', label: '剪映草稿结构', status: 'warn', detail: 'Waiting for pyJianYingDraft bridge output.' },
    ],
  };

  await writeDebugArtifacts(input, subtitles, diagnostics);

  const bridgePayload = createBridgePayload({
    input,
    title,
    template,
    subtitles,
    draftDir,
    totalDuration,
    subtitlesFile,
    sourceImages,
    sourceNarration,
    coverImagePath,
    sourceBgm,
  });
  const sidecarPayload = createStoryboundSidecarPayload({
    input,
    title,
    template,
    sourceImages,
    sourceNarration,
    subtitlesFile,
    sourceBgm,
    coverImagePath,
  });
  try {
    const runBridge = options.runBridge ?? (options.runSidecar ? undefined : runPyJianYingDraftBridge);
    if (runBridge) {
      const bridge = await runBridge(bridgePayload);
      updateDiagnostic(diagnostics, 'jianying-draft', 'pass', 'pyJianYingDraft generated draft_content.json and draft_meta_info.json.');
      await writeFile(join(input.workDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');
      return {
        draftDir: bridge.draftDir,
        draftContentPath: bridge.draftContentPath,
        draftMetaPath: bridge.draftMetaPath,
        workDir: input.workDir,
        assets: {
          images: bridge.assets?.images ?? sourceImages,
          narration: bridge.assets?.narration ?? sourceNarration.map((asset) => asset.path),
          bgm: bridge.assets?.bgm ?? sourceBgm?.path ?? null,
          subtitles: bridge.assets?.subtitles ?? subtitlesFile,
        },
        diagnostics,
      };
    }

    const sidecar = await (options.runSidecar ?? runStoryboundMediaSidecar)(sidecarPayload);
    updateDiagnostic(diagnostics, 'jianying-draft', 'pass', 'Storybound-compatible sidecar generated draft_content.json and draft_meta_info.json.');
    const sidecarDraftDir = sidecar.draft_dir ?? draftDirFromResult(sidecarPayload, title);
    const draftContentPath = join(sidecarDraftDir, 'draft_content.json');
    const draftMetaPath = join(sidecarDraftDir, 'draft_meta_info.json');
    await writeFile(join(input.workDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');
    return {
      draftDir: sidecarDraftDir,
      draftContentPath,
      draftMetaPath,
      draftId: sidecar.draft_id,
      sourceVideoPath: sidecar.source_path,
      workDir: input.workDir,
      assets: {
        images: sourceImages,
        narration: sourceNarration.map((asset) => asset.path),
        bgm: sourceBgm?.path ?? null,
        subtitles: subtitlesFile,
      },
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateDiagnostic(diagnostics, 'jianying-draft', 'fail', message);
    await writeFile(join(input.workDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');
    throw error;
  }
}

function createBridgePayload(input: {
  input: WriteJianyingDraftInput;
  title: string;
  template: DraftTemplate;
  subtitles: SubtitleTrack;
  draftDir: string;
  totalDuration: number;
  subtitlesFile: string;
  sourceImages: string[];
  sourceNarration: SceneAsset[];
  coverImagePath: string;
  sourceBgm: BgmItem | null;
}): PyJianYingBridgeInput {
  let cursor = 0;
  const scenes = input.input.scenes.map((scene) => {
    const startUs = cursor;
    const durationUs = msToUs(scene.durationMs);
    cursor += durationUs;
    const sceneCues = input.subtitles.cues.filter((cue) => cue.sceneId === scene.id);
    return {
      sceneId: scene.id,
      startUs,
      durationUs,
      text: scene.cap,
      captions: sceneCues.map((cue) => cue.text),
      captionDurationsUs: sceneCues.map((cue) => msToUs(cue.endMs - cue.startMs)),
    };
  });
  const overlayText = resolveOverlayText(input.input, input.template);
  return {
    workDir: input.input.workDir,
    draftDir: input.draftDir,
    title: input.title,
    canvas: {
      width: input.template.canvas.width,
      height: input.template.canvas.height,
      backgroundColor: input.template.canvas.backgroundColor,
      backgroundImage: input.template.canvas.backgroundImage,
    },
    imageArea: {
      visible: input.template.image.visible,
      ratio: input.template.image.ratio,
      top: input.template.image.top,
      height: input.template.image.height,
      fit: input.template.image.fit,
      animation: input.template.image.animation,
      motion: input.template.image.motion,
      motionStrength: input.template.image.motionStrength,
    },
    frame: { ...input.template.frame },
    caption: {
      visible: input.template.caption.visible,
      fontSize: input.template.caption.fontSize,
      width: input.template.caption.width,
      color: input.template.caption.color,
      alpha: input.template.caption.alpha,
      border: input.template.caption.border,
      bold: input.template.caption.bold,
      underline: input.template.caption.underline,
      align: input.template.caption.align,
      letterSpacing: input.template.caption.letterSpacing,
      lineSpacing: input.template.caption.lineSpacing,
      maxCharsPerLine: input.template.caption.maxCharsPerLine,
      background: {
        color: input.template.caption.background.color,
        alpha: input.template.caption.background.alpha,
        roundRadius: input.template.caption.background.roundRadius,
      },
      x: input.template.caption.x,
      y: input.template.caption.y,
    },
    overlays: {
      title: {
        visible: input.template.title.visible,
        text: overlayText.title,
        x: input.template.title.x,
        y: input.template.title.y,
        width: input.template.title.width,
        fontSize: input.template.title.fontSize,
        color: input.template.title.color,
        alpha: input.template.title.alpha,
        bold: input.template.title.bold,
        underline: input.template.title.underline,
        align: input.template.title.align,
        letterSpacing: input.template.title.letterSpacing,
        lineSpacing: input.template.title.lineSpacing,
        border: input.template.title.border,
      },
      subtitle: {
        visible: input.template.subtitle.visible,
        text: overlayText.subtitle,
        x: input.template.subtitle.x,
        y: input.template.subtitle.y,
        width: input.template.subtitle.width,
        fontSize: input.template.subtitle.fontSize,
        color: input.template.subtitle.color,
        alpha: input.template.subtitle.alpha,
        bold: input.template.subtitle.bold,
        underline: input.template.subtitle.underline,
        align: input.template.subtitle.align,
        letterSpacing: input.template.subtitle.letterSpacing,
        lineSpacing: input.template.subtitle.lineSpacing,
        border: input.template.subtitle.border,
      },
      disclaimer: {
        visible: input.template.disclaimer.visible,
        text: input.template.disclaimer.text,
        x: input.template.disclaimer.x,
        y: input.template.disclaimer.y,
        width: input.template.disclaimer.width,
        fontSize: input.template.disclaimer.fontSize,
        color: input.template.disclaimer.color,
        alpha: input.template.disclaimer.alpha,
        bold: input.template.disclaimer.bold,
        underline: input.template.disclaimer.underline,
        align: input.template.disclaimer.align,
        letterSpacing: input.template.disclaimer.letterSpacing,
        lineSpacing: input.template.disclaimer.lineSpacing,
        border: input.template.disclaimer.border,
      },
    },
    scenes,
    images: input.input.scenes.map((scene, index) => ({ sceneId: scene.id, path: input.sourceImages[index] })),
    coverImagePath: input.coverImagePath || undefined,
    narration: input.sourceNarration.map((asset) => ({
      sceneId: asset.sceneId,
      path: asset.path,
      ...(asset.speaker ? { speaker: asset.speaker } : {}),
      ...(asset.turnIndex ? { turnIndex: asset.turnIndex } : {}),
      ...(asset.text ? { text: asset.text } : {}),
    })),
    subtitlesSrtPath: input.subtitlesFile,
    bgm: input.sourceBgm,
    totalDurationUs: input.totalDuration,
    volumes: {
      narration: input.template.audio.narrationVolume / 10,
      bgm: resolveBgmVolume(input.template.audio.bgmVolume, input.sourceBgm),
    },
    effects: {
      transitionType: input.template.audio.transitionType,
      transitionDurationUs: msToUs(input.template.audio.transitionDurationMs),
      narrationFadeInUs: msToUs(input.template.audio.narrationFadeInMs),
      narrationFadeOutUs: msToUs(input.template.audio.narrationFadeOutMs),
      bgmFadeInUs: msToUs(input.template.audio.bgmFadeInMs),
      bgmFadeOutUs: msToUs(input.template.audio.bgmFadeOutMs),
      filterType: input.template.audio.filterType,
      videoEffectType: input.template.audio.videoEffectType,
      audioEffectType: input.template.audio.audioEffectType,
    },
  };
}

function createStoryboundSidecarPayload(input: {
  input: WriteJianyingDraftInput;
  title: string;
  template: DraftTemplate;
  sourceImages: string[];
  sourceNarration: SceneAsset[];
  subtitlesFile: string;
  sourceBgm: BgmItem | null;
  coverImagePath: string;
}): StoryboundSidecarInput {
  let cursor = 0;
  const scenes = input.input.scenes.map((scene) => {
    const startUs = cursor;
    const durationUs = msToUs(scene.durationMs);
    cursor += durationUs;
    return {
      scene_id: scene.id,
      start_us: startUs,
      duration_us: durationUs,
      text: scene.cap,
    };
  });
  return {
    mode: 'story',
    task_dir: input.input.workDir,
    cover_title: input.input.cover,
    bgm_path: input.sourceBgm?.path ?? '',
    jianying_draft_path: input.input.draftRootDir,
    template: input.template,
    task_title: input.title,
    cover_image_path: input.coverImagePath || undefined,
    assets: {
      images: input.input.scenes.map((scene, index) => ({ scene_id: scene.id, path: input.sourceImages[index] })),
      narration: input.sourceNarration.map((asset) => ({
        scene_id: asset.sceneId,
        path: asset.path,
        ...(asset.speaker ? { speaker: asset.speaker } : {}),
        ...(asset.turnIndex ? { turn_index: asset.turnIndex } : {}),
        ...(asset.text ? { text: asset.text } : {}),
      })),
      subtitles_path: input.subtitlesFile,
      scenes,
    },
  };
}

function resolveOverlayText(input: WriteJianyingDraftInput, template: DraftTemplate): { title: string; subtitle: string } {
  const title = firstNonEmpty(input.cover.title, input.title, template.title.text);
  const subtitleLines = input.cover.subtitle.map((line) => line.trim()).filter(Boolean);
  const subtitle = subtitleLines.length > 0 ? subtitleLines.join('\n') : firstNonEmpty(input.cover.summary, template.subtitle.text);
  return { title, subtitle };
}

function firstNonEmpty(...values: string[]): string {
  return values.find((value) => value.trim())?.trim() ?? '';
}

function resolveBgmVolume(templateBgmVolume: number, bgm: BgmItem | null): number {
  const templateVolume = templateBgmVolume / 10;
  if (Number.isFinite(templateBgmVolume) && templateBgmVolume !== 3) return templateVolume;
  return bgm?.volume ?? templateVolume;
}

function updateDiagnostic(
  diagnostics: DiagnosticsReport,
  id: string,
  status: DiagnosticsReport['checks'][number]['status'],
  detail: string,
): void {
  const check = diagnostics.checks.find((item) => item.id === id);
  if (check) {
    check.status = status;
    check.detail = detail;
  }
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

async function collectNarrationAssets(scenes: StoryboardScene[], assets: SceneAsset[]): Promise<Map<number, SceneAsset[]>> {
  const result = new Map<number, SceneAsset[]>();
  for (const scene of scenes) {
    const sceneAssets = assets
      .filter((item) => item.sceneId === scene.id)
      .map((asset, index) => ({ asset, index }))
      .sort((a, b) => {
        const aTurn = a.asset.turnIndex ?? Number.MAX_SAFE_INTEGER;
        const bTurn = b.asset.turnIndex ?? Number.MAX_SAFE_INTEGER;
        if (aTurn !== bTurn) return aTurn - bTurn;
        return a.index - b.index;
      })
      .map((item) => item.asset);
    if (sceneAssets.length === 0) {
      throw new Error(`Missing narration asset for scene ${scene.id}.`);
    }
    for (const asset of sceneAssets) {
      await assertReadableFile(asset.path, `narration asset for scene ${scene.id}`);
    }
    result.set(scene.id, sceneAssets);
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

function msToUs(ms: number): number {
  return Math.round(ms * microsecondsPerMs);
}

function safeDraftName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'storydream-draft';
}

function uniqueDraftFolderName(title: string): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `${title}-${stamp}`;
}

function draftDirFromResult(input: StoryboundSidecarInput, title: string): string {
  const root = 'jianying_draft_path' in input ? input.jianying_draft_path : 'output_path' in input ? dirname(input.output_path) : process.cwd();
  return join(root, safeDraftName(title || 'storydream-draft'));
}
