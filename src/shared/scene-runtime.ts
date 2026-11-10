/**
 * SceneRuntime 协议 v1（backlog E-2，底座 L4，docs/design/2026-11-09-code-video-foundation.md §7 / §13）。
 *
 * 页面里由宿主外壳提供两个对象：
 * - `window.__sd`：StoryDream 协议（整数帧 seek、ready、字体/媒体/错误状态），CaptureHost 只和它说话；
 * - `window.__hf`：`@hyperframes/engine` 的页面契约（`{ duration 秒, seek(time) }`）。页面自己有 `__hf` 时原样使用，
 *   没有时外壳补一个包装在 `__sd` 上的实现，以后可以直接换用 engine 的 beginFrame 采集。
 *
 * 适配器（`buildSceneRuntimeBootstrap(adapter)` 生成注入页面的 JS 字符串）：
 * - `hyperframes`：页面有 `window.__hf.seek` 就用它；否则沿用 HF 创作 runtime 的 `__player.renderSeek`
 *   + `__hfWaitForSeekCompletion`（§13.1 更正：`__hf` 是 engine 一侧的契约，不是 runtime 自带的），再退到 `__tl.seek`；
 * - `lemo`：上游 core/README.md 页面契约 —— `window.READY === true`、确定性的 `window.render(t)`（t 为秒）、`window.DUR`（秒）；
 * - `generic-css`：`document.getAnimations()` 全部暂停并设置 `currentTime`（CSS 动画 / WAAPI）。
 *
 * 确定性 shim（ADR-08）：**只作用于场景代码作用域**，绝不替换全局 `Date` / `performance` / `Math.random` /
 * `requestAnimationFrame`（HF 0.9.26 runtime 内部大量使用挂钟，全局替换会破坏它的就绪和媒体时钟）。
 * shim 只在页面上挂一个只读的 `window.__sdScope`；场景代码经 `wrapSceneCode()` 包装后，标识符
 * `Math / Date / performance / requestAnimationFrame / setTimeout …` 在场景作用域里被遮蔽为虚拟版本。
 * 已知限制：场景代码写 `window.Date`、`globalThis.performance` 仍能拿到真实挂钟 —— 由 G2 静态规则禁止，不靠 shim。
 *
 * 纯模块：不引入 Node / Electron；渲染进程、主进程、测试都能用。ADR-03：只给新项目（VideoSpec）用，不接入旧路线。
 */
import { projectUsesVideoSpec, type VideoSpecAdapterKind } from './video-spec';

// ───────────────────────────── 协议类型 ─────────────────────────────

export const SCENE_RUNTIME_VERSION = 1 as const;
export const SCENE_RUNTIME_ADAPTERS = ['hyperframes', 'lemo', 'generic-css'] as const;
export type SceneRuntimeAdapter = (typeof SCENE_RUNTIME_ADAPTERS)[number];

/** 虚拟 `Date.now()` 的起点（帧 0 = 2026-01-01T00:00:00Z），与真实日期无关，保证同一帧每次渲染结果一致。 */
export const SCENE_RUNTIME_DEFAULT_EPOCH_MS = Date.UTC(2026, 0, 1);

export interface SceneRuntimeFontStatus {
  /** `document.fonts.status === 'loaded'`（没有 FontFaceSet 时视为 true）。 */
  ready: boolean;
  /** 加载失败（status === 'error'）的字体 family。 */
  failed: string[];
}

export interface SceneRuntimeMediaItem {
  kind: 'video' | 'audio';
  src: string;
  readyState: number;
  seeking: boolean;
  error: number | null;
}

export interface SceneRuntimeError {
  message: string;
  /** error = window.onerror；unhandledrejection；seek = 适配器 seek 失败；scene = 场景作用域里的 rAF/定时器回调异常。 */
  source: 'error' | 'unhandledrejection' | 'seek' | 'ready' | 'scene';
  frame: number | null;
}

/** 页面里的 `window.__sd`（由 `buildSceneRuntimeBootstrap` 安装）。 */
export interface SceneRuntimeProtocol {
  readonly version: typeof SCENE_RUNTIME_VERSION;
  readonly adapter: SceneRuntimeAdapter;
  readonly fps: number;
  readonly width: number | null;
  readonly height: number | null;
  /** 总帧数（VideoSpec 给定时以它为准；否则 ready 之后由页面时长 round(秒 × fps) 得出）。 */
  readonly durationFrames: number;
  /** 秒 = durationFrames / fps。 */
  readonly duration: number;
  /** 最近一次成功 seek 的帧。 */
  readonly lastFrame: number | null;
  /** 页面错误（最多 100 条），宿主按长度增量读取。 */
  readonly errors: SceneRuntimeError[];
  /** 字体、图片、视频、适配器就绪；之后绘制一帧。重复调用返回同一个 Promise。 */
  ready(): Promise<void>;
  /** 跳到整数帧 n，Promise 在该帧已经绘制（媒体 seeked + 两次 rAF）之后才 resolve。多次调用串行执行。 */
  seek(frame: number): Promise<void>;
  /** 同 seek，但回传帧号，宿主核对 `frame === n` 后才截图（§7.1）。 */
  seekFrame(frame: number): Promise<{ frame: number }>;
  fonts(): SceneRuntimeFontStatus;
  media?(): SceneRuntimeMediaItem[];
  /** 可序列化的快照（宿主通过 executeJavaScript 读回）。 */
  describe(): SceneRuntimeDescriptor;
}

/** `@hyperframes/engine@0.9.26` types.d.ts 的页面契约（§13.1）。 */
export interface HfPageProtocol {
  duration: number;
  seek(time: number, options?: unknown): void | Promise<void>;
  media?: unknown;
  transitions?: unknown;
  clipWindow?: unknown;
}

/** 场景作用域里的确定性对象（页面上的 `window.__sdScope`）。 */
export interface SceneDeterminismScope {
  readonly version: 1;
  readonly Math: Math;
  readonly Date: DateConstructor;
  readonly performance: { now(): number; readonly timeOrigin: number };
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]): number;
  clearTimeout(id: number): void;
  setInterval(callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]): number;
  clearInterval(id: number): void;
  /** 把虚拟时钟设到第 n 帧：按 (seed, n) 重新播种 PRNG，执行到期的虚拟定时器。 */
  advance(frame: number): void;
  /** 执行当前排队的场景 rAF 回调（时间戳 = 当前帧毫秒）。 */
  flushAnimationFrames(): void;
  readonly frame: number;
  readonly nowMs: number;
  readonly errors: SceneRuntimeError[];
}

export interface SceneRuntimeDescriptor {
  version: number;
  adapter: SceneRuntimeAdapter;
  fps: number;
  width: number | null;
  height: number | null;
  durationFrames: number;
  durationSeconds: number;
  /** 页面自己声明的时长（HF `__hf.duration` / `__tl.duration()`、Lemo `DUR`、CSS 动画最晚结束时间）；不知道时为 null。 */
  pageDurationSeconds: number | null;
  lastFrame: number | null;
  errorCount: number;
  fonts: SceneRuntimeFontStatus;
}

// ───────────────────────────── 时间与种子 ─────────────────────────────

/** 帧号 → 秒（页面适配器内部也用同一公式：frame / fps）。 */
export function sceneFrameSeconds(frame: number, fps: number): number {
  assertFrame(frame);
  assertFps(fps);
  return frame / fps;
}

/** 页面声明的秒数 → 帧数：round(秒 × fps)（与上游 video.mjs 的 round(DUR × fps) 一致）。 */
export function sceneDurationFrames(seconds: number, fps: number): number {
  assertFps(fps);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError(`场景时长必须是正数秒（收到 ${String(seconds)}）`);
  return Math.max(1, Math.round(seconds * fps));
}

/** 场景 id → 32 位种子（FNV-1a）。同一场景每次渲染得到同一串随机数。 */
export function sceneRuntimeSeed(sceneId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sceneId.length; index += 1) {
    hash ^= sceneId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function assertFps(fps: number) {
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new RangeError(`fps 必须在 (0, 240] 之间（收到 ${String(fps)}）`);
}

function assertFrame(frame: number) {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(`帧号必须是非负整数（收到 ${String(frame)}）`);
}

// ───────────────────────────── 页面脚本生成 ─────────────────────────────

export interface SceneRuntimeBootstrapOptions {
  /** 默认 30（底座 §12 建议）；VideoSpec 项目传 spec.canvas.fps。 */
  fps?: number;
  /** 权威总帧数（VideoSpec 的 scene.durationFrames）。缺省时 ready 之后由页面时长换算。 */
  durationFrames?: number;
  width?: number;
  height?: number;
  /** 用于 PRNG 种子；`seed` 优先。 */
  sceneId?: string;
  seed?: number;
  epochMs?: number;
  /** seek 之后等几次 rAF 再算“已绘制”（默认 2，和现有 html-video-frame-seek 一致）。 */
  paintFrames?: number;
  /** ready 轮询间隔（毫秒，默认 16）。 */
  pollMs?: number;
}

interface ResolvedBootstrapConfig {
  adapter: SceneRuntimeAdapter;
  fps: number;
  durationFrames: number | null;
  width: number | null;
  height: number | null;
  seed: number;
  epochMs: number;
  paintFrames: number;
  pollMs: number;
}

function resolveBootstrapConfig(adapter: SceneRuntimeAdapter, options: SceneRuntimeBootstrapOptions): ResolvedBootstrapConfig {
  if (!(SCENE_RUNTIME_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new RangeError(`SceneRuntime 适配器只支持 ${SCENE_RUNTIME_ADAPTERS.join(' / ')}（收到 ${String(adapter)}）`);
  }
  const fps = options.fps ?? 30;
  assertFps(fps);
  if (options.durationFrames !== undefined && (!Number.isSafeInteger(options.durationFrames) || options.durationFrames < 1)) {
    throw new RangeError(`durationFrames 必须是正整数（收到 ${String(options.durationFrames)}）`);
  }
  for (const [label, value] of [['width', options.width], ['height', options.height]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`${label} 必须是正整数`);
  }
  const paintFrames = options.paintFrames ?? 2;
  if (!Number.isSafeInteger(paintFrames) || paintFrames < 0 || paintFrames > 8) throw new RangeError('paintFrames 必须是 0–8 的整数');
  const pollMs = options.pollMs ?? 16;
  if (!Number.isFinite(pollMs) || pollMs < 1 || pollMs > 1000) throw new RangeError('pollMs 必须在 1–1000 毫秒之间');
  const seed = options.seed !== undefined ? options.seed >>> 0 : sceneRuntimeSeed(options.sceneId ?? 'scene');
  const epochMs = options.epochMs ?? SCENE_RUNTIME_DEFAULT_EPOCH_MS;
  if (!Number.isFinite(epochMs)) throw new RangeError('epochMs 必须是有限数');
  return {
    adapter,
    fps,
    durationFrames: options.durationFrames ?? null,
    width: options.width ?? null,
    height: options.height ?? null,
    seed,
    epochMs,
    paintFrames,
    pollMs,
  };
}

/**
 * 确定性 shim 源码（页面 JS）。只安装只读的 `window.__sdScope`，不碰任何全局。
 * 必须在场景代码执行之前运行（`injectSceneRuntimeIntoHtml` 把它放在 <head> 最前面）。重复执行是幂等的。
 */
const SHIM_SOURCE = String.raw`(function (w, cfg) {
  'use strict';
  if (w.__sdScope && w.__sdScope.version === 1) return;
  var NativeDate = w.Date;
  var nativeMath = w.Math;
  var fps = cfg.fps;
  var epochMs = cfg.epochMs;
  var baseSeed = cfg.seed >>> 0;
  var currentFrame = 0;
  var nowMs = 0;
  var errors = [];
  function report(error, source) {
    if (errors.length >= 100) return;
    var message = error && error.message ? error.message : String(error);
    errors.push({ message: String(message).slice(0, 1500), source: source || 'scene', frame: currentFrame });
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = nativeMath.imul(a ^ (a >>> 15), 1 | a);
      t = (t + nativeMath.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mix(seed, frame) {
    var h = (seed ^ nativeMath.imul(frame + 1, 0x9E3779B1)) >>> 0;
    h = nativeMath.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
    h = nativeMath.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  var rng = mulberry32(baseSeed);
  var SceneMath = Object.create(nativeMath);
  Object.defineProperty(SceneMath, 'random', { value: function random() { return rng(); } });
  function SceneDate() {
    var args = Array.prototype.slice.call(arguments);
    if (!(this instanceof SceneDate)) return new NativeDate(epochMs + nowMs).toString();
    if (args.length === 0) return new NativeDate(epochMs + nowMs);
    return Reflect.construct(NativeDate, args);
  }
  SceneDate.prototype = NativeDate.prototype;
  SceneDate.now = function now() { return epochMs + nowMs; };
  SceneDate.UTC = NativeDate.UTC;
  SceneDate.parse = NativeDate.parse;
  var ScenePerformance = Object.freeze({ now: function now() { return nowMs; }, timeOrigin: epochMs });
  var rafQueue = [];
  var nextId = 1;
  function requestAnimationFrame(callback) {
    if (typeof callback !== 'function') throw new TypeError('requestAnimationFrame callback must be a function');
    var id = nextId++;
    rafQueue.push({ id: id, callback: callback });
    return id;
  }
  function cancelAnimationFrame(id) {
    rafQueue = rafQueue.filter(function (item) { return item.id !== id; });
  }
  var timers = [];
  function addTimer(callback, delay, args, repeat) {
    if (typeof callback !== 'function') throw new TypeError('scene timers only accept functions');
    var ms = Number(delay) > 0 ? Number(delay) : 0;
    var id = nextId++;
    timers.push({ id: id, due: nowMs + ms, interval: repeat ? nativeMath.max(1, ms) : 0, callback: callback, args: args });
    return id;
  }
  function clearTimer(id) {
    timers = timers.filter(function (item) { return item.id !== id; });
  }
  function runTimers() {
    for (var guard = 0; guard < 10000; guard++) {
      var next = null;
      for (var i = 0; i < timers.length; i++) if (timers[i].due <= nowMs && (!next || timers[i].due < next.due)) next = timers[i];
      if (!next) return;
      if (next.interval) next.due += next.interval; else clearTimer(next.id);
      try { next.callback.apply(w, next.args); } catch (error) { report(error, 'scene'); }
    }
    report(new Error('SCENE_RUNTIME_TIMER_RUNAWAY: more than 10000 virtual timer callbacks in one frame'), 'scene');
  }
  function flushAnimationFrames() {
    var queue = rafQueue;
    rafQueue = [];
    for (var i = 0; i < queue.length; i++) {
      try { queue[i].callback.call(w, nowMs); } catch (error) { report(error, 'scene'); }
    }
  }
  function advance(frame) {
    currentFrame = frame;
    nowMs = (frame * 1000) / fps;
    rng = mulberry32(mix(baseSeed, frame));
    runTimers();
  }
  var scope = {
    version: 1,
    Math: SceneMath,
    Date: SceneDate,
    performance: ScenePerformance,
    requestAnimationFrame: requestAnimationFrame,
    cancelAnimationFrame: cancelAnimationFrame,
    setTimeout: function setTimeout(callback, delay) { return addTimer(callback, delay, Array.prototype.slice.call(arguments, 2), false); },
    clearTimeout: clearTimer,
    setInterval: function setInterval(callback, delay) { return addTimer(callback, delay, Array.prototype.slice.call(arguments, 2), true); },
    clearInterval: clearTimer,
    advance: advance,
    flushAnimationFrames: flushAnimationFrames,
    report: report,
    errors: errors
  };
  Object.defineProperty(scope, 'frame', { get: function () { return currentFrame; }, enumerable: true });
  Object.defineProperty(scope, 'nowMs', { get: function () { return nowMs; }, enumerable: true });
  Object.defineProperty(w, '__sdScope', { value: Object.freeze(scope), configurable: false, enumerable: false, writable: false });
})`;

/** 适配器与协议源码（页面 JS）。依赖 SHIM_SOURCE 先安装 `__sdScope`。 */
const RUNTIME_SOURCE = String.raw`(function (w, cfg) {
  'use strict';
  if (w.__sd && w.__sd.version === 1) {
    if (w.__sd.adapter !== cfg.adapter) throw new Error('SCENE_RUNTIME_ADAPTER_CONFLICT: page already runs ' + w.__sd.adapter + ', not ' + cfg.adapter);
    return true;
  }
  var doc = w.document;
  var scope = w.__sdScope;
  var errors = scope.errors;
  var fps = cfg.fps;
  var adapter = cfg.adapter;
  var nativeMath = w.Math;
  var nativeSetTimeout = w.setTimeout.bind(w);
  var nativeRaf = typeof w.requestAnimationFrame === 'function'
    ? w.requestAnimationFrame.bind(w)
    : function (callback) { return nativeSetTimeout(function () { callback(0); }, 16); };
  var lastFrame = null;
  var derivedFrames = null;
  var ownedHf = null;
  var readyPromise = null;
  var seekChain = Promise.resolve();
  function pushError(message, source, frame) {
    if (errors.length >= 100) return;
    errors.push({ message: String(message).slice(0, 1500), source: source, frame: frame === undefined ? null : frame });
  }
  function messageOf(error) { return error && error.message ? error.message : String(error); }
  if (typeof w.addEventListener === 'function') {
    w.addEventListener('error', function (event) {
      pushError(event && (event.message || (event.error && event.error.message)) || 'Script error', 'error');
    });
    w.addEventListener('unhandledrejection', function (event) {
      pushError(messageOf(event && event.reason), 'unhandledrejection');
    });
  }
  function listFonts() { try { return doc && doc.fonts ? Array.from(doc.fonts) : []; } catch (error) { return []; } }
  function fontStatus() {
    var failed = listFonts().filter(function (font) { return font && font.status === 'error'; }).map(function (font) { return String(font.family); });
    var ready = !doc || !doc.fonts || doc.fonts.status === undefined || doc.fonts.status === 'loaded';
    return { ready: ready, failed: failed };
  }
  function mediaElements() {
    return doc && typeof doc.querySelectorAll === 'function' ? Array.from(doc.querySelectorAll('video, audio')) : [];
  }
  function mediaStatus() {
    return mediaElements().map(function (media) {
      return {
        kind: String(media.tagName || '').toLowerCase() === 'audio' ? 'audio' : 'video',
        src: String(media.currentSrc || media.src || ''),
        readyState: Number(media.readyState) || 0,
        seeking: !!media.seeking,
        error: media.error ? Number(media.error.code) || 0 : null
      };
    });
  }
  function pageHf() {
    var hf = w.__hf;
    return hf && hf !== ownedHf && typeof hf.seek === 'function' ? hf : null;
  }
  function positive(value) { var n = Number(value); return isFinite(n) && n > 0 ? n : null; }
  function pageDurationSeconds() {
    try {
      if (adapter === 'hyperframes') {
        var hf = pageHf();
        if (hf) return positive(hf.duration);
        if (w.__tl && typeof w.__tl.duration === 'function') return positive(w.__tl.duration());
        return null;
      }
      if (adapter === 'lemo') return positive(w.DUR);
      var end = 0;
      var animations = doc && typeof doc.getAnimations === 'function' ? doc.getAnimations() : [];
      for (var i = 0; i < animations.length; i++) {
        var effect = animations[i].effect;
        var timing = effect && typeof effect.getComputedTiming === 'function' ? effect.getComputedTiming() : null;
        var endTime = timing ? Number(timing.endTime) : NaN;
        if (isFinite(endTime) && endTime > end) end = endTime;
      }
      return positive(w.__sdDurationSeconds) || positive(end / 1000);
    } catch (error) {
      return null;
    }
  }
  function durationFrames() {
    if (cfg.durationFrames) return cfg.durationFrames;
    return derivedFrames || 0;
  }
  function adapterReady() {
    if (doc && doc.readyState === 'loading') return false;
    if (adapter === 'hyperframes') {
      if (typeof w.__mediaError === 'string' && w.__mediaError) throw new Error('SCENE_RUNTIME_MEDIA_FAILED: ' + w.__mediaError);
      if (pageHf()) return true;
      return w.__ready === true && (!w.__playerReady || w.__renderReady === true) && !!w.__tl && typeof w.__tl.seek === 'function';
    }
    if (adapter === 'lemo') return w.READY === true && typeof w.render === 'function';
    return true;
  }
  function assetsReady() {
    var images = doc && doc.images ? Array.from(doc.images) : [];
    for (var i = 0; i < images.length; i++) {
      if (!images[i].complete) return false;
      if (!(images[i].naturalWidth > 0)) throw new Error('SCENE_RUNTIME_IMAGE_FAILED: ' + String(images[i].currentSrc || images[i].src || '').slice(0, 300));
    }
    var videos = mediaElements();
    for (var j = 0; j < videos.length; j++) {
      if (videos[j].error) throw new Error('SCENE_RUNTIME_MEDIA_FAILED: ' + String(videos[j].currentSrc || videos[j].src || '').slice(0, 300));
      if (String(videos[j].tagName || '').toLowerCase() === 'video' && (videos[j].seeking || !(videos[j].readyState >= 2))) return false;
    }
    return true;
  }
  function paint() {
    var remaining = cfg.paintFrames;
    return new Promise(function (resolve) {
      function step() { if (remaining-- <= 0) return resolve(); nativeRaf(step); }
      step();
    });
  }
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(function (resolve, reject) {
      function poll() {
        try {
          var failedFonts = fontStatus().failed;
          if (failedFonts.length) throw new Error('SCENE_RUNTIME_FONT_FAILED: ' + failedFonts.join(', '));
          if (adapterReady() && assetsReady()) return resolve();
        } catch (error) {
          return reject(error);
        }
        nativeSetTimeout(poll, cfg.pollMs);
      }
      poll();
    }).then(function () {
      return doc && doc.fonts && doc.fonts.ready ? doc.fonts.ready : undefined;
    }).then(function () {
      var failedFonts = fontStatus().failed;
      if (failedFonts.length) throw new Error('SCENE_RUNTIME_FONT_FAILED: ' + failedFonts.join(', '));
      if (!cfg.durationFrames) {
        var seconds = pageDurationSeconds();
        if (!seconds) throw new Error('SCENE_RUNTIME_DURATION_UNKNOWN: ' + adapter + ' page does not declare a duration');
        derivedFrames = nativeMath.max(1, nativeMath.round(seconds * fps));
      }
      return paint();
    }).catch(function (error) {
      pushError(messageOf(error), 'ready');
      throw error;
    });
    return readyPromise;
  }
  function waitMedia() {
    return Promise.all(mediaElements().map(function (media) {
      if (!media.seeking) return undefined;
      return new Promise(function (resolve, reject) {
        function cleanup() { media.removeEventListener('seeked', done); media.removeEventListener('error', fail); }
        function done() { cleanup(); resolve(); }
        function fail() { cleanup(); reject(new Error('SCENE_RUNTIME_MEDIA_SEEK_FAILED: ' + String(media.currentSrc || media.src || '').slice(0, 300))); }
        media.addEventListener('seeked', done);
        media.addEventListener('error', fail);
      });
    }));
  }
  function syncMarkedMedia(time) {
    mediaElements().forEach(function (media) {
      if (!media.hasAttribute || !media.hasAttribute('data-sd-media')) return;
      var start = Number(media.getAttribute('data-sd-start')) || 0;
      if (typeof media.pause === 'function') media.pause();
      media.currentTime = nativeMath.max(0, time - start);
    });
  }
  function adapterSeek(frame, time) {
    if (adapter === 'hyperframes') {
      var hf = pageHf();
      if (hf) return Promise.resolve(hf.seek(time));
      var player = w.__player;
      var timeline = w.__tl;
      if (player && typeof player.renderSeek === 'function') {
        var result = player.renderSeek(time, { suppressEvents: false });
        // GSAP returns its thenable timeline; awaiting a paused timeline never settles.
        var pending = result !== timeline && result && typeof result.then === 'function' ? result : undefined;
        return Promise.resolve(pending).then(function () {
          if (typeof w.__hfWaitForSeekCompletion === 'function') return w.__hfWaitForSeekCompletion();
          return undefined;
        });
      }
      if (timeline && typeof timeline.seek === 'function') { timeline.seek(time, false); return Promise.resolve(); }
      return Promise.reject(new Error('SCENE_RUNTIME_SEEK_UNAVAILABLE: no __hf.seek, __player.renderSeek or __tl.seek'));
    }
    if (adapter === 'lemo') {
      if (typeof w.render !== 'function') return Promise.reject(new Error('SCENE_RUNTIME_SEEK_UNAVAILABLE: window.render is not a function'));
      var dur = positive(w.DUR);
      return Promise.resolve(w.render(dur ? nativeMath.min(time, dur - 0.000001) : time));
    }
    var ms = time * 1000;
    var animations = doc && typeof doc.getAnimations === 'function' ? doc.getAnimations() : [];
    for (var i = 0; i < animations.length; i++) {
      var animation = animations[i];
      if (animation.playState !== 'paused') animation.pause();
      animation.currentTime = ms;
    }
    syncMarkedMedia(time);
    return Promise.resolve();
  }
  function doSeek(frame) {
    var total = durationFrames();
    if (typeof frame !== 'number' || nativeMath.floor(frame) !== frame || frame < 0 || frame >= total) {
      return Promise.reject(new Error('SCENE_RUNTIME_FRAME_OUT_OF_RANGE: ' + String(frame) + ' not in [0, ' + total + ')'));
    }
    var time = frame / fps;
    return Promise.resolve()
      .then(function () { scope.advance(frame); return adapterSeek(frame, time); })
      .then(function () { scope.flushAnimationFrames(); return waitMedia(); })
      .then(paint)
      .then(function () { lastFrame = frame; })
      .catch(function (error) { pushError(messageOf(error), 'seek', frame); throw error; });
  }
  function seek(frame) {
    var run = seekChain.then(function () { return doSeek(frame); });
    seekChain = run.catch(function () {});
    return run;
  }
  var sd = {
    version: 1,
    adapter: adapter,
    fps: fps,
    width: cfg.width,
    height: cfg.height,
    errors: errors,
    ready: ready,
    seek: seek,
    seekFrame: function (frame) { return seek(frame).then(function () { return { frame: frame }; }); },
    fonts: fontStatus,
    media: mediaStatus,
    describe: function () {
      var frames = durationFrames();
      return {
        version: 1,
        adapter: adapter,
        fps: fps,
        width: cfg.width,
        height: cfg.height,
        durationFrames: frames,
        durationSeconds: frames / fps,
        pageDurationSeconds: pageDurationSeconds(),
        lastFrame: lastFrame,
        errorCount: errors.length,
        fonts: fontStatus()
      };
    }
  };
  Object.defineProperty(sd, 'durationFrames', { get: durationFrames, enumerable: true });
  Object.defineProperty(sd, 'duration', { get: function () { return durationFrames() / fps; }, enumerable: true });
  Object.defineProperty(sd, 'lastFrame', { get: function () { return lastFrame; }, enumerable: true });
  Object.defineProperty(w, '__sd', { value: Object.freeze(sd), configurable: true, enumerable: false, writable: false });
  if (!w.__hf) {
    ownedHf = {
      seek: function (time) {
        var total = durationFrames();
        var frame = nativeMath.min(nativeMath.max(0, total - 1), nativeMath.max(0, nativeMath.round(Number(time) * fps)));
        return seek(frame);
      }
    };
    Object.defineProperty(ownedHf, 'duration', { get: function () { return durationFrames() / fps; }, enumerable: true });
    w.__hf = ownedHf;
  }
  return true;
})`;

function scriptConfig(config: ResolvedBootstrapConfig): string {
  // JSON 是合法的 JS 表达式；转义 `<` 防止内联到 <script> 时提前闭合。
  return JSON.stringify(config).replace(/</gu, '\\u003c');
}

/** 只安装场景作用域 shim（`window.__sdScope`），供页面合成器在 <head> 最前面内联。 */
export function buildSceneDeterminismShim(options: SceneRuntimeBootstrapOptions = {}): string {
  const config = resolveBootstrapConfig('generic-css', options);
  return `${SHIM_SOURCE}(window, ${scriptConfig(config)});`;
}

/**
 * 生成注入场景页面的启动脚本：安装场景作用域 shim（若尚未安装）、`window.__sd`、以及（页面没有时）`window.__hf`。
 * 返回一个 JS 程序字符串，执行结果为 `true`；可以经 `webContents.executeJavaScript` 注入，也可以内联到 <head>。
 * 幂等：同一适配器重复注入无副作用；不同适配器冲突时抛 `SCENE_RUNTIME_ADAPTER_CONFLICT`。
 */
export function buildSceneRuntimeBootstrap(adapter: SceneRuntimeAdapter, options: SceneRuntimeBootstrapOptions = {}): string {
  const config = scriptConfig(resolveBootstrapConfig(adapter, options));
  return `(function () {\n${SHIM_SOURCE}(window, ${config});\nreturn ${RUNTIME_SOURCE}(window, ${config});\n})();`;
}

/** 场景作用域里被遮蔽的标识符（顺序即 wrapSceneCode 的形参顺序）。 */
export const SCENE_SCOPE_SHADOWED_GLOBALS = [
  'Math', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
] as const;

/**
 * 把场景代码包进确定性作用域。
 * - `classic`：包成函数，形参遮蔽全局标识符（顶层 `var`/函数声明变成局部的；需要导出的请显式写 `window.x = …`）。
 * - `module`：在模块顶部解构 `window.__sdScope`（模块作用域本身就是隔离的；import 声明会被提升，不受影响）。
 * 不能用 classic 方式包 ES 模块代码（含 import/export）。
 */
export function wrapSceneCode(code: string, options: { kind?: 'classic' | 'module' } = {}): string {
  const names = SCENE_SCOPE_SHADOWED_GLOBALS.join(', ');
  if (options.kind === 'module') {
    return `const { ${names} } = window.__sdScope;\n${code}`;
  }
  if (/^\s*(?:import\s*[\w{*'"]|export\s)/mu.test(code)) {
    throw new RangeError('SCENE_RUNTIME_WRAP_MODULE: 含 import/export 的场景代码请用 { kind: "module" } 包装');
  }
  const args = SCENE_SCOPE_SHADOWED_GLOBALS.map(name => `__sdScope.${name}`).join(', ');
  return `(function (${names}) {\n${code}\n}).call(window, ${args});`;
}

/**
 * 把启动脚本内联到 HTML 的 <head> 最前面（新项目的页面合成器用；保证 shim 先于任何场景脚本执行）。
 * `nonce` 用于 CSP `script-src 'nonce-…'`。
 */
export function injectSceneRuntimeIntoHtml(html: string, adapter: SceneRuntimeAdapter, options: SceneRuntimeBootstrapOptions & { nonce?: string } = {}): string {
  const { nonce, ...bootstrapOptions } = options;
  if (nonce !== undefined && !/^[A-Za-z0-9+/=_-]{8,128}$/u.test(nonce)) throw new RangeError('nonce 只能是 8–128 位 base64 字符');
  const body = buildSceneRuntimeBootstrap(adapter, bootstrapOptions).replace(/<\/(script)/giu, '<\\/$1');
  const tag = `<script data-sd-runtime="1"${nonce ? ` nonce="${nonce}"` : ''}>${body}</script>`;
  const head = /<head(?:\s[^>]*)?>/iu.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}${tag}${html.slice(head.index + head[0].length)}`;
  const htmlTag = /<html(?:\s[^>]*)?>/iu.exec(html);
  if (htmlTag) return `${html.slice(0, htmlTag.index + htmlTag[0].length)}<head>${tag}</head>${html.slice(htmlTag.index + htmlTag[0].length)}`;
  return `${tag}${html}`;
}

// ───────────────────────────── 宿主侧表达式与校验 ─────────────────────────────

/** 宿主经 executeJavaScript 调用的表达式（结果都可结构化克隆）。 */
export const sceneRuntimeScripts = {
  ready: `window.__sd.ready().then(function () { return true; })`,
  describe: `window.__sd.describe()`,
  seek(frame: number): string {
    assertFrame(frame);
    return `window.__sd.seekFrame(${frame}).then(function (r) { return { frame: r.frame, errorCount: window.__sd.errors.length }; })`;
  },
  errors(from: number): string {
    assertFrame(from);
    return `window.__sd.errors.slice(${from}).map(function (e) { return { message: String(e.message), source: String(e.source), frame: e.frame }; })`;
  },
} as const;

export type SceneRuntimeValidation =
  | { ok: true; descriptor: SceneRuntimeDescriptor }
  | { ok: false; issues: string[] };

/** 校验页面读回的 `__sd.describe()`；`expected` 用来核对适配器 / fps / 总帧数 / 画布。 */
export function validateSceneRuntimeDescriptor(
  value: unknown,
  expected: { adapter?: SceneRuntimeAdapter; fps?: number; durationFrames?: number; width?: number; height?: number } = {},
): SceneRuntimeValidation {
  const issues: string[] = [];
  if (!value || typeof value !== 'object') return { ok: false, issues: ['页面没有返回 __sd.describe() 快照（window.__sd 不存在或不是 v1 协议）'] };
  const record = value as Record<string, unknown>;
  const isPositiveInt = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
  const nullableInt = (input: unknown) => input === null || isPositiveInt(input);
  if (record.version !== SCENE_RUNTIME_VERSION) issues.push(`协议版本必须是 ${SCENE_RUNTIME_VERSION}（收到 ${String(record.version)}）`);
  if (typeof record.adapter !== 'string' || !(SCENE_RUNTIME_ADAPTERS as readonly string[]).includes(record.adapter)) issues.push(`未知适配器 ${String(record.adapter)}`);
  else if (expected.adapter && record.adapter !== expected.adapter) issues.push(`页面适配器是 ${record.adapter}，期望 ${expected.adapter}`);
  if (typeof record.fps !== 'number' || !Number.isFinite(record.fps) || record.fps <= 0) issues.push(`fps 无效（${String(record.fps)}）`);
  else if (expected.fps !== undefined && record.fps !== expected.fps) issues.push(`页面 fps 是 ${record.fps}，期望 ${expected.fps}`);
  if (!isPositiveInt(record.durationFrames)) issues.push(`durationFrames 必须是正整数（收到 ${String(record.durationFrames)}）`);
  else if (expected.durationFrames !== undefined && record.durationFrames !== expected.durationFrames) issues.push(`页面总帧数是 ${record.durationFrames}，期望 ${expected.durationFrames}`);
  if (typeof record.durationSeconds !== 'number' || !(record.durationSeconds > 0)) issues.push('durationSeconds 必须是正数');
  else if (isPositiveInt(record.durationFrames) && typeof record.fps === 'number' && Math.abs(record.durationSeconds - record.durationFrames / record.fps) > 1e-9) issues.push('durationSeconds 必须等于 durationFrames / fps');
  if (record.pageDurationSeconds !== null && !(typeof record.pageDurationSeconds === 'number' && record.pageDurationSeconds > 0 && Number.isFinite(record.pageDurationSeconds))) issues.push('pageDurationSeconds 必须是正数或 null');
  if (!nullableInt(record.width) || !nullableInt(record.height)) issues.push('width / height 必须是正整数或 null');
  if (expected.width !== undefined && record.width !== null && record.width !== expected.width) issues.push(`页面宽度 ${String(record.width)} ≠ 画布 ${expected.width}`);
  if (expected.height !== undefined && record.height !== null && record.height !== expected.height) issues.push(`页面高度 ${String(record.height)} ≠ 画布 ${expected.height}`);
  if (record.lastFrame !== null && !(typeof record.lastFrame === 'number' && Number.isSafeInteger(record.lastFrame) && record.lastFrame >= 0)) issues.push('lastFrame 必须是非负整数或 null');
  if (typeof record.errorCount !== 'number' || !Number.isSafeInteger(record.errorCount) || record.errorCount < 0) issues.push('errorCount 必须是非负整数');
  const fonts = record.fonts as Record<string, unknown> | undefined;
  if (!fonts || typeof fonts !== 'object' || typeof fonts.ready !== 'boolean' || !Array.isArray(fonts.failed) || !fonts.failed.every(item => typeof item === 'string')) issues.push('fonts 必须是 { ready: boolean, failed: string[] }');
  if (issues.length) return { ok: false, issues };
  return { ok: true, descriptor: value as SceneRuntimeDescriptor };
}

// ───────────────────────────── VideoSpec 适配器 → 采集方式 ─────────────────────────────

export type SceneCapturePlan =
  | { capturable: true; runtime: SceneRuntimeAdapter; note?: string }
  | { capturable: false; compositor: 'ffmpeg'; reason: string };

/**
 * 每种 VideoSpec 适配器由谁出画面。键类型是 `VideoSpecAdapterKind`，新增适配器时编译器会强制在这里补一项（契约测试也会失败）。
 */
export const VIDEO_SPEC_ADAPTER_CAPTURE: { readonly [K in VideoSpecAdapterKind]: SceneCapturePlan } = Object.freeze({
  hyperframes: { capturable: true, runtime: 'hyperframes' },
  lemo: { capturable: true, runtime: 'lemo', note: '新架构的 Lemo 场景页；Lemo faithful 整片仍由上游 video.mjs 出片（§13.5），不经过 CaptureHost' },
  template: { capturable: true, runtime: 'generic-css', note: '模板页用 CSS 动画 / WAAPI（E-7 建议）；T1 模板运行时接入后再确认' },
  video: { capturable: false, compositor: 'ffmpeg', reason: '视频素材由 ffmpeg 直接 trim/缩放/适配后合成，不进浏览器逐帧采集（避免二次解码和有损重采集）' },
  still: { capturable: false, compositor: 'ffmpeg', reason: '静态图片（含封面）由 ffmpeg 生成定长片段（可带镜头运动滤镜），不进浏览器逐帧采集' },
});

export function sceneCapturePlan(kind: VideoSpecAdapterKind): SceneCapturePlan {
  const plan = (VIDEO_SPEC_ADAPTER_CAPTURE as Record<string, SceneCapturePlan | undefined>)[kind];
  if (!plan) throw new RangeError(`未知的 VideoSpec 适配器：${String(kind)}`);
  return plan;
}

export type SceneCaptureStrategy = 'capture-host' | 'legacy';

/** ADR-03：只有 VideoSpec 新项目走 CaptureHost；旧项目（没有 videoSpecVersion）一律走现有采集路径。目前未接入任何路线。 */
export function sceneCaptureStrategy(project: unknown): SceneCaptureStrategy {
  return projectUsesVideoSpec(project) ? 'capture-host' : 'legacy';
}
