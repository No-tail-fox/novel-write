import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readMp4AudioSampleCount, readWavSampleCount, renderAudioTimeline } from '../electron/audio-timeline-renderer';
import { resolveFinalFilmFfmpeg } from '../electron/final-film-gate-runner';
import { VIDEO_SPEC_VERSION, type VideoSpecFps, type VideoSpecInput } from '../src/shared/video-spec';

const pythonRoot = join(resolve(__dirname, '..'), 'vendor', 'python');
const ffmpegPath = (await resolveFinalFilmFfmpeg({ pythonRoot, ffprobePath: null }))?.ffmpegPath ?? null;

function timeline(fps: VideoSpecFps, framesPerSecond = fps): VideoSpecInput {
  const total = 5 * framesPerSecond;
  return {
    specVersion: VIDEO_SPEC_VERSION,
    route: 'html',
    canvas: { width: 320, height: 180, fps },
    durationFrames: total,
    scenes: [{ id: 's1', startFrame: 0, durationFrames: total, adapter: { kind: 'still', imageRef: 'a.png' } }],
    audio: {
      sampleRate: 48_000,
      tracks: [
        { id: 'narration', kind: 'narration', clips: [
          // Source (1.2 s) is shorter than the clip (1.5 s) → padded with silence.
          { id: 'n1', ref: 'voice-1.wav', startFrame: 0, durationFrames: Math.round(1.5 * fps), fadeOutFrames: 3 },
          { id: 'n2', ref: 'voice-2.wav', startFrame: 2 * fps + 7, durationFrames: 2 * fps, sourceStartMs: 250, gainDb: -2 },
        ] },
        { id: 'music', kind: 'music', targetDb: -12, ducking: { triggerTrackIds: ['narration'], reductionDb: 12 },
          // 0.7 s source looped over 4.5 s.
          clips: [{ id: 'bgm', ref: 'bgm.wav', startFrame: Math.round(fps / 2), durationFrames: total - Math.round(fps / 2), loop: true, fadeInFrames: fps / 2, fadeOutFrames: fps }] },
      ],
    },
  };
}

async function makeInputs(dir: string) {
  const make = (name: string, source: string, extra: string[] = []) => {
    const path = join(dir, name);
    const result = spawnSync(ffmpegPath!, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source, ...extra, path], { windowsHide: true });
    expect(result.status, result.stderr?.toString()).toBe(0);
    return path;
  };
  return new Map([
    ['n1', make('voice-1.wav', 'sine=frequency=440:duration=1.2:sample_rate=24000', ['-ac', '1'])],
    ['n2', make('voice-2 (copy).wav', 'sine=frequency=660:duration=3:sample_rate=44100')],
    ['bgm.wav', make('bgm.wav', 'sine=frequency=220:duration=0.7:sample_rate=48000', ['-ac', '2'])],
  ]);
}

describe.skipIf(!ffmpegPath)('renderAudioTimeline with the bundled ffmpeg', () => {
  it('renders a 3-clip timeline to WAV with the exact sample count at −14 LUFS (±1 LU)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audio-timeline-'));
    try {
      const inputs = await makeInputs(dir);
      const outputPath = join(dir, 'out', 'timeline.wav');
      const result = await renderAudioTimeline({ spec: timeline(30), inputs, outputPath, ffmpegPath: ffmpegPath! });
      console.log('[audio-timeline] wav', JSON.stringify({ measured: result.measured, output: result.output, elapsedMs: result.elapsedMs }));
      expect(result.durationSamples).toBe(240_000);
      expect(result.outputSamples).toBe(240_000);
      expect(result.decodedSamples).toBe(240_000);
      expect(result.loudnorm).toBe('apply');
      expect(result.measured).not.toBeNull();
      expect(Math.abs(result.output!.integratedLufs - -14)).toBeLessThanOrEqual(1);
      expect(result.output!.truePeakDb).toBeLessThanOrEqual(-0.9);
      const wav = readWavSampleCount(await readFile(outputPath));
      expect(wav).toEqual({ samples: 240_000, sampleRate: 48_000, channels: 2, bitsPerSample: 16 });
      // Atomic write: no temp / graph files left behind.
      expect(await readdir(join(dir, 'out'))).toEqual(['timeline.wav']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('encodes AAC once at 24 fps with an exact container sample count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audio-timeline-aac-'));
    try {
      const inputs = await makeInputs(dir);
      const outputPath = join(dir, 'timeline.m4a');
      const result = await renderAudioTimeline({ spec: timeline(24), inputs, outputPath, ffmpegPath: ffmpegPath!, codec: 'aac' });
      expect(result.durationSamples).toBe(240_000);
      expect(result.outputSamples).toBe(240_000);
      expect(result.decodedSamples! - 240_000).toBeGreaterThanOrEqual(0);
      expect(result.decodedSamples! - 240_000).toBeLessThan(1024);
      expect(Math.abs(result.output!.integratedLufs - -14)).toBeLessThanOrEqual(1);
      expect(readMp4AudioSampleCount(await readFile(outputPath))).toMatchObject({ samples: 240_000, timescale: 48_000 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('places a clip at the exact sample (first/last non-zero sample in the WAV)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audio-timeline-exact-'));
    try {
      const dc = join(dir, 'dc.wav');
      const made = spawnSync(ffmpegPath!, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.5|0.5:c=stereo:s=48000:d=2', dc], { windowsHide: true });
      expect(made.status, made.stderr?.toString()).toBe(0);
      for (const fps of [24, 30] as const) {
        const spec: VideoSpecInput = {
          specVersion: VIDEO_SPEC_VERSION, route: 'template', canvas: { width: 320, height: 180, fps }, durationFrames: fps,
          scenes: [{ id: 's1', startFrame: 0, durationFrames: fps, adapter: { kind: 'still', imageRef: 'a.png' } }],
          audio: { sampleRate: 48_000, tracks: [{ id: 'sfx', kind: 'sfx', clips: [{ id: 'x', ref: 'dc.wav', startFrame: 7, durationFrames: 5 }] }] },
          loudness: { normalize: false },
        };
        const outputPath = join(dir, `exact-${fps}.wav`);
        await renderAudioTimeline({ spec, inputs: new Map([['x', dc]]), outputPath, ffmpegPath: ffmpegPath! });
        const bytes = await readFile(outputPath);
        const dataAt = bytes.indexOf('data', 12, 'latin1') + 8;
        const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset + dataAt, bytes.byteOffset + bytes.length));
        const frames = pcm.length / 2;
        let first = -1, last = -1;
        for (let i = 0; i < frames; i++) if (pcm[i * 2] !== 0) { if (first < 0) first = i; last = i; }
        const perFrame = 48_000 / fps;
        expect(frames).toBe(48_000);
        expect(first).toBe(7 * perFrame);
        expect(last).toBe(12 * perFrame - 1);
        expect(pcm[first * 2]).toBe(16384);
      }
      // A long timeline (graph > 6000 chars) uses the installed FFmpeg's file-valued graph option.
      const clips = Array.from({ length: 40 }, (_, index) => ({ id: `x${index}`, ref: 'dc.wav', startFrame: index * 2, durationFrames: 1, gainDb: -12 }));
      const long: VideoSpecInput = {
        specVersion: VIDEO_SPEC_VERSION, route: 'template', canvas: { width: 320, height: 180, fps: 30 }, durationFrames: 90,
        scenes: [{ id: 's1', startFrame: 0, durationFrames: 90, adapter: { kind: 'still', imageRef: 'a.png' } }],
        audio: { sampleRate: 48_000, tracks: [{ id: 'sfx', kind: 'sfx', clips }] },
      };
      const longResult = await renderAudioTimeline({ spec: long, inputs: new Map([['dc.wav', dc]]), outputPath: join(dir, 'long.wav'), ffmpegPath: ffmpegPath! });
      expect(longResult.outputSamples).toBe(144_000);
      expect((await readdir(dir)).filter(name => name.includes('.graph'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('ducks the music under narration (sidechaincompress), and only when configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audio-timeline-duck-'));
    try {
      const make = (name: string, source: string) => {
        const path = join(dir, name);
        const result = spawnSync(ffmpegPath!, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source, path], { windowsHide: true });
        expect(result.status, result.stderr?.toString()).toBe(0);
        return path;
      };
      const inputs = new Map([['voice', make('voice.wav', 'sine=frequency=2000:duration=1:sample_rate=48000')], ['music', make('music.wav', 'sine=frequency=100:duration=3:sample_rate=48000')]]);
      const build = (ducking: boolean): VideoSpecInput => ({
        specVersion: VIDEO_SPEC_VERSION, route: 'template', canvas: { width: 320, height: 180, fps: 30 }, durationFrames: 90,
        scenes: [{ id: 's1', startFrame: 0, durationFrames: 90, adapter: { kind: 'still', imageRef: 'a.png' } }],
        audio: { sampleRate: 48_000, tracks: [
          { id: 'narration', kind: 'narration', clips: [{ id: 'voice', ref: 'voice.wav', startFrame: 30, durationFrames: 30 }] },
          { id: 'music', kind: 'music', ...(ducking ? { ducking: { triggerTrackIds: ['narration'], reductionDb: 12 } } : {}), clips: [{ id: 'music', ref: 'music.wav', startFrame: 0, durationFrames: 90 }] },
        ] },
        loudness: { normalize: false },
      });
      // RMS of the music band (low-passed) inside the narration window vs after the release.
      const musicRms = (file: string, start: number, end: number) => {
        const probe = spawnSync(ffmpegPath!, ['-hide_banner', '-nostats', '-i', file, '-af', `atrim=start_sample=${start}:end_sample=${end},lowpass=f=300,lowpass=f=300,astats=measure_perchannel=none:measure_overall=RMS_level`, '-f', 'null', '-'], { windowsHide: true });
        return Number(/RMS level dB:\s*(-?[\d.]+)/.exec(probe.stderr.toString())?.[1]);
      };
      const ducked = join(dir, 'ducked.wav'), plain = join(dir, 'plain.wav');
      await renderAudioTimeline({ spec: build(true), inputs, outputPath: ducked, ffmpegPath: ffmpegPath! });
      await renderAudioTimeline({ spec: build(false), inputs, outputPath: plain, ffmpegPath: ffmpegPath! });
      const during = musicRms(ducked, 1.4 * 48_000, 1.9 * 48_000), after = musicRms(ducked, 2.6 * 48_000, 2.95 * 48_000);
      const plainDuring = musicRms(plain, 1.4 * 48_000, 1.9 * 48_000);
      console.log('[audio-timeline] ducking dB', JSON.stringify({ during, after, plainDuring }));
      expect(after - during).toBeGreaterThan(6);
      expect(after - during).toBeLessThan(20);
      expect(Math.abs(plainDuring - after)).toBeLessThan(0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('keeps the original level when loudness.normalize is false', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audio-timeline-off-'));
    try {
      const inputs = await makeInputs(dir);
      const result = await renderAudioTimeline({ spec: { ...timeline(30), loudness: { normalize: false } }, inputs, outputPath: join(dir, 'o.wav'), ffmpegPath: ffmpegPath! });
      expect(result.loudnorm).toBe('off');
      expect(result.measured).toBeNull();
      expect(result.outputSamples).toBe(240_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('is cancellable and times out with AUDIO_TIMELINE_* codes, leaving no partial output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audio-timeline-abort-'));
    try {
      const inputs = await makeInputs(dir);
      const outputPath = join(dir, 'out', 'o.wav');
      const controller = new AbortController();
      const pending = renderAudioTimeline({ spec: timeline(30), inputs, outputPath, ffmpegPath: ffmpegPath!, signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      await expect(pending).rejects.toMatchObject({ code: 'AUDIO_TIMELINE_CANCELLED' });
      await expect(renderAudioTimeline({ spec: timeline(30), inputs, outputPath, ffmpegPath: ffmpegPath!, timeoutMs: 1 }))
        .rejects.toMatchObject({ code: 'AUDIO_TIMELINE_TIMEOUT' });
      expect(existsSync(outputPath)).toBe(false);
      expect((await readdir(join(dir, 'out'))).filter(name => name.includes('.tmp') || name.includes('.graph'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('renderAudioTimeline preconditions', () => {
  it('reports missing ffmpeg and missing input files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audio-timeline-pre-'));
    try {
      const spec = timeline(30);
      await expect(renderAudioTimeline({ spec, inputs: new Map([['n1', join(dir, 'nope.wav')], ['n2', join(dir, 'nope.wav')], ['bgm', join(dir, 'nope.wav')]]), outputPath: join(dir, 'o.wav'), ffmpegPath: 'x' }))
        .rejects.toMatchObject({ code: 'AUDIO_TIMELINE_INPUT_MISSING' });
      await expect(renderAudioTimeline({ spec: { ...spec, audio: { sampleRate: 48_000, tracks: [] } }, inputs: new Map(), outputPath: join(dir, 'o.wav'), ffmpegPath: join(dir, 'no-ffmpeg.exe') }))
        .rejects.toMatchObject({ code: 'AUDIO_TIMELINE_FFMPEG_MISSING' });
      const aborted = new AbortController(); aborted.abort();
      await expect(renderAudioTimeline({ spec, inputs: new Map(), outputPath: join(dir, 'o.wav'), signal: aborted.signal }))
        .rejects.toMatchObject({ code: 'AUDIO_TIMELINE_CANCELLED' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
