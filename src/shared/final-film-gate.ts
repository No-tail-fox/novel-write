/**
 * Host-side final-film quality gate (backlog E-5 + L-5, technical-roadmap §5, lemo-faithful-mode §6).
 *
 * One pure evaluator shared by all three routes (Lemo upstream, template/director, HTML video):
 *   duration within 1 frame · h264 + AAC · resolution == canvas · fixed fps · BT.709 tv colour tags ·
 *   −14 ±1 LUFS / TP ≤ −1 dBTP · first / middle / last frame not black · (Lemo) upstream §11 sign-off grep + CREDITS.
 *
 * Results are advisory by default (`blocking: false`): old projects keep delivering; the only hard gate stays
 * `LEMO_EXPORT_DURATION_MISMATCH` in electron/lemo-upstream-renderer.ts.
 * Pure module: no Node/Electron imports (the runner lives in electron/final-film-gate-runner.ts).
 */
import { FINAL_FILM_LOUDNESS, isUsableLoudnormValue, loudnessOffTarget, type LoudnessTarget } from './loudness';

export const FINAL_FILM_GATE_REPORT_FILE = 'quality-gate.json';
export const FINAL_FILM_GATE_KIND = 'storydream-final-film-gate';
/** Mean luma (8-bit code value, tv black = 16) under which a sampled frame counts as black. */
export const FINAL_FILM_BLACK_MEAN_LUMA = 20;
/** A dark frame whose brightest pixel reaches this value has real content (e.g. end-card text): warn, not fail. */
export const FINAL_FILM_BRIGHT_DETAIL_LUMA = 100;
/** Accepted colour tags (src/shared/storybound-sidecar.ts SIDECAR_OUTPUT_COLOR_ARGS; Lemo mux.sh bt709 uses trc bt709). */
export const FINAL_FILM_COLOR_TAGS = Object.freeze({ range: ['tv'], matrix: ['bt709'], primaries: ['bt709'], transfer: ['iec61966-2-1', 'bt709'] });

export type FinalFilmGateRoute = 'lemo' | 'template' | 'html';
export type FinalFilmCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type FinalFilmGateCode =
  | 'FINAL_GATE_PROBE' | 'FINAL_GATE_DURATION' | 'FINAL_GATE_CODEC' | 'FINAL_GATE_RESOLUTION' | 'FINAL_GATE_FPS'
  | 'FINAL_GATE_COLOR' | 'FINAL_GATE_AUDIO_MISSING' | 'FINAL_GATE_LOUDNESS' | 'FINAL_GATE_BLACK_FRAME'
  | 'FINAL_GATE_LEMO_SIGNOFF' | 'FINAL_GATE_LEMO_CREDITS';

export interface FinalFilmGateCheck {
  id: string;
  status: FinalFilmCheckStatus;
  code: FinalFilmGateCode;
  /** Chinese, user-facing. */
  detail: string;
}

export interface FinalFilmProbe {
  /** Container duration, seconds. */
  durationSeconds: number | null;
  video: {
    codec: string; width: number; height: number;
    /** avg_frame_rate (ffmpeg's "fps"). */
    avgFps: number | null;
    /** r_frame_rate (ffmpeg's "tbr"); differs from avgFps for variable frame rate. */
    rFps: number | null;
    durationSeconds?: number | null;
    pixFmt?: string | null;
    colorRange?: string | null; colorSpace?: string | null; colorPrimaries?: string | null; colorTransfer?: string | null;
  } | null;
  audio: { codec: string; sampleRate: number | null; channels?: number | null; durationSeconds?: number | null } | null;
}

export interface FinalFilmLoudness {
  integratedLufs: number | null;
  truePeakDb: number | null;
  /** Measured, but silent or below the −70 LUFS gate. */
  silent?: boolean;
}

export type FinalFilmFramePosition = 'first' | 'middle' | 'last';
export interface FinalFilmFrameSample {
  position: FinalFilmFramePosition;
  timeSeconds: number;
  /** signalstats YAVG (8-bit). */
  meanLuma: number | null;
  /** signalstats YMAX (8-bit). */
  maxLuma?: number | null;
  error?: string;
}

export interface FinalFilmGateExpectation {
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  /** The film has narration / dialogue / music: a missing audio stream fails. false = silent by design (loudness skipped). */
  audioExpected: boolean;
  /** Final loudness normalisation applies (−14 LUFS). false keeps authored gain (e.g. Music MV): loudness is skipped. Default true. */
  loudnessTarget?: boolean;
}

export interface FinalFilmGateInput {
  expected: FinalFilmGateExpectation;
  probe: FinalFilmProbe | null;
  /** null/undefined = not measured (measurement failed); `{ silent: true }` = measured silence. */
  loudness?: FinalFilmLoudness | null;
  frames?: readonly FinalFilmFrameSample[];
  /** Route-specific checks appended verbatim (e.g. Lemo §11 attribution). */
  extraChecks?: readonly FinalFilmGateCheck[];
  target?: LoudnessTarget;
  blackMeanLuma?: number;
}

export interface FinalFilmGateResult {
  passed: boolean;
  status: 'passed' | 'warning' | 'failed';
  checks: FinalFilmGateCheck[];
}

export interface FinalFilmGateReport extends Omit<FinalFilmGateResult, 'status'> {
  kind: typeof FINAL_FILM_GATE_KIND;
  version: 1;
  route: FinalFilmGateRoute;
  /** File name of the checked film (the report sits next to it). */
  film: string;
  checkedAt: string;
  status: FinalFilmGateResult['status'] | 'error';
  /** Advisory gate: never blocks delivery. */
  blocking: false;
  expected?: FinalFilmGateExpectation;
  measurements?: { probeSource: 'ffprobe' | 'ffmpeg'; probe: FinalFilmProbe | null; loudness: FinalFilmLoudness | null; frames: FinalFilmFrameSample[] };
  error?: { code: string; message: string };
  elapsedMs?: number;
}

const check = (id: string, status: FinalFilmCheckStatus, code: FinalFilmGateCode, detail: string): FinalFilmGateCheck => ({ id, status, code, detail });
const fmt = (value: number, digits = 2) => String(Number(value.toFixed(digits)));
const missingTag = (value: string | null | undefined) => !value || /^(unknown|unspecified|reserved|n\/a)$/i.test(value.trim());

function durationCheck(expected: FinalFilmGateExpectation, probe: FinalFilmProbe): FinalFilmGateCheck {
  const seconds = probe.video?.durationSeconds ?? probe.durationSeconds;
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return check('duration', 'fail', 'FINAL_GATE_DURATION', '无法读取成片时长。');
  const actualMs = seconds * 1000, frameMs = 1000 / expected.fps, delta = actualMs - expected.durationMs;
  const text = `成片 ${fmt(actualMs / 1000, 3)} 秒，时间轴 ${fmt(expected.durationMs / 1000, 3)} 秒（差 ${fmt(delta, 1)} ms，允许 1 帧 = ${fmt(frameMs, 1)} ms）`;
  // +0.5 ms absorbs millisecond rounding of the expectation and ffmpeg's centisecond container clock.
  return Math.abs(delta) <= frameMs + 0.5 ? check('duration', 'pass', 'FINAL_GATE_DURATION', `${text}。`) : check('duration', 'fail', 'FINAL_GATE_DURATION', `时长不符：${text}。`);
}

function codecCheck(probe: FinalFilmProbe): FinalFilmGateCheck {
  if (!probe.video) return check('codec', 'fail', 'FINAL_GATE_CODEC', '成片中没有视频流。');
  const issues: string[] = [];
  if (probe.video.codec.toLowerCase() !== 'h264') issues.push(`视频编码为 ${probe.video.codec}（应为 h264）`);
  if (probe.audio && probe.audio.codec.toLowerCase() !== 'aac') issues.push(`音频编码为 ${probe.audio.codec}（应为 AAC）`);
  const summary = `视频 ${probe.video.codec}${probe.audio ? `，音频 ${probe.audio.codec}` : '，无音轨'}`;
  return issues.length ? check('codec', 'fail', 'FINAL_GATE_CODEC', `${issues.join('；')}。`) : check('codec', 'pass', 'FINAL_GATE_CODEC', `${summary}。`);
}

function resolutionCheck(expected: FinalFilmGateExpectation, probe: FinalFilmProbe): FinalFilmGateCheck {
  if (!probe.video) return check('resolution', 'fail', 'FINAL_GATE_RESOLUTION', '成片中没有视频流，无法核对分辨率。');
  const { width, height } = probe.video;
  return width === expected.width && height === expected.height
    ? check('resolution', 'pass', 'FINAL_GATE_RESOLUTION', `分辨率 ${width}×${height}，与画布一致。`)
    : check('resolution', 'fail', 'FINAL_GATE_RESOLUTION', `分辨率 ${width}×${height} 与画布 ${expected.width}×${expected.height} 不一致。`);
}

function fpsCheck(expected: FinalFilmGateExpectation, probe: FinalFilmProbe): FinalFilmGateCheck {
  const avg = probe.video?.avgFps ?? null, r = probe.video?.rFps ?? null;
  if (avg === null || !Number.isFinite(avg) || avg <= 0) return check('fps', 'warn', 'FINAL_GATE_FPS', `无法读取成片帧率（期望固定 ${fmt(expected.fps)} fps）。`);
  if (Math.abs(avg - expected.fps) > 0.02) return check('fps', 'fail', 'FINAL_GATE_FPS', `帧率 ${fmt(avg, 3)} fps，与项目帧率 ${fmt(expected.fps)} fps 不一致。`);
  if (r !== null && Number.isFinite(r) && Math.abs(r - avg) > 0.02) return check('fps', 'warn', 'FINAL_GATE_FPS', `平均帧率 ${fmt(avg, 3)} fps 与基准帧率 ${fmt(r, 3)} fps 不同，可能是可变帧率。`);
  return check('fps', 'pass', 'FINAL_GATE_FPS', `固定 ${fmt(avg, 3)} fps。`);
}

function colorCheck(probe: FinalFilmProbe): FinalFilmGateCheck {
  if (!probe.video) return check('color', 'skip', 'FINAL_GATE_COLOR', '没有视频流，跳过色彩标签检查。');
  const v = probe.video;
  const fields: Array<[label: string, value: string | null | undefined, accepted: readonly string[]]> = [
    ['range', v.colorRange, FINAL_FILM_COLOR_TAGS.range], ['matrix', v.colorSpace, FINAL_FILM_COLOR_TAGS.matrix],
    ['primaries', v.colorPrimaries, FINAL_FILM_COLOR_TAGS.primaries], ['trc', v.colorTransfer, FINAL_FILM_COLOR_TAGS.transfer],
  ];
  const summary = fields.map(([label, value]) => `${label}=${missingTag(value) ? '未标注' : value}`).join('，');
  const wrong = fields.filter(([, value, accepted]) => !missingTag(value) && !accepted.includes(value!.trim().toLowerCase()));
  const missing = fields.filter(([, value]) => missingTag(value));
  if (wrong.length) return check('color', 'fail', 'FINAL_GATE_COLOR', `色彩标签不符（应为 tv / bt709 / bt709 / iec61966-2-1 或 bt709）：${summary}。`);
  if (missing.length) return check('color', 'warn', 'FINAL_GATE_COLOR', `色彩标签不完整（${missing.map(([label]) => label).join('、')} 未标注），播放器可能按其他色域解释：${summary}。`);
  return check('color', 'pass', 'FINAL_GATE_COLOR', `色彩标签 ${summary}。`);
}

function audioChecks(input: FinalFilmGateInput, probe: FinalFilmProbe, target: LoudnessTarget): FinalFilmGateCheck[] {
  const { expected } = input;
  const range = `${target.integratedLufs}±1 LUFS，真峰值 ≤ ${target.truePeakDb} dBTP`;
  if (!probe.audio) {
    return expected.audioExpected
      ? [check('audio', 'fail', 'FINAL_GATE_AUDIO_MISSING', '项目有旁白/对白/音乐，但成片中没有音轨。'), check('loudness', 'skip', 'FINAL_GATE_LOUDNESS', '没有音轨，无法测量响度。')]
      : [check('audio', 'pass', 'FINAL_GATE_AUDIO_MISSING', '按设计为无声成片，没有音轨。'), check('loudness', 'skip', 'FINAL_GATE_LOUDNESS', '无声成片，跳过响度检查。')];
  }
  const audio = check('audio', 'pass', 'FINAL_GATE_AUDIO_MISSING', `音轨 ${probe.audio.codec}${probe.audio.sampleRate ? ` ${probe.audio.sampleRate} Hz` : ''}。`);
  if (!expected.audioExpected) return [audio, check('loudness', 'skip', 'FINAL_GATE_LOUDNESS', '项目按设计无声，跳过响度检查。')];
  if (expected.loudnessTarget === false) return [audio, check('loudness', 'skip', 'FINAL_GATE_LOUDNESS', '该成片按设计保留原始响度（未做 −14 LUFS 标准化），跳过响度检查。')];
  const loudness = input.loudness;
  if (!loudness) return [audio, check('loudness', 'warn', 'FINAL_GATE_LOUDNESS', `无法测量响度（目标 ${range}）。`)];
  if (loudness.silent || loudness.integratedLufs === -Infinity) return [audio, check('loudness', 'fail', 'FINAL_GATE_LOUDNESS', '音轨静音或低于 −70 LUFS，但项目应有旁白/音乐。')];
  const { integratedLufs: i, truePeakDb: p } = loudness;
  if (i === null || p === null || !Number.isFinite(i) || !Number.isFinite(p)) return [audio, check('loudness', 'warn', 'FINAL_GATE_LOUDNESS', `响度测量不完整（目标 ${range}）。`)];
  const text = `实测 ${fmt(i, 1)} LUFS，真峰值 ${fmt(p, 1)} dBTP（目标 ${range}）`;
  return [audio, loudnessOffTarget({ integratedLufs: i, truePeak: p }, target)
    ? check('loudness', 'fail', 'FINAL_GATE_LOUDNESS', `响度不达标：${text}。`)
    : check('loudness', 'pass', 'FINAL_GATE_LOUDNESS', `${text}。`)];
}

const POSITION_LABEL: Record<FinalFilmFramePosition, string> = { first: '首', middle: '中', last: '尾' };

function frameChecks(frames: readonly FinalFilmFrameSample[], threshold: number): FinalFilmGateCheck[] {
  return (['first', 'middle', 'last'] as const).map(position => {
    const id = `frame-${position}`, label = `${POSITION_LABEL[position]}帧`;
    const sample = frames.find(frame => frame.position === position);
    if (!sample) return check(id, 'warn', 'FINAL_GATE_BLACK_FRAME', `${label}未抽检。`);
    const at = `${fmt(sample.timeSeconds, 3)} 秒`;
    if (sample.meanLuma === null || !Number.isFinite(sample.meanLuma)) return check(id, 'warn', 'FINAL_GATE_BLACK_FRAME', `${label}（${at}）抽帧失败${sample.error ? `：${sample.error}` : ''}。`);
    const stats = `平均亮度 ${fmt(sample.meanLuma, 1)}${typeof sample.maxLuma === 'number' ? `，最高 ${fmt(sample.maxLuma, 0)}` : ''}`;
    if (sample.meanLuma >= threshold) return check(id, 'pass', 'FINAL_GATE_BLACK_FRAME', `${label}（${at}）${stats}，不是黑帧。`);
    if (typeof sample.maxLuma === 'number' && sample.maxLuma >= FINAL_FILM_BRIGHT_DETAIL_LUMA) {
      return check(id, 'warn', 'FINAL_GATE_BLACK_FRAME', `${label}（${at}）画面几乎全黑但有亮部（${stats}），可能是片头/片尾字卡，请人工确认。`);
    }
    return check(id, 'fail', 'FINAL_GATE_BLACK_FRAME', `${label}（${at}）是黑帧（${stats}，阈值 ${threshold}）。`);
  });
}

export function finalFilmGateStatus(checks: readonly FinalFilmGateCheck[]): FinalFilmGateResult['status'] {
  return checks.some(item => item.status === 'fail') ? 'failed' : checks.some(item => item.status === 'warn') ? 'warning' : 'passed';
}

/** Evaluate every check. Never throws on measurement gaps: missing data becomes `warn`/`fail` rows. */
export function evaluateFinalFilmGate(input: FinalFilmGateInput): FinalFilmGateResult {
  const target = input.target ?? FINAL_FILM_LOUDNESS;
  const threshold = input.blackMeanLuma ?? FINAL_FILM_BLACK_MEAN_LUMA;
  const { expected, probe } = input;
  const checks: FinalFilmGateCheck[] = [];
  if (!probe) {
    checks.push(check('probe', 'fail', 'FINAL_GATE_PROBE', '无法读取成片的媒体信息（文件损坏或不是视频）。'));
  } else {
    checks.push(durationCheck(expected, probe), codecCheck(probe), resolutionCheck(expected, probe), fpsCheck(expected, probe), colorCheck(probe), ...audioChecks(input, probe, target));
  }
  checks.push(...frameChecks(input.frames ?? [], threshold), ...(input.extraChecks ?? []));
  const status = finalFilmGateStatus(checks);
  return { passed: status !== 'failed', status, checks };
}

// ———————————————————————————————— measurement parsers (ffprobe JSON / ffmpeg stderr) ————————————————————————————————

const rate = (value: unknown): number | null => {
  const text = String(value ?? '').trim();
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(text);
  if (!m) return null;
  const den = m[2] === undefined ? 1 : Number(m[2]);
  const n = Number(m[1]) / den;
  return den > 0 && Number.isFinite(n) && n > 0 ? n : null;
};
const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const tag = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Normalise `ffprobe -print_format json -show_format -show_streams` output. */
export function parseFfprobeJson(json: unknown): FinalFilmProbe | null {
  const value = (typeof json === 'string' ? (() => { try { return JSON.parse(json) as unknown; } catch { return null; } })() : json) as
    { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> } | null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.streams)) return null;
  const v = value.streams.find(stream => stream.codec_type === 'video' && (stream.disposition as Record<string, unknown> | undefined)?.attached_pic !== 1);
  const a = value.streams.find(stream => stream.codec_type === 'audio');
  return {
    durationSeconds: finite(value.format?.duration),
    video: v ? {
      codec: String(v.codec_name ?? ''), width: Number(v.width) || 0, height: Number(v.height) || 0,
      avgFps: rate(v.avg_frame_rate), rFps: rate(v.r_frame_rate), durationSeconds: finite(v.duration), pixFmt: tag(v.pix_fmt),
      colorRange: tag(v.color_range), colorSpace: tag(v.color_space), colorPrimaries: tag(v.color_primaries), colorTransfer: tag(v.color_transfer),
    } : null,
    audio: a ? { codec: String(a.codec_name ?? ''), sampleRate: finite(a.sample_rate), channels: finite(a.channels), durationSeconds: finite(a.duration) } : null,
  };
}

const clock = (value: string) => { const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim()); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };

/**
 * Parse `ffmpeg -hide_banner -i <file>` stderr (the bundled imageio ffmpeg has no ffprobe).
 * Colour tags come from the pixel-format parenthesis, e.g. `yuv420p(tv, bt709, progressive)` or
 * `yuv420p(tv, bt709/bt709/iec61966-2-1, progressive)` (matrix/primaries/transfer, printed once when equal).
 */
export function parseFfmpegInfo(stderr: string): FinalFilmProbe | null {
  if (!/Input #0/.test(stderr)) return null;
  const duration = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(stderr);
  const videoLines = [...stderr.matchAll(/Stream #\d+:\d+[^\n]*?: Video: ([^\s,]+)[^\n]*/g)];
  const videoLine = videoLines.find(line => !/attached pic/.test(line[0])) ?? null;
  const audioLine = /Stream #\d+:\d+[^\n]*?: Audio: ([^\s,]+)[^\n]*/.exec(stderr);
  let video: FinalFilmProbe['video'] = null;
  if (videoLine) {
    const text = videoLine[0];
    const dims = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(text);
    const fps = /,\s*(\d+(?:\.\d+)?k?) fps/.exec(text);
    const tbr = /,\s*(\d+(?:\.\d+)?k?) tbr/.exec(text);
    const kilo = (m: RegExpExecArray | null) => (m ? (m[1].endsWith('k') ? Number(m[1].slice(0, -1)) * 1000 : Number(m[1])) : null);
    const pix = /Video: [^,]+,\s*([a-z0-9_]+)(?:\(([^)]*)\))?/i.exec(text);
    let colorRange: string | null = null, colorSpace: string | null = null, colorPrimaries: string | null = null, colorTransfer: string | null = null;
    for (const token of (pix?.[2] ?? '').split(',').map(part => part.trim()).filter(Boolean)) {
      if (/^(tv|pc|mpeg|jpeg)$/i.test(token)) colorRange = token.toLowerCase() === 'mpeg' ? 'tv' : token.toLowerCase() === 'jpeg' ? 'pc' : token.toLowerCase();
      else if (token.includes('/')) [colorSpace, colorPrimaries, colorTransfer] = token.split('/').map(part => part.trim() || null) as [string | null, string | null, string | null];
      else if (/progressive|first|^(tt|bb|tb|bt)$|^\d+ bpc$|^left$|^center$|^topleft$|^top$|^bottomleft$|^bottom$/i.test(token)) continue;
      else colorSpace = colorPrimaries = colorTransfer = token;
    }
    video = { codec: videoLine[1], width: dims ? +dims[1] : 0, height: dims ? +dims[2] : 0, avgFps: kilo(fps), rFps: kilo(tbr), pixFmt: pix?.[1] ?? null,
      colorRange, colorSpace, colorPrimaries, colorTransfer };
  }
  const audioRate = audioLine ? /,\s*(\d+) Hz/.exec(audioLine[0]) : null;
  return {
    durationSeconds: duration ? clock(duration[1]) : null,
    video,
    audio: audioLine ? { codec: audioLine[1], sampleRate: audioRate ? +audioRate[1] : null } : null,
  };
}

/** Read `input_i` / `input_tp` from the loudnorm `print_format=json` block (src/shared/loudness.ts loudnormMeasureFilter). */
export function finalFilmLoudnessFromLoudnorm(stderr: string): FinalFilmLoudness | null {
  const start = stderr.lastIndexOf('{');
  if (start < 0) return null;
  const block = stderr.slice(start, stderr.indexOf('}', start) + 1 || undefined);
  const field = (key: string) => new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(block)?.[1]?.trim();
  const i = field('input_i'), tp = field('input_tp');
  if (i === undefined && tp === undefined) return null;
  const silent = !isUsableLoudnormValue(i) && /-inf/i.test(String(i ?? ''));
  return { integratedLufs: isUsableLoudnormValue(i) ? Number(i) : silent ? -Infinity : null, truePeakDb: isUsableLoudnormValue(tp) ? Number(tp) : null, ...(silent ? { silent: true } : {}) };
}

/** Parse the last `lavfi.signalstats.YAVG` / `YMAX` printed by `signalstats,metadata=mode=print`. */
export function parseSignalstatsLuma(stderr: string): { meanLuma: number | null; maxLuma: number | null } {
  const last = (key: string) => { const values = [...stderr.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=(-?\\d+(?:\\.\\d+)?)`, 'g'))]; const v = values.pop(); return v ? Number(v[1]) : null; };
  return { meanLuma: last('YAVG'), maxLuma: last('YMAX') };
}

/** First / middle / last sample times, kept slightly inside the film so fade-in/out edges and end-of-stream seeks do not dominate. */
export function finalFilmFrameSampleTimes(durationSeconds: number, fps: number): Array<{ position: FinalFilmFramePosition; timeSeconds: number }> {
  const d = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const frame = fps > 0 ? 1 / fps : 1 / 24;
  const edge = Math.min(0.5, d * 0.1);
  const round = (t: number) => Number(Math.max(0, Math.min(t, Math.max(0, d - frame))).toFixed(3));
  return [{ position: 'first', timeSeconds: round(edge) }, { position: 'middle', timeSeconds: round(d / 2) }, { position: 'last', timeSeconds: round(d - Math.max(edge, frame)) }];
}

// ———————————————————————————————— Lemo §11 attribution (DIRECTOR.md §11) ————————————————————————————————

/** Upstream §11: `grep -rniE "lemo ?lab|opus 5\.5" <project folder>` must find nothing outside LICENSE, CREDITS and `LIB=` lines. */
export const LEMO_SIGNOFF_PATTERN = /lemo ?lab|opus 5\.5/i;
export interface LemoSignoffHit { path: string; line: number; text: string }

const isLicenseOrCredits = (path: string) => /^(license|licence|credits)(\.[a-z0-9]+)?$/i.test(path.split(/[\\/]/).pop() ?? '');
const isLibLine = (line: string) => /^\s*(?:export\s+)?LIB=/.test(line);

export function findLemoSignoffLines(files: ReadonlyArray<{ path: string; text: string }>, limit = 20): LemoSignoffHit[] {
  const hits: LemoSignoffHit[] = [];
  for (const file of files) {
    if (isLicenseOrCredits(file.path)) continue;
    const lines = file.text.split(/\r?\n/);
    for (let index = 0; index < lines.length && hits.length < limit; index++) {
      if (LEMO_SIGNOFF_PATTERN.test(lines[index]) && !isLibLine(lines[index])) hits.push({ path: file.path, line: index + 1, text: lines[index].trim().slice(0, 160) });
    }
  }
  return hits;
}

export function lemoSignoffCheck(hits: readonly LemoSignoffHit[]): FinalFilmGateCheck {
  return hits.length
    ? check('lemo-signoff', 'fail', 'FINAL_GATE_LEMO_SIGNOFF', `工程中出现 LemoLab / Opus 5.5 署名（上游 §11 规定用户成片不带 LemoLab 署名）：${hits.slice(0, 5).map(hit => `${hit.path}:${hit.line}`).join('、')}${hits.length > 5 ? ` 等 ${hits.length} 处` : ''}。`)
    : check('lemo-signoff', 'pass', 'FINAL_GATE_LEMO_SIGNOFF', '工程中没有 LemoLab / Opus 5.5 署名（LICENSE、CREDITS 与 LIB= 行除外）。');
}

export interface LemoCreditAsset { id: string; origin?: string; license?: string; source?: string }
const CC_BY = /\bCC[\s-]*BY\b/i;

/** CREDITS must exist (DIRECTOR §11) and, for every CC BY asset, name its source and the CC BY licence. */
export function lemoCreditsCheck(input: { credits: string | null; assets: readonly LemoCreditAsset[] }): FinalFilmGateCheck {
  const ccBy = input.assets.filter(asset => asset.origin !== 'generated' && CC_BY.test(asset.license ?? ''));
  if (input.credits === null) {
    return ccBy.length
      ? check('lemo-credits', 'fail', 'FINAL_GATE_LEMO_CREDITS', `使用了 ${ccBy.length} 个 CC BY 素材（${ccBy.map(asset => asset.id).join('、')}），但工程缺少 CREDITS 署名文件。`)
      : check('lemo-credits', 'warn', 'FINAL_GATE_LEMO_CREDITS', '工程缺少 CREDITS（上游 §11 要求列出成片中的第三方素材、字体、音乐和配音引擎及其许可）。');
  }
  const credits = input.credits.toLowerCase();
  const missing = ccBy.filter(asset => {
    const needle = (asset.source ?? '').trim() || asset.id;
    return !credits.includes(needle.toLowerCase());
  });
  if (missing.length) return check('lemo-credits', 'fail', 'FINAL_GATE_LEMO_CREDITS', `CREDITS 未署名以下 CC BY 素材的来源：${missing.map(asset => `${asset.id}（${(asset.source ?? '').trim() || '无来源'}）`).join('、')}。`);
  if (ccBy.length && !CC_BY.test(input.credits)) return check('lemo-credits', 'fail', 'FINAL_GATE_LEMO_CREDITS', `CREDITS 列出了 CC BY 素材来源，但没有写明 CC BY 许可。`);
  return check('lemo-credits', 'pass', 'FINAL_GATE_LEMO_CREDITS', ccBy.length ? `CREDITS 已署名 ${ccBy.length} 个 CC BY 素材。` : 'CREDITS 已存在，未使用需要署名的 CC BY 素材。');
}

// ———————————————————————————————— reports ————————————————————————————————

export function buildFinalFilmGateReport(input: FinalFilmGateInput & {
  route: FinalFilmGateRoute; film: string; checkedAt: string; probeSource: 'ffprobe' | 'ffmpeg'; elapsedMs?: number;
}): FinalFilmGateReport {
  const result = evaluateFinalFilmGate(input);
  return {
    kind: FINAL_FILM_GATE_KIND, version: 1, route: input.route, film: input.film, checkedAt: input.checkedAt,
    status: result.status, passed: result.passed, blocking: false, expected: input.expected, checks: result.checks,
    measurements: { probeSource: input.probeSource, probe: input.probe, loudness: input.loudness ?? null, frames: [...(input.frames ?? [])] },
    ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
  };
}

/** The gate itself failed (no ffmpeg, cancelled, timeout…): recorded, never thrown to the export. */
export function finalFilmGateErrorReport(input: { route: FinalFilmGateRoute; film: string; checkedAt: string; code: string; message: string; expected?: FinalFilmGateExpectation; elapsedMs?: number }): FinalFilmGateReport {
  return {
    kind: FINAL_FILM_GATE_KIND, version: 1, route: input.route, film: input.film, checkedAt: input.checkedAt,
    status: 'error', passed: false, blocking: false, ...(input.expected ? { expected: input.expected } : {}), checks: [],
    error: { code: input.code, message: input.message.slice(0, 2000) }, ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
  };
}

/** One log line: `FINAL_GATE_LOUDNESS: …; FINAL_GATE_BLACK_FRAME: …` for the non-passing rows. */
export function summarizeFinalFilmGate(report: FinalFilmGateReport): string {
  if (report.status === 'error') return `${report.error?.code ?? 'FINAL_GATE_ERROR'}: ${report.error?.message ?? ''}`;
  const issues = report.checks.filter(item => item.status === 'fail' || item.status === 'warn');
  return issues.length ? issues.map(item => `${item.status === 'fail' ? '✗' : '!'} ${item.code}: ${item.detail}`).join('; ') : '全部通过';
}
