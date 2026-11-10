/**
 * E-6 采集基准：ADR-16（成片采集帧格式：原始 BGRA 管道 vs JPEG q95）+ §12 决策 1（默认 fps 24 / 30）。
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/bench-capture.ts [--seconds 4] [--repeat 2] [--out <report.json>] [--no-gpu]
 *
 * 用 esbuild 打包真实的 CaptureHost + Electron 窗口工厂，启动 node_modules/electron 子进程（scripts/bench-capture-runner.cjs），
 * 渲染两个 1080p 场景（generic-css 的 HTML 图文动画、lemo 契约的 canvas 粒子动画），按 {bgra, jpeg} × {30, 24 fps} ×
 * {只采集, 采集 + libx264} 逐个测量；编码参数与现有 HTML 场景导出（storybound-sidecar 场景段）一致。
 * 之后在本进程里用 ffmpeg ssim / psnr 比较 JPEG 路径与 BGRA 路径（采样帧本身、以及两条路径的成片）。
 * 输出 JSON（stdout；--out 时同时写文件），包含原始测量、汇总和 src/shared/capture-benchmark.ts 规则给出的决策。
 *
 * 所有临时文件（页面、bundle、成片、采样帧、Chromium profile / TEMP / APPDATA）都在仓库内被忽略的 .tmp-bench-capture/ 下，
 * 结束后删除。不访问网络，不写 %APPDATA%。
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, release, totalmem, type } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CAPTURE_BENCHMARK_VERSION,
  decideCaptureDefaults,
  median,
  parseFfmpegPsnr,
  parseFfmpegSsim,
  summarizeCaptureBenchRuns,
  type CaptureBenchCase,
  type CaptureBenchQuality,
  type CaptureBenchRawRun,
  type CaptureBenchReport,
  type CaptureBenchScene,
} from '../src/shared/capture-benchmark';
import { injectSceneRuntimeIntoHtml, wrapSceneCode, type SceneRuntimeAdapter } from '../src/shared/scene-runtime';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratchRoot = join(repoRoot, '.tmp-bench-capture');
const runnerPath = join(repoRoot, 'scripts', 'bench-capture-runner.cjs');
const WIDTH = 1920;
const HEIGHT = 1080;
const JPEG_QUALITY = 95;

/**
 * 与 storybound-sidecar 里 HTML 场景段（浏览器采集帧 → mp4）相同的视频参数：同一条色彩转换、libx264 默认 preset（medium）
 * 和默认 crf（23）、-threads 2、cfr。去掉了只和音频 / 补帧有关的部分（tpad、trim、-af、aac）。
 */
const BENCH_ENCODER_ARGS = Object.freeze([
  '-vf', 'scale=in_range=auto:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=limited:colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1',
  '-pix_fmt', 'yuv420p',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1',
  '-r', '{fps}', '-fps_mode', 'cfr',
  '-c:v', 'libx264',
  '-threads', '2',
  '-an',
]);

interface Options { seconds: number; repeat: number; out: string | null; hardwareAcceleration: boolean }

function parseOptions(argv: string[]): Options {
  const options: Options = { seconds: 4, repeat: 2, out: null, hardwareAcceleration: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--seconds') options.seconds = Number(argv[++index]);
    else if (arg === '--repeat') options.repeat = Number(argv[++index]);
    else if (arg === '--out') options.out = resolve(argv[++index] ?? '');
    else if (arg === '--no-gpu') options.hardwareAcceleration = false;
    else throw new Error(`未知参数 ${arg}`);
  }
  if (!Number.isInteger(options.seconds) || options.seconds < 1 || options.seconds > 30) throw new Error('--seconds 必须是 1–30 的整数');
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 10) throw new Error('--repeat 必须是 1–10 的整数');
  return options;
}

/** 测试夹具用的确定性伪随机（生成静态 HTML，不依赖页面里的 Math.random）。 */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}

/** 有代表性的 1080p HTML 图文动画：渐变背景、模糊光斑、大标题、卡片阴影、柱状图、SVG 描边、60 个粒子。最长动画恰好 seconds 秒。 */
function cssScenePage(seconds: number): string {
  const random = seeded(20261110);
  // Timings are designed for a 4 s scene and scale linearly, so the latest animation always ends at `seconds`.
  const s = (value: number) => `${((value * seconds) / 4).toFixed(3)}s`;
  const particles = Array.from({ length: 60 }, (_, index) => {
    const x = Math.round(random() * WIDTH);
    const y = Math.round(random() * HEIGHT);
    const dx = Math.round((random() - 0.5) * 400);
    const dy = Math.round(-80 - random() * 300);
    const size = 6 + Math.round(random() * 18);
    return `<i style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;--dx:${dx}px;--dy:${dy}px;animation-delay:${s(-index * 0.037)};animation-duration:${seconds}s"></i>`;
  }).join('');
  const bars = Array.from({ length: 12 }, (_, index) => `<b style="height:${120 + Math.round(random() * 300)}px;animation-delay:${s(0.4 + index * 0.12)}"></b>`).join('');
  const cards = ['播放量 128.4 万', '完播率 63.2%', '互动 9.7 万'].map((text, index) => `<div class="card" style="animation-delay:${s(0.6 + index * 0.2)}"><span>${text.split(' ')[0]}</span><strong>${text.split(' ')[1]}</strong></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif}
body{background:linear-gradient(135deg,#0f1c3f,#1f4f7a 45%,#f08a4b);background-size:220% 220%;animation:bg ${seconds}s linear both}
@keyframes bg{from{background-position:0% 0%}to{background-position:100% 100%}}
.blob{position:absolute;left:1100px;top:80px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,#ff5fa2,rgba(255,95,162,0) 70%);filter:blur(40px);opacity:.75;animation:blob ${seconds}s ease-in-out both}
@keyframes blob{from{transform:translate(0,0) scale(.8)}to{transform:translate(-500px,260px) scale(1.2)}}
h1{position:absolute;left:120px;top:110px;margin:0;font-size:124px;font-weight:800;color:#fff;letter-spacing:4px;text-shadow:0 10px 30px rgba(0,0,0,.45);animation:rise ${s(1.2)} cubic-bezier(.2,.8,.2,1) both}
.sub{position:absolute;left:126px;top:290px;margin:0;font-size:44px;color:rgba(255,255,255,.85);animation:rise ${s(1.2)} ${s(0.3)} cubic-bezier(.2,.8,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:none}}
.cards{position:absolute;left:120px;top:420px;display:flex;gap:36px}
.card{width:340px;height:200px;border-radius:28px;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.25);box-shadow:0 24px 60px rgba(0,0,0,.35);color:#fff;padding:32px;box-sizing:border-box;animation:pop ${s(0.9)} cubic-bezier(.3,1.4,.5,1) both}
.card span{display:block;font-size:30px;opacity:.8}.card strong{display:block;margin-top:18px;font-size:68px}
@keyframes pop{from{opacity:0;transform:scale(.6) rotate(-4deg)}to{opacity:1;transform:none}}
.chart{position:absolute;left:120px;bottom:90px;height:440px;display:flex;align-items:flex-end;gap:22px}
.chart b{width:56px;border-radius:12px 12px 0 0;background:linear-gradient(#ffd166,#ef476f);transform-origin:bottom;animation:grow ${s(1)} cubic-bezier(.2,.8,.2,1) both}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
svg{position:absolute;right:120px;bottom:110px}
svg path{fill:none;stroke:#7ae7ff;stroke-width:10;stroke-linecap:round;stroke-dasharray:1400;animation:draw ${s(2.6)} ${s(0.8)} ease-out both}
@keyframes draw{from{stroke-dashoffset:1400}to{stroke-dashoffset:0}}
i{position:absolute;border-radius:50%;background:rgba(255,255,255,.7);box-shadow:0 0 18px rgba(255,255,255,.8);animation:float linear both}
@keyframes float{from{transform:translate(0,0);opacity:.2}50%{opacity:.9}to{transform:translate(var(--dx),var(--dy));opacity:.3}}
.ticker{position:absolute;left:0;top:1010px;white-space:nowrap;font-size:36px;color:#fff;animation:tick ${seconds}s linear both}
@keyframes tick{from{transform:translateX(${WIDTH}px)}to{transform:translateX(-1400px)}}
</style></head><body>
<div class="blob"></div>${particles}
<h1>2026 短视频增长报告</h1><p class="sub">数据驱动的内容策略 · 第三季度复盘</p>
<div class="cards">${cards}</div>
<div class="chart">${bars}</div>
<svg width="760" height="420" viewBox="0 0 760 420"><path d="M20 380 C 140 300, 200 340, 300 240 S 480 120, 560 160 S 700 60, 740 30"/></svg>
<div class="ticker">实时榜单：科技 +12.4% · 美食 +8.1% · 旅行 +6.7% · 知识 +15.2% · 游戏 +4.3% · 健身 +9.9%</div>
</body></html>`;
}

/** Lemo 页面契约（READY / DUR / render(t)）的 1080p canvas 粒子场景；场景代码经 wrapSceneCode 进入确定性作用域。 */
function lemoScenePage(seconds: number, fps: number): string {
  const scene = `
var canvas = document.getElementById('c');
var ctx = canvas.getContext('2d');
var W = ${WIDTH}, H = ${HEIGHT};
var stars = [];
for (var i = 0; i < 400; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, z: 0.2 + Math.random() * 0.8, hue: Math.floor(Math.random() * 360) });
window.DUR = ${seconds};
window.render = function (t) {
  var k = t / ${seconds};
  var g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'hsl(' + (220 + 60 * k) + ',60%,12%)');
  g.addColorStop(1, 'hsl(' + (300 + 40 * k) + ',70%,28%)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (var i = 0; i < stars.length; i++) {
    var s = stars[i];
    var x = (s.x + t * 220 * s.z) % W;
    var y = s.y + Math.sin(t * 2 + i) * 30 * s.z;
    ctx.fillStyle = 'hsla(' + s.hue + ',90%,70%,' + (0.4 + 0.6 * s.z) + ')';
    ctx.beginPath(); ctx.arc(x, y, 2 + 6 * s.z, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.translate(W / 2, H / 2);
  for (var r = 0; r < 6; r++) {
    ctx.rotate(t * (0.3 + r * 0.15));
    ctx.strokeStyle = 'hsla(' + (r * 50 + t * 40) + ',90%,65%,0.8)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(0, 0, 120 + r * 60, 0, Math.PI * (0.6 + 0.2 * r)); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, t) + ')';
  ctx.font = 'bold 110px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('星河漫游', W / 2, H - 140);
};
window.render(0);
window.READY = true;`;
  return injectSceneRuntimeIntoHtml(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style></head>`
    + `<body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas><script>${wrapSceneCode(scene)}</script></body></html>`,
    'lemo',
    // 内联的启动脚本固定了 fps（场景代码在加载时就要用到确定性作用域），所以每个 fps 一份页面。
    { fps, width: WIDTH, height: HEIGHT, sceneId: 'lemo' },
  );
}

const SCENES: Record<CaptureBenchScene, { adapter: SceneRuntimeAdapter; page: (seconds: number, fps: number) => string }> = {
  css: { adapter: 'generic-css', page: seconds => cssScenePage(seconds) },
  lemo: { adapter: 'lemo', page: lemoScenePage },
};

function benchCases(seconds: number, repeat: number): CaptureBenchCase[] {
  const base: Array<Omit<CaptureBenchCase, 'id' | 'frames' | 'repeat'>> = [];
  for (const scene of Object.keys(SCENES) as CaptureBenchScene[]) {
    for (const format of ['bgra', 'jpeg'] as const) base.push({ scene, format, fps: 30, mode: 'capture' });
    for (const fps of [30, 24]) for (const format of ['bgra', 'jpeg'] as const) base.push({ scene, format, fps, mode: 'encode' });
  }
  const cases: CaptureBenchCase[] = [];
  // Interleave repeats so slow drift (thermal, background load) spreads over every case.
  for (let index = 0; index < repeat; index += 1) {
    for (const item of base) cases.push({ ...item, id: `${item.scene}-${item.format}-${item.fps}-${item.mode}`, frames: seconds * item.fps, repeat: index });
  }
  return cases;
}

function findFfmpeg(): string {
  const directory = join(repoRoot, 'vendor', 'python', 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
  const binary = existsSync(directory) ? readdirSync(directory).find(name => /^ffmpeg.*\.exe$/iu.test(name) || /^ffmpeg-(linux|macos)/iu.test(name)) : undefined;
  if (!binary) throw new Error(`找不到内置 ffmpeg（${directory}）`);
  return join(directory, binary);
}

function findElectron(): string {
  const value: unknown = createRequire(import.meta.url)('electron');
  if (typeof value !== 'string' || !existsSync(value)) throw new Error('找不到 node_modules/electron 可执行文件');
  return value;
}

function run(binary: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number; echo?: boolean }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-200_000); if (options.echo) process.stderr.write(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-200_000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${binary} 超时\n${stderr.slice(-2000)}`)); }, options.timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
  });
}

const QUALITY_GRAPH_RGB = '[0:v]format=gbrp,split[a0][a1];[1:v]format=gbrp,split[b0][b1];[a0][b0]ssim;[a1][b1]psnr';
const QUALITY_GRAPH_YUV = '[0:v]split[a0][a1];[1:v]split[b0][b1];[a0][b0]ssim;[a1][b1]psnr';

async function compare(ffmpeg: string, inputs: string[], graph: string) {
  const { code, stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', ...inputs, '-lavfi', graph, '-f', 'null', '-'], { timeoutMs: 300_000 });
  const ssim = parseFfmpegSsim(stderr);
  const psnr = parseFfmpegPsnr(stderr);
  if (code !== 0 || !ssim || !psnr) throw new Error(`ffmpeg 画质比较失败（${code}）：${stderr.slice(-1500)}`);
  return { ssim, psnr };
}

async function measureQuality(ffmpeg: string, scratch: string, seconds: number): Promise<CaptureBenchQuality[]> {
  const quality: CaptureBenchQuality[] = [];
  const sampleFrames = [0, Math.floor((seconds * 30) / 2), seconds * 30 - 1];
  for (const scene of Object.keys(SCENES) as CaptureBenchScene[]) {
    const frameResults = [];
    for (const frame of sampleFrames) {
      const raw = join(scratch, `sample-${scene}-f${frame}.bgra`);
      const jpg = join(scratch, `sample-${scene}-f${frame}.jpg`);
      frameResults.push(await compare(ffmpeg, ['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${WIDTH}x${HEIGHT}`, '-i', raw, '-i', jpg], QUALITY_GRAPH_RGB));
    }
    quality.push({
      scene,
      stage: 'frame',
      ssimAll: Math.round(median(frameResults.map(item => item.ssim.all)) * 1e6) / 1e6,
      ssimY: null,
      psnrAverage: Math.round(median(frameResults.map(item => item.psnr.average)) * 100) / 100,
      psnrMin: Math.round(Math.min(...frameResults.map(item => item.psnr.average)) * 100) / 100,
      samples: frameResults.length,
    });
    const final = await compare(ffmpeg, ['-i', join(scratch, `${scene}-jpeg-30-encode-r0.mp4`), '-i', join(scratch, `${scene}-bgra-30-encode-r0.mp4`)], QUALITY_GRAPH_YUV);
    quality.push({
      scene,
      stage: 'final',
      ssimAll: Math.round(final.ssim.all * 1e6) / 1e6,
      ssimY: Math.round(final.ssim.y * 1e6) / 1e6,
      psnrAverage: Math.round(final.psnr.average * 100) / 100,
      psnrMin: Number.isFinite(final.psnr.min) ? Math.round(final.psnr.min * 100) / 100 : null,
      samples: seconds * 30,
    });
  }
  return quality;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const ffmpeg = findFfmpeg();
  const electron = findElectron();
  const scratch = join(scratchRoot, `run-${process.pid}-${Date.now()}`);
  const inside = relative(scratchRoot, scratch);
  if (!inside || inside.startsWith('..') || inside.includes(`..${sep}`)) throw new Error('scratch 目录越界');
  await mkdir(scratch, { recursive: true });
  try {
    const { build } = await import('esbuild');
    const bundle = join(scratch, 'bench-capture.cjs');
    await build({
      stdin: {
        contents: [
          "export { CaptureHost, createWritableFrameSink, ffmpegFrameInputArgs } from './electron/capture-host';",
          "export { createElectronCaptureWindowFactory } from './electron/capture-host-electron';",
          "export { parseFfmpegBench } from './src/shared/capture-benchmark';",
        ].join('\n'),
        resolveDir: repoRoot,
        loader: 'ts',
        sourcefile: 'bench-capture-entry.ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
      outfile: bundle,
      logLevel: 'silent',
    });
    const pages: Record<string, string> = {};
    const adapters: Record<string, SceneRuntimeAdapter> = {};
    await mkdir(join(scratch, 'pages'), { recursive: true });
    for (const [scene, definition] of Object.entries(SCENES)) {
      adapters[scene] = definition.adapter;
      for (const fps of [24, 30]) {
        const file = join(scratch, 'pages', `${scene}-${fps}.html`);
        await writeFile(file, definition.page(options.seconds, fps), 'utf8');
        pages[`${scene}@${fps}`] = pathToFileURL(file).href;
      }
    }
    const cases = benchCases(options.seconds, options.repeat);
    const jobPath = join(scratch, 'job.json');
    const watchdogMs = 120_000 + cases.reduce((sum, item) => sum + item.frames * 2_000, 0);
    await writeFile(jobPath, JSON.stringify({
      bundle,
      scratch,
      ffmpeg,
      encoderArgs: BENCH_ENCODER_ARGS,
      width: WIDTH,
      height: HEIGHT,
      jpegQuality: JPEG_QUALITY,
      seconds: options.seconds,
      hardwareAcceleration: options.hardwareAcceleration,
      pages,
      adapters,
      cases,
      sampleFps: 30,
      sampleFrames: [0, Math.floor((options.seconds * 30) / 2), options.seconds * 30 - 1],
      watchdogMs,
    }), 'utf8');

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const sandboxDirs = { TEMP: join(scratch, 'tmp'), TMP: join(scratch, 'tmp'), APPDATA: join(scratch, 'appdata'), LOCALAPPDATA: join(scratch, 'localappdata') };
    for (const directory of Object.values(sandboxDirs)) await mkdir(directory, { recursive: true });
    Object.assign(env, sandboxDirs, { ELECTRON_ENABLE_LOGGING: '0', ELECTRON_NO_ATTACH_CONSOLE: '1' });
    const result = await run(electron, [runnerPath, `--user-data-dir=${join(scratch, 'profile', 'chromium')}`, jobPath], { env, timeoutMs: watchdogMs + 60_000, echo: true });
    const runner = JSON.parse(await readFile(join(scratch, 'runs.json'), 'utf8').catch(() => '{}')) as { fatal?: string; electron?: string; chrome?: string; gpuCompositing?: string; processesAfter?: Record<string, { kb: number; count: number }>; runs?: CaptureBenchRawRun[] };
    if (runner.fatal || result.code !== 0 || !runner.runs) throw new Error(`Electron 基准失败（${result.code}）：${runner.fatal ?? ''}\n${result.stderr.slice(-3000)}`);

    const ffmpegVersion = (await run(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 30_000 })).stdout.split(/\r?\n/u)[0] ?? '';
    const report: CaptureBenchReport = {
      version: CAPTURE_BENCHMARK_VERSION,
      createdAt: new Date().toISOString(),
      width: WIDTH,
      height: HEIGHT,
      jpegQuality: JPEG_QUALITY,
      encoderArgs: [...BENCH_ENCODER_ARGS],
      environment: {
        electron: runner.electron ?? '',
        chrome: runner.chrome ?? '',
        os: `${type()} ${release()}`,
        cpu: cpus()[0]?.model.trim() ?? '',
        logicalCores: cpus().length,
        totalMemoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
        ffmpeg: ffmpegVersion,
        hardwareAcceleration: options.hardwareAcceleration && runner.gpuCompositing !== 'disabled_software',
      },
      runs: runner.runs,
      quality: await measureQuality(ffmpeg, scratch, options.seconds),
      ...(runner.processesAfter ? { electronProcessesAfter: runner.processesAfter } : {}),
    };
    const output = { ...report, summary: summarizeCaptureBenchRuns(report.runs), decision: decideCaptureDefaults(report) };
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (options.out) await writeFile(options.out, json, 'utf8');
    process.stdout.write(json);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    await rmdir(scratchRoot).catch(() => undefined);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
