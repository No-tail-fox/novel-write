/**
 * 黄金帧测试（Q-5，底座 §10.3）：用真实 Chromium（node_modules/electron 子进程）跑打包后的 CaptureHost + Electron 窗口工厂，
 * 对三个运行时夹具（generic-css / lemo / hyperframes engine 契约）逐帧采集，算 aHash + dHash + 平均亮度，与
 * tests/fixtures/golden-frames.json 比较（默认容差 2 位）。同时检查：重复 seek 同一帧结果完全一致、动画确实在动。
 *
 * vitest 本身跑在 Node 里，没有 Electron/Chromium；找不到 Electron 可执行文件时整组跳过（标题里写明原因）。
 * OPC_GOLDEN_FRAMES=0 关闭；OPC_GOLDEN_FRAMES_UPDATE=1 重新录制黄金值（升级 Electron/Chromium 后人工确认画面再录）。
 * 所有临时文件（包括 Chromium profile / TEMP / APPDATA）都放在仓库内被忽略的 .tmp-golden-frames/ 下，结束后删除。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareGoldenFrame, goldenFrameHashes, type GoldenFrameHashes } from '../src/shared/frame-hash';
import { injectSceneRuntimeIntoHtml, wrapSceneCode, type SceneRuntimeAdapter } from '../src/shared/scene-runtime';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratchRoot = join(repoRoot, '.tmp-golden-frames');
const goldenPath = join(repoRoot, 'tests', 'fixtures', 'golden-frames.json');
const runnerPath = join(repoRoot, 'tests', 'fixtures', 'golden-frames-runner.cjs');

function findElectronBinary(): string | null {
  try {
    const value: unknown = createRequire(import.meta.url)('electron');
    return typeof value === 'string' && existsSync(value) ? value : null;
  } catch {
    return null;
  }
}

const electronBinary = findElectronBinary();
const skipReason = process.env.OPC_GOLDEN_FRAMES === '0'
  ? 'OPC_GOLDEN_FRAMES=0 关闭了 Electron 黄金帧'
  : electronBinary
    ? null
    : 'vitest 运行在 Node 里（process.versions.electron 不存在），且找不到 node_modules/electron 可执行文件，无法启动 Chromium';

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;
const DURATION_FRAMES = 60;
/** 第 4 个采样重复第 30 帧：真实浏览器里“回跳再 seek”必须得到同一画面。 */
const FRAMES = [0, 30, 59, 30];

const cssPage = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#102030}
#box{position:absolute;left:0;top:50px;width:80px;height:80px;background:#f0c020;animation:move 2s linear forwards}
#bar{position:absolute;left:0;bottom:0;height:20px;width:${WIDTH}px;background:#3080f0;transform-origin:left;animation:grow 1.5s linear .5s both}
@keyframes move{from{transform:translateX(0)}to{transform:translateX(240px)}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
</style></head><body><div id="box"></div><div id="bar"></div></body></html>`;

const lemoScene = `
var canvas = document.getElementById('c');
var ctx = canvas.getContext('2d');
var stars = [];
for (var i = 0; i < 40; i++) stars.push({ x: Math.random() * ${WIDTH}, y: Math.random() * ${HEIGHT}, r: 2 + Math.floor(Math.random() * 3) });
window.DUR = 2;
window.render = function (t) {
  var k = t / 2;
  ctx.fillStyle = 'rgb(' + Math.round(20 + 200 * k) + ',40,' + Math.round(220 - 200 * k) + ')';
  ctx.fillRect(0, 0, ${WIDTH}, ${HEIGHT});
  ctx.fillStyle = '#ffffff';
  stars.forEach(function (s) { ctx.fillRect(Math.floor((s.x + t * 60) % ${WIDTH}), Math.floor(s.y), s.r, s.r); });
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(Math.round(10 + k * 240), 60, 60, 60);
};
window.render(0);
window.READY = true;`;

const lemoPage = injectSceneRuntimeIntoHtml(
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style></head>`
  + `<body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas><script>${wrapSceneCode(lemoScene)}</script></body></html>`,
  'lemo',
  { fps: FPS, durationFrames: DURATION_FRAMES, width: WIDTH, height: HEIGHT, sceneId: 'lemo' },
);

/** @hyperframes/engine 页面契约：页面自带 window.__hf = { duration, seek(time) }。 */
const hfPage = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas><script>
var ctx = document.getElementById('c').getContext('2d');
function draw(t) {
  ctx.fillStyle = '#0b1d12'; ctx.fillRect(0, 0, ${WIDTH}, ${HEIGHT});
  ctx.fillStyle = '#30d070'; ctx.fillRect(0, ${HEIGHT} - 30, Math.round(${WIDTH} * t / 2), 30);
  ctx.fillStyle = '#e04040'; ctx.fillRect(Math.round(${WIDTH} - 70 - t * 110), Math.round(20 + t * 20), 50, 50);
}
window.__hf = { duration: 2, seek: function (time) { draw(time); } };
draw(0);
</script></body></html>`;

const fixtures: Array<{ name: string; adapter: SceneRuntimeAdapter; html: string }> = [
  { name: 'css', adapter: 'generic-css', html: cssPage },
  { name: 'lemo', adapter: 'lemo', html: lemoPage },
  { name: 'hf', adapter: 'hyperframes', html: hfPage },
];

interface RunnerResult {
  electron?: string;
  chrome?: string;
  fatal?: string;
  results?: Array<{ name: string; ok: boolean; code?: string; message?: string; pageErrors: string[]; captured: Array<{ index: number; frame: number; bytes: number }> }>;
}

function runElectron(binary: string, jobPath: string, scratch: string): Promise<{ code: number | null; output: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const sandboxDirs = { TEMP: join(scratch, 'tmp'), TMP: join(scratch, 'tmp'), APPDATA: join(scratch, 'appdata'), LOCALAPPDATA: join(scratch, 'localappdata') };
  Object.assign(env, sandboxDirs, { ELECTRON_ENABLE_LOGGING: '0', ELECTRON_NO_ATTACH_CONSOLE: '1' });
  return Promise.all(Object.values(sandboxDirs).map(dir => mkdir(dir, { recursive: true }))).then(() => new Promise((resolvePromise, reject) => {
    const child = spawn(binary, [runnerPath, `--user-data-dir=${join(scratch, 'profile', 'chromium')}`, jobPath], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + String(chunk)).slice(-8000); });
    child.stderr.on('data', chunk => { output = (output + String(chunk)).slice(-8000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Electron golden-frame runner timed out\n${output}`)); }, 120_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolvePromise({ code, output }); });
  }));
}

describe.skipIf(skipReason !== null)(`golden frames through CaptureHost in real Chromium${skipReason ? `（已跳过：${skipReason}）` : ''}`, () => {
  it('captures deterministic frames that match the recorded golden hashes', async () => {
    const scratch = join(scratchRoot, `run-${process.pid}-${Date.now()}`);
    const inside = relative(scratchRoot, scratch);
    if (!inside || inside.startsWith('..') || inside.includes(`..${sep}`)) throw new Error('scratch directory escaped .tmp-golden-frames');
    await mkdir(scratch, { recursive: true });
    try {
      const { build } = await import('esbuild');
      const bundle = join(scratch, 'capture-host.cjs');
      await build({
        stdin: {
          contents: "export { CaptureHost } from './electron/capture-host';\nexport { createElectronCaptureWindowFactory } from './electron/capture-host-electron';\n",
          resolveDir: repoRoot,
          loader: 'ts',
          sourcefile: 'golden-frames-entry.ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['electron'],
        outfile: bundle,
        logLevel: 'silent',
      });
      const jobFixtures = [];
      for (const fixture of fixtures) {
        const file = join(scratch, 'pages', `${fixture.name}.html`);
        await mkdir(join(scratch, 'pages'), { recursive: true });
        await writeFile(file, fixture.html, 'utf8');
        jobFixtures.push({ name: fixture.name, adapter: fixture.adapter, url: pathToFileURL(file).href, width: WIDTH, height: HEIGHT, fps: FPS, durationFrames: DURATION_FRAMES, frames: FRAMES });
      }
      const jobPath = join(scratch, 'job.json');
      await writeFile(jobPath, JSON.stringify({ bundle, scratch, fixtures: jobFixtures, watchdogMs: 100_000 }), 'utf8');

      const { code, output } = await runElectron(electronBinary!, jobPath, scratch);
      const result = JSON.parse(await readFile(join(scratch, 'result.json'), 'utf8').catch(() => '{}')) as RunnerResult;
      expect(result.fatal, output).toBeUndefined();
      expect(code, output).toBe(0);

      const hashes: Record<string, Record<string, GoldenFrameHashes>> = {};
      for (const item of result.results ?? []) {
        expect(item.ok, `${item.name}: ${item.code} ${item.message} ${item.pageErrors.join(' | ')}`).toBe(true);
        expect(item.captured.map(frame => frame.frame)).toEqual(FRAMES);
        const perFrame: GoldenFrameHashes[] = [];
        for (const captured of item.captured) {
          const data = await readFile(join(scratch, `${item.name}-${captured.index}.bgra`));
          expect(data.length).toBe(WIDTH * HEIGHT * 4);
          perFrame.push(goldenFrameHashes({ data, width: WIDTH, height: HEIGHT, channels: 'bgra' }));
        }
        // Re-seeking frame 30 after frame 59 reproduces it exactly (I2: any seek order, same picture).
        expect(compareGoldenFrame(perFrame[3], perFrame[1], { maxBits: 0, maxMeanLumaDelta: 0 }).match, item.name).toBe(true);
        // The scene actually animates: first and last frame differ well beyond tolerance.
        expect(compareGoldenFrame(perFrame[2], perFrame[0]).match, `${item.name} did not animate`).toBe(false);
        hashes[item.name] = Object.fromEntries(FRAMES.slice(0, 3).map((frame, index) => [String(frame), perFrame[index]]));
      }
      expect(Object.keys(hashes).sort()).toEqual(fixtures.map(fixture => fixture.name).sort());

      if (process.env.OPC_GOLDEN_FRAMES_UPDATE === '1') {
        await writeFile(goldenPath, `${JSON.stringify({ electron: result.electron, chrome: result.chrome, canvas: `${WIDTH}x${HEIGHT}@${FPS}`, frames: hashes }, null, 2)}\n`, 'utf8');
        return;
      }
      if (!existsSync(goldenPath)) throw new Error('缺少 tests/fixtures/golden-frames.json；确认画面后用 OPC_GOLDEN_FRAMES_UPDATE=1 录制。');
      const golden = JSON.parse(await readFile(goldenPath, 'utf8')) as { frames: Record<string, Record<string, GoldenFrameHashes>> };
      for (const [name, frames] of Object.entries(hashes)) {
        for (const [frame, actual] of Object.entries(frames)) {
          const expected = golden.frames[name]?.[frame];
          expect(expected, `golden ${name}@${frame} missing`).toBeDefined();
          const comparison = compareGoldenFrame(actual, expected!);
          expect(comparison.match, `${name}@${frame}: ${comparison.reasons.join('；')}`).toBe(true);
        }
      }
    } finally {
      await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      await rmdir(scratchRoot).catch(() => undefined); // only succeeds when no parallel run is using it
    }
  }, 180_000);
});

