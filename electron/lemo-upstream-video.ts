/**
 * Final picture/mux for Lemo "upstream" (authoringVersion 3) films.
 *
 * - Picture: runs the vendored `core/render/video.mjs` byte-for-byte unchanged with the
 *   Playwright driver Node + chromium-headless-shell + imageio ffmpeg that ship in
 *   resources/python. See {@link stageLemoUpstreamRenderRoot} for why it runs from a
 *   sha256-verified staged copy of the library instead of from vendor/ directly.
 * - Mux: a TypeScript port of `core/render/mux.sh` that needs only ffmpeg (no ffprobe).
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, cp, link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { readLemoUpstreamManifest } from './lemo-upstream-source';
import { describeLoudnessTarget, loudnessOffTarget, loudnormApplyFilter, loudnormMeasureFilter, loudnormTargetFilter, parseLoudnormJson, type LoudnormMeasurement } from '../src/shared/loudness';
import type { FinalFilmGateExpectation, FinalFilmGateReport } from '../src/shared/final-film-gate';
import { runFinalFilmGateSafely } from './final-film-gate-runner';

export { parseLoudnormJson, type LoudnormMeasurement };

const isWindows = process.platform === 'win32';
const envError = (detail: string) => new Error(`LEMO_UPSTREAM_RENDER_ENV: ${detail}`);

// ———————————————————————————————————————— runtime ————————————————————————————————————————

export interface LemoUpstreamRenderRuntime {
  /** Playwright driver node executable (Node 24 in the bundled Python wheel). */
  nodePath: string;
  /** driver/package — the playwright-core 1.63 JS package. */
  playwrightCorePath: string;
  /** PLAYWRIGHT_BROWSERS_PATH (contains chromium_headless_shell-<revision>). */
  browsersPath: string;
  /** The real imageio ffmpeg binary. */
  ffmpegPath: string;
  /** Directory holding `ffmpeg.exe` (hard link/copy of ffmpegPath); video.mjs spawns `ffmpeg` from PATH. */
  ffmpegDir: string;
}

/** Default shared cache for the ffmpeg alias and staged render roots. main.ts should pass an app cache dir instead. */
export function defaultLemoUpstreamRenderCacheDir() { return join(tmpdir(), 'storydream-lemo-upstream-render'); }

/** resources/python (packaged) and vendor/python (dev) are both siblings of the lemo-upstream root. */
export function defaultLemoUpstreamPythonRoot(upstreamRoot: string) { return join(dirname(resolve(upstreamRoot)), 'python'); }

async function isFile(path: string) { try { return (await stat(path)).isFile(); } catch { return false; } }
async function isDir(path: string) { try { return (await stat(path)).isDirectory(); } catch { return false; } }

export async function resolveLemoUpstreamRenderRuntime(options: { pythonRoot: string; cacheDir: string }): Promise<LemoUpstreamRenderRuntime> {
  if (!options.pythonRoot) throw envError('未提供随应用打包的 Python 运行时目录（resources/python 或 vendor/python）。');
  if (!options.cacheDir) throw envError('未提供渲染缓存目录。');
  const pythonRoot = resolve(options.pythonRoot);
  if (!await isDir(pythonRoot)) throw envError(`找不到随应用打包的 Python 运行时目录：${pythonRoot}`);
  const sitePackages = isWindows ? join(pythonRoot, 'Lib', 'site-packages') : join(pythonRoot, 'lib', 'site-packages');
  const driver = join(sitePackages, 'playwright', 'driver');
  const nodePath = join(driver, isWindows ? 'node.exe' : 'node');
  if (!await isFile(nodePath)) throw envError(`找不到 Playwright 自带的 Node 运行时：${nodePath}`);
  const playwrightCorePath = join(driver, 'package');
  let browsersJson: { browsers?: Array<{ name: string; revision: string }> };
  try {
    const pkg = JSON.parse(await readFile(join(playwrightCorePath, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name !== 'playwright-core' || !await isFile(join(playwrightCorePath, 'index.mjs'))) throw new Error('bad package');
    browsersJson = JSON.parse(await readFile(join(playwrightCorePath, 'browsers.json'), 'utf8'));
  } catch { throw envError(`Playwright 驱动包（playwright-core）缺失或损坏：${playwrightCorePath}`); }
  const browsersPath = join(pythonRoot, 'playwright-browsers');
  const shell = browsersJson.browsers?.find(item => item.name === 'chromium-headless-shell');
  if (!shell) throw envError('playwright-core 的 browsers.json 中没有 chromium-headless-shell。');
  if (!await isDir(join(browsersPath, `chromium_headless_shell-${shell.revision}`))) {
    throw envError(`找不到与 playwright-core 匹配的无头 Chromium（chromium_headless_shell-${shell.revision}）：${browsersPath}`);
  }
  const ffmpegBinaries = join(sitePackages, 'imageio_ffmpeg', 'binaries');
  let names: string[] = [];
  try { names = await readdir(ffmpegBinaries); } catch { /* reported below */ }
  const ffmpegName = names.filter(name => /^ffmpeg/i.test(name) && (!isWindows || /\.exe$/i.test(name))).sort().pop();
  if (!ffmpegName) throw envError(`找不到随应用打包的 ffmpeg：${ffmpegBinaries}`);
  const ffmpegPath = join(ffmpegBinaries, ffmpegName);
  const ffmpegDir = await ensureFfmpegAlias(ffmpegPath, resolve(options.cacheDir));
  return { nodePath, playwrightCorePath, browsersPath, ffmpegPath, ffmpegDir };
}

/** video.mjs spawns plain `ffmpeg`; give it one on PATH: a hard link (same volume) or a copy, verified by size. */
async function ensureFfmpegAlias(ffmpegPath: string, cacheDir: string): Promise<string> {
  const source = await stat(ffmpegPath);
  const dir = join(cacheDir, 'ffmpeg-bin', `${source.size.toString(16)}-${Math.floor(source.mtimeMs).toString(16)}`);
  const target = join(dir, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
  try { if ((await stat(target)).size === source.size) return dir; } catch { /* create */ }
  try {
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.ffmpeg-${randomUUID()}${isWindows ? '.exe' : ''}`);
    try { await link(ffmpegPath, temp); } catch { await copyFile(ffmpegPath, temp); }
    if ((await stat(temp)).size !== source.size) { await rm(temp, { force: true }); throw new Error('size mismatch'); }
    try { await rename(temp, target); } catch (error) {
      await rm(temp, { force: true });
      // Another render created it concurrently (Windows refuses to replace a running exe).
      if (!((await stat(target).catch(() => undefined))?.size === source.size)) throw error;
    }
    if ((await stat(target)).size !== source.size) throw new Error('size mismatch');
  } catch (error) {
    throw envError(`无法在缓存目录准备 ffmpeg.exe（${target}）：${error instanceof Error ? error.message : String(error)}`);
  }
  return dir;
}

// ———————————————————————————————————————— staged render root ————————————————————————————————————————

const STAGE_VERSION = 1;
const STAGE_MARKER = '.storydream-render-root.json';
const STAGED_PREFIXES = ['core/', 'styles/'];
const CRITICAL = ['core/render/video.mjs', 'core/render/page.mjs', 'core/render/serve.mjs', 'core/render/browser.mjs'];
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

export interface LemoRenderRootOptions { upstreamRoot: string; threeRoot: string; resourceRoot?: string; playwrightCorePath: string; cacheDir: string }

/**
 * Upstream's page server serves the directory two levels above video.mjs (`ROOT` in page.mjs) and
 * expects `ROOT/node_modules/{three,playwright-core}` plus the untracked downloads (fonts/HDRs).
 * vendor/ holds only the tracked Git tree, so instead of editing serve.mjs we stage, once per
 * (revision, resources, three, playwright) key, a library root in the cache:
 *   core/** + styles/** + package.json  → byte-identical copies, each verified against storydream-upstream.json
 *   resources.json entries (core/, styles/) → copied after sha256 verification (same rule as serveLemoUpstreamProject)
 *   node_modules/three, node_modules/playwright-core → directory junctions (copy fallback)
 * This serves exactly what serveLemoUpstreamProject serves (tracked files + verified resources + three), and makes
 * `import 'playwright-core'` resolve through plain node_modules lookup — no loader hook, no NODE_PATH.
 */
export async function stageLemoUpstreamRenderRoot(options: LemoRenderRootOptions): Promise<string> {
  const upstreamRoot = await realpath(options.upstreamRoot);
  const threeRoot = await realpath(options.threeRoot).catch(() => { throw envError(`找不到 three 依赖目录：${options.threeRoot}`); });
  const playwrightCorePath = await realpath(options.playwrightCorePath);
  const manifest = await readLemoUpstreamManifest(upstreamRoot);
  const manifestHash = sha256(await readFile(join(upstreamRoot, 'storydream-upstream.json')));
  const resourceRoot = options.resourceRoot ? await realpath(options.resourceRoot) : undefined;
  const resourceIndexText = resourceRoot ? await readFile(join(resourceRoot, 'resources.json'), 'utf8') : '';
  const threeVersion = await readFile(join(threeRoot, 'package.json'), 'utf8').then(text => (JSON.parse(text) as { version?: string }).version ?? '').catch(() => '');
  const playwrightVersion = (JSON.parse(await readFile(join(playwrightCorePath, 'package.json'), 'utf8')) as { version?: string }).version ?? '';
  const key = sha256(JSON.stringify({ STAGE_VERSION, revision: manifest.revision, manifestHash, resources: sha256(resourceIndexText),
    resourceRoot: resourceRoot ?? '', threeRoot, threeVersion, playwrightCorePath, playwrightVersion })).slice(0, 24);
  const parent = join(resolve(options.cacheDir), 'render-root');
  const finalDir = join(parent, key);
  const expected = new Map(manifest.files.map(file => [file.path, file.sha256]));
  if (await validStage(finalDir, key, expected)) return finalDir;

  await mkdir(parent, { recursive: true });
  const temp = join(parent, `.tmp-${randomUUID()}`);
  try {
    const files = manifest.files.filter(file => file.path === 'package.json' || STAGED_PREFIXES.some(prefix => file.path.startsWith(prefix)));
    await mapLimit(files, 16, async file => {
      const data = await readFile(join(upstreamRoot, ...file.path.split('/')));
      if (sha256(data) !== file.sha256) throw new Error(`LEMO_UPSTREAM_INTEGRITY: ${file.path}`);
      const target = join(temp, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    });
    if (resourceRoot) {
      const index = JSON.parse(resourceIndexText) as { revision: string; files: Array<{ path: string; sha256: string }> };
      if (index.revision !== manifest.revision) throw new Error('LEMO_RESOURCE_VERSION');
      for (const item of index.files) {
        // @film/ fallbacks belong to the film mount, which upstream serves straight from the film folder.
        if (!STAGED_PREFIXES.some(prefix => item.path.startsWith(prefix)) || item.path.split('/').some(part => part === '..' || part === '.')) continue;
        const data = await readFile(join(resourceRoot, ...item.path.split('/')));
        if (sha256(data) !== item.sha256) throw new Error(`LEMO_RESOURCE_INTEGRITY: ${item.path}`);
        const target = join(temp, ...item.path.split('/'));
        if (existsSync(target)) continue; // tracked file wins, as in serveLemoUpstreamProject
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data);
      }
    }
    await mkdir(join(temp, 'node_modules'), { recursive: true });
    await linkDirectory(threeRoot, join(temp, 'node_modules', 'three'));
    await linkDirectory(playwrightCorePath, join(temp, 'node_modules', 'playwright-core'));
    await writeFile(join(temp, STAGE_MARKER), JSON.stringify({ version: STAGE_VERSION, key, revision: manifest.revision, threeRoot, playwrightCorePath }, null, 2));
    try { await rename(temp, finalDir); } catch (error) {
      if (await validStage(finalDir, key, expected)) { await removeStage(temp); return finalDir; }
      // An invalid leftover: replace it.
      await removeStage(finalDir);
      await rename(temp, finalDir).catch(() => { throw error; });
    }
  } catch (error) {
    await removeStage(temp);
    if (error instanceof Error && /^LEMO_/.test(error.message)) throw error;
    throw envError(`无法准备上游渲染目录（${finalDir}）：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!await validStage(finalDir, key, expected)) throw envError(`上游渲染目录校验失败：${finalDir}`);
  return finalDir;
}

async function validStage(dir: string, key: string, expected: Map<string, string>) {
  try {
    const marker = JSON.parse(await readFile(join(dir, STAGE_MARKER), 'utf8')) as { version?: number; key?: string };
    if (marker.version !== STAGE_VERSION || marker.key !== key) return false;
    for (const path of CRITICAL) if (sha256(await readFile(join(dir, ...path.split('/')))) !== expected.get(path)) return false;
    return await isFile(join(dir, 'node_modules', 'playwright-core', 'index.mjs')) && await isDir(join(dir, 'node_modules', 'three'));
  } catch { return false; }
}

async function linkDirectory(target: string, path: string) {
  try { await symlink(target, path, isWindows ? 'junction' : 'dir'); }
  catch { await cp(target, path, { recursive: true }); }
}

/** Remove a stage without following its junctions into three / playwright. */
async function removeStage(dir: string) {
  for (const name of ['three', 'playwright-core']) {
    const path = join(dir, 'node_modules', name);
    try { await unlink(path); } catch { /* not a link (copy fallback) or absent: rm below handles it */ }
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  }));
}

// ———————————————————————————————————————— processes ————————————————————————————————————————

interface ProcessResult { code: number | null; stdout: string; stderr: string }
interface ProcessOptions { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number; onStdout?: (chunk: Buffer) => void; onStderr?: (chunk: Buffer) => void; keep?: number; tree?: boolean }

function killTree(pid: number | undefined, tree: boolean): Promise<void> {
  if (!pid) return Promise.resolve();
  if (isWindows) {
    return new Promise(done => {
      const killer = spawn('taskkill', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore', windowsHide: true });
      killer.on('error', () => { try { process.kill(pid); } catch { /* gone */ } done(); });
      killer.on('close', () => done());
    });
  }
  try { process.kill(tree ? -pid : pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return Promise.resolve();
}

/** Spawn and collect output (tail-limited); abort/timeout kill the process (tree). Rejects with the abort reason or a timeout error. */
function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason ?? new Error('aborted')); return; }
    const keep = options.keep ?? 4 * 1024 * 1024;
    let stdout = '', stderr = '', stopped: unknown, killed: Promise<void> = Promise.resolve();
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWindows && !!options.tree });
    const stop = (reason: unknown) => { if (stopped !== undefined) return; stopped = reason; killed = killTree(child.pid, !!options.tree); };
    const onAbort = () => stop(options.signal?.reason ?? new Error('aborted'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => stop(new Error(`LEMO_UPSTREAM_RENDER_TIMEOUT: ${options.timeoutMs}ms`)), options.timeoutMs) : undefined;
    child.stdout.on('data', (chunk: Buffer) => { options.onStdout?.(chunk); stdout = (stdout + chunk.toString('utf8')).slice(-keep); });
    child.stderr.on('data', (chunk: Buffer) => { options.onStderr?.(chunk); stderr = (stderr + chunk.toString('utf8')).slice(-keep); });
    const finish = () => { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); };
    child.on('error', error => { finish(); void killed.then(() => reject(stopped ?? error)); });
    // After a stop, settle only once the whole tree (browsers, ffmpeg) has been killed.
    child.on('close', code => { finish(); if (stopped !== undefined) void killed.then(() => reject(stopped)); else resolvePromise({ code, stdout, stderr }); });
    // A surviving grandchild could keep the stdio pipes (and thus 'close') open forever: do not hang on it.
    child.on('exit', () => { if (stopped !== undefined) void killed.then(() => setTimeout(() => { finish(); reject(stopped); }, 5000).unref()); });
  });
}

const tail = (text: string, lines = 12) => text.split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean).slice(-lines).join('\n');

// ———————————————————————————————————————— video.mjs ————————————————————————————————————————

export interface LemoUpstreamVideoOptions {
  runtime: LemoUpstreamRenderRuntime;
  /** A library root holding core/render/video.mjs and node_modules/{three,playwright-core}: the result of stageLemoUpstreamRenderRoot. */
  upstreamRoot: string;
  filmDir: string;
  outPath: string;
  fps: number;
  workers?: number;
  width: number;
  height: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  logPath?: string;
  /**
   * Short directory for video.mjs's own `--out`. video.mjs creates its hidden segment folder with
   * fs.mkdtempSync next to `--out`, and libuv's mkdtemp fails with ENOENT past Windows MAX_PATH (260),
   * which task export folders reach. The finished file is then moved to outPath.
   */
  scratchDir?: string;
}
export interface LemoUpstreamVideoResult { outPath: string; frames: number; seconds: number; stdout: string; stderr: string; logPath?: string }

export function buildLemoUpstreamVideoEnv(runtime: LemoUpstreamRenderRuntime, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  let path = '';
  for (const [name, value] of Object.entries(base)) {
    if (/^path$/i.test(name)) { path ||= value ?? ''; continue; }
    // Host leftovers that would change the bundled node / browser choice.
    if (/^(NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|PLAYWRIGHT_CHROME|PLAYWRIGHT_BROWSERS_PATH|RENDER_SLOTS|RENDER_SLOT_HELD)$/i.test(name)) continue;
    env[name] = value;
  }
  env.PATH = [runtime.ffmpegDir, path].filter(Boolean).join(isWindows ? ';' : ':');
  env.PLAYWRIGHT_BROWSERS_PATH = runtime.browsersPath;
  return env;
}

/** Run the unchanged upstream renderer. Throws LEMO_UPSTREAM_RENDER_FAILED with the last stderr lines. */
export async function runLemoUpstreamVideo(options: LemoUpstreamVideoOptions): Promise<LemoUpstreamVideoResult> {
  const script = join(options.upstreamRoot, 'core', 'render', 'video.mjs');
  if (!await isFile(script)) throw envError(`找不到上游渲染脚本：${script}`);
  if (!await isFile(join(options.filmDir, 'index.html'))) throw new Error(`LEMO_UPSTREAM_RENDER_FAILED: 影片目录缺少 index.html：${options.filmDir}`);
  const workers = options.workers ?? 3;
  if (!(options.fps > 0) || !Number.isInteger(workers) || workers < 1) throw new Error('LEMO_UPSTREAM_RENDER_FAILED: fps/workers 无效');
  if (![options.width, options.height].every(n => Number.isInteger(n) && n >= 16 && n <= 8192 && n % 2 === 0)) throw new Error('LEMO_CANVAS_SIZE');
  const finalPath = resolve(options.outPath);
  await mkdir(dirname(finalPath), { recursive: true });
  let scratch: string | undefined;
  if (options.scratchDir) {
    await mkdir(resolve(options.scratchDir), { recursive: true });
    scratch = await mkdtemp(join(resolve(options.scratchDir), 'v-'));
  }
  try {
    const result = await runVideoMjs(options, script, workers, scratch ? join(scratch, basename(finalPath)) : finalPath);
    if (scratch) await moveFile(result.outPath, finalPath);
    return { ...result, outPath: finalPath };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

async function moveFile(from: string, to: string) {
  await rm(to, { force: true });
  try { await rename(from, to); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to); await rm(from, { force: true });
  }
}

async function runVideoMjs(options: LemoUpstreamVideoOptions, script: string, workers: number, outPath: string): Promise<LemoUpstreamVideoResult> {
  const log = options.logPath ? createWriteStream(options.logPath, { flags: 'a' }) : undefined;
  const args = [script, resolve(options.filmDir), '--fps', String(options.fps), '--workers', String(workers), '--out', outPath, '--size', `${options.width}x${options.height}`];
  log?.write(`$ ${options.runtime.nodePath} ${args.join(' ')}\n`);
  const started = Date.now();
  let result: ProcessResult;
  try {
    result = await runProcess(options.runtime.nodePath, args, { cwd: options.upstreamRoot, env: buildLemoUpstreamVideoEnv(options.runtime), signal: options.signal,
      timeoutMs: options.timeoutMs, tree: true, keep: 512 * 1024, onStdout: chunk => log?.write(chunk), onStderr: chunk => log?.write(chunk) });
  } catch (error) {
    // Killed: video.mjs's own exit cleanup never ran; remove its lock and hidden segment folder for this --out.
    await cleanupVideoLeftovers(outPath);
    log?.write(`\n[storydream] stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    await new Promise(done => log ? log.end(done) : done(undefined));
    if (error instanceof Error && /^LEMO_UPSTREAM_RENDER_TIMEOUT/.test(error.message)) throw new Error(`LEMO_UPSTREAM_RENDER_FAILED: 渲染超时（${options.timeoutMs}ms）`);
    throw error;
  }
  const seconds = (Date.now() - started) / 1000;
  log?.write(`\n[storydream] exit ${result.code} after ${seconds.toFixed(1)}s\n`);
  await new Promise(done => log ? log.end(done) : done(undefined));
  const done = /(?:^|\n)done .* (\d+) frames \S+\s*$/.exec(result.stdout.trimEnd());
  const size = (await stat(outPath).catch(() => undefined))?.size ?? 0;
  if (result.code !== 0 || !done || !size) {
    await cleanupVideoLeftovers(outPath);
    throw new Error(`LEMO_UPSTREAM_RENDER_FAILED: ${tail(result.stderr) || tail(result.stdout) || `exit code ${result.code}`}`);
  }
  return { outPath, frames: Number(done[1]), seconds, stdout: result.stdout, stderr: result.stderr, logPath: options.logPath };
}

async function cleanupVideoLeftovers(outPath: string) {
  const dir = dirname(outPath), base = basename(outPath, extname(outPath));
  await rm(`${outPath}.lock`, { force: true }).catch(() => {});
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) if (name.startsWith(`.${base}_segs-`)) await rm(join(dir, name), { recursive: true, force: true }).catch(() => {});
}

// ———————————————————————————————————————— ffmpeg probing ————————————————————————————————————————

export interface FfmpegProbe {
  durationSeconds: number | null;
  video: { codec: string; width: number; height: number; fps: number | null } | null;
  audio: { codec: string; sampleRate: number | null } | null;
}
const clock = (value: string) => { const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim()); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };

/** Parse `ffmpeg -hide_banner -i <file>` stderr (stands in for ffprobe, which is not bundled). */
export function parseFfmpegProbe(stderr: string): FfmpegProbe {
  const duration = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(stderr);
  const videoLine = /Stream #\d+:\d+[^\n]*?: Video: ([^\s,]+)[^\n]*/.exec(stderr);
  const audioLine = /Stream #\d+:\d+[^\n]*?: Audio: ([^\s,]+)[^\n]*/.exec(stderr);
  const dims = videoLine ? /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(videoLine[0]) : null;
  const fps = videoLine ? /,\s*(\d+(?:\.\d+)?) fps/.exec(videoLine[0]) : null;
  const rate = audioLine ? /,\s*(\d+) Hz/.exec(audioLine[0]) : null;
  return {
    durationSeconds: duration ? clock(duration[1]) : null,
    video: videoLine ? { codec: videoLine[1], width: dims ? +dims[1] : 0, height: dims ? +dims[2] : 0, fps: fps ? +fps[1] : null } : null,
    audio: audioLine ? { codec: audioLine[1], sampleRate: rate ? +rate[1] : null } : null,
  };
}

export async function probeLemoMedia(ffmpegPath: string, file: string, signal?: AbortSignal): Promise<FfmpegProbe> {
  const result = await runProcess(ffmpegPath, ['-hide_banner', '-i', file], { signal });
  if (!/Input #0/.test(result.stderr)) throw new Error(`LEMO_UPSTREAM_MUX_FAILED: ffmpeg 无法读取 '${file}': ${tail(result.stderr, 2)}`);
  return parseFfmpegProbe(result.stderr);
}

/** Extract single frames (by decoded frame index n, no frame-rate conversion) as PNG stills. */
export async function extractLemoFrames(ffmpegPath: string, videoPath: string, frames: Array<{ index: number; path: string }>, signal?: AbortSignal) {
  for (const frame of frames) {
    const result = await runProcess(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoPath,
      '-vf', `select=eq(n\\,${frame.index})`, '-fps_mode', 'passthrough', '-frames:v', '1', frame.path], { signal });
    if (result.code !== 0 || !await isFile(frame.path)) throw new Error(`LEMO_UPSTREAM_RENDER_FAILED: 无法抽取第 ${frame.index} 帧：${tail(result.stderr, 3)}`);
  }
}

// ———————————————————————————————————————— mux.sh port: pure builders ————————————————————————————————————————

/** Shared final-film target (src/shared/loudness.ts): −14 LUFS, TP −1 dB, LRA 11. */
export const LOUDNORM_TARGET = loudnormTargetFilter();

export interface MuxArgsOptions {
  videoPath: string;
  /** Separate mixed-audio file (mux.sh's 2nd argument). Omit when the audio is inside videoPath. */
  audioPath?: string;
  outputPath: string;
  fps: number;
  grain: number;
  /** Second-pass measurement; null = silent/unmeasurable (anull). */
  loudnorm: LoudnormMeasurement | null;
  /** Pad audio with silence to this length (the picture's) when the audio is shorter. */
  padToSeconds: number | null;
  hasAudio: boolean;
  /** mux.sh LEMO_COLOR: default keeps video.mjs's range/tags; 'bt709' converts to limited-range BT.709. */
  color?: 'default' | 'bt709';
}

const num = (value: number) => String(Number(value.toFixed(6)));

export function buildMuxVideoFilter(fps: number, grain: number, color: 'default' | 'bt709' = 'default') {
  let vf = grain === 0 ? `fps=${num(fps)}` : `fps=${num(fps)},noise=c0s=${num(grain)}:allf=t`;
  vf += color === 'bt709'
    ? ',scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709'
    : ',format=yuv420p';
  return vf;
}

export function buildMuxAudioFilter(loudnorm: LoudnormMeasurement | null, padToSeconds: number | null) {
  const ln = loudnorm ? loudnormApplyFilter(loudnorm) : 'anull';
  return `${ln},aresample=48000${padToSeconds && padToSeconds > 0 ? `,apad=whole_dur=${num(padToSeconds)}` : ''}`;
}

/** The final ffmpeg command of mux.sh, as an argument vector (no shell). */
export function buildMuxArgs(options: MuxArgsOptions): string[] {
  if (!(options.fps > 0)) throw new Error('LEMO_UPSTREAM_MUX_FAILED: fps 必须是正数');
  if (!(options.grain >= 0)) throw new Error('LEMO_UPSTREAM_MUX_FAILED: grain 必须 ≥ 0');
  const color = options.color ?? 'default';
  const vf = buildMuxVideoFilter(options.fps, options.grain, color);
  const inputs = ['-i', options.videoPath, ...(options.hasAudio && options.audioPath ? ['-i', options.audioPath] : [])];
  const colorArgs = color === 'bt709' ? ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'] : [];
  const videoCodec = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-r', num(options.fps), ...colorArgs];
  if (!options.hasAudio) {
    return ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `[0:v]${vf}[v]`, '-map', '[v]', ...videoCodec, '-an', '-movflags', '+faststart', options.outputPath];
  }
  const audioIn = options.audioPath ? '[1:a]' : '[0:a:0]';
  return ['-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', `[0:v]${vf}[v];${audioIn}${buildMuxAudioFilter(options.loudnorm, options.padToSeconds)}[a]`,
    '-map', '[v]', '-map', '[a]', ...videoCodec, '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', options.outputPath];
}

export interface Ebur128Summary { integratedLufs: number | null; lra: number | null; truePeak: number | null }
const level = (value: string | undefined) => {
  if (value === undefined) return null;
  if (/^-inf$/i.test(value)) return -Infinity;
  if (/^\+?inf$/i.test(value)) return Infinity;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};
/** Parse the ebur128=peak=true summary (`I:`, `LRA:`, `Peak:` lines, as mux.sh greps them). */
export function parseEbur128(stderr: string): Ebur128Summary {
  const summary = stderr.lastIndexOf('Summary:') >= 0 ? stderr.slice(stderr.lastIndexOf('Summary:')) : stderr;
  const pick = (label: string) => new RegExp(`^\\s+${label}:\\s+(-?inf|[-+]?\\d+(?:\\.\\d+)?)`, 'mi').exec(summary)?.[1];
  return { integratedLufs: level(pick('I')), lra: level(pick('LRA')), truePeak: level(pick('Peak')) };
}

/** mux.sh's final check: off target when loudness is outside −15…−13 LUFS or the true peak is above −1 dB. */
export function ebur128OffTarget(summary: Ebur128Summary) {
  return loudnessOffTarget(summary);
}

// decoder/demuxer lines with error wording mean damage, except the three streamed-WAV notices.
const DAMAGE = /error|invalid|corrupt|header missing|overread|truncat|incomplete/i;
const BENIGN = /Ignoring maximum wav data size|Packet corrupt \(stream = \d+, dts = NOPTS\)|corrupt input packet in stream \d+/;
export function decodeDamage(stderr: string): { bad: string[]; noted: boolean } {
  const errors = stderr.split(/\r?\n/).filter(line => /^\[/.test(line) && DAMAGE.test(line));
  return { bad: errors.filter(line => !BENIGN.test(line)).slice(0, 2), noted: errors.length > 0 };
}
export function lastProgressSeconds(stderr: string) {
  const values = [...stderr.matchAll(/^out_time=(.+)$/gm)].map(m => m[1].trim());
  const last = values.pop();
  if (!last || last.startsWith('-') || !last.includes(':')) return 0;
  return clock(last) ?? 0;
}

// ———————————————————————————————————————— mux.sh port: runner ————————————————————————————————————————

export interface LemoMuxOptions {
  ffmpegPath: string;
  /** The host's finished film: picture + already-mixed audio in one file (or picture only). */
  videoPath: string;
  /** Optional separate mixed audio, exactly like mux.sh's 2nd argument. */
  audioPath?: string;
  outputPath: string;
  fps?: number;
  grain?: number;
  color?: 'default' | 'bt709';
  signal?: AbortSignal;
}
export interface LemoMuxResult { outputPath: string; measured: { integratedLufs: number; truePeak: number; lra: number } | null; warnings: string[] }

const muxError = (detail: string) => new Error(`LEMO_UPSTREAM_MUX_FAILED: ${detail}`);

export async function muxLemoUpstreamFilm(options: LemoMuxOptions): Promise<LemoMuxResult> {
  const fps = options.fps ?? 24, grain = options.grain ?? 2;
  if (!(fps > 0)) throw muxError(`fps 必须是正数，收到 ${fps}`);
  if (!(grain >= 0)) throw muxError(`grain 必须是 ≥0 的数字（0 = 无颗粒），收到 ${grain}`);
  if (!await isFile(options.videoPath)) throw muxError(`找不到视频：${options.videoPath}`);
  if (options.audioPath && !await isFile(options.audioPath)) throw muxError(`找不到音频：${options.audioPath}`);
  const warnings: string[] = [];
  const ff = (args: string[]) => runProcess(options.ffmpegPath, args, { signal: options.signal });
  const picture = await probeLemoMedia(options.ffmpegPath, options.videoPath, options.signal);
  if (!picture.video) throw muxError(`'${options.videoPath}' 中没有视频流`);
  const audioFile = options.audioPath ?? options.videoPath;
  const audioProbe = options.audioPath ? await probeLemoMedia(options.ffmpegPath, options.audioPath, options.signal) : picture;
  if (options.audioPath && !audioProbe.audio) throw muxError(`'${options.audioPath}' 中没有音频流（它真的是混音文件吗？）`);
  const hasAudio = !!audioProbe.audio;

  let loudnorm: LoudnormMeasurement | null = null, padToSeconds: number | null = null;
  if (!hasAudio) {
    warnings.push('成片没有音轨：只做了画面处理（帧率/颗粒/编码），未做响度标准化。');
  } else {
    // first pass: measure loudness (decoded seconds come from -progress)
    const first = await ff(['-hide_banner', '-nostats', '-progress', 'pipe:2', '-i', audioFile, '-map', '0:a:0', '-af', loudnormMeasureFilter(), '-f', 'null', '-']);
    if (first.code !== 0) throw muxError(`ffmpeg 无法读取音频 '${audioFile}'：${tail(first.stderr, 2)}`);
    const damage = decodeDamage(first.stderr);
    if (damage.bad.length) throw muxError(`音频 '${audioFile}' 已损坏，ffmpeg 解码时报告：\n${damage.bad.join('\n')}`);
    const decoded = lastProgressSeconds(first.stderr);
    if (options.audioPath) {
      // Truncation check of a separate audio file: decoded vs container-claimed seconds (skip bitrate estimates).
      const claimed = audioProbe.durationSeconds ?? 0, tol = Math.max(claimed * 0.05, 0.15);
      if (!/Estimating duration from bitrate/.test(first.stderr) && claimed > 0 && claimed - decoded > tol) {
        throw muxError(`'${audioFile}' 声称 ${claimed} 秒，但只能解码 ${decoded} 秒：文件已损坏或被截断`);
      }
    }
    if (damage.noted) warnings.push(`ffmpeg 对 '${audioFile}' 的文件头/结尾有抱怨，但 ${decoded} 秒全部解码成功，继续。`);
    const parsed = parseLoudnormJson(first.stderr);
    if (!parsed) throw muxError(`无法从 ffmpeg 输出中读取 loudnorm 测量结果：${tail(first.stderr, 2)}`);
    loudnorm = parsed.measurement;
    if (!loudnorm) warnings.push('音频静音或低于 -70 LUFS，已跳过响度标准化。');
    // pad with silence when the audio is shorter than the picture
    const videoSeconds = picture.durationSeconds ?? 0;
    const audioSeconds = options.audioPath ? (audioProbe.durationSeconds ?? decoded) : decoded;
    // Same file: the container duration is max(video, audio), so a shorter audio implies videoSeconds is the picture's length.
    if (audioSeconds > 0 && videoSeconds > 0 && audioSeconds < videoSeconds - 0.02) {
      padToSeconds = videoSeconds;
      warnings.push(`音频（${audioSeconds.toFixed(3)} 秒）短于画面（${videoSeconds.toFixed(3)} 秒），已用静音补齐。`);
    }
  }

  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const temp = join(dirname(outputPath), `.${basename(outputPath, extname(outputPath))}.mux-${randomUUID()}${extname(outputPath) || '.mp4'}`);
  try {
    const args = buildMuxArgs({ videoPath: options.videoPath, audioPath: options.audioPath, outputPath: temp, fps, grain, loudnorm, padToSeconds, hasAudio, color: options.color });
    const result = await ff(args);
    if (result.code !== 0) throw muxError(`ffmpeg 写出 '${outputPath}' 失败：${tail(result.stderr, 4)}`);
    if (!((await stat(temp).catch(() => undefined))?.size)) throw muxError(`没有写出任何内容到 '${outputPath}'`);
    await rename(temp, outputPath);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }

  let measured: LemoMuxResult['measured'] = null;
  if (hasAudio) {
    const check = await ff(['-hide_banner', '-nostats', '-i', outputPath, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
    const summary = parseEbur128(check.stderr);
    if (summary.integratedLufs !== null && summary.truePeak !== null && summary.lra !== null) {
      measured = { integratedLufs: summary.integratedLufs, truePeak: summary.truePeak, lra: summary.lra };
    }
    if (loudnorm && ebur128OffTarget(summary)) {
      warnings.push(`成片未达到目标（${describeLoudnessTarget()}）：实测 ${summary.integratedLufs} LUFS，峰值 ${summary.truePeak} dB。混音可能削波或峰值过高，请降低并压住峰值后重新合成。`);
    }
  }
  return { outputPath, measured, warnings };
}

/** Run the mux.sh port on a finished host film in place: mux to a sibling temp file, then atomically replace `path`.
 * With `qualityGate`, the advisory final-film gate (E-5/L-5: ffprobe-style recheck + §11 sign-off/CREDITS) runs on the
 * muxed film and writes quality-gate.json next to it; gate problems never fail the export. */
export async function finalizeLemoUpstreamFilm(path: string, options: { ffmpegPath: string; fps?: number; grain?: number; color?: 'default' | 'bt709'; signal?: AbortSignal;
  qualityGate?: { expected: Omit<FinalFilmGateExpectation, 'fps'> & { fps?: number }; lemoProjectDir?: string } }): Promise<LemoMuxResult & { qualityGate?: FinalFilmGateReport }> {
  const { qualityGate, ...muxOptions } = options;
  const target = resolve(path);
  const sibling = join(dirname(target), `.${basename(target, extname(target))}.final-${randomUUID()}${extname(target) || '.mp4'}`);
  try {
    const result = await muxLemoUpstreamFilm({ ...muxOptions, videoPath: target, outputPath: sibling });
    options.signal?.throwIfAborted();
    await rename(sibling, target);
    if (!qualityGate) return { ...result, outputPath: target };
    const report = await runFinalFilmGateSafely({ route: 'lemo', filmPath: target, ffmpegPath: options.ffmpegPath, signal: options.signal,
      lemoProjectDir: qualityGate.lemoProjectDir, expected: { ...qualityGate.expected, fps: qualityGate.expected.fps ?? options.fps ?? 24 } });
    return { ...result, outputPath: target, qualityGate: report };
  } finally {
    await rm(sibling, { force: true }).catch(() => {});
  }
}

// ———————————————————————— opt-in, metadata-only colour retag (NOT used by the faithful default) ————————————————————————
//
// docs/design/2026-11-10-color-tag-screening.md. The faithful mux (buildMuxArgs color:'default') adds no colour args, so it
// keeps whatever the input frames carry: a raw video.mjs picture is `yuvj420p(pc, bt470bg/unknown/unknown)`, while the
// production input (director capture → storybound sidecar) is already `tv, bt709/bt709/iec61966-2-1`. This rewrites only the
// SPS VUI with the h264_metadata bitstream filter (`-c copy`): slice data, audio and timing stay byte-identical. Nothing calls
// it by default; the product decides whether faithful films may carry it.

/** H.264 VUI code points (ITU-T H.264 Tables E-3 / E-4 / E-5) accepted by `h264_metadata`. */
const H264_VUI_CODES = {
  primaries: { bt709: 1, bt470bg: 5, smpte170m: 6 },
  transfer: { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13 },
  matrix: { bt709: 1, bt470bg: 5, smpte170m: 6 },
} as const;

export interface LemoColorRetagTags {
  primaries?: keyof typeof H264_VUI_CODES.primaries;
  transfer?: keyof typeof H264_VUI_CODES.transfer;
  /** Relabels the YCbCr matrix WITHOUT converting pixels: only correct when the picture really uses that matrix. */
  matrix?: keyof typeof H264_VUI_CODES.matrix;
  /** Relabels the range WITHOUT converting pixels: only correct when the samples really are in that range. */
  range?: 'tv' | 'pc';
}

/**
 * Recommended preset: describe what the faithful picture really is (sRGB browser capture → BT.709 primaries, sRGB transfer)
 * and leave range / matrix exactly as encoded. On a raw video.mjs picture this gives `pc, bt470bg/bt709/iec61966-2-1`
 * (the final-film gate still flags range/matrix — that needs mux color:'bt709', a pixel conversion).
 */
export const LEMO_FAITHFUL_COLOR_RETAG: Readonly<LemoColorRetagTags> = Object.freeze({ primaries: 'bt709', transfer: 'iec61966-2-1' });

/** `h264_metadata=` option string, e.g. `colour_primaries=1:transfer_characteristics=13`. */
export function buildH264ColorMetadataFilter(tags: LemoColorRetagTags): string {
  const parts: string[] = [];
  if (tags.range !== undefined) {
    if (tags.range !== 'tv' && tags.range !== 'pc') throw new Error(`LEMO_COLOR_RETAG_INVALID: range ${String(tags.range)}`);
    parts.push(`video_full_range_flag=${tags.range === 'pc' ? 1 : 0}`);
  }
  const code = (table: Record<string, number>, value: string | undefined, label: string, key: string) => {
    if (value === undefined) return;
    if (!Object.prototype.hasOwnProperty.call(table, value)) throw new Error(`LEMO_COLOR_RETAG_INVALID: ${label} ${value}`);
    parts.push(`${key}=${table[value]}`);
  };
  code(H264_VUI_CODES.primaries, tags.primaries, 'primaries', 'colour_primaries');
  code(H264_VUI_CODES.transfer, tags.transfer, 'transfer', 'transfer_characteristics');
  code(H264_VUI_CODES.matrix, tags.matrix, 'matrix', 'matrix_coefficients');
  if (!parts.length) throw new Error('LEMO_COLOR_RETAG_INVALID: no tag requested');
  return `h264_metadata=${parts.join(':')}`;
}

/** Stream-copy argument vector: every stream copied, only the H.264 SPS VUI rewritten. */
export function buildLemoColorRetagArgs(inputPath: string, outputPath: string, tags: LemoColorRetagTags = LEMO_FAITHFUL_COLOR_RETAG): string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-map', '0', '-c', 'copy', '-bsf:v', buildH264ColorMetadataFilter(tags),
    '-movflags', '+faststart', outputPath];
}

/**
 * Opt-in post-mux retag of a finished film, in place (sibling temp file + atomic rename). Not wired into
 * finalizeLemoUpstreamFilm: call it explicitly after the faithful mux if the product accepts VUI-only changes.
 */
export async function retagLemoFilmColorMetadata(path: string, options: { ffmpegPath: string; tags?: LemoColorRetagTags; signal?: AbortSignal; timeoutMs?: number }): Promise<{ outputPath: string; filter: string }> {
  const target = resolve(path);
  const tags = options.tags ?? LEMO_FAITHFUL_COLOR_RETAG;
  const filter = buildH264ColorMetadataFilter(tags);
  const sibling = join(dirname(target), `.${basename(target, extname(target))}.retag-${randomUUID()}${extname(target) || '.mp4'}`);
  try {
    const result = await runProcess(options.ffmpegPath, buildLemoColorRetagArgs(target, sibling, tags), { signal: options.signal, timeoutMs: options.timeoutMs ?? 10 * 60_000 });
    if (result.code !== 0) throw new Error(`LEMO_COLOR_RETAG_FAILED: ${tail(result.stderr, 4)}`);
    options.signal?.throwIfAborted();
    await rename(sibling, target);
    return { outputPath: target, filter };
  } finally {
    await rm(sibling, { force: true }).catch(() => {});
  }
}

/** mux.sh: "grain … use 0 for pixel/vector styles". Reads the film's STYLE.md / TREATMENT.md. */
export async function lemoFilmGrain(filmDir: string): Promise<number> {
  let names: string[] = [];
  try { names = await readdir(filmDir); } catch { return 2; }
  for (const name of names) {
    if (!/^(style|treatment)\.md$/i.test(name)) continue;
    const text = await readFile(join(filmDir, name), 'utf8').catch(() => '');
    if (/\b(?:pixel(?:[- ]?art)?|pixels|vector(?:[- ]art)?|flat[- ](?:vector|design|colou?rs?|shapes?|illustration))\b|像素|矢量|扁平/i.test(text)) return 0;
  }
  return 2;
}

export const lemoUpstreamVideoInternals = { runProcess, tail };
