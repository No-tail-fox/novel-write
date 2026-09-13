import { mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  assertDirectorRenderProbe,
  buildDirectorSceneHtml,
  directorCanvasForRatio,
  type DirectorRenderResult,
  type DirectorRenderScene,
  type DirectorSceneHtmlLayer,
} from '../src/shared/director-render';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { createElectronHtmlVideoRenderer } from './html-video-renderer';
import { preflightVideoRenderDisk } from './video-render-preflight';
import { measureDirectorSubtitleLayout, measureDirectorSubtitleVisibility, productionSubtitleSceneLayoutSchema, type ProductionSubtitleLayoutEvidence, type ProductionSubtitleSceneLayout } from '../src/shared/production-subtitle-layout';
import { DIRECTOR_VISUAL_FPS, directorVisualCutTimes } from '../src/shared/production-visual-continuity';

export async function renderDirectorVideo(input: {
  workDir: string;
  projectTitle: string;
  modeLabel: string;
  ratio: string;
  scenes: readonly DirectorRenderScene[];
  sceneStarts?: ReadonlyMap<string, number>;
}): Promise<DirectorRenderResult> {
  if (input.scenes.length === 0) throw new Error('DIRECTOR_RENDER_EMPTY: 当前项目没有可渲染的镜头。');
  const canvas = directorCanvasForRatio(input.ratio);
  const fps = DIRECTOR_VISUAL_FPS;
  let stagedMediaBytes = 0;
  for (const scene of input.scenes) {
    const paths = scene.renderStrategy === 'living-poster' ? [scene.videoPath] : scene.layers.map((layer) => layer.imagePath);
    for (const path of paths) {
      if (path) stagedMediaBytes += (await assertFile(path, `镜头 ${scene.index} 画面`)).size;
    }
  }
  await mkdir(input.workDir, { recursive: true });
  await preflightVideoRenderDisk(input.workDir, {
    width: canvas.width, height: canvas.height, fps,
    durations: input.scenes.map((scene) => Math.max(0.8, scene.durationMs / 1000)), stagedMediaBytes,
  }, { code: 'DIRECTOR_RENDER_DISK_SPACE_LOW', label: '导演台视频' });
  // Every render owns a private staging/export directory. Concurrent renders
  // must never remove each other's media or collide on a timestamp filename.
  const renderWorkDir = join(input.workDir, 'director-renders', randomUUID());
  const mediaDir = join(renderWorkDir, 'director-media');
  const exportDir = join(renderWorkDir, 'exports');
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const stagedScenes = [];
  for (const scene of input.scenes) {
    if (scene.audioClips !== undefined) {
      for (const clip of scene.audioClips) await assertFile(clip.path, `镜头 ${scene.index} 音频片段 ${clip.id}`);
    } else {
      await assertFile(scene.audioPath, `镜头 ${scene.index} 旁白`);
    }
    let representativePath = '';
    let html: string;
    if (scene.renderStrategy === 'living-poster') {
      if (!scene.videoPath) throw new Error(`DIRECTOR_RENDER_VIDEO_MISSING: 镜头 ${scene.index} 缺少 AI 动态海报视频。`);
      await assertFile(scene.videoPath, `镜头 ${scene.index} AI 动态海报`);
      const stagedVideo = join(mediaDir, `shot-${String(scene.index).padStart(3, '0')}${supportedVideoExtension(scene.videoPath)}`);
      await copyFile(scene.videoPath, stagedVideo);
      representativePath = stagedVideo;
      html = buildDirectorSceneHtml({
        title: scene.title,
        caption: scene.caption,
        subtitleCues: scene.subtitleCues,
        videoUrl: pathToFileURL(stagedVideo).toString(),
        renderStrategy: scene.renderStrategy,
        durationMs: scene.durationMs,
        modeLabel: input.modeLabel,
        index: scene.index,
        layoutTemplate: scene.layoutTemplate,
        motionPreset: scene.motionPreset,
        subtitleStyle: scene.subtitleStyle,
      });
    } else {
      if (scene.layers.length === 0) throw new Error(`DIRECTOR_RENDER_LAYER_MISSING: 镜头 ${scene.index} 缺少可渲染图层。`);
      const stagedLayers: DirectorSceneHtmlLayer[] = [];
      for (const [layerIndex, layer] of scene.layers.entries()) {
        await assertFile(layer.imagePath, `镜头 ${scene.index} 图层“${layer.label}”`);
        const stagedImage = join(
          mediaDir,
          `shot-${String(scene.index).padStart(3, '0')}-layer-${String(layerIndex + 1).padStart(2, '0')}${supportedImageExtension(layer.imagePath)}`,
        );
        await copyFile(layer.imagePath, stagedImage);
        representativePath ||= stagedImage;
        stagedLayers.push({
          id: layer.id,
          label: layer.label,
          imageUrl: pathToFileURL(stagedImage).toString(),
          zIndex: layer.zIndex,
          depth: layer.depth,
          motion: layer.motion,
        });
      }
      html = buildDirectorSceneHtml({
        title: scene.title,
        caption: scene.caption,
        subtitleCues: scene.subtitleCues,
        layers: stagedLayers,
        camera: scene.camera,
        renderStrategy: scene.renderStrategy,
        durationMs: scene.durationMs,
        modeLabel: input.modeLabel,
        index: scene.index,
        layoutTemplate: scene.layoutTemplate,
        motionPreset: scene.motionPreset,
        subtitleStyle: scene.subtitleStyle,
      });
    }
    stagedScenes.push({
      sceneId: scene.index,
      title: scene.title,
      caption: scene.caption,
      description: scene.caption,
      imagePath: representativePath,
      duration: Math.max(0.8, scene.durationMs / 1000),
      durationMs: scene.durationMs,
      audioPath: scene.audioPath,
      ...(scene.audioClips !== undefined ? { audioClips: scene.audioClips } : {}),
      html,
    });
  }

  const outputPath = join(exportDir, `director-${Date.now()}-${randomUUID()}.mp4`);
  const totalDurationS = stagedScenes.reduce((total, scene) => total + scene.duration, 0);
  const subtitleLayout: ProductionSubtitleLayoutEvidence = { version: 1, measuredAt: new Date().toISOString(), scenes: [] };
  const sceneStarts = input.sceneStarts ?? new Map(input.scenes.map((scene, index) => [scene.id, input.scenes.slice(0, index).reduce((sum, previous) => sum + previous.durationMs, 0)]));
  const result = await createElectronHtmlVideoRenderer({ inspectScene: async (window, stagedScene) => {
    const source = input.scenes.find(scene => scene.index === stagedScene.sceneId)!;
    try {
      const measurement = await window.webContents.executeJavaScript(`(${measureDirectorSubtitleLayout.toString()})(${JSON.stringify({ shotId: source.id, startMs: sceneStarts.get(source.id) ?? 0, durationMs: source.durationMs, ...canvas })})`);
      const parsedMeasurement = productionSubtitleSceneLayoutSchema.parse(measurement);
      const sourceCues = source.subtitleCues ?? (source.caption.trim() ? [{ startMs: 0, endMs: source.durationMs }] : []);
      const visibilitySamples = await window.webContents.executeJavaScript(`(${measureDirectorSubtitleVisibility.toString()})(${JSON.stringify({ startMs: sceneStarts.get(source.id) ?? 0, durationMs: source.durationMs, cues: sourceCues })})`);
      const measuredWithVisibility = productionSubtitleSceneLayoutSchema.parse({ ...parsedMeasurement, visibilitySamples });
      subtitleLayout.scenes.push(await measureDirectorGlyphCoverage(window, measuredWithVisibility, renderWorkDir));
    } catch (error) {
      subtitleLayout.scenes.push({ status: 'failed', shotId: source.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
    }
  } }).render({
    workDir: renderWorkDir,
    outputPath,
    title: input.projectTitle,
    fps,
    canvas_w: canvas.width,
    canvas_h: canvas.height,
    totalDurationS,
    // Crossfades shorten adjacent scenes and shift project-global dialogue.
    // Until visual-only overlaps are supported, both workflows use exact cuts.
    transition: { type: 'cut', duration: 0 },
    scenes: stagedScenes,
  });
  const output = await stat(result.outputPath);
  if (!output.isFile() || output.size <= 0) throw new Error('DIRECTOR_RENDER_OUTPUT_INVALID: 成片文件未正确生成。');
  const probe = await runStoryboundMediaSidecar({
    mode: 'probe_media',
    work_dir: renderWorkDir,
    media_path: result.outputPath,
    require_nonblack: true,
    analyze_quality: true,
    visual_continuity_points_ms: directorVisualCutTimes(input.scenes),
    visual_continuity_fps: fps,
  });
  const durationMs = assertDirectorRenderProbe(probe, {
    durationMs: Math.round(totalDurationS * 1000),
    width: canvas.width,
    height: canvas.height,
    fps,
  });
  return {
    outputPath: result.outputPath,
    durationMs,
    sizeBytes: output.size,
    width: canvas.width,
    height: canvas.height,
    hasAudio: true,
    hasVideo: true,
    hasNonBlackVideo: true,
    subtitleLayout,
    ...(typeof probe.audio_mean_volume_db === 'number' ? { audioMeanVolumeDb: probe.audio_mean_volume_db } : {}),
    ...(typeof probe.audio_peak_db === 'number' ? { audioPeakDb: probe.audio_peak_db } : {}),
    ...(typeof probe.audio_lufs === 'number' ? { audioLufs: probe.audio_lufs } : {}),
    ...(typeof probe.audio_true_peak_db === 'number' ? { audioTruePeakDb: probe.audio_true_peak_db } : {}),
    ...(typeof probe.audio_is_silent === 'boolean' ? { audioIsSilent: probe.audio_is_silent } : {}),
    ...(Array.isArray(probe.black_intervals) ? { blackIntervalsMs: probe.black_intervals.map((interval) => ({ startMs: Number(interval.start_ms), endMs: Number(interval.end_ms) })).filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs)) } : {}),
    ...(probe.visual_continuity ? { visualContinuity: probe.visual_continuity } : {}),
    ...(probe.audio_quality_status ? { audioQualityStatus: probe.audio_quality_status } : {}),
    ...(probe.audio_quality_error ? { audioQualityError: probe.audio_quality_error } : {}),
    ...(probe.black_detection_status ? { blackDetectionStatus: probe.black_detection_status } : {}),
    ...(probe.black_detection_error ? { blackDetectionError: probe.black_detection_error } : {}),
  };
}

/**
 * Ask Chromium's shaping engine which platform fonts actually rendered each
 * caption node. Range rectangles alone cannot distinguish a real glyph from a
 * missing-glyph box, so this evidence is kept separate and conservative.
 */
async function measureDirectorGlyphCoverage(window: BrowserWindow, measurement: ProductionSubtitleSceneLayout, workDir: string): Promise<ProductionSubtitleSceneLayout> {
  if (measurement.status !== 'ok' || measurement.cues.length === 0) return measurement;
  const debuggerApi = window.webContents.debugger;
  let attached = false;
  try {
    if (!debuggerApi.isAttached()) { debuggerApi.attach('1.3'); attached = true; }
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('CSS.enable');
    const documentResult = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1 }) as { root?: { nodeId: number } };
    const rootNodeId = documentResult.root?.nodeId;
    if (!rootNodeId) throw new Error('Font coverage document root unavailable.');
    const captionsResult = await debuggerApi.sendCommand('DOM.querySelectorAll', { nodeId: rootNodeId, selector: '.caption' }) as { nodeIds?: number[] };
    const nodeIds = captionsResult.nodeIds ?? [];
    const captionTexts = await window.webContents.executeJavaScript('Array.from(document.querySelectorAll(".caption")).map(element => element.textContent || "")', true) as string[];
    if (nodeIds.length !== measurement.cues.length || captionTexts.length !== measurement.cues.length) throw new Error('Font coverage cue count mismatch.');
    const coverage = await Promise.all(measurement.cues.map(async (cue, index) => {
      const text = captionTexts[index] ?? '';
      const codePoints = [...new Set(Array.from(text).filter((character) => !/\s/u.test(character)))];
      const platformResult = await debuggerApi.sendCommand('CSS.getPlatformFontsForNode', { nodeId: nodeIds[index] }) as { fonts?: Array<{ familyName?: string; glyphCount?: number }> };
      const fonts = platformResult.fonts ?? [];
      const glyphCount = fonts.reduce((sum, font) => sum + (Number.isFinite(font.glyphCount) ? Math.max(0, Math.floor(font.glyphCount!)) : 0), 0);
      const fontFamilies = [...new Set(fonts.map((font) => font.familyName).filter((family): family is string => Boolean(family)))];
      return {
        ...cue,
        glyphCoverage: {
          verification: 'font-engine' as const,
          status: 'unavailable' as const,
          codePointCount: codePoints.length,
          renderedCodePointCount: 0,
          missingCodePoints: [],
          fontFamilies,
          glyphCount,
        },
      };
    }));
    const probe = await runStoryboundMediaSidecar({
      mode: 'probe_glyphs', work_dir: workDir,
      entries: coverage.map((cue, index) => ({
        font_families: cue.glyphCoverage?.fontFamilies ?? [],
        code_points: Array.from(captionTexts[index] ?? '').filter((character) => !/\s/u.test(character)).map((character) => character.codePointAt(0)!).filter(Number.isFinite),
      })),
    }, { timeoutMs: 30_000 });
    const results = probe.glyph_results ?? [];
    if (results.length !== coverage.length) throw new Error('Font coverage engine result count mismatch.');
    return { ...measurement, cues: coverage.map((cue, index) => {
      const result = results[index];
      const codePoints = Array.from(captionTexts[index] ?? '').filter((character) => !/\s/u.test(character));
      return {
        ...cue,
        glyphCoverage: {
          ...cue.glyphCoverage!,
          status: result.status,
          renderedCodePointCount: result.supported_code_points.length,
          missingCodePoints: result.missing_code_points.map((codePoint) => String.fromCodePoint(codePoint)),
          fontFamilies: result.font_families,
          glyphCount: cue.glyphCoverage?.glyphCount ?? 0,
          codePointCount: codePoints.length,
        },
      };
    }) };
  } catch {
    return {
      ...measurement,
      cues: measurement.cues.map((cue) => ({
        ...cue,
        glyphCoverage: {
          verification: 'font-engine' as const,
          status: 'unavailable' as const,
          codePointCount: cue.glyphCoverage?.codePointCount ?? 0,
          renderedCodePointCount: 0,
          missingCodePoints: [],
          fontFamilies: [],
          glyphCount: 0,
        },
      })),
    };
  } finally {
    if (attached && debuggerApi.isAttached()) debuggerApi.detach();
  }
}

async function assertFile(path: string, label: string) {
  const value = await stat(path).catch(() => null);
  if (!value?.isFile() || value.size <= 0) throw new Error(`DIRECTOR_RENDER_ASSET_MISSING: ${label}不存在或为空。`);
  return value;
}

function supportedImageExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? extension : '.png';
}

function supportedVideoExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return ['.mp4', '.webm', '.mov', '.m4v'].includes(extension) ? extension : '.mp4';
}
