import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runStoryboundMediaSidecar, type StoryboundComposeRenderInput, type StoryboundFrameRenderScene } from '@shared/storybound-sidecar';
import { sliceProductionAudioClip, type ProductionAudioClip } from '../src/shared/production-audio';

describe('sidecar multi-track audio clips', () => {
  it.each(['cut', 'fade'])('keeps identical video and audio after releasing scene inputs before %s composition', async (transition) => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-segment-compose-'));
    try {
      const frames = join(dir, 'frames');
      const source = join(dir, 'sound.wav');
      const bgm = join(dir, 'bgm.wav');
      const cover = join(dir, 'cover.png');
      await mkdir(frames);
      await writeFile(join(frames, '0001.png'), colorPng());
      await writeFile(cover, colorPng());
      await writeFile(source, wavToneWithLeadSilence(2200, 200, .22, 660, 32000));
      await writeFile(bgm, wavToneWithLeadSilence(2200, 0, .08, 330));
      const scenes: StoryboundFrameRenderScene[] = [
        { frames_dir: frames, audio_path: '', duration_s: 1.15, fps: 20, audio_clips: [
          { id: 'voice', path: source, trackType: 'narration', startMs: 100, sourceStartMs: 500, sourceDurationMs: 800, durationMs: 800, gainDb: -3,
            fadeEnvelope: { offsetMs: 250, durationMs: 1600, fadeInMs: 800, fadeOutMs: 600 } },
          { id: 'sound', path: source, trackType: 'sfx', startMs: 250, sourceStartMs: 800, sourceDurationMs: 400, durationMs: 400, gainDb: -9 },
        ] },
        { frames_dir: frames, audio_path: 'unavailable-legacy.wav', duration_s: .55, fps: 20, audio_clips: [] },
      ];
      const common = { transition: { type: transition, duration: .2 }, total_duration_s: 2.1, canvas_w: 2, canvas_h: 2, cover_path: cover, cover_duration_s: .4, bgm_path: bgm, bgm_target_db: -26 };
      const legacyOutput = join(dir, 'legacy.mp4');
      await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: join(dir, 'legacy'), output_path: legacyOutput, scenes, ...common });
      const encoded: StoryboundComposeRenderInput['scenes'] = [];
      for (const [index, scene] of scenes.entries()) {
        const sceneDir = join(dir, `encode-${index}`);
        const segment = join(dir, `segment-${index}.mp4`);
        const result = await runStoryboundMediaSidecar({ mode: 'encode_render_scene', work_dir: sceneDir, scene, output_path: segment });
        expect(result).toMatchObject({ success: true, duration: scene.duration_s });
        const legacyMix = await readFile(join(dir, 'legacy', `scene-0${index}-mix.wav`));
        expect(await readFile(join(sceneDir, 'scene-00-mix.wav'))).toEqual(legacyMix);
        await rm(sceneDir, { recursive: true, force: true });
        encoded.push({ segment_path: segment, fps: scene.fps, duration_s: scene.duration_s! });
      }
      await rm(frames, { recursive: true, force: true });
      await rm(source);
      const output = join(dir, 'encoded.mp4');
      await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: join(dir, 'composed'), output_path: output, scenes: encoded, ...common });
      expect(await readFile(output)).toEqual(await readFile(legacyOutput));
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: dir, media_path: output, require_nonblack: true });
      expect(probe).toMatchObject({ has_audio: true, has_video: true, has_nonblack_video: true, width: 2, height: 2 });
      expect(probe.duration).toBeCloseTo(2.1, 1);
    } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); }
  }, 60_000);

  it('preserves PCM levels through cuts inside overlapping fades and an exhausted source tail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-split-fades-'));
    try {
      const frames = join(dir, 'frames');
      const source = join(dir, 'sound.wav');
      await mkdir(frames);
      await writeFile(join(frames, '0001.png'), colorPng());
      await writeFile(source, wavToneWithLeadSilence(5000, 0, .22, 660, 32000));
      const clip: ProductionAudioClip & { durationMs: number } = { id: 'sound', assetVersionId: 'sound', trackType: 'music', startMs: 200, durationMs: 2800,
        sourceStartMs: 500, sourceDurationMs: 2600, gainDb: -9, fadeInMs: 2000, fadeOutMs: 1800 };
      const cuts = [0, 1500, 2700, 2850, 3000];
      const pieces = cuts.slice(0, -1).map((start, index) => {
        const sliced = sliceProductionAudioClip(clip, start, cuts[index + 1], 3000)!;
        return { ...sliced, durationMs: sliced.durationMs!, path: source };
      });
      const cases: Array<[string, StoryboundComposeRenderInput['scenes']]> = [
        ['original', [{ frames_dir: frames, audio_path: '', fps: 10, duration_s: 3, audio_clips: [{ ...clip, path: source }] }]],
        ['merged', [{ frames_dir: frames, audio_path: '', fps: 10, duration_s: 3, audio_clips: pieces }]],
        ['split', pieces.map((piece, index) => ({ frames_dir: frames, audio_path: '', fps: 10, duration_s: (cuts[index + 1] - cuts[index]) / 1000,
          audio_clips: [{ ...piece, startMs: piece.startMs - cuts[index] }] }))],
      ];
      for (const [name, scenes] of cases) {
        await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: join(dir, name), output_path: join(dir, `${name}.mp4`), total_duration_s: 3, transition: 'cut', scenes });
      }
      const original = pcmSamples(await readFile(join(dir, 'original', 'scene-00-mix.wav')));
      const merged = pcmSamples(await readFile(join(dir, 'merged', 'scene-00-mix.wav')));
      const split = (await Promise.all(pieces.map(async (_, index) => Array.from(pcmSamples(await readFile(join(dir, 'split', `scene-0${index}-mix.wav`))))))).flat();
      const decoded: Float64Array[] = [];
      for (const name of ['original', 'split']) {
        const path = join(dir, `${name}-decoded.wav`);
        await runStoryboundMediaSidecar({ mode: 'convert_audio_16k', audio_path: join(dir, `${name}.mp4`), output_path: path });
        decoded.push(pcmSamples(await readFile(path)));
      }
      expect(rms(decoded[1], 1450, 1550, 16000)).toBeCloseTo(rms(decoded[0], 1450, 1550, 16000), 3);
      expect(split.length).toBe(original.length);
      expect(merged.length).toBe(original.length);
      for (let index = 0; index < original.length; index += 1) {
        expect(Math.abs(merged[index] - original[index])).toBeLessThanOrEqual(2 / 32768);
        expect(Math.abs(split[index] - original[index])).toBeLessThanOrEqual(2 / 32768);
      }
      for (const [start, end] of [[200, 400], [1200, 1490], [1490, 1510], [1700, 2000], [2650, 2750], [2800, 2990]]) {
        expect(rms(merged, start, end)).toBeCloseTo(rms(original, start, end), 4);
        expect(rms(Float64Array.from(split), start, end)).toBeCloseTo(rms(original, start, end), 4);
      }
      expect(rms(Float64Array.from(split), 2850, 3000)).toBe(0);
    } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); }
  }, 60_000);
  it('finishes a single audible 32kHz sound after muting narration, with trim, delay, gain and fades', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-single-sound-'));
    try {
      const frames = join(dir, 'frames');
      const source = join(dir, 'sound.wav');
      await mkdir(frames);
      await writeFile(join(frames, '0001.png'), colorPng());
      await writeFile(source, wavToneWithLeadSilence(5000, 0, 0.22, 660, 32000));
      await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: dir, output_path: join(dir, 'one-sound.mp4'), total_duration_s: 3,
        scenes: [{ frames_dir: frames, audio_path: '', fps: 10, duration_s: 3, audio_clips: [
          { id: 'muted-speech', path: 'unreadable-muted.wav', trackType: 'narration', startMs: 0, durationMs: 3000, muted: true },
          { id: 'sound', path: source, trackType: 'sfx', startMs: 500, sourceStartMs: 250, sourceDurationMs: 1000, durationMs: 1000, gainDb: -6, fadeInMs: 100, fadeOutMs: 100 },
        ] }] });
      const samples = pcmSamples(await readFile(join(dir, 'scene-00-mix.wav')));
      expect(samples.length / 44100).toBeCloseTo(3, 1);
      expect(rms(samples, 0, 450)).toBeLessThan(.001);
      // A mono sine copied to stereo uses equal-power (-3dB) channels.
      expect(rms(samples, 700, 1200)).toBeCloseTo(.22 * Math.pow(10, -6 / 20) / 2, 3);
      expect(rms(samples, 1700, 2900)).toBeLessThan(.001);
    } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); }
  }, 30_000);
  it('renders explicit all-muted audio as silence instead of reviving legacy narration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-audio-silence-'));
    try {
      const frames = join(dir, 'frames');
      await mkdir(frames);
      await writeFile(join(frames, '0001.png'), colorPng());
      await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: dir, output_path: join(dir, 'silent.mp4'), total_duration_s: 1,
        scenes: [{ frames_dir: frames, audio_path: join(dir, 'legacy-must-not-be-read.wav'), fps: 10, duration_s: 1, audio_clips: [] }] });
      expect(rms(pcmSamples(await readFile(join(dir, 'scene-00-mix.wav'))), 0, 1000)).toBe(0);
    } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); }
  }, 30_000);

  it('mixes delayed, source-trimmed and gain-adjusted clips into one scene', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-audio-clips-'));
    const frames = join(dir, 'frames');
    const source = join(dir, 'source.wav');
    const sfx = join(dir, 'sfx.wav');
    const output = join(dir, 'output.mp4');
    try {
      await mkdir(frames, { recursive: true });
      await writeFile(join(frames, '0001.png'), colorPng());
      await writeFile(source, wavToneWithLeadSilence(1_000, 300, 0.22, 440));
      await writeFile(sfx, wavToneWithLeadSilence(1_000, 0, 0.16, 880));
      await runStoryboundMediaSidecar({
        mode: 'compose_render', work_dir: dir, output_path: output, total_duration_s: 1.5,
        scenes: [{ frames_dir: frames, audio_path: '', fps: 10, duration_s: 1.5, audio_clips: [
          { id: 'dialogue-a', path: source, trackType: 'dialogue', startMs: 200, sourceStartMs: 300, sourceDurationMs: 400, durationMs: 400, gainDb: 0 },
          { id: 'sfx', path: sfx, trackType: 'sfx', startMs: 650, sourceStartMs: 0, sourceDurationMs: 100, durationMs: 100, gainDb: 0 },
          { id: 'dialogue-b', path: source, trackType: 'dialogue', startMs: 900, sourceStartMs: 300, sourceDurationMs: 400, durationMs: 400, gainDb: -6 },
        ] }],
      });
      const mixed = await readFile(join(dir, 'scene-00-mix.wav'));
      const samples = pcmSamples(mixed);
      expect(rms(samples, 0, 180)).toBeLessThan(0.01); // delayed start
      expect(rms(samples, 220, 580)).toBeGreaterThan(0.08); // trimmed dialogue
      expect(rms(samples, 620, 640)).toBeLessThan(0.01); // gap before SFX
      expect(rms(samples, 660, 740)).toBeGreaterThan(0.05); // SFX lane
      expect(rms(samples, 920, 1280)).toBeGreaterThan(0.03); // second dialogue
      expect(rms(samples, 920, 1280)).toBeLessThan(rms(samples, 220, 580) * 0.6); // -6 dB gain
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    }
  }, 30_000);
});

function pcmSamples(wav: Buffer): Float64Array {
  const channels = wav.readUInt16LE(wav.indexOf(Buffer.from('fmt ')) + 10);
  const dataOffset = wav.indexOf(Buffer.from('data'));
  const size = wav.readUInt32LE(dataOffset + 4);
  const result = new Float64Array(Math.floor(size / (2 * channels)));
  for (let index = 0; index < result.length; index += 1) result[index] = wav.readInt16LE(dataOffset + 8 + index * 2 * channels) / 32768;
  return result;
}

function rms(samples: Float64Array, startMs: number, endMs: number, sampleRate = 44100): number {
  const start = Math.max(0, Math.floor(startMs * sampleRate / 1000));
  const end = Math.min(samples.length, Math.floor(endMs * sampleRate / 1000));
  if (end <= start) return 0;
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += samples[index] ** 2;
  return Math.sqrt(sum / (end - start));
}

function wavToneWithLeadSilence(durationMs: number, leadSilenceMs: number, amplitude: number, frequency: number, sampleRate = 44_100): Buffer {
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const lead = Math.floor((sampleRate * leadSilenceMs) / 1000);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  for (let index = lead; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * frequency) * amplitude * 32767), 44 + index * 2);
  return buffer;
}

function colorPng(): Buffer {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAVSURBVBhXY/jPAEQNIIrhPxD8/w8AQ9QJeKxchO4AAAAASUVORK5CYII=', 'base64');
}
