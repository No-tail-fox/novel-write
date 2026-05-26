import { constants } from 'node:fs';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  const imagesByScene = await collectSceneAssets(input.scenes, input.generatedImages, 'image asset');
  const audioByScene = await collectSceneAssets(input.scenes, input.narrationAudio, 'narration asset');
  const totalDuration = input.scenes.reduce((sum, scene) => sum + msToUs(scene.durationMs), 0);

  await mkdir(input.workDir, { recursive: true });

  const sourceImages = input.scenes.map((scene) => imagesByScene.get(scene.id)!);
  const sourceNarration = input.scenes.map((scene) => audioByScene.get(scene.id)!);

  let sourceBgm: BgmItem | null = null;
  if (input.bgm?.path) {
    await assertReadableFile(input.bgm.path, 'BGM asset');
    sourceBgm = input.bgm;
  }

  const subtitlesFile = join(input.workDir, 'subtitles.srt');
  const diagnostics: DiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'real-images', label: '真实图片素材', status: 'pass', detail: `${sourceImages.length} image files validated and handed to pyJianYingDraft.` },
      { id: 'real-narration', label: '真实旁白音频', status: 'pass', detail: `${sourceNarration.length} narration files validated and handed to pyJianYingDraft.` },
      { id: 'subtitle-track', label: '字幕时间轴', status: subtitles.cues.length === input.scenes.length ? 'pass' : 'fail', detail: `${subtitles.cues.length} subtitle cues.` },
      { id: 'jianying-draft', label: '剪映草稿结构', status: 'warn', detail: 'Waiting for pyJianYingDraft bridge output.' },
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
    sourceImages,
    sourceNarration,
    sourceBgm,
  });
  let bridge: PyJianYingBridgeOutput;
  try {
    bridge = await (options.runBridge ?? runPyJianYingDraftBridge)(bridgePayload);
    updateDiagnostic(diagnostics, 'jianying-draft', 'pass', 'pyJianYingDraft generated draft_content.json and draft_meta_info.json.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateDiagnostic(diagnostics, 'jianying-draft', 'fail', message);
    await writeFile(join(input.workDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');
    throw error;
  }
  const bridgeAssets = bridge.assets ?? {
    images: bridgePayload.images.map((asset) => asset.path),
    narration: bridgePayload.narration.map((asset) => asset.path),
    bgm: bridgePayload.bgm?.path ?? null,
    subtitles: subtitlesFile,
  };
  await writeFile(join(input.workDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');

  return {
    draftDir: bridge.draftDir,
    draftContentPath: bridge.draftContentPath,
    draftMetaPath: bridge.draftMetaPath,
    workDir: input.workDir,
    assets: {
      images: bridgeAssets.images,
      narration: bridgeAssets.narration,
      bgm: bridgeAssets.bgm,
      subtitles: bridgeAssets.subtitles,
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
  sourceImages: string[];
  sourceNarration: string[];
  sourceBgm: BgmItem | null;
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
    images: input.input.scenes.map((scene, index) => ({ sceneId: scene.id, path: input.sourceImages[index] })),
    narration: input.input.scenes.map((scene, index) => ({ sceneId: scene.id, path: input.sourceNarration[index] })),
    subtitlesSrtPath: input.subtitlesFile,
    bgm: input.sourceBgm,
    totalDurationUs: input.totalDuration,
    volumes: {
      narration: input.template.audio.narrationVolume / 10,
      bgm: input.input.bgm?.volume ?? input.template.audio.bgmVolume / 10,
    },
  };
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
  return cleaned || 'storybound-draft';
}

function uniqueDraftFolderName(title: string): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `${title}-${stamp}`;
}
