import * as THREE from 'three';
import { installNativeCanvasStateGuard } from '../../shared/creative-animation/native-canvas-state';
import * as core from '../../../vendor/lemo-native-core/lib.js';
import type { VoxAnimationPayload } from '../../shared/vox-animation';
import type { NativeCanvasText } from '../../shared/creative-animation/native-canvas-text';
import { installNativeCanvasTextTracker } from '../../shared/creative-animation/native-canvas-text-tracker';

export interface LemoText { id: string; text: string; x0: number; y0: number; x1: number; y1: number; fontFamily: string; fontSize: number; cueId?: string; }
interface NativeWindow extends Window {
  DUR?: number; READY?: boolean; render?: (seconds: number) => unknown; TEXTS?: (seconds: number) => LemoText[];
  __ready?: boolean; __htmlVideoMediaError?: string;
  __lemo?: { time: number; offsetMs: number; cues: VoxAnimationPayload['cues']; texts(): LemoText[]; frameTexts(): NativeCanvasText[]; drawnTexts(): Array<{text:string;font:string}> };
  LemoHost: { install(input: VoxAnimationPayload): void; start(): Promise<void>; fail(error: unknown): void; require(id: string): unknown };
}
const host = window as unknown as NativeWindow;
let payload: VoxAnimationPayload;
const drawn = new Map<string, {text:string;font:string}>();
let textTracker: ReturnType<typeof installNativeCanvasTextTracker>;
const fail = (error: unknown) => {
  const message = 'CREATIVE_CODE_RUNTIME: ' + (error instanceof Error ? error.message : String(error));
  host.__htmlVideoMediaError = message; host.__ready = false;
  parent.postMessage({ type: 'vox-error', message }, '*');
};
const canvasGuard = installNativeCanvasStateGuard(CanvasRenderingContext2D.prototype);
let renderQueue = Promise.resolve();
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function seek(seconds: number) {
  const run = async () => {
    if (host.__htmlVideoMediaError) throw new Error(host.__htmlVideoMediaError);
    const offset = payload.animation.native?.startMs ?? 0;
    const localMs = Math.min(Math.max(0, seconds * 1000), payload.durationMs);
    const native = payload.animation.native;
    const sourceMs = localMs * (native?.sourceDurationMs ?? native?.durationMs ?? payload.durationMs) / (native?.durationMs ?? payload.durationMs);
    const absoluteMs = Math.round((offset + sourceMs) * 1000) / 1000;
    let time = absoluteMs / 1000;
    // Seconds can round-trip just below an exact millisecond (129.974s, for example).
    // Correct only that representation error; retain sub-millisecond cue boundaries.
    if (Number.isInteger(absoluteMs) && time * 1000 < absoluteMs) {
      time += Number.EPSILON * Math.max(1, Math.abs(time));
    }
    host.__lemo!.time = time;
    textTracker.beginFrame();
    canvasGuard.beginFrame(time);
    try { await host.render!(time); } finally { canvasGuard.endFrame(); }
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).filter(image => image.src).map(image => image.decode()));
    await tick(); await tick();
    if (host.__htmlVideoMediaError) throw new Error(host.__htmlVideoMediaError);
  };
  renderQueue = renderQueue.then(run).catch(error => { fail(error); throw error; });
  return renderQueue;
}
host.LemoHost = {
  fail,
  require(id) { if (id === 'three') return THREE; if (/^(?:\.\.?\/|\/)?core\/lib\.js$/.test(id)) return core; throw new Error('LEMO_DEPENDENCY: ' + id); },
  install(input) {
    payload = input; host.__ready = false;
    textTracker = installNativeCanvasTextTracker(CanvasRenderingContext2D.prototype,
      row => { if (drawn.size < 10000) drawn.set(JSON.stringify(row),row); });
    host.__lemo = { time: 0, offsetMs: input.animation.native?.startMs ?? 0, cues: input.cues, drawnTexts: () => [...drawn.values()], frameTexts: () => textTracker.frameTexts(), texts: () => {
      const rows = host.TEXTS?.(host.__lemo!.time) ?? [];
      if (!Array.isArray(rows)) throw new Error('LEMO_TEXTS: TEXTS(t) 必须返回文字边界数组。');
      return rows;
    } };
    window.__tl = { seek };
    window.addEventListener('error', event => fail(event.error ?? event.message));
    window.addEventListener('unhandledrejection', event => fail(event.reason));
    let requested: number | undefined; let seeking = false;
    window.addEventListener('message', event => {
      if (event.source !== parent || event.data?.type !== 'vox-seek' || !Number.isFinite(event.data.timeMs)) return;
      requested = event.data.timeMs;
      if (seeking) return;
      seeking = true;
      void (async () => { while (requested !== undefined) { const time = requested; requested = undefined; await seek(time! / 1000); } })().catch(fail).finally(() => { seeking = false; });
    });
  },
  async start() {
    const deadline = Date.now() + 18000;
    while (!host.READY) {
      if (host.__htmlVideoMediaError) throw new Error(host.__htmlVideoMediaError);
      if (Date.now() > deadline) throw new Error('LEMO_READY: 原生页面未报告素材就绪。');
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    const expected = (payload.animation.native?.filmDurationMs ?? payload.durationMs) / 1000;
    if (typeof host.render !== 'function' || !Number.isFinite(host.DUR) || Math.abs(host.DUR! - expected) > .002) throw new Error('LEMO_DURATION: 全片 DUR 应为 ' + expected + ' 秒，收到 ' + host.DUR);
    await seek(0); host.__ready = true; parent.postMessage({ type: 'vox-ready' }, '*');
  },
};
