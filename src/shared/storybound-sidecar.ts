import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  redactProcessOutput,
  runBoundedProcess,
  type BoundedProcessOptions,
  type BoundedProcessResult,
} from './process-runner';
import { resolvePythonRuntimeInfo, type PythonRuntimeInfo } from './python-runtime';

const defaultSidecarTimeoutMs = 60 * 60 * 1_000;
const defaultSidecarStdoutBytes = 4 * 1024 * 1024;
const defaultSidecarStderrBytes = 16 * 1024 * 1024;

export interface StoryboundStoryAssets {
  images?: Array<{ scene_id: number; path: string }>;
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

export interface StoryboundComposeRenderInput {
  mode: 'compose_render';
  work_dir: string;
  scenes: Array<{ frames_dir: string; audio_path: string; fps?: number }>;
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
}

export type StoryboundSidecarInput =
  | StoryboundStoryInput
  | StoryboundMusicMvInput
  | StoryboundComposeRenderInput
  | StoryboundRemixBgmInput
  | StoryboundConvertAudioInput
  | StoryboundProbeMediaInput;

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
  const payloadPath = await writeStoryboundSidecarInput(input, workDir);
  const scriptPath = await writeStoryboundSidecarScript(workDir);
  const runtime: PythonRuntimeInfo = options.pythonCommand ? { command: options.pythonCommand, source: 'system' } : resolvePythonRuntimeInfo();
  const execute = options.execute ?? executePython;
  let execution: Awaited<ReturnType<NonNullable<StoryboundSidecarRunnerOptions['execute']>>>;
  try {
    execution = await execute(runtime.command, [scriptPath, payloadPath], {
      cwd: workDir,
      timeoutMs: options.timeoutMs ?? defaultSidecarTimeoutMs,
      maxStdoutBytes: options.maxStdoutBytes ?? defaultSidecarStdoutBytes,
      maxStderrBytes: options.maxStderrBytes ?? defaultSidecarStderrBytes,
      signal: options.signal,
    });
  } catch (error) {
    throw safeSidecarExecutionError(error);
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
import threading
import time
import traceback
import uuid
import wave


SIDECAR_SUBPROCESS_TIMEOUT_SECONDS = 15 * 60
SIDECAR_SUBPROCESS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024


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
):
    popen_options = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
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


def run_ffmpeg(args):
    output_path = norm(args[-1]) if args and not str(args[-1]).startswith("-") else ""
    try:
        completed = run_bounded_subprocess([ffmpeg_exe(), "-y", *args])
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
            [probe, "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", path],
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
    }


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
    duration = total_scene_duration_us(scenes)
    title = str(payload.get("task_title") or cover_title_text(payload))
    content = {
        "duration": duration,
        "canvas_config": {
            "width": int((canvas or {}).get("width") or 1080),
            "height": int((canvas or {}).get("height") or 1920),
            "ratio": (canvas or {}).get("ratio") or "original",
        },
        "materials": {
            "videos": assets.get("images") or [],
            "audios": assets.get("narration") or [],
            "texts": scenes,
            "bgm": payload.get("bgm_path") or "",
            "subtitles": assets.get("subtitles_path") or "",
        },
        "tracks": [
            {"type": "video", "segments": assets.get("images") or []},
            {"type": "audio", "segments": assets.get("narration") or []},
            {"type": "text", "segments": scenes},
        ],
        "storybound_contract": payload,
    }
    return create_minimal_draft(payload["jianying_draft_path"], title, content, {"draft_cover": payload.get("cover_image_path") or ""})


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
    result.update(media_stream_info(media_path))
    return result


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


def _compose_with_xfade(segment_paths, output_path, transition_type="fade", transition_duration=0.3):
    if len(segment_paths) < 2:
        shutil.copy2(segment_paths[0], output_path)
        return
    durations = [media_duration_s(path) for path in segment_paths]
    known_limits = [duration / 2.0 for duration in durations if duration > 0]
    if known_limits:
        transition_duration = min(float(transition_duration), max(0.01, min(known_limits)))
    inputs = []
    filters = []
    for index, path in enumerate(segment_paths):
        inputs.extend(["-i", path])
        filters.append(f"[{index}:v]settb=AVTB,setsar=1[v{index}]")
        filters.append(f"[{index}:a]aformat=sample_rates=44100:channel_layouts=stereo[a{index}]")
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
    run_ffmpeg([
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


def generate_compose_render(payload):
    work_dir = norm(payload["work_dir"])
    os.makedirs(work_dir, exist_ok=True)
    segments = []
    cover_segment_path = os.path.join(work_dir, "seg_cover.mp4")
    canvas_w = int(payload.get("canvas_w") or 1080)
    canvas_h = int(payload.get("canvas_h") or 1920)
    payload_scenes = payload.get("scenes") or []
    for index, scene in enumerate(payload_scenes):
        pattern = first_frame_pattern(scene["frames_dir"])
        audio_path = norm(scene["audio_path"])
        scene_duration = media_duration_s(audio_path)
        if not math.isfinite(scene_duration) or scene_duration <= 0:
            raise ValueError("Scene audio duration is unavailable")
        segment_path = os.path.join(work_dir, f"seg_{index:02d}.mp4")
        fps = str(scene.get("fps") or 24)
        if "%" in pattern:
            video_input = ["-framerate", fps, "-i", pattern]
        else:
            video_input = ["-loop", "1", "-framerate", fps, "-i", pattern]
        run_ffmpeg([
            *video_input,
            "-i", audio_path,
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-t", str(scene_duration),
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264",
            "-c:a", "aac",
            segment_path,
        ])
        segments.append(segment_path)
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
    if len(segments) == 1:
        shutil.copy2(segments[0], source_path)
    else:
        transition_type, transition_duration = transition_options(payload.get("transition"))
        _compose_with_xfade(segments, source_path, transition_type, transition_duration)
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
    if mode == "remix_bgm":
        return generate_remix_bgm(payload)
    if mode == "convert_audio_16k":
        return convert_audio_16k(payload)
    if mode == "probe_media":
        return probe_media(payload)
    raise ValueError(f"Unsupported Storybound sidecar mode: {mode}")


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    result = dispatch(payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc), "traceback": traceback.format_exc()}, ensure_ascii=False))
        sys.exit(1)
`;
