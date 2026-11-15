import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
vi.mock('electron', () => ({ BrowserWindow: class {}, session: {} }));
import { piScoreSchema, piFoleySchema, renderPiScore, type PiScoreRequest } from '../electron/pi-score-renderer';
import { resolveLemoUpstreamRenderRuntime, runProcess } from '../electron/lemo-upstream-video';

let root: string;
let ffmpegPath: string;
const pythonRoot = resolve('vendor/python');
const instrumentsRoot = resolve('vendor/lemo-instrument-starter/instruments');
const request = (): PiScoreRequest => ({ durationSeconds: 5, score: { version: 1,
  tracks: ['alto_sax', 'erhu', 'jazz_bass'].map((instrument, i) => ({ instrument,
    notes: [{ midi: 60, time: .5 + i, duration: .4, velocity: .8, pan: i === 0 ? -1 : 0 }] })) },
  foley: { version: 1, events: [
    { preset: 'click', time: .25, duration: .1 }, { preset: 'whoosh', time: 1, duration: .4 },
    { preset: 'impact', time: 2, duration: .3 }, { preset: 'noise', time: 3, duration: .5 },
  ] } });
const options = () => ({ pythonRoot, instrumentsRoot, outputDir: root, runtime: { ffmpegPath } });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-score-real-'));
  ({ ffmpegPath } = await resolveLemoUpstreamRenderRuntime({ pythonRoot, cacheDir: root }));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function decode(path: string) {
  const out = path + '.f32';
  const result = await runProcess(ffmpegPath, ['-y', '-hide_banner', '-i', path, '-f', 'f32le', out]);
  expect(result.code).toBe(0);
  expect(result.stderr).toMatch(/48000 Hz, stereo, flt/);
  return readFile(out);
}
function peak(data: Buffer, from: number, to: number, channel = 0) {
  let maximum = 0;
  for (let frame = Math.round(from * 48000); frame < Math.round(to * 48000); frame++) {
    const value = data.readFloatLE(frame * 8 + channel * 4);
    expect(Number.isFinite(value)).toBe(true);
    maximum = Math.max(maximum, Math.abs(value));
  }
  return maximum;
}

describe('trusted data-only sample score renderer', () => {
  it('renders all three actual installed sample instruments and bounded foley at exact offsets', async () => {
    const input = request();
    const snapshot = JSON.stringify(input);
    const result = await renderPiScore(input, options());
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.installedInstruments).toEqual(['alto_sax', 'erhu', 'jazz_bass']);
    expect(result.metadata).toHaveLength(3);
    for (const metadata of result.metadata) {
      expect(metadata).toMatchObject({ frames: 240000, durationSeconds: 5, sampleRate: 48000,
        channels: 2, format: 'float32', nonFiniteSamples: 0 });
      expect(metadata.peakAmplitude).toBeGreaterThan(0);
    }
    expect(result.events[0]).toEqual({ stem: 'music', startFrame: 24000, endFrame: 43200, provenance: 'scheduled' });
    expect(result).not.toHaveProperty('onsets');
    const music = await decode(result.stems.music);
    expect(music.length).toBe(5 * 48000 * 8);
    for (const start of [.5, 1.5, 2.5]) expect(peak(music, start, start + .4)).toBeGreaterThan(.001);
    for (const [from, to] of [[0, .5], [.9, 1.5], [1.9, 2.5], [2.9, 5]]) expect(peak(music, from, to)).toBe(0);
    expect(peak(music, .5, .9, 1)).toBe(0);
    const sfx = await decode(result.stems.sfx);
    for (const [from, to] of [[.25, .35], [1, 1.4], [2, 2.3]]) expect(peak(sfx, from, to)).toBeGreaterThan(.001);
    expect(peak(sfx, 2.3, 5)).toBe(0);
    const ambience = await decode(result.stems.ambience);
    expect(peak(ambience, 0, 3)).toBe(0);
    expect(peak(ambience, 3, 3.5)).toBeGreaterThan(.001);
    expect(peak(ambience, 3.5, 5)).toBe(0);
  }, 60000);

  it('retunes a real sample by one octave instead of substituting a synthetic note', async () => {
    const index = JSON.parse(await readFile(join(instrumentsRoot, 'index.json'), 'utf8'));
    const top = Math.ceil(Math.max(...index.jazz_bass.zones.map((z: { root: number }) => z.root)));
    const input = request();
    input.score.tracks = [{ instrument: 'jazz_bass', notes: [
      { midi: top, time: 0, duration: .4, velocity: .8 },
      { midi: top + 12, time: 1, duration: .4, velocity: .8 },
    ] }];
    input.foley.events = [];
    const result = await renderPiScore(input, options());
    const data = await decode(result.stems.music);
    // Same highest-root zone: at 2x playback rate, waveform positions match every other frame.
    let error = 0, energy = 0;
    for (let i = 300; i < 6000; i++) {
      const original = data.readFloatLE(i * 2 * 8);
      const shifted = data.readFloatLE((48000 + i) * 8);
      error += (original - shifted) ** 2; energy += original ** 2;
    }
    expect(energy).toBeGreaterThan(.01);
    expect(error / energy).toBeLessThan(.0001);
  }, 60000);

  it('rejects arbitrary code, paths, unknown fields, uninstalled names, and resource overflows', async () => {
    for (const instrument of ['../piano', 'C:\\evil.py', '__import__("os")', 'piano']) {
      const input = request(); input.score.tracks[0].instrument = instrument;
      await expect(renderPiScore(input, options())).rejects.toThrow();
    }
    expect(() => piScoreSchema.parse({ ...request().score, code: 'print(1)' })).toThrow();
    expect(() => piFoleySchema.parse({ version: 1, events: [{ preset: 'exec', time: 0, duration: 1 }] })).toThrow();
    for (const bad of [NaN, Infinity, '60', 60.5, true]) {
      const input = request(); (input.score.tracks[0].notes[0] as unknown as { midi: unknown }).midi = bad;
      await expect(renderPiScore(input, options())).rejects.toThrow();
    }
    const input = request(); input.score.tracks[0].notes[0].time = 5;
    await expect(renderPiScore(input, options())).rejects.toThrow('SCORE_TIMING_BOUNDS');
    input.durationSeconds = 198.001;
    await expect(renderPiScore(input, options())).rejects.toThrow();
    const many = request(); many.score.tracks = Array.from({ length: 2 }, () => ({ instrument: 'erhu',
      notes: Array.from({ length: 501 }, () => ({ midi: 60, time: 0, duration: 1, velocity: .8 })) }));
    await expect(renderPiScore(many, options())).rejects.toThrow('SCORE_WORK_LIMIT');
  });

  it('accepts the 198-second boundary and late events without rendering', async () => {
    const input = request(); input.durationSeconds = 198;
    input.score.tracks[0].notes[0] = { midi: 60, velocity: .8, time: 197, duration: 1 };
    input.foley.events = [{ preset: 'noise', time: 0, duration: 198 }];
    const signal = AbortSignal.abort(new Error('duration accepted'));
    await expect(renderPiScore(input, { ...options(), signal })).rejects.toThrow('duration accepted');
    input.durationSeconds = 198.001;
    await expect(renderPiScore(input, { ...options(), signal })).rejects.not.toThrow('duration accepted');
    expect(() => piFoleySchema.parse({ version: 1, events: [{ preset: 'noise', time: 0, duration: 198.001 }] })).toThrow();
    expect(() => piScoreSchema.parse({ version: 1, tracks: [{ instrument: 'erhu', notes: [{ midi: 60, velocity: 1, time: 198.001, duration: .1 }] }] })).toThrow();
    const script = `import runpy, sys
m = runpy.run_path(${JSON.stringify(resolve('services/lemo-audio/render-score.py'))})
score = {'version': 1, 'tracks': []}
for time, duration in [(197, 1), (0, 198)]:
    m['validate'](score, {'version': 1, 'events': [{'preset': 'noise', 'time': time, 'duration': duration}]}, 198, {})
for time, duration in [(198.001, 1), (0, 198.001)]:
    try:
        m['validate'](score, {'version': 1, 'events': [{'preset': 'noise', 'time': time, 'duration': duration}]}, 198, {})
    except ValueError as e:
        assert str(e) == 'SCORE_NUMBER'
    else:
        raise AssertionError('event overflow accepted')
sys.argv = ['render-score.py', '--config', 'unused']
for duration in [198, 198.001]:
    config = {'durationSeconds': duration, 'instrumentsRoot': '.', 'ffmpegPath': 'unused', 'outputDir': '.'}
    def load(path, *args):
        if str(path) == 'unused':
            return config
        raise RuntimeError('duration accepted')
    m['main'].__globals__['load'] = load
    try:
        m['main']()
    except (ValueError, RuntimeError) as e:
        assert str(e) == ('duration accepted' if duration == 198 else 'SCORE_NUMBER')
    else:
        raise AssertionError('expected validation stop')
`;
    const result = await runProcess(join(pythonRoot, 'python.exe'), ['-I', '-B', '-c', script]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('Python independently rejects source/path payloads before producing stems', async () => {
    const dir = await mkdtemp(join(root, 'direct-'));
    await writeFile(join(dir, 'config.json'), JSON.stringify({ durationSeconds: 5, instrumentsRoot, ffmpegPath, outputDir: dir }));
    await writeFile(join(dir, 'foley.json'), JSON.stringify({ version: 1, events: [] }));
    for (const score of [
      { version: 1, tracks: [], code: '__import__("os").system("echo unsafe")' },
      { version: 1, tracks: [{ instrument: '../evil.py', notes: [] }] },
      { version: 1, tracks: [{ instrument: 'erhu', notes: [{ midi: 60, velocity: 1, time: 0, duration: 1, path: 'x.wav' }] }] },
    ]) {
      await writeFile(join(dir, 'score.json'), JSON.stringify(score));
      const result = await runProcess(join(pythonRoot, 'python.exe'), ['-I', '-B', resolve('services/lemo-audio/render-score.py'), '--config', join(dir, 'config.json')]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/SCORE_SCHEMA|SCORE_INSTRUMENT_NOT_INSTALLED/);
    }
  }, 30000);
});
