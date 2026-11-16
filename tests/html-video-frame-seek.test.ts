import { runInNewContext } from 'node:vm';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { createVoxAnimation } from '../src/shared/vox-animation';
import { describe, expect, it, vi } from 'vitest';
import { createHtmlVideoFrameSeekScript } from '../electron/html-video-frame-seek';

function execute(time: number, window: Record<string, unknown>, media: unknown[] = []) {
  return runInNewContext(createHtmlVideoFrameSeekScript(time), {
    window,
    document: { querySelectorAll: (selector: string) => selector === 'video' ? [] : media },
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
  });
}

describe('HTML export frame timing', () => {
  it('captures delayed React canvas commits in real Electron, forwards exact seconds and rejects never-ready work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'frame-handshake-'));
    try {
      const bundle = await build({ entryPoints: ['src/features/vox-animation/runtime.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
      await writeFile(join(dir, 'runtime.js'), bundle.outputFiles[0].contents);
      const payload = { animation: createVoxAnimation(), width: 64, height: 64, durationMs: 2000, fps: 60, assets: [], cues: [] };
      await writeFile(join(dir, 'page.html'), `<style>html,body,#root{margin:0;width:64px;height:64px}</style><div id="root"></div><script src="runtime.js"></script><script>
        const React=VoxRuntime.require('react'), R=VoxRuntime.require('remotion');
        function AsyncCanvas(){
          const frame=R.useCurrentFrame(), ref=React.useRef();
          React.useEffect(()=>{
            const handle=R.delayRender('async canvas '+frame);
            const timer=setTimeout(()=>{const ctx=ref.current.getContext('2d');ctx.fillStyle='rgb('+frame+',0,0)';ctx.fillRect(0,0,64,64);ref.current.dataset.frame=frame;R.continueRender(handle);},120);
            return ()=>{clearTimeout(timer);R.continueRender(handle);};
          },[frame]);
          return React.createElement('canvas',{ref,width:64,height:64});
        }
        VoxRuntime.mount(${JSON.stringify(payload)},AsyncCanvas);
      </script>`);
      const schedule = [0, 1 / 60, 29 / 60, 59 / 60, 1 / 60];
      await writeFile(join(dir, 'runner.cjs'), `const {app,BrowserWindow}=require('electron');
        const fs=require('fs');
        app.whenReady().then(async()=>{try{
          const win=new BrowserWindow({show:false,width:64,height:64,webPreferences:{backgroundThrottling:false}});
          await win.loadFile(${JSON.stringify(join(dir, 'page.html'))});
          await win.webContents.executeJavaScript('new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>window.__ready?resolve():Date.now()-start>10000?reject(new Error(window.__htmlVideoMediaError||"ready timeout")):setTimeout(poll,10);poll();})');
          await win.webContents.executeJavaScript('window.received=[];const original=__tl.seek;__tl.seek=(seconds)=>{received.push(seconds);return original(seconds)};void 0');
          const frames=[];
          for(const script of ${JSON.stringify(schedule.map(time => createHtmlVideoFrameSeekScript(time)))}){
            await win.webContents.executeJavaScript(script);
            const frame=await win.webContents.executeJavaScript('({frame:Number(document.querySelector("canvas").dataset.frame),pixel:document.querySelector("canvas").getContext("2d").getImageData(0,0,1,1).data[0],commit:{...__voxRender}})');
            const capture=await win.webContents.capturePage({x:20,y:20,width:1,height:1});
            frame.capturedRed=capture.toBitmap()[2];frames.push(frame);
          }
          const received=await win.webContents.executeJavaScript('received');
          await win.webContents.executeJavaScript('VoxRuntime.require("remotion").delayRender("never ready");void 0');
          let timeout='';try{await win.webContents.executeJavaScript(${JSON.stringify(createHtmlVideoFrameSeekScript(0, 80))})}catch(error){timeout=error.message}
          fs.writeFileSync(${JSON.stringify(join(dir, 'result.json'))},JSON.stringify({frames,received,timeout}));
          win.destroy();app.exit(0);
        }catch(error){console.error(error);app.exit(1)}});`);
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const run = spawnSync(resolve('node_modules/electron/dist/electron.exe'), [join(dir, 'runner.cjs')], { env, encoding: 'utf8', timeout: 30000 });
      expect(run.status, run.stderr || String(run.error)).toBe(0);
      const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
      expect(result.received).toEqual(schedule);
      expect(result.frames.map((f: { frame: number }) => f.frame)).toEqual([0, 1, 29, 59, 1]);
      expect(result.frames.map((f: { pixel: number }) => f.pixel)).toEqual([0, 1, 29, 59, 1]);
      expect(result.frames.map((f: { capturedRed: number }) => f.capturedRed)).toEqual([0, 1, 29, 59, 1]);
      for (const frame of result.frames) { expect(frame.commit.completed).toBe(frame.commit.requested); expect(frame.commit.frame).toBe(frame.frame); }
      expect(result.timeout).toContain('frame seek timed out');
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60000);
  it('uses runtime clip gates for forward and backward seeks and waits for adapters', async () => {
    let visible = false;
    let settledAt = -1;
    let pending = Promise.resolve();
    const rawSeek = vi.fn();
    const window = {
      __tl: { seek: rawSeek },
      __player: {
        renderSeek(time: number) {
          visible = time >= .4 && time < 2;
          pending = Promise.resolve().then(() => { settledAt = time; });
        },
      },
      __hfWaitForSeekCompletion: () => pending,
    };
    for (const time of [0, .5, 3, .1, 1]) {
      await execute(time, window);
      expect(visible).toBe(time >= .4 && time < 2);
      expect(settledAt).toBe(time);
    }
    expect(rawSeek).not.toHaveBeenCalled();
  });

  it('waits for media seek completion before capturing', async () => {
    const media = Object.assign(new EventTarget(), { seeking: true });
    let finished = false;
    const operation = execute(1, { __player: { renderSeek() {} } }, [media]).then(() => { finished = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(finished).toBe(false);
    media.seeking = false;
    media.dispatchEvent(new Event('seeked'));
    await operation;
    expect(finished).toBe(true);
  });

  it('waits for a changed video frame to be presented and cleans up its callback', async () => {
    let presented: () => void = () => {};
    const video = Object.assign(new EventTarget(), { currentTime: 0, seeking: false,
      requestVideoFrameCallback: vi.fn((callback: () => void) => { presented = callback; return 7; }), cancelVideoFrameCallback: vi.fn() });
    let finished = false;
    const operation = runInNewContext(createHtmlVideoFrameSeekScript(.5), {
      window: { __tl: { seek: () => { video.currentTime = .5; } } },
      document: { querySelectorAll: () => [video] }, setTimeout, clearTimeout,
      requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
    }).then(() => { finished = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(finished).toBe(false);
    presented(); await operation;
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
  });

  it('preserves native GSAP support without awaiting its paused thenable', async () => {
    const then = vi.fn();
    const timeline = { seek: vi.fn(() => timeline), then };
    await execute(.5, { __tl: timeline });
    expect(timeline.seek).toHaveBeenCalledWith(.5, false);
    expect(then).not.toHaveBeenCalled();
  });

  it('propagates asynchronous seek failures instead of capturing a stale frame', async () => {
    const window = {
      __player: { renderSeek() {} },
      __hfWaitForSeekCompletion: async () => { throw new Error('adapter failed'); },
    };
    await expect(execute(1, window)).rejects.toThrow('adapter failed');
  });
});
