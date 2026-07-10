import { BrowserWindow, type Rectangle } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HtmlVideoBuildInput, HtmlVideoComposition, HtmlVideoCapturedScene, HtmlVideoExportInput, HtmlVideoExportResult } from '../src/shared/html-video';
import { createHtmlVideoComposePayload, buildHtmlVideoExportInput, type HtmlVideoComposePayload } from '../src/shared/html-video';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { attachLocalHtmlSecurity, isAllowedLocalHtmlNavigation } from './security';

const sidecarFramePattern = 'frame_%04d.jpg';
const hiddenWindowReadyTimeoutMs = 30_000;
const hiddenFrameTimeoutMs = 15_000;
const hiddenSceneTimeoutMs = 30 * 60 * 1_000;

export interface ElectronHtmlVideoRenderOptions {
  workDir: string;
  html: string;
  htmlPath?: string;
  canvas: Rectangle;
  fps: number;
  duration: number;
}

export async function createElectronHtmlVideoRenderer() {
  return {
    async render(input: HtmlVideoExportInput): Promise<HtmlVideoExportResult> {
      const framesDirs: string[] = [];
      const capturedScenes: HtmlVideoCapturedScene[] = [];
      const htmlVideoComposition = input;
      const htmlSceneDir = join(input.workDir, 'html-scenes');
      await mkdir(htmlSceneDir, { recursive: true });
      for (const scene of htmlVideoComposition.scenes) {
        const sceneDir = join(input.workDir, `frames-${String(scene.sceneId).padStart(3, '0')}`);
        await mkdir(sceneDir, { recursive: true });
        framesDirs.push(sceneDir);
        const htmlPath = join(htmlSceneDir, `scene-${String(scene.sceneId).padStart(3, '0')}.html`);
        await writeFile(htmlPath, scene.html, 'utf8');
        let window: BrowserWindow | null = null;
        try {
          window = await openHiddenHtmlWindow({
            workDir: input.workDir,
            htmlPath,
            fps: input.fps,
            duration: scene.duration,
            canvas: { x: 0, y: 0, width: input.canvas_w, height: input.canvas_h },
          });
          const totalFrames = Math.max(1, Math.round(scene.duration * input.fps));
          const sceneDeadline = Date.now() + hiddenSceneTimeoutMs;
          for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
            const time = frameIndex / input.fps;
            const frameNumber = frameIndex + 1;
            if (Date.now() >= sceneDeadline) throw new Error(`HTML scene ${scene.sceneId} capture timed out.`);
            await seekHiddenHtmlSceneFrame(window, time);
            const remainingSceneMs = Math.max(1, sceneDeadline - Date.now());
            const image = await withRendererTimeout(
              window.webContents.capturePage(),
              Math.min(hiddenFrameTimeoutMs, remainingSceneMs),
              `HTML scene ${scene.sceneId} frame ${frameNumber} capture`,
            );
            const framePath = join(sceneDir, sidecarFramePattern.replace('%04d', String(frameNumber).padStart(4, '0')));
            await writeFile(framePath, image.toJPEG(92));
          }
          capturedScenes.push({
            sceneId: scene.sceneId,
            framesDir: sceneDir,
            audioPath: scene.audioPath,
            fps: input.fps,
          });
        } finally {
          if (window && !window.isDestroyed()) window.destroy();
        }
      }
      const payload: HtmlVideoComposePayload = createHtmlVideoComposePayload(htmlVideoComposition, capturedScenes);
      const result = await runStoryboundMediaSidecar(payload);
      return {
        outputPath: result.output_path ?? input.outputPath,
        sourceVideoPath: result.source_path ?? join(input.workDir, '_source.mp4'),
        duration: input.totalDurationS,
        taskDir: input.workDir,
        framesDirs,
      };
    },
  };
}

async function openHiddenHtmlWindow(input: {
  workDir: string;
  htmlPath: string;
  fps: number;
  duration: number;
  canvas: Rectangle;
}): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    width: input.canvas.width,
    height: input.canvas.height,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    const htmlUrl = pathToFileURL(input.htmlPath).toString();
    if (!isAllowedLocalHtmlNavigation(htmlUrl, input.workDir)) {
      throw new Error('HTML scene path must stay inside the task work directory.');
    }
    attachLocalHtmlSecurity(window, input.workDir);
    await withRendererTimeout(window.loadURL(htmlUrl), hiddenWindowReadyTimeoutMs, 'HTML scene load');
    await waitForHiddenHtmlSceneReady(window);
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

async function waitForHiddenHtmlSceneReady(window: BrowserWindow): Promise<void> {
  await withRendererTimeout(window.webContents.executeJavaScript(`new Promise((resolve) => {
    const isReady = () => document.readyState !== 'loading'
      && window.__ready === true
      && window.__tl
      && typeof window.__tl.seek === 'function';
    const finish = () => {
      const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      const imagesReady = Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((imageResolve) => {
          image.addEventListener('load', imageResolve, { once: true });
          image.addEventListener('error', imageResolve, { once: true });
        });
      }));
      Promise.all([fontsReady, imagesReady]).then(() => requestAnimationFrame(() => resolve(true)));
    };
    if (isReady()) {
      finish();
      return;
    }
    const timer = setInterval(() => {
      if (isReady()) {
        clearInterval(timer);
        finish();
      }
    }, 16);
  })`), hiddenWindowReadyTimeoutMs, 'HTML scene ready');
}

async function seekHiddenHtmlSceneFrame(window: BrowserWindow, time: number): Promise<void> {
  await withRendererTimeout(window.webContents.executeJavaScript(`Promise.resolve(window.__tl.seek(${JSON.stringify(time)})).then(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  }))`), hiddenFrameTimeoutMs, 'HTML scene frame seek');
}

function withRendererTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    timeout.unref?.();
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
