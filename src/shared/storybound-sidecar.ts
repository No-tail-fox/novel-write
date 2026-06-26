import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { resolvePythonRuntimeInfo, type PythonRuntimeInfo } from './python-runtime';

const execFileAsync = promisify(execFile);

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

export type StoryboundSidecarInput =
  | StoryboundStoryInput
  | StoryboundMusicMvInput
  | StoryboundComposeRenderInput
  | StoryboundRemixBgmInput
  | StoryboundConvertAudioInput;

export interface StoryboundSidecarResult {
  success: boolean;
  draft_dir?: string;
  draft_id?: string;
  output_path?: string;
  source_path?: string;
  error?: string;
  traceback?: string;
}

export interface StoryboundSidecarRunnerOptions {
  pythonCommand?: string;
  execute?: (
    command: string,
    args: string[],
    options: { cwd: string },
  ) => Promise<{
    code?: number | null;
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
  const execution = await execute(runtime.command, [scriptPath, payloadPath], { cwd: workDir });
  const code = execution.code ?? 0;

  if (code !== 0) {
    const detail = [execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n') || 'unknown error';
    throw new Error(`Jianying draft sidecar 退出码 ${code}: ${detail}`);
  }

  const result = parseStoryboundSidecarOutput(execution.stdout);
  if (result.success === false) {
    const detail = [result.error || 'Storybound-compatible sidecar failed.', result.traceback].filter(Boolean).join('\n');
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

async function executePython(command: string, args: string[], options: { cwd: string }): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, options);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const shellError = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
    const code = typeof shellError.code === 'number' ? shellError.code : 1;
    return {
      code,
      stdout: String(shellError.stdout ?? ''),
      stderr: String(shellError.stderr ?? shellError.message ?? ''),
    };
  }
}

const pythonSidecarScript = String.raw`import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import traceback
import uuid
import wave


def norm(path):
    return os.path.abspath(os.path.expanduser(str(path or "")))


def ensure_parent(path):
    parent = os.path.dirname(norm(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


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
    completed = subprocess.run([ffmpeg_exe(), "-y", *args], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
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
        completed = subprocess.run(
            [probe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if completed.returncode == 0:
            try:
                return max(0.0, float(completed.stdout.strip()))
            except ValueError:
                pass
    completed = subprocess.run([ffmpeg_exe(), "-i", path], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", completed.stderr)
    if not match:
        return 0.0
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


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
    duration = int(float(payload.get("audio_duration") or 0) * 1000000)
    if duration <= 0:
        duration = total_scene_duration_us(lyrics)
    title = str(payload.get("task_title") or cover_title_text(payload) or "StoryDream Music MV")
    content = {
        "duration": duration,
        "materials": {
            "videos": assignments,
            "audios": [{"path": payload.get("audio_path") or "", "source": "music_mv"}],
            "texts": lyrics,
        },
        "tracks": [
            {"type": "video", "segments": assignments},
            {"type": "audio", "segments": [{"path": payload.get("audio_path") or "", "duration": duration}]},
            {"type": "text", "segments": lyrics},
        ],
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
    for index, scene in enumerate(payload.get("scenes") or []):
        pattern = first_frame_pattern(scene["frames_dir"])
        segment_path = os.path.join(work_dir, f"seg_{index:02d}.mp4")
        fps = str(scene.get("fps") or 24)
        if "%" in pattern:
            video_input = ["-framerate", fps, "-i", pattern]
        else:
            video_input = ["-loop", "1", "-framerate", fps, "-i", pattern]
        run_ffmpeg([
            *video_input,
            "-i", norm(scene["audio_path"]),
            "-shortest",
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
        run_ffmpeg([
            "-loop",
            "1",
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
