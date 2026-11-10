// Real Electron main process for smoke-html-video-spec-capture.cjs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { app, nativeImage } = require('electron');
const scratch = process.argv.at(-1);
for (const name of ['userData', 'sessionData', 'crashDumps', 'logs', 'temp']) {
  const dir = path.join(scratch, 'profile', name); fs.mkdirSync(dir, { recursive: true }); app.setPath(name, dir);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.on('window-all-closed', () => {});
const finish = (code, result) => { fs.writeFileSync(path.join(scratch, 'result.json'), JSON.stringify(result, null, 2)); app.exit(code); };
const timer = setTimeout(() => finish(2, { fatal: 'watchdog 45s' }), 45000);
app.whenReady().then(async () => {
  const lib = require(path.join(scratch, 'lib.cjs'));
  const task = path.join(scratch, 'task');
  const pages = path.join(task, '.staging', 'render-smoke', 'html-scenes');
  fs.mkdirSync(pages, { recursive: true });
  fs.mkdirSync(path.join(task, 'images'), { recursive: true });
  const width = 320, height = 180, fps = 24;
  const bitmap = Buffer.alloc(width * height * 4);
  for (let i = 0; i < bitmap.length; i += 4) { bitmap[i] = 30; bitmap[i + 1] = 170; bitmap[i + 2] = 30; bitmap[i + 3] = 255; }
  const bg = path.join(task, 'images', 'green.png');
  fs.writeFileSync(bg, nativeImage.createFromBitmap(bitmap, { width, height }).toPNG());
  const wav = Buffer.alloc(44 + 48000 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  fs.writeFileSync(path.join(task, 'unused.wav'), wav);
  const source = lib.buildHtmlVideoExportInput({ workDir: task, outputPath: path.join(task, 'final.mp4'), title: '', artifact: { scenes: [{ id: 1, cap: 'REAL CAPTION', descPrompt: 'local green', durationMs: 1000 }] }, generatedImages: [{ sceneId: 1, path: bg }], narrationAudio: [{ sceneId: 1, path: path.join(task, 'unused.wav'), captionCues: [{ text: 'REAL CAPTION', startSec: 0, endSec: 1, source: 'tts', confidence: 1 }] }], fps, canvas_w: width, canvas_h: height });
  const saved = path.join(task, 'saved-composition.html');
  fs.writeFileSync(saved, source.scenes[0].html);
  const page = path.join(pages, 'scene-001.html');
  fs.copyFileSync(saved, page);
  fs.copyFileSync(path.join(process.cwd(), 'node_modules/gsap/dist/gsap.min.js'), path.join(pages, 'gsap.min.js'));
  fs.copyFileSync(path.join(process.cwd(), 'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js'), path.join(pages, 'hyperframe.runtime.gsap.iife.js'));
  const requests = [], windows = [], captions = [];
  const factory = lib.createElectronCaptureWindowFactory({ allowRequest: url => { const allowed = lib.htmlVideoSpecCaptureRequestAllowed(url, task); requests.push({ url, allowed }); return allowed; } });
  const host = new lib.CaptureHost({ createWindow: request => { const win = factory(request); windows.push(win); return win; } });
  const frames = [];
  const result = await host.captureScene({ url: `${pathToFileURL(page).href}?storydream-render=1`, adapter: 'hyperframes', sceneId: '1', width, height, fps, durationFrames: 24, frames: [6, 18], format: 'bgra', failOnPageErrors: false, requireFonts: false, durationToleranceFrames: null,
    sink: async frame => {
      const win = windows.at(-1);
      const info = await win.executeJavaScript(`(() => { const e=document.querySelector('#caption-1'); const b=e.getBoundingClientRect(); const img=document.querySelector('#scene-background'); return {text:e.textContent,opacity:getComputedStyle(e).opacity,rect:{x:b.x,y:b.y,width:b.width,height:b.height},backgroundLoaded:img.complete && img.naturalWidth>0}; })()`);
      assert.equal(info.text, 'REAL CAPTION'); assert.equal(info.backgroundLoaded, true); assert.ok(Number(info.opacity) > 0);
      // The only white content is the caption; count actual rasterized ink inside its DOM bounds.
      let captionPixels = 0, green = 0;
      for (let i = 0; i < frame.data.length; i += 4) {
        const x = (i / 4) % width, y = Math.floor(i / 4 / width), b = info.rect;
        if (x >= b.x && x < b.x+b.width && y >= b.y && y < b.y+b.height && frame.data[i] > 180 && frame.data[i+1] > 180 && frame.data[i+2] > 180) captionPixels++;
        if (frame.data[i+1] > frame.data[i]*2 && frame.data[i+1] > frame.data[i+2]*2 && frame.data[i+1] > 60) green++;
      }
      assert.ok(captionPixels > 30, `caption ink pixels ${captionPixels}`); assert.ok(green > width*height*.2, `green background pixels ${green}`);
      fs.writeFileSync(path.join(scratch, `frame-${frame.frame}.png`), nativeImage.createFromBitmap(Buffer.from(frame.data), { width, height }).toPNG());
      frames.push({ frame: frame.frame, bytes: frame.data.length, captionInkPixels: captionPixels, greenPixels: green }); captions.push(info);
    } });
  assert.ok(requests.some(r => r.allowed && r.url === pathToFileURL(bg).href));
  assert.ok(requests.every(r => r.allowed));
  clearTimeout(timer);
  finish(0, { ok: true, electron: process.versions.electron, chrome: process.versions.chrome, frames, captions, requests, pageErrors: result.pageErrors, savedSourceEqualsStaged: fs.readFileSync(saved).equals(fs.readFileSync(page)) });
}).catch(error => { clearTimeout(timer); finish(1, { fatal: String(error.stack || error) }); });
