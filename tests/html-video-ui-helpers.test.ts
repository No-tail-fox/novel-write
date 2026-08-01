import { describe, expect, it, vi } from 'vitest';
import {
  createHtmlVideoMediaCache,
  htmlVideoMediaElementKey,
  htmlVideoMediaStatus,
  loadHtmlVideoMedia,
  recordHtmlVideoMediaElementFailure,
  syncHtmlVideoMediaCache,
} from '@shared/html-video-media';
import {
  classifyHtmlVideoTaskMessage,
  fitHtmlVideoOutputSize,
  htmlVideoUserFacingError,
  MAX_HTML_VIDEO_SOURCE_CHARS,
  nextHtmlVideoTabKey,
  safeParseHtmlVideoPipelineData,
} from '@shared/html-video-workflow';

describe('HTML video media cache', () => {
  it.each([
    ['resolved URL', { 'clip.wav': 'storydream-media://task/clip.wav' }, new Set<string>(), false, 'ready'],
    ['pending request', {}, new Set<string>(), false, 'loading'],
    ['settled failure', {}, new Set(['clip.wav']), false, 'unavailable'],
    ['browser fallback', {}, new Set<string>(), true, 'desktop-only'],
    ['element failure overrides a resolved URL', { 'clip.wav': 'storydream-media://task/clip.wav' }, new Set(['clip.wav']), true, 'unavailable'],
  ] as const)('classifies %s', (_label, urls, failedPaths, isBrowserPreview, expected) => {
    expect(htmlVideoMediaStatus('clip.wav', urls, failedPaths, isBrowserPreview)).toBe(expected);
  });

  it('clears a rejected request so an explicit retry can load and cache the URL', async () => {
    const cache = createHtmlVideoMediaCache();
    syncHtmlVideoMediaCache(cache, 'task-1', ['voice.wav']);
    let attempt = 0;
    const loader = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('media unavailable');
      return 'storydream-media://task-1/voice.wav';
    });

    await expect(loadHtmlVideoMedia(cache, 'task-1', 'voice.wav', loader)).rejects.toThrow('media unavailable');
    expect(cache.requests.size).toBe(0);
    expect(cache.urls.has('voice.wav')).toBe(false);

    await expect(loadHtmlVideoMedia(cache, 'task-1', 'voice.wav', loader)).resolves.toBe('storydream-media://task-1/voice.wav');
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.requests.size).toBe(0);
    expect(cache.urls.get('voice.wav')).toBe('storydream-media://task-1/voice.wav');
  });

  it('deduplicates concurrent requests for the same task and path', async () => {
    const cache = createHtmlVideoMediaCache();
    syncHtmlVideoMediaCache(cache, 'task-1', ['scene.png']);
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);

    const first = loadHtmlVideoMedia(cache, 'task-1', 'scene.png', loader);
    const second = loadHtmlVideoMedia(cache, 'task-1', 'scene.png', loader);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    pending.resolve('storydream-media://task-1/scene.png');
    await expect(Promise.all([first, second])).resolves.toEqual([
      'storydream-media://task-1/scene.png',
      'storydream-media://task-1/scene.png',
    ]);
    expect(cache.requests.size).toBe(0);
  });

  it('does not cache a request result after its path is no longer active', async () => {
    const cache = createHtmlVideoMediaCache();
    syncHtmlVideoMediaCache(cache, 'task-1', ['old.png']);
    const pending = deferred<string>();
    const stale = loadHtmlVideoMedia(cache, 'task-1', 'old.png', () => pending.promise);
    await Promise.resolve();

    syncHtmlVideoMediaCache(cache, 'task-1', ['new.png']);
    pending.resolve('storydream-media://task-1/old.png');
    await expect(stale).resolves.toBe('storydream-media://task-1/old.png');
    expect(cache.urls.has('old.png')).toBe(false);
  });

  it('does not cache a request result after switching tasks', async () => {
    const cache = createHtmlVideoMediaCache();
    syncHtmlVideoMediaCache(cache, 'task-1', ['scene.png']);
    const pending = deferred<string>();
    const stale = loadHtmlVideoMedia(cache, 'task-1', 'scene.png', () => pending.promise);
    await Promise.resolve();

    syncHtmlVideoMediaCache(cache, 'task-2', ['scene.png']);
    pending.resolve('storydream-media://task-1/scene.png');
    await expect(stale).resolves.toBe('storydream-media://task-1/scene.png');
    expect(cache.taskId).toBe('task-2');
    expect(cache.urls.size).toBe(0);
  });

  it('keys media elements by task, path, and retry generation without delimiter collisions', () => {
    expect(htmlVideoMediaElementKey('task-1', 'scene.png', 0)).toBe('["task-1","scene.png",0]');
    expect(htmlVideoMediaElementKey('task:1', 'scene.png', 2)).not.toBe(
      htmlVideoMediaElementKey('task', '1:scene.png', 2),
    );
    expect(htmlVideoMediaElementKey('task-1', 'scene.png', 2)).not.toBe(
      htmlVideoMediaElementKey('task-1', 'scene.png', 3),
    );
  });

  it.each([
    ['task', { taskId: 'task-old', pathKey: '["new.mp4"]', generation: 2 }],
    ['path set', { taskId: 'task-new', pathKey: '["old.mp4"]', generation: 2 }],
    ['retry generation', { taskId: 'task-new', pathKey: '["new.mp4"]', generation: 1 }],
  ] as const)('ignores a late element error from a stale %s scope', (_label, eventScope) => {
    const currentScope = { taskId: 'task-new', pathKey: '["new.mp4"]', generation: 2 };
    const current = { ...currentScope, failedPaths: ['new.mp4'] };

    expect(recordHtmlVideoMediaElementFailure(current, eventScope, currentScope, 'old.mp4')).toBe(current);
    expect(current.failedPaths).toEqual(['new.mp4']);
  });

  it('records an element error from the current scope without clearing its other failures', () => {
    const currentScope = { taskId: 'task-new', pathKey: '["first.mp4","second.mp4"]', generation: 2 };
    const current = { ...currentScope, failedPaths: ['first.mp4'] };

    expect(recordHtmlVideoMediaElementFailure(current, currentScope, currentScope, 'second.mp4')).toEqual({
      ...currentScope,
      failedPaths: ['first.mp4', 'second.mp4'],
    });
  });
});

describe('HTML video tab keyboard navigation', () => {
  it.each([
    ['text', 'ArrowLeft', 'output'],
    ['output', 'ArrowRight', 'text'],
    ['preview', 'Home', 'text'],
    ['assets', 'End', 'output'],
    ['voice', 'ArrowRight', 'preview'],
    ['voice', 'ArrowLeft', 'assets'],
  ] as const)('moves from %s with %s to %s', (current, key, expected) => {
    expect(nextHtmlVideoTabKey(current, key)).toBe(expected);
  });

  it('ignores keys that do not navigate tabs', () => {
    expect(nextHtmlVideoTabKey('text', 'Enter')).toBeNull();
  });
});

describe('HTML video task message semantics', () => {
  it.each([
    ['failed', 'HTML 视频渲染失败。', 'error'],
    ['paused', '运行已暂停，可继续。', 'status'],
    ['cancelled', '用户取消', 'status'],
    ['running', '正在停止当前运行，随后继续重试。', 'status'],
    ['pending', '正在停止当前运行，随后继续重试。', 'status'],
  ] as const)('classifies %s task feedback "%s" as %s', (status, message, expected) => {
    expect(classifyHtmlVideoTaskMessage(status, message)).toBe(expected);
  });

  it('omits empty task feedback', () => {
    expect(classifyHtmlVideoTaskMessage('failed', '   ')).toBeNull();
  });

  it.each([
    ['HTML video rewrite step failed.', '文案改写失败。请从文案改写重试。'],
    ['HTML video planning step failed.', '场景规划失败。请从场景规划重试。'],
    ['HTML video assets step failed', '素材生成失败。请从素材生成重试。'],
    ['HTML video voice step failed.', '配音生成失败。请从配音生成重试。'],
    ['HTML video preview step failed.', '动画预览失败。请从动画预览重试。'],
    ['HTML video render step failed.', '出片失败。请从出片重试。'],
  ])('localizes legacy persisted error "%s"', (message, expected) => {
    expect(htmlVideoUserFacingError(message)).toBe(expected);
  });

  it('preserves detailed provider errors without discarding diagnostics', () => {
    const message = 'LLM storyboard response did not include scenes.';
    expect(htmlVideoUserFacingError(message)).toBe(message);
  });
});

describe('HTML video pipeline fallback', () => {
  it('returns a renderable fallback and diagnostic for damaged task data', () => {
    const result = safeParseHtmlVideoPipelineData('{', 'Fallback source sentence.');

    expect(result.error).toMatch(/HTML video pipeline/i);
    expect(result.data).toMatchObject({ version: 2, current: 'rewrite' });
    expect(result.data.scenes).toHaveLength(1);
  });

  it('keeps the original diagnostic and bounds display-only fallback copy without throwing again', () => {
    const originalDiagnostic = safeParseHtmlVideoPipelineData('{', 'short fallback').error;
    const oversizedFallback = `${'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS)}UNPERSISTED_TAIL`;

    const result = safeParseHtmlVideoPipelineData('{', oversizedFallback);

    expect(result.error).toBe(originalDiagnostic);
    expect(result.data.scenes).toHaveLength(1);
    expect(result.data.scenes[0].narration).toHaveLength(MAX_HTML_VIDEO_SOURCE_CHARS);
    expect(result.data.scenes[0].narration).not.toContain('UNPERSISTED_TAIL');
  });
});

describe('HTML video output sizing', () => {
  it.each([
    ['9:16 portrait', '9:16', 292.5, 520],
    ['1:1 square', '1:1', 520, 520],
    ['3:4 portrait', '3:4', 390, 520],
  ] as const)('fits %s within a 738x520 container without changing ratio', (_label, ratio, width, height) => {
    const size = fitHtmlVideoOutputSize(738, 520, ratio);

    expect(size.width).toBeCloseTo(width, 5);
    expect(size.height).toBeCloseTo(height, 5);
    expect(size.width).toBeLessThanOrEqual(738);
    expect(size.height).toBeLessThanOrEqual(520);
    expect(size.width / size.height).toBeCloseTo(size.aspectRatio, 8);
  });

  it('keeps landscape output within a narrower responsive container', () => {
    expect(fitHtmlVideoOutputSize(300, 520, '16:9')).toEqual({
      width: 300,
      height: 168.75,
      aspectRatio: 16 / 9,
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
