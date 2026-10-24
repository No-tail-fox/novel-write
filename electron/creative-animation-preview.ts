import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes, directorCanvasForRatio } from '../src/shared/director-render';
import { prepareVoxHtml, readVoxAsset } from './vox-animation-runtime';
import { reviewHtmlAnimationFrames } from './html-video-renderer';
import { creativeStyle } from '../src/shared/creative-animation/styles';

export async function reviewCreativeAnimation(document: EditorialCollagePipelineData, shotId: string, workDir: string, runtimePath: string): Promise<string[]> {
  const scene = buildDirectorRenderScenes(document, undefined, { shotIds: [shotId] })[0];
  if (!scene?.animation) throw new Error('CREATIVE_PREVIEW_EMPTY: 没有可预览的镜头。');
  const canvas = directorCanvasForRatio(document.ratio);
  const assets = await Promise.all((scene.animationAssets ?? []).map(async asset => ({ id: asset.id, label: asset.id, kind: asset.kind, url: await readVoxAsset(asset.path) })));
  const html = await prepareVoxHtml(runtimePath, { animation: scene.animation, assets, cues: scene.subtitleCues ?? [],
    width: canvas.width, height: canvas.height, fps: 24, durationMs: scene.durationMs, subtitleStyle: scene.subtitleStyle });
  await mkdir(workDir, { recursive: true });
  const htmlPath = join(workDir, 'animation.html');
  await writeFile(htmlPath, html, 'utf8');
  const approvedText = [document.sourceText, ...document.productionRun?.settings.data.map(row => `${row.label} ${row.value} ${row.source}`) ?? [], ...document.productionRun?.settings.archives.map(row => row.source) ?? []].join('\n');
  const style = creativeStyle(scene.animation.authoring?.styleId ?? '');
  // Apply the palette only to generated abstract scenes without photographic plates.
  const expectedBackground = style?.adapter && !assets.some(asset => asset.kind === 'image') ? style.adapter.background : undefined;
  return reviewHtmlAnimationFrames({ workDir, htmlPath, canvas, durationMs: scene.durationMs, approvedText, expectedBackground });
}
