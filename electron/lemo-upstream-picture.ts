import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { directorCanvasForRatio, type DirectorRenderDocument } from '../src/shared/director-render';
import { assertLemoUpstreamFilmCurrent } from './lemo-upstream-agent';
import { exportLemoUpstreamProject } from './lemo-upstream-renderer';
import { readLemoUpstreamManifest, type LemoSourceOptions } from './lemo-upstream-source';

type Library = Omit<LemoSourceOptions, 'filmDir'>;
interface CacheReceipt { version: 1; key: string; captureId: string; bytes: number; sha256: string }
async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function cachedPicture(directory: string, key: string): Promise<string | undefined> {
  try {
    const value = JSON.parse(await readFile(join(directory, 'picture.json'), 'utf8')) as CacheReceipt;
    if (value?.version !== 1 || value.key !== key || !/^[a-f0-9-]{36}$/.test(value.captureId)
      || !(value.bytes > 0) || !/^[a-f0-9]{64}$/.test(value.sha256)) return;
    const path = join(directory, value.captureId, 'native-picture.mp4');
    const info = await stat(path);
    if (info.isFile() && info.size === value.bytes && await digest(path) === value.sha256) return path;
  } catch (error) {
    // A partial or absent checkpoint is a cache miss; permission/disk errors are not.
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** One picture source for full export, single-shot export, and quality rechecks.
 * Only a completed, hash-verified capture is reusable; subtitles/audio are composed later.
 */
export async function prepareLemoUpstreamPicture(library: Library, work: string, document: DirectorRenderDocument, signal?: AbortSignal): Promise<string | undefined> {
  if (document.workflowKind !== 'editorial-collage' || document.productionRun?.authoringVersion !== 4) return;
  signal?.throwIfAborted();
  const film = document.upstreamFilm;
  if (!film || film.runId !== document.productionRun.id) throw new Error('LEMO_AGENT_NOT_READY: 请先完成当前原生工程。');
  const durationSeconds = (document.timeline?.durationMs ?? 0) / 1000;
  await assertLemoUpstreamFilmCurrent(film, durationSeconds);
  const canvas = directorCanvasForRatio(document.ratio);
  const manifest = await readLemoUpstreamManifest(library.upstreamRoot);
  // v3 invalidates missing/full-range color profiles; Chromium needs explicit sRGB/BT.709.
  const key = createHash('sha256').update(JSON.stringify({ version: 3, runId: film.runId,
    sourceHash: film.sourceHash, revision: manifest.revision, durationSeconds, ...canvas, fps: 30 })).digest('hex');
  const directory = join(work, 'vox-production', 'lemo-exports', key);
  const cached = await cachedPicture(directory, key);
  signal?.throwIfAborted();
  if (cached) { await assertLemoUpstreamFilmCurrent(film, durationSeconds); return cached; }
  const captureId = randomUUID();
  const picture = await exportLemoUpstreamProject({ ...library, filmDir: film.directory,
    outputDir: join(directory, captureId), durationSeconds, ...canvas, fps: 30, signal });
  signal?.throwIfAborted();
  await assertLemoUpstreamFilmCurrent(film, durationSeconds);
  if (!picture.receipt.technicalPassed) throw new Error('LEMO_EXPORT_FAILED: 原生画面技术检查未通过。');
  const info = await stat(picture.outputPath);
  if (!info.isFile() || !info.size) throw new Error('LEMO_EXPORT_EMPTY');
  const receipt: CacheReceipt = { version: 1, key, captureId, bytes: info.size, sha256: await digest(picture.outputPath) };
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `picture-${captureId}.json`);
  await writeFile(temp, JSON.stringify(receipt, null, 2), 'utf8');
  await rename(temp, join(directory, 'picture.json'));
  return picture.outputPath;
}
