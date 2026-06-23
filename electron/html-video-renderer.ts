import { BrowserWindow, type Rectangle } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HtmlVideoBuildInput, HtmlVideoComposition, HtmlVideoCapturedScene, HtmlVideoExportInput, HtmlVideoExportResult } from '../src/shared/html-video';
import { createHtmlVideoComposePayload, buildHtmlVideoExportInput, type HtmlVideoComposePayload } from '../src/shared/html-video';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';

const sidecarFramePattern = 'frame_%04d.jpg';

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
        const window = await openHiddenHtmlWindow({
          workDir: input.workDir,
          html: scene.html,
          htmlPath,
          fps: input.fps,
          duration: scene.duration,
          canvas: { x: 0, y: 0, width: input.canvas_w, height: input.canvas_h },
        });
        const totalFrames = Math.max(1, Math.round(scene.duration * input.fps));
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
          const time = frameIndex / input.fps;
          await window.webContents.executeJavaScript(`window.__tl && window.__tl.seek(${JSON.stringify(time)})`);
          await window.webContents.capturePage().then(async (image) => {
            const framePath = join(sceneDir, sidecarFramePattern.replace('%04d', String(frameIndex + 1).padStart(4, '0')));
            await writeFile(framePath, image.toJPEG(92));
          });
        }
        capturedScenes.push({
          sceneId: scene.sceneId,
          framesDir: sceneDir,
          audioPath: scene.audioPath,
          fps: input.fps,
        });
        window.destroy();
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
  html: string;
  htmlPath?: string;
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
    },
  });
  await window.loadURL(input.htmlPath ? pathToFileURL(input.htmlPath).toString() : `data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`);
  await window.webContents.executeJavaScript(`window.__ready === true ? Promise.resolve(true) : new Promise((resolve) => {
    const timer = setInterval(() => {
      if (window.__ready === true) {
        clearInterval(timer);
        resolve(true);
      }
    }, 16);
  })`);
  return window;
}
