import { open, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { TaskSummary } from './types';
import { projectVideoFirstFrame } from './project-cover-frame';

const MAX_COVER_STATE_BYTES = 4 * 1024 * 1024;

/** Read existing cover metadata without putting full pipeline documents in list IPC. */
export async function readProjectCover(
  task: TaskSummary,
  workDir: string | null,
  hints: { covers?: unknown[]; images?: unknown[]; videos?: unknown[]; sceneVideos?: unknown[]; background?: boolean; onReady?: () => void } = {},
): Promise<TaskSummary['projectCover']> {
  const base = workDir || (task.artifactStatePath ? resolve(dirname(task.artifactStatePath), '..') : null);
  const candidates: unknown[] = [task.projectCover?.path, task.ordinaryCoverAsset?.path, ...(hints.covers ?? [])];
  const images: unknown[] = [...(hints.images ?? [])];
  const sceneVideos: unknown[] = [...(hints.sceneVideos ?? [])];
  if (task.artifactStatePath && task.taskType !== 'html-video') {
    try {
      const file = await open(task.artifactStatePath, 'r');
      try {
        const size = (await file.stat()).size;
        const bytes = Buffer.alloc(Math.min(size + 1, MAX_COVER_STATE_BYTES + 1));
        let bytesRead = 0;
        while (bytesRead < bytes.length) {
          const chunk = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
          if (!chunk.bytesRead) break;
          bytesRead += chunk.bytesRead;
        }
        if (bytesRead <= MAX_COVER_STATE_BYTES) {
          const state = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
          if (state && (!state.taskId || state.taskId === task.id)) {
            const orderedPaths = (assets: unknown) => Array.isArray(assets)
              ? [...assets].sort((a, b) => Number(a?.sceneId ?? 0) - Number(b?.sceneId ?? 0)).map((asset) => asset?.path)
              : [];
            candidates.push(...orderedPaths(state.assets?.cover));
            images.push(...orderedPaths(state.assets?.images));
            sceneVideos.push(...orderedPaths(state.assets?.videos));
          }
        }
      } finally {
        await file.close();
      }
    } catch {
      // An absent or partly written state must not prevent the project list loading.
    }
  }
  async function existingCover(paths: unknown[]): Promise<TaskSummary['projectCover']> {
    for (const candidate of paths) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      const path = candidate.trim();
      if (/^[a-z]+:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) continue;
      if (!isAbsolute(path) && !base) continue;
      const absolutePath = resolve(base ?? '.', path);
      try {
        const info = await stat(absolutePath);
        if (info.isFile() && info.size > 0) {
          return { path: absolutePath, revision: `${info.mtimeMs}-${info.size}` };
        }
      } catch {
        // Missing covers fall through to another available project image.
      }
    }
    return null;
  }
  async function videoCover(paths: unknown[]): Promise<TaskSummary['projectCover']> {
    if (!base) return null;
    for (const candidate of paths) {
      const video = await existingCover([candidate]);
      if (!video) continue;
      const frame = await projectVideoFirstFrame(video.path, base, hints);
      if (frame) return existingCover([frame]);
      if (hints.background) break;
    }
    return null;
  }
  return await existingCover(candidates)
    ?? await videoCover(hints.videos ?? [])
    ?? await existingCover(images)
    ?? await videoCover(sceneVideos)
    ?? await existingCover([task.referenceImagePath]);
}
