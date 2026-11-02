import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TaskArtifactVideoPreview } from './types';
import { stockMediaProvenanceSchema } from './stock-media';

/** Portable evidence accompanies each delivery; no temporary CDN URL or credential is retained. */
export async function writeStockMediaManifest(path: string, videos: TaskArtifactVideoPreview[] = []): Promise<void> {
  const scenes = videos.filter(video => video.stockMedia?.length).map(video => ({ sceneId: video.sceneId, sources: video.stockMedia!.map(source => stockMediaProvenanceSchema.parse(source)) }));
  if (!scenes.length) { await rm(path, { force: true }); return; }
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.partial';
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, recordedAt: new Date().toISOString(), scenes, notice: 'Provider attribution and license references are retained for traceability. Check the linked license and any third-party rights before use.' }, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
