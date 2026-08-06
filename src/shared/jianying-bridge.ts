import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolvePythonRuntimeInfo, type PythonRuntimeInfo } from './python-runtime';
import type { BgmItem, DraftImageBorderSides, DraftImageMotion, DraftTextBorder } from './types';

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
    visible: boolean;
    ratio: string;
    top: number;
    height: number;
    fit: 'cover' | 'contain';
    animation: string;
    motion?: DraftImageMotion;
    motionStrength?: number;
  };
  frame?: {
    enabled: boolean;
    headerColor: string;
    headerColorEnd: string;
    footerColor: string;
    footerColorEnd: string;
    imageBorderColor: string;
    imageBorderWidth: number;
    imageBorderSides: DraftImageBorderSides;
  };
  caption: {
    visible: boolean;
    fontSize: number;
    width: number;
    color: string;
    alpha: number;
    border: DraftTextBorder;
    bold: boolean;
    underline: boolean;
    align: number;
    letterSpacing: number;
    lineSpacing: number;
    maxCharsPerLine: number;
    background: {
      color: string;
      alpha: number;
      roundRadius: number;
    };
    x?: number;
    y: number;
  };
  overlays?: {
    title?: {
      visible: boolean;
      text: string;
      startUs?: number;
      durationUs?: number;
      x: number;
      y: number;
      width: number;
      fontSize: number;
      color: string;
      alpha: number;
      bold: boolean;
      underline: boolean;
      align: number;
      letterSpacing: number;
      lineSpacing: number;
      border: DraftTextBorder;
    };
    subtitle?: {
      visible: boolean;
      text: string;
      startUs?: number;
      durationUs?: number;
      x: number;
      y: number;
      width: number;
      fontSize: number;
      color: string;
      alpha: number;
      bold: boolean;
      underline: boolean;
      align: number;
      letterSpacing: number;
      lineSpacing: number;
      border: DraftTextBorder;
    };
    disclaimer?: {
      visible: boolean;
      text: string;
      startUs?: number;
      durationUs?: number;
      x: number;
      y: number;
      width: number;
      fontSize: number;
      color: string;
      alpha: number;
      bold: boolean;
      underline: boolean;
      align: number;
      letterSpacing: number;
      lineSpacing: number;
      border: DraftTextBorder;
    };
  };
  coverPage?: {
    imagePath: string;
    durationUs: number;
    title?: {
      visible: boolean;
      text: string;
      startUs?: number;
      durationUs?: number;
      x: number;
      y: number;
      width: number;
      fontSize: number;
      color: string;
      alpha: number;
      bold: boolean;
      underline: boolean;
      align: number;
      letterSpacing: number;
      lineSpacing: number;
      border: DraftTextBorder;
    };
  };
  scenes?: Array<{ sceneId: number; startUs: number; durationUs: number; text: string; captions?: string[]; captionDurationsUs?: number[] }>;
  images: Array<{ sceneId: number; path: string }>;
  coverImagePath?: string;
  narration: Array<{ sceneId: number; path: string; speaker?: 'A' | 'B'; turnIndex?: number; text?: string }>;
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
  const runtime: PythonRuntimeInfo = options.pythonCommand ? { command: options.pythonCommand, source: 'system' } : resolvePythonRuntimeInfo();
  const pythonCommand = runtime.command;

  try {
    const { stdout } = await execute(pythonCommand, [scriptPath, payloadPath], { cwd: input.workDir });
    const result = parseBridgeJsonOutput(stdout);
    if (!result) {
      throw new Error('pyJianYingDraft bridge did not return JSON output.');
    }
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
    throw new Error(formatBridgeError(error, runtime));
  }
}

type BridgeJsonOutput = Partial<PyJianYingBridgeOutput> & { ok?: boolean; error?: string; traceback?: string };

function parseBridgeJsonOutput(output: string): BridgeJsonOutput | null {
  const lastJsonLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!lastJsonLine) return null;
  try {
    return JSON.parse(lastJsonLine) as BridgeJsonOutput;
  } catch {
    return null;
  }
}

function formatBridgeError(error: unknown, runtime: PythonRuntimeInfo): string {
  const stdout = typeof error === 'object' && error !== null && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : '';
  const structured = parseBridgeJsonOutput(stdout);
  if (structured?.ok === false) {
    const detail = [structured.error || 'pyJianYingDraft bridge failed.', structured.traceback].filter(Boolean).join('\n');
    return `pyJianYingDraft bridge failed: ${detail}`;
  }
  const pieces = [
    error instanceof Error ? error.message : String(error),
    typeof error === 'object' && error !== null && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '',
    stdout,
  ].filter(Boolean);
  const detail = pieces.join('\n').trim();
  const systemPythonHint =
    runtime.source === 'system'
      ? ' The app is using system Python because bundled Python was not found. Rebuild or copy the portable package with resources/python/python.exe, or install pyJianYingDraft into system Python.'
      : '';
  if (/ModuleNotFoundError: No module named ['"]pyJianYingDraft['"]|No module named ['"]pyJianYingDraft['"]/i.test(detail)) {
    return `pyJianYingDraft is not installed. Run: python -m pip install pyJianYingDraft.${systemPythonHint} Original error: ${detail}`;
  }
  return `pyJianYingDraft bridge failed: ${detail || 'unknown error'}${systemPythonHint}`;
}

const pythonBridgeScript = String.raw`import json
import os
import re
import shutil
import struct
import sys
import traceback
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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


def clamp_number(value, default, minimum, maximum):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def gradient_rgba_row(width, start_color, end_color):
    width = max(1, int(width))
    start = color_to_bytes(start_color)
    end = color_to_bytes(end_color)
    if width == 1:
        return start + b"\xff"
    row = bytearray()
    for index in range(width):
        progress = index / (width - 1)
        row.extend(bytes(int(round(start[channel] + (end[channel] - start[channel]) * progress)) for channel in range(3)))
        row.append(255)
    return bytes(row)


def create_frame_overlay_png(path, canvas, image_area, frame):
    frame = frame or {}
    frame_enabled = bool(frame.get("enabled", False))
    width = max(1, int(canvas.get("width", 1080) or 1080))
    height = max(1, int(canvas.get("height", 1920) or 1920))
    image_top = int(round(clamp_number(image_area.get("top"), 0, 0, 1) * height))
    image_height = int(round(clamp_number(image_area.get("height"), 1, 0, 1 - (image_top / height)) * height))
    image_bottom = max(image_top, min(height, image_top + image_height))
    border_width = int(round(clamp_number(frame.get("imageBorderWidth"), 0, 0, min(width, height) / 2))) if frame_enabled else 0
    border_sides = str(frame.get("imageBorderSides") or "all")
    transparent_pixel = b"\x00\x00\x00\x00"
    transparent_row = transparent_pixel * width
    border_pixel = color_to_bytes(frame.get("imageBorderColor", "#000000")) + b"\xff"
    horizontal_border_row = border_pixel * width
    side_width = min(border_width, width // 2)
    vertical_border_row = border_pixel * side_width + transparent_pixel * (width - side_width * 2) + border_pixel * side_width
    canvas_color = canvas.get("backgroundColor", "#000000")
    header_color = frame.get("headerColor", canvas_color) if frame_enabled else canvas_color
    header_color_end = frame.get("headerColorEnd", header_color) if frame_enabled else canvas_color
    footer_color = frame.get("footerColor", canvas_color) if frame_enabled else canvas_color
    footer_color_end = frame.get("footerColorEnd", footer_color) if frame_enabled else canvas_color
    header_row = gradient_rgba_row(width, header_color, header_color_end)
    footer_row = gradient_rgba_row(width, footer_color, footer_color_end)
    has_horizontal = border_width > 0 and border_sides in ("all", "horizontal")
    has_vertical = border_width > 0 and border_sides in ("all", "vertical")
    if image_top <= 0 and image_bottom >= height and not has_horizontal and not has_vertical:
        return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    compressor = zlib.compressobj(6)
    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        for y in range(height):
            if y < image_top:
                row = header_row
            elif y >= image_bottom:
                row = footer_row
            elif has_horizontal and (y < image_top + border_width or y >= image_bottom - border_width):
                row = horizontal_border_row
            elif has_vertical:
                row = vertical_border_row
            else:
                row = transparent_row
            compressed = compressor.compress(b"\x00" + row)
            if compressed:
                handle.write(png_chunk(b"IDAT", compressed))
        final = compressor.flush()
        if final:
            handle.write(png_chunk(b"IDAT", final))
        handle.write(png_chunk(b"IEND", b""))
    return path


def prepare_frame_overlay_asset(payload, materials_dir):
    return create_frame_overlay_png(
        os.path.join(materials_dir, "frame", "frame-overlay.png"),
        payload.get("canvas") or {},
        payload.get("imageArea") or {},
        payload.get("frame") or {},
    )


def editor_text_y_to_jianying(value, default=0):
    return -clamp_number(value, default, -1.0, 1.0)


def ratio_to_number(value, default=9 / 16):
    parts = str(value or "").split(":")
    if len(parts) != 2:
        return default
    try:
        width = float(parts[0])
        height = float(parts[1])
    except (TypeError, ValueError):
        return default
    if width <= 0 or height <= 0:
        return default
    return width / height


def resolve_image_animation(animation_name):
    animation_name = str(animation_name or "").strip()
    if not animation_name or animation_name == "无动画":
        return None
    for enum_name in ("GroupAnimationType", "IntroType", "OutroType"):
        enum_type = getattr(draft, enum_name, None)
        from_name = getattr(enum_type, "from_name", None) if enum_type else None
        if not from_name:
            continue
        try:
            return from_name(animation_name)
        except Exception:
            continue
    raise ValueError(f"Unknown image animation: {animation_name}")


def apply_image_animation(segment, animation_name):
    animation_type = resolve_image_animation(animation_name)
    if animation_type:
        segment.add_animation(animation_type)


def apply_camera_motion(segment, image_area, image_layout, duration):
    motion = str(image_area.get("motion") or "").strip()
    if not motion:
        return False
    if motion not in ("zoom_in", "zoom_out", "zoom_pan_up", "zoom_pan_down", "pan_left", "pan_right"):
        raise ValueError(f"Unknown camera motion: {motion}")
    duration = max(1, int(duration or 0))
    strength = clamp_number(image_area.get("motionStrength"), 1, 0, 2)
    if strength <= 0:
        return False
    base_scale = float(image_layout.get("scale") or 1)
    base_y = float(image_layout.get("transform_y") or 0)
    motion_scale = base_scale * (1 + strength * 0.08)
    pan = strength * 0.04
    keyframe = draft.KeyframeProperty

    if motion == "zoom_in":
        scale_start, scale_end = base_scale, motion_scale
    elif motion == "zoom_out":
        scale_start, scale_end = motion_scale, base_scale
    else:
        scale_start, scale_end = (base_scale, motion_scale) if motion.startswith("zoom_") else (motion_scale, motion_scale)
    segment.add_keyframe(keyframe.uniform_scale, 0, scale_start)
    segment.add_keyframe(keyframe.uniform_scale, duration, scale_end)

    if motion in ("zoom_pan_up", "zoom_pan_down"):
        direction = 1 if motion == "zoom_pan_up" else -1
        segment.add_keyframe(keyframe.position_y, 0, base_y - direction * pan)
        segment.add_keyframe(keyframe.position_y, duration, base_y + direction * pan)
    elif motion in ("pan_left", "pan_right"):
        direction = -1 if motion == "pan_left" else 1
        segment.add_keyframe(keyframe.position_x, 0, -direction * pan)
        segment.add_keyframe(keyframe.position_x, duration, direction * pan)
    return True


def resolve_image_layout(image_area, canvas, material):
    canvas_width = max(1.0, float(canvas.get("width", 1080) or 1080))
    canvas_height = max(1.0, float(canvas.get("height", 1920) or 1920))
    desired_ratio = ratio_to_number(image_area.get("ratio"), canvas_width / canvas_height)
    default_height = clamp_number(canvas_width / desired_ratio / canvas_height, 1.0, 0.05, 1.0)
    area_height = clamp_number(image_area.get("height"), default_height, 0.05, 1.0)
    area_top = clamp_number(image_area.get("top"), (1 - area_height) / 2, -1.0, 1.0)
    area_width_px = canvas_width
    area_height_px = canvas_height * area_height
    material_width = max(1.0, float(getattr(material, "width", canvas_width) or canvas_width))
    material_height = max(1.0, float(getattr(material, "height", canvas_height) or canvas_height))
    scale_x = area_width_px / material_width
    scale_y = area_height_px / material_height
    scale = min(scale_x, scale_y) if image_area.get("fit") == "contain" else max(scale_x, scale_y)
    if scale <= 0:
        scale = 1.0
    visible_width = material_width * scale
    visible_height = material_height * scale
    mask_width = clamp_number(area_width_px / visible_width, 1.0, 0.01, 1.0)
    mask_height = clamp_number(area_height_px / visible_height, 1.0, 0.01, 1.0)
    return {
        "scale": scale,
        "transform_y": area_top * 2 + area_height - 1,
        "mask_width": mask_width,
        "mask_height": mask_height,
        "use_mask": mask_width < 0.999 or mask_height < 0.999,
    }


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


def patch_meta(meta_path, payload, draft_dir, duration, background_path, frame_overlay_path, image_paths, cover_image_path, narration_paths, bgm_path):
    try:
        with open(meta_path, "r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except FileNotFoundError:
        meta = {}
    meta.update({
        "draft_cover": cover_image_path or (image_paths[0] if image_paths else ""),
        "draft_fold_path": draft_dir,
        "draft_name": payload["title"],
        "draft_root_path": os.path.dirname(draft_dir),
        "tm_duration": duration,
    })
    meta["draft_materials"] = [
        {"type": 0, "value": [background_path] + ([frame_overlay_path] if frame_overlay_path else []) + image_paths},
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


def wrap_caption_text(text, max_chars_per_line):
    text = str(text or "").strip()
    max_chars = int(clamp_number(max_chars_per_line, 0, 0, 200))
    if not text or max_chars <= 0:
        return text
    wrapped = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        wrapped.extend(line[index:index + max_chars] for index in range(0, len(line), max_chars))
    return "\n".join(wrapped)


def resolve_caption_chars_per_line(caption, canvas):
    caption = caption or {}
    canvas = canvas or {}
    canvas_width = clamp_number(canvas.get("width"), 1080, 1, 10000)
    text_width = clamp_number(caption.get("width"), 0.8, 0.1, 2.0)
    font_size = clamp_number(caption.get("fontSize"), 12, 1, 200)
    letter_spacing = clamp_number(caption.get("letterSpacing"), 0, 0, 100)
    estimated_char_width = max(1.0, font_size * 3.2 + letter_spacing)
    width_limit = int(clamp_number(round((canvas_width * text_width) / estimated_char_width), 12, 6, 24))
    configured_limit = int(clamp_number(caption.get("maxCharsPerLine"), 12, 6, 24))
    return min(width_limit, configured_limit)


def split_caption_text(text, chars_per_line):
    text = str(text or "").strip()
    if not text:
        return []
    line_chars = int(clamp_number(chars_per_line, 12, 6, 24))
    max_chars = line_chars
    min_chars = max(1, line_chars - 2)
    punctuation = set("，。！？；、,.!?;:")
    cues = []

    def push_piece(piece):
        piece = re.sub(r"[，。！？；、：,.!?;:]", "", str(piece or "")).strip()
        if not piece:
            return
        while len(piece) > max_chars:
            cues.append(piece[:max_chars])
            piece = piece[max_chars:].strip()
        if piece:
            cues.append(piece)

    for raw_line in re.split(r"\r?\n+", text):
        line = raw_line.strip()
        if not line:
            continue
        units = []
        start = 0
        for index, char in enumerate(line):
            if char in punctuation:
                units.append(line[start:index + 1].strip())
                start = index + 1
        if start < len(line):
            units.append(line[start:].strip())

        current = ""
        for unit in [item for item in units if item]:
            if len(unit) > max_chars:
                if current:
                    push_piece(current)
                    current = ""
                push_piece(unit)
                continue
            candidate = f"{current}{unit}" if current else unit
            if len(candidate) <= max_chars:
                current = candidate
                continue
            if current:
                push_piece(current)
            current = unit
        if current:
            push_piece(current)

    if len(cues) <= 1:
        return cues

    balanced = []
    for cue in cues:
        if balanced and len(balanced[-1]) < min_chars and len(balanced[-1]) + len(cue) <= max_chars:
            balanced[-1] = balanced[-1] + cue
        else:
            balanced.append(cue)
    for index in range(1, len(balanced)):
        if balanced[index].startswith("的") and balanced[index - 1]:
            prefix = balanced[index - 1][-1]
            balanced[index - 1] = balanced[index - 1][:-1]
            balanced[index] = prefix + balanced[index]
    return balanced


def subtitle_text_weight(text):
    compact = re.sub(r"\s+", "", str(text or ""))
    return max(1, len(compact))


def distribute_subtitle_durations(total_duration, cue_texts):
    cue_count = len(cue_texts)
    if cue_count == 0:
        return []
    total_duration = max(1, int(total_duration or 0))
    if cue_count == 1:
        return [total_duration]
    minimum_duration = 800000
    weights = [subtitle_text_weight(text) for text in cue_texts]
    weight_total = max(1, sum(weights))
    if total_duration >= minimum_duration * cue_count:
        remaining = total_duration - minimum_duration * cue_count
        durations = [minimum_duration + int(round(remaining * weight / weight_total)) for weight in weights]
    else:
        durations = [max(1, int(round(total_duration * weight / weight_total))) for weight in weights]
    delta = total_duration - sum(durations)
    durations[-1] = max(1, durations[-1] + delta)
    return durations


def expand_timed_subtitles(timeline, caption_config=None, canvas_config=None):
    expanded = []
    chars_per_line = resolve_caption_chars_per_line(caption_config, canvas_config)
    for item in timeline:
        supplied_captions = [str(text or "").strip() for text in (item.get("captions") or []) if str(text or "").strip()]
        cue_texts = supplied_captions or split_caption_text(item.get("text"), chars_per_line)
        if not cue_texts:
            continue
        supplied_durations = [max(1, int(value or 0)) for value in (item.get("captionDurationsUs") or [])]
        if supplied_captions and len(supplied_durations) == len(cue_texts):
            durations = supplied_durations
            durations[-1] = max(1, durations[-1] + int(item["durationUs"]) - sum(durations))
        else:
            durations = distribute_subtitle_durations(int(item["durationUs"]), cue_texts)
        cursor = int(item["startUs"])
        for text, duration in zip(cue_texts, durations):
            expanded.append({
                "startUs": cursor,
                "durationUs": int(duration),
                "text": text if supplied_captions else wrap_caption_text(text, chars_per_line),
            })
            cursor += int(duration)
    return expanded


def write_timed_subtitles(path, timeline, caption_config=None, canvas_config=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    blocks = []
    for index, item in enumerate(expand_timed_subtitles(timeline, caption_config, canvas_config), start=1):
        start = int(item["startUs"])
        end = start + int(item["durationUs"])
        text = str(item.get("text") or "").strip()
        blocks.append(f"{index}\n{format_srt_time(start)} --> {format_srt_time(end)}\n{text}\n")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(blocks))


def text_border_from_config(config):
    border = config.get("border") or {}
    width = float(border.get("width", 0) or 0)
    alpha = float(border.get("alpha", 0) or 0)
    if width <= 0 or alpha <= 0:
        return None
    return draft.TextBorder(
        color=color_to_rgb(border.get("color", "#000000")),
        width=width,
        alpha=alpha,
    )


def text_style_from_config(config, default_size=8):
    return draft.TextStyle(
        size=float(config.get("fontSize", default_size)),
        color=color_to_rgb(config.get("color", "#ffffff")),
        alpha=float(config.get("alpha", 1) or 1),
        bold=bool(config.get("bold", False)),
        underline=bool(config.get("underline", False)),
        align=int(config.get("align", 1)),
        letter_spacing=int(config.get("letterSpacing", 0) or 0),
        line_spacing=int(config.get("lineSpacing", 0) or 0),
        auto_wrapping=True,
        max_line_width=clamp_number(config.get("width"), 0.8, 0.1, 2.0),
    )


def text_background_from_config(config):
    background = config.get("background") or {}
    alpha = clamp_number(background.get("alpha", 0), 0, 0, 1)
    background_factory = getattr(draft, "TextBackground", None)
    if alpha <= 0 or not background_factory:
        return None
    return draft.TextBackground(
        color=str(background.get("color") or "#000000"),
        alpha=alpha,
        round_radius=clamp_number(background.get("roundRadius", 0), 0, 0, 1),
        height=0.16,
        width=0.88,
    )


def add_overlay_text(script, name, config, duration):
    if not config or not config.get("visible", True):
        return
    text = str(config.get("text") or "").strip()
    if not text:
        return
    start = max(0, int(config.get("startUs") or 0))
    segment_duration = max(1, int(config.get("durationUs") or duration or 0))
    script.add_track(draft.TrackType.text, name)
    segment = draft.TextSegment(
        text,
        draft.Timerange(start, segment_duration),
        style=text_style_from_config(config),
        border=text_border_from_config(config),
        clip_settings=draft.ClipSettings(
            transform_x=float(config.get("x", 0) or 0),
            transform_y=editor_text_y_to_jianying(config.get("y"), 0),
        ),
    )
    script.add_segment(segment, name)


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
    materials_dir = os.path.join(draft_dir, "materials")
    cover_page = payload.get("coverPage") or {}
    cover_page_duration = max(0, int(cover_page.get("durationUs") or 0))
    cover_page_path = None
    if cover_page_duration > 0 and cover_page.get("imagePath"):
        cover_page_path = copy_asset(cover_page["imagePath"], os.path.join(materials_dir, "cover"), "cover-page", ".png")
    frame_overlay_path = prepare_frame_overlay_asset(payload, materials_dir)
    background_track = "background_track"
    script.add_track(draft.TrackType.video, background_track)
    script.add_track(draft.TrackType.video, "images")
    if frame_overlay_path:
        script.add_track(draft.TrackType.video, "frame_overlay")
    script.add_track(draft.TrackType.audio, "narration")

    scenes = payload.get("scenes") or []
    durations = {int(scene["sceneId"]): int(scene["durationUs"]) for scene in scenes}
    image_by_scene = {
        int(item["sceneId"]): copy_asset(item["path"], os.path.join(materials_dir, "images"), str(int(item["sceneId"])).zfill(3), ".png")
        for item in payload["images"]
    }
    audio_items_by_scene = {}
    for index, item in enumerate(payload["narration"]):
        scene_id = int(item["sceneId"])
        turn_index = int(item.get("turnIndex") or (len(audio_items_by_scene.get(scene_id, [])) + 1))
        speaker = str(item.get("speaker") or "").strip()
        stem = f"{str(scene_id).zfill(3)}-{str(turn_index).zfill(3)}"
        if speaker:
            stem = f"{stem}-{speaker}"
        copied_path = copy_asset(item["path"], os.path.join(materials_dir, "narration"), stem, ".mp3")
        audio_items_by_scene.setdefault(scene_id, []).append({
            "sceneId": scene_id,
            "path": copied_path,
            "material": draft.AudioMaterial(copied_path),
            "turnIndex": turn_index,
            "speaker": speaker,
            "text": item.get("text", ""),
            "sourceIndex": index,
        })
    for scene_id, items in audio_items_by_scene.items():
        items.sort(key=lambda item: (int(item.get("turnIndex") or 0), int(item.get("sourceIndex") or 0)))
    volumes = payload.get("volumes") or {}
    effects = payload.get("effects") or {}
    image_area = payload.get("imageArea") or {}
    timeline = []
    cursor = cover_page_duration
    for scene in scenes:
        scene_id = int(scene["sceneId"])
        planned_duration = int(durations.get(scene_id, 0))
        audio_items = audio_items_by_scene.get(scene_id) or []
        if not audio_items:
            raise ValueError(f"Missing narration asset for scene {scene_id}")
        audio_duration = sum(int(item["material"].duration) for item in audio_items)
        scene_duration = max(planned_duration, audio_duration)
        timeline.append({
            "sceneId": scene_id,
            "startUs": cursor,
            "durationUs": scene_duration,
            "audioDurationUs": audio_duration,
            "text": scene.get("text", ""),
            "captions": scene.get("captions") or [],
            "captionDurationsUs": scene.get("captionDurationsUs") or [],
        })
        cursor += scene_duration
    total_duration = max(cursor, int(payload.get("totalDurationUs") or 0))
    subtitle_path = os.path.join(materials_dir, "subtitles", "subtitles.srt")
    caption = payload.get("caption") or {}
    write_timed_subtitles(subtitle_path, timeline, caption, payload.get("canvas") or {})
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
    body_duration = max(0, total_duration - cover_page_duration)
    if frame_overlay_path and body_duration > 0:
        frame_material = draft.VideoMaterial(frame_overlay_path)
        frame_segment = draft.VideoSegment(
            frame_material,
            draft.Timerange(cover_page_duration, body_duration),
            source_timerange=draft.Timerange(0, body_duration),
            clip_settings=draft.ClipSettings(scale_x=1.0, scale_y=1.0),
        )
        script.add_segment(frame_segment, "frame_overlay")

    if cover_page_path:
        cover_material = draft.VideoMaterial(cover_page_path)
        cover_layout = resolve_image_layout(
            {"visible": True, "ratio": "original", "top": 0, "height": 1, "fit": "cover"},
            payload.get("canvas") or {},
            cover_material,
        )
        cover_segment = draft.VideoSegment(
            cover_material,
            draft.Timerange(0, cover_page_duration),
            source_timerange=draft.Timerange(0, cover_page_duration),
            clip_settings=draft.ClipSettings(
                scale_x=cover_layout["scale"],
                scale_y=cover_layout["scale"],
                transform_y=cover_layout["transform_y"],
            ),
        )
        script.add_segment(cover_segment, "images")

    for index, scene in enumerate(timeline):
        scene_id = int(scene["sceneId"])
        start = int(scene["startUs"])
        duration = int(scene["durationUs"])
        audio_duration = int(scene["audioDurationUs"])
        image_material = draft.VideoMaterial(image_by_scene[scene_id])
        audio_items = audio_items_by_scene[scene_id]
        image_height = clamp_number(image_area.get("height"), 1, 0, 1)
        if image_area.get("visible", True) and image_height > 0:
            image_layout = resolve_image_layout(image_area, payload.get("canvas") or {}, image_material)
            image_segment = draft.VideoSegment(
                image_material,
                draft.Timerange(start, duration),
                source_timerange=draft.Timerange(0, duration),
                clip_settings=draft.ClipSettings(
                    scale_x=image_layout["scale"],
                    scale_y=image_layout["scale"],
                    transform_y=image_layout["transform_y"],
                ),
            )
            if image_layout["use_mask"] and hasattr(image_segment, "add_mask") and getattr(draft, "MaskType", None):
                image_segment.add_mask(
                    draft.MaskType.矩形,
                    size=image_layout["mask_height"],
                    rect_width=image_layout["mask_width"],
                )
            if not apply_camera_motion(image_segment, image_area, image_layout, duration):
                apply_image_animation(image_segment, image_area.get("animation"))
            if filter_type:
                image_segment.add_filter(filter_type)
            if video_effect_type:
                image_segment.add_effect(video_effect_type)
            if index < len(timeline) - 1 and transition_type and transition_duration > 0:
                image_segment.add_transition(transition_type, duration=clamp_effect_duration(transition_duration, duration))
            script.add_segment(image_segment, "images")

        turn_cursor = 0
        for audio_item in audio_items:
            turn_duration = int(audio_item["material"].duration)
            audio_segment = draft.AudioSegment(
                audio_item["material"],
                draft.Timerange(start + turn_cursor, turn_duration),
                source_timerange=draft.Timerange(0, turn_duration),
                volume=float(volumes.get("narration", 1.0)),
            )
            if narration_fade_in > 0 or narration_fade_out > 0:
                audio_segment.add_fade(
                    clamp_effect_duration(narration_fade_in, turn_duration),
                    clamp_effect_duration(narration_fade_out, turn_duration),
                )
            if audio_effect_type:
                audio_segment.add_effect(audio_effect_type)
            script.add_segment(audio_segment, "narration")
            turn_cursor += turn_duration

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

    if caption.get("visible", True):
        caption_style = draft.TextStyle(
            size=float(caption.get("fontSize", 8)),
            color=color_to_rgb(caption.get("color", "#ffffff")),
            alpha=float(caption.get("alpha", 1) or 1),
            bold=bool(caption.get("bold", False)),
            underline=bool(caption.get("underline", False)),
            align=int(caption.get("align", 1)),
            letter_spacing=int(caption.get("letterSpacing", 0) or 0),
            line_spacing=int(caption.get("lineSpacing", 0) or 0),
            auto_wrapping=True,
            max_line_width=clamp_number(caption.get("width"), 0.8, 0.1, 2.0),
        )
        caption_clip_settings = draft.ClipSettings(transform_x=float(caption.get("x", 0)), transform_y=editor_text_y_to_jianying(caption.get("y"), -0.8))
        caption_background = text_background_from_config(caption)
        caption_border = text_border_from_config(caption)
        if caption_background or caption_border:
            caption_template = draft.TextSegment(
                "字幕预览",
                draft.Timerange(0, 1),
                style=caption_style,
                clip_settings=caption_clip_settings,
                border=caption_border,
                background=caption_background,
            )
            script.import_srt(
                subtitle_path,
                track_name="subtitles",
                style_reference=caption_template,
                clip_settings=caption_clip_settings,
            )
        else:
            script.import_srt(
                subtitle_path,
                track_name="subtitles",
                text_style=caption_style,
                clip_settings=caption_clip_settings,
            )

    overlays = payload.get("overlays") or {}
    add_overlay_text(script, "cover_title", cover_page.get("title"), cover_page_duration)
    add_overlay_text(script, "title", overlays.get("title"), total_duration)
    add_overlay_text(script, "subtitle", overlays.get("subtitle"), total_duration)
    add_overlay_text(script, "disclaimer", overlays.get("disclaimer"), total_duration)

    script.save()
    content_path = os.path.join(draft_dir, "draft_content.json")
    meta_path = os.path.join(draft_dir, "draft_meta_info.json")
    copied_images = [image_by_scene[int(scene["sceneId"])] for scene in scenes]
    copied_narration = [item["path"] for scene in scenes for item in audio_items_by_scene[int(scene["sceneId"])]]
    cover_image_path = cover_page_path or norm(payload.get("coverImagePath") or "")
    patch_meta(meta_path, payload, draft_dir, script.duration, background_path, frame_overlay_path, copied_images, cover_image_path, copied_narration, bgm_path)
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
