import { pathToFileURL } from 'node:url';
import { runtimeProtocolMetadata } from '@hyperframes/core/runtime/protocol';
import type { DraftTemplate, HtmlVideoJobConfig, HtmlVideoScenePlan, PipelineArtifact } from './types';
import { resolveHtmlVideoCaptionStyle, type ResolvedHtmlVideoCaptionStyle } from './html-video-captions';
import { GSAP_RUNTIME_FILENAME, HYPERFRAMES_RUNTIME_FILENAME } from './hyperframes';
import { htmlVideoSceneTemplate } from './html-video-scene-templates';

export interface HtmlVideoSceneSource {
  sceneId: number;
  title: string;
  caption: string;
  description: string;
  imagePath: string;
  foregroundPaths?: string[];
  captions?: string[];
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
  foregroundImages?: Array<{ sceneId: number; path: string; slot?: number }>;
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
  draftTemplate?: DraftTemplate;
  scenePlans?: HtmlVideoScenePlan[];
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
  const foregroundImages = new Map<number, Array<{ path: string; slot: number }>>();
  for (const asset of input.foregroundImages ?? []) {
    const items = foregroundImages.get(asset.sceneId) ?? [];
    items.push({ path: asset.path, slot: asset.slot ?? items.length });
    foregroundImages.set(asset.sceneId, items);
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
    const plan = input.scenePlans?.find((item) => item.index === scene.id);
    const hiddenSlots = new Set(plan?.hiddenElementSlots ?? []);
    return {
      sceneId: scene.id,
      title: plan?.title ?? input.title,
      caption: scene.cap,
      captions: plan?.captions?.length ? [...plan.captions] : [scene.cap],
      description: scene.descPrompt,
      imagePath,
      foregroundPaths: plan?.foregroundHidden
        ? []
        : (foregroundImages.get(scene.id) ?? [])
            .filter((asset) => !hiddenSlots.has(asset.slot))
            .map((asset) => asset.path),
      audioPath,
      durationMs: Math.max(800, Math.round(scene.durationMs)),
      plan,
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
        captions: scene.captions,
        description: scene.description,
        imagePath: scene.imagePath,
        foregroundPaths: scene.foregroundPaths,
        audioPath: scene.audioPath,
        duration: scene.durationMs / 1000,
        fps: Math.max(1, Math.round(input.fps || 30)),
        canvas_w: Math.max(1, Math.round(input.canvas_w)),
        canvas_h: Math.max(1, Math.round(input.canvas_h)),
        captionStyle,
        draftTemplate: input.draftTemplate,
        plan: scene.plan,
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
  captions: string[];
  description: string;
  imagePath: string;
  foregroundPaths?: string[];
  audioPath: string;
  duration: number;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  captionStyle: ResolvedHtmlVideoCaptionStyle;
  draftTemplate?: DraftTemplate;
  plan?: HtmlVideoScenePlan;
}): string {
  const compositionId = `storydream-scene-${scene.sceneId}`;
  const hyperframesProtocol = runtimeProtocolMetadata(scene.fps);
  const imageDataUrl = safeAssetUrl(scene.imagePath);
  const audioDataUrl = safeLocalAssetUrl(scene.audioPath);
  const foregroundMarkup = (scene.foregroundPaths ?? [])
    .map((path, index) => `<img id="foreground-${index + 1}" class="clip scene-foreground" data-slot="${index}" data-start="0" data-duration="${scene.duration}" data-track-index="${index + 2}" src="${safeAssetUrl(path)}" alt="" />`)
    .join('\n    ');
  const captions = scene.captions.length ? scene.captions : [scene.caption];
  const captionDuration = scene.duration / captions.length;
  const captionMarkup = captions.map((caption, index) => (
    `<div id="caption-${index + 1}" class="caption" data-caption-index="${index}" style="opacity:0">${escapeHtml(caption)}</div>`
  )).join('\n      ');
  const captionTimeline = captions.map((_, index) => {
    const start = roundSeconds(index * captionDuration);
    const end = roundSeconds(Math.min(scene.duration, (index + 1) * captionDuration));
    const selector = `'#caption-${index + 1}'`;
    return [
      `tl.set(${selector}, { opacity: 0 }, 0);`,
      `tl.fromTo(${selector}, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: ${Math.min(0.35, captionDuration / 2)}, ease: 'power2.out' }, ${start});`,
      `tl.set(${selector}, { opacity: 0 }, ${end});`,
    ].join('\n    ');
  }).join('\n    ');
  const captionColors = scene.captionStyle.colors;
  const layout = resolveDraftTemplateHtmlLayout(scene.draftTemplate, scene.canvas_w, scene.canvas_h);
  const motionTween = draftTemplateMotionTween(scene.draftTemplate, scene.duration);
  const titleScale = clampNumber(scene.plan?.titleScale ?? 1, 0.25, 3);
  const captionScale = clampNumber(scene.plan?.captionScale ?? 1, 0.25, 3);
  const template = htmlVideoSceneTemplate(scene.plan?.sceneTemplate);
  const titleTop = clampNumber(scene.plan?.titleTopOverride ?? template.titleTop, 0, 100);
  const captionY = clampNumber(scene.plan?.captionYOverride ?? template.captionY, 0, 100);
  const titleSize = roundCssNumber(Math.max(26, scene.canvas_w * 0.052) * titleScale);
  const captionSize = roundCssNumber(Math.max(18, scene.canvas_w * 0.034) * captionScale);
  const sceneTemplate = escapeHtml(template.id);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: blob: storydream-media:; media-src file: data: blob: storydream-media:; style-src 'nonce-storydream-html-video'; style-src-attr 'unsafe-inline'; script-src 'nonce-storydream-html-video' file: storydream-media:" />
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
      transform-origin: 0 0;
    }
    .draft-frame-band {
      position: absolute;
      left: 0;
      right: 0;
      z-index: 0;
      pointer-events: none;
    }
    .draft-frame-header {
      top: 0;
      height: ${layout.headerHeightPercent}%;
      background: ${layout.headerBackground};
    }
    .draft-frame-footer {
      top: ${layout.footerTopPercent}%;
      bottom: 0;
      background: ${layout.footerBackground};
    }
    .scene-image-region {
      position: absolute;
      left: 0;
      top: ${layout.imageTopPercent}%;
      width: 100%;
      height: ${layout.imageHeightPercent}%;
      z-index: 0;
      overflow: hidden;
      box-sizing: border-box;
      ${layout.imageBorderCss}
    }
    .scene-image {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: ${layout.imageFit};
      opacity: 0.92;
      transform-origin: center;
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
      inset: 0;
      z-index: 2;
      pointer-events: none;
    }
    .title {
      position: absolute;
      top: ${titleTop}%;
      left: 50%;
      width: 88%;
      transform: translateX(-50%);
      font-size: ${titleSize}px;
      line-height: 1.08;
      font-weight: 800;
      letter-spacing: 0;
      text-align: center;
      white-space: nowrap;
      text-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }
    .captions {
      position: absolute;
      top: ${captionY}%;
      left: 50%;
      width: 92%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    .caption {
      position: absolute;
      top: 0;
      left: 50%;
      display: inline-block;
      max-width: 100%;
      transform: translateX(-50%);
      font-size: ${captionSize}px;
      line-height: 1.3;
      color: rgba(240, 247, 248, 0.94);
      color: var(--caption-text);
      text-shadow: 0 6px 18px rgba(0, 0, 0, 0.42);
      text-shadow: 0 6px 18px var(--caption-shadow);
      white-space: nowrap;
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
    .frame[data-scene-template="left-text-right-object"] .scene-foreground,
    .frame[data-scene-template="rule-of-thirds"] .scene-foreground {
      inset: 13% 0 4% 43%;
      width: 57%;
      height: 83%;
      object-position: right bottom;
    }
    .frame[data-scene-template="left-text-right-object"] .title,
    .frame[data-scene-template="left-text-right-object"] .captions,
    .frame[data-scene-template="rule-of-thirds"] .title,
    .frame[data-scene-template="rule-of-thirds"] .captions {
      left: 6%;
      width: 48%;
      transform: none;
      text-align: left;
    }
    .frame[data-scene-template="right-text-left-object"] .scene-foreground {
      inset: 13% 43% 4% 0;
      width: 57%;
      height: 83%;
      object-position: left bottom;
    }
    .frame[data-scene-template="right-text-left-object"] .title,
    .frame[data-scene-template="right-text-left-object"] .captions {
      left: 48%;
      width: 46%;
      transform: none;
      text-align: right;
    }
    .frame[data-scene-template="three-float"] .scene-foreground {
      inset: 23% auto 14%;
      width: 42%;
      height: 63%;
    }
    .frame[data-scene-template="three-float"] #foreground-1 { left: -3%; }
    .frame[data-scene-template="three-float"] #foreground-2 { left: 29%; z-index: 3; }
    .frame[data-scene-template="three-float"] #foreground-3 { right: -3%; }
    .frame[data-scene-template="full-quote"] .scene-image,
    .frame[data-scene-template="quote-card"] .scene-image,
    .frame[data-scene-template="big-number"] .scene-image {
      opacity: 0.45;
      filter: saturate(0.72) brightness(0.72);
    }
    .frame[data-scene-template="full-quote"] .scene-foreground { opacity: 0.28; }
    .frame[data-scene-template="full-quote"] .title,
    .frame[data-scene-template="big-number"] .title {
      width: 82%;
      font-size: ${roundCssNumber(titleSize * 1.5)}px;
      line-height: 1.16;
      white-space: normal;
    }
    .frame[data-scene-template="full-image"] .veil { opacity: 0.58; }
    .frame[data-scene-template="person-focus"] .scene-foreground {
      inset: 12% -8% -4%;
      width: 116%;
      height: 92%;
    }
    .frame[data-scene-template="split-compare"]::after {
      content: '';
      position: absolute;
      inset: 0 49.6%;
      z-index: 4;
      width: 0.8%;
      background: var(--caption-accent);
      opacity: 0.8;
    }
    .frame[data-scene-template="split-compare"] .scene-image-region { right: 50%; width: 50%; }
    .frame[data-scene-template="split-compare"] .scene-foreground {
      inset: 10% 0 8% 50%;
      width: 50%;
      height: 82%;
    }
    .frame[data-scene-template="center-burst"] .scene-foreground {
      inset: 10% -8% -4%;
      width: 116%;
      height: 94%;
      filter: drop-shadow(0 0 34px rgba(255, 211, 92, 0.42));
    }
    .frame[data-scene-template="grid-four"] .scene-foreground {
      inset: auto;
      width: 48%;
      height: 38%;
      object-position: center bottom;
    }
    .frame[data-scene-template="grid-four"] #foreground-1 { top: 13%; left: 2%; }
    .frame[data-scene-template="grid-four"] #foreground-2 { top: 13%; right: 2%; }
    .frame[data-scene-template="grid-four"] #foreground-3 { bottom: 13%; left: 2%; }
    .frame[data-scene-template="grid-four"] #foreground-4 { right: 2%; bottom: 13%; }
    .frame[data-scene-template="quote-card"] .copy {
      inset: 18% 7% 20%;
      border: 1px solid rgba(255, 255, 255, 0.24);
      background: rgba(7, 9, 10, 0.72);
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
    }
    .frame[data-scene-template="quote-card"] .title { top: 18%; }
    .frame[data-scene-template="quote-card"] .captions { top: 70%; }
    .frame[data-scene-template="top-object-bottom-text"] .scene-foreground {
      inset: 2% 7% 38%;
      width: 86%;
      height: 60%;
      object-position: center bottom;
    }
    .frame[data-scene-template="top-object-bottom-text"] .copy {
      top: 50%;
      background: linear-gradient(180deg, transparent, rgba(5, 7, 8, 0.9) 28%);
    }
    .frame[data-scene-template="diagonal-flow"] .scene-foreground {
      inset: 16% -8% 1% 30%;
      width: 82%;
      height: 83%;
      transform: rotate(-4deg);
    }
    .frame[data-scene-template="diagonal-flow"] .title {
      left: 5%;
      width: 62%;
      transform: rotate(-4deg);
      text-align: left;
    }
    .frame[data-scene-template="orbit-focus"] .scene-foreground {
      inset: auto;
      width: 42%;
      height: 42%;
    }
    .frame[data-scene-template="orbit-focus"] #foreground-1 { top: 12%; left: 29%; }
    .frame[data-scene-template="orbit-focus"] #foreground-2 { top: 32%; right: 0; }
    .frame[data-scene-template="orbit-focus"] #foreground-3 { bottom: 10%; left: 29%; }
    .frame[data-scene-template="orbit-focus"] #foreground-4 { top: 32%; left: 0; }
    .frame[data-scene-template="parallax-focus"] .scene-image { filter: saturate(0.86) contrast(1.08); }
    .frame[data-scene-template="parallax-focus"] .scene-foreground {
      inset: 7% -7% -7%;
      width: 114%;
      height: 100%;
    }
    .meta {
      display: none;
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
  <div id="${compositionId}" class="frame" data-composition-id="${compositionId}" data-start="0" data-duration="${scene.duration}" data-width="${scene.canvas_w}" data-height="${scene.canvas_h}" data-caption-preset="${scene.captionStyle.preset}" data-caption-animation="${scene.captionStyle.animation}" data-scene-template="${sceneTemplate}" data-draft-motion="${layout.motion || 'legacy'}" data-draft-frame="${layout.frameEnabled}">
    ${layout.frameEnabled ? '<div class="draft-frame-band draft-frame-header"></div><div class="draft-frame-band draft-frame-footer"></div>' : ''}
    <div class="scene-image-region"><img id="scene-background" class="clip scene-image" data-start="0" data-duration="${scene.duration}" data-track-index="0" src="${imageDataUrl}" alt="" /></div>
    <audio id="scene-narration" class="clip scene-audio" data-start="0" data-duration="${scene.duration}" data-track-index="1" data-volume="1" src="${audioDataUrl}" preload="auto"></audio>
    <div id="scene-veil" class="clip veil" data-start="0" data-duration="${scene.duration}" data-track-index="20"></div>
    ${foregroundMarkup}
    <div id="scene-copy" class="clip copy" data-start="0" data-duration="${scene.duration}" data-track-index="21">
      ${scene.plan?.titleHidden ? '' : `<div class="title">${escapeHtml(scene.title)}</div>`}
      <div class="captions">${captionMarkup}</div>
      <div class="meta">${escapeHtml(scene.description)}</div>
    </div>
    <div class="ready-indicator">ready</div>
  </div>
  <script nonce="storydream-html-video">
    window.__duration = ${scene.duration};
    window.__ready = false;
    window.__timelines = window.__timelines || {};
    const hyperframesProtocol = ${JSON.stringify(hyperframesProtocol)};
    function postHyperframesMessage(type, payload = {}) {
      window.parent.postMessage({ source: 'hf-preview', ...hyperframesProtocol, type, ...payload }, '*');
    }
    function postStorydreamRuntimeReady() {
      const canInspectMedia = typeof document !== 'undefined';
      const background = canInspectMedia ? document.querySelector('#scene-background') : null;
      const report = () => {
        const mediaReferences = canInspectMedia
          ? Array.from(document.querySelectorAll('[src]'))
            .map((item) => item.getAttribute('src') || '')
            .filter(Boolean)
          : [];
        window.parent.postMessage({
          type: 'storydream:hyperframes-runtime-ready',
          compositionId: '${compositionId}',
          hasGsap: typeof window.gsap?.timeline === 'function',
          compositionReady: window.__ready === true,
          timelineKeys: Object.keys(window.__timelines),
          timelineDuration: window.__tl.duration(),
          backgroundReady: !canInspectMedia || Boolean(background?.complete && background.naturalWidth > 0 && background.naturalHeight > 0),
          mediaReferences,
        }, '*');
      };
      if (!background || background.complete) {
        report();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        report();
      };
      background.addEventListener('load', finish, { once: true });
      background.addEventListener('error', finish, { once: true });
      window.setTimeout(finish, 5000);
    }
    const tl = gsap.timeline({ paused: true });
    ${motionTween}
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
    ${captionTimeline}
    tl.set({}, {}, ${scene.duration});
    window.__tl = tl;
    window.__timelines['${compositionId}'] = tl;
    window.__audioPath = ${JSON.stringify(scene.audioPath)};
    function fitScene() {
      if (typeof document === 'undefined') return;
      const frame = document.querySelector('.frame');
      if (!frame) return;
      const scale = Math.min(window.innerWidth / ${scene.canvas_w}, window.innerHeight / ${scene.canvas_h});
      frame.style.transform = 'scale(' + scale + ')';
    }
    function fitCaps() {
      if (typeof document === 'undefined') return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;
      for (const caption of document.querySelectorAll('.caption')) {
        const computed = getComputedStyle(caption);
        let size = parseFloat(computed.fontSize) || ${captionSize};
        context.font = computed.fontWeight + ' ' + size + 'px ' + computed.fontFamily;
        const maximum = ${scene.canvas_w} * 0.84;
        const measured = context.measureText(caption.textContent || '').width;
        if (measured > maximum) {
          size = Math.max(14, size * maximum / measured);
          caption.style.fontSize = size + 'px';
        }
      }
    }
    function narrationAudio() {
      return typeof document === 'undefined' ? null : document.querySelector('#scene-narration');
    }
    function postTick() {
      const time = typeof tl.time === 'function' ? Math.min(tl.time(), window.__duration) : 0;
      window.parent.postMessage({ type: 'hvtick', time, duration: window.__duration }, '*');
    }
    if (typeof tl.eventCallback === 'function') {
      tl.eventCallback('onUpdate', postTick);
      tl.eventCallback('onComplete', postTick);
    }
    window.addEventListener('message', (event) => {
      const message = event && event.data;
      if (!message || typeof message.type !== 'string') return;
      const audio = narrationAudio();
      if (message.type === 'hvplay') {
        tl.play();
        if (audio) { audio.currentTime = typeof tl.time === 'function' ? tl.time() : 0; void audio.play().catch(() => undefined); }
        postTick();
      } else if (message.type === 'hvpause') {
        tl.pause();
        audio?.pause();
        postTick();
      } else if (message.type === 'hvseek') {
        const time = Math.max(0, Math.min(window.__duration, Number(message.time) || 0));
        tl.seek(time, false);
        if (audio) audio.currentTime = time;
        window.parent.postMessage({ type: 'hvtick', time, duration: window.__duration }, '*');
      } else if (message.type === 'hvrestart') {
        tl.seek(0, false).play();
        if (audio) { audio.currentTime = 0; void audio.play().catch(() => undefined); }
        postTick();
      }
    });
    window.addEventListener('DOMContentLoaded', () => {
      window.__ready = true;
      window.__tl.seek(0, false);
      window.__tl.pause();
      fitScene();
      fitCaps();
      window.addEventListener('resize', fitScene);
      postStorydreamRuntimeReady();
      postHyperframesMessage('ready');
      postHyperframesMessage('timeline', {
        durationInFrames: Math.max(1, Math.round(window.__duration * ${scene.fps})),
        durationSeconds: window.__duration,
        compositionWidth: ${scene.canvas_w},
        compositionHeight: ${scene.canvas_h},
        scenes: [{ id: '${compositionId}', start: 0, duration: window.__duration }],
      });
    });
  </script>
</body>
</html>`;
}

function resolveDraftTemplateHtmlLayout(template: DraftTemplate | undefined, canvasWidth: number, canvasHeight: number) {
  const imageTop = template ? clampNumber(template.image.top, 0, 1) : 0;
  const imageHeight = template ? clampNumber(template.image.height, 0, 1 - imageTop) : 1;
  const footerTop = clampNumber(imageTop + imageHeight, 0, 1);
  const frame = template?.frame;
  const frameEnabled = frame?.enabled === true;
  const borderScale = template
    ? Math.min(canvasWidth / Math.max(1, template.canvas.width), canvasHeight / Math.max(1, template.canvas.height))
    : 1;
  const borderWidth = frameEnabled ? Math.max(0, (frame?.imageBorderWidth ?? 0) * borderScale) : 0;
  const border = `${roundCssNumber(borderWidth)}px solid ${frame?.imageBorderColor ?? '#000000'}`;
  let imageBorderCss = '';
  if (borderWidth > 0 && frame?.imageBorderSides === 'horizontal') imageBorderCss = `border-top: ${border}; border-bottom: ${border};`;
  else if (borderWidth > 0 && frame?.imageBorderSides === 'vertical') imageBorderCss = `border-left: ${border}; border-right: ${border};`;
  else if (borderWidth > 0) imageBorderCss = `border: ${border};`;
  return {
    frameEnabled,
    headerHeightPercent: roundCssNumber(imageTop * 100),
    footerTopPercent: roundCssNumber(footerTop * 100),
    imageTopPercent: roundCssNumber(imageTop * 100),
    imageHeightPercent: roundCssNumber(imageHeight * 100),
    imageFit: template?.image.fit ?? 'cover',
    imageBorderCss,
    headerBackground: frameEnabled ? `linear-gradient(90deg, ${frame.headerColor}, ${frame.headerColorEnd})` : 'transparent',
    footerBackground: frameEnabled ? `linear-gradient(90deg, ${frame.footerColor}, ${frame.footerColorEnd})` : 'transparent',
    motion: template?.image.motion ?? '',
  };
}

function draftTemplateMotionTween(template: DraftTemplate | undefined, duration: number): string {
  const motion = template?.image.motion ?? '';
  const strength = clampNumber(template?.image.motionStrength ?? 1, 0, 2);
  if (strength <= 0) return '';
  const scale = roundCssNumber(1 + strength * 0.08);
  const pan = roundCssNumber(strength * 4);
  const timing = `duration: ${duration}, ease: 'none'`;
  if (motion === 'zoom_in') return `tl.fromTo('#scene-background', { scale: 1 }, { scale: ${scale}, ${timing} }, 0);`;
  if (motion === 'zoom_out') return `tl.fromTo('#scene-background', { scale: ${scale} }, { scale: 1, ${timing} }, 0);`;
  if (motion === 'zoom_pan_up') return `tl.fromTo('#scene-background', { scale: 1, yPercent: ${pan} }, { scale: ${scale}, yPercent: ${-pan}, ${timing} }, 0);`;
  if (motion === 'zoom_pan_down') return `tl.fromTo('#scene-background', { scale: 1, yPercent: ${-pan} }, { scale: ${scale}, yPercent: ${pan}, ${timing} }, 0);`;
  if (motion === 'pan_left') return `tl.fromTo('#scene-background', { scale: ${scale}, xPercent: ${pan} }, { scale: ${scale}, xPercent: ${-pan}, ${timing} }, 0);`;
  if (motion === 'pan_right') return `tl.fromTo('#scene-background', { scale: ${scale}, xPercent: ${-pan} }, { scale: ${scale}, xPercent: ${pan}, ${timing} }, 0);`;
  return `tl.fromTo('#scene-background', { scale: 1.04 }, { scale: 1.075, ${timing} }, 0);`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function roundCssNumber(value: number): number {
  return Math.round(value * 10_000) / 10_000;
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
