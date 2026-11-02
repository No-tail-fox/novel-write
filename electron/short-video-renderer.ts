import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WriteJianyingDraftInput } from '../src/shared/draft';
import { buildShortVideoComposition, prepareShortVideoInput } from '../src/shared/short-video-render';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { createElectronHtmlVideoRenderer } from './html-video-renderer';
import { writeStockMediaManifest } from '../src/shared/stock-media-manifest';

export async function prepareShortVideoOutputs(input: WriteJianyingDraftInput, signal?: AbortSignal): Promise<WriteJianyingDraftInput> {
  const durations = new Map<string, number>();
  return prepareShortVideoInput(input, async path => {
    signal?.throwIfAborted();
    if (durations.has(path)) return durations.get(path)!;
    const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: input.workDir, media_path: path, measure_audio_duration: true }, { signal });
    const duration = probe.audio_duration_ms ?? (probe.duration ?? 0) * 1000;
    if (!probe.has_audio || !Number.isFinite(duration) || duration <= 0) throw new Error(`音频不可用：${path}`);
    durations.set(path, duration);
    return duration;
  });
}

export async function renderShortVideo(input: WriteJianyingDraftInput, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const composition = buildShortVideoComposition(input);
  const finalPath = composition.outputPath;
  await mkdir(dirname(finalPath), { recursive: true });
  const temporaryPath = join(dirname(finalPath), `short-video-${randomUUID()}.partial.mp4`);
  try {
    await createElectronHtmlVideoRenderer().render({ ...composition, outputPath: temporaryPath }, { signal });
    const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: input.workDir, media_path: temporaryPath, require_nonblack: true }, { signal });
    if (!probe.has_video || !probe.has_audio || probe.width !== composition.canvas_w || probe.height !== composition.canvas_h || !Number.isFinite(probe.duration) || Math.abs(probe.duration! - composition.totalDurationS) > .15) {
      throw new Error(`MP4 验收失败：期望 ${composition.canvas_w}×${composition.canvas_h} / ${composition.totalDurationS.toFixed(3)} 秒；实际 ${probe.width}×${probe.height} / ${probe.duration} 秒`);
    }
    signal?.throwIfAborted();
    await rename(temporaryPath, finalPath);
    await writeStockMediaManifest(finalPath + '.sources.json', input.generatedVideos);
    return finalPath;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
