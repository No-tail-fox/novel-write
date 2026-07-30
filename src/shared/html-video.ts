import { pathToFileURL } from 'node:url';
import type { HtmlVideoJobConfig, PipelineArtifact } from './types';
import { resolveHtmlVideoCaptionStyle, type ResolvedHtmlVideoCaptionStyle } from './html-video-captions';
import { GSAP_RUNTIME_FILENAME, HYPERFRAMES_RUNTIME_FILENAME } from './hyperframes';

export interface HtmlVideoSceneSource {
  sceneId: number;
  title: string;
  caption: string;
  description: string;
  imagePath: string;
  foregroundPaths?: string[];
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
  foregroundImages?: Array<{ sceneId: number; path: string }>;
  narrationAudio: Array<{ sceneId: number; path: string }>;
  coverPath?: string;
  bgmPath?: string;
  bgmTargetDb?: number;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  transition?: { type: string; duration: number };
  captionConfig?: Pick<HtmlVideoJobConfig, 'captionPreset' | 'captionAnim' | 'captionColors'>;
  captionReducedMotion?: boolean;
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
  const captionStyle = resolveHtmlVideoCaptionStyle(
    input.captionConfig ?? {},
    { reducedMotion: input.captionReducedMotion },
  );
  const generatedImages = new Map(input.generatedImages.map((asset) => [asset.sceneId, asset.path]));
  const foregroundImages = new Map<number, string[]>();
  for (const asset of input.foregroundImages ?? []) {
    foregroundImages.set(asset.sceneId, [...(foregroundImages.get(asset.sceneId) ?? []), asset.path]);
  }
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
      foregroundPaths: foregroundImages.get(scene.id) ?? [],
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
        sceneId: scene.sceneId,
        title: scene.title,
        caption: scene.caption,
        description: scene.description,
        imagePath: scene.imagePath,
        foregroundPaths: scene.foregroundPaths,
        audioPath: scene.audioPath,
        duration: scene.durationMs / 1000,
        fps: Math.max(1, Math.round(input.fps || 30)),
        canvas_w: Math.max(1, Math.round(input.canvas_w)),
        canvas_h: Math.max(1, Math.round(input.canvas_h)),
        captionStyle,
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
  sceneId: number;
  title: string;
  caption: string;
  description: string;
  imagePath: string;
  foregroundPaths?: string[];
  audioPath: string;
  duration: number;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  captionStyle: ResolvedHtmlVideoCaptionStyle;
}): string {
  const compositionId = `storydream-scene-${scene.sceneId}`;
  const imageDataUrl = safeAssetUrl(scene.imagePath);
  const audioDataUrl = safeLocalAssetUrl(scene.audioPath);
  const foregroundMarkup = (scene.foregroundPaths ?? [])
    .map((path, index) => `<img id="foreground-${index + 1}" class="clip scene-foreground" data-slot="${index}" data-start="0" data-duration="${scene.duration}" data-track-index="${index + 2}" src="${safeAssetUrl(path)}" alt="" />`)
    .join('\n    ');
  const captionColors = scene.captionStyle.colors;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: blob: storydream-media:; media-src file: data: blob: storydream-media:; style-src 'nonce-storydream-html-video'; script-src 'nonce-storydream-html-video' file: storydream-media:" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(scene.title)}</title>
  <style nonce="storydream-html-video">
    @font-face {
      font-family: "Microsoft YaHei UI";
      src: local("Microsoft YaHei UI"), local("Microsoft YaHei");
      font-display: block;
    }
    :root {
      color-scheme: dark;
      --caption-text: ${captionColors.text};
      --caption-accent: ${captionColors.accent};
      --caption-background: ${captionColors.background};
      --caption-shadow: ${captionColors.shadow};
    }
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
      transform: scale(calc(1.04 + var(--scene-progress, 0) * 0.035));
    }
    .scene-foreground {
      position: absolute;
      inset: 8% 4% 0;
      z-index: 2;
      width: 92%;
      height: 92%;
      object-fit: contain;
      object-position: center bottom;
      filter: drop-shadow(0 18px 28px rgba(0, 0, 0, 0.34));
      transform: translateY(0) scale(1);
    }
    .scene-audio {
      display: none;
    }
    .veil {
      position: absolute;
      inset: 0;
      z-index: 1;
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
      color: var(--caption-text);
      text-shadow: 0 6px 18px rgba(0, 0, 0, 0.42);
      text-shadow: 0 6px 18px var(--caption-shadow);
      white-space: pre-wrap;
    }
    .frame[data-caption-preset="editorial"] .caption {
      padding: 0.42em 0.62em;
      border-left: 4px solid var(--caption-accent);
      background: var(--caption-background);
      font-family: "EB Garamond", "Microsoft YaHei UI", serif;
    }
    .frame[data-caption-preset="karaoke"] .caption {
      width: fit-content;
      max-width: 100%;
      padding: 0.38em 0.7em;
      border-bottom: 3px solid var(--caption-accent);
      background: var(--caption-background);
      font-weight: 800;
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
  <script nonce="storydream-html-video" src="./${GSAP_RUNTIME_FILENAME}"></script>
  <script nonce="storydream-html-video" src="./${HYPERFRAMES_RUNTIME_FILENAME}"></script>
</head>
<body>
  <div id="${compositionId}" class="frame" data-composition-id="${compositionId}" data-start="0" data-duration="${scene.duration}" data-width="${scene.canvas_w}" data-height="${scene.canvas_h}" data-caption-preset="${scene.captionStyle.preset}" data-caption-animation="${scene.captionStyle.animation}">
    <img id="scene-background" class="clip scene-image" data-start="0" data-duration="${scene.duration}" data-track-index="0" src="${imageDataUrl}" alt="${escapeHtml(scene.caption)}" />
    <audio id="scene-narration" class="clip scene-audio" data-start="0" data-duration="${scene.duration}" data-track-index="1" data-volume="1" src="${audioDataUrl}" preload="auto"></audio>
    <div id="scene-veil" class="clip veil" data-start="0" data-duration="${scene.duration}" data-track-index="20"></div>
    ${foregroundMarkup}
    <div id="scene-copy" class="clip copy" data-start="0" data-duration="${scene.duration}" data-track-index="21">
      <div class="title">${escapeHtml(scene.title)}</div>
      <div class="caption">${escapeHtml(scene.caption)}</div>
      <div class="meta">${escapeHtml(scene.description)}</div>
    </div>
    <div class="ready-indicator">ready</div>
  </div>
  <script nonce="storydream-html-video">
    window.__duration = ${scene.duration};
    window.__ready = false;
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo('#scene-background', { scale: 1.04 }, { scale: 1.075, duration: ${scene.duration}, ease: 'none' }, 0);
    tl.fromTo('#scene-veil', { opacity: 0.86 }, { opacity: 0.96, duration: ${scene.duration}, ease: 'none' }, 0);
    ${foregroundMarkup ? (scene.foregroundPaths ?? []).map((_, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      return `tl.fromTo('#foreground-${index + 1}', { x: ${direction * 8}, y: 14, scale: 0.98 }, { x: 0, y: 0, scale: 1, duration: ${scene.duration}, ease: 'power2.out' }, 0);`;
    }).join('\n    ') : ''}
    const reduceCaptionMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const captionAnimation = reduceCaptionMotion ? 'none' : ${JSON.stringify(scene.captionStyle.animation)};
    if (captionAnimation === 'fade-up') {
      tl.fromTo('#scene-copy', { opacity: 0.72, y: 18 }, { opacity: 1, y: 0, duration: ${Math.min(scene.duration, 0.72)}, ease: 'power2.out' }, 0);
    } else if (captionAnimation === 'pop') {
      tl.fromTo('#scene-copy .caption', { opacity: 0.7, scale: 0.92 }, { opacity: 1, scale: 1, duration: ${Math.min(scene.duration, 0.6)}, ease: 'back.out(1.4)' }, 0);
    }
    tl.set({}, {}, ${scene.duration});
    window.__tl = tl;
    window.__timelines['${compositionId}'] = tl;
    window.__audioPath = ${JSON.stringify(scene.audioPath)};
    window.addEventListener('DOMContentLoaded', () => {
      window.__ready = true;
      window.__tl.seek(0, false);
      window.__tl.pause();
      window.parent.postMessage({
        type: 'storydream:hyperframes-runtime-ready',
        compositionId: '${compositionId}',
        hasGsap: typeof window.gsap?.timeline === 'function',
        compositionReady: window.__ready === true,
        timelineKeys: Object.keys(window.__timelines),
        timelineDuration: window.__tl.duration(),
      }, '*');
    });
  </script>
</body>
</html>`;
}

function safeAssetUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) {
    return pathToFileURL(path).toString();
  }
  return encodeURI(normalized);
}

function safeLocalAssetUrl(path: string): string {
  if (/^https?:/i.test(path)) return '';
  return safeAssetUrl(path);
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
