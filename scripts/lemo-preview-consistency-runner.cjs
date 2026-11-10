// Electron 主进程脚本：由 scripts/lemo-preview-consistency.ts 以子进程方式启动（backlog L-6）。
// argv 最后一个参数是 job.json：
//   { bundle, scratch, upstreamRoot, threeRoot, filmDir, width, height, fps, times, upstreamFrames: [{ time, path }],
//     forceDeviceScaleFactor, disableGpu, watchdogMs }
// 做三件事，全部输出为原始 BGRA（scratch/<side>-<index>.bgra）+ result.json：
//   1. 用 Chromium 自己的解码器（nativeImage）解码上游 still.mjs 写出的 JPEG；
//   2. 应用内预览路径：electron/lemo-upstream-renderer.ts 的 reviewLemoUpstreamProject（同一套本机 HTTP 服务 + offscreen 窗口），读回它写的 PNG；
//   3. 新架构路径：CaptureHost + createElectronCaptureWindowFactory，lemo 适配器，同一个页面 URL（serveLemoUpstreamProject），帧号 = t × fps。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage, screen } = require('electron');

const job = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const profile = path.join(job.scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
// 所有 Chromium 落盘位置都放进 scratch（不写 %APPDATA% / %LOCALAPPDATA%）。
for (const name of ['userData', 'sessionData', 'crashDumps', 'logs', 'temp']) app.setPath(name, path.join(profile, name));
if (job.disableGpu) app.disableHardwareAcceleration();
if (job.forceDeviceScaleFactor) app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.on('window-all-closed', () => { /* 每条路径销毁窗口后不要退出 */ });

const finish = (code, payload) => {
  fs.writeFileSync(path.join(job.scratch, 'result.json'), JSON.stringify(payload, null, 2));
  app.exit(code);
};
const watchdog = setTimeout(() => finish(2, { fatal: 'runner watchdog timeout' }), job.watchdogMs || 90000);

function writeImage(side, index, image) {
  const size = image.getSize();
  const data = image.toBitmap();
  const file = path.join(job.scratch, `${side}-${index}.bgra`);
  fs.writeFileSync(file, data);
  return { index, file, width: size.width, height: size.height, bytes: data.length };
}

app.whenReady().then(async () => {
  const lib = require(job.bundle);
  const display = screen.getPrimaryDisplay();
  const out = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    displayScaleFactor: display.scaleFactor,
    forceDeviceScaleFactor: !!job.forceDeviceScaleFactor,
    disableGpu: !!job.disableGpu,
    gpuFeatureStatus: (() => { try { return app.getGPUFeatureStatus(); } catch { return null; } })(),
    sides: {},
  };

  // 1. 上游 JPEG → BGRA
  const upstream = { ok: true, frames: [], errors: [] };
  job.upstreamFrames.forEach((item, index) => {
    const image = nativeImage.createFromPath(item.path);
    if (image.isEmpty()) { upstream.ok = false; upstream.errors.push(`无法解码 ${item.path}`); return; }
    upstream.frames.push({ time: item.time, ...writeImage('upstream-still', index, image) });
  });
  out.sides['upstream-still'] = upstream;

  // 2. 应用内预览（reviewLemoUpstreamProject，产品代码原样调用）
  const preview = { ok: false, frames: [], errors: [] };
  try {
    const outputDir = path.join(job.scratch, 'app-preview');
    const receipt = await lib.reviewLemoUpstreamProject({ upstreamRoot: job.upstreamRoot, filmDir: job.filmDir, threeRoot: job.threeRoot,
      outputDir, times: job.times, width: job.width, height: job.height, timeoutMs: 60000 });
    preview.receipt = receipt;
    receipt.frames.forEach((frame, index) => {
      const image = nativeImage.createFromPath(frame.path);
      if (image.isEmpty()) { preview.errors.push(`无法解码 ${frame.path}`); return; }
      preview.frames.push({ time: frame.time, ...writeImage('app-preview', index, image) });
    });
    preview.ok = receipt.technicalPassed && preview.frames.length === job.times.length;
    if (!receipt.technicalPassed) preview.errors.push(...receipt.errors, ...receipt.missingResources.map(item => `missing ${item.path} (${item.status})`), ...receipt.failedFonts.map(font => `font ${font}`));
  } catch (error) {
    preview.errors.push(String(error && error.stack || error));
  }
  out.sides['app-preview'] = preview;

  // 3. CaptureHost（lemo 适配器），页面经同一个本机服务提供
  const capture = { ok: false, frames: [], errors: [] };
  let source;
  try {
    source = await lib.serveLemoUpstreamProject({ upstreamRoot: job.upstreamRoot, filmDir: job.filmDir, threeRoot: job.threeRoot });
    const host = new lib.CaptureHost({ createWindow: lib.createElectronCaptureWindowFactory() });
    const frameNumbers = job.times.map(time => Math.round(time * job.fps));
    const result = await host.captureScene({
      url: source.pageUrl,
      adapter: 'lemo',
      width: job.width,
      height: job.height,
      fps: job.fps,
      frames: frameNumbers,
      format: 'bgra',
      sceneId: 'lemo-preview-consistency',
      timeouts: { loadMs: 20000, readyMs: 20000, seekMs: 10000, captureMs: 10000 },
      sink: frame => {
        const file = path.join(job.scratch, `capture-host-${frame.index}.bgra`);
        fs.writeFileSync(file, frame.data);
        capture.frames.push({ time: job.times[frame.index], index: frame.index, frame: frame.frame, file, width: frame.width, height: frame.height, bytes: frame.data.length });
      },
    });
    capture.descriptor = result.descriptor;
    capture.pageErrors = result.pageErrors;
    capture.ok = capture.frames.length === job.times.length;
  } catch (error) {
    capture.errors.push(`${error && error.code ? error.code + ': ' : ''}${String(error && error.message || error)}`);
    if (error && error.pageErrors && error.pageErrors.length) capture.errors.push(...error.pageErrors);
  } finally {
    if (source) await source.close().catch(() => undefined);
  }
  out.sides['capture-host'] = capture;

  clearTimeout(watchdog);
  finish(0, out);
}).catch(error => finish(1, { fatal: String(error && error.stack || error) }));
