import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ BrowserWindow: class {}, session: {} }));
import {
  buildLemoUpstreamVideoEnv, buildMuxArgs, decodeDamage, ebur128OffTarget, lastProgressSeconds, lemoFilmGrain, parseEbur128,
  parseFfmpegProbe, parseLoudnormJson, resolveLemoUpstreamRenderRuntime, type LemoUpstreamRenderRuntime,
} from '../electron/lemo-upstream-video';
import { parseUpstreamPageLog } from '../electron/lemo-upstream-renderer';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const temp = async () => { const root = await mkdtemp(join(tmpdir(), 'lemo-video-unit-')); roots.push(root); return root; };

const LOUDNORM = `size=N/A time=00:00:02.90 bitrate=N/A speed=50x\r
out_time=00:00:02.900000\r
[Parsed_loudnorm_0 @ 0000020e9b3743c0] \r
{\r
\t"input_i" : "-21.75",\r
\t"input_tp" : "-18.06",\r
\t"input_lra" : "0.00",\r
\t"input_thresh" : "-31.75",\r
\t"output_i" : "-13.95",\r
\t"output_tp" : "-10.27",\r
\t"output_lra" : "0.00",\r
\t"output_thresh" : "-23.95",\r
\t"normalization_type" : "dynamic",\r
\t"target_offset" : "-0.05"\r
}\r
[out#0/null @ 0000020e9b3743c0] video:0KiB audio:1125KiB\r
out_time=00:00:03.000000\r
progress=end\r
`;
const SILENT = `[Parsed_loudnorm_0 @ 000001] \n{\n\t"input_i" : "-inf",\n\t"input_tp" : "-inf",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-70.00",\n\t"target_offset" : "inf"\n}\n`;
const EBUR = `[Parsed_ebur128_0 @ 01] t: 2.999977   TARGET:-23 LUFS    M: -21.8 S: -21.8     I: -21.8 LUFS       LRA:  20.0 LU  FTPK: -18.1 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 01] Summary:

  Integrated loudness:
    I:         -14.1 LUFS
    Threshold: -24.8 LUFS

  Loudness range:
    LRA:         3.2 LU
    Threshold: -34.8 LUFS
    LRA low:   -16.0 LUFS
    LRA high:  -12.9 LUFS

  True peak:
    Peak:       -1.4 dBFS
`;

describe('mux.sh port: pure builders', () => {
  it('parses the loudnorm JSON and detects silence like mux.sh', () => {
    expect(parseLoudnormJson(LOUDNORM)).toEqual({ measurement: { input_i: '-21.75', input_tp: '-18.06', input_lra: '0.00', input_thresh: '-31.75', target_offset: '-0.05' } });
    expect(parseLoudnormJson(SILENT)).toEqual({ measurement: null });
    expect(parseLoudnormJson('Error opening input file')).toBeNull();
    expect(lastProgressSeconds(LOUDNORM)).toBe(3);
    expect(lastProgressSeconds('out_time=-577014:32:22.775808')).toBe(0);
  });

  it('builds the exact mux.sh ffmpeg command (single film with audio, short audio padded)', () => {
    const measurement = parseLoudnormJson(LOUDNORM)!.measurement;
    const args = buildMuxArgs({ videoPath: 'in.mp4', outputPath: 'out.mp4', fps: 30, grain: 2, loudnorm: measurement, padToSeconds: 12.5, hasAudio: true });
    expect(args).toEqual(['-y', '-loglevel', 'error', '-i', 'in.mp4',
      '-filter_complex', '[0:v]fps=30,noise=c0s=2:allf=t,format=yuv420p[v];[0:a:0]loudnorm=I=-14:TP=-1.2:LRA=11:measured_I=-21.75:measured_TP=-18.06:measured_LRA=0.00:measured_thresh=-31.75:offset=-0.05:linear=true,aresample=48000,apad=whole_dur=12.5[a]',
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-r', '30', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', 'out.mp4']);
  });

  it('supports the original two-input form, grain 0, silence and LEMO_COLOR=bt709', () => {
    const args = buildMuxArgs({ videoPath: 'v.mp4', audioPath: 'mix.wav', outputPath: 'o.mp4', fps: 24, grain: 0, loudnorm: null, padToSeconds: null, hasAudio: true, color: 'bt709' });
    expect(args.slice(3, 7)).toEqual(['-i', 'v.mp4', '-i', 'mix.wav']);
    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:v]fps=24,scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[v];[1:a]anull,aresample=48000[a]');
    expect(args).toEqual(expect.arrayContaining(['-color_range', 'tv', '-colorspace', 'bt709']));
  });

  it('applies picture-only treatment when the film has no audio', () => {
    const args = buildMuxArgs({ videoPath: 'v.mp4', outputPath: 'o.mp4', fps: 30, grain: 2, loudnorm: null, padToSeconds: null, hasAudio: false });
    expect(args).toEqual(['-y', '-loglevel', 'error', '-i', 'v.mp4', '-filter_complex', '[0:v]fps=30,noise=c0s=2:allf=t,format=yuv420p[v]', '-map', '[v]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-r', '30', '-an', '-movflags', '+faststart', 'o.mp4']);
    expect(() => buildMuxArgs({ videoPath: 'v', outputPath: 'o', fps: 0, grain: 2, loudnorm: null, padToSeconds: null, hasAudio: false })).toThrow('LEMO_UPSTREAM_MUX_FAILED');
  });

  it('parses the ebur128 summary (not the per-frame lines) and flags off-target films', () => {
    const summary = parseEbur128(EBUR);
    expect(summary).toEqual({ integratedLufs: -14.1, lra: 3.2, truePeak: -1.4 });
    expect(ebur128OffTarget(summary)).toBe(false);
    expect(ebur128OffTarget({ integratedLufs: -15.2, lra: 0, truePeak: -9.8 })).toBe(true);
    expect(ebur128OffTarget({ integratedLufs: -14, lra: 0, truePeak: -0.5 })).toBe(true);
    expect(parseEbur128('Summary:\n    I:         -inf LUFS\n    LRA:   0.0 LU\n    Peak:  -inf dBFS').integratedLufs).toBe(-Infinity);
  });

  it('treats only non-benign decoder errors as damage', () => {
    expect(decodeDamage('[wav @ 01] Ignoring maximum wav data size, file may be invalid\n[aist#0:0/pcm_s16le @ 02] corrupt input packet in stream 0').bad).toEqual([]);
    expect(decodeDamage('[mp3float @ 01] Header missing\n[mp3 @ 02] invalid frame').bad).toHaveLength(2);
  });

  it('parses ffmpeg -i output instead of ffprobe', () => {
    const probe = parseFfmpegProbe(`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:00:01.00, start: 0.000000, bitrate: 77 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x180 [SAR 1:1 DAR 16:9], 3 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 70 kb/s (default)
At least one output file must be specified`);
    expect(probe).toEqual({ durationSeconds: 1, video: { codec: 'h264', width: 320, height: 180, fps: 30 }, audio: { codec: 'aac', sampleRate: 48000 } });
    expect(parseFfmpegProbe("Input #0, mov, from 'x':\n  Duration: N/A\n  Stream #0:0: Video: h264, yuvj420p(pc, bt470bg/unknown/unknown), 1920x1080, 24 fps").audio).toBeNull();
  });

  it('collects upstream page warnings and optional-file 404s from video.mjs stderr', () => {
    const log = parseUpstreamPageLog('[page] optional file missing: http://127.0.0.1:5555/@film/voices/dur.json (404, requested by fetch/xhr; fine if the page has a fallback)\n[note] WebGL runs on software rendering\nw0 0/30  1s');
    expect(log.missingResources).toEqual([{ path: '/@film/voices/dur.json', status: 404 }]);
    expect(log.warnings).toEqual(['[note] WebGL runs on software rendering']);
  });

  it('chooses grain 0 for pixel/vector/flat styles', async () => {
    const root = await temp();
    expect(await lemoFilmGrain(root)).toBe(2);
    await writeFile(join(root, 'TREATMENT.md'), 'Warm paper collage, soft light.');
    expect(await lemoFilmGrain(root)).toBe(2);
    await writeFile(join(root, 'STYLE.md'), '# 8-bit pixel art adventure');
    expect(await lemoFilmGrain(root)).toBe(0);
    await writeFile(join(root, 'STYLE.md'), '扁平矢量插画');
    expect(await lemoFilmGrain(root)).toBe(0);
    expect(await lemoFilmGrain(join(root, 'missing'))).toBe(2);
  });
});

describe('render runtime resolution', () => {
  const sp = (root: string, ...parts: string[]) => join(root, 'Lib', 'site-packages', ...parts);
  it.skipIf(process.platform !== 'win32')('reports each missing bundled component in Chinese', async () => {
    const root = await temp(), cacheDir = join(root, 'cache');
    await expect(resolveLemoUpstreamRenderRuntime({ pythonRoot: '', cacheDir })).rejects.toThrow(/^LEMO_UPSTREAM_RENDER_ENV: 未提供/);
    await expect(resolveLemoUpstreamRenderRuntime({ pythonRoot: join(root, 'nope'), cacheDir })).rejects.toThrow('LEMO_UPSTREAM_RENDER_ENV: 找不到随应用打包的 Python');
    await mkdir(sp(root, 'playwright', 'driver', 'package'), { recursive: true });
    await expect(resolveLemoUpstreamRenderRuntime({ pythonRoot: root, cacheDir })).rejects.toThrow('Node 运行时');
    await writeFile(sp(root, 'playwright', 'driver', 'node.exe'), 'node');
    await expect(resolveLemoUpstreamRenderRuntime({ pythonRoot: root, cacheDir })).rejects.toThrow('playwright-core');
    await writeFile(sp(root, 'playwright', 'driver', 'package', 'package.json'), JSON.stringify({ name: 'playwright-core' }));
    await writeFile(sp(root, 'playwright', 'driver', 'package', 'index.mjs'), '');
    await writeFile(sp(root, 'playwright', 'driver', 'package', 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '1243' }] }));
    await expect(resolveLemoUpstreamRenderRuntime({ pythonRoot: root, cacheDir })).rejects.toThrow('chromium_headless_shell-1243');
    await mkdir(join(root, 'playwright-browsers', 'chromium_headless_shell-1243'), { recursive: true });
    await expect(resolveLemoUpstreamRenderRuntime({ pythonRoot: root, cacheDir })).rejects.toThrow('ffmpeg');
    await mkdir(sp(root, 'imageio_ffmpeg', 'binaries'), { recursive: true });
    await writeFile(sp(root, 'imageio_ffmpeg', 'binaries', 'ffmpeg-win-x86_64-v7.1.exe'), 'fake-ffmpeg-bytes');
    const runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: root, cacheDir });
    expect(runtime.ffmpegDir.startsWith(cacheDir)).toBe(true);
    const again = await resolveLemoUpstreamRenderRuntime({ pythonRoot: root, cacheDir });
    expect(again.ffmpegDir).toBe(runtime.ffmpegDir);
    const { stat } = await import('node:fs/promises');
    expect((await stat(join(runtime.ffmpegDir, 'ffmpeg.exe'))).size).toBe('fake-ffmpeg-bytes'.length);
  });

  it('puts the ffmpeg alias first on PATH and strips host overrides', () => {
    const runtime = { ffmpegDir: 'C:\\cache\\ffmpeg-bin\\x', browsersPath: 'C:\\py\\playwright-browsers' } as LemoUpstreamRenderRuntime;
    const env = buildLemoUpstreamVideoEnv(runtime, { Path: 'C:\\Windows', NODE_OPTIONS: '--inspect', PLAYWRIGHT_CHROME: 'x', KEEP: '1' });
    expect(env.PATH?.startsWith('C:\\cache\\ffmpeg-bin\\x')).toBe(true);
    expect(env.PATH).toContain('C:\\Windows');
    expect(env.Path).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PLAYWRIGHT_CHROME).toBeUndefined();
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('C:\\py\\playwright-browsers');
    expect(env.KEEP).toBe('1');
  });
});
