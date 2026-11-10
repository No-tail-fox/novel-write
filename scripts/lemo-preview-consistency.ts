/**
 * L-6 预览一致性：上游 still.mjs 与应用内预览在同一时刻各截一帧，比较感知哈希，写 JSON 报告。
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/lemo-preview-consistency.ts [--film tests/fixtures/lemo-preview]
 *     [--size 480x270] [--fps 30] [--duration 2] [--count 5 | --times 0,0.5,1] [--out <report.json>]
 *     [--app-dpr] [--gpu] [--keep]
 *
 * 两侧怎么渲染：
 * - 参考侧（upstream-still）：随应用打包的 Playwright 驱动 Node（vendor/python/.../playwright/driver/node.exe）运行
 *   **原样的** `core/render/still.mjs <film> <t…> --size WxH --out <dir>`，与成片路径（lemo-upstream-video.ts 的 video.mjs）
 *   完全相同的运行方式：同一个 sha256 校验过的上游库暂存目录（stageLemoUpstreamRenderRoot，node_modules/playwright-core
 *   和 three 用目录联接）、同一套环境变量（PLAYWRIGHT_BROWSERS_PATH → chromium-headless-shell）。输出 JPEG q92，视口 W×H、DPR 1。
 * - 应用侧：node_modules/electron 子进程（scripts/lemo-preview-consistency-runner.cjs）里跑 esbuild 打包的产品代码：
 *   (1) app-preview = electron/lemo-upstream-renderer.ts 的 reviewLemoUpstreamProject（faithful 模式文档 §6 指定的应用内预览：
 *       本机 HTTP 服务 + 私有 partition + offscreen 窗口，render(t) 后两次 rAF 再 capturePage，存 PNG）；
 *   (2) capture-host = electron/capture-host.ts 的 CaptureHost + lemo 适配器（SceneRuntime：帧号 n → t = n / fps 秒）。
 *   上游 JPEG 也在同一 Electron 进程里用 nativeImage 解码成 BGRA，三侧都用 src/shared/frame-hash.ts 算 8×8 aHash/dHash。
 *
 * 判定与阈值见 src/shared/lemo-preview-consistency.ts（aHash/dHash ≤ 3 位，平均亮度差 ≤ 3）。
 * 前置条件缺失（打包的 Python/Playwright/无头浏览器、three、Electron 可执行文件）时报告 status=skip 并写明原因，不算失败。
 * OPC_LEMO_PREVIEW_CONSISTENCY=0 关闭。临时文件在仓库内被忽略的 .tmp-lemo-preview-consistency/ 下，结束后删除（--keep 保留）。
 * 不访问网络。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLemoUpstreamVideoEnv,
  defaultLemoUpstreamPythonRoot,
  defaultLemoUpstreamRenderCacheDir,
  resolveLemoUpstreamRenderRuntime,
  stageLemoUpstreamRenderRoot,
  type LemoUpstreamRenderRuntime,
} from '../electron/lemo-upstream-video';
import {
  LEMO_PREVIEW_CONSISTENCY_TOLERANCE,
  buildPreviewConsistencyReport,
  buildPreviewConsistencyTimes,
  skippedPreviewConsistencyReport,
  upstreamBrowserUnavailableReason,
  validatePreviewConsistencyTimes,
  type PreviewConsistencyFrameInput,
  type PreviewConsistencyReport,
  type PreviewConsistencySide,
} from '../src/shared/lemo-preview-consistency';

const repoRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface LemoPreviewConsistencyOptions {
  /** 含 index.html 的影片目录（Lemo 页面契约）。 */
  filmDir: string;
  width: number;
  height: number;
  fps: number;
  /** 页面 window.DUR（秒）；用来生成时间点和检查越界。 */
  durationSeconds: number;
  /** 显式时间点（秒，必须对齐到帧）；缺省按 count 均匀取。 */
  times?: number[];
  count?: number;
  /** 报告输出路径（缺省不写文件，只返回）。 */
  reportPath?: string;
  /** 保留 scratch（帧、bundle、日志）便于人工查看。 */
  keepScratch?: boolean;
  /** 应用侧 Electron 加 --force-device-scale-factor=1（默认 true，与 golden-frames / qa-lemo-upstream 一致）；false = 与正式 main.ts 一样不强制。 */
  forceDeviceScaleFactor?: boolean;
  /** 应用侧 Electron 关闭硬件加速（默认 true，与 golden-frames 一致；正式应用不关）。 */
  disableGpu?: boolean;
  repoRoot?: string;
  upstreamRoot?: string;
  threeRoot?: string;
  pythonRoot?: string;
  cacheDir?: string;
  electronBinary?: string | null;
  timeoutMs?: number;
  log?: (message: string) => void;
}

interface RunnerFrame { time: number; index: number; file: string; width: number; height: number; bytes: number }
interface RunnerSide { ok: boolean; frames: RunnerFrame[]; errors: string[]; receipt?: unknown; descriptor?: unknown; pageErrors?: string[] }
interface RunnerResult {
  fatal?: string;
  electron?: string;
  chrome?: string;
  displayScaleFactor?: number;
  forceDeviceScaleFactor?: boolean;
  disableGpu?: boolean;
  gpuFeatureStatus?: unknown;
  sides?: Partial<Record<PreviewConsistencySide, RunnerSide>>;
}

export function findElectronBinary(): string | null {
  try {
    const value: unknown = createRequire(import.meta.url)('electron');
    return typeof value === 'string' && existsSync(value) ? value : null;
  } catch {
    return null;
  }
}

export interface LemoPreviewPrerequisites {
  ok: boolean;
  reason?: string;
  upstreamRoot: string;
  threeRoot: string;
  pythonRoot: string;
  electronBinary: string | null;
}

/** 只看文件是否存在（同步、无副作用），给 vitest 的 skipIf 用；完整校验（驱动包、浏览器修订号匹配）在运行时做。 */
export function checkLemoPreviewPrerequisites(options: { repoRoot?: string; upstreamRoot?: string; threeRoot?: string; pythonRoot?: string; electronBinary?: string | null } = {}): LemoPreviewPrerequisites {
  const repoRoot = options.repoRoot ?? repoRootDefault;
  const upstreamRoot = options.upstreamRoot ?? join(repoRoot, 'vendor', 'lemo-upstream');
  const threeRoot = options.threeRoot ?? join(repoRoot, 'node_modules', 'three');
  const pythonRoot = options.pythonRoot ?? defaultLemoUpstreamPythonRoot(upstreamRoot);
  const electronBinary = options.electronBinary === undefined ? findElectronBinary() : options.electronBinary;
  const base = { upstreamRoot, threeRoot, pythonRoot, electronBinary };
  const driver = join(pythonRoot, process.platform === 'win32' ? join('Lib', 'site-packages') : join('lib', 'site-packages'), 'playwright', 'driver');
  if (process.env.OPC_LEMO_PREVIEW_CONSISTENCY === '0') return { ok: false, reason: 'OPC_LEMO_PREVIEW_CONSISTENCY=0 关闭了 L-6 预览一致性', ...base };
  if (!existsSync(join(upstreamRoot, 'core', 'render', 'still.mjs'))) return { ok: false, reason: `找不到上游 still.mjs：${join(upstreamRoot, 'core', 'render', 'still.mjs')}`, ...base };
  if (!existsSync(join(threeRoot, 'package.json'))) return { ok: false, reason: `找不到 three 依赖（上游库根目录需要 node_modules/three）：${threeRoot}`, ...base };
  if (!existsSync(join(driver, process.platform === 'win32' ? 'node.exe' : 'node')) || !existsSync(join(driver, 'package', 'package.json'))) {
    return { ok: false, reason: `找不到随应用打包的 Playwright 驱动（node + playwright-core），still.mjs 无法按上游方式运行：${driver}`, ...base };
  }
  if (!existsSync(join(pythonRoot, 'playwright-browsers'))) return { ok: false, reason: `找不到随应用打包的无头 Chromium 目录：${join(pythonRoot, 'playwright-browsers')}`, ...base };
  if (!electronBinary) return { ok: false, reason: '找不到 node_modules/electron 可执行文件，无法运行应用内预览路径', ...base };
  return { ok: true, ...base };
}

function runChild(command: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-64_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-64_000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} 超时（${options.timeoutMs} ms）\n${stderr.slice(-2000)}`)); }, options.timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
  });
}

/** 上游 still.mjs：原样运行，每个 t 写 <prefix><t>.jpg。 */
async function runUpstreamStill(runtime: LemoUpstreamRenderRuntime, stageRoot: string, options: { filmDir: string; times: number[]; width: number; height: number; outDir: string; timeoutMs: number }) {
  const script = join(stageRoot, 'core', 'render', 'still.mjs');
  const timeArgs = options.times.map(time => String(time));
  const args = [script, resolve(options.filmDir), ...timeArgs, '--size', `${options.width}x${options.height}`, '--out', options.outDir, '--prefix', 't_'];
  const result = await runChild(runtime.nodePath, args, { cwd: stageRoot, env: buildLemoUpstreamVideoEnv(runtime), timeoutMs: options.timeoutMs });
  return { ...result, command: [runtime.nodePath, ...args], frames: options.times.map((time, index) => ({ time, path: join(options.outDir, `t_${timeArgs[index]}.jpg`) })) };
}

async function bundleRunnerLibrary(repoRoot: string, outfile: string) {
  const { build } = await import('esbuild');
  await build({
    stdin: {
      contents: [
        "export { reviewLemoUpstreamProject } from './electron/lemo-upstream-renderer';",
        "export { serveLemoUpstreamProject } from './electron/lemo-upstream-source';",
        "export { CaptureHost } from './electron/capture-host';",
        "export { createElectronCaptureWindowFactory } from './electron/capture-host-electron';",
      ].join('\n'),
      resolveDir: repoRoot,
      loader: 'ts',
      sourcefile: 'lemo-preview-consistency-entry.ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    outfile,
    logLevel: 'silent',
  });
}

function runElectron(binary: string, runnerPath: string, jobPath: string, scratch: string, timeoutMs: number) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const sandboxDirs = { TEMP: join(scratch, 'tmp'), TMP: join(scratch, 'tmp'), APPDATA: join(scratch, 'appdata'), LOCALAPPDATA: join(scratch, 'localappdata') };
  Object.assign(env, sandboxDirs, { ELECTRON_ENABLE_LOGGING: '0', ELECTRON_NO_ATTACH_CONSOLE: '1' });
  return Promise.all(Object.values(sandboxDirs).map(dir => mkdir(dir, { recursive: true })))
    .then(() => runChild(binary, [runnerPath, `--user-data-dir=${join(scratch, 'profile', 'chromium')}`, jobPath], { env, timeoutMs }));
}

async function writeReport(report: PreviewConsistencyReport, reportPath: string | undefined) {
  if (!reportPath) return;
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/** 跑一次完整比较。前置条件缺失 → status=skip；渲染/协议错误 → 抛错（真实故障，不伪装成 skip）。 */
export async function runLemoPreviewConsistency(options: LemoPreviewConsistencyOptions): Promise<PreviewConsistencyReport> {
  const log = options.log ?? (() => undefined);
  const repoRoot = options.repoRoot ?? repoRootDefault;
  const times = options.times
    ? validatePreviewConsistencyTimes(options.times, options.durationSeconds, options.fps)
    : buildPreviewConsistencyTimes({ durationSeconds: options.durationSeconds, fps: options.fps, count: options.count ?? 5 });
  if (![options.width, options.height].every(value => Number.isInteger(value) && value >= 16 && value <= 8192 && value % 2 === 0)) {
    throw new RangeError(`LEMO_PREVIEW_SIZE_INVALID: ${options.width}x${options.height}（still.mjs 要求 16–8192 的偶数）`);
  }
  const canvas = { width: options.width, height: options.height, fps: options.fps, durationSeconds: options.durationSeconds };
  const forceDeviceScaleFactor = options.forceDeviceScaleFactor ?? true;
  const disableGpu = options.disableGpu ?? true;
  const filmDir = resolve(options.filmDir);
  const environment: Record<string, unknown> = { filmDir: relative(repoRoot, filmDir).split(sep).join('/') || filmDir, forceDeviceScaleFactor, disableGpu };
  const prerequisites = checkLemoPreviewPrerequisites({ repoRoot, upstreamRoot: options.upstreamRoot, threeRoot: options.threeRoot, pythonRoot: options.pythonRoot, electronBinary: options.electronBinary });
  const skip = async (reason: string) => {
    log(`SKIP: ${reason}`);
    const report = skippedPreviewConsistencyReport(reason, { canvas, times, environment });
    await writeReport(report, options.reportPath);
    return report;
  };
  if (!prerequisites.ok) return skip(prerequisites.reason!);
  if (!existsSync(join(filmDir, 'index.html'))) throw new Error(`LEMO_PREVIEW_FILM_MISSING: ${join(filmDir, 'index.html')}`);

  const cacheDir = options.cacheDir ?? defaultLemoUpstreamRenderCacheDir();
  let runtime: LemoUpstreamRenderRuntime;
  let stageRoot: string;
  try {
    runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: prerequisites.pythonRoot, cacheDir });
    stageRoot = await stageLemoUpstreamRenderRoot({ upstreamRoot: prerequisites.upstreamRoot, threeRoot: prerequisites.threeRoot, playwrightCorePath: runtime.playwrightCorePath, cacheDir });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^LEMO_UPSTREAM_RENDER_ENV/u.test(message)) return skip(`上游渲染运行时不可用：${message}`);
    throw error;
  }
  const playwrightVersion = (JSON.parse(await readFile(join(runtime.playwrightCorePath, 'package.json'), 'utf8')) as { version?: string }).version ?? null;
  const browsers = (await readdir(runtime.browsersPath).catch(() => [] as string[])).filter(name => /^chromium_headless_shell-/u.test(name));
  Object.assign(environment, { playwrightCore: playwrightVersion, headlessShell: browsers, upstreamStageRoot: stageRoot });

  const scratchRoot = join(repoRoot, '.tmp-lemo-preview-consistency');
  const scratch = join(scratchRoot, `run-${process.pid}-${Date.now()}`);
  const inside = relative(scratchRoot, scratch);
  if (!inside || inside.startsWith('..') || inside.includes(`..${sep}`)) throw new Error('scratch directory escaped .tmp-lemo-preview-consistency');
  await mkdir(scratch, { recursive: true });
  const timeoutMs = options.timeoutMs ?? 90_000;
  try {
    log(`still.mjs: ${times.length} 个时间点 ${times.join(', ')} s`);
    const startedStill = Date.now();
    const still = await runUpstreamStill(runtime, stageRoot, { filmDir, times, width: options.width, height: options.height, outDir: join(scratch, 'upstream'), timeoutMs });
    environment.upstreamStillMs = Date.now() - startedStill;
    if (still.code !== 0) {
      const unavailable = upstreamBrowserUnavailableReason(still.stderr);
      if (unavailable) return await skip(unavailable);
      throw new Error(`LEMO_PREVIEW_UPSTREAM_STILL_FAILED (exit ${still.code}): ${still.stderr.slice(-2000) || still.stdout.slice(-2000)}`);
    }
    const missing = still.frames.filter(frame => !existsSync(frame.path));
    if (missing.length) throw new Error(`LEMO_PREVIEW_UPSTREAM_STILL_FAILED: still.mjs 没有写出 ${missing.map(frame => frame.path).join(', ')}\n${still.stdout.slice(-1000)}`);
    const pageWarnings = still.stderr.split(/\r?\n/u).filter(line => /^\[(?:page|note|pageerror)\]/u.test(line));
    if (pageWarnings.length) environment.upstreamPageWarnings = pageWarnings.slice(0, 20);

    const bundle = join(scratch, 'lemo-preview-lib.cjs');
    await bundleRunnerLibrary(repoRoot, bundle);
    const jobPath = join(scratch, 'job.json');
    await writeFile(jobPath, JSON.stringify({
      bundle, scratch, upstreamRoot: prerequisites.upstreamRoot, threeRoot: prerequisites.threeRoot, filmDir,
      width: options.width, height: options.height, fps: options.fps, times,
      upstreamFrames: still.frames, forceDeviceScaleFactor, disableGpu, watchdogMs: timeoutMs,
    }), 'utf8');
    log('Electron: app-preview (reviewLemoUpstreamProject) + capture-host (CaptureHost lemo)');
    const startedElectron = Date.now();
    const { code, stdout, stderr } = await runElectron(prerequisites.electronBinary!, join(repoRoot, 'scripts', 'lemo-preview-consistency-runner.cjs'), jobPath, scratch, timeoutMs + 30_000);
    environment.electronRunnerMs = Date.now() - startedElectron;
    const result = JSON.parse(await readFile(join(scratch, 'result.json'), 'utf8').catch(() => '{}')) as RunnerResult;
    if (result.fatal || code !== 0 || !result.sides) throw new Error(`LEMO_PREVIEW_ELECTRON_FAILED (exit ${code}): ${result.fatal ?? ''}\n${(stderr || stdout).slice(-2000)}`);
    Object.assign(environment, {
      electron: result.electron, electronChrome: result.chrome, displayScaleFactor: result.displayScaleFactor,
      gpuCompositing: (result.gpuFeatureStatus as Record<string, unknown> | null)?.gpu_compositing ?? null,
    });

    const frames: PreviewConsistencyFrameInput[] = [];
    const notes: string[] = [];
    for (const side of ['upstream-still', 'app-preview', 'capture-host'] as const) {
      const data = result.sides[side];
      if (!data) throw new Error(`LEMO_PREVIEW_ELECTRON_FAILED: runner 没有返回 ${side}`);
      if (!data.ok) throw new Error(`LEMO_PREVIEW_${side.toUpperCase().replace(/-/gu, '_')}_FAILED: ${data.errors.join(' | ')}`);
      if (data.pageErrors?.length) notes.push(`${side} 页面错误：${data.pageErrors.join(' | ')}`);
      for (const frame of data.frames) {
        const bytes = await readFile(frame.file);
        frames.push({ side, time: frame.time, frame: { data: bytes, width: frame.width, height: frame.height, channels: 'bgra' } });
      }
    }
    const report = buildPreviewConsistencyReport({ canvas, times, frames, tolerance: { ...LEMO_PREVIEW_CONSISTENCY_TOLERANCE }, environment, notes });
    await writeReport(report, options.reportPath);
    log(`${report.status.toUpperCase()}: worst ${JSON.stringify(report.worst)}`);
    return report;
  } finally {
    if (options.keepScratch) log(`scratch kept: ${scratch}`);
    else {
      await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      await rmdir(scratchRoot).catch(() => undefined); // 只有没有并行运行时才会成功
    }
  }
}

// ───────────────────────────── CLI ─────────────────────────────

function parseCli(argv: string[]): LemoPreviewConsistencyOptions {
  const take = (flag: string) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const has = (flag: string) => argv.includes(flag);
  const size = /^(\d+)x(\d+)$/u.exec(take('--size') ?? '480x270');
  if (!size) throw new Error('--size 必须是 WxH');
  const times = take('--times');
  return {
    filmDir: resolve(take('--film') ?? join(repoRootDefault, 'tests', 'fixtures', 'lemo-preview')),
    width: Number(size[1]),
    height: Number(size[2]),
    fps: Number(take('--fps') ?? 30),
    durationSeconds: Number(take('--duration') ?? 2),
    ...(times ? { times: times.split(',').map(Number) } : {}),
    count: Number(take('--count') ?? 5),
    reportPath: resolve(take('--out') ?? join(repoRootDefault, '.tmp-lemo-preview-consistency-report.json')),
    keepScratch: has('--keep'),
    forceDeviceScaleFactor: !has('--app-dpr'),
    disableGpu: !has('--gpu'),
    log: message => process.stderr.write(`[lemo-preview-consistency] ${message}\n`),
  };
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (invokedDirectly) {
  runLemoPreviewConsistency(parseCli(process.argv.slice(2)))
    .then(report => {
      process.stdout.write(`${JSON.stringify({ status: report.status, skipReason: report.skipReason, worst: report.worst, failures: report.failures, environment: report.environment }, null, 2)}\n`);
      process.exitCode = report.status === 'fail' ? 1 : 0;
    })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
