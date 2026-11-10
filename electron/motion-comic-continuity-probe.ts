/**
 * Advisory cut-continuity sampling for AI 漫剧 shot videos (backlog C-2).
 *
 * Extracts the last frame of the previous shot and the first frame of the new shot as tiny RGBA
 * thumbnails with the bundled ffmpeg (same resolution as the final-film gate) and scores them with the
 * pure perceptual-hash helpers. Everything here is best effort: any failure (no ffmpeg, unreadable
 * video, timeout) yields `undefined` and must never block or fail a generation.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawFrame } from '../src/shared/frame-hash';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolveFinalFilmFfmpeg } from './final-film-gate-runner';

/** Thumbnail edge; aHash/dHash downsample to 8–9 cells, so 32 px keeps area averaging meaningful. */
export const CONTINUITY_FRAME_SIZE = 32;
const FRAME_BYTES = CONTINUITY_FRAME_SIZE * CONTINUITY_FRAME_SIZE * 4;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Every mode writes exactly one thumbnail; allow one spare frame of slack, reject anything larger unread. */
const MAX_FRAME_FILE_BYTES = FRAME_BYTES * 2;

export interface ContinuityFramePair {
  previousLastFrame: RawFrame;
  firstFrame: RawFrame;
}

function scaleFilter(): string {
  return `scale=${CONTINUITY_FRAME_SIZE}:${CONTINUITY_FRAME_SIZE}:flags=area,format=rgba`;
}

/**
 * ffmpeg arguments for one edge frame written as raw RGBA to `outputPath`. Every mode leaves at most ONE
 * frame (4 KiB) on disk, so the output is bounded on the ffmpeg side:
 *
 * - `first`: exactly the first decoded frame (`-frames:v 1`).
 * - `last`: decodes the final second (`-sseof -1`, accurate seek) and lets the image2 muxer overwrite
 *   the same file per frame (`-update 1`), so the TRUE last frame remains. Deliberately not
 *   `-frames:v 1`, which would return the first frame of that second.
 * - `last-full`: same, over the whole video stream; fallback when the tail window holds no video (the
 *   container/audio runs longer than the video stream).
 */
export function continuityFrameArgs(videoPath: string, edge: 'first' | 'last' | 'last-full', outputPath: string): string[] {
  const common = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  const video = ['-map', '0:v:0', '-an', '-sn', '-dn', '-vf', scaleFilter()];
  if (edge === 'first') return [...common, '-i', videoPath, ...video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', outputPath];
  const input = edge === 'last' ? ['-sseof', '-1', '-i', videoPath] : ['-i', videoPath];
  return [...common, ...input, ...video, '-c:v', 'rawvideo', '-pix_fmt', 'rgba', '-f', 'image2', '-update', '1', outputPath];
}

/** Last complete RGBA thumbnail from a raw dump (the first frame for `first`, the final one for `last`). */
export function rawFrameFromDump(bytes: Uint8Array, edge: 'first' | 'last'): RawFrame | undefined {
  const frames = Math.floor(bytes.length / FRAME_BYTES);
  if (frames < 1) return undefined;
  const start = edge === 'first' ? 0 : (frames - 1) * FRAME_BYTES;
  return { data: bytes.subarray(start, start + FRAME_BYTES), width: CONTINUITY_FRAME_SIZE, height: CONTINUITY_FRAME_SIZE, channels: 'rgba' };
}

async function runFrameDump(
  ffmpegPath: string,
  videoPath: string,
  mode: 'first' | 'last' | 'last-full',
  workDir: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  const output = join(workDir, `${mode}.rgba`);
  const result = await runBoundedProcess(ffmpegPath, continuityFrameArgs(videoPath, mode, output), {
    cwd: workDir, timeoutMs, maxStdoutBytes: 64 * 1024, maxStderrBytes: 256 * 1024, ...(signal ? { signal } : {}),
  });
  if (result.code !== 0) return undefined;
  // Size-checked before reading: anything but a single thumbnail is rejected without loading it.
  const info = await stat(output).catch(() => null);
  if (!info?.isFile() || info.size < FRAME_BYTES || info.size > MAX_FRAME_FILE_BYTES) return undefined;
  return readFile(output).catch(() => undefined);
}

async function extractEdgeFrame(
  ffmpegPath: string,
  videoPath: string,
  edge: 'first' | 'last',
  workDir: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RawFrame | undefined> {
  const dump = await runFrameDump(ffmpegPath, videoPath, edge, workDir, timeoutMs, signal);
  const frame = dump ? rawFrameFromDump(dump, edge) : undefined;
  if (frame || edge === 'first') return frame;
  const full = await runFrameDump(ffmpegPath, videoPath, 'last-full', workDir, timeoutMs, signal);
  return full ? rawFrameFromDump(full, 'last') : undefined;
}

/**
 * Previous shot's last frame + this shot's first frame. Never throws; `undefined` when anything is
 * missing. `ffmpegPath` is resolved from the bundled runtime when omitted.
 */
export async function sampleMotionComicCutFrames(input: {
  previousVideoPath: string;
  videoPath: string;
  ffmpegPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ContinuityFramePair | undefined> {
  let workDir: string | undefined;
  try {
    const ffmpegPath = input.ffmpegPath ?? (await resolveFinalFilmFfmpeg({ ffprobePath: null }))?.ffmpegPath;
    if (!ffmpegPath) return undefined;
    const timeoutMs = Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    workDir = await mkdtemp(join(tmpdir(), 'opc-continuity-'));
    const previousLastFrame = await extractEdgeFrame(ffmpegPath, input.previousVideoPath, 'last', workDir, timeoutMs, input.signal);
    if (!previousLastFrame) return undefined;
    const firstFrame = await extractEdgeFrame(ffmpegPath, input.videoPath, 'first', workDir, timeoutMs, input.signal);
    if (!firstFrame) return undefined;
    return { previousLastFrame, firstFrame };
  } catch {
    return undefined;
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
