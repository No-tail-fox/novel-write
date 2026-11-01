import { setTimeout as delay } from 'node:timers/promises';
import { AppError, isCancellation } from '../src/shared/app-error';

/** Retry only a local compositor failure, never content checks or provider calls.
 * The operation owns/disposes its hidden window and recreates it on each attempt. */
export async function withHtmlGraphicsRecovery<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Capture cancelled');
    try { return await operation(); }
    catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (isCancellation(error) || !(error instanceof Error) || !/\bUnknownVizError\b/.test(error.message)) throw error;
      if (attempt >= 2) {
        const failure = new AppError('HTML_VIDEO_GRAPHICS_UNAVAILABLE',
          '图形进程截图失败，已重建捕获窗口两次。已保存的模型结果不受影响；请释放内存或检查显卡后继续，不需要重新生成内容。', true);
        Object.defineProperty(failure, 'cause', { value: error });
        throw failure;
      }
      // Chromium restarts the GPU process asynchronously after a compositor crash.
      await delay(500, undefined, { signal });
    }
  }
}
