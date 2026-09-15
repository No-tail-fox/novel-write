import { open, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { TaskSummary } from './types';

const MAX_COVER_STATE_BYTES = 4 * 1024 * 1024;

/** Read existing cover metadata without putting full pipeline documents in list IPC. */
export async function readProjectCover(
  task: TaskSummary,
  workDir: string | null,
): Promise<TaskSummary['projectCover']> {
  const base = workDir || (task.artifactStatePath ? resolve(dirname(task.artifactStatePath), '..') : null);
  const candidates: unknown[] = [task.projectCover?.path, task.ordinaryCoverAsset?.path];
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
          if (state && (!state.taskId || state.taskId === task.id) && Array.isArray(state.assets?.cover)) {
            candidates.push(...state.assets.cover.map((asset: { path?: unknown } | null) => asset?.path));
          }
        }
      } finally {
        await file.close();
      }
    } catch {
      // An absent or partly written state must not prevent the project list loading.
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const path = candidate.trim();
    if (!isAbsolute(path) && !base) continue;
    const absolutePath = resolve(base ?? '.', path);
    try {
      const info = await stat(absolutePath);
      if (info.isFile() && info.size > 0) {
        return { path: absolutePath, revision: `${info.mtimeMs}-${info.size}` };
      }
    } catch {
      // Missing covers fall through to another cover or the reference image.
    }
  }
  return null;
}
