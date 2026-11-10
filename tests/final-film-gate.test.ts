import { describe, expect, it } from 'vitest';
import {
  FINAL_FILM_GATE_KIND, buildFinalFilmGateReport, evaluateFinalFilmGate, finalFilmFrameSampleTimes, finalFilmGateErrorReport,
  finalFilmLoudnessFromLoudnorm, findLemoSignoffLines, lemoCreditsCheck, lemoSignoffCheck, parseFfmpegInfo, parseFfprobeJson,
  parseSignalstatsLuma, summarizeFinalFilmGate, type FinalFilmFrameSample, type FinalFilmGateExpectation, type FinalFilmGateInput, type FinalFilmProbe,
} from '../src/shared/final-film-gate';

const expected: FinalFilmGateExpectation = { durationMs: 10_000, fps: 24, width: 1920, height: 1080, audioExpected: true };
const probe = (patch: { video?: Partial<NonNullable<FinalFilmProbe['video']>> | null; audio?: Partial<NonNullable<FinalFilmProbe['audio']>> | null; durationSeconds?: number | null } = {}): FinalFilmProbe => ({
  durationSeconds: patch.durationSeconds === undefined ? 10 : patch.durationSeconds,
  video: patch.video === null ? null : { codec: 'h264', width: 1920, height: 1080, avgFps: 24, rFps: 24, durationSeconds: 10, pixFmt: 'yuv420p',
    colorRange: 'tv', colorSpace: 'bt709', colorPrimaries: 'bt709', colorTransfer: 'iec61966-2-1', ...patch.video },
  audio: patch.audio === null ? null : { codec: 'aac', sampleRate: 48000, channels: 2, ...patch.audio },
});
const frames = (patch: Partial<Record<'first' | 'middle' | 'last', Partial<FinalFilmFrameSample>>> = {}): FinalFilmFrameSample[] =>
  (['first', 'middle', 'last'] as const).map((position, index) => ({ position, timeSeconds: [0.5, 5, 9.5][index], meanLuma: 120, maxLuma: 235, ...patch[position] }));
const good = (patch: Partial<FinalFilmGateInput> = {}): FinalFilmGateInput => ({
  expected, probe: probe(), loudness: { integratedLufs: -14.2, truePeakDb: -1.5 }, frames: frames(), ...patch,
});
const byId = (input: FinalFilmGateInput, id: string) => evaluateFinalFilmGate(input).checks.find(item => item.id === id)!;

describe('final film gate: evaluation', () => {
  it('passes a compliant film with every check present and a code on each row', () => {
    const result = evaluateFinalFilmGate(good());
    expect(result).toMatchObject({ passed: true, status: 'passed' });
    expect(result.checks.map(item => item.id)).toEqual(['duration', 'codec', 'resolution', 'fps', 'color', 'audio', 'loudness', 'frame-first', 'frame-middle', 'frame-last']);
    expect(result.checks.every(item => item.status === 'pass' && /^FINAL_GATE_/.test(item.code) && item.detail.length > 0)).toBe(true);
  });

  it('allows exactly one frame of duration drift and fails beyond it; falls back to the container duration', () => {
    expect(byId(good({ probe: probe({ video: { durationSeconds: 10 + 1 / 24 } }) }), 'duration').status).toBe('pass');
    expect(byId(good({ probe: probe({ video: { durationSeconds: 10 - 1 / 24 } }) }), 'duration').status).toBe('pass');
    const late = byId(good({ probe: probe({ video: { durationSeconds: 10.05 } }) }), 'duration');
    expect(late).toMatchObject({ status: 'fail', code: 'FINAL_GATE_DURATION' });
    expect(late.detail).toContain('时长不符');
    expect(byId(good({ probe: probe({ video: { durationSeconds: null }, durationSeconds: 10.04 }) }), 'duration').status).toBe('pass');
    expect(byId(good({ probe: probe({ video: { durationSeconds: null }, durationSeconds: null }) }), 'duration').status).toBe('fail');
    // 30 fps project: 1 frame = 33.3 ms
    expect(byId(good({ expected: { ...expected, fps: 30 }, probe: probe({ video: { avgFps: 30, rFps: 30, durationSeconds: 10.04 } }) }), 'duration').status).toBe('fail');
  });

  it('requires h264 video and AAC audio', () => {
    expect(byId(good({ probe: probe({ video: { codec: 'hevc' } }) }), 'codec')).toMatchObject({ status: 'fail', code: 'FINAL_GATE_CODEC' });
    expect(byId(good({ probe: probe({ audio: { codec: 'mp3' } }) }), 'codec').detail).toContain('AAC');
    expect(byId(good({ probe: probe({ video: null }) }), 'codec').status).toBe('fail');
  });

  it('requires the canvas resolution', () => {
    const check = byId(good({ probe: probe({ video: { width: 1280, height: 720 } }) }), 'resolution');
    expect(check).toMatchObject({ status: 'fail', code: 'FINAL_GATE_RESOLUTION' });
    expect(check.detail).toContain('1920×1080');
  });

  it('requires the project frame rate and warns on a variable frame rate', () => {
    expect(byId(good({ probe: probe({ video: { avgFps: 30, rFps: 30 } }) }), 'fps').status).toBe('fail');
    expect(byId(good({ expected: { ...expected, fps: 30 }, probe: probe({ video: { avgFps: 30, rFps: 30 } }) }), 'fps').status).toBe('pass');
    expect(byId(good({ probe: probe({ video: { avgFps: 24, rFps: 60 } }) }), 'fps').status).toBe('warn');
    expect(byId(good({ probe: probe({ video: { avgFps: null } }) }), 'fps').status).toBe('warn');
    expect(byId(good({ probe: probe({ video: { avgFps: 23.976 } }) }), 'fps').status).toBe('fail');
  });

  it('accepts tv/bt709 with sRGB or bt709 transfer, warns on missing tags and fails on wrong ones', () => {
    expect(byId(good({ probe: probe({ video: { colorTransfer: 'bt709' } }) }), 'color').status).toBe('pass');
    expect(byId(good({ probe: probe({ video: { colorPrimaries: 'unknown', colorTransfer: null } }) }), 'color')).toMatchObject({ status: 'warn', code: 'FINAL_GATE_COLOR' });
    expect(byId(good({ probe: probe({ video: { colorRange: 'pc' } }) }), 'color').status).toBe('fail');
    expect(byId(good({ probe: probe({ video: { colorSpace: 'smpte170m' } }) }), 'color').status).toBe('fail');
    expect(byId(good({ probe: probe({ video: { colorTransfer: 'smpte2084' } }) }), 'color').status).toBe('fail');
  });

  it('checks −14 ±1 LUFS and the −1 dBTP ceiling (inclusive edges)', () => {
    expect(byId(good({ loudness: { integratedLufs: -13, truePeakDb: -1 } }), 'loudness').status).toBe('pass');
    expect(byId(good({ loudness: { integratedLufs: -15, truePeakDb: -3 } }), 'loudness').status).toBe('pass');
    expect(byId(good({ loudness: { integratedLufs: -15.2, truePeakDb: -3 } }), 'loudness')).toMatchObject({ status: 'fail', code: 'FINAL_GATE_LOUDNESS' });
    expect(byId(good({ loudness: { integratedLufs: -12.5, truePeakDb: -3 } }), 'loudness').status).toBe('fail');
    const peak = byId(good({ loudness: { integratedLufs: -14, truePeakDb: -0.4 } }), 'loudness');
    expect(peak.status).toBe('fail');
    expect(peak.detail).toContain('-0.4 dBTP');
    expect(byId(good({ loudness: null }), 'loudness').status).toBe('warn');
    expect(byId(good({ loudness: { integratedLufs: null, truePeakDb: -2 } }), 'loudness').status).toBe('warn');
    expect(byId(good({ loudness: { integratedLufs: -Infinity, truePeakDb: null, silent: true } }), 'loudness').status).toBe('fail');
  });

  it('fails a missing audio stream when the project has narration; skips loudness when silent by design or gain is authored', () => {
    const missing = evaluateFinalFilmGate(good({ probe: probe({ audio: null }), loudness: null }));
    expect(missing.checks.find(item => item.id === 'audio')).toMatchObject({ status: 'fail', code: 'FINAL_GATE_AUDIO_MISSING' });
    expect(missing.checks.find(item => item.id === 'loudness')?.status).toBe('skip');
    expect(missing.passed).toBe(false);
    const silent = evaluateFinalFilmGate(good({ expected: { ...expected, audioExpected: false }, probe: probe({ audio: null }), loudness: null }));
    expect(silent.checks.find(item => item.id === 'audio')?.status).toBe('pass');
    expect(silent.checks.find(item => item.id === 'loudness')?.status).toBe('skip');
    expect(silent).toMatchObject({ passed: true, status: 'passed' });
    expect(byId(good({ expected: { ...expected, audioExpected: false }, loudness: { integratedLufs: -30, truePeakDb: -10 } }), 'loudness').status).toBe('skip');
    expect(byId(good({ expected: { ...expected, loudnessTarget: false }, loudness: { integratedLufs: -9, truePeakDb: 0 } }), 'loudness').status).toBe('skip');
  });

  it('flags black first/middle/last frames by mean luma, warns on dark frames with bright detail or failed samples', () => {
    const result = evaluateFinalFilmGate(good({ frames: frames({ first: { meanLuma: 16, maxLuma: 18 }, middle: { meanLuma: 17.5, maxLuma: 220 }, last: { meanLuma: null, error: 'seek failed' } }) }));
    expect(result.checks.find(item => item.id === 'frame-first')).toMatchObject({ status: 'fail', code: 'FINAL_GATE_BLACK_FRAME' });
    expect(result.checks.find(item => item.id === 'frame-middle')?.status).toBe('warn');
    expect(result.checks.find(item => item.id === 'frame-last')?.detail).toContain('seek failed');
    expect(result.status).toBe('failed');
    expect(byId(good({ frames: frames({ middle: { meanLuma: 20, maxLuma: 30 } }) }), 'frame-middle').status).toBe('pass');
    expect(byId(good({ frames: frames({ middle: { meanLuma: 25, maxLuma: 40 } }), blackMeanLuma: 30 }), 'frame-middle').status).toBe('fail');
    expect(byId(good({ frames: [] }), 'frame-last').status).toBe('warn');
  });

  it('reports an unreadable film as a probe failure and appends route checks', () => {
    const extra = lemoSignoffCheck([]);
    const result = evaluateFinalFilmGate(good({ probe: null, extraChecks: [extra] }));
    expect(result.checks[0]).toMatchObject({ id: 'probe', status: 'fail', code: 'FINAL_GATE_PROBE' });
    expect(result.checks.at(-1)).toEqual(extra);
    expect(result.passed).toBe(false);
  });

  it('is "warning" (still passed) when only warnings are present', () => {
    const result = evaluateFinalFilmGate(good({ probe: probe({ video: { colorPrimaries: null } }) }));
    expect(result).toMatchObject({ passed: true, status: 'warning' });
  });
});

describe('final film gate: parsers', () => {
  const ffmpegStderr = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'film.mp4':",
    '  Duration: 00:00:10.01, start: 0.000000, bitrate: 648 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709/bt709/iec61966-2-1, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 568 kb/s, 24 fps, 24 tbr, 12288 tbn (default)',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 256 kb/s (default)',
    'At least one output file must be specified',
  ].join('\n');

  it('parses ffmpeg -i stderr including colour tags', () => {
    expect(parseFfmpegInfo(ffmpegStderr)).toEqual({
      durationSeconds: 10.01,
      video: { codec: 'h264', width: 1920, height: 1080, avgFps: 24, rFps: 24, pixFmt: 'yuv420p', colorRange: 'tv', colorSpace: 'bt709', colorPrimaries: 'bt709', colorTransfer: 'iec61966-2-1' },
      audio: { codec: 'aac', sampleRate: 48000 },
    });
  });

  it('parses collapsed, partial and missing colour tags, ignoring cover-art streams', () => {
    const collapsed = parseFfmpegInfo(ffmpegStderr.replace('yuv420p(tv, bt709/bt709/iec61966-2-1, progressive)', 'yuv420p(tv, bt709, progressive)'))!;
    expect(collapsed.video).toMatchObject({ colorRange: 'tv', colorSpace: 'bt709', colorPrimaries: 'bt709', colorTransfer: 'bt709' });
    const partial = parseFfmpegInfo(ffmpegStderr.replace('bt709/bt709/iec61966-2-1', 'bt709/unknown/unknown'))!;
    expect(partial.video).toMatchObject({ colorSpace: 'bt709', colorPrimaries: 'unknown', colorTransfer: 'unknown' });
    const bare = parseFfmpegInfo(ffmpegStderr.replace('yuv420p(tv, bt709/bt709/iec61966-2-1, progressive)', 'yuv420p(progressive)'))!;
    expect(bare.video).toMatchObject({ colorRange: null, colorSpace: null, colorPrimaries: null, colorTransfer: null });
    const withCover = ffmpegStderr.replace('  Stream #0:0', '  Stream #0:2: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 640x360, 90k tbr, 90k tbn (attached pic)\n  Stream #0:0');
    expect(parseFfmpegInfo(withCover)!.video?.codec).toBe('h264');
    expect(parseFfmpegInfo('No such file or directory')).toBeNull();
    expect(parseFfmpegInfo(ffmpegStderr.split('\n').filter(line => !line.includes('Audio:')).join('\n'))!.audio).toBeNull();
  });

  it('normalises ffprobe JSON', () => {
    const parsed = parseFfprobeJson(JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '24/1', r_frame_rate: '24/1', duration: '9.958333', pix_fmt: 'yuv420p', color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'iec61966-2-1' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, duration: '10.000000' },
      ],
      format: { duration: '10.000000' },
    }))!;
    expect(parsed).toMatchObject({ durationSeconds: 10, video: { width: 1080, height: 1920, avgFps: 24, rFps: 24, durationSeconds: 9.958333, colorTransfer: 'iec61966-2-1' }, audio: { codec: 'aac', sampleRate: 48000, channels: 2 } });
    expect(parseFfprobeJson({ streams: [{ codec_type: 'video', codec_name: 'h264', avg_frame_rate: '0/0', r_frame_rate: '30000/1001' }] })!.video).toMatchObject({ avgFps: null, rFps: 30000 / 1001 });
    expect(parseFfprobeJson('not json')).toBeNull();
    expect(parseFfprobeJson({ format: {} })).toBeNull();
  });

  it('reads loudnorm measurement JSON, including silence', () => {
    const block = (i: string, tp: string) => `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "${i}",\n\t"input_tp" : "${tp}",\n\t"input_lra" : "3.20",\n\t"input_thresh" : "-24.5",\n\t"output_i" : "-14.0",\n\t"target_offset" : "0.0"\n}\n`;
    expect(finalFilmLoudnessFromLoudnorm(`size=N/A\n${block('-14.30', '-1.80')}`)).toEqual({ integratedLufs: -14.3, truePeakDb: -1.8 });
    expect(finalFilmLoudnessFromLoudnorm(block('-inf', '-inf'))).toEqual({ integratedLufs: -Infinity, truePeakDb: null, silent: true });
    expect(finalFilmLoudnessFromLoudnorm('Error opening input')).toBeNull();
  });

  it('reads signalstats luma', () => {
    expect(parseSignalstatsLuma('[Parsed_metadata_1 @ 0] lavfi.signalstats.YMIN=16\n[Parsed_metadata_1 @ 0] lavfi.signalstats.YAVG=121.175\n[Parsed_metadata_1 @ 0] lavfi.signalstats.YMAX=223')).toEqual({ meanLuma: 121.175, maxLuma: 223 });
    expect(parseSignalstatsLuma('')).toEqual({ meanLuma: null, maxLuma: null });
  });

  it('samples first/middle/last inside the film', () => {
    expect(finalFilmFrameSampleTimes(10, 24)).toEqual([{ position: 'first', timeSeconds: 0.5 }, { position: 'middle', timeSeconds: 5 }, { position: 'last', timeSeconds: 9.5 }]);
    const short = finalFilmFrameSampleTimes(1, 24);
    expect(short.map(item => item.timeSeconds)).toEqual([0.1, 0.5, 0.9]);
    expect(finalFilmFrameSampleTimes(0, 24).every(item => item.timeSeconds === 0)).toBe(true);
  });
});

describe('final film gate: Lemo §11 attribution', () => {
  it('greps lemo lab / opus 5.5 outside LICENSE, CREDITS and LIB= lines', () => {
    const hits = findLemoSignoffLines([
      { path: 'index.html', text: '<div>end</div>\n<p>LemoLab × Claude Opus 5.5</p>' },
      { path: 'scenes/end.js', text: 'const sign = "made with lemo lab";' },
      { path: 'build.sh', text: 'LIB=/opt/lemo-lab/core\nexport LIB=../lemolab' },
      { path: 'LICENSE', text: 'Copyright LemoLab' },
      { path: 'CREDITS', text: 'Library: LemoLab (MIT)' },
      { path: 'notes/credits.md', text: 'LemoLab style library' },
      { path: 'TREATMENT.md', text: 'opus 5 is fine; opus 5x5 too' },
    ]);
    expect(hits.map(hit => `${hit.path}:${hit.line}`)).toEqual(['index.html:2', 'scenes/end.js:1']);
    expect(lemoSignoffCheck(hits)).toMatchObject({ id: 'lemo-signoff', status: 'fail', code: 'FINAL_GATE_LEMO_SIGNOFF' });
    expect(lemoSignoffCheck([]).status).toBe('pass');
  });

  it('requires CREDITS and an attribution line for every CC BY asset', () => {
    const assets = [
      { id: 'a01', origin: 'imported', license: 'CC BY 4.0', source: 'Wikimedia Commons / Jane Doe' },
      { id: 'a02', origin: 'imported', license: 'user-owned', source: 'my phone' },
      { id: 'g1', origin: 'generated', license: 'CC BY 4.0', source: '' },
    ];
    expect(lemoCreditsCheck({ credits: null, assets: [] })).toMatchObject({ status: 'warn', code: 'FINAL_GATE_LEMO_CREDITS' });
    expect(lemoCreditsCheck({ credits: null, assets }).status).toBe('fail');
    expect(lemoCreditsCheck({ credits: 'Music: Kevin MacLeod (CC BY 4.0)', assets }).detail).toContain('a01');
    expect(lemoCreditsCheck({ credits: 'Photo: wikimedia commons / jane doe', assets }).status).toBe('fail');
    expect(lemoCreditsCheck({ credits: 'Photo: Wikimedia Commons / Jane Doe — CC-BY 4.0', assets })).toMatchObject({ status: 'pass' });
    expect(lemoCreditsCheck({ credits: 'Font: Noto Sans (OFL)', assets: [assets[1]] }).status).toBe('pass');
    expect(lemoCreditsCheck({ credits: 'a03 CC BY-SA', assets: [{ id: 'a03', license: 'CC BY-SA 4.0' }] }).status).toBe('pass');
  });
});

describe('final film gate: reports', () => {
  it('builds an advisory report and an error report', () => {
    const report = buildFinalFilmGateReport({ ...good({ probe: probe({ video: { width: 1280 } }) }), route: 'template', film: 'director.mp4', checkedAt: '2026-11-10T00:00:00.000Z', probeSource: 'ffmpeg' });
    expect(report).toMatchObject({ kind: FINAL_FILM_GATE_KIND, version: 1, route: 'template', film: 'director.mp4', status: 'failed', passed: false, blocking: false });
    expect(report.measurements?.frames).toHaveLength(3);
    expect(summarizeFinalFilmGate(report)).toContain('FINAL_GATE_RESOLUTION');
    const error = finalFilmGateErrorReport({ route: 'html', film: 'final.mp4', checkedAt: '2026-11-10T00:00:00.000Z', code: 'FINAL_GATE_FFMPEG_MISSING', message: '找不到 ffmpeg' });
    expect(error).toMatchObject({ status: 'error', passed: false, blocking: false, checks: [], error: { code: 'FINAL_GATE_FFMPEG_MISSING' } });
    expect(summarizeFinalFilmGate(error)).toContain('FINAL_GATE_FFMPEG_MISSING');
    expect(summarizeFinalFilmGate(buildFinalFilmGateReport({ ...good(), route: 'lemo', film: 'x.mp4', checkedAt: 'now', probeSource: 'ffprobe' }))).toBe('全部通过');
  });
});
