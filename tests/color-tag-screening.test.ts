/**
 * C-3 colour-tag screening (docs/design/2026-11-10-color-tag-screening.md).
 *
 * Every in-repo video encoder is driven through its real exported builder / the real sidecar script with the bundled
 * imageio ffmpeg 7.1, and the output is read three ways:
 *   1. `ffmpeg -i` stream line parsed by the final-film gate's own parser (parseFfmpegInfo — no ffprobe ships);
 *   2. the H.264 SPS VUI itself (trace_headers bitstream filter);
 *   3. the FINAL_GATE_COLOR row of evaluateFinalFilmGate.
 * Skipped when the bundled ffmpeg is missing.
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveFinalFilmFfmpeg } from '../electron/final-film-gate-runner';
import { buildH264ColorMetadataFilter, buildLemoColorRetagArgs, buildMuxArgs, LEMO_FAITHFUL_COLOR_RETAG, retagLemoFilmColorMetadata } from '../electron/lemo-upstream-video';
import { muxVideoSpecFilm, renderStillSceneSegment, renderVideoSceneSegment } from '../electron/video-spec-executor-runtime';
import { evaluateFinalFilmGate, parseFfmpegInfo, type FinalFilmCheckStatus } from '../src/shared/final-film-gate';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { runStoryboundMediaSidecar, SIDECAR_OUTPUT_COLOR_TAG_FILTER, writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';

const pythonRoot = join(resolve(__dirname, '..'), 'vendor', 'python');
const ffmpegPath = (await resolveFinalFilmFfmpeg({ pythonRoot, ffprobePath: null }))?.ffmpegPath ?? null;

const W = 64, H = 36, FPS = 24;
/** What every sidecar / video-spec encode intends (SIDECAR_OUTPUT_COLOR_ARGS). */
const SRGB709 = { range: 'tv', space: 'bt709', primaries: 'bt709', transfer: 'iec61966-2-1' };
const SRGB709_VUI = { fullRange: 0, primaries: 1, transfer: 13, matrix: 1 };
/** What ffmpeg 7.1 writes from the output args alone. */
const ARGS_ONLY = { range: 'tv', space: 'bt709', primaries: 'unknown', transfer: 'unknown' };

function ff(args: string[]) {
  const result = spawnSync(ffmpegPath!, ['-hide_banner', '-y', ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${result.stderr}`);
  return result;
}

interface ColorReport {
  tags: { range: string | null; space: string | null; primaries: string | null; transfer: string | null };
  vui: { fullRange: number | null; primaries: number | null; transfer: number | null; matrix: number | null };
  gate: FinalFilmCheckStatus;
  gateDetail: string;
}

function colorOf(path: string): ColorReport {
  const info = spawnSync(ffmpegPath!, ['-hide_banner', '-i', path], { windowsHide: true, encoding: 'utf8' }).stderr;
  const probe = parseFfmpegInfo(info);
  const v = probe?.video;
  const trace = ff(['-i', path, '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'trace_headers', '-frames:v', '1', '-f', 'null', '-']).stderr;
  const field = (name: string) => { const m = new RegExp(`\\b${name}\\s+[01]+\\s+=\\s+(\\d+)`).exec(trace); return m ? Number(m[1]) : null; };
  const gate = evaluateFinalFilmGate({ expected: { durationMs: 1000, fps: FPS, width: W, height: H, audioExpected: false }, probe }).checks.find(row => row.code === 'FINAL_GATE_COLOR')!;
  return {
    tags: { range: v?.colorRange ?? null, space: v?.colorSpace ?? null, primaries: v?.colorPrimaries ?? null, transfer: v?.colorTransfer ?? null },
    vui: { fullRange: field('video_full_range_flag'), primaries: field('colour_primaries'), transfer: field('transfer_characteristics'), matrix: field('matrix_coefficients') },
    gate: gate.status, gateDetail: gate.detail,
  };
}

function expectSrgb709(path: string) {
  const report = colorOf(path);
  expect(report.tags, path).toEqual(SRGB709);
  expect(report.vui, path).toEqual(SRGB709_VUI);
  expect(report.gate, report.gateDetail).toBe('pass');
  return report;
}

/** md5 of the decoded video frames (pixels), independent of container/VUI metadata. */
const pixelMd5 = (path: string) => /MD5=([0-9a-f]+)/.exec(ff(['-i', path, '-map', '0:v:0', '-f', 'md5', '-']).stdout)![1];
/** Per-packet hashes of every stream, stream-copied (coded slice data / audio frames), without the header lines. */
const packetHashes = (path: string) => ff(['-i', path, '-map', '0', '-c', 'copy', '-f', 'framemd5', '-']).stdout.split(/\r?\n/).filter(line => line && !line.startsWith('#'));

/** The `colr` box inside `moov`, if any (mp4 muxer writes it only when all three of primaries/trc/matrix are set). */
function colrBox(path: string) {
  const bytes = readFileSync(path);
  const moov = bytes.indexOf(Buffer.from('moov'));
  const at = moov < 0 ? -1 : bytes.indexOf(Buffer.from('colr'), moov);
  if (at < 0 || at > moov + bytes.readUInt32BE(moov - 4)) return null;
  return { type: bytes.toString('latin1', at + 4, at + 8), primaries: bytes.readUInt16BE(at + 8), transfer: bytes.readUInt16BE(at + 10), matrix: bytes.readUInt16BE(at + 12), fullRange: bytes[at + 14] >> 7 };
}

const python = (code: string, args: string[]) => runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', code, ...args],
  { cwd: tmpdir(), timeoutMs: 120_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });

describe('buildH264ColorMetadataFilter (opt-in Lemo VUI retag)', () => {
  it('maps tag names to H.264 VUI code points and rejects nonsense', () => {
    expect(buildH264ColorMetadataFilter(LEMO_FAITHFUL_COLOR_RETAG)).toBe('h264_metadata=colour_primaries=1:transfer_characteristics=13');
    expect(buildH264ColorMetadataFilter({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' })).toBe('h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1');
    expect(buildH264ColorMetadataFilter({ range: 'tv', matrix: 'bt470bg' })).toBe('h264_metadata=video_full_range_flag=0:matrix_coefficients=5');
    expect(() => buildH264ColorMetadataFilter({})).toThrow(/LEMO_COLOR_RETAG_INVALID/);
    expect(() => buildH264ColorMetadataFilter({ primaries: 'toString' as never })).toThrow(/LEMO_COLOR_RETAG_INVALID/);
    const args = buildLemoColorRetagArgs('in.mp4', 'out.mp4');
    expect(args).toEqual(['-y', '-hide_banner', '-loglevel', 'error', '-i', 'in.mp4', '-map', '0', '-c', 'copy', '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=13', '-movflags', '+faststart', 'out.mp4']);
    expect(args).not.toContain('libx264');
  });
});

describe.skipIf(!ffmpegPath)('colour-tag screening with the bundled ffmpeg 7.1', () => {
  let dir = '';
  let frames = '', voice = '', bgm = '', still = '', untagged = '', mjpeg = '';
  /** A real sidecar scene segment (encode_render_scene), reused as tagged input. */
  let segment = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'color-tag-screening-'));
    frames = join(dir, 'frames');
    await mkdir(frames);
    ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=0.5`, '-q:v', '2', join(frames, 'frame_%04d.jpg')]);
    voice = join(dir, 'voice.wav');
    ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5:sample_rate=44100', '-ac', '2', voice]);
    bgm = join(dir, 'bgm.wav');
    ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3:sample_rate=44100', '-ac', '2', bgm]);
    still = join(dir, 'still.png');
    ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=1`, '-frames:v', '1', still]);
    untagged = join(dir, 'untagged.mp4');
    ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=0.5`, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.5:sample_rate=44100',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', untagged]);
    // Browser-capture JPEG stream exactly as the Lemo upstream video.mjs pipes it to ffmpeg.
    const jpegs = (await readdir(frames)).filter(name => name.endsWith('.jpg')).sort();
    mjpeg = join(dir, 'capture.mjpeg');
    await writeFile(mjpeg, Buffer.concat(await Promise.all(jpegs.map(name => readFile(join(frames, name))))));
    segment = join(dir, 'segment.mp4');
    await runStoryboundMediaSidecar({ mode: 'encode_render_scene', work_dir: join(dir, 'encode'), output_path: segment,
      scene: { frames_dir: frames, audio_path: voice, fps: FPS, duration_s: 0.5, video_frame_count: 12 } });
  }, 120_000);

  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 }); });

  it('bundled ffmpeg 7.1: output colour args alone lose primaries/transfer; frame tags (setparams) keep them', () => {
    const args = ['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=0.5`, '-pix_fmt', 'yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-c:v', 'libx264'];
    const argsOnly = join(dir, 'args-only.mp4');
    ff([...args, argsOnly]);
    const lost = colorOf(argsOnly);
    expect(lost.tags).toEqual(ARGS_ONLY);
    expect(lost.vui).toEqual({ fullRange: 0, primaries: 2, transfer: 2, matrix: 1 });
    expect(lost.gate).toBe('warn');
    const withFrames = join(dir, 'setparams.mp4');
    ff([...args.slice(0, 4), '-vf', 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1', ...args.slice(4), withFrames]);
    expectSrgb709(withFrames);
    // The trailing primaries/transfer-only stamp used by the sidecar compositions is enough on top of the args.
    const stamped = join(dir, 'stamp.mp4');
    ff([...args.slice(0, 4), '-vf', SIDECAR_OUTPUT_COLOR_TAG_FILTER, ...args.slice(4), stamped]);
    expectSrgb709(stamped);
    expect(pixelMd5(stamped)).toBe(pixelMd5(argsOnly));
  }, 60_000);

  it('sidecar encode_render_scene (HTML video / director / VOX / short video / Lemo capture segments)', () => {
    expectSrgb709(segment);
    expect(colrBox(segment)).toEqual({ type: 'nclx', ...SRGB709_VUI });
  });

  it.each([
    ['hard cut', { transition: 'cut' as const }, false],
    ['xfade', { transition: { type: 'fade', duration: 0.2 } }, false],
    ['dissolve (visual transition)', { transition: 'cut' as const }, true],
  ])('sidecar compose_render — %s, cover, duration pad, BGM remix (-c:v copy) and loudness pass (-c:v copy)', async (name, extra, dissolve) => {
    const output = join(dir, `compose-${name.replace(/\W+/g, '-')}.mp4`);
    await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: join(dir, `compose-work-${name.replace(/\W+/g, '-')}`), output_path: output,
      scenes: [
        { frames_dir: frames, audio_path: voice, fps: FPS, duration_s: 0.5 },
        { frames_dir: frames, audio_path: voice, fps: FPS, duration_s: 0.5, ...(dissolve ? { transition_in: { type: 'dissolve' as const, durationMs: 200 } } : {}) },
      ],
      cover_path: still, cover_duration_s: 0.5, canvas_w: W, canvas_h: H, total_duration_s: 1.75, bgm_path: bgm, normalize_audio: true, ...extra });
    expectSrgb709(output);
  }, 120_000);

  it('sidecar hard-cut groups (> 8 scenes): grouped re-encodes joined by the concat demuxer with -c:v copy', async () => {
    const output = join(dir, 'compose-groups.mp4');
    await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: join(dir, 'compose-groups-work'), output_path: output, transition: 'cut',
      scenes: Array.from({ length: 9 }, () => ({ segment_path: segment, duration_s: 0.5, fps: FPS, video_frame_count: 12 })) });
    expectSrgb709(output);
  }, 120_000);

  it('sidecar composition re-encodes stamp primaries/transfer even for untagged inputs, and the stamp changes no pixel', async () => {
    const script = await writeStoryboundSidecarScript(join(dir, 'namespace'));
    const out = join(dir, 'stamp-proof');
    await mkdir(out);
    const result = await python(String.raw`
import json, os, runpy, sys
ns = runpy.run_path(sys.argv[1])
src, out = sys.argv[2], sys.argv[3]
g = ns['_compose_with_hard_cuts'].__globals__
assert g['OUTPUT_COLOR_TAG_FILTER'] == sys.argv[4], g['OUTPUT_COLOR_TAG_FILTER']
rows = []
for stamp in [g['OUTPUT_COLOR_TAG_FILTER'], 'null']:
    g['OUTPUT_COLOR_TAG_FILTER'] = stamp
    key = 'stamped' if stamp != 'null' else 'bare'
    paths = {}
    paths['hardcut'] = os.path.join(out, f'hardcut-{key}.mp4'); ns['_compose_with_hard_cuts']([src, src], paths['hardcut'], [0.5, 0.5], 24)
    paths['xfade'] = os.path.join(out, f'xfade-{key}.mp4'); ns['_compose_xfade_batch']([src, src], paths['xfade'], 'fade', 0.2, [0.5, 0.5])
    paths['dissolve'] = os.path.join(out, f'dissolve-{key}.mp4'); ns['_compose_with_visual_transitions']([src, src], paths['dissolve'], [0.5, 0.5], [None, {'type': 'dissolve', 'durationMs': 200}], 24)
    work = os.path.join(out, f'pad-{key}'); os.makedirs(work)
    paths['pad'] = os.path.join(out, f'pad-{key}.mp4'); ns['generate_compose_render']({'work_dir': work, 'output_path': paths['pad'], 'total_duration_s': 0.75, 'scenes': [{'segment_path': src, 'duration_s': 0.5, 'fps': 24}]})
    rows.append({'stamp': key, 'paths': paths})
g['OUTPUT_COLOR_TAG_FILTER'] = sys.argv[4]
print(json.dumps(rows))
`, [script, untagged, out, SIDECAR_OUTPUT_COLOR_TAG_FILTER]);
    expect(result.code, result.stderr).toBe(0);
    const [stamped, bare] = JSON.parse(result.stdout) as Array<{ stamp: string; paths: Record<string, string> }>;
    for (const step of ['hardcut', 'xfade', 'dissolve', 'pad']) {
      expectSrgb709(stamped.paths[step]);
      // Pre-fix behaviour on the same input: ffmpeg 7.1 writes only range + matrix from SIDECAR_OUTPUT_COLOR_ARGS.
      expect(colorOf(bare.paths[step]).tags, step).toEqual(ARGS_ONLY);
      expect(pixelMd5(stamped.paths[step]), step).toBe(pixelMd5(bare.paths[step]));
    }
  }, 180_000);

  it('sidecar normalize_scene_video is a pass-through intermediate: it keeps whatever the source carries', async () => {
    const tagged = join(dir, 'normalized-tagged.mp4'), plain = join(dir, 'normalized-untagged.mp4');
    await runStoryboundMediaSidecar({ mode: 'normalize_scene_video', work_dir: join(dir, 'normalize'), video_path: segment, output_path: tagged });
    await runStoryboundMediaSidecar({ mode: 'normalize_scene_video', work_dir: join(dir, 'normalize'), video_path: untagged, output_path: plain });
    expectSrgb709(tagged);
    expect(colorOf(plain).tags).toEqual({ range: null, space: null, primaries: null, transfer: null });
  }, 120_000);

  it('video-spec executor runtime: still / video scene segments and the film mux', async () => {
    const stillSegment = join(dir, 'vs', 'still.mp4'), videoSegment = join(dir, 'vs', 'video.mp4'), film = join(dir, 'vs', 'film.mp4');
    await renderStillSceneSegment({ ffmpegPath: ffmpegPath!, imagePath: still, width: W, height: H, fps: FPS, frames: 12, outputPath: stillSegment });
    await renderVideoSceneSegment({ ffmpegPath: ffmpegPath!, imagePath: untagged, width: W, height: H, fps: FPS, frames: 12, outputPath: videoSegment, trimStartSeconds: 0, fit: 'cover' });
    expectSrgb709(stillSegment);
    expectSrgb709(videoSegment);
    await muxVideoSpecFilm({ ffmpegPath: ffmpegPath!, segmentPaths: [stillSegment, videoSegment], audioPath: bgm, outputPath: film, fps: FPS, totalFrames: 24 });
    expectSrgb709(film);
  }, 120_000);

  describe('Lemo', () => {
    let rawPicture = '', faithful = '';

    beforeAll(() => {
      // vendor/lemo-upstream/core/render/video.mjs:48-49 (vendor script, not importable): JPEG pipe → x264, then concat -c copy.
      rawPicture = join(dir, 'lemo-video-mjs.mp4');
      ff(['-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', mjpeg, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', rawPicture]);
      faithful = join(dir, 'lemo-faithful.mp4');
      ff(buildMuxArgs({ videoPath: rawPicture, audioPath: voice, outputPath: faithful, fps: FPS, grain: 2, loudnorm: null, padToSeconds: null, hasAudio: true }));
    }, 60_000);

    it('raw video.mjs picture and the faithful mux of it: full-range BT.601, primaries/transfer unknown (gate fails on range/matrix)', () => {
      for (const path of [rawPicture, faithful]) {
        const report = colorOf(path);
        expect(report.tags, path).toEqual({ range: 'pc', space: 'bt470bg', primaries: 'unknown', transfer: 'unknown' });
        expect(report.vui, path).toEqual({ fullRange: 1, primaries: 2, transfer: 2, matrix: 5 });
        expect(report.gate, report.gateDetail).toBe('fail');
      }
    });

    it('production faithful mux (input = director capture through the sidecar) keeps tv / bt709 / bt709 / iec61966-2-1', () => {
      const output = join(dir, 'lemo-production.mp4');
      ff(buildMuxArgs({ videoPath: segment, outputPath: output, fps: FPS, grain: 2, loudnorm: null, padToSeconds: null, hasAudio: true }));
      expectSrgb709(output);
    });

    it('mux color:"bt709" converts pc→tv and tags tv / bt709 / bt709 / bt709', () => {
      const output = join(dir, 'lemo-bt709.mp4');
      ff(buildMuxArgs({ videoPath: rawPicture, audioPath: voice, outputPath: output, fps: FPS, grain: 2, loudnorm: null, padToSeconds: null, hasAudio: true, color: 'bt709' }));
      const report = colorOf(output);
      expect(report.tags).toEqual({ range: 'tv', space: 'bt709', primaries: 'bt709', transfer: 'bt709' });
      expect(report.vui).toEqual({ fullRange: 0, primaries: 1, transfer: 1, matrix: 1 });
      expect(report.gate).toBe('pass');
    });

    it('opt-in retag rewrites only the SPS VUI: packets, audio and pixels stay identical', async () => {
      const retagged = join(dir, 'lemo-retag.mp4');
      await copyFile(faithful, retagged);
      const done = await retagLemoFilmColorMetadata(retagged, { ffmpegPath: ffmpegPath! });
      expect(done).toEqual({ outputPath: resolve(retagged), filter: 'h264_metadata=colour_primaries=1:transfer_characteristics=13' });
      const report = colorOf(retagged);
      expect(report.tags).toEqual({ range: 'pc', space: 'bt470bg', primaries: 'bt709', transfer: 'iec61966-2-1' });
      expect(report.vui).toEqual({ fullRange: 1, primaries: 1, transfer: 13, matrix: 5 });
      expect(report.gate).toBe('fail'); // honest tags: range/matrix stay what the pixels are
      expect(packetHashes(retagged)).toEqual(packetHashes(faithful));
      expect(pixelMd5(retagged)).toBe(pixelMd5(faithful));
      expect(colrBox(retagged)).toBeNull(); // no container colr box that could contradict the VUI
      expect((await readdir(dir)).filter(name => name.includes('.retag-'))).toEqual([]);

      // The literal "all bt709" variant works mechanically but mislabels the BT.601 full-range samples; range stays pc.
      const relabelled = join(dir, 'lemo-relabel.mp4');
      await copyFile(faithful, relabelled);
      await retagLemoFilmColorMetadata(relabelled, { ffmpegPath: ffmpegPath!, tags: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' } });
      const relabel = colorOf(relabelled);
      expect(relabel.tags).toEqual({ range: 'pc', space: 'bt709', primaries: 'bt709', transfer: 'bt709' });
      expect(relabel.gate).toBe('fail');
      expect(packetHashes(relabelled)).toEqual(packetHashes(faithful));
    }, 60_000);
  });
});
