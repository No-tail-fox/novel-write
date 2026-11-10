import vm from 'node:vm';

/** 一个最小的“浏览器页面”：vm 上下文 + 假 window/document，用来执行 SceneRuntime 启动脚本。 */
export interface FakeAnimation {
  playState: 'running' | 'paused' | 'finished';
  currentTime: number | null;
  pause(): void;
  effect: { getComputedTiming(): { endTime: number } };
}

export interface FakeFontFace { family: string; status: 'loaded' | 'loading' | 'error' }

export interface FakePageOptions {
  animations?: FakeAnimation[];
  fonts?: FakeFontFace[];
  fontsStatus?: 'loaded' | 'loading';
  media?: unknown[];
  images?: unknown[];
  readyState?: 'loading' | 'interactive' | 'complete';
  /** 额外挂到 window 上的全局（页面脚本/上游 runtime 的替身）。 */
  globals?: Record<string, unknown>;
}

export type FakePage = vm.Context & Record<string, any> & {
  /** 在页面里执行 JS（等价 executeJavaScript）。 */
  run<T = unknown>(code: string): T;
  /** 触发 window 上的事件监听器（error / unhandledrejection）。 */
  dispatch(type: string, event: unknown): void;
  /** 模拟页面销毁：之后页面里的 setTimeout / rAF 不再调度（避免轮询泄漏到测试进程）。 */
  close(): void;
};

export function fakeAnimation(endTime = 2000): FakeAnimation {
  return {
    playState: 'running',
    currentTime: null,
    pause() { this.playState = 'paused'; },
    effect: { getComputedTiming: () => ({ endTime }) },
  };
}

export function createFakePage(options: FakePageOptions = {}): FakePage {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const fonts = options.fonts ?? [];
  const document = {
    readyState: options.readyState ?? 'complete',
    images: options.images ?? [],
    fonts: {
      status: options.fontsStatus ?? 'loaded',
      ready: Promise.resolve(),
      [Symbol.iterator]: function* iterate() { yield* fonts; },
    },
    querySelectorAll: () => options.media ?? [],
    getAnimations: () => options.animations ?? [],
  };
  let closed = false;
  const schedule = (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => (closed ? undefined : setTimeout(callback, ms, ...args));
  const sandbox: Record<string, any> = {
    document,
    console,
    performance,
    setTimeout: schedule,
    clearTimeout,
    requestAnimationFrame: (callback: (time: number) => void) => schedule(() => callback(performance.now()), 0),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    ...options.globals,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox) as FakePage;
  Object.defineProperty(context, 'run', { value: (code: string) => vm.runInContext(code, context), enumerable: false });
  Object.defineProperty(context, 'dispatch', {
    value: (type: string, event: unknown) => { for (const listener of listeners.get(type) ?? []) listener(event); },
    enumerable: false,
  });
  Object.defineProperty(context, 'close', { value: () => { closed = true; }, enumerable: false });
  return context;
}
