import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPyJianYingDraftBridge, writePyJianYingBridgeInput, writePyJianYingBridgeScript } from '@shared/jianying-bridge';

describe('pyJianYingDraft bridge input', () => {
  it('writes a self-contained bridge payload for Python draft generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-bridge-'));

    try {
      const payloadPath = await writePyJianYingBridgeInput({
        workDir: dir,
        draftDir: join(dir, 'Draft Root', 'Bridge Draft'),
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920, backgroundColor: '#123456', backgroundImage: join(dir, 'background.png') },
        imageArea: { ratio: '4:3', top: 0, height: 1280, fit: 'cover', animation: '缩放' },
        caption: { fontSize: 44, color: '#ffffff', x: 0.2, y: 1480 },
        overlays: {
          title: { visible: true, text: 'Bridge Draft', x: -0.1, y: -0.5, fontSize: 44, color: '#ffde00' },
          subtitle: { visible: true, x: 0, y: -0.35, fontSize: 22, color: '#ffffff' },
          disclaimer: { visible: true, text: 'Disclaimer', x: 0, y: 0.9 },
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
      expect(payload.caption).toMatchObject({ x: 0.2, y: 1480 });
      expect(payload.overlays.title).toMatchObject({ x: -0.1, y: -0.5 });
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
      expect(script).toContain('VideoSegment');
      expect(script).toContain('AudioSegment');
      expect(script).toContain('shutil.copy2');
      expect(script).toContain('create_solid_png');
      expect(script).toContain('background_track');
      expect(script).toContain('import_srt');
      expect(script).toContain('script.save()');
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
        imageArea: { ratio: '9:16', top: 0, height: 1, fit: 'cover', animation: '' },
        caption: { fontSize: 44, color: '#ffffff', y: -0.8 },
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

  it('executes Python with the bridge script and parses the generated draft paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-run-'));
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    try {
      const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
      const output = await runPyJianYingDraftBridge(
        {
          workDir: dir,
          draftDir,
          title: 'Bridge Draft',
          canvas: { width: 1080, height: 1920, backgroundColor: '#000000', backgroundImage: '' },
          imageArea: { ratio: '9:16', top: 0, height: 1, fit: 'cover', animation: '缩放' },
          caption: { fontSize: 44, color: '#ffffff', y: -0.8 },
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
            calls.push({ command, args, cwd: options.cwd });
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
            imageArea: { ratio: '9:16', top: 0, height: 1, fit: 'cover', animation: '缩放' },
            caption: { fontSize: 44, color: '#ffffff', y: -0.8 },
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
            imageArea: { ratio: '9:16', top: 0, height: 1, fit: 'cover', animation: '' },
            caption: { fontSize: 44, color: '#ffffff', y: -0.8 },
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


class ClipSettings:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class TextStyle:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


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

    def add_transition(self, *args, **kwargs):
        return self

    def add_filter(self, *args, **kwargs):
        return self

    def add_effect(self, *args, **kwargs):
        return self

    def add_animation(self, *args, **kwargs):
        return self


class AudioSegment:
    def __init__(self, material, target_timerange, *, source_timerange=None, speed=None, volume=1.0, change_pitch=False):
        self.material = material
        self.target_timerange = target_timerange
        self.source_timerange = source_timerange
        self.speed = speed
        self.volume = volume

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
        self.add_track("text", kwargs.get("track_name", "subtitles"))

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
