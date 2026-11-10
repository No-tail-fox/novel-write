/**
 * Runs the host-side final-film gate (src/shared/final-film-gate.ts) on a delivered MP4 and writes
 * `quality-gate.json` next to it. Advisory: `runFinalFilmGateSafely` never throws into an export.
 *
 * ffmpeg resolution follows the rest of the app: the bundled imageio ffmpeg inside the Python runtime
 * (resources/python in a packaged app, vendor/python in dev — the same binary the Storybound sidecar and the
 * Lemo mux use). imageio does not ship ffprobe, so the probe parses `ffmpeg -i` unless an ffprobe is supplied
 * or sits next to ffmpeg.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import {
  FINAL_FILM_GATE_REPORT_FILE, buildFinalFilmGateReport, finalFilmFrameSampleTimes, finalFilmGateErrorReport, finalFilmLoudnessFromLoudnorm,
  findLemoSignoffLines, lemoCreditsCheck, lemoSignoffCheck, parseFfmpegInfo, parseFfprobeJson, parseSignalstatsLuma, summarizeFinalFilmGate,
  type FinalFilmFrameSample, type FinalFilmGateCheck, type FinalFilmGateExpectation, type FinalFilmGateReport, type FinalFilmGateRoute,
  type FinalFilmLoudness, type FinalFilmProbe, type LemoCreditAsset,
} from '../src/shared/final-film-gate';
import { loudnormMeasureFilter } from '../src/shared/loudness';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';

const isWindows = process.platform === 'win32';
const PROBE_TIMEOUT_MS = 20_000;
const FRAME_TIMEOUT_MS = 20_000;
const MIN_TOTAL_TIMEOUT_MS = 45_000;
const MAX_TOTAL_TIMEOUT_MS = 10 * 60_000;

export interface FinalFilmFfmpeg { ffmpegPath: string; ffprobePath: string | null }

export interface FinalFilmGateRunOptions {
  route: FinalFilmGateRoute;
  filmPath: string;
  expected: FinalFilmGateExpectation;
  /** Explicit binaries (tests, Lemo runtime); otherwise resolved from the bundled Python runtime. */
  ffmpegPath?: string;
  ffprobePath?: string | null;
  pythonRoot?: string;
  /** Lemo film project folder: adds the upstream §11 sign-off grep and the CREDITS check. */
  lemoProjectDir?: string;
  signal?: AbortSignal;
  /** Whole-gate budget. Default: 45 s + 1.5 × film duration, capped at 10 min. */
  timeoutMs?: number;
  /** Default: `<film dir>/quality-gate.json`. `null` = do not write. */
  reportPath?: string | null;
  now?: () => Date;
  log?: (message: string) => void;
}

export class FinalFilmGateError extends Error {
  constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'FinalFilmGateError'; }
}

async function isFile(path: string) { try { return (await stat(path)).isFile(); } catch { return false; } }

/** Bundled imageio ffmpeg (same lookup as resolveLemoUpstreamRenderRuntime), with an optional sibling ffprobe. */
export async function resolveFinalFilmFfmpeg(options: { ffmpegPath?: string; ffprobePath?: string | null; pythonRoot?: string } = {}): Promise<FinalFilmFfmpeg | null> {
  const withProbe = async (ffmpegPath: string): Promise<FinalFilmFfmpeg> => {
    if (options.ffprobePath !== undefined) return { ffmpegPath, ffprobePath: options.ffprobePath && await isFile(options.ffprobePath) ? options.ffprobePath : null };
    const sibling = join(dirname(ffmpegPath), isWindows ? 'ffprobe.exe' : 'ffprobe');
    return { ffmpegPath, ffprobePath: await isFile(sibling) ? sibling : null };
  };
  if (options.ffmpegPath) return await isFile(options.ffmpegPath) ? withProbe(options.ffmpegPath) : null;
  const roots: string[] = [];
  if (options.pythonRoot) roots.push(options.pythonRoot);
  try {
    const runtime = resolvePythonRuntimeInfo();
    if (runtime.source === 'bundled') roots.push(dirname(runtime.command));
  } catch { /* fall through */ }
  for (const root of roots) {
    const binaries = join(root, isWindows ? 'Lib' : 'lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
    let names: string[] = [];
    try { names = await readdir(binaries); } catch { continue; }
    const name = names.filter(item => /^ffmpeg/i.test(item) && (!isWindows || /\.exe$/i.test(item))).sort().pop();
    if (name) return withProbe(join(binaries, name));
  }
  const env = process.env.IMAGEIO_FFMPEG_EXE;
  if (env && existsSync(env)) return withProbe(env);
  return null;
}

function defaultTimeoutMs(expected: FinalFilmGateExpectation) {
  const filmMs = Number.isFinite(expected.durationMs) && expected.durationMs > 0 ? expected.durationMs : 0;
  return Math.min(MAX_TOTAL_TIMEOUT_MS, Math.max(MIN_TOTAL_TIMEOUT_MS, Math.round(MIN_TOTAL_TIMEOUT_MS + filmMs * 1.5)));
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

interface Measurements { probeSource: 'ffprobe' | 'ffmpeg'; probe: FinalFilmProbe | null; loudness: FinalFilmLoudness | null; frames: FinalFilmFrameSample[] }

/** ffprobe/ffmpeg probe + loudnorm measurement + three signalstats frame samples. Throws only when `signal` aborts. */
export async function measureFinalFilm(filmPath: string, binaries: FinalFilmFfmpeg, expected: FinalFilmGateExpectation, signal: AbortSignal, deadline: number): Promise<Measurements> {
  const cwd = dirname(filmPath);
  const run = (command: string, args: string[], capMs: number, maxStdoutBytes = 1024 * 1024) => {
    signal.throwIfAborted();
    const timeoutMs = Math.max(1, Math.floor(Math.min(capMs, deadline - Date.now())));
    return runBoundedProcess(command, args, { cwd, timeoutMs, maxStdoutBytes, maxStderrBytes: 4 * 1024 * 1024, signal });
  };
  // Step failures become measurement gaps (warn rows); only an abort/timeout of the whole gate propagates.
  const step = async <T>(work: () => Promise<T>, fallback: (error: unknown) => T): Promise<T> => {
    try { return await work(); } catch (error) { signal.throwIfAborted(); return fallback(error); }
  };

  let probeSource: Measurements['probeSource'] = 'ffmpeg';
  let probe: FinalFilmProbe | null = null;
  if (binaries.ffprobePath) {
    probe = await step(async () => {
      const result = await run(binaries.ffprobePath!, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filmPath], PROBE_TIMEOUT_MS, 4 * 1024 * 1024);
      return result.code === 0 ? parseFfprobeJson(result.stdout) : null;
    }, () => null);
    if (probe) probeSource = 'ffprobe';
  }
  if (!probe) probe = await step(async () => parseFfmpegInfo((await run(binaries.ffmpegPath, ['-hide_banner', '-i', filmPath], PROBE_TIMEOUT_MS)).stderr), () => null);

  let loudness: FinalFilmLoudness | null = null;
  if (probe?.audio && expected.audioExpected && expected.loudnessTarget !== false) {
    loudness = await step(async () => {
      const result = await run(binaries.ffmpegPath, ['-hide_banner', '-nostats', '-i', filmPath, '-map', '0:a:0', '-af', loudnormMeasureFilter(), '-f', 'null', '-'], MAX_TOTAL_TIMEOUT_MS);
      return result.code === 0 ? finalFilmLoudnessFromLoudnorm(result.stderr) : null;
    }, () => null);
  }

  const frames: FinalFilmFrameSample[] = [];
  const durationSeconds = probe?.video?.durationSeconds ?? probe?.durationSeconds ?? expected.durationMs / 1000;
  if (!probe || probe.video) {
    for (const sample of finalFilmFrameSampleTimes(durationSeconds, expected.fps)) {
      frames.push(await step(async () => {
        const result = await run(binaries.ffmpegPath, ['-hide_banner', '-nostats', '-ss', sample.timeSeconds.toFixed(3), '-i', filmPath,
          '-map', '0:v:0', '-frames:v', '1', '-vf', 'signalstats,metadata=mode=print', '-f', 'null', '-'], FRAME_TIMEOUT_MS);
        const luma = parseSignalstatsLuma(result.stderr);
        return { ...sample, ...luma, ...(luma.meanLuma === null ? { error: `ffmpeg 退出码 ${result.code}` } : {}) };
      }, error => ({ ...sample, meanLuma: null, maxLuma: null, error: message(error) })));
    }
  }
  return { probeSource, probe, loudness, frames };
}

// ———————————————————————————————— Lemo §11 attribution ————————————————————————————————

const TEXT_FILE = /\.(html?|m?js|cjs|ts|css|md|txt|json|srt|vtt|sh|py|svg|ya?ml|csv)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'frames', 'stills', 'voices', 'out', 'renders']);
const MAX_SCAN_FILES = 2000, MAX_SCAN_BYTES = 2 * 1024 * 1024;

async function lemoProjectTextFiles(projectDir: string, signal?: AbortSignal) {
  const files: Array<{ path: string; text: string }> = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6 || files.length >= MAX_SCAN_FILES) return;
    let entries: import('node:fs').Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (files.length >= MAX_SCAN_FILES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(path, depth + 1); continue; }
      if (!entry.isFile() || (!TEXT_FILE.test(entry.name) && extname(entry.name) !== '')) continue;
      try {
        if ((await stat(path)).size > MAX_SCAN_BYTES) continue;
        files.push({ path: relative(projectDir, path).split('\\').join('/'), text: await readFile(path, 'utf8') });
      } catch { /* unreadable file: skip */ }
    }
  };
  await walk(projectDir, 0);
  return files;
}

/** Upstream DIRECTOR §11: sign-off grep over the project folder + CREDITS (with every CC BY asset from assets/MANIFEST.json). */
export async function collectLemoAttributionChecks(projectDir: string, signal?: AbortSignal): Promise<FinalFilmGateCheck[]> {
  const files = await lemoProjectTextFiles(resolve(projectDir), signal);
  let credits: string | null = null;
  for (const name of ['CREDITS', 'CREDITS.md', 'CREDITS.txt', 'credits.md', 'credits.txt']) {
    try { credits = await readFile(join(projectDir, name), 'utf8'); break; } catch { /* next */ }
  }
  let assets: LemoCreditAsset[] = [];
  try {
    const manifest = JSON.parse(await readFile(join(projectDir, 'assets', 'MANIFEST.json'), 'utf8')) as { storydream?: string; assets?: unknown };
    // Host-written manifest only (electron/lemo-upstream-assets.ts LEMO_ASSET_MARKER).
    if (manifest?.storydream === 'lemo-assets' && Array.isArray(manifest.assets)) {
      assets = manifest.assets.filter((item): item is LemoCreditAsset => !!item && typeof item === 'object' && typeof (item as LemoCreditAsset).id === 'string');
    }
  } catch { /* no asset channel */ }
  return [lemoSignoffCheck(findLemoSignoffLines(files)), lemoCreditsCheck({ credits, assets })];
}

// ———————————————————————————————— gate ————————————————————————————————

/** Measure + evaluate. Throws FinalFilmGateError (FFMPEG_MISSING / FILM_MISSING / CANCELLED / TIMEOUT). */
export async function runFinalFilmGate(options: FinalFilmGateRunOptions): Promise<FinalFilmGateReport> {
  const started = Date.now();
  const now = options.now ?? (() => new Date());
  options.signal?.throwIfAborted();
  const filmPath = resolve(options.filmPath);
  if (!await isFile(filmPath)) throw new FinalFilmGateError('FINAL_GATE_FILM_MISSING', `找不到成片：${filmPath}`);
  const binaries = await resolveFinalFilmFfmpeg(options);
  if (!binaries) throw new FinalFilmGateError('FINAL_GATE_FFMPEG_MISSING', '找不到随应用打包的 ffmpeg，未能复检成片。');
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs(options.expected);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new FinalFilmGateError('FINAL_GATE_TIMEOUT', `成片复检超过 ${Math.round(timeoutMs / 1000)} 秒，已停止。`)), timeoutMs);
  timer.unref?.();
  const onAbort = () => controller.abort(new FinalFilmGateError('FINAL_GATE_CANCELLED', '成片复检已取消。'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const measured = await measureFinalFilm(filmPath, binaries, options.expected, controller.signal, started + timeoutMs);
    const extraChecks = options.lemoProjectDir ? await collectLemoAttributionChecks(options.lemoProjectDir, controller.signal) : [];
    controller.signal.throwIfAborted();
    return buildFinalFilmGateReport({ route: options.route, film: basename(filmPath), checkedAt: now().toISOString(), expected: options.expected,
      probe: measured.probe, probeSource: measured.probeSource, loudness: measured.loudness, frames: measured.frames, extraChecks, elapsedMs: Date.now() - started });
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason instanceof FinalFilmGateError ? controller.signal.reason : new FinalFilmGateError('FINAL_GATE_CANCELLED', '成片复检已取消。');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function finalFilmGateReportPath(filmPath: string) { return join(dirname(resolve(filmPath)), FINAL_FILM_GATE_REPORT_FILE); }

async function writeReport(path: string, report: FinalFilmGateReport) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(report, null, 2) + '\n', 'utf8');
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * Export-side entry point: runs the gate, persists `quality-gate.json` next to the film and logs non-passing rows.
 * Never throws — gate problems are recorded as `status: 'error'` and delivery continues.
 */
export async function runFinalFilmGateSafely(options: FinalFilmGateRunOptions): Promise<FinalFilmGateReport> {
  const started = Date.now();
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.warn(line));
  let report: FinalFilmGateReport;
  try {
    report = await runFinalFilmGate(options);
  } catch (error) {
    const code = error instanceof FinalFilmGateError ? error.code : options.signal?.aborted ? 'FINAL_GATE_CANCELLED' : 'FINAL_GATE_ERROR';
    report = finalFilmGateErrorReport({ route: options.route, film: basename(options.filmPath), checkedAt: now().toISOString(), code,
      message: error instanceof FinalFilmGateError ? error.message.replace(`${code}: `, '') : code === 'FINAL_GATE_CANCELLED' ? '成片复检已取消。' : message(error), expected: options.expected, elapsedMs: Date.now() - started });
  }
  if (options.reportPath !== null) {
    try { await writeReport(options.reportPath ?? finalFilmGateReportPath(options.filmPath), report); } catch (error) { try { log(`[final-film-gate] 无法写入 ${FINAL_FILM_GATE_REPORT_FILE}：${message(error)}`); } catch { /* logging must not throw */ } }
  }
  if (report.status !== 'passed') { try { log(`[final-film-gate] ${options.route} ${report.film} ${report.status}: ${summarizeFinalFilmGate(report)}`); } catch { /* ignore */ } }
  return report;
}
