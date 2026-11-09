import { access, lstat, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runStoryboundMediaSidecar, type StoryboundEncodeRenderSceneInput } from '../src/shared/storybound-sidecar';
import { HTML_VIDEO_BUFFERED_FRAME_LIMIT, htmlVideoFrameCaptureTimeoutMs } from '../src/shared/video-render-budget';

/** Bound scratch JPEGs while retaining the exact, sequential frame clock and codec. */
export async function encodeHtmlFrames(
  input: StoryboundEncodeRenderSceneInput,
  capture: (writeFrame: (index: number, bytes: Uint8Array) => Promise<void>) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const expected = input.scene.video_frame_count;
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) throw Error('Invalid frame stream count');
  let written = 0;
  const streaming = expected > HTML_VIDEO_BUFFERED_FRAME_LIMIT;
  if (resolve(input.scene.frames_dir) !== resolve(input.work_dir, 'frames')) throw Error('Unsafe frame spool directory');
  signal?.throwIfAborted();
  const spool = await lstat(input.scene.frames_dir);
  if (!spool.isDirectory() || spool.isSymbolicLink()) throw Error('Unsafe frame spool directory');
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let encoderError: unknown, failed = false, completed = false;
  const encoderTimeoutMs = htmlVideoFrameCaptureTimeoutMs(expected) + 120_000;
  const encoding = streaming ? runStoryboundMediaSidecar({ ...input, scene: { ...input.scene, stream_frames: true, stream_timeout_seconds: Math.ceil(encoderTimeoutMs / 1000) } }, { signal: combined, timeoutMs: encoderTimeoutMs + 30_000 })
    .then(() => { completed = true; }, error => { failed = true; encoderError = error; }) : undefined;
  const framePath = (index: number) => join(input.scene.frames_dir, 'frame_' + String(index + 1).padStart(4, '0') + '.jpg');
  const check = () => { signal?.throwIfAborted(); if (failed) throw encoderError; if (completed) throw Error('Frame encoder exited before capture completed'); };
  try {
    await capture(async (index, bytes) => {
      check();
      if (index !== written || index >= expected) throw Error('Non-sequential frame stream');
      if (streaming && index >= HTML_VIDEO_BUFFERED_FRAME_LIMIT) {
        const deadline = Date.now() + 120_000;
        while (true) {
          check();
          try { await access(framePath(index - HTML_VIDEO_BUFFERED_FRAME_LIMIT)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
          if (Date.now() >= deadline) throw Error('HTML frame encoder backpressure timed out');
          await delay(20, undefined, { signal: combined });
        }
      }
      const path = framePath(index);
      // A consumer must never observe an incompletely written JPEG.
      await writeFile(path + '.tmp', bytes); await rename(path + '.tmp', path);
      written += 1;
    });
    signal?.throwIfAborted();
    if (written !== expected) throw Error('Incomplete frame stream');
    if (encoding) { await encoding; if (failed) throw encoderError; }
    else await runStoryboundMediaSidecar(input, { signal });
  } catch (error) {
    controller.abort(error);
    if (encoding) await encoding;
    throw error;
  }
}
