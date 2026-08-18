import { mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDirectorSceneHtml, directorCanvasForRatio, type DirectorRenderResult, type DirectorRenderScene } from '../src/shared/director-render';
import { createElectronHtmlVideoRenderer } from './html-video-renderer';

export async function renderDirectorVideo(input: {
  workDir: string;
  projectTitle: string;
  modeLabel: string;
  ratio: string;
  scenes: readonly DirectorRenderScene[];
}): Promise<DirectorRenderResult> {
  if (input.scenes.length === 0) throw new Error('DIRECTOR_RENDER_EMPTY: 当前项目没有可渲染的镜头。');
  const mediaDir = join(input.workDir, 'director-media');
  const exportDir = join(input.workDir, 'exports');
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const stagedScenes = [];
  for (const scene of input.scenes) {
    await assertFile(scene.imagePath, `镜头 ${scene.index} 图片`);
    await assertFile(scene.audioPath, `镜头 ${scene.index} 旁白`);
    const imageExtension = supportedImageExtension(scene.imagePath);
    const stagedImage = join(mediaDir, `shot-${String(scene.index).padStart(3, '0')}${imageExtension}`);
    await copyFile(scene.imagePath, stagedImage);
    stagedScenes.push({
      sceneId: scene.index,
      title: scene.title,
      caption: scene.caption,
      description: scene.caption,
      imagePath: stagedImage,
      duration: Math.max(0.8, scene.durationMs / 1000),
      durationMs: scene.durationMs,
      audioPath: scene.audioPath,
      html: buildDirectorSceneHtml({
        title: scene.title,
        caption: scene.caption,
        imageUrl: pathToFileURL(stagedImage).toString(),
        durationMs: scene.durationMs,
        modeLabel: input.modeLabel,
        index: scene.index,
        layoutTemplate: scene.layoutTemplate,
        motionPreset: scene.motionPreset,
        subtitleStyle: scene.subtitleStyle,
      }),
    });
  }

  const canvas = directorCanvasForRatio(input.ratio);
  const outputPath = join(exportDir, `director-${Date.now()}.mp4`);
  const totalDurationS = stagedScenes.reduce((total, scene) => total + scene.duration, 0);
  const result = await createElectronHtmlVideoRenderer().render({
    workDir: input.workDir,
    outputPath,
    title: input.projectTitle,
    fps: 24,
    canvas_w: canvas.width,
    canvas_h: canvas.height,
    totalDurationS,
    transition: { type: 'fade', duration: 0.28 },
    scenes: stagedScenes,
  });
  const output = await stat(result.outputPath);
  if (!output.isFile() || output.size <= 0) throw new Error('DIRECTOR_RENDER_OUTPUT_INVALID: 成片文件未正确生成。');
  return { outputPath: result.outputPath, durationMs: Math.round(totalDurationS * 1000), sizeBytes: output.size };
}

async function assertFile(path: string, label: string): Promise<void> {
  const value = await stat(path).catch(() => null);
  if (!value?.isFile() || value.size <= 0) throw new Error(`DIRECTOR_RENDER_ASSET_MISSING: ${label}不存在或为空。`);
}

function supportedImageExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? extension : '.png';
}
