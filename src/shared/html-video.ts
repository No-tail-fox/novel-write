import type { PipelineArtifact } from './types';

export interface HtmlVideoSceneSource {
  sceneId: number;
  title: string;
  caption: string;
  description: string;
  imagePath: string;
  audioPath: string;
  durationMs: number;
}

export interface HtmlVideoScene extends HtmlVideoSceneSource {
  html: string;
  duration: number;
}

export interface HtmlVideoComposition {
  workDir: string;
  outputPath: string;
  title: string;
  coverPath?: string;
  bgmPath?: string;
  bgmTargetDb?: number;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  transition?: { type: string; duration: number };
  totalDurationS: number;
  scenes: HtmlVideoScene[];
}

export interface HtmlVideoCapturedScene {
  sceneId: number;
  framesDir: string;
  audioPath: string;
  fps: number;
}

export interface HtmlVideoBuildInput {
  workDir: string;
  outputPath: string;
  title: string;
  artifact: PipelineArtifact;
  generatedImages: Array<{ sceneId: number; path: string }>;
  narrationAudio: Array<{ sceneId: number; path: string }>;
  coverPath?: string;
  bgmPath?: string;
  bgmTargetDb?: number;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  transition?: { type: string; duration: number };
}

export interface HtmlVideoExportInput extends HtmlVideoComposition {}

export interface HtmlVideoExportResult {
  outputPath: string;
  sourceVideoPath: string;
  duration: number;
  taskDir: string;
  framesDirs: string[];
}

export interface HtmlVideoComposePayload {
  mode: 'compose_render';
  work_dir: string;
  scenes: Array<{ frames_dir: string; audio_path: string; fps: number }>;
  output_path: string;
  total_duration_s: number;
  bgm_path?: string;
  bgm_target_db?: number;
  transition?: { type: string; duration: number };
  cover_path?: string;
  cover_duration_s?: number;
  canvas_w: number;
  canvas_h: number;
}

export function buildHtmlVideoExportInput(input: HtmlVideoBuildInput): HtmlVideoComposition {
  const generatedImages = new Map(input.generatedImages.map((asset) => [asset.sceneId, asset.path]));
  const narrationAudio = new Map(input.narrationAudio.map((asset) => [asset.sceneId, asset.path]));
  const scenes = input.artifact.scenes.map((scene) => {
    const imagePath = generatedImages.get(scene.id);
    const audioPath = narrationAudio.get(scene.id);
    if (!imagePath) {
      throw new Error(`Missing HTML video image for scene ${scene.id}.`);
    }
    if (!audioPath) {
      throw new Error(`Missing HTML video narration for scene ${scene.id}.`);
    }
    return {
      sceneId: scene.id,
      title: input.title,
      caption: scene.cap,
      description: scene.descPrompt,
      imagePath,
      audioPath,
      durationMs: Math.max(800, Math.round(scene.durationMs)),
    };
  });

  return {
    workDir: input.workDir,
    outputPath: input.outputPath,
    title: input.title,
    coverPath: input.coverPath,
    bgmPath: input.bgmPath,
    bgmTargetDb: input.bgmTargetDb,
    fps: Math.max(1, Math.round(input.fps || 30)),
    canvas_w: Math.max(1, Math.round(input.canvas_w)),
    canvas_h: Math.max(1, Math.round(input.canvas_h)),
    transition: input.transition,
    totalDurationS: roundSeconds(input.artifact.scenes.reduce((sum, scene) => sum + Math.max(800, scene.durationMs), 0) / 1000),
    scenes: scenes.map((scene) => ({
      ...scene,
      html: buildSceneHtml({
        title: scene.title,
        caption: scene.caption,
        description: scene.description,
        imagePath: scene.imagePath,
        audioPath: scene.audioPath,
        duration: scene.durationMs / 1000,
        fps: Math.max(1, Math.round(input.fps || 30)),
        canvas_w: Math.max(1, Math.round(input.canvas_w)),
        canvas_h: Math.max(1, Math.round(input.canvas_h)),
      }),
      duration: roundSeconds(scene.durationMs / 1000),
    })),
  };
}

export function createHtmlVideoComposePayload(
  input: HtmlVideoComposition,
  capturedScenes: HtmlVideoCapturedScene[],
): HtmlVideoComposePayload {
  const capturedByScene = new Map(capturedScenes.map((scene) => [scene.sceneId, scene]));
  return {
    mode: 'compose_render',
    work_dir: input.workDir,
    scenes: input.scenes.map((scene) => {
      const captured = capturedByScene.get(scene.sceneId);
      if (!captured) {
        throw new Error(`Missing captured frames for HTML video scene ${scene.sceneId}.`);
      }
      return {
        frames_dir: captured.framesDir,
        audio_path: scene.audioPath,
        fps: captured.fps || input.fps,
      };
    }),
    output_path: input.outputPath,
    total_duration_s: input.totalDurationS,
    ...(input.bgmPath ? { bgm_path: input.bgmPath } : {}),
    ...(typeof input.bgmTargetDb === 'number' ? { bgm_target_db: input.bgmTargetDb } : {}),
    ...(input.transition ? { transition: input.transition } : {}),
    ...(input.coverPath ? { cover_path: input.coverPath, cover_duration_s: input.scenes[0]?.duration ?? 0 } : {}),
    canvas_w: input.canvas_w,
    canvas_h: input.canvas_h,
  };
}

function buildSceneHtml(scene: {
  title: string;
  caption: string;
  description: string;
  imagePath: string;
  audioPath: string;
  duration: number;
  fps: number;
  canvas_w: number;
  canvas_h: number;
}): string {
  const imageDataUrl = safeAssetUrl(scene.imagePath);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(scene.title)}</title>
  <style>
    :root { color-scheme: dark; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #090b0d;
    }
    body {
      display: grid;
      place-items: stretch;
      font-family: "Microsoft YaHei UI", system-ui, sans-serif;
      color: #f4f7f6;
    }
    .frame {
      position: relative;
      width: ${scene.canvas_w}px;
      height: ${scene.canvas_h}px;
      overflow: hidden;
      background: linear-gradient(180deg, #101417, #060708);
    }
    .scene-image {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0.92;
      transform: scale(1.04);
    }
    .veil {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(6, 8, 10, 0.10), rgba(6, 8, 10, 0.58) 74%, rgba(6, 8, 10, 0.82)),
        radial-gradient(circle at 50% 20%, rgba(69, 215, 230, 0.16), transparent 46%);
    }
    .copy {
      position: absolute;
      left: 7.5%;
      right: 7.5%;
      bottom: 8%;
      display: grid;
      gap: 14px;
      z-index: 2;
    }
    .title {
      font-size: clamp(30px, 3.2vw, 52px);
      line-height: 1.08;
      font-weight: 800;
      letter-spacing: 0;
      text-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }
    .caption {
      font-size: clamp(18px, 1.65vw, 30px);
      line-height: 1.3;
      color: rgba(240, 247, 248, 0.94);
      text-shadow: 0 6px 18px rgba(0, 0, 0, 0.42);
      white-space: pre-wrap;
    }
    .meta {
      display: inline-flex;
      gap: 10px;
      align-items: center;
      color: rgba(229, 241, 242, 0.7);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .ready-indicator {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
    }
  </style>
  <script>
    window.__duration = ${scene.duration};
    window.__ready = false;
    window.__tl = {
      current: 0,
      duration: ${scene.duration},
      seek(time) {
        const next = Math.max(0, Math.min(${scene.duration}, Number(time) || 0));
        this.current = next;
        document.documentElement.dataset.time = String(next);
        document.body.dataset.time = String(next);
        return next;
      },
      play() {
        return this.seek(this.current);
      }
    };
    window.__audioPath = ${JSON.stringify(scene.audioPath)};
    window.addEventListener('DOMContentLoaded', () => {
      window.__ready = true;
      window.__tl.seek(0);
    });
  </script>
</head>
<body>
  <div class="frame">
    <img class="scene-image" src="${imageDataUrl}" alt="${escapeHtml(scene.caption)}" />
    <div class="veil"></div>
    <div class="copy">
      <div class="title">${escapeHtml(scene.title)}</div>
      <div class="caption">${escapeHtml(scene.caption)}</div>
      <div class="meta">${escapeHtml(scene.description)}</div>
    </div>
    <div class="ready-indicator">ready</div>
  </div>
</body>
</html>`;
}

function safeAssetUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith('/')) return `file://${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function roundSeconds(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}
