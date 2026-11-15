import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
vi.mock('electron', () => ({ BrowserWindow: class {}, session: {} }));
import { masterPiAudio, type PiAudioMasterRequest } from '../electron/pi-audio-master';
import { resolveLemoUpstreamRenderRuntime, runProcess } from '../electron/lemo-upstream-video';

let root: string;
let ffmpegPath: string;
const pythonRoot = resolve('vendor/python');
const rate = 48000;
const base = (): PiAudioMasterRequest => ({ durationSeconds: 6, stems: {}, narration: [], approvedPauses: [],
  mix: { version: 1, stems: {}, duck: { under: 'narration', attackMs: 200, releaseMs: 200 },
    silences: [{ t0: 4, t1: 4.5, reason: 'measure actual audio' }], transitions: [] } });
async function tone(name: string, hz: number, amplitude: number, seconds = 6, sourceRate = rate) {
  const path = join(root, name + '.wav');
  const raw = join(root, name + '.f32');
  const buffer = Buffer.alloc(seconds * sourceRate * 8);
  for (let i = 0; i < seconds * sourceRate; i++) {
    const value = amplitude * Math.sin(2 * Math.PI * hz * i / sourceRate);
    buffer.writeFloatLE(value, i * 8); buffer.writeFloatLE(value, i * 8 + 4);
  }
  await writeFile(raw, buffer);
  const result = await runProcess(ffmpegPath, ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(sourceRate), '-ac', '2', '-i', raw, '-c:a', 'pcm_f32le', path]);
  expect(result.code).toBe(0);
  return path;
}
async function samples(path: string) {
  const out = path + '.decoded';
  // Do not request a rate: decode the rate actually stored in the WAV.
  const result = await runProcess(ffmpegPath, ['-y', '-hide_banner', '-i', path, '-c:a', 'pcm_f32le', '-f', 'f32le', out]);
  expect(result.code).toBe(0);
  expect(result.stderr).toMatch(/48000 Hz, stereo/);
  return readFile(out);
}
function amplitude(data: Buffer, hz: number, t0: number, duration = .1) {
  let dot = 0;
  for (let i = Math.round(t0 * rate); i < Math.round((t0 + duration) * rate); i++) dot += data.readFloatLE(i * 8) * Math.sin(2 * Math.PI * hz * i / rate);
  return 2 * dot / Math.round(duration * rate);
}
const options = () => ({ pythonRoot, outputDir: root, runtime: { ffmpegPath } });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-audio-real-'));
  ({ ffmpegPath } = await resolveLemoUpstreamRenderRuntime({ pythonRoot, cacheDir: root }));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe('trusted host audio mastering with bundled real decoder', () => {
  it('mixes gain and duck ramps, preserves approved gaps, measures samples and normalizes quiet audio', async () => {
    const music = await tone('music', 440, .02, 6, 44100);
    const voice = await tone('voice', 1000, .04, 2);
    const request = base();
    request.stems.music = music;
    request.mix.stems.music = { gainDb: -6 };
    request.mix.duck.music = -12;
    request.narration = [{ path: voice, sourceStartSeconds: .5, t0: 1, t1: 2, gainDb: 0 },
      { path: voice, sourceStartSeconds: 0, t0: 3, t1: 4, gainDb: 0 }];
    request.approvedPauses = [{ t0: 2, t1: 3 }];
    const snapshot = JSON.stringify(request);
    const result = await masterPiAudio(request, options());
    expect(JSON.stringify(request)).toBe(snapshot);
    expect(result.stems[0]).toMatchObject({ stem: 'music', durationSeconds: 6, sampleRate: 48000, channels: 2, nonFiniteSamples: 0 });
    expect(result.stems[0].peakAmplitude).toBeCloseTo(.02, 3);
    expect(result.pauseMeasurements[0].peakAmplitude).toBe(0);
    expect(result.onsets).toEqual([]);
    const pre = await samples(result.premasterPath);
    expect(pre.length).toBe(6 * rate * 8);
    const ordinary = amplitude(pre, 440, .5);
    expect(ordinary).toBeCloseTo(.02 * 10 ** (-6 / 20), 4);
    expect(amplitude(pre, 440, 1.3) / ordinary).toBeCloseTo(10 ** (-12 / 20), 3);
    expect(amplitude(pre, 440, .85)).toBeGreaterThan(amplitude(pre, 440, 1.3));
    expect(amplitude(pre, 440, .85)).toBeLessThan(ordinary);
    expect(amplitude(pre, 440, 2.05)).toBeGreaterThan(amplitude(pre, 440, 1.3));
    expect(amplitude(pre, 1000, 1.3)).toBeCloseTo(.04, 4);
    expect(Math.abs(amplitude(pre, 1000, 2.5))).toBeLessThan(.00001);
    // Declared silence is not forced to zero or certified from its declaration.
    expect(result.silenceMeasurements.find(x => x.stem === 'music')!.peakAmplitude).toBeGreaterThan(.005);
    expect(result.silenceMeasurements.every(x => x.provenance === 'measured')).toBe(true);
    expect(result.loudness.integratedLufs).toBeCloseTo(-14, 0);
    expect(result.loudness.truePeakDbtp!).toBeLessThanOrEqual(-1.1);
    expect(result.master.peakAmplitude).toBeGreaterThan(result.premaster.peakAmplitude * 2);
    expect((await samples(result.outputPath)).length).toBe(pre.length);
  }, 60000);

  it('preserves exact digital silence with finite metadata', async () => {
    const result = await masterPiAudio(base(), options());
    expect(result.master).toMatchObject({ durationSeconds: 6, nonFiniteSamples: 0, peakAmplitude: 0 });
    expect(result.loudness.integratedLufs).toBeNull();
    expect((await samples(result.outputPath)).every(x => x === 0)).toBe(true);
  }, 60000);

  it('rejects duration changes, missing samples and conflicting pauses', async () => {
    const request = base();
    request.stems.sfx = await tone('short', 500, .1, 1);
    request.mix.stems.sfx = { gainDb: 0 };
    await expect(masterPiAudio(request, options())).rejects.toThrow('AUDIO_STEM_DURATION');
    request.stems = {}; request.mix.stems = {};
    request.narration = [{ path: join(root, 'short.wav'), sourceStartSeconds: 0, t0: 0, t1: 2 }];
    await expect(masterPiAudio(request, options())).rejects.toThrow('AUDIO_NARRATION_SLICE_TOO_SHORT');
    request.approvedPauses = [{ t0: 1, t1: 2 }];
    await expect(masterPiAudio(request, options())).rejects.toThrow('AUDIO_PAUSE_NARRATION_OVERLAP');
    await expect(masterPiAudio({ ...base(), durationSeconds: 198.001 }, options())).rejects.toThrow();
  }, 60000);

  it('sums all three stems without averaging and leaves SFX unducked', async () => {
    const request = base();
    request.stems = { music: await tone('sum-music', 400, .03), ambience: await tone('sum-ambience', 700, .02), sfx: await tone('sum-sfx', 1100, .01) };
    request.mix.stems = { music: { gainDb: 0 }, ambience: { gainDb: 6 }, sfx: { gainDb: -6 } };
    request.mix.duck = { under: 'narration', music: -10, ambience: -20, attackMs: 0, releaseMs: 0 };
    request.narration = [{ path: await tone('sum-voice', 1400, .02, 1), sourceStartSeconds: 0, t0: 1, t1: 2 }];
    const result = await masterPiAudio(request, options());
    const pre = await samples(result.premasterPath);
    expect(amplitude(pre, 400, .5)).toBeCloseTo(.03, 4);
    expect(amplitude(pre, 700, .5)).toBeCloseTo(.02 * 10 ** (6 / 20), 4);
    expect(amplitude(pre, 700, 1.5)).toBeCloseTo(.02 * 10 ** (6 / 20) * .1, 4);
    expect(amplitude(pre, 1100, 1.5)).toBeCloseTo(.01 * 10 ** (-6 / 20), 4);
    expect(result.stems).toHaveLength(3);
  }, 60000);

  it('rejects decoded non-finite float samples with measured counts', async () => {
    // IEEE float WAV fixture written directly so an encoder cannot sanitize NaNs.
    const wav = Buffer.alloc(44 + 6 * rate * 8);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 8, 28); wav.writeUInt16LE(8, 32); wav.writeUInt16LE(32, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40); wav.writeFloatLE(NaN, 44 + 800);
    const path = join(root, 'nonfinite.wav'); await writeFile(path, wav);
    const request = base(); request.stems.sfx = path; request.mix.stems.sfx = { gainDb: 0 };
    await expect(masterPiAudio(request, options())).rejects.toThrow(/AUDIO_NONFINITE.*nonFiniteSamples.*1/);
  }, 30000);

  it('accepts 198 seconds and rejects overflow before rendering in both validators', async () => {
    const signal = AbortSignal.abort(new Error('duration accepted'));
    await expect(masterPiAudio({ ...base(), durationSeconds: 198 }, { ...options(), signal })).rejects.toThrow('duration accepted');
    await expect(masterPiAudio({ ...base(), durationSeconds: 198.001 }, { ...options(), signal })).rejects.not.toThrow('duration accepted');
    const script = `import runpy
m = runpy.run_path(${JSON.stringify(resolve('services/lemo-audio/master.py'))})
try:
    m['main']({'durationSeconds': 198})
except KeyError as e:
    assert e.args == ('outputDir',)
else:
    raise AssertionError('expected validation to reach outputDir')
try:
    m['main']({'durationSeconds': 198.001})
except ValueError as e:
    assert str(e) == 'AUDIO_DURATION_INVALID'
else:
    raise AssertionError('overflow accepted')
`;
    const result = await runProcess(join(pythonRoot, 'python.exe'), ['-I', '-B', '-c', script]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('supports pre-abort and enforced process timeout', async () => {
    const controller = new AbortController(); controller.abort(new Error('test cancelled'));
    await expect(masterPiAudio(base(), { ...options(), signal: controller.signal })).rejects.toThrow('test cancelled');
    await expect(masterPiAudio(base(), { ...options(), timeoutMs: 1 })).rejects.toThrow('TIMEOUT');
  }, 30000);
});
