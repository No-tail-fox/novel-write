import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPyJianYingDraftBridge, writePyJianYingBridgeInput, writePyJianYingBridgeScript, type PyJianYingBridgeInput } from '@shared/jianying-bridge';

function defaultBridgeImageArea(animation = '') {
  return { visible: true, ratio: '9:16', top: 0, height: 1, fit: 'cover' as const, animation, motion: '' as const, motionStrength: 1 };
}

function defaultBridgeCaption() {
  return {
    visible: true,
    fontSize: 44,
    fontFamily: '宋体' as const,
    color: '#ffffff',
    alpha: 1,
    border: { color: '#000000', width: 0, alpha: 0 },
    bold: false,
    underline: false,
    align: 1,
    letterSpacing: 0,
    lineSpacing: 0,
    maxCharsPerLine: 12,
    width: 0.8,
    background: { color: '#000000', alpha: 0.5, roundRadius: 0.3 },
    y: -0.8,
  };
}

describe('pyJianYingDraft bridge input', () => {
  it('writes a self-contained bridge payload for Python draft generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-bridge-'));

    try {
      const payloadPath = await writePyJianYingBridgeInput({
        workDir: dir,
        draftDir: join(dir, 'Draft Root', 'Bridge Draft'),
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#123456', backgroundImage: join(dir, 'background.png') },
        imageArea: { visible: true, ratio: '4:3', top: 0, height: 1280, fit: 'cover', animation: '缩放' },
        frame: {
          enabled: true,
          headerColor: '#112233',
          headerColorEnd: '#334455',
          footerColor: '#556677',
          footerColorEnd: '#778899',
          imageBorderColor: '#abcdef',
          imageBorderWidth: 12,
          imageBorderSides: 'horizontal',
        },
        caption: {
          visible: true,
          fontSize: 44,
          fontFamily: '圆体',
          color: '#ffffff',
          alpha: 0.85,
          border: { color: '#ff0000', width: 4, alpha: 0.7 },
          bold: true,
          underline: false,
          align: 2,
          letterSpacing: 3,
          lineSpacing: 2,
          maxCharsPerLine: 18,
          width: 0.72,
          background: { color: '#111111', alpha: 0.4, roundRadius: 0.5 },
          x: 0.2,
          y: 1480,
        },
        overlays: {
          title: { visible: true, text: 'Bridge Draft', x: -0.1, y: -0.5, width: 0.88, fontSize: 44, fontFamily: '得意黑', color: '#ffde00', alpha: 0.95, bold: true, underline: true, align: 1, letterSpacing: 2, lineSpacing: 3, border: { color: '#000000', width: 3, alpha: 0.8 } },
          subtitle: { visible: true, text: 'Bridge Subtitle', x: 0, y: -0.35, width: 0.76, fontSize: 22, fontFamily: 'LXGWWenKai_Regular', color: '#ffffff', alpha: 0.75, bold: false, underline: false, align: 2, letterSpacing: 4, lineSpacing: 5, border: { color: '#333333', width: 1, alpha: 0.5 } },
          disclaimer: { visible: true, text: 'Disclaimer', x: 0, y: 0.9, width: 0.62, fontSize: 14, fontFamily: 'HarmonyOS_Sans_SC_Regular', color: '#cccccc', alpha: 0.6, bold: false, underline: true, align: 0, letterSpacing: 1, lineSpacing: 6, border: { color: '#111111', width: 2, alpha: 0.6 } },
        },
        images: [{ sceneId: 1, path: join(dir, 'image.png') }],
        narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
        subtitlesSrtPath: join(dir, 'subtitles.srt'),
        bgm: null,
      });
      const payload = JSON.parse(await readFile(payloadPath, 'utf8'));

      expect(payload.title).toBe('Bridge Draft');
      expect(payload.draftDir).toContain('Bridge Draft');
      expect(payload.images[0]).toMatchObject({ sceneId: 1, path: join(dir, 'image.png') });
      expect(payload.narration[0]).toMatchObject({ sceneId: 1, path: join(dir, 'voice.mp3') });
      expect(payload.canvas).toEqual({ width: 1080, height: 1920, backgroundColor: '#123456', backgroundImage: join(dir, 'background.png') });
      expect(payload.imageArea).toMatchObject({ visible: true });
      expect(payload.frame).toMatchObject({ enabled: true, imageBorderWidth: 12, imageBorderSides: 'horizontal' });
      expect(payload.caption).toMatchObject({
        visible: true,
        fontFamily: '圆体',
        x: 0.2,
        y: 1480,
        alpha: 0.85,
        bold: true,
        border: { color: '#ff0000', width: 4, alpha: 0.7 },
        underline: false,
        align: 2,
        letterSpacing: 3,
        lineSpacing: 2,
        maxCharsPerLine: 18,
        width: 0.72,
        background: { color: '#111111', alpha: 0.4, roundRadius: 0.5 },
      });
      expect(payload.overlays.title).toMatchObject({ x: -0.1, y: -0.5, width: 0.88, fontFamily: '得意黑', alpha: 0.95, bold: true, underline: true, align: 1, letterSpacing: 2, lineSpacing: 3, border: { color: '#000000', width: 3, alpha: 0.8 } });
      expect(payload.overlays.subtitle).toMatchObject({ text: 'Bridge Subtitle', width: 0.76, fontFamily: 'LXGWWenKai_Regular', alpha: 0.75, bold: false, underline: false, align: 2, letterSpacing: 4, lineSpacing: 5, border: { color: '#333333', width: 1, alpha: 0.5 } });
      expect(payload.overlays.disclaimer).toMatchObject({ fontSize: 14, fontFamily: 'HarmonyOS_Sans_SC_Regular', color: '#cccccc', width: 0.62, alpha: 0.6, bold: false, underline: true, align: 0, letterSpacing: 1, lineSpacing: 6, border: { color: '#111111', width: 2, alpha: 0.6 } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes the Python bridge script with the pyJianYingDraft draft API path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-script-'));

    try {
      const scriptPath = await writePyJianYingBridgeScript(dir);
      const script = await readFile(scriptPath, 'utf8');

      expect(script).toContain('DraftFolder');
      expect(script).toContain('sys.stdout.reconfigure(encoding="utf-8"');
      expect(script).toContain('sys.stderr.reconfigure(encoding="utf-8"');
      expect(script).toContain('VideoSegment');
      expect(script).toContain('video_by_scene = {}');
      expect(script).toContain('source_start = int(video_item["trimStartUs"]) if video_item else 0');
      expect(script).toContain('volume=0.0 if video_item else 1.0');
      expect(script).toContain('if not video_item:');
      expect(script).toContain('AudioSegment');
      expect(script).toContain('shutil.copy2');
      expect(script).toContain('create_solid_png');
      expect(script).toContain('background_track');
      expect(script).toContain('import_srt');
      expect(script).toContain('border = config.get("border") or {}');
      expect(script).toContain('caption_border = text_border_from_config(caption)');
      expect(script).toContain('border=caption_border');
      expect(script).toContain('def font_from_config(config)');
      expect(script).toContain('font_catalog = getattr(draft, "FontType", None)');
      expect(script).toContain('def text_segment_from_config(text, timerange, config, **kwargs)');
      expect(script).toContain('kwargs["font"] = font');
      expect(script).toContain('segment = text_segment_from_config(');
      expect(script).toContain('caption_template = text_segment_from_config(');
      expect(script).toContain('def add_overlay_text');
      expect(script).toContain('config.get("startUs")');
      expect(script).toContain('config.get("durationUs")');
      expect(script).toContain('cover_page = payload.get("coverPage") or {}');
      expect(script).toContain('cursor = cover_page_duration');
      expect(script).toContain('add_overlay_text(script, "cover_title"');
      expect(script).toContain('draft.TextSegment(');
      expect(script).toContain('draft.TrackType.text');
      expect(script).toContain('add_overlay_text(script, "title"');
      expect(script).toContain('add_overlay_text(script, "subtitle"');
      expect(script).toContain('add_overlay_text(script, "disclaimer"');
      expect(script).toContain('script.save()');
      expect(script).toContain('image_area.get("visible", True)');
      expect(script).toContain('caption.get("visible", True)');
      expect(script).toContain('draft.TextBackground(');
      expect(script).toContain('style_reference=caption_template');
      expect(script).not.toContain('text_style=caption_style');
      expect(script).toContain('wrap_caption_text');
      expect(script).toContain('normalize_subtitle_text');
      expect(script).toContain('resolve_image_layout');
      expect(script).toContain('image_segment.add_mask(');
      expect(script).toContain('align=int(caption.get("align", 1))');
      expect(script).toContain('max_line_width=clamp_number(config.get("width"), 0.8, 0.1, 2.0)');
      expect(script).toContain('max_line_width=clamp_number(caption.get("width"), 0.8, 0.1, 2.0)');
      expect(script).toContain('def apply_camera_motion');
      expect(script).toContain('segment.add_keyframe(keyframe.uniform_scale');
      expect(script).toContain('segment.add_keyframe(keyframe.position_x');
      expect(script).toContain('segment.add_keyframe(keyframe.position_y');
      expect(script).toContain('strength = clamp_number(image_area.get("motionStrength"), 1, 0, 2)');
      expect(script).toContain('if strength <= 0:');
      expect(script).toContain('and image_height > 0:');
      expect(script).toContain('def create_frame_overlay_png');
      expect(script).toContain('frame-overlay.png');
      expect(script).toContain('draft.TrackType.video, "frame_overlay"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validates image animations instead of silently dropping unknown draft template values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-script-animation-'));

    try {
      const scriptPath = await writePyJianYingBridgeScript(dir);
      const script = await readFile(scriptPath, 'utf8');

      expect(script).toContain('raise ValueError(f"Unknown image animation');
      expect(script).toContain('resolve_image_animation');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes camera keyframes and a transparent frame overlay into the generated draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-motion-frame-'));
    const draftDir = join(dir, 'Draft Root', 'Motion Frame Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(1200));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Motion Frame Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: {
          visible: true,
          ratio: '4:3',
          top: 0.25,
          height: 0.5,
          fit: 'cover',
          animation: '缩放',
          motion: 'zoom_pan_up',
          motionStrength: 1.5,
        },
        frame: {
          enabled: true,
          headerColor: '#112233',
          headerColorEnd: '#334455',
          footerColor: '#556677',
          footerColorEnd: '#778899',
          imageBorderColor: '#abcdef',
          imageBorderWidth: 12,
          imageBorderSides: 'horizontal',
        },
        caption: { ...defaultBridgeCaption(), visible: false },
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'motion' }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 1_200_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      const imageSegment = content.tracks.find((track: { name: string }) => track.name === 'images').segments[0];
      const frameTrack = content.tracks.find((track: { name: string }) => track.name === 'frame_overlay');
      expect(imageSegment.keyframes).toEqual(expect.arrayContaining([
        expect.objectContaining({ property: 'UNIFORM_SCALE', time_offset: 0 }),
        expect.objectContaining({ property: 'UNIFORM_SCALE', time_offset: 1_200_000 }),
        expect.objectContaining({ property: 'KFTypePositionY', time_offset: 0 }),
        expect.objectContaining({ property: 'KFTypePositionY', time_offset: 1_200_000 }),
      ]));
      expect(frameTrack.segments).toHaveLength(1);
      const overlay = await readFile(join(draftDir, 'materials', 'frame', 'frame-overlay.png'));
      expect(overlay.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses max scale for crop-fill and min scale for full-image Jianying layout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-image-fit-'));
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(1200));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '', 'utf8');

      const render = async (fit: 'cover' | 'contain', focusY = 0.5, patch: Partial<PyJianYingBridgeInput['imageArea']> = {}) => {
        const draftDir = join(dir, 'Draft Root', `Image Fit ${fit} ${focusY} ${patch.mediaScale ?? 1}`);
        await runPyJianYingDraftBridge({
          workDir: dir,
          draftDir,
          title: `Image Fit ${fit}`,
          canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
          imageArea: {
            visible: true,
            ratio: '4:3',
            top: 0.25,
            height: 0.5,
            fit,
            focusX: 0.5,
            focusY,
            animation: '',
            motion: '',
            motionStrength: 1,
            ...patch,
          },
          caption: { ...defaultBridgeCaption(), visible: false },
          scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: fit }],
          images: [{ sceneId: 1, path: image }],
          narration: [{ sceneId: 1, path: voice }],
          subtitlesSrtPath: subtitles,
          bgm: null,
          totalDurationUs: 1_200_000,
          volumes: { narration: 1, bgm: 0.3 },
        });
        const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
        const segment = content.tracks.find((track: { name: string }) => track.name === 'images').segments[0];
        return { ...segment.clip_settings, masks: segment.masks };
      };

      expect(await render('cover')).toMatchObject({ scale_x: 1, scale_y: 1, transform_y: 0 });
      expect(await render('contain')).toMatchObject({ scale_x: 0.5, scale_y: 0.5, transform_y: 0 });
      expect(await render('cover', 0)).toMatchObject({ transform_x: 0, transform_y: 0.5 });
      expect(await render('cover', 1)).toMatchObject({ transform_x: 0, transform_y: -0.5 });
      expect(await render('contain', 0)).toMatchObject({ transform_x: 0, transform_y: 0 });
      expect(await render('cover', 0.5, { mediaScale: 0.5, focusX: 0 })).toMatchObject({
        scale_x: 0.5,
        scale_y: 0.5,
        transform_x: -0.5,
        transform_y: 0,
        masks: [],
      });
      expect(await render('cover', 0.5, { left: 0.25, width: 0.5, mediaScale: 2, focusX: 1, focusY: 0 })).toMatchObject({
        scale_x: 1,
        scale_y: 1,
        transform_x: -0.5,
        transform_y: 0.5,
        masks: [{ mask_type: 'rectangle', center_x: 270, center_y: -480, size: 0.5, rect_width: 0.5 }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps zero camera strength still and omits a zero-height image region', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-zero-motion-'));
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(1200));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '', 'utf8');

      const run = async (draftDir: string, imageArea: PyJianYingBridgeInput['imageArea']) => {
        await runPyJianYingDraftBridge({
          workDir: dir,
          draftDir,
          title: 'Zero motion draft',
          canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
          imageArea,
          caption: { ...defaultBridgeCaption(), visible: false },
          scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'still' }],
          images: [{ sceneId: 1, path: image }],
          narration: [{ sceneId: 1, path: voice }],
          subtitlesSrtPath: subtitles,
          bgm: null,
          totalDurationUs: 1_200_000,
          volumes: { narration: 1, bgm: 0.3 },
        });
        return JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      };

      const stillContent = await run(join(dir, 'Draft Root', 'Still Draft'), {
        ...defaultBridgeImageArea(),
        motion: 'zoom_in',
        motionStrength: 0,
      });
      const stillTrack = stillContent.tracks.find((track: { name: string }) => track.name === 'images');
      expect(stillTrack.segments).toHaveLength(1);
      expect(stillTrack.segments[0].keyframes).toEqual([]);

      const hiddenContent = await run(join(dir, 'Draft Root', 'Hidden Draft'), {
        ...defaultBridgeImageArea(),
        height: 0,
      });
      const hiddenTrack = hiddenContent.tracks.find((track: { name: string }) => track.name === 'images');
      expect(hiddenTrack.segments).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a partial image region clipped when decorative frame chrome is disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-crop-overlay-'));
    const draftDir = join(dir, 'Draft Root', 'Crop Overlay Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(1200));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Crop Overlay Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#101010', backgroundImage: '' },
        imageArea: { ...defaultBridgeImageArea(), top: 0.14, height: 0.64 },
        frame: {
          enabled: false,
          headerColor: '#112233',
          headerColorEnd: '#334455',
          footerColor: '#556677',
          footerColorEnd: '#778899',
          imageBorderColor: '#abcdef',
          imageBorderWidth: 12,
          imageBorderSides: 'horizontal',
        },
        caption: { ...defaultBridgeCaption(), visible: false },
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'cropped image' }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 1_200_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      const frameTrack = content.tracks.find((track: { name: string }) => track.name === 'frame_overlay');
      expect(frameTrack.segments).toHaveLength(1);
      const overlay = await readFile(join(draftDir, 'materials', 'frame', 'frame-overlay.png'));
      expect(overlay.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes the Python bridge script with audio fades, transitions, and optional effects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-script-effects-'));

    try {
      const scriptPath = await writePyJianYingBridgeScript(dir);
      const script = await readFile(scriptPath, 'utf8');

      expect(script).toContain('resolve_enum');
      expect(script).toContain('effects = payload.get("effects") or {}');
      expect(script).toContain('audio_segment.add_fade(');
      expect(script).toContain('bgm_segment.add_fade(');
      expect(script).toContain('image_segment.add_transition(');
      expect(script).toContain('image_segment.add_filter(');
      expect(script).toContain('image_segment.add_effect(');
      expect(script).toContain('audio_segment.add_effect(');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('extends scene timing to the actual narration length before starting the next segment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-audio-timing-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const firstVoice = join(dir, 'voice-1.wav');
      const secondVoice = join(dir, 'voice-2.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(firstVoice, wavTone(1800));
      await writeFile(secondVoice, wavTone(1000));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:01,000\nfirst\n', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: defaultBridgeCaption(),
        scenes: [
          { sceneId: 1, startUs: 0, durationUs: 1_000_000, text: 'first' },
          { sceneId: 2, startUs: 1_000_000, durationUs: 1_000_000, text: 'second' },
        ],
        images: [
          { sceneId: 1, path: image },
          { sceneId: 2, path: image },
        ],
        narration: [
          { sceneId: 1, path: firstVoice },
          { sceneId: 2, path: secondVoice },
        ],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 2_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      const imageSegments = content.tracks.find((track: { name: string }) => track.name === 'images').segments;
      const narrationSegments = content.tracks.find((track: { name: string }) => track.name === 'narration').segments;

      expect(imageSegments[0].target_timerange.duration).toBe(1_800_000);
      expect(imageSegments[1].target_timerange.start).toBe(1_800_000);
      expect(narrationSegments[0].target_timerange.duration).toBe(1_800_000);
      expect(narrationSegments[1].target_timerange.start).toBe(1_800_000);
      expect(content.duration).toBe(2_800_000);
      const generatedSubtitles = await readFile(join(draftDir, 'materials', 'subtitles', 'subtitles.srt'), 'utf8');
      expect(generatedSubtitles).toContain('00:00:00,000 --> 00:00:01,800');
      expect(generatedSubtitles).toContain('00:00:01,800 --> 00:00:02,800');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders a two-second cover image and title before narration, captions, and body overlays', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-jy-cover-page-'));
    const draftDir = join(dir, 'Draft Root', 'Cover Page Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const cover = join(dir, 'cover.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(1000));
      await writeFile(image, Buffer.from('image'));
      await writeFile(cover, Buffer.from('cover'));
      await writeFile(subtitles, '', 'utf8');

      const titleStyle = {
        visible: true,
        text: '正文标题',
        x: 0,
        y: -0.7,
        width: 0.8,
        fontSize: 44,
        color: '#ffffff',
        alpha: 1,
        bold: true,
        underline: false,
        align: 1,
        letterSpacing: 0,
        lineSpacing: 0,
        border: { color: '#000000', width: 3, alpha: 1 },
      };
      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Cover Page Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        frame: {
          enabled: true,
          headerColor: '#112233',
          headerColorEnd: '#334455',
          footerColor: '#556677',
          footerColorEnd: '#778899',
          imageBorderColor: '#ffffff',
          imageBorderWidth: 8,
          imageBorderSides: 'all',
        },
        caption: defaultBridgeCaption(),
        coverPage: {
          imagePath: cover,
          durationUs: 2_000_000,
          title: { ...titleStyle, text: '只在封面出现', startUs: 0, durationUs: 2_000_000 },
        },
        overlays: {
          title: { ...titleStyle, startUs: 2_000_000, durationUs: 1_000_000 },
        },
        scenes: [{ sceneId: 1, startUs: 2_000_000, durationUs: 1_000_000, text: '正文', captions: ['正文字幕'], captionDurationsUs: [1_000_000] }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 3_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      const trackByName = new Map(content.tracks.map((track: { name: string }) => [track.name, track]));
      const images = trackByName.get('images') as { segments: Array<{ target_timerange: { start: number; duration: number } }> };
      const narration = trackByName.get('narration') as { segments: Array<{ target_timerange: { start: number; duration: number } }> };
      const frameOverlay = trackByName.get('frame_overlay') as { segments: Array<{ target_timerange: { start: number; duration: number } }> };
      const coverTitle = trackByName.get('cover_title') as { segments: Array<{ target_timerange: { start: number; duration: number }; text: string }> };
      const bodyTitle = trackByName.get('title') as { segments: Array<{ target_timerange: { start: number; duration: number }; text: string }> };

      expect(images.segments.map((segment) => segment.target_timerange)).toEqual([
        { start: 0, duration: 2_000_000 },
        { start: 2_000_000, duration: 1_000_000 },
      ]);
      expect(narration.segments[0].target_timerange).toEqual({ start: 2_000_000, duration: 1_000_000 });
      expect(frameOverlay.segments[0].target_timerange).toEqual({ start: 2_000_000, duration: 1_000_000 });
      expect(coverTitle.segments[0]).toMatchObject({ text: '只在封面出现', target_timerange: { start: 0, duration: 2_000_000 } });
      expect(bodyTitle.segments[0]).toMatchObject({ text: '正文标题', target_timerange: { start: 2_000_000, duration: 1_000_000 } });
      expect(content.duration).toBe(3_000_000);
      const generatedSubtitles = await readFile(join(draftDir, 'materials', 'subtitles', 'subtitles.srt'), 'utf8');
      expect(generatedSubtitles).toContain('00:00:02,000 --> 00:00:03,000');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lays multiple narration turns for one scene consecutively on the audio timeline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-dual-voice-timing-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const firstVoice = join(dir, 'voice-a.wav');
      const secondVoice = join(dir, 'voice-b.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(firstVoice, wavTone(600));
      await writeFile(secondVoice, wavTone(700));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:01,000\nscene\n', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: defaultBridgeCaption(),
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_000_000, text: 'Host A: First\nHost B: Second' }],
        images: [{ sceneId: 1, path: image }],
        narration: [
          { sceneId: 1, path: firstVoice, speaker: 'A', turnIndex: 1, text: 'First' },
          { sceneId: 1, path: secondVoice, speaker: 'B', turnIndex: 2, text: 'Second' },
        ],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 1_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      const imageSegments = content.tracks.find((track: { name: string }) => track.name === 'images').segments;
      const narrationSegments = content.tracks.find((track: { name: string }) => track.name === 'narration').segments;

      expect(narrationSegments).toHaveLength(2);
      expect(narrationSegments[0].target_timerange).toMatchObject({ start: 0, duration: 600_000 });
      expect(narrationSegments[1].target_timerange).toMatchObject({ start: 600_000, duration: 700_000 });
      expect(imageSegments[0].target_timerange.duration).toBe(1_300_000);
      expect(content.duration).toBe(1_300_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('splits a long scene caption into sequential SRT cues without splitting the narration audio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-subtitle-split-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');
    const longCaption = '他慢慢打开他的眼界。有人曾用学成本领，改变国家来激励他。这样的提醒，让他明白，读书不只是为了个人前程。';

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(8000));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: { ...defaultBridgeCaption(), maxCharsPerLine: 18 },
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 8_000_000, text: longCaption }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 8_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const generatedSubtitles = await readFile(join(draftDir, 'materials', 'subtitles', 'subtitles.srt'), 'utf8');
      const cueBlocks = generatedSubtitles.trim().split(/\r?\n\r?\n/);
      const cueTexts = cueBlocks.map((block) => block.split(/\r?\n/).slice(2).join(''));
      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      const narrationSegments = content.tracks.find((track: { name: string }) => track.name === 'narration').segments;

      expect(cueBlocks.length).toBeGreaterThan(1);
      expect(cueTexts.every((text) => text.length <= 18)).toBe(true);
      expect(cueBlocks[0]).toContain('00:00:00,000 -->');
      expect(cueBlocks.at(-1)).toContain('--> 00:00:08,000');
      expect(generatedSubtitles).not.toContain(`\n${longCaption}\n`);
      expect(narrationSegments).toHaveLength(1);
      expect(narrationSegments[0].target_timerange).toMatchObject({ start: 0, duration: 8_000_000 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses caption box width to keep each subtitle cue within two rendered lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-subtitle-width-split-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');
    const longCaption = '他慢慢打开眼界有人曾用学成本领改变国家来激励他这样的提醒让他明白读书不只是为了个人前程';

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(8000));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: { ...defaultBridgeCaption(), width: 0.32, fontSize: 12, maxCharsPerLine: 80 },
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 8_000_000, text: longCaption }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 8_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const generatedSubtitles = await readFile(join(draftDir, 'materials', 'subtitles', 'subtitles.srt'), 'utf8');
      const cueBlocks = generatedSubtitles.trim().split(/\r?\n\r?\n/);
      const cueLines = cueBlocks.map((block) => block.split(/\r?\n/).slice(2));

      expect(cueBlocks.length).toBeGreaterThan(1);
      expect(cueLines.every((lines) => lines.length <= 2)).toBe(true);
      expect(cueLines.flat().every((line) => line.length <= 10)).toBe(true);
      expect(cueBlocks.at(-1)).toContain('--> 00:00:08,000');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves supplied storyboard caption lines without splitting them again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-exact-captions-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(2400));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Exact caption draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: { ...defaultBridgeCaption(), maxCharsPerLine: 6 },
        scenes: [{
          sceneId: 1,
          startUs: 0,
          durationUs: 2_400_000,
          text: '这段原文不应覆盖手动字幕',
          captions: ['手动第一行，保留标点', '手动第二行'],
          captionDurationsUs: [900_000, 1_500_000],
        }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 2_400_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const generated = await readFile(join(draftDir, 'materials', 'subtitles', 'subtitles.srt'), 'utf8');
      const blocks = generated.trim().split(/\r?\n\r?\n/);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toContain('00:00:00,000 --> 00:00:00,900');
      expect(blocks[1]).toContain('00:00:00,900 --> 00:00:02,400');
      expect(generated).toMatch(/\r?\n手动第一行，保留标点\r?\n/u);
      expect(generated).toMatch(/\r?\n手动第二行\r?\n?/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes BOM, CRLF, and blank lines from caption text before writing SRT cues', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-clean-srt-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      await writeFile(voice, wavTone(1200));
      await writeFile(image, Buffer.from('image'));

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Clean SRT draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: defaultBridgeCaption(),
        scenes: [{
          sceneId: 1,
          startUs: 0,
          durationUs: 1_200_000,
          text: 'fallback',
          captions: ['\ufeff第一行\r\n\r\n第二行'],
          captionDurationsUs: [1_200_000],
        }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: join(dir, 'subtitles.srt'),
        bgm: null,
        totalDurationUs: 1_200_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const generated = await readFile(join(draftDir, 'materials', 'subtitles', 'subtitles.srt'), 'utf8');
      expect(generated.replace(/\r\n/g, '\n')).toBe('1\n00:00:00,000 --> 00:00:01,200\n第一行\n第二行\n');
      expect(generated).not.toContain('\ufeff');
      expect(generated).not.toMatch(/第一行\r?\n\r?\n第二行/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not import subtitle text tracks when captions are hidden', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-hidden-captions-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(1000));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:01,000\nhidden\n', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: { ...defaultBridgeCaption(), visible: false },
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_000_000, text: 'hidden caption' }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 1_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));

      expect(content.tracks.some((track: { name: string }) => track.name === 'subtitles')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates a draft through the Python bridge under Chinese user and draft directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-chinese-path-'));
    const workDir = join(dir, '用户目录', '任务数据');
    const draftDir = join(dir, '剪映草稿', '李明博项目');
    const bridgeDir = join(workDir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(workDir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(workDir, '中文旁白.wav');
      const image = join(workDir, '中文图片.png');
      await writeFile(voice, wavTone(1000));
      await writeFile(image, Buffer.from('image'));

      const output = await runPyJianYingDraftBridge({
        workDir,
        draftDir,
        title: '李明博项目',
        canvas: { width: 1920, height: 1080, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: { ...defaultBridgeImageArea(), ratio: '16:9' },
        caption: { ...defaultBridgeCaption(), visible: false },
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_000_000, text: '中文目录测试' }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: join(workDir, '中文字幕.srt'),
        bgm: null,
        totalDurationUs: 1_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const meta = JSON.parse(await readFile(output.draftMetaPath, 'utf8'));
      expect(output.draftDir).toBe(draftDir);
      expect(meta).toMatchObject({ draft_name: '李明博项目', draft_fold_path: draftDir });
      expect(meta.draft_materials[0].value.every((path: string) => path.startsWith(draftDir))).toBe(true);
      expect(meta.draft_materials[1].value.every((path: string) => path.startsWith(draftDir))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('converts editor text y coordinates to Jianying upward-positive coordinates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-text-position-'));
    const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
    const bridgeDir = join(dir, 'pyjianying-bridge');

    try {
      await writePyJianYingBridgeScript(dir);
      await writeFile(join(bridgeDir, 'pyJianYingDraft.py'), fakePyJianYingDraftModule, 'utf8');
      const voice = join(dir, 'voice.wav');
      const image = join(dir, 'image.png');
      const subtitles = join(dir, 'subtitles.srt');
      await writeFile(voice, wavTone(1000));
      await writeFile(image, Buffer.from('image'));
      await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:01,000\ncaption\n', 'utf8');

      await runPyJianYingDraftBridge({
        workDir: dir,
        draftDir,
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
        imageArea: defaultBridgeImageArea(),
        caption: { ...defaultBridgeCaption(), x: 0.15, y: 0.63 },
        overlays: {
          title: { visible: true, text: 'Title', x: -0.2, y: -0.72, width: 0.88, fontSize: 44, color: '#ffde00', alpha: 1, bold: true, underline: true, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: '#000000', width: 3, alpha: 1 } },
          subtitle: { visible: true, text: 'Subtitle', x: 0, y: -0.35, width: 0.76, fontSize: 22, color: '#ffffff', alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: '#000000', width: 3, alpha: 1 } },
          disclaimer: { visible: true, text: 'Disclaimer', x: 0, y: -0.9, width: 0.62, fontSize: 14, color: '#cccccc', alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: '#000000', width: 3, alpha: 1 } },
        },
        scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_000_000, text: 'caption' }],
        images: [{ sceneId: 1, path: image }],
        narration: [{ sceneId: 1, path: voice }],
        subtitlesSrtPath: subtitles,
        bgm: null,
        totalDurationUs: 1_000_000,
        volumes: { narration: 1, bgm: 0.3 },
      });

      const content = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
      const trackByName = new Map(content.tracks.map((track: { name: string }) => [track.name, track]));
      const subtitlesTrack = trackByName.get('subtitles') as { segments: Array<{ clip_settings: Record<string, number> }> };
      const titleTrack = trackByName.get('title') as { segments: Array<{ clip_settings: Record<string, number> }> };
      const subtitleTrack = trackByName.get('subtitle') as { segments: Array<{ clip_settings: Record<string, number> }> };
      const disclaimerTrack = trackByName.get('disclaimer') as { segments: Array<{ clip_settings: Record<string, number> }> };

      expect(subtitlesTrack.segments[0].clip_settings).toMatchObject({ transform_x: 0.15, transform_y: -0.63 });
      expect(titleTrack.segments[0].clip_settings).toMatchObject({ transform_x: -0.2, transform_y: 0.72 });
      expect(subtitleTrack.segments[0].clip_settings).toMatchObject({ transform_x: 0, transform_y: 0.35 });
      expect(disclaimerTrack.segments[0].clip_settings).toMatchObject({ transform_x: 0, transform_y: 0.9 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('executes Python with the bridge script and parses the generated draft paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-run-'));
    const calls: Array<{ command: string; args: string[]; cwd?: string; pythonIoEncoding?: string; pythonUtf8?: string }> = [];

    try {
      const draftDir = join(dir, '中文用户', '剪映草稿', '李明博');
      const output = await runPyJianYingDraftBridge(
        {
          workDir: dir,
          draftDir,
          title: 'Bridge Draft',
          canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
          imageArea: defaultBridgeImageArea('缩放'),
          caption: defaultBridgeCaption(),
          scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'hello' }],
          images: [{ sceneId: 1, path: join(dir, 'image.png') }],
          narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
          subtitlesSrtPath: join(dir, 'subtitles.srt'),
          bgm: null,
          totalDurationUs: 1_200_000,
          volumes: { narration: 1, bgm: 0.3 },
        },
        {
          pythonCommand: 'python-test',
          execute: async (command, args, options) => {
            calls.push({
              command,
              args,
              cwd: options.cwd,
              pythonIoEncoding: options.env.PYTHONIOENCODING,
              pythonUtf8: options.env.PYTHONUTF8,
            });
            return {
              stdout: JSON.stringify({
                ok: true,
                draftDir,
                draftContentPath: join(draftDir, 'draft_content.json'),
                draftMetaPath: join(draftDir, 'draft_meta_info.json'),
                durationUs: 1_200_000,
              }),
              stderr: '',
            };
          },
        },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('python-test');
      expect(calls[0].args[0]).toMatch(/pyjianying-bridge[\\/]bridge\.py$/);
      expect(calls[0].args[1]).toMatch(/pyjianying-bridge[\\/]input\.json$/);
      expect(calls[0].cwd).toBe(dir);
      expect(calls[0].pythonIoEncoding).toBe('utf-8');
      expect(calls[0].pythonUtf8).toBe('1');
      expect(output).toMatchObject({
        draftDir,
        draftContentPath: join(draftDir, 'draft_content.json'),
        draftMetaPath: join(draftDir, 'draft_meta_info.json'),
        durationUs: 1_200_000,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a clear install command when pyJianYingDraft is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-missing-'));

    try {
      const error = Object.assign(new Error('Command failed'), {
        stderr: "ModuleNotFoundError: No module named 'pyJianYingDraft'",
      });

      await expect(
        runPyJianYingDraftBridge(
          {
            workDir: dir,
            draftDir: join(dir, 'Draft Root', 'Bridge Draft'),
            title: 'Bridge Draft',
            canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
            imageArea: defaultBridgeImageArea('缩放'),
            caption: defaultBridgeCaption(),
            scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'hello' }],
            images: [{ sceneId: 1, path: join(dir, 'image.png') }],
            narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
            subtitlesSrtPath: join(dir, 'subtitles.srt'),
            bgm: null,
            totalDurationUs: 1_200_000,
            volumes: { narration: 1, bgm: 0.3 },
          },
          {
            execute: async () => {
              throw error;
            },
          },
        ),
      ).rejects.toThrow(/python -m pip install pyJianYingDraft/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prefers structured bridge errors over the child process command wrapper', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-structured-error-'));

    try {
      const error = Object.assign(new Error('Command failed: python bridge.py input.json'), {
        stdout: `${JSON.stringify({ ok: false, error: 'Unknown TransitionType: FadeSpin', traceback: 'traceback detail' })}\n`,
        stderr: '',
      });

      let thrown: unknown;
      try {
        await runPyJianYingDraftBridge(
          {
            workDir: dir,
            draftDir: join(dir, 'Draft Root', 'Bridge Draft'),
            title: 'Bridge Draft',
            canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
            imageArea: defaultBridgeImageArea(),
            caption: defaultBridgeCaption(),
            scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'hello' }],
            images: [{ sceneId: 1, path: join(dir, 'image.png') }],
            narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
            subtitlesSrtPath: join(dir, 'subtitles.srt'),
            bgm: null,
            totalDurationUs: 1_200_000,
            volumes: { narration: 1, bgm: 0.3 },
          },
          {
            execute: async () => {
              throw error;
            },
          },
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      expect(message).toContain('pyJianYingDraft bridge failed: Unknown TransitionType: FadeSpin');
      expect(message).not.toContain('Command failed: python');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('explains when the bridge is running through system Python without bundled runtime evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-system-python-error-'));

    try {
      const error = Object.assign(new Error('Command failed: python bridge.py input.json'), {
        stdout: '',
        stderr: '',
      });

      await expect(
        runPyJianYingDraftBridge(
          {
            workDir: dir,
            draftDir: join(dir, 'Draft Root', 'Bridge Draft'),
            title: 'Bridge Draft',
            canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
            imageArea: defaultBridgeImageArea(),
            caption: defaultBridgeCaption(),
            scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'hello' }],
            images: [{ sceneId: 1, path: join(dir, 'image.png') }],
            narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
            subtitlesSrtPath: join(dir, 'subtitles.srt'),
            bgm: null,
            totalDurationUs: 1_200_000,
            volumes: { narration: 1, bgm: 0.3 },
          },
          {
            pythonCommand: 'python',
            execute: async () => {
              throw error;
            },
          },
        ),
      ).rejects.toThrow(/using system Python because bundled Python was not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function wavTone(durationMs: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 8000);
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  return buffer;
}

const fakePyJianYingDraftModule = String.raw`
import json
import os
import struct


class Timerange:
    def __init__(self, start, duration):
        self.start = int(start)
        self.duration = int(duration)

    @property
    def end(self):
        return self.start + self.duration

    def export_json(self):
        return {"start": self.start, "duration": self.duration}


class TrackType:
    video = "video"
    audio = "audio"
    text = "text"


class ClipSettings:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class TextStyle:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class TextBorder:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class KeyframeProperty:
    position_x = "KFTypePositionX"
    position_y = "KFTypePositionY"
    uniform_scale = "UNIFORM_SCALE"


class MaskType:
    矩形 = "rectangle"


class TextSegment:
    def __init__(self, text, target_timerange, *, style=None, clip_settings=None, border=None, background=None, shadow=None):
        self.text = text
        self.target_timerange = target_timerange
        self.source_timerange = None
        self.volume = 1.0
        self.style = style
        self.clip_settings = clip_settings
        self.border = border


class VideoMaterial:
    def __init__(self, path):
        self.path = path
        self.material_id = path
        self.duration = 60_000_000
        self.width = 1080
        self.height = 1920


class AudioMaterial:
    def __init__(self, path):
        self.path = path
        self.material_id = path
        self.duration = read_wav_duration_us(path)


class VideoSegment:
    def __init__(self, material, target_timerange, *, source_timerange=None, speed=None, volume=1.0, change_pitch=False, clip_settings=None):
        self.material = material
        self.target_timerange = target_timerange
        self.source_timerange = source_timerange
        self.speed = speed
        self.volume = volume
        self.clip_settings = clip_settings
        self.keyframes = []
        self.masks = []

    def add_transition(self, *args, **kwargs):
        return self

    def add_filter(self, *args, **kwargs):
        return self

    def add_effect(self, *args, **kwargs):
        return self

    def add_animation(self, *args, **kwargs):
        return self

    def add_keyframe(self, property_type, time_offset, value):
        self.keyframes.append({"property": property_type, "time_offset": int(time_offset), "value": float(value)})
        return self

    def add_mask(self, mask_type, **kwargs):
        self.masks.append({"mask_type": mask_type, **kwargs})
        return self


class AudioSegment:
    def __init__(self, material, target_timerange, *, source_timerange=None, speed=None, volume=1.0, change_pitch=False):
        self.material = material
        self.target_timerange = target_timerange
        self.source_timerange = source_timerange
        self.speed = speed
        self.volume = volume
        self.clip_settings = None

    def add_fade(self, *args, **kwargs):
        return self

    def add_effect(self, *args, **kwargs):
        return self


class DraftFolder:
    def __init__(self, root):
        self.root = root

    def create_draft(self, name, width, height, fps=30, maintrack_adsorb=True, allow_replace=True):
        path = os.path.join(self.root, name)
        os.makedirs(path, exist_ok=True)
        return Script(path, width, height)


class Script:
    def __init__(self, draft_dir, width, height):
        self.draft_dir = draft_dir
        self.width = width
        self.height = height
        self.tracks = []

    @property
    def duration(self):
        duration = 0
        for track in self.tracks:
            for segment in track["segments"]:
                duration = max(duration, segment.target_timerange.end)
        return duration

    def add_track(self, track_type, name):
        self.tracks.append({"type": track_type, "name": name, "segments": []})

    def add_segment(self, segment, track_name):
        for track in self.tracks:
            if track["name"] == track_name:
                track["segments"].append(segment)
                return
        raise ValueError("missing track " + track_name)

    def import_srt(self, *args, **kwargs):
        track_name = kwargs.get("track_name", "subtitles")
        self.add_track("text", track_name)
        self.add_segment(TextSegment("__srt__", Timerange(0, 1), clip_settings=kwargs.get("clip_settings")), track_name)

    def save(self):
        content = {
            "duration": self.duration,
            "canvas_config": {"width": self.width, "height": self.height, "ratio": "original"},
            "tracks": [
                {
                    "type": track["type"],
                    "name": track["name"],
                    "segments": [
                        {
                            "target_timerange": segment.target_timerange.export_json(),
                            "source_timerange": segment.source_timerange.export_json() if segment.source_timerange else None,
                            "volume": segment.volume,
                            "text": getattr(segment, "text", None),
                            "clip_settings": getattr(getattr(segment, "clip_settings", None), "kwargs", None),
                            "keyframes": getattr(segment, "keyframes", []),
                            "masks": getattr(segment, "masks", []),
                        }
                        for segment in track["segments"]
                    ],
                }
                for track in self.tracks
            ],
        }
        with open(os.path.join(self.draft_dir, "draft_content.json"), "w", encoding="utf-8") as handle:
            json.dump(content, handle)


def read_wav_duration_us(path):
    with open(path, "rb") as handle:
        data = handle.read(44)
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return 1_000_000
    byte_rate = struct.unpack("<I", data[28:32])[0]
    data_size = struct.unpack("<I", data[40:44])[0]
    return int(round(data_size / byte_rate * 1_000_000))
`;
