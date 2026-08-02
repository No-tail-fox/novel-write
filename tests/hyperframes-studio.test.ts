import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildHtmlVideoExportInput } from '../src/shared/html-video';
import {
  clampHtmlVideoMediaTrimStartDelta,
  getVisibleHtmlVideoTrackIndices,
  moveHtmlVideoClipTrack,
} from '../src/shared/hyperframes';
import type { PipelineArtifact } from '../src/shared/types';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

const artifact: PipelineArtifact = {
  reviewedText: '审阅文本',
  rewrittenCopy: '镜头文案',
  cover: { title: 'HyperFrames', subtitle: [], summary: '摘要', tags: [], comments: [] },
  scenes: [{ id: 1, cap: '镜头文案', descPrompt: '编辑台', durationMs: 2400 }],
  imagePrompts: [],
  subtitles: { cues: [], srt: '' },
};

describe('HyperFrames HTML animation integration', () => {
  it('pins the official Player and composition packages instead of a remote-only playground', async () => {
    const packageJson = JSON.parse(await source('../package.json')) as {
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies?.['@hyperframes/core']).toBe('0.7.83');
    expect(packageJson.devDependencies?.['@hyperframes/lint']).toBe('0.7.83');
    expect(packageJson.devDependencies?.['@hyperframes/player']).toBe('0.7.83');
    expect(packageJson.devDependencies?.gsap).toBe('3.12.5');
  });

  it('generates a local-render-safe HyperFrames composition contract for every StoryDream scene', async () => {
    const composition = buildHtmlVideoExportInput({
      workDir: 'D:/task',
      outputPath: 'D:/task/final.mp4',
      title: 'HyperFrames',
      artifact,
      generatedImages: [{ sceneId: 1, path: 'D:/task/background.png' }],
      narrationAudio: [{ sceneId: 1, path: 'D:/task/voice.wav' }],
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });
    const html = composition.scenes[0].html;

    expect(html).toContain('data-composition-id="storydream-scene-1"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('data-duration="2.4"');
    expect(html).toContain('class="clip scene-image"');
    expect(html).toContain('data-track-index="0"');
    expect(html).toContain('window.__timelines');
    expect(html).toContain('const tl = gsap.timeline({ paused: true })');
    expect(html.indexOf('id="scene-background"')).toBeLessThan(
      html.indexOf('const tl = gsap.timeline({ paused: true })'),
    );
    expect(html).toContain("window.__timelines['storydream-scene-1'] = tl");
    expect(html).toContain("type: 'storydream:hyperframes-runtime-ready'");
    expect(html).toContain('backgroundReady: !canInspectMedia');
    expect(html).toContain("document.querySelectorAll('[src]')");
    expect(html.indexOf("window.__timelines['storydream-scene-1'] = tl")).toBeLessThan(
      html.lastIndexOf('postStorydreamRuntimeReady();'),
    );
    const gsapRuntime = 'src="./gsap.min.js"';
    const hyperframesRuntime = 'src="./hyperframe.runtime.gsap.iife.js"';
    expect(html).toContain(gsapRuntime);
    expect(html).toContain(hyperframesRuntime);
    expect(html.indexOf(gsapRuntime)).toBeLessThan(html.indexOf(hyperframesRuntime));
    expect(html).not.toMatch(/https?:\/\/cdn\./u);

    const { lintHyperframeHtml } = await import('@hyperframes/core/lint');
    const lint = await lintHyperframeHtml(html, { filePath: 'scene-001.html' });
    expect(lint.errorCount, JSON.stringify(lint.findings, null, 2)).toBe(0);
  });

  it('adds a dual-mode authoring surface with official live playback and the five Studio work areas', async () => {
    const [page, authoring, styles, index] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/features/html-video/HtmlVideoAuthoringWorkspace.tsx'),
      source('../src/styles/features/html-video.css'),
      source('../index.html'),
    ]);

    expect(page).toContain("type HtmlVideoWorkspaceMode = 'automatic' | 'authoring'");
    expect(page).toContain('自动制作');
    expect(page).toContain('可视编排');
    expect(page).toContain('<HtmlVideoAuthoringWorkspace');
    expect(authoring).toContain('api.saveHtmlVideoCompositionSource');
    expect(authoring).toContain('onClick={saveHtmlVideoCompositionSource}');
    expect(authoring).toContain("import '@hyperframes/player'");
    expect(authoring).toContain('<hyperframes-player');
    expect(authoring).toContain('源码');
    expect(authoring).toContain('属性');
    expect(authoring).toContain('检查');
    expect(authoring).toContain('渲染队列');
    expect(authoring).toContain('data-hyperframes-timeline');
    expect(authoring).toContain('data-trim-edge="end"');
    expect(authoring).toContain('saveHtmlVideoCompositionSource');
    expect(authoring).toContain('api.lintHtmlVideoCompositionSource');
    expect(styles).toContain('.hv-authoring-workspace');
    expect(styles).toContain('.hv-authoring-timeline');
    expect(index).toContain("frame-src 'self' storydream-media:");
  });

  it('renders sparse track ids as compact visible rows and preserves their semantic labels', () => {
    const clips = [0, 1, 20, 21].map((trackIndex) => ({ trackIndex }));
    const visibleTracks = getVisibleHtmlVideoTrackIndices(clips);

    expect(visibleTracks).toEqual([0, 1, 20, 21]);
    expect(moveHtmlVideoClipTrack(1, 1, visibleTracks)).toBe(20);
    expect(moveHtmlVideoClipTrack(20, -1, visibleTracks)).toBe(1);
    expect(moveHtmlVideoClipTrack(0, -3, visibleTracks)).toBe(0);
    expect(moveHtmlVideoClipTrack(21, 3, visibleTracks)).toBe(21);
  });

  it('does not let a media left trim extend before the timeline or available media', () => {
    const clip = { startSec: 2, durationSec: 4, mediaStartSec: 0 };
    expect(clampHtmlVideoMediaTrimStartDelta(clip, -1)).toBe(0);
    expect(clampHtmlVideoMediaTrimStartDelta({ ...clip, mediaStartSec: 0.75 }, -1)).toBe(-0.75);
    expect(clampHtmlVideoMediaTrimStartDelta({ ...clip, mediaStartSec: 5 }, -3)).toBe(-2);
    expect(clampHtmlVideoMediaTrimStartDelta(clip, 8)).toBe(3.9);
  });

  it('uses task/index/revision IPC ownership for source reads and atomic saves', async () => {
    const [api, preload, contract, main, storage] = await Promise.all([
      source('../src/shared/storydream-api.ts'),
      source('../electron/preload.ts'),
      source('../src/shared/ipc-contract.ts'),
      source('../electron/main.ts'),
      source('../src/shared/storage.ts'),
    ]);

    for (const channel of ['html-video:composition-source:get', 'html-video:composition-source:save']) {
      expect(api).toContain(`'${channel}'`);
      expect(contract).toContain(`'${channel}'`);
      expect(main).toContain(`trustedHandle('${channel}'`);
    }
    expect(api).toContain("'html-video:composition-source:lint'");
    expect(preload).toContain('lintHtmlVideoCompositionSource');
    expect(main).toContain("trustedHandle('html-video:composition-source:lint'");
    expect(main).toContain("import('@hyperframes/lint/browser')");
    expect(preload).toContain('getHtmlVideoCompositionSource');
    expect(preload).toContain('saveHtmlVideoCompositionSource');
    expect(storage).toContain('updateHtmlVideoCompositionSource');
    expect(storage).toContain('expectedRevision');
    expect(storage).toContain("invalidateHtmlVideoPipeline(pipeline, 'render')");
  });

  it('renders the exact saved composition sources after task-local validation', async () => {
    const runtime = await source('../electron/html-video-runtime.ts');
    expect(runtime).toContain('loadHtmlVideoCompositionSources');
    expect(runtime).toContain('input.compositions');
    expect(runtime).toContain('MAX_HYPERFRAMES_SOURCE_BYTES');
    expect(runtime).toContain('scene.html = savedSources.get(scene.sceneId) ?? scene.html');
  });

  it('stages both local animation runtimes for preview, render, and native authoring QA', async () => {
    const [runtime, main, build, qa] = await Promise.all([
      source('../electron/html-video-runtime.ts'),
      source('../electron/main.ts'),
      source('../scripts/build-electron.mjs'),
      source('../scripts/qa-html-video-ui.mjs'),
    ]);

    expect(runtime).toContain('gsapRuntimePath?: string');
    expect(runtime).toContain('GSAP_RUNTIME_FILENAME');
    expect(runtime).toContain('stageHtmlVideoAnimationRuntimes');
    expect(main).toContain('gsapRuntimePath: join(dirname(fileURLToPath(import.meta.url)), GSAP_RUNTIME_FILENAME)');
    expect(build).toContain("'node_modules/gsap/dist/gsap.min.js'");
    expect(build).toContain("'dist-electron/electron/gsap.min.js'");
    expect(qa).toContain("join(htmlDir, 'gsap.min.js')");
    expect(qa).toContain('runtime.hasGsap');
    expect(qa).toContain('runtime.compositionReady');
    expect(qa).toContain('runtime.timelineKeys.length > 0');
    expect(qa).toContain('runtime.timelineDuration > 0');
    expect(qa).toContain("payload.type !== 'storydream:hyperframes-runtime-ready'");
    expect(qa).toContain('event.source !== iframe.contentWindow');
    expect(qa).not.toContain('const frameWindow = player?.iframeElement?.contentWindow');
  });
});
