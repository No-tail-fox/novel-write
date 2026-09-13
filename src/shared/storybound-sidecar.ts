import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  redactProcessOutput,
  runBoundedProcess,
  type BoundedProcessOptions,
  type BoundedProcessResult,
} from './process-runner';
import { resolvePythonRuntimeInfo, type PythonRuntimeInfo } from './python-runtime';
import type { ProductionVisualContinuityEvidence } from './production-visual-continuity';

const defaultSidecarTimeoutMs = 60 * 60 * 1_000;
const defaultSidecarStdoutBytes = 4 * 1024 * 1024;
const defaultSidecarStderrBytes = 16 * 1024 * 1024;

export interface StoryboundStoryAssets {
  images?: Array<{ scene_id: number; path: string }>;
  videos?: Array<{
    scene_id: number;
    path: string;
    duration_ms: number;
    trim_start_ms: number;
    fit: 'cover' | 'contain';
    muted: true;
  }>;
  narration?: Array<{ scene_id: number; path: string; speaker?: 'A' | 'B'; turn_index?: number; text?: string }>;
  subtitles_path?: string;
  scenes?: Array<{ scene_id: number; start_us: number; duration_us: number; text: string }>;
}

export interface StoryboundStoryInput {
  mode?: 'story';
  task_dir: string;
  cover_title: unknown;
  bgm_path: string;
  jianying_draft_path: string;
  template: unknown;
  task_title?: string;
  cover_image_path?: string;
  cover_page?: {
    image_path: string;
    text: string;
    duration_us: number;
  };
  assets?: StoryboundStoryAssets;
}

export interface StoryboundMusicMvInput {
  mode: 'music_mv';
  work_dir: string;
  audio_path: string;
  audio_duration: number;
  material_source: string;
  assignments: Array<Record<string, unknown>>;
  lyrics: Array<Record<string, unknown>>;
  jianying_draft_path: string;
  task_title?: string;
  template?: unknown;
  cover_title?: unknown;
  cover_image_path?: string;
  bgm_path?: string;
  ratio?: string;
  canvas?: { width: number; height: number; ratio: string };
  caption_style?: 'karaoke' | 'minimal' | 'none';
}

export interface StoryboundFrameRenderScene {
  frames_dir: string;
  audio_path: string;
  audio_clips?: Array<{
    id: string;
    path: string;
    trackType: string;
    startMs: number;
    sourceStartMs?: number;
    sourceDurationMs?: number;
    durationMs: number;
    gainDb?: number;
    fadeInMs?: number;
    fadeOutMs?: number;
    fadeEnvelope?: import('./production-audio').ProductionAudioFadeEnvelope;
    muted?: boolean;
  }>;
  fps?: number;
  duration_s?: number;
}

export interface StoryboundEncodedRenderScene {
  segment_path: string;
  duration_s: number;
  fps?: number;
  frames_dir?: never;
  audio_path?: never;
  audio_clips?: never;
}

export interface StoryboundEncodeRenderSceneInput {
  mode: 'encode_render_scene';
  work_dir: string;
  scene: StoryboundFrameRenderScene;
  output_path: string;
}

export interface StoryboundComposeRenderInput {
  mode: 'compose_render';
  work_dir: string;
  scenes: Array<StoryboundFrameRenderScene | StoryboundEncodedRenderScene>;
  output_path: string;
  bgm_path?: string;
  total_duration_s?: number;
  bgm_target_db?: number;
  transition?: string | { type: string; duration: number };
  cover_path?: string;
  cover_duration_s?: number;
  canvas_w?: number;
  canvas_h?: number;
}

export interface StoryboundRemixBgmInput {
  mode: 'remix_bgm';
  source_path: string;
  bgm_path?: string;
  bgm_target_db?: number;
  total_duration_s?: number;
  output_path: string;
}

export interface StoryboundConvertAudioInput {
  mode: 'convert_audio_16k';
  audio_path: string;
  output_path: string;
}

export interface StoryboundProbeMediaInput {
  mode: 'probe_media';
  work_dir: string;
  media_path: string;
  require_nonblack?: boolean;
  analyze_quality?: boolean;
  /** Cut times relative to this output, decoded at visual_continuity_fps. */
  visual_continuity_points_ms?: number[];
  visual_continuity_fps?: number;
}

export interface StoryboundNormalizeSceneVideoInput {
  mode: 'normalize_scene_video';
  work_dir: string;
  video_path: string;
  output_path: string;
  require_nonblack?: boolean;
}

export interface StoryboundProbeGlyphsInput {
  mode: 'probe_glyphs';
  work_dir: string;
  entries: Array<{ font_families: string[]; code_points: number[] }>;
}

export type StoryboundSidecarInput =
  | StoryboundStoryInput
  | StoryboundMusicMvInput
  | StoryboundComposeRenderInput
  | StoryboundEncodeRenderSceneInput
  | StoryboundRemixBgmInput
  | StoryboundConvertAudioInput
  | StoryboundProbeMediaInput
  | StoryboundNormalizeSceneVideoInput
  | StoryboundProbeGlyphsInput;

export interface StoryboundSidecarResult {
  success: boolean;
  draft_dir?: string;
  draft_id?: string;
  output_path?: string;
  source_path?: string;
  duration?: number;
  has_audio?: boolean;
  has_video?: boolean;
  width?: number;
  height?: number;
  video_codec?: string;
  has_nonblack_video?: boolean;
  audio_mean_volume_db?: number;
  audio_peak_db?: number;
  audio_lufs?: number;
  audio_true_peak_db?: number;
  audio_is_silent?: boolean;
  black_intervals?: Array<{ start_ms: number; end_ms: number }>;
  visual_continuity?: ProductionVisualContinuityEvidence;
  audio_quality_status?: 'ok' | 'failed' | 'unavailable';
  audio_quality_error?: string;
  black_detection_status?: 'ok' | 'failed' | 'unavailable';
  black_detection_error?: string;
  glyph_results?: Array<{
    status: 'ok' | 'failed' | 'unavailable';
    supported_code_points: number[];
    missing_code_points: number[];
    font_families: string[];
  }>;
  error?: string;
  traceback?: string;
}

export interface StoryboundSidecarRunnerOptions {
  pythonCommand?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal;
  execute?: (
    command: string,
    args: string[],
    options: BoundedProcessOptions,
  ) => Promise<{
    code?: number | null;
    signal?: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>;
}

export async function writeStoryboundSidecarInput(input: StoryboundSidecarInput, workDir = resolveStoryboundWorkDir(input)): Promise<string> {
  const sidecarDir = join(workDir, 'storybound-media-sidecar');
  await mkdir(sidecarDir, { recursive: true });
  const payloadPath = join(sidecarDir, 'input.json');
  await writeFile(payloadPath, JSON.stringify(input, null, 2), 'utf8');
  return payloadPath;
}

export async function writeStoryboundSidecarScript(workDir: string): Promise<string> {
  const sidecarDir = join(workDir, 'storybound-media-sidecar');
  await mkdir(sidecarDir, { recursive: true });
  const scriptPath = join(sidecarDir, 'sidecar.py');
  await writeFile(scriptPath, pythonSidecarScript, 'utf8');
  return scriptPath;
}

export async function runStoryboundMediaSidecar(
  input: StoryboundSidecarInput,
  options: StoryboundSidecarRunnerOptions = {},
): Promise<StoryboundSidecarResult> {
  const workDir = resolveStoryboundWorkDir(input);
  const scratchToken = randomUUID().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  const payload = { ...input, _storyboundScratchToken: scratchToken } as unknown as StoryboundSidecarInput;
  const payloadPath = await writeStoryboundSidecarInput(payload, workDir);
  const scriptPath = await writeStoryboundSidecarScript(workDir);
  const runtime: PythonRuntimeInfo = options.pythonCommand ? { command: options.pythonCommand, source: 'system' } : resolvePythonRuntimeInfo();
  const execute = options.execute ?? executePython;
  let execution: Awaited<ReturnType<NonNullable<StoryboundSidecarRunnerOptions['execute']>>>;
  let cleanupScratch = false;
  try {
    execution = await execute(runtime.command, [scriptPath, payloadPath], {
      cwd: workDir,
      timeoutMs: options.timeoutMs ?? defaultSidecarTimeoutMs,
      maxStdoutBytes: options.maxStdoutBytes ?? defaultSidecarStdoutBytes,
      maxStderrBytes: options.maxStderrBytes ?? defaultSidecarStderrBytes,
      signal: options.signal,
    });
    cleanupScratch = Boolean(execution.signal) || (execution.code ?? 0) !== 0;
  } catch (error) {
    cleanupScratch = true;
    throw safeSidecarExecutionError(error);
  } finally {
    if (cleanupScratch) await cleanupStoryboundScratch(workDir, scratchToken);
  }
  if (execution.signal) {
    const detail = safeProcessDetail([execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n'));
    throw new Error(`Jianying draft sidecar terminated by signal ${execution.signal}${detail ? `: ${detail}` : '.'}`);
  }
  const code = execution.code ?? 0;

  if (code !== 0) {
    const detail = safeProcessDetail([execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n')) || 'unknown error';
    throw new Error(`Jianying draft sidecar 退出码 ${code}: ${detail}`);
  }

  const result = parseStoryboundSidecarOutput(execution.stdout);
  if (result.success === false) {
    const detail = safeProcessDetail([result.error || 'Storybound-compatible sidecar failed.', result.traceback].filter(Boolean).join('\n'));
    throw new Error(detail);
  }
  return result;
}

async function cleanupStoryboundScratch(workDir: string, scratchToken: string): Promise<void> {
  try {
    const entries = await readdir(workDir, { withFileTypes: true });
    await Promise.all(entries.filter(entry => {
      if (entry.isDirectory()) return new RegExp(`^(?:compose-groups|compose-xfade-groups)-${scratchToken}-`, 'u').test(entry.name);
      return new RegExp(`^(?:storybound|visual-cuts)-${scratchToken}-.*\\.filter$`, 'u').test(entry.name);
    }).map(entry => rm(join(workDir, entry.name), { recursive: entry.isDirectory(), force: true })));
  } catch {
    // Scratch cleanup is best effort; preserve the sidecar's original result.
  }
}

export function parseStoryboundSidecarOutput(output: string): StoryboundSidecarResult {
  const lastJsonLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!lastJsonLine) {
    throw new Error('Storybound-compatible sidecar did not return JSON output.');
  }
  try {
    return JSON.parse(lastJsonLine) as StoryboundSidecarResult;
  } catch (error) {
    throw new Error(`Storybound-compatible sidecar returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveStoryboundWorkDir(input: StoryboundSidecarInput): string {
  if ('task_dir' in input) return input.task_dir;
  if ('work_dir' in input) return input.work_dir;
  if ('source_path' in input) return dirname(input.output_path || input.source_path);
  if ('audio_path' in input) return dirname(input.output_path || input.audio_path);
  throw new Error('Unsupported Storybound sidecar input.');
}

function executePython(command: string, args: string[], options: BoundedProcessOptions): Promise<BoundedProcessResult> {
  return runBoundedProcess(command, args, options);
}

function safeSidecarExecutionError(error: unknown): Error & NodeJS.ErrnoException {
  const message = error instanceof Error ? error.message : String(error);
  const safeError = new Error(safeProcessDetail(message) || 'Storybound-compatible sidecar process failed.') as Error & NodeJS.ErrnoException;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    safeError.code = error.code;
  }
  return safeError;
}

function safeProcessDetail(value: unknown): string {
  const redacted = redactProcessOutput(value).trim();
  return redacted.length > 64 * 1024 ? redacted.slice(-(64 * 1024)) : redacted;
}

const pythonSidecarScript = String.raw`import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
import wave


SIDECAR_SUBPROCESS_TIMEOUT_SECONDS = 15 * 60
SIDECAR_SUBPROCESS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
storybound_scratch_token = ""


def scratch_prefix(prefix):
    return f"{prefix}{storybound_scratch_token}-" if storybound_scratch_token else prefix


def norm(path):
    return os.path.abspath(os.path.expanduser(str(path or "")))


def ensure_parent(path):
    parent = os.path.dirname(norm(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


def safe_unlink(path):
    path = norm(path)
    try:
        if path and os.path.exists(path):
            os.unlink(path)
    except FileNotFoundError:
        pass


def terminate_process_tree(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
        return
    try:
        process.terminate()
    except ProcessLookupError:
        return
    except Exception:
        pass
    time.sleep(0.3)
    if process.poll() is None:
        try:
            process.kill()
        except Exception:
            pass


def _read_bounded_pipe(pipe, max_bytes, chunks, overflow):
    total = 0
    try:
        while True:
            chunk = pipe.read(65536)
            if not chunk:
                return
            remaining = max(0, max_bytes - total)
            if remaining:
                chunks.append(chunk[:remaining])
            total += len(chunk)
            if total > max_bytes:
                overflow.set()
                return
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def run_bounded_subprocess(
    command,
    timeout_seconds=SIDECAR_SUBPROCESS_TIMEOUT_SECONDS,
    max_stdout_bytes=SIDECAR_SUBPROCESS_MAX_OUTPUT_BYTES,
    max_stderr_bytes=SIDECAR_SUBPROCESS_MAX_OUTPUT_BYTES,
    cwd=None,
):
    popen_options = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "cwd": cwd,
    }
    if os.name == "nt":
        popen_options["creationflags"] = (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    process = subprocess.Popen([str(item) for item in command], **popen_options)
    stdout_chunks = []
    stderr_chunks = []
    stdout_overflow = threading.Event()
    stderr_overflow = threading.Event()
    stdout_thread = threading.Thread(
        target=_read_bounded_pipe,
        args=(process.stdout, int(max_stdout_bytes), stdout_chunks, stdout_overflow),
        daemon=True,
    )
    stderr_thread = threading.Thread(
        target=_read_bounded_pipe,
        args=(process.stderr, int(max_stderr_bytes), stderr_chunks, stderr_overflow),
        daemon=True,
    )
    stdout_thread.start()
    stderr_thread.start()
    deadline = time.monotonic() + max(1.0, float(timeout_seconds))
    failure = ""
    while process.poll() is None:
        if stdout_overflow.is_set() or stderr_overflow.is_set():
            failure = "media process output exceeded its byte limit"
            break
        if time.monotonic() >= deadline:
            failure = "media process timed out"
            break
        time.sleep(0.05)
    if failure:
        terminate_process_tree(process)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        terminate_process_tree(process)
        process.kill()
        process.wait(timeout=5)
    stdout_thread.join(timeout=5)
    stderr_thread.join(timeout=5)
    stdout = b"".join(stdout_chunks).decode("utf-8", errors="replace")
    stderr = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    if not failure and (stdout_overflow.is_set() or stderr_overflow.is_set()):
        failure = "media process output exceeded its byte limit"
    if failure:
        detail = (stderr or stdout)[-2000:].strip()
        raise RuntimeError(f"{failure}: {detail}" if detail else failure)
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def safe_filename(value, fallback="draft"):
    text = str(value or fallback).strip()
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return (text or fallback)[:80]


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ModuleNotFoundError:
        binary = shutil.which("ffmpeg")
        if binary:
            return binary
        raise


def ffmpeg_timeout_seconds(args):
    # Long recursive compositions can legitimately exceed the fixed probe
    # budget. Keep short jobs bounded while giving authored long outputs a
    # duration-based budget instead of killing a valid encode mid-stage.
    duration = 0.0
    for index, value in enumerate(args[:-1]):
        if value == "-t":
            try:
                duration = max(duration, float(args[index + 1]))
            except (TypeError, ValueError):
                pass
    if duration <= 0:
        return SIDECAR_SUBPROCESS_TIMEOUT_SECONDS
    return max(SIDECAR_SUBPROCESS_TIMEOUT_SECONDS, min(2 * 60 * 60, duration * 0.5 + 300))


def run_ffmpeg(args, cwd=None):
    output_path = norm(args[-1]) if args and not str(args[-1]).startswith("-") else ""
    try:
        bounded_options = {"cwd": cwd}
        timeout_seconds = ffmpeg_timeout_seconds(args)
        if timeout_seconds != SIDECAR_SUBPROCESS_TIMEOUT_SECONDS:
            bounded_options["timeout_seconds"] = timeout_seconds
        completed = run_bounded_subprocess([ffmpeg_exe(), "-y", *args], **bounded_options)
    except Exception:
        if output_path:
            safe_unlink(output_path)
        raise
    if completed.returncode != 0:
        if output_path:
            safe_unlink(output_path)
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "ffmpeg failed")


def ffprobe_exe():
    binary = shutil.which("ffprobe")
    if binary:
        return binary
    ffmpeg_path = ffmpeg_exe()
    root = os.path.dirname(ffmpeg_path)
    names = ["ffprobe.exe", "ffprobe"] if os.name == "nt" else ["ffprobe"]
    for name in names:
        candidate = os.path.join(root, name)
        if os.path.isfile(candidate):
            return candidate
    return ""


def media_duration_s(path):
    path = norm(path)
    probe = ffprobe_exe()
    if probe:
        completed = run_bounded_subprocess(
            [probe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
            timeout_seconds=60,
            max_stdout_bytes=2 * 1024 * 1024,
            max_stderr_bytes=2 * 1024 * 1024,
        )
        if completed.returncode == 0:
            try:
                return max(0.0, float(completed.stdout.strip()))
            except ValueError:
                pass
    completed = run_bounded_subprocess(
        [ffmpeg_exe(), "-i", path],
        timeout_seconds=60,
        max_stdout_bytes=2 * 1024 * 1024,
        max_stderr_bytes=2 * 1024 * 1024,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", completed.stderr)
    if not match:
        return 0.0
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def media_stream_info(path):
    path = norm(path)
    probe = ffprobe_exe()
    if probe:
        completed = run_bounded_subprocess(
            [probe, "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", path],
            timeout_seconds=60,
            max_stdout_bytes=2 * 1024 * 1024,
            max_stderr_bytes=2 * 1024 * 1024,
        )
        if completed.returncode == 0:
            try:
                streams = json.loads(completed.stdout).get("streams") or []
                video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
                return {
                    "has_video": video_stream is not None,
                    "has_audio": any(item.get("codec_type") == "audio" for item in streams),
                    "width": int((video_stream or {}).get("width") or 0),
                    "height": int((video_stream or {}).get("height") or 0),
                    "video_codec": str((video_stream or {}).get("codec_name") or ""),
                }
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
    completed = run_bounded_subprocess(
        [ffmpeg_exe(), "-hide_banner", "-i", path],
        timeout_seconds=60,
        max_stdout_bytes=2 * 1024 * 1024,
        max_stderr_bytes=2 * 1024 * 1024,
    )
    detail = completed.stderr
    video_line = next((line for line in detail.splitlines() if re.search(r"Stream #.*Video:", line, re.IGNORECASE)), "")
    dimensions = next(
        (
            (int(match.group(1)), int(match.group(2)))
            for match in re.finditer(r"(\d{1,6})x(\d{1,6})", video_line)
            if int(match.group(1)) > 0 and 0 < int(match.group(2)) <= 100000
        ),
        (0, 0),
    )
    return {
        "has_video": bool(video_line),
        "has_audio": bool(re.search(r"Stream #.*Audio:", detail, re.IGNORECASE)),
        "width": dimensions[0],
        "height": dimensions[1],
        "video_codec": "",
    }


def media_has_nonblack_video(path, duration):
    sample_rate = max(0.1, min(2.0, 5.0 / max(0.1, float(duration or 0))))
    completed = run_bounded_subprocess(
        [
            ffmpeg_exe(),
            "-hide_banner",
            "-v", "info",
            "-i", norm(path),
            "-vf", f"fps={sample_rate:.6f},signalstats,metadata=print:key=lavfi.signalstats.YMAX",
            "-frames:v", "8",
            "-an",
            "-f", "null",
            os.devnull,
        ],
        timeout_seconds=120,
        max_stdout_bytes=2 * 1024 * 1024,
        max_stderr_bytes=4 * 1024 * 1024,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "video luminance probe failed")
    values = [float(value) for value in re.findall(r"lavfi\.signalstats\.YMAX=([0-9]+(?:\.[0-9]+)?)", completed.stdout + "\n" + completed.stderr)]
    return any(value > 24.0 for value in values)


def visual_continuity_metrics(path, duration, points_ms, fps):
    evidence = {"version": 2, "fps": fps, "status": "failed", "cuts": []}
    script_path = ""
    try:
        if not isinstance(fps, (int, float)) or isinstance(fps, bool) or not math.isfinite(fps) or not 0 < fps <= 120:
            raise ValueError("切点采样帧率无效")
        if not isinstance(points_ms, list) or len(points_ms) > 499:
            raise ValueError("切点数量超出 499 个")
        if any(isinstance(point, bool) or not isinstance(point, (int, float)) or not math.isfinite(point) or not 0 < point < duration * 1000 for point in points_ms):
            raise ValueError("切点时间无效")
        if points_ms != sorted(set(points_ms)):
            raise ValueError("切点必须按时间排序且不重复")
        indices_by_cut = [[math.ceil(point * fps / 1000 - 1e-7) + offset for offset in (-2, -1, 0, 1)] for point in points_ms]
        indices = sorted(set(index for group in indices_by_cut for index in group))
        if indices and (indices[0] < 0 or indices[-1] / fps >= duration):
            raise ValueError("切点四帧采样范围超出成片")
        if not indices:
            return {**evidence, "status": "ok"}
        # Select in one decode pass; the filter file avoids Windows command limits.
        expression = "+".join(f"eq(n,{index})" for index in indices)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".filter", prefix=scratch_prefix("visual-cuts-"), dir=os.path.dirname(os.path.abspath(path)), delete=False) as script:
            script_path = script.name
            # Run signalstats before select so YDIF compares each sampled
            # frame with its actual predecessor in the encoded stream.
            script.write(f"signalstats,blackframe=amount=0:threshold=32,select='{expression}',format=yuv420p,metadata=print")
        completed = run_bounded_subprocess(
            [ffmpeg_exe(), "-hide_banner", "-nostats", "-v", "info", "-i", norm(path), "-map", "0:v:0", "-filter_script:v", script_path,
             "-frames:v", str(len(indices)), "-an", "-fps_mode", "vfr", "-f", "null", os.devnull],
            timeout_seconds=min(600, max(120, math.ceil(duration * 1.5))),
            max_stdout_bytes=2 * 1024 * 1024, max_stderr_bytes=8 * 1024 * 1024,
        )
        if completed.returncode != 0:
            raise RuntimeError("切点帧解码失败")
        detail = completed.stdout + "\n" + completed.stderr
        blocks = list(re.finditer(r"frame:\s*\d+\s+pts:\s*\S+\s+pts_time:\s*(\S+)(.*?)(?=frame:\s*\d+\s+pts:|\Z)", detail, re.DOTALL))
        if len(blocks) != len(indices):
            raise ValueError("切点帧解码数量不完整")
        frames = {}
        for index, block in zip(indices, blocks):
            time_ms = float(block.group(1)) * 1000
            if not math.isfinite(time_ms) or abs(time_ms - index * 1000 / fps) > 1:
                raise ValueError("切点实际帧时间与采样帧率不一致")
            values = {}
            for key, name in [("signalstats.YAVG", "lumaMean"), ("signalstats.YMIN", "lumaMin"), ("signalstats.YMAX", "lumaMax"), ("blackframe.pblack", "blackPercent")]:
                match = re.search(r"lavfi\." + re.escape(key) + r"=([^\s]+)", block.group(2))
                if not match:
                    raise ValueError(f"切点帧缺少 {key} 指标")
                value = float(match.group(1))
                if not math.isfinite(value) or not 0 <= value <= (100 if name == "blackPercent" else 255):
                    raise ValueError("切点帧指标无效")
                values[name] = value
            # YDIF is meaningful only for consecutive source indices. The
            # first sample before a cut intentionally has no predecessor in
            # the four-frame window and remains a manual-review boundary.
            if index > 0:
                match = re.search(r"lavfi\.signalstats\.YDIF=([^\s]+)", block.group(2))
                if not match:
                    raise ValueError("切点帧缺少 signalstats.YDIF 指标")
                delta = float(match.group(1))
                if not math.isfinite(delta) or not 0 <= delta <= 255:
                    raise ValueError("切点帧差指标无效")
                values["lumaMeanAbsoluteDelta"] = delta
            frames[index] = {"index": index, "timeMs": time_ms, **values}
        evidence["cuts"] = [{"atMs": point, "frames": [frames[index] for index in group]} for point, group in zip(points_ms, indices_by_cut)]
        evidence["status"] = "ok"
    except Exception as error:
        evidence["error"] = str(error)[:2000]
    finally:
        if script_path:
            safe_unlink(script_path)
    return evidence


def media_quality_metrics(path, stream_info, duration):
    metrics = {}
    if stream_info.get("has_audio"):
        try:
            completed = run_bounded_subprocess(
                [ffmpeg_exe(), "-hide_banner", "-i", norm(path), "-map", "0:a:0", "-vn", "-af", "ebur128=framelog=verbose:peak=true,volumedetect", "-f", "null", os.devnull],
                timeout_seconds=120,
                max_stdout_bytes=2 * 1024 * 1024,
                max_stderr_bytes=4 * 1024 * 1024,
            )
            detail = completed.stdout + "\n" + completed.stderr
            peak = re.search(r"max_volume:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*dB", detail)
            mean = re.search(r"mean_volume:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*dB", detail)
            if completed.returncode != 0 or not peak or not mean:
                metrics["audio_quality_status"] = "failed"
                metrics["audio_quality_error"] = (completed.stderr.strip() or completed.stdout.strip() or "volumedetect 未返回完整响度指标")[-2000:]
            else:
                metrics["audio_peak_db"] = float(peak.group(1))
                metrics["audio_mean_volume_db"] = float(mean.group(1))
                integrated = re.findall(r"\bI:\s*(-?(?:[0-9]+(?:\.[0-9]+)?))\s+LUFS", detail)
                true_peak = re.findall(r"\bPeak:\s*((?:-?(?:[0-9]+(?:\.[0-9]+)?)|-?inf))\s+dBFS", detail, re.IGNORECASE)
                if not integrated or not true_peak:
                    raise ValueError("ebur128 未返回完整 LUFS/真峰值指标")
                silent = true_peak[-1].lower() == "-inf"
                metrics["audio_is_silent"] = silent
                if not silent:
                    metrics["audio_lufs"] = float(integrated[-1])
                    metrics["audio_true_peak_db"] = float(true_peak[-1])
                    if not math.isfinite(metrics["audio_lufs"]) or not math.isfinite(metrics["audio_true_peak_db"]):
                        raise ValueError("ebur128 响度指标无效")
                metrics["audio_quality_status"] = "ok"
        except Exception as error:
            metrics["audio_quality_status"] = "failed"
            metrics["audio_quality_error"] = str(error)[-2000:]
    else:
        metrics["audio_quality_status"] = "unavailable"
        metrics["audio_quality_error"] = "媒体没有音频流"
    if stream_info.get("has_video"):
        try:
            completed = run_bounded_subprocess(
                [ffmpeg_exe(), "-hide_banner", "-v", "info", "-i", norm(path), "-map", "0:v:0", "-vf", "blackdetect=d=0.12:pix_th=0.10", "-an", "-f", "null", os.devnull],
                timeout_seconds=120,
                max_stdout_bytes=2 * 1024 * 1024,
                max_stderr_bytes=4 * 1024 * 1024,
            )
            if completed.returncode != 0:
                metrics["black_detection_status"] = "failed"
                metrics["black_detection_error"] = (completed.stderr.strip() or completed.stdout.strip() or "blackdetect 执行失败")[-2000:]
            else:
                intervals = []
                detail = completed.stdout + "\n" + completed.stderr
                matches = list(re.finditer(r"black_start:(\S+)\s+black_end:(\S+)", detail))
                if len(matches) != len(re.findall(r"\bblack_start:", detail)):
                    raise ValueError("blackdetect 区间输出不完整")
                for match in matches:
                    if not math.isfinite(float(match.group(1))) or not math.isfinite(float(match.group(2))):
                        raise ValueError("blackdetect 区间数值无效")
                    start = float(match.group(1))
                    end = min(float(duration), float(match.group(2)))
                    if start < 0 or end <= start:
                        raise ValueError("blackdetect 区间范围无效")
                    intervals.append({"start_ms": round(start * 1000), "end_ms": round(end * 1000)})
                metrics["black_intervals"] = intervals[:64]
                metrics["black_detection_status"] = "ok"
                if len(intervals) > 64:
                    metrics["black_detection_status"] = "failed"
                    metrics["black_detection_error"] = "黑帧区间超过 64 段，报告未包含全部区间"
        except Exception as error:
            metrics["black_detection_status"] = "failed"
            metrics["black_detection_error"] = str(error)[-2000:]
    else:
        metrics["black_detection_status"] = "unavailable"
        metrics["black_detection_error"] = "媒体没有视频流"
    return metrics


def wav_to_16k_mono(source_path, output_path):
    with wave.open(norm(source_path), "rb") as reader:
        channels = reader.getnchannels()
        sample_width = reader.getsampwidth()
        source_rate = reader.getframerate()
        raw = reader.readframes(reader.getnframes())
    if sample_width != 2:
        raise ValueError("WAV fallback only supports 16-bit PCM audio")
    samples = list(struct.unpack("<" + "h" * (len(raw) // 2), raw))
    if channels > 1:
        samples = [
            int(sum(samples[index:index + channels]) / channels)
            for index in range(0, len(samples), channels)
        ]
    target_rate = 16000
    if source_rate > 0 and source_rate != target_rate and samples:
        ratio = target_rate / float(source_rate)
        samples = [samples[min(len(samples) - 1, int(index / ratio))] for index in range(max(1, int(len(samples) * ratio)))]
    ensure_parent(output_path)
    with wave.open(norm(output_path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(target_rate)
        writer.writeframes(struct.pack("<" + "h" * len(samples), *samples))


def copy_if_exists(source, target_dir, stem):
    source = norm(source)
    if not source or not os.path.isfile(source):
        return ""
    os.makedirs(target_dir, exist_ok=True)
    _, ext = os.path.splitext(source)
    target = os.path.join(target_dir, f"{stem}{ext or '.bin'}")
    shutil.copy2(source, target)
    return target


def total_scene_duration_us(scenes, default_us=2400000):
    total = 0
    for item in scenes or []:
        total += int(item.get("duration_us") or item.get("durationUs") or default_us)
    return max(total, default_us if scenes else 0)


def cover_title_text(payload):
    cover = payload.get("cover_title") or {}
    if isinstance(cover, dict):
        return str(cover.get("title") or payload.get("task_title") or "StoryDream Draft")
    return str(cover or payload.get("task_title") or "StoryDream Draft")


def create_minimal_draft(root, title, content, meta_extra=None):
    draft_id = f"{safe_filename(title, 'storydream-draft')}-{time.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    draft_dir = os.path.join(norm(root), draft_id)
    os.makedirs(draft_dir, exist_ok=True)
    content_path = os.path.join(draft_dir, "draft_content.json")
    meta_path = os.path.join(draft_dir, "draft_meta_info.json")
    duration = int(content.get("duration") or content.get("duration_us") or 0)
    with open(content_path, "w", encoding="utf-8") as handle:
        json.dump(content, handle, ensure_ascii=False, indent=2)
    meta = {
        "draft_id": draft_id,
        "draft_name": title,
        "draft_fold_path": draft_dir,
        "draft_root_path": norm(root),
        "tm_duration": duration,
    }
    if meta_extra:
        meta.update(meta_extra)
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    return {"success": True, "draft_dir": draft_dir, "draft_id": draft_id}


def generate_story(payload):
    # Optional imports document the recovered dependency surface without making convert/remix modes depend on them.
    try:
        import pyJianYingDraft  # noqa: F401
    except Exception:
        pyJianYingDraft = None
    assets = payload.get("assets") or {}
    template = payload.get("template") or {}
    canvas = template.get("canvas") if isinstance(template, dict) else {}
    scenes = assets.get("scenes") or []
    cover_page = payload.get("cover_page") or {}
    cover_duration = max(0, int(cover_page.get("duration_us") or 0))
    if not scenes:
        images = assets.get("images") or []
        scenes = [
            {
                "scene_id": int(item.get("scene_id") or index + 1),
                "start_us": index * 2400000,
                "duration_us": 2400000,
                "text": "",
            }
            for index, item in enumerate(images)
        ]
    image_by_scene = {int(item.get("scene_id") or 0): item for item in (assets.get("images") or [])}
    video_by_scene = {int(item.get("scene_id") or 0): item for item in (assets.get("videos") or [])}
    scene_visuals = []
    for scene in scenes:
        scene_id = int(scene.get("scene_id") or 0)
        video = video_by_scene.get(scene_id)
        image = image_by_scene.get(scene_id)
        visual = video or image
        if not visual:
            continue
        scene_visuals.append({
            "scene_id": scene_id,
            "path": visual.get("path"),
            "start_us": int(scene.get("start_us") or 0),
            "duration_us": int(scene.get("duration_us") or 0),
            "source_start_us": int(video.get("trim_start_ms") or 0) * 1000 if video else 0,
            "media_type": "video" if video else "image",
            "muted": bool(video) if video else True,
            "fit": (video or {}).get("fit") or "cover",
        })
    duration = cover_duration + total_scene_duration_us(scenes)
    cover_video = []
    cover_text = []
    if cover_duration > 0 and cover_page.get("image_path"):
        cover_video.append({
            "scene_id": 0,
            "path": cover_page.get("image_path"),
            "start_us": 0,
            "duration_us": cover_duration,
            "role": "cover_page",
        })
        if str(cover_page.get("text") or "").strip():
            cover_text.append({
                "scene_id": 0,
                "text": str(cover_page.get("text") or "").strip(),
                "start_us": 0,
                "duration_us": cover_duration,
                "role": "cover_page_title",
            })
    title = str(payload.get("task_title") or cover_title_text(payload))
    content = {
        "duration": duration,
        "canvas_config": {
            "width": int((canvas or {}).get("width") or 1080),
            "height": int((canvas or {}).get("height") or 1920),
            "ratio": (canvas or {}).get("ratio") or "original",
        },
        "materials": {
            "videos": cover_video + scene_visuals,
            "audios": assets.get("narration") or [],
            "texts": cover_text + scenes,
            "bgm": payload.get("bgm_path") or "",
            "subtitles": assets.get("subtitles_path") or "",
        },
        "tracks": [
            {"type": "video", "segments": cover_video + scene_visuals},
            {"type": "audio", "segments": assets.get("narration") or []},
            {"type": "text", "segments": cover_text + scenes},
        ],
        "storybound_contract": payload,
    }
    return create_minimal_draft(payload["jianying_draft_path"], title, content, {"draft_cover": cover_page.get("image_path") or payload.get("cover_image_path") or ""})


def generate_music_mv(payload):
    try:
        import jieba  # noqa: F401
    except Exception:
        jieba = None
    assignments = payload.get("assignments") or []
    lyrics = payload.get("lyrics") or []
    music_caption_style = str(payload.get("caption_style") or "karaoke")
    music_canvas = payload.get("canvas") or {"ratio": payload.get("ratio") or "original"}
    duration = int(float(payload.get("audio_duration") or 0) * 1000000)
    if duration <= 0:
        duration = total_scene_duration_us(lyrics)
    title = str(payload.get("task_title") or cover_title_text(payload) or "StoryDream Music MV")
    music_tracks = [
        {"type": "video", "segments": assignments},
        {"type": "audio", "segments": [{"path": payload.get("audio_path") or "", "duration": duration, "role": "song"}]},
    ]
    if music_caption_style != "none":
        music_tracks.append({"type": "text", "style": music_caption_style, "segments": lyrics})
    if payload.get("bgm_path") and payload.get("bgm_path") != payload.get("audio_path"):
        music_tracks.append({"type": "bgm", "segments": [{"path": payload.get("bgm_path"), "duration": duration}]})
    content = {
        "duration": duration,
        "canvas": music_canvas,
        "caption_style": music_caption_style,
        "materials": {
            "videos": assignments,
            "audios": [{"path": payload.get("audio_path") or "", "source": "music_mv"}],
            "texts": lyrics,
            "bgm": payload.get("bgm_path") or "",
        },
        "tracks": music_tracks,
        "storybound_contract": payload,
    }
    return create_minimal_draft(payload["jianying_draft_path"], title, content, {"draft_cover": payload.get("cover_image_path") or ""})


def convert_audio_16k(payload):
    output_path = norm(payload["output_path"])
    ensure_parent(output_path)
    audio_path = norm(payload["audio_path"])
    try:
        run_ffmpeg(["-i", audio_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output_path])
    except Exception:
        if os.path.splitext(audio_path)[1].lower() != ".wav":
            raise
        wav_to_16k_mono(audio_path, output_path)
    return {"success": True, "output_path": output_path}


def probe_media(payload):
    media_path = norm(payload["media_path"])
    if not os.path.isfile(media_path):
        raise ValueError("Media file does not exist")
    duration = media_duration_s(media_path)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Media duration is unavailable")
    result = {"success": True, "duration": duration}
    stream_info = media_stream_info(media_path)
    result.update(stream_info)
    if payload.get("analyze_quality"):
        result.update(media_quality_metrics(media_path, stream_info, duration))
    if "visual_continuity_points_ms" in payload:
        fps = payload.get("visual_continuity_fps", 24)
        result["visual_continuity"] = visual_continuity_metrics(media_path, duration, payload["visual_continuity_points_ms"], fps) if stream_info.get("has_video") else {
            "version": 1, "fps": fps, "status": "unavailable", "error": "媒体没有视频流", "cuts": []}
    if payload.get("require_nonblack") and result.get("has_video"):
        result["has_nonblack_video"] = media_has_nonblack_video(media_path, duration)
    return result


def normalize_scene_video(payload):
    source_path = norm(payload["video_path"])
    output_path = norm(payload["output_path"])
    if not os.path.isfile(source_path):
        raise ValueError("Video file does not exist")
    ensure_parent(output_path)
    run_ffmpeg([
        "-i", source_path,
        "-map", "0:v:0",
        "-an",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ])
    result = probe_media({
        "media_path": output_path,
        "require_nonblack": bool(payload.get("require_nonblack")),
    })
    result["output_path"] = output_path
    return result


def probe_glyphs(payload):
    """Read the selected Windows font cmap instead of counting .notdef boxes."""
    entries = payload.get("entries") or []
    if os.name != "nt":
        return {"success": True, "glyph_results": [{
            "status": "unavailable", "supported_code_points": [],
            "missing_code_points": [], "font_families": list(entry.get("font_families") or []),
        } for entry in entries]}
    try:
        import struct
        import winreg

        def read_cmap(path, requested_code_points):
            with open(path, "rb") as font_file:
                data = font_file.read()
            offsets = [0]
            if data[:4] == b"ttcf":
                count = struct.unpack_from(">I", data, 8)[0]
                offsets = [struct.unpack_from(">I", data, 12 + index * 4)[0] for index in range(count)]
            code_point_set = set()
            for base in offsets:
                if base + 12 > len(data):
                    continue
                table_count = struct.unpack_from(">H", data, base + 4)[0]
                cmap_offset = None
                for index in range(table_count):
                    record = base + 12 + index * 16
                    if data[record:record + 4] == b"cmap":
                        cmap_offset = base + struct.unpack_from(">I", data, record + 8)[0]
                        break
                if cmap_offset is None or cmap_offset + 4 > len(data):
                    continue
                subtable_count = struct.unpack_from(">H", data, cmap_offset + 2)[0]
                for index in range(subtable_count):
                    record = cmap_offset + 4 + index * 8
                    if record + 8 > len(data):
                        continue
                    sub_offset = cmap_offset + struct.unpack_from(">I", data, record + 4)[0]
                    if sub_offset + 2 > len(data):
                        continue
                    format_id = struct.unpack_from(">H", data, sub_offset)[0]
                    if format_id == 12 and sub_offset + 16 <= len(data):
                        groups = struct.unpack_from(">I", data, sub_offset + 12)[0]
                        for group in range(groups):
                            start, end = struct.unpack_from(">II", data, sub_offset + 16 + group * 12)
                            for code_point in requested_code_points:
                                if start <= code_point <= end:
                                    code_point_set.add(code_point)
                    elif format_id == 4 and sub_offset + 16 <= len(data):
                        segments = struct.unpack_from(">H", data, sub_offset + 6)[0] // 2
                        end_base = sub_offset + 14
                        start_base = end_base + segments * 2 + 2
                        delta_base = start_base + segments * 2
                        range_base = delta_base + segments * 2
                        for segment in range(segments):
                            end = struct.unpack_from(">H", data, end_base + segment * 2)[0]
                            start = struct.unpack_from(">H", data, start_base + segment * 2)[0]
                            delta = struct.unpack_from(">h", data, delta_base + segment * 2)[0]
                            range_offset = struct.unpack_from(">H", data, range_base + segment * 2)[0]
                            for code_point in requested_code_points:
                                if not start <= code_point <= end:
                                    continue
                                if range_offset == 0:
                                    glyph = (code_point + delta) & 0xffff
                                else:
                                    glyph_offset = range_base + segment * 2 + range_offset + 2 * (code_point - start)
                                    glyph = struct.unpack_from(">H", data, glyph_offset)[0] if glyph_offset + 2 <= len(data) else 0
                                    glyph = (glyph + delta) & 0xffff if glyph else 0
                                if glyph:
                                    code_point_set.add(code_point)
            return code_point_set

        def family_files(family):
            matches = []
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts") as key:
                for index in range(winreg.QueryInfoKey(key)[1]):
                    name, value, _ = winreg.EnumValue(key, index)
                    if family.casefold() not in name.casefold():
                        continue
                    path = str(value)
                    if not os.path.isabs(path):
                        path = os.path.join(os.environ.get("WINDIR", r"C:\\Windows"), "Fonts", path)
                    if os.path.isfile(path) and path not in matches:
                        matches.append(path)
            return matches

        cmap_cache = {}
        results = []
        for entry in entries:
            families = [str(family) for family in (entry.get("font_families") or []) if str(family)]
            code_points = [int(code_point) for code_point in (entry.get("code_points") or [])
                           if 0 <= int(code_point) <= 0x10ffff]
            available_points = set()
            for family in families:
                for path in family_files(family):
                    cache_key = (path, tuple(code_points))
                    if cache_key not in cmap_cache:
                        cmap_cache[cache_key] = read_cmap(path, code_points)
                    available_points.update(cmap_cache[cache_key])
            supported = [code_point for code_point in code_points if code_point in available_points]
            missing = [code_point for code_point in code_points if code_point not in available_points]
            results.append({"status": "ok" if families and not missing else "failed" if families else "unavailable",
                            "supported_code_points": supported,
                            "missing_code_points": missing,
                            "font_families": families})
        return {"success": True, "glyph_results": results}
    except Exception as error:
        return {"success": True, "glyph_results": [{
            "status": "unavailable", "supported_code_points": [],
            "missing_code_points": [], "font_families": list(entry.get("font_families") or []),
        } for entry in entries], "error": str(error)[:2000]}


def generate_remix_bgm(payload):
    source_path = norm(payload["source_path"])
    output_path = norm(payload["output_path"])
    ensure_parent(output_path)
    bgm_path = norm(payload.get("bgm_path") or "")
    if not bgm_path or not os.path.isfile(bgm_path):
        shutil.copy2(source_path, output_path)
        return {"success": True, "output_path": output_path, "source_path": source_path}
    bgm_volume = math.pow(10, float(payload.get("bgm_target_db", -18)) / 20.0)
    filter_complex = f"[1:a]volume={bgm_volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    run_ffmpeg([
        "-i", source_path,
        "-stream_loop", "-1",
        "-i", bgm_path,
        "-filter_complex", filter_complex,
        "-map", "0:v?",
        "-map", "[aout]",
        "-c:v", "copy",
        "-shortest",
        output_path,
    ])
    return {"success": True, "output_path": output_path, "source_path": source_path}


def transition_options(value):
    transition_type = "fade"
    transition_duration = 0.3
    if isinstance(value, dict):
        transition_type = str(value.get("type") or transition_type)
        transition_duration = float(value.get("duration") or transition_duration)
    elif isinstance(value, str) and value:
        transition_type = value
    transition_type = re.sub(r"[^A-Za-z0-9_]", "", transition_type) or "fade"
    return transition_type, max(0.01, transition_duration)


def run_composition_ffmpeg(args):
    # Keep large scene graphs and repeated absolute paths off Windows' command line.
    paths = [os.path.abspath(args[index + 1]) for index, value in enumerate(args[:-1]) if value == "-i"]
    try:
        cwd = os.path.commonpath([os.path.dirname(path) for path in paths])
    except ValueError:
        cwd = None
    rewritten = list(args)
    for index, value in enumerate(args[:-1]):
        if value == "-i" and cwd:
            rewritten[index + 1] = os.path.relpath(os.path.abspath(args[index + 1]), cwd)
    rewritten[-1] = os.path.abspath(args[-1])
    if len(paths) > 8:
        bounded_inputs = []
        for value in rewritten:
            if value == "-i":
                bounded_inputs.extend(["-threads", "1"])
            bounded_inputs.append(value)
        rewritten = bounded_inputs
    filter_index = rewritten.index("-filter_complex")
    script_path = ""
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=scratch_prefix("storybound-"), suffix=".filter", dir=os.path.dirname(rewritten[-1]), delete=False) as script:
            script_path = script.name
            script.write(rewritten[filter_index + 1])
        rewritten[filter_index:filter_index + 2] = ["-filter_complex_script", script_path]
        run_ffmpeg(rewritten, cwd=cwd)
    finally:
        safe_unlink(script_path)


def _bound_xfade_duration(durations, transition_duration):
    known_limits = [duration / 2.0 for duration in durations if duration > 0]
    if known_limits:
        return min(float(transition_duration), max(0.01, min(known_limits)))
    return float(transition_duration)


def _compose_xfade_batch(segment_paths, output_path, transition_type, transition_duration, durations=None):
    if len(segment_paths) < 2:
        shutil.copy2(segment_paths[0], output_path)
        return
    durations = durations or [media_duration_s(path) for path in segment_paths]
    inputs = []
    filters = []
    for index, path in enumerate(segment_paths):
        inputs.extend(["-i", path])
        filters.append(f"[{index}:v]settb=AVTB,setsar=1[v{index}]")
        # Trim AAC padding to the scene clock and bound frames entering acrossfade.
        filters.append(f"[{index}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration={durations[index]},asetpts=PTS-STARTPTS,asetnsamples=n=1024:p=0[a{index}]")
    current_video = "[v0]"
    current_audio = "[a0]"
    elapsed = durations[0] if durations and durations[0] > 0 else transition_duration
    for index in range(1, len(segment_paths)):
        offset = max(0.0, elapsed - transition_duration)
        next_video = f"[vx{index}]"
        next_audio = f"[ax{index}]"
        filters.append(
            f"{current_video}[v{index}]xfade=transition={transition_type}:duration={transition_duration}:offset={offset}{next_video}"
        )
        filters.append(f"{current_audio}[a{index}]acrossfade=d={transition_duration}:c1=tri:c2=tri{next_audio}")
        current_video = next_video
        current_audio = next_audio
        scene_duration = durations[index] if index < len(durations) and durations[index] > 0 else transition_duration
        elapsed = max(transition_duration, elapsed + scene_duration - transition_duration)
    run_composition_ffmpeg([
        *inputs,
        "-filter_complex",
        ";".join(filters),
        "-map",
        current_video,
        "-map",
        current_audio,
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-t",
        str(elapsed),
        output_path,
    ])


def _compose_xfade_recursive(segment_paths, output_path, transition_type, transition_duration, durations=None):
    if len(segment_paths) <= 8:
        _compose_xfade_batch(segment_paths, output_path, transition_type, transition_duration, durations)
        return
    with tempfile.TemporaryDirectory(
        prefix=scratch_prefix("compose-xfade-groups-"),
        dir=os.path.dirname(os.path.abspath(output_path)),
    ) as directory:
        grouped_paths = []
        grouped_durations = []
        for start in range(0, len(segment_paths), 8):
            group_path = os.path.join(directory, f"group-{start // 8}.mp4")
            group_segments = segment_paths[start:start + 8]
            group_durations = durations[start:start + 8] if durations else None
            _compose_xfade_recursive(
                group_segments,
                group_path,
                transition_type,
                transition_duration,
                group_durations,
            )
            grouped_paths.append(group_path)
            authored_group_durations = group_durations or [media_duration_s(path) for path in group_segments]
            # Keep the authored scene clock across recursive levels. Probing
            # encoded group containers accumulates AAC/timebase padding and
            # makes the final duration drift from the source timeline.
            grouped_durations.append(
                max(
                    transition_duration,
                    sum(authored_group_durations) - transition_duration * max(0, len(group_segments) - 1),
                )
            )
        _compose_xfade_recursive(
            grouped_paths,
            output_path,
            transition_type,
            transition_duration,
            grouped_durations,
        )


def _compose_with_xfade(segment_paths, output_path, transition_type="fade", transition_duration=0.3, durations=None):
    if len(segment_paths) < 2:
        shutil.copy2(segment_paths[0], output_path)
        return
    durations = durations or [media_duration_s(path) for path in segment_paths]
    transition_duration = _bound_xfade_duration(durations, transition_duration)
    _compose_xfade_recursive(segment_paths, output_path, transition_type, transition_duration, durations)


def hard_cut_filter_graph(segment_paths, durations):
    inputs = []
    filters = []
    video_inputs = []
    audio_inputs = []
    for index, path in enumerate(segment_paths):
        inputs.extend(["-i", path])
        duration = durations[index]
        filters.append(f"[{index}:v]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={duration},trim=duration={duration},settb=AVTB,setsar=1[v{index}]")
        filters.append(f"[{index}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration={duration},asetpts=PTS-STARTPTS[a{index}]")
        video_inputs.append(f"[v{index}]")
        audio_inputs.append(f"[a{index}]")
    # Keep AAC padding and fractional video frames off the authored audio clock.
    filters.append("".join(video_inputs) + f"concat=n={len(segment_paths)}:v=1:a=0[vout]")
    filters.append("".join(audio_inputs) + f"concat=n={len(segment_paths)}:v=0:a=1[aout]")
    return inputs, filters


def _compose_hard_cut_groups(segment_paths, output_path, durations, fps):
    # Video-only chunks keep fractional frames off the independent audio clock.
    # Float PCM is encoded to AAC once, after all chunk samples are concatenated.
    with tempfile.TemporaryDirectory(prefix=scratch_prefix("compose-groups-"), dir=os.path.dirname(os.path.abspath(output_path))) as directory:
        video_entries = ["ffconcat version 1.0"]
        audio_entries = ["ffconcat version 1.0"]
        for start in range(0, len(segment_paths), 8):
            index = start // 8
            video_name, audio_name = f"video-{index}.mp4", f"audio-{index}.wav"
            inputs, filters = hard_cut_filter_graph(segment_paths[start:start + 8], durations[start:start + 8])
            bounded_inputs = []
            for value in inputs:
                if value == "-i":
                    bounded_inputs.extend(["-threads", "1"])
                bounded_inputs.append(value)
            duration_args = ["-t", str(sum(durations[start:start + 8]))] if float(fps) < 10 else []
            run_composition_ffmpeg([
                *bounded_inputs, "-filter_complex", ";".join(filters),
                "-map", "[vout]", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-r", str(fps), *duration_args, os.path.join(directory, video_name),
                "-map", "[aout]", "-vn", "-c:a", "pcm_f32le", os.path.join(directory, audio_name),
            ])
            video_entries.append(f"file {video_name}")
            audio_entries.append(f"file {audio_name}")
        video_list, audio_list = os.path.join(directory, "video.ffconcat"), os.path.join(directory, "audio.ffconcat")
        for path, entries in [(video_list, video_entries), (audio_list, audio_entries)]:
            with open(path, "w", encoding="utf-8") as target:
                target.write("\n".join(entries) + "\n")
        run_ffmpeg([
            "-f", "concat", "-safe", "0", "-i", video_list,
            "-f", "concat", "-safe", "0", "-i", audio_list,
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
            "-af", "asetpts=N/SR/TB", output_path,
        ])


def _compose_with_hard_cuts(segment_paths, output_path, durations, fps=24):
    if len(segment_paths) < 2:
        shutil.copy2(segment_paths[0], output_path)
        return
    if len(segment_paths) > 8:
        _compose_hard_cut_groups(segment_paths, output_path, durations, fps)
        return
    inputs, filters = hard_cut_filter_graph(segment_paths, durations)
    duration_args = ["-t", str(sum(durations))] if float(fps) < 10 else []
    run_composition_ffmpeg([
        *inputs,
        "-filter_complex",
        ";".join(filters),
        "-map", "[vout]",
        "-map", "[aout]",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-c:a", "aac",
        *duration_args,
        output_path,
    ])


def first_frame_pattern(frames_dir):
    frames_dir = norm(frames_dir)
    jpg_pattern = os.path.join(frames_dir, "frame_%04d.jpg")
    if os.path.exists(os.path.join(frames_dir, "frame_0001.jpg")):
        return jpg_pattern
    for pattern in ("%06d.png", "%05d.png", "%04d.png", "%03d.png", "%d.png"):
        probe = os.path.join(frames_dir, pattern.replace("%06d", "000001").replace("%05d", "00001").replace("%04d", "0001").replace("%03d", "001").replace("%d", "1"))
        if os.path.exists(probe):
            return os.path.join(frames_dir, pattern)
    for name in sorted(os.listdir(frames_dir)):
        if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            return os.path.join(frames_dir, name)
    raise FileNotFoundError(f"No frames found in {frames_dir}")


def scene_audio_input(scene, scene_duration, work_dir, index):
    """Build a deterministic mixed WAV when a scene has multiple audio clips."""
    clips = [clip for clip in (scene.get("audio_clips") or []) if not clip.get("muted") and clip.get("sourceDurationMs") != 0]
    if not clips:
        if "audio_clips" in scene:
            silence_path = os.path.join(work_dir, f"scene-{index:02d}-mix.wav")
            run_ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", str(scene_duration), "-c:a", "pcm_s16le", silence_path])
            return silence_path
        audio_path = norm(scene.get("audio_path") or "")
        if not audio_path or not os.path.isfile(audio_path):
            raise FileNotFoundError("Scene audio is unavailable")
        return audio_path
    mixed_path = os.path.join(work_dir, f"scene-{index:02d}-mix.wav")
    inputs = []
    filters = []
    labels = []
    for clip_index, clip in enumerate(clips):
        path = norm(clip.get("path") or "")
        if not path or not os.path.isfile(path):
            raise FileNotFoundError(f"Audio clip {clip.get('id') or clip_index} is unavailable")
        source_start = max(0.0, float(clip.get("sourceStartMs") or 0) / 1000.0)
        clip_duration = float(clip.get("durationMs") or clip.get("sourceDurationMs") or (scene_duration * 1000)) / 1000.0
        if clip.get("sourceDurationMs") is not None:
            clip_duration = min(clip_duration, float(clip["sourceDurationMs"]) / 1000.0)
        clip_duration = max(0.001, min(clip_duration, max(0.001, scene_duration - max(0, float(clip.get("startMs") or 0) / 1000.0))))
        start = max(0, int(float(clip.get("startMs") or 0)))
        gain = float(clip.get("gainDb") or 0)
        gain = max(-60.0, min(24.0, gain))
        label = f"[a{clip_index}]"
        inputs.extend(["-i", path])
        envelope = clip.get("fadeEnvelope") or {}
        offset = float(envelope.get("offsetMs") or 0) / 1000.0
        fade_duration = float(envelope["durationMs"]) / 1000.0 if envelope else clip_duration
        fade_in = max(0.0, float((envelope if envelope else clip).get("fadeInMs") or 0) / 1000.0)
        fade_out = max(0.0, float((envelope if envelope else clip).get("fadeOutMs") or 0) / 1000.0)
        if not all(math.isfinite(value) for value in (offset, fade_duration, fade_in, fade_out)) or offset < 0 or offset > source_start + 0.000001 or fade_duration < offset + clip_duration - 0.000001:
            raise ValueError("Audio fade envelope is invalid")
        # Apply the original envelope before trimming its elapsed prefix.
        chain = f"[{clip_index}:a]aresample=44100,atrim=start={max(0, source_start - offset)}:duration={offset + clip_duration},asetpts=N/SR/TB,volume={gain}dB"
        if fade_in > 0: chain += f",afade=t=in:st=0:d={min(fade_in, fade_duration)}"
        if fade_out > 0: chain += f",afade=t=out:st={max(0, fade_duration - fade_out)}:d={min(fade_out, fade_duration)}"
        if offset > 0: chain += f",atrim=start={offset}:duration={clip_duration},asetpts=N/SR/TB"
        chain += f",adelay={start}:all=1{label}"
        filters.append(chain)
        labels.append(label)
    # FFmpeg 7.1 can stall on amix=inputs=1 followed by padding/resampling.
    # A single audible track already is the mix; only combine multiple inputs.
    mixer = f"amix=inputs={len(labels)}:duration=longest:dropout_transition=0:normalize=0," if len(labels) > 1 else ""
    filters.append("".join(labels) + mixer + f"apad=whole_dur={scene_duration},aformat=sample_rates=44100:channel_layouts=stereo[out]")
    run_ffmpeg([*inputs, "-filter_complex", ";".join(filters), "-map", "[out]", "-t", str(scene_duration), "-c:a", "pcm_s16le", mixed_path])
    return mixed_path


def render_scene_duration(scene):
    scene_duration = float(scene.get("duration_s") or 0)
    if not math.isfinite(scene_duration) or scene_duration <= 0:
        audio_path = norm(scene.get("audio_path") or "")
        scene_duration = media_duration_s(audio_path) if audio_path else 0
        if (not math.isfinite(scene_duration) or scene_duration <= 0) and scene.get("audio_clips"):
            scene_duration = max((float(c.get("startMs") or 0) + float(c.get("durationMs") or c.get("sourceDurationMs") or 0)) / 1000.0 for c in scene.get("audio_clips") or [])
    if not math.isfinite(scene_duration) or scene_duration <= 0:
        raise ValueError("Scene duration is unavailable")
    return scene_duration


def encode_render_scene(scene, work_dir, segment_path, index=0):
    pattern = first_frame_pattern(scene["frames_dir"])
    scene_duration = render_scene_duration(scene)
    audio_path = scene_audio_input(scene, scene_duration, work_dir, index)
    fps = str(scene.get("fps") or 24)
    if "%" in pattern:
        video_input = ["-framerate", fps, "-i", pattern]
    else:
        video_input = ["-loop", "1", "-framerate", fps, "-i", pattern]
    ensure_parent(segment_path)
    run_ffmpeg([
        *video_input,
        "-i", audio_path,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-vf", f"tpad=stop_mode=clone:stop_duration={scene_duration}",
        "-af", "apad",
        "-t", str(scene_duration),
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-c:a", "aac",
        segment_path,
    ])
    return scene_duration


def generate_encode_render_scene(payload):
    work_dir = norm(payload["work_dir"])
    os.makedirs(work_dir, exist_ok=True)
    output_path = norm(payload["output_path"])
    duration = encode_render_scene(payload["scene"], work_dir, output_path)
    return {"success": True, "output_path": output_path, "duration": duration}


def generate_compose_render(payload):
    work_dir = norm(payload["work_dir"])
    os.makedirs(work_dir, exist_ok=True)
    segments = []
    segment_durations = []
    cover_segment_path = os.path.join(work_dir, "seg_cover.mp4")
    canvas_w = int(payload.get("canvas_w") or 1080)
    canvas_h = int(payload.get("canvas_h") or 1920)
    payload_scenes = payload.get("scenes") or []
    for index, scene in enumerate(payload_scenes):
        if scene.get("segment_path"):
            segment_path = norm(scene["segment_path"])
            if not os.path.isfile(segment_path) or os.path.getsize(segment_path) == 0:
                raise FileNotFoundError("Encoded scene is unavailable")
            scene_duration = render_scene_duration(scene)
        else:
            segment_path = os.path.join(work_dir, f"seg_{index:02d}.mp4")
            scene_duration = encode_render_scene(scene, work_dir, segment_path, index)
        segments.append(segment_path)
        segment_durations.append(scene_duration)
    if not segments:
        raise ValueError("compose_render requires at least one scene")
    source_path = os.path.join(work_dir, "_source.mp4")
    if payload.get("cover_path"):
        cover_duration = str(float(payload.get("cover_duration_s") or 2))
        first_scene = payload_scenes[0] if payload_scenes and isinstance(payload_scenes[0], dict) else {}
        cover_fps = str(first_scene.get("fps") or 24)
        run_ffmpeg([
            "-loop",
            "1",
            "-framerate",
            cover_fps,
            "-i",
            norm(payload["cover_path"]),
            "-f",
            "lavfi",
            "-t",
            cover_duration,
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t",
            cover_duration,
            "-vf",
            f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=decrease,pad={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-shortest",
            "-f",
            "mp4",
            cover_segment_path,
        ])
        segments = [cover_segment_path, *segments]
        segment_durations = [float(cover_duration), *segment_durations]
    if len(segments) == 1:
        shutil.copy2(segments[0], source_path)
    else:
        transition_type, transition_duration = transition_options(payload.get("transition"))
        if transition_type in ("cut", "none"):
            _compose_with_hard_cuts(segments, source_path, segment_durations, float(payload_scenes[0].get("fps") or 24))
        else:
            _compose_with_xfade(segments, source_path, transition_type, transition_duration, segment_durations)
    target_duration = float(payload.get("total_duration_s") or 0)
    if math.isfinite(target_duration) and target_duration > 0:
        duration_path = os.path.join(work_dir, "_source_duration.mp4")
        run_ffmpeg([
            "-i", source_path,
            "-vf", f"tpad=stop_mode=clone:stop_duration={target_duration}",
            "-af", "apad",
            "-t", str(target_duration),
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264",
            "-c:a", "aac",
            duration_path,
        ])
        os.replace(duration_path, source_path)
    if payload.get("bgm_path"):
        return generate_remix_bgm({
            "source_path": source_path,
            "bgm_path": payload.get("bgm_path"),
            "bgm_target_db": payload.get("bgm_target_db", -18),
            "output_path": payload["output_path"],
        })
    output_path = norm(payload["output_path"])
    ensure_parent(output_path)
    shutil.copy2(source_path, output_path)
    return {"success": True, "source_path": source_path, "output_path": output_path}


def dispatch(payload):
    mode = payload.get("mode") or "story"
    if mode == "story":
        return generate_story(payload)
    if mode == "music_mv":
        return generate_music_mv(payload)
    if mode == "compose_render":
        return generate_compose_render(payload)
    if mode == "encode_render_scene":
        return generate_encode_render_scene(payload)
    if mode == "remix_bgm":
        return generate_remix_bgm(payload)
    if mode == "convert_audio_16k":
        return convert_audio_16k(payload)
    if mode == "probe_media":
        return probe_media(payload)
    if mode == "normalize_scene_video":
        return normalize_scene_video(payload)
    if mode == "probe_glyphs":
        return probe_glyphs(payload)
    raise ValueError(f"Unsupported Storybound sidecar mode: {mode}")


def main():
    global storybound_scratch_token
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    storybound_scratch_token = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("_storyboundScratchToken") or ""))[:32]
    result = dispatch(payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc), "traceback": traceback.format_exc()}, ensure_ascii=False))
        sys.exit(1)
`;
