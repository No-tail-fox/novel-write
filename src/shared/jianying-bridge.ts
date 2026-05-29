import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BgmItem } from './types';

const execFileAsync = promisify(execFile);

export interface PyJianYingBridgeInput {
  workDir: string;
  draftDir: string;
  title: string;
  canvas: {
    width: number;
    height: number;
    backgroundColor: string;
    backgroundImage: string;
  };
  imageArea: {
    ratio: string;
    top: number;
    height: number;
    fit: 'cover' | 'contain';
    animation: string;
  };
  caption: {
    fontSize: number;
    color: string;
    x?: number;
    y: number;
  };
  overlays?: {
    title?: {
      visible: boolean;
      text: string;
      x: number;
      y: number;
      fontSize: number;
      color: string;
    };
    subtitle?: {
      visible: boolean;
      x: number;
      y: number;
      fontSize: number;
      color: string;
    };
    disclaimer?: {
      visible: boolean;
      text: string;
      x: number;
      y: number;
    };
  };
  scenes?: Array<{ sceneId: number; startUs: number; durationUs: number; text: string }>;
  images: Array<{ sceneId: number; path: string }>;
  narration: Array<{ sceneId: number; path: string }>;
  subtitlesSrtPath: string;
  bgm: BgmItem | null;
  totalDurationUs?: number;
  volumes?: {
    narration: number;
    bgm: number;
  };
  effects?: {
    transitionType: string;
    transitionDurationUs: number;
    narrationFadeInUs: number;
    narrationFadeOutUs: number;
    bgmFadeInUs: number;
    bgmFadeOutUs: number;
    filterType: string;
    videoEffectType: string;
    audioEffectType: string;
  };
}

export interface PyJianYingBridgeOutput {
  draftDir: string;
  draftContentPath: string;
  draftMetaPath: string;
  durationUs: number;
  assets?: {
    images: string[];
    narration: string[];
    bgm: string | null;
    subtitles: string;
  };
}

export interface PyJianYingBridgeRunnerOptions {
  pythonCommand?: string;
  execute?: (
    command: string,
    args: string[],
    options: { cwd: string },
  ) => Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export async function writePyJianYingBridgeInput(input: PyJianYingBridgeInput): Promise<string> {
  const bridgeDir = join(input.workDir, 'pyjianying-bridge');
  await mkdir(bridgeDir, { recursive: true });
  const payloadPath = join(bridgeDir, 'input.json');
  await writeFile(payloadPath, JSON.stringify(input, null, 2), 'utf8');
  return payloadPath;
}

export async function writePyJianYingBridgeScript(workDir: string): Promise<string> {
  const bridgeDir = join(workDir, 'pyjianying-bridge');
  await mkdir(bridgeDir, { recursive: true });
  const scriptPath = join(bridgeDir, 'bridge.py');
  await writeFile(scriptPath, pythonBridgeScript, 'utf8');
  return scriptPath;
}

export async function runPyJianYingDraftBridge(
  input: PyJianYingBridgeInput,
  options: PyJianYingBridgeRunnerOptions = {},
): Promise<PyJianYingBridgeOutput> {
  const payloadPath = await writePyJianYingBridgeInput(input);
  const scriptPath = await writePyJianYingBridgeScript(input.workDir);
  const execute = options.execute ?? ((command, args, execOptions) => execFileAsync(command, args, execOptions));
  const pythonCommand = options.pythonCommand ?? 'python';

  try {
    const { stdout } = await execute(pythonCommand, [scriptPath, payloadPath], { cwd: input.workDir });
    const lastJsonLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse()
      .find((line) => line.startsWith('{') && line.endsWith('}'));
    if (!lastJsonLine) {
      throw new Error('pyJianYingDraft bridge did not return JSON output.');
    }
    const result = JSON.parse(lastJsonLine) as Partial<PyJianYingBridgeOutput> & { ok?: boolean; error?: string };
    if (result.ok === false) {
      throw new Error(result.error ?? 'pyJianYingDraft bridge failed.');
    }
    if (!result.draftDir || !result.draftContentPath || !result.draftMetaPath || typeof result.durationUs !== 'number') {
      throw new Error('pyJianYingDraft bridge returned incomplete draft metadata.');
    }
    return {
      draftDir: result.draftDir,
      draftContentPath: result.draftContentPath,
      draftMetaPath: result.draftMetaPath,
      durationUs: result.durationUs,
      assets: result.assets,
    };
  } catch (error) {
    throw new Error(formatBridgeError(error));
  }
}

function formatBridgeError(error: unknown): string {
  const pieces = [
    error instanceof Error ? error.message : String(error),
    typeof error === 'object' && error !== null && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '',
    typeof error === 'object' && error !== null && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : '',
  ].filter(Boolean);
  const detail = pieces.join('\n').trim();
  if (/ModuleNotFoundError: No module named ['"]pyJianYingDraft['"]|No module named ['"]pyJianYingDraft['"]/i.test(detail)) {
    return `pyJianYingDraft is not installed. Run: python -m pip install pyJianYingDraft. Original error: ${detail}`;
  }
  return `pyJianYingDraft bridge failed: ${detail || 'unknown error'}`;
}

const pythonBridgeScript = String.raw`import json
import os
import shutil
import struct
import sys
import traceback
import zlib

try:
    import pyJianYingDraft as draft
except ModuleNotFoundError:
    raise


def norm(path):
    return os.path.abspath(path)


def color_to_rgb(color):
    value = str(color or "#ffffff").strip().lstrip("#")
    if len(value) != 6:
        return (1.0, 1.0, 1.0)
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def color_to_bytes(color):
    value = str(color or "#000000").strip().lstrip("#")
    if len(value) != 6:
        value = "000000"
    try:
        return bytes(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return b"\x00\x00\x00"


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def create_solid_png(path, width, height, color):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rgb = color_to_bytes(color)
    row = b"\x00" + rgb * int(width)
    raw = row * int(height)
    payload = [
        b"\x89PNG\r\n\x1a\n",
        png_chunk(b"IHDR", struct.pack(">IIBBBBB", int(width), int(height), 8, 2, 0, 0, 0)),
        png_chunk(b"IDAT", zlib.compress(raw, 6)),
        png_chunk(b"IEND", b""),
    ]
    with open(path, "wb") as handle:
        handle.write(b"".join(payload))


def prepare_background_asset(payload, materials_dir):
    canvas = payload.get("canvas") or {}
    background_image = str(canvas.get("backgroundImage") or "").strip()
    if background_image:
        return copy_asset(background_image, os.path.join(materials_dir, "background"), "background", ".png")
    background_path = os.path.join(materials_dir, "background", "canvas-background.png")
    create_solid_png(
        background_path,
        int(canvas.get("width", 1080)),
        int(canvas.get("height", 1920)),
        canvas.get("backgroundColor", "#000000"),
    )
    return background_path


def apply_image_animation(segment, animation_name):
    animation_name = str(animation_name or "").strip()
    if not animation_name or animation_name == "无动画":
        return
    for enum_name in ("GroupAnimationType", "IntroType", "OutroType"):
        enum_type = getattr(draft, enum_name, None)
        from_name = getattr(enum_type, "from_name", None) if enum_type else None
        if not from_name:
            continue
        try:
            segment.add_animation(from_name(animation_name))
            return
        except Exception:
            continue


def resolve_enum(enum_name, name):
    name = str(name or "").strip()
    if not name:
        return None
    enum_type = getattr(draft, enum_name, None)
    if enum_type is None:
        raise ValueError(f"pyJianYingDraft enum is unavailable: {enum_name}")
    from_name = getattr(enum_type, "from_name", None)
    if from_name:
        try:
            return from_name(name)
        except Exception:
            pass
    member = getattr(enum_type, name, None)
    if member is not None:
        return member
    for item in enum_type:
        if getattr(item, "name", "") == name:
            return item
    raise ValueError(f"Unknown {enum_name}: {name}")


def ms_to_us(value):
    return int(round(float(value) * 1000))


def copy_asset(source_path, target_dir, filename_stem, fallback_ext):
    os.makedirs(target_dir, exist_ok=True)
    source_path = norm(source_path)
    _, ext = os.path.splitext(source_path)
    target_path = os.path.join(target_dir, filename_stem + (ext or fallback_ext))
    shutil.copy2(source_path, target_path)
    return target_path


def patch_meta(meta_path, payload, draft_dir, duration, background_path, image_paths, narration_paths, bgm_path):
    try:
        with open(meta_path, "r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except FileNotFoundError:
        meta = {}
    meta.update({
        "draft_cover": image_paths[0] if image_paths else "",
        "draft_fold_path": draft_dir,
        "draft_name": payload["title"],
        "draft_root_path": os.path.dirname(draft_dir),
        "tm_duration": duration,
    })
    meta["draft_materials"] = [
        {"type": 0, "value": [background_path] + image_paths},
        {"type": 1, "value": narration_paths},
        {"type": 2, "value": [bgm_path] if bgm_path else []},
        {"type": 3, "value": []},
        {"type": 6, "value": []},
        {"type": 7, "value": []},
        {"type": 8, "value": []},
    ]
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=4)


def format_srt_time(us):
    ms = int(round(us / 1000))
    hours = ms // 3600000
    minutes = (ms % 3600000) // 60000
    seconds = (ms % 60000) // 1000
    millis = ms % 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def write_timed_subtitles(path, timeline):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    blocks = []
    for index, item in enumerate(timeline, start=1):
        start = int(item["startUs"])
        end = start + int(item["durationUs"])
        text = str(item.get("text") or "").strip()
        blocks.append(f"{index}\n{format_srt_time(start)} --> {format_srt_time(end)}\n{text}\n")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(blocks))


def clamp_effect_duration(value, segment_duration):
    value = max(0, int(value or 0))
    segment_duration = max(0, int(segment_duration or 0))
    if segment_duration <= 0:
        return 0
    return min(value, segment_duration // 2)


def main():
    payload_path = sys.argv[1]
    with open(payload_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    draft_dir = norm(payload["draftDir"])
    draft_root = os.path.dirname(draft_dir)
    draft_name = os.path.basename(draft_dir)
    os.makedirs(draft_root, exist_ok=True)

    folder = draft.DraftFolder(draft_root)
    script = folder.create_draft(
        draft_name,
        int(payload["canvas"]["width"]),
        int(payload["canvas"]["height"]),
        fps=30,
        maintrack_adsorb=True,
        allow_replace=True,
    )
    background_track = "background_track"
    script.add_track(draft.TrackType.video, background_track)
    script.add_track(draft.TrackType.video, "images")
    script.add_track(draft.TrackType.audio, "narration")

    scenes = payload.get("scenes") or []
    durations = {int(scene["sceneId"]): int(scene["durationUs"]) for scene in scenes}
    materials_dir = os.path.join(draft_dir, "materials")
    image_by_scene = {
        int(item["sceneId"]): copy_asset(item["path"], os.path.join(materials_dir, "images"), str(int(item["sceneId"])).zfill(3), ".png")
        for item in payload["images"]
    }
    audio_by_scene = {
        int(item["sceneId"]): copy_asset(item["path"], os.path.join(materials_dir, "narration"), str(int(item["sceneId"])).zfill(3), ".mp3")
        for item in payload["narration"]
    }
    audio_materials = {scene_id: draft.AudioMaterial(path) for scene_id, path in audio_by_scene.items()}
    volumes = payload.get("volumes") or {}
    effects = payload.get("effects") or {}
    image_area = payload.get("imageArea") or {}
    timeline = []
    cursor = 0
    for scene in scenes:
        scene_id = int(scene["sceneId"])
        planned_duration = int(durations.get(scene_id, 0))
        audio_duration = int(audio_materials[scene_id].duration)
        scene_duration = max(planned_duration, audio_duration)
        timeline.append({
            "sceneId": scene_id,
            "startUs": cursor,
            "durationUs": scene_duration,
            "audioDurationUs": audio_duration,
            "text": scene.get("text", ""),
        })
        cursor += scene_duration
    total_duration = max(cursor, int(payload.get("totalDurationUs") or 0))
    subtitle_path = os.path.join(materials_dir, "subtitles", "subtitles.srt")
    write_timed_subtitles(subtitle_path, timeline)
    transition_type = resolve_enum("TransitionType", effects.get("transitionType"))
    transition_duration = int(effects.get("transitionDurationUs") or 0)
    narration_fade_in = int(effects.get("narrationFadeInUs") or 0)
    narration_fade_out = int(effects.get("narrationFadeOutUs") or 0)
    bgm_fade_in = int(effects.get("bgmFadeInUs") or 0)
    bgm_fade_out = int(effects.get("bgmFadeOutUs") or 0)
    filter_type = resolve_enum("FilterType", effects.get("filterType"))
    video_effect_type = resolve_enum("VideoSceneEffectType", effects.get("videoEffectType"))
    audio_effect_type = resolve_enum("AudioSceneEffectType", effects.get("audioEffectType"))
    background_path = prepare_background_asset(payload, materials_dir)
    background_material = draft.VideoMaterial(background_path)
    background_segment = draft.VideoSegment(
        background_material,
        draft.Timerange(0, total_duration),
        source_timerange=draft.Timerange(0, total_duration),
        clip_settings=draft.ClipSettings(scale_x=1.0, scale_y=1.0),
    )
    script.add_segment(background_segment, background_track)

    for index, scene in enumerate(timeline):
        scene_id = int(scene["sceneId"])
        start = int(scene["startUs"])
        duration = int(scene["durationUs"])
        audio_duration = int(scene["audioDurationUs"])
        image_material = draft.VideoMaterial(image_by_scene[scene_id])
        audio_material = audio_materials[scene_id]
        scale = 1.0 if image_area.get("fit") == "cover" else 0.96
        transform_y = float(image_area.get("top", 0)) * 2 + float(image_area.get("height", 1)) - 1
        image_segment = draft.VideoSegment(
            image_material,
            draft.Timerange(start, duration),
            source_timerange=draft.Timerange(0, duration),
            clip_settings=draft.ClipSettings(scale_x=scale, scale_y=scale, transform_y=transform_y),
        )
        apply_image_animation(image_segment, image_area.get("animation"))
        if filter_type:
            image_segment.add_filter(filter_type)
        if video_effect_type:
            image_segment.add_effect(video_effect_type)
        if index < len(timeline) - 1 and transition_type and transition_duration > 0:
            image_segment.add_transition(transition_type, duration=clamp_effect_duration(transition_duration, duration))
        script.add_segment(image_segment, "images")

        audio_segment = draft.AudioSegment(
            audio_material,
            draft.Timerange(start, audio_duration),
            source_timerange=draft.Timerange(0, audio_duration),
            volume=float(volumes.get("narration", 1.0)),
        )
        if narration_fade_in > 0 or narration_fade_out > 0:
            audio_segment.add_fade(
                clamp_effect_duration(narration_fade_in, audio_duration),
                clamp_effect_duration(narration_fade_out, audio_duration),
            )
        if audio_effect_type:
            audio_segment.add_effect(audio_effect_type)
        script.add_segment(audio_segment, "narration")

    bgm = payload.get("bgm")
    bgm_path = None
    if bgm and bgm.get("path"):
        script.add_track(draft.TrackType.audio, "bgm")
        bgm_path = copy_asset(bgm["path"], os.path.join(materials_dir, "bgm"), "bgm", ".mp3")
        bgm_material = draft.AudioMaterial(bgm_path)
        bgm_source_duration = min(total_duration, int(bgm_material.duration))
        bgm_segment = draft.AudioSegment(
            bgm_material,
            draft.Timerange(0, bgm_source_duration),
            source_timerange=draft.Timerange(0, bgm_source_duration),
            volume=float(volumes.get("bgm", bgm.get("volume", 0.3))),
        )
        if bgm_fade_in > 0 or bgm_fade_out > 0:
            bgm_segment.add_fade(
                clamp_effect_duration(bgm_fade_in, bgm_source_duration),
                clamp_effect_duration(bgm_fade_out, bgm_source_duration),
            )
        script.add_segment(bgm_segment, "bgm")

    caption = payload.get("caption") or {}
    script.import_srt(
        subtitle_path,
        track_name="subtitles",
        text_style=draft.TextStyle(
            size=float(caption.get("fontSize", 8)),
            color=color_to_rgb(caption.get("color", "#ffffff")),
            align=1,
            auto_wrapping=True,
        ),
        clip_settings=draft.ClipSettings(transform_x=float(caption.get("x", 0)), transform_y=float(caption.get("y", -0.8))),
    )

    script.save()
    content_path = os.path.join(draft_dir, "draft_content.json")
    meta_path = os.path.join(draft_dir, "draft_meta_info.json")
    copied_images = [image_by_scene[int(scene["sceneId"])] for scene in scenes]
    copied_narration = [audio_by_scene[int(scene["sceneId"])] for scene in scenes]
    patch_meta(meta_path, payload, draft_dir, script.duration, background_path, copied_images, copied_narration, bgm_path)
    print(json.dumps({
        "ok": True,
        "draftDir": draft_dir,
        "draftContentPath": content_path,
        "draftMetaPath": meta_path,
        "durationUs": int(script.duration),
        "assets": {
            "images": copied_images,
            "narration": copied_narration,
            "bgm": bgm_path,
            "subtitles": subtitle_path,
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}, ensure_ascii=False))
        sys.exit(1)
`;
