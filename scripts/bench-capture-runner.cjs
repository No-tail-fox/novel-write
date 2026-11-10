/* eslint-disable */
// Electron 主进程脚本：由 scripts/bench-capture.ts 以子进程方式启动（backlog E-6）。
// argv 最后一个参数是 job.json。用打包后的真实 CaptureHost + Electron 窗口工厂逐 case 采集：
//   capture 模式：sink 丢弃帧，只测采集；encode 模式：帧经 stdin 送进 ffmpeg libx264（参数与现有 HTML 场景导出一致）。
// 原始测量写 scratch/runs.json；成片和采样帧留在 scratch 里，由 bench-capture.ts 做 ssim/psnr 后整体删除。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { app } = require('electron');

const job = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const profile = path.join(job.scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
// Chromium 的所有落盘位置都在仓库内的临时目录里（不写 %APPDATA% / %LOCALAPPDATA%）。
for (const name of ['userData', 'sessionData', 'crashDumps', 'logs', 'temp']) app.setPath(name, path.join(profile, name));
if (!job.hardwareAcceleration) app.disableHardwareAcceleration();
// 与 electron/main.ts 相同：DPR 固定为 1。
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.on('window-all-closed', () => { /* 每个 case 销毁窗口后不要退出 */ });

const finish = (code, payload) => {
  fs.writeFileSync(path.join(job.scratch, 'runs.json'), JSON.stringify(payload, null, 2));
  app.exit(code);
};
const watchdog = setTimeout(() => finish(2, { fatal: 'bench runner watchdog timeout' }), job.watchdogMs);

function electronWorkingSetKb() {
  return app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory && metric.memory.workingSetSize ? metric.memory.workingSetSize : 0), 0);
}

/** 按进程类型（Browser / Tab / GPU / Utility…）汇总 working set（KiB）和进程数。 */
function electronMemoryByType() {
  const byType = {};
  for (const metric of app.getAppMetrics()) {
    const entry = byType[metric.type] || (byType[metric.type] = { kb: 0, count: 0 });
    entry.kb += metric.memory && metric.memory.workingSetSize ? metric.memory.workingSetSize : 0;
    entry.count += 1;
  }
  return byType;
}

// 主进程手动 GC：每个 case 前回收上一个 case 的帧缓冲，让峰值反映本 case 而不是累积的待回收内存。
require('node:v8').setFlagsFromString('--expose-gc');
const collectGarbage = require('node:vm').runInNewContext('gc');
async function settle() {
  collectGarbage();
  await new Promise(resolve => setTimeout(resolve, 1500));
  collectGarbage();
}

function startFfmpeg(lib, benchCase, output) {
  const args = [
    '-hide_banner', '-nostats', '-benchmark', '-y',
    ...lib.ffmpegFrameInputArgs({ format: benchCase.format, width: job.width, height: job.height, fps: benchCase.fps }),
    ...job.encoderArgs.map(arg => arg.replace('{fps}', String(benchCase.fps))),
    output,
  ];
  const child = spawn(job.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-20000); });
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  child.stdin.on('error', () => { /* 由 sink 和退出码报告 */ });
  return { child, exited, stderr: () => stderr };
}

async function runCase(lib, host, benchCase) {
  const pageUrl = job.pages[`${benchCase.scene}@${benchCase.fps}`];
  const output = path.join(job.scratch, `${benchCase.id}-r${benchCase.repeat}.mp4`);
  const keepSamples = benchCase.mode === 'capture' && benchCase.repeat === 0 && benchCase.fps === job.sampleFps;
  const samples = [];
  await settle();
  const baselineKb = electronWorkingSetKb();
  let peakKb = baselineKb;
  let peakByType = electronMemoryByType();
  const sample = () => {
    const current = electronWorkingSetKb();
    if (current > peakKb) { peakKb = current; peakByType = electronMemoryByType(); }
  };
  const sampler = setInterval(sample, 100);
  const encoder = benchCase.mode === 'encode' ? startFfmpeg(lib, benchCase, output) : null;
  const writeFrame = encoder ? lib.createWritableFrameSink(encoder.child.stdin) : null;
  let firstSink = 0;
  let lastSink = 0;
  let sinkWaitMs = 0;
  let frameBytesTotal = 0;
  let framesCaptured = 0;
  const started = performance.now();
  const record = {
    ...benchCase,
    ok: false,
    framesCaptured: 0,
    wallMs: 0,
    firstFrameMs: 0,
    loopMs: 0,
    sinkWaitMs: 0,
    encoderFlushMs: 0,
    frameBytesTotal: 0,
    electronPeakKb: 0,
    ffmpegMaxRssKb: null,
    ffmpegCpuS: null,
    outputBytes: null,
  };
  try {
    await host.captureScene({
      url: pageUrl,
      adapter: job.adapters[benchCase.scene],
      width: job.width,
      height: job.height,
      fps: benchCase.fps,
      durationFrames: benchCase.frames,
      ...(benchCase.limit ? { frames: Array.from({ length: benchCase.limit }, (_, index) => index) } : {}),
      format: benchCase.format,
      jpegQuality: job.jpegQuality,
      sceneId: benchCase.scene,
      timeouts: { loadMs: 60000, readyMs: 60000, seekMs: 30000, captureMs: 30000, sinkMs: 120000 },
      sink: async frame => {
        const now = performance.now();
        if (!framesCaptured) firstSink = now;
        lastSink = now;
        framesCaptured += 1;
        frameBytesTotal += frame.data.length;
        if (keepSamples && job.sampleFrames.includes(frame.frame)) samples.push({ frame: frame.frame, data: Buffer.from(frame.data) });
        if (writeFrame) {
          await writeFrame(frame);
          sinkWaitMs += performance.now() - now;
        }
      },
    });
    let flushMs = 0;
    if (encoder) {
      const flushStart = performance.now();
      encoder.child.stdin.end();
      const code = await encoder.exited;
      flushMs = performance.now() - flushStart;
      if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${encoder.stderr().slice(-1500)}`);
      const bench = lib.parseFfmpegBench(encoder.stderr());
      record.ffmpegMaxRssKb = bench ? bench.maxRssKb : null;
      record.ffmpegCpuS = bench ? Math.round((bench.utimeS + bench.stimeS) * 100) / 100 : null;
      record.outputBytes = fs.statSync(output).size;
      if (benchCase.repeat !== 0) fs.rmSync(output, { force: true });
    }
    Object.assign(record, {
      ok: true,
      wallMs: performance.now() - started,
      firstFrameMs: firstSink - started,
      loopMs: lastSink - firstSink,
      encoderFlushMs: flushMs,
    });
  } catch (error) {
    record.error = `${error && error.code ? `${error.code}: ` : ''}${String(error && error.message || error)}`.slice(0, 2000);
    if (encoder && encoder.child.exitCode === null) encoder.child.kill();
  } finally {
    clearInterval(sampler);
    sample();
  }
  const peakByTypeKb = Object.fromEntries(Object.entries(peakByType).map(([name, entry]) => [name, entry.kb]));
  Object.assign(record, { framesCaptured, frameBytesTotal, sinkWaitMs, electronPeakKb: peakKb, electronBaselineKb: baselineKb, electronPeakByTypeKb: peakByTypeKb });
  for (const sample of samples) {
    fs.writeFileSync(path.join(job.scratch, `sample-${benchCase.scene}-f${sample.frame}.${benchCase.format === 'bgra' ? 'bgra' : 'jpg'}`), sample.data);
  }
  return record;
}

app.whenReady().then(async () => {
  const lib = require(job.bundle);
  const host = new lib.CaptureHost({ createWindow: lib.createElectronCaptureWindowFactory() });
  // Warm-up (discarded): first window creation pays Chromium start-up costs.
  for (const scene of Object.keys(job.adapters)) {
    const warmup = await runCase(lib, host, { id: `warmup-${scene}`, scene, format: 'bgra', fps: 30, frames: job.seconds * 30, limit: 10, mode: 'capture', repeat: -1 });
    if (!warmup.ok) throw new Error(`warm-up ${scene} failed: ${warmup.error}`);
  }
  const runs = [];
  for (const benchCase of job.cases) {
    const record = await runCase(lib, host, benchCase);
    runs.push(record);
    process.stdout.write(`${record.ok ? 'ok ' : 'ERR'} ${benchCase.id}#${benchCase.repeat} ${Math.round(record.wallMs)}ms${record.error ? ` ${record.error}` : ''}\n`);
  }
  clearTimeout(watchdog);
  await settle();
  finish(0, {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    gpuCompositing: app.getGPUFeatureStatus().gpu_compositing,
    // 全部 case 结束、GC 之后仍存活的进程（检查窗口 / 渲染进程 / 会话是否泄漏）。
    processesAfter: electronMemoryByType(),
    runs,
  });
}).catch(error => finish(1, { fatal: String(error && error.stack || error) }));
