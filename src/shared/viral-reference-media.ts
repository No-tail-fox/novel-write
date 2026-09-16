import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { BoundedProcessError, redactProcessOutput, runBoundedProcess } from './process-runner';
import { resolvePythonCommand } from './python-runtime';

export interface ReferenceMediaProbe {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export interface ReferenceMediaWindow {
  id: string;
  coreRange: { startMs: number; endMs: number };
  contextRange: { startMs: number; endMs: number };
}

export interface ReferenceWindowMedia {
  frames: Array<{ mediaId: string; path: string; timeMs: number }>;
  audioPath?: string;
  videoPath: string;
}

export const REFERENCE_MEDIA_SCAN_VERSION = 'decoded-scene-v1';
const SCAN_CHUNK_MS = 30_000;
const SCAN_CONTEXT_MS = 1_000;
const MAX_CORE_MS = 30_000;
const PROCESS_OUTPUT_LIMIT = 4 * 1024 * 1024;

/** All arguments are local application-owned paths, never URLs or model-supplied paths. */
export async function resolveReferenceFfmpeg(signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  try {
    const result = await runBoundedProcess(resolvePythonCommand({ appRoot: process.cwd() }), [
      '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())',
    ], processOptions(process.cwd(), signal, 15_000));
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
  } catch (error) {
    if (!(error instanceof BoundedProcessError) || error.code !== 'PROCESS_START_FAILED') throw error;
  }
  return 'ffmpeg';
}

export async function probeReferenceMedia(videoPath: string, signal?: AbortSignal): Promise<ReferenceMediaProbe> {
  await assertLocalFile(videoPath, signal);
  const ffmpeg = await resolveReferenceFfmpeg(signal);
  const adjacentProbe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const ffprobe = existsSync(adjacentProbe) ? adjacentProbe : 'ffprobe';
  try {
    const result = await runBoundedProcess(ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-of', 'json', videoPath,
    ], processOptions(dirname(videoPath), signal, 30_000));
    if (result.code === 0) return parseReferenceFfprobe(result.stdout);
  } catch (error) {
    if (!(error instanceof BoundedProcessError) || error.code !== 'PROCESS_START_FAILED') throw error;
  }
  // imageio_ffmpeg bundles FFmpeg but usually not ffprobe. Header-only inspection
  // deliberately has no output and therefore exits with code 1 on valid input.
  const result = await runBoundedProcess(ffmpeg, ['-hide_banner', '-nostdin', '-i', videoPath],
    processOptions(dirname(videoPath), signal, 30_000));
  return parseReferenceFfmpegHeader(result.stderr);
}

export function parseReferenceFfprobe(output: string): ReferenceMediaProbe {
  const payload = JSON.parse(output) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video'
    && (stream.disposition as { attached_pic?: number } | undefined)?.attached_pic !== 1);
  if (!video) throw new Error('媒体没有可解码的视频轨道。');
  const duration = positiveNumber(payload.format?.duration) || positiveNumber(video.duration);
  const sideData = Array.isArray(video.side_data_list) ? video.side_data_list as Array<Record<string, unknown>> : [];
  const tags = video.tags as Record<string, unknown> | undefined;
  const rotation = Number(sideData.find((item) => item.rotation !== undefined)?.rotation ?? tags?.rotate ?? 0);
  return checkedProbe({
    durationMs: Math.round(duration * 1_000),
    width: Number(video.width),
    height: Number(video.height),
    fps: parseRate(String(video.avg_frame_rate ?? '')) || parseRate(String(video.r_frame_rate ?? '')),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  }, rotation);
}

export function parseReferenceFfmpegHeader(output: string): ReferenceMediaProbe {
  const duration = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoLine = output.split(/\r?\n/).find((line) => /Stream .*Video:/.test(line) && !line.includes('(attached pic)'));
  const dimensions = videoLine?.match(/(?:,\s*|\s)(\d{1,6})x(\d{1,6})(?=[\s,\[])/);
  if (!duration || !dimensions) throw new Error('无法读取视频时长或画面尺寸；请确认文件完整且可解码。');
  const rotation = Number(output.match(/rotation of\s+(-?[\d.]+)\s+degrees/)?.[1]
    ?? output.match(/rotate\s*:\s*(-?[\d.]+)/)?.[1] ?? 0);
  return checkedProbe({
    durationMs: Math.round((Number(duration[1]) * 3_600 + Number(duration[2]) * 60 + Number(duration[3])) * 1_000),
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
    fps: Number(videoLine?.match(/([\d.]+)\s+fps/)?.[1] ?? videoLine?.match(/([\d.]+)\s+tbr/)?.[1] ?? 0),
    hasAudio: /Stream .*Audio:/.test(output),
  }, rotation);
}

export function buildReferenceScanChunks(durationMs: number): Array<{ startMs: number; endMs: number; readStartMs: number }> {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error('扫描需要有效的视频时长。');
  const chunks = [];
  for (let startMs = 0; startMs < durationMs; startMs += SCAN_CHUNK_MS) {
    chunks.push({ startMs, endMs: Math.min(durationMs, startMs + SCAN_CHUNK_MS), readStartMs: Math.max(0, startMs - SCAN_CONTEXT_MS) });
  }
  return chunks;
}

/** FFmpeg timestamps are relative to the seek point; only core-owned detections survive. */
export function parseReferenceSceneBoundaries(output: string, chunk: { startMs: number; endMs: number; readStartMs: number }): number[] {
  const times = new Set<number>();
  for (const match of output.matchAll(/\bpts_time:([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/gi)) {
    const timeMs = chunk.readStartMs + Math.round(Number(match[1]) * 1_000);
    if (Number.isSafeInteger(timeMs) && timeMs > 0 && timeMs >= chunk.startMs && timeMs < chunk.endMs) times.add(timeMs);
  }
  return [...times].sort((a, b) => a - b);
}

export async function scanReferenceMedia(
  videoPath: string,
  workDir: string,
  signal?: AbortSignal,
  onProgress?: (processedMs: number, durationMs: number) => void | Promise<void>,
): Promise<{ probe: ReferenceMediaProbe; sourceSha256: string; candidateBoundariesMs: number[]; scanVersion: string }> {
  const probe = await probeReferenceMedia(videoPath, signal);
  const targetDir = await prepareWorkDir(workDir, signal);
  const sourceSha256 = await hashReferenceMedia(videoPath, signal);
  const ffmpeg = await resolveReferenceFfmpeg(signal);
  const boundaries = new Set<number>();
  await onProgress?.(0, probe.durationMs);
  for (const chunk of buildReferenceScanChunks(probe.durationMs)) {
    throwIfAborted(signal);
    const result = await runBoundedProcess(ffmpeg, [
      '-hide_banner', '-nostdin', '-nostats', '-v', 'info',
      '-ss', seconds(chunk.readStartMs), '-t', seconds(chunk.endMs - chunk.readStartMs), '-i', videoPath,
      '-map', '0:V:0', '-an',
      // No fps filter: every decoded source frame participates in scene detection.
      '-vf', "scale=w='min(320,iw)':h=-2,select='gte(scene,0.30)',metadata=mode=print:key=lavfi.scene_score",
      '-fps_mode', 'passthrough', '-f', 'null', '-',
    ], processOptions(targetDir, signal, 180_000));
    assertProcessSuccess(result, '全片画面扫描');
    for (const time of parseReferenceSceneBoundaries(result.stderr, chunk)) boundaries.add(time);
    await onProgress?.(chunk.endMs, probe.durationMs);
  }
  return { probe, sourceSha256, candidateBoundariesMs: [...boundaries].sort((a, b) => a - b), scanVersion: REFERENCE_MEDIA_SCAN_VERSION };
}

export async function extractReferenceWindow(
  sourcePath: string,
  workDir: string,
  window: ReferenceMediaWindow,
  signal?: AbortSignal,
): Promise<ReferenceWindowMedia> {
  const probe = await probeReferenceMedia(sourcePath, signal);
  validateWindow(window, probe.durationMs);
  const rootDir = await prepareWorkDir(workDir, signal);
  // A window ID is data, not a directory name. Even a malicious ID cannot escape.
  const key = createHash('sha256').update(JSON.stringify([sourcePath, window])).digest('hex').slice(0, 24);
  const targetDir = join(rootDir, 'reference-windows', key);
  await mkdir(targetDir, { recursive: true });
  const ffmpeg = await resolveReferenceFfmpeg(signal);
  const frames: ReferenceWindowMedia['frames'] = [];
  const times = referenceObservationFrameTimes(window, probe.fps);
  for (const [index, timeMs] of times.entries()) {
    const path = join(targetDir, `frame-${index + 1}.jpg`);
    const result = await runBoundedProcess(ffmpeg, [
      '-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', seconds(timeMs), '-i', sourcePath,
      '-map', '0:V:0', '-frames:v', '1', '-vf', "scale=w='min(768,iw)':h=-2", '-q:v', '4', path,
    ], processOptions(targetDir, signal, 60_000));
    assertProcessSuccess(result, '观察帧提取');
    await assertNonEmptyFile(path);
    frames.push({ mediaId: `reference-${key}-frame-${index + 1}`, path, timeMs });
  }
  // Audio/video use the core range (max 30 s); context frames retain cross-window
  // evidence without silently truncating a 32 s context clip to a different range.
  const durationMs = window.coreRange.endMs - window.coreRange.startMs;
  const videoPath = join(targetDir, 'video.mp4');
  const videoResult = await runBoundedProcess(ffmpeg, [
    '-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', seconds(window.coreRange.startMs), '-i', sourcePath,
    '-t', seconds(durationMs), '-map', '0:V:0', '-map', '0:a:0?',
    '-vf', "scale=w='min(640,iw)':h=-2", '-r', String(Math.min(probe.fps || 24, 30)),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '16000', '-movflags', '+faststart', videoPath,
  ], processOptions(targetDir, signal, 120_000));
  assertProcessSuccess(videoResult, '观察视频提取');
  await assertNonEmptyFile(videoPath);
  let audioPath: string | undefined;
  if (probe.hasAudio) {
    audioPath = join(targetDir, 'audio.wav');
    const result = await runBoundedProcess(ffmpeg, [
      '-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', seconds(window.coreRange.startMs), '-i', sourcePath,
      '-t', seconds(durationMs), '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', audioPath,
    ], processOptions(targetDir, signal, 90_000));
    assertProcessSuccess(result, '观察音频提取');
    await assertNonEmptyFile(audioPath);
  }
  return { frames, audioPath, videoPath };
}

export function referenceWindowFrameTimes(range: { startMs: number; endMs: number }, fps: number): number[] {
  if (!Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) || range.startMs < 0 || range.endMs <= range.startMs) {
    throw new Error('观察帧区间无效。');
  }
  const marginMs = Math.min(range.endMs - range.startMs, Math.max(1, Math.ceil(1_000 / (fps || 25))));
  const lastMs = Math.max(range.startMs, range.endMs - marginMs);
  return Array.from({ length: 4 }, (_, index) => Math.round(range.startMs + (lastMs - range.startMs) * index / 3));
}

/** Reserve two samples inside the core so dense, short shots cannot disappear into context. */
export function referenceObservationFrameTimes(window: ReferenceMediaWindow, fps: number): number[] {
  const core = referenceWindowFrameTimes(window.coreRange, fps);
  const context = referenceWindowFrameTimes(window.contextRange, fps);
  return [context[0], core[1], core[2], context[3]];
}

async function hashReferenceMedia(path: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const hash = createHash('sha256');
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024, signal });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  throwIfAborted(signal);
  return hash.digest('hex');
}

function validateWindow(window: ReferenceMediaWindow, durationMs: number): void {
  if (!window.id || window.id.length > 512) throw new Error('观察窗口 ID 无效。');
  for (const range of [window.coreRange, window.contextRange]) {
    if (!Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs)
      || range.startMs < 0 || range.endMs <= range.startMs || range.endMs > durationMs) throw new Error('观察窗口超出视频范围。');
  }
  if (window.coreRange.endMs - window.coreRange.startMs > MAX_CORE_MS
    || window.contextRange.startMs > window.coreRange.startMs || window.contextRange.endMs < window.coreRange.endMs
    || window.coreRange.startMs - window.contextRange.startMs > SCAN_CONTEXT_MS
    || window.contextRange.endMs - window.coreRange.endMs > SCAN_CONTEXT_MS) throw new Error('观察窗口必须不超过 30 秒，前后上下文各不超过 1 秒。');
}

function checkedProbe(probe: ReferenceMediaProbe, rotation = 0): ReferenceMediaProbe {
  if (!Number.isSafeInteger(probe.durationMs) || probe.durationMs <= 0
    || !Number.isSafeInteger(probe.width) || probe.width <= 0
    || !Number.isSafeInteger(probe.height) || probe.height <= 0
    || !Number.isFinite(probe.fps) || probe.fps < 0) throw new Error('视频探测结果无效。');
  const quarterTurns = Math.abs(Math.round(rotation / 90)) % 2;
  return quarterTurns ? { ...probe, width: probe.height, height: probe.width } : probe;
}

function parseRate(value: string): number {
  const [numerator, denominator = '1'] = value.split('/');
  return positiveNumber(Number(numerator) / Number(denominator));
}

function positiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

async function assertLocalFile(path: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('媒体路径必须是本地绝对路径。');
  await assertNonEmptyFile(path);
}

async function assertNonEmptyFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0) throw new Error('媒体文件为空或不是普通文件。');
}

async function prepareWorkDir(path: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('媒体工作目录必须是本地绝对路径。');
  const target = resolve(path);
  await mkdir(target, { recursive: true });
  return target;
}

function processOptions(cwd: string, signal: AbortSignal | undefined, timeoutMs: number) {
  return { cwd, signal, timeoutMs, maxStdoutBytes: PROCESS_OUTPUT_LIMIT, maxStderrBytes: PROCESS_OUTPUT_LIMIT };
}

function assertProcessSuccess(result: { code: number | null; stderr: string }, operation: string): void {
  if (result.code !== 0) throw new Error(`${operation}失败：${redactProcessOutput(result.stderr).slice(-2_000) || `FFmpeg exit ${result.code}`}`);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BoundedProcessError('PROCESS_ABORTED', '媒体处理已取消。');
}

function seconds(timeMs: number): string {
  return (timeMs / 1_000).toFixed(3);
}
