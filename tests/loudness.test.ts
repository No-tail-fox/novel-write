import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FINAL_FILM_LOUDNESS, describeLoudnessTarget, isUsableLoudnormMeasurement, loudnessOffTarget, loudnormApplyFilter,
  loudnormMeasureFilter, loudnormTargetFilter, parseLoudnormJson, resolveNormalizeAudio,
} from '../src/shared/loudness';
import { createHtmlVideoComposePayload, type HtmlVideoComposition } from '../src/shared/html-video';
import { SIDECAR_OUTPUT_COLOR_ARGS, writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const temp = async (prefix: string) => { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; };

const measurement = { input_i: '-21.75', input_tp: '-18.06', input_lra: '0.00', input_thresh: '-31.75', target_offset: '-0.05' };

describe('shared final-film loudness target', () => {
  it('is −14 LUFS integrated / true peak −1 dB / LRA 11', () => {
    expect(FINAL_FILM_LOUDNESS).toEqual({ integratedLufs: -14, truePeakDb: -1, lra: 11 });
    expect(Object.isFrozen(FINAL_FILM_LOUDNESS)).toBe(true);
    expect(describeLoudnessTarget()).toBe('-14 LUFS，真峰值 ≤ -1 dB');
  });

  it('builds the two-pass loudnorm filters', () => {
    expect(loudnormTargetFilter()).toBe('loudnorm=I=-14:TP=-1:LRA=11');
    expect(loudnormMeasureFilter()).toBe('loudnorm=I=-14:TP=-1:LRA=11:print_format=json');
    expect(loudnormApplyFilter(measurement)).toBe('loudnorm=I=-14:TP=-1:LRA=11:measured_I=-21.75:measured_TP=-18.06:measured_LRA=0.00:measured_thresh=-31.75:offset=-0.05:linear=true');
    expect(loudnormTargetFilter({ integratedLufs: -16, truePeakDb: -1.5, lra: 7 })).toBe('loudnorm=I=-16:TP=-1.5:LRA=7');
    expect(() => loudnormTargetFilter({ integratedLufs: Number.NaN, truePeakDb: -1, lra: 11 })).toThrow('LOUDNESS_TARGET_INVALID');
  });

  it('refuses to build pass 2 from a silent / unusable measurement', () => {
    const silent = { ...measurement, input_i: '-inf', input_tp: '-inf', target_offset: 'inf' };
    expect(isUsableLoudnormMeasurement(measurement)).toBe(true);
    expect(isUsableLoudnormMeasurement(silent)).toBe(false);
    expect(isUsableLoudnormMeasurement({ ...measurement, input_lra: 'nan' })).toBe(false);
    expect(isUsableLoudnormMeasurement({ ...measurement, input_thresh: '' })).toBe(false);
    expect(isUsableLoudnormMeasurement(null)).toBe(false);
    expect(() => loudnormApplyFilter(silent)).toThrow('LOUDNESS_MEASUREMENT_INVALID');
  });

  it('parses the pass-1 JSON and maps silence to a skipped measurement', () => {
    const stderr = '[Parsed_loudnorm_0 @ 01] \r\n{\r\n\t"input_i" : "-21.75",\r\n\t"input_tp" : "-18.06",\r\n\t"input_lra" : "0.00",\r\n\t"input_thresh" : "-31.75",\r\n\t"output_i" : "-13.95",\r\n\t"target_offset" : "-0.05"\r\n}\r\n';
    expect(parseLoudnormJson(stderr)).toEqual({ measurement });
    expect(parseLoudnormJson('[Parsed_loudnorm_0 @ 01] \n{\n\t"input_i" : "-inf",\n\t"input_tp" : "-inf",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-70.00",\n\t"target_offset" : "inf"\n}\n')).toEqual({ measurement: null });
    expect(parseLoudnormJson('Stream map 0:a:0 matches no streams')).toBeNull();
  });

  it('flags results outside target ±1 LU or above the −1 dB true-peak ceiling', () => {
    expect(loudnessOffTarget({ integratedLufs: -14.2, truePeak: -1.3 })).toBe(false);
    expect(loudnessOffTarget({ integratedLufs: -13.1, truePeak: -1 })).toBe(false);
    expect(loudnessOffTarget({ integratedLufs: -16, truePeak: -2 })).toBe(true);
    expect(loudnessOffTarget({ integratedLufs: -12.5, truePeak: -2 })).toBe(true);
    expect(loudnessOffTarget({ integratedLufs: -14, truePeak: -0.8 })).toBe(true);
  });
});

describe('normalizeAudio default resolution', () => {
  it('is on unless explicitly disabled', () => {
    expect(resolveNormalizeAudio(undefined)).toBe(true);
    expect(resolveNormalizeAudio(null)).toBe(true);
    expect(resolveNormalizeAudio(true)).toBe(true);
    expect(resolveNormalizeAudio(false)).toBe(false);
  });

  const composition = (extra: Partial<HtmlVideoComposition> = {}): HtmlVideoComposition => ({
    workDir: 'C:/work', outputPath: 'C:/out.mp4', title: 'test', fps: 24, canvas_w: 1920, canvas_h: 1080, totalDurationS: 1,
    scenes: [{ sceneId: 1, title: 'shot', caption: '', description: '', imagePath: 'C:/image.png', audioPath: 'C:/voice.wav', html: '<html></html>', durationMs: 1000, duration: 1 }],
    ...extra,
  });
  const captured = [{ sceneId: 1, framesDir: 'C:/frames', audioPath: 'C:/voice.wav', fps: 24 }];

  it('HTML / template compose payloads normalise by default', () => {
    expect(createHtmlVideoComposePayload(composition(), captured).normalize_audio).toBe(true);
    expect(createHtmlVideoComposePayload(composition({ normalizeAudio: true }), captured).normalize_audio).toBe(true);
  });

  it('respects an explicit normalizeAudio: false (old projects / Music MVs)', () => {
    const payload = createHtmlVideoComposePayload(composition({ normalizeAudio: false }), captured);
    expect(payload.normalize_audio).toBeUndefined();
    expect('normalize_audio' in payload).toBe(false);
  });
});

describe('Python sidecar uses the shared target and keeps colour tags', () => {
  it('embeds the shared −14 / −1 loudnorm target and no legacy −16 / −1.5 values', async () => {
    const script = await readFile(await writeStoryboundSidecarScript(await temp('loudness-script-')), 'utf8');
    expect(script).toContain('LOUDNORM_TARGET_FILTER = "loudnorm=I=-14:TP=-1:LRA=11"');
    expect(script).toContain('LOUDNORM_MEASURE_FILTER = "loudnorm=I=-14:TP=-1:LRA=11:print_format=json"');
    expect(script).not.toMatch(/loudnorm=I=-16|TP=-1\.5/);
    expect(script).toContain(`OUTPUT_COLOR_ARGS = ${JSON.stringify([...SIDECAR_OUTPUT_COLOR_ARGS]).replace(/","/g, '", "')}`);
  });

  it('writes the colour tags on the duration-padding re-encode and every other composition re-encode', async () => {
    const dir = await temp('loudness-compose-args-');
    const script = await writeStoryboundSidecarScript(dir);
    const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import json, os, runpy, sys
namespace = runpy.run_path(sys.argv[1])
compose = namespace['generate_compose_render']
calls = []
def fake_ffmpeg(args, **kwargs):
    calls.append([str(value) for value in args])
    with open(args[-1], 'wb') as handle:
        handle.write(b'x')
compose.__globals__['run_ffmpeg'] = fake_ffmpeg
root = sys.argv[2]
segments = []
for index in range(2):
    path = os.path.join(root, f'segment-{index}.mp4')
    with open(path, 'wb') as handle:
        handle.write(b'x')
    segments.append(path)
cover = os.path.join(root, 'cover.png')
with open(cover, 'wb') as handle:
    handle.write(b'x')
scenes = [{'segment_path': path, 'fps': 10, 'duration_s': 1.0, 'video_frame_count': 10} for path in segments]
for name, extra in [('pad', {'scenes': scenes[:1]}), ('cut', {'scenes': scenes, 'transition': {'type': 'cut', 'duration': 0}, 'cover_path': cover, 'cover_duration_s': 0.5}),
                    ('xfade', {'scenes': scenes, 'transition': {'type': 'fade', 'duration': 0.2}}),
                    ('dissolve', {'scenes': [scenes[0], {**scenes[1], 'transition_in': {'type': 'dissolve', 'durationMs': 200}}]})]:
    compose({'work_dir': os.path.join(root, name), 'output_path': os.path.join(root, name + '.mp4'), 'total_duration_s': 2.5, **extra})
print(json.dumps(calls))
`, script, dir], { cwd: dir, timeoutMs: 30_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 65536 });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const calls = JSON.parse(result.stdout) as string[][];
    const encodes = calls.filter(args => args.includes('libx264'));
    const padding = encodes.filter(args => args.some(value => value.startsWith('tpad=stop_mode=clone:stop_duration=2.5')));
    expect(padding).toHaveLength(4);
    expect(encodes.length).toBeGreaterThanOrEqual(8);
    const colourWindow = (args: string[]) => { const at = args.indexOf('-color_range'); return at < 0 ? [] : args.slice(at, at + SIDECAR_OUTPUT_COLOR_ARGS.length); };
    for (const args of encodes) expect(colourWindow(args)).toEqual([...SIDECAR_OUTPUT_COLOR_ARGS]);
    const cover = encodes.find(args => args.some(value => value.endsWith('seg_cover.mp4')))!;
    expect(cover[cover.indexOf('-vf') + 1]).toContain('out_range=tv:out_color_matrix=bt709');
  });

  it('skips normalisation for no-audio and silent films and applies the shared two-pass target otherwise', async () => {
    const dir = await temp('loudness-normalize-');
    const script = await writeStoryboundSidecarScript(dir);
    const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import json, os, runpy, sys, types
namespace = runpy.run_path(sys.argv[1])
normalize = namespace['normalize_composed_audio']
g = normalize.__globals__
root = sys.argv[2]
source = os.path.join(root, 'source.mp4')
with open(source, 'wb') as handle:
    handle.write(b'source')
measured = '[Parsed_loudnorm_0 @ 01]\\n{\\n "input_i" : "-21.75",\\n "input_tp" : "-18.06",\\n "input_lra" : "0.00",\\n "input_thresh" : "-31.75",\\n "target_offset" : "-0.05"\\n}\\n'
silent = '[Parsed_loudnorm_0 @ 01]\\n{\\n "input_i" : "-inf",\\n "input_tp" : "-inf",\\n "input_lra" : "0.00",\\n "input_thresh" : "-70.00",\\n "target_offset" : "inf"\\n}\\n'
report = {}
for name, has_audio, stderr in [('no-audio', False, None), ('silent', True, silent), ('measured', True, measured)]:
    analyses, encodes = [], []
    g['media_stream_info'] = lambda path, has_audio=has_audio: {'has_audio': has_audio, 'has_video': True}
    def analyse(args, stderr=stderr, analyses=analyses, **kwargs):
        analyses.append([str(value) for value in args])
        return types.SimpleNamespace(returncode=0, stdout='', stderr=stderr)
    def encode(args, encodes=encodes, **kwargs):
        encodes.append([str(value) for value in args])
        with open(args[-1], 'wb') as handle:
            handle.write(b'normalized')
    g['run_bounded_subprocess'] = analyse
    g['run_ffmpeg'] = encode
    output = os.path.join(root, name + '.mp4')
    normalize(source, output, 2.0)
    with open(output, 'rb') as handle:
        report[name] = {'analyses': analyses, 'encodes': encodes, 'output': handle.read().decode()}
print(json.dumps(report))
`, script, dir], { cwd: dir, timeoutMs: 30_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 65536 });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, { analyses: string[][]; encodes: string[][]; output: string }>;
    expect(report['no-audio']).toEqual({ analyses: [], encodes: [], output: 'source' });
    expect(report.silent.analyses).toHaveLength(1);
    expect(report.silent).toMatchObject({ encodes: [], output: 'source' });
    const [analysis] = report.measured.analyses;
    expect(analysis[analysis.indexOf('-af') + 1]).toBe(loudnormMeasureFilter());
    const [encode] = report.measured.encodes;
    expect(encode[encode.indexOf('-af') + 1]).toBe(`${loudnormTargetFilter()}:measured_I=-21.75:measured_TP=-18.06:measured_LRA=0.0:measured_thresh=-31.75:offset=-0.05:linear=true,apad,atrim=duration=2.0`);
    expect(report.measured.output).toBe('normalized');
  });
});
