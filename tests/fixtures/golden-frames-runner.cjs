/* eslint-disable */
// Electron 主进程脚本：由 tests/golden-frames.test.ts 以子进程方式启动（不在 vitest 进程里跑 Electron）。
// argv 最后一个参数是 job.json：{ bundle, scratch, fixtures: [{ name, url, adapter, width, height, fps, durationFrames, frames }] }。
// 用打包后的真实 CaptureHost + Electron 窗口工厂逐帧采集，原始 BGRA 写到 scratch/<name>-<index>.bgra，结果写 result.json。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const job = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const profile = path.join(job.scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
// 所有 Chromium 落盘位置都放进仓库内的临时目录（不写 %APPDATA% / %LOCALAPPDATA%）。
for (const name of ['userData', 'sessionData', 'crashDumps', 'logs', 'temp']) app.setPath(name, path.join(profile, name));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.on('window-all-closed', () => { /* 每个场景销毁窗口后不要退出 */ });

const finish = (code, payload) => {
  fs.writeFileSync(path.join(job.scratch, 'result.json'), JSON.stringify(payload, null, 2));
  app.exit(code);
};
const watchdog = setTimeout(() => finish(2, { fatal: 'runner watchdog timeout' }), job.watchdogMs || 90000);

app.whenReady().then(async () => {
  const lib = require(job.bundle);
  const host = new lib.CaptureHost({ createWindow: lib.createElectronCaptureWindowFactory() });
  const results = [];
  for (const fixture of job.fixtures) {
    const captured = [];
    try {
      const result = await host.captureScene({
        url: fixture.url,
        adapter: fixture.adapter,
        width: fixture.width,
        height: fixture.height,
        fps: fixture.fps,
        durationFrames: fixture.durationFrames,
        frames: fixture.frames,
        format: 'bgra',
        sceneId: fixture.name,
        timeouts: { loadMs: 20000, readyMs: 20000, seekMs: 10000, captureMs: 10000 },
        sink: frame => {
          fs.writeFileSync(path.join(job.scratch, `${fixture.name}-${frame.index}.bgra`), frame.data);
          captured.push({ index: frame.index, frame: frame.frame, bytes: frame.data.length });
        },
      });
      results.push({ name: fixture.name, ok: true, captured, descriptor: result.descriptor, pageErrors: result.pageErrors });
    } catch (error) {
      results.push({ name: fixture.name, ok: false, captured, code: error && error.code, message: String(error && error.message || error), pageErrors: (error && error.pageErrors) || [] });
    }
  }
  clearTimeout(watchdog);
  finish(0, { electron: process.versions.electron, chrome: process.versions.chrome, results });
}).catch(error => finish(1, { fatal: String(error && error.stack || error) }));
