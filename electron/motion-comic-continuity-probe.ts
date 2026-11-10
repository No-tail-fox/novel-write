/**
 * Advisory cut-continuity sampling for AI 漫剧 shot videos (backlog C-2).
 *
 * Extracts the last frame of the previous shot and the first frame of the new shot as tiny RGBA
 * thumbnails with the bundled ffmpeg (same resolution as the final-film gate) and scores them with the
 * pure perceptual-hash helpers. Everything here is best effort: any failure (no ffmpeg, unreadable
 * video, timeout) yields `undefined` and must never block or fail a generation.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawFrame } from '../src/shared/frame-hash';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolveFinalFilmFfmpeg } from './final-film-gate-runner';

/** Thumbnail edge; aHash/dHash downsample to 8–9 cells, so 32 px keeps area averaging meaningful. */
export const CONTINUITY_FRAME_SIZE = 32;
const FRAME_BYTES = CONTINUITY_FRAME_SIZE * CONTINUITY_FRAME_SIZE * 4;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Cap for the decoded dump: the 1 s tail (`-sseof -1`) at up to 240 fps. */
const MAX_TAIL_BYTES = FRAME_BYTES * 240;

export interface ContinuityFramePair {
  previousLastFrame: RawFrame;
  firstFrame: RawFrame;
}

function scaleFilter(): string {
  return `scale=${CONTINUITY_FRAME_SIZE}:${CONTINUITY_FRAME_SIZE}:flags=area,format=rgba`;
}

/** ffmpeg arguments for one edge frame written as raw RGBA to `outputPath`. */
export function continuityFrameArgs(videoPath: string, edge: 'first' | 'last', outputPath: string): string[] {
  const input = edge === 'last' ? ['-sseof', '-1', '-i', videoPath] : ['-i', videoPath];
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    ...input,
    '-map', '0:v:0', '-an', '-sn',
    ...(edge === 'first' ? ['-frames:v', '1'] : []),
    '-vf', scaleFilter(),
    '-f', 'rawvideo', '-pix_fmt', 'rgba',
    outputPath,
  ];
}

/** Last complete RGBA thumbnail from a raw dump (the first frame for `first`, the final one for `last`). */
export function rawFrameFromDump(bytes: Uint8Array, edge: 'first' | 'last'): RawFrame | undefined {
  const frames = Math.floor(bytes.length / FRAME_BYTES);
  if (frames < 1) return undefined;
  const start = edge === 'first' ? 0 : (frames - 1) * FRAME_BYTES;
  return { data: bytes.subarray(start, start + FRAME_BYTES), width: CONTINUITY_FRAME_SIZE, height: CONTINUITY_FRAME_SIZE, channels: 'rgba' };
}

async function extractEdgeFrame(
  ffmpegPath: string,
  videoPath: string,
  edge: 'first' | 'last',
  workDir: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RawFrame | undefined> {
  const output = join(workDir, `${edge}.rgba`);
  const result = await runBoundedProcess(ffmpegPath, continuityFrameArgs(videoPath, edge, output), {
    cwd: workDir, timeoutMs, maxStdoutBytes: 64 * 1024, maxStderrBytes: 256 * 1024, ...(signal ? { signal } : {}),
  });
  if (result.code !== 0) return undefined;
  const bytes = await readFile(output);
  if (bytes.length > MAX_TAIL_BYTES) return undefined;
  return rawFrameFromDump(bytes, edge);
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
