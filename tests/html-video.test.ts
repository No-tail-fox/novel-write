import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  buildHtmlVideoExportInput,
  createHtmlVideoComposePayload,
  type HtmlVideoCapturedScene,
} from '@shared/html-video';
import type { PipelineArtifact } from '@shared/types';

const artifact: PipelineArtifact = {
  reviewedText: 'reviewed',
  rewrittenCopy: 'First line\n\nSecond line',
  cover: { title: 'HTML Story', subtitle: ['subtitle'], summary: 'summary', tags: [], comments: [] },
  scenes: [
    { id: 1, cap: 'First line', descPrompt: 'A rainy street', durationMs: 1200 },
    { id: 2, cap: 'Second line', descPrompt: 'A quiet room', durationMs: 1600 },
  ],
  imagePrompts: [],
  subtitles: { cues: [], srt: '' },
};

describe('HTML video composition contract', () => {
  it('bounds hidden renderer readiness and frame capture and always destroys the window', async () => {
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');

    expect(renderer).toContain('hiddenWindowReadyTimeoutMs');
    expect(renderer).toContain('hiddenFrameTimeoutMs');
    expect(renderer).toContain('withRendererTimeout');
    expect(renderer).toMatch(/try\s*\{[\s\S]*?finally\s*\{[\s\S]*?window\.destroy\(\)/);
  });

  it('builds seekable Storybound-style scene HTML with timeline globals', () => {
    const input = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-1',
      outputPath: 'D:/tasks/html-video-1/final.mp4',
      title: 'HTML Story',
      artifact,
      generatedImages: [
        { sceneId: 1, path: 'D:/media/scene-1.png' },
        { sceneId: 2, path: 'D:/media/scene-2.png' },
      ],
      narrationAudio: [
        { sceneId: 1, path: 'D:/media/scene-1.wav' },
        { sceneId: 2, path: 'D:/media/scene-2.wav' },
      ],
      bgmPath: 'D:/media/bgm.wav',
      coverPath: 'D:/media/cover.png',
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });

    expect(input).toMatchObject({
      workDir: 'D:/tasks/html-video-1',
      outputPath: 'D:/tasks/html-video-1/final.mp4',
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
      bgmPath: 'D:/media/bgm.wav',
      coverPath: 'D:/media/cover.png',
      totalDurationS: 2.8,
    });
    expect(input.scenes).toHaveLength(2);
    expect(input.scenes[0]).toMatchObject({
      sceneId: 1,
      title: 'HTML Story',
      caption: 'First line',
      imagePath: 'D:/media/scene-1.png',
      audioPath: 'D:/media/scene-1.wav',
      durationMs: 1200,
      duration: 1.2,
    });
    expect(input.scenes[0].html).toContain('window.__tl');
    expect(input.scenes[0].html).toContain('window.__duration');
    expect(input.scenes[0].html).toContain('window.__ready = true');
    expect(input.scenes[0].html).toContain('scene-image');

    const runtime = runSceneRuntime(input.scenes[0].html);
    runtime.fireDomContentLoaded();
    expect(runtime.window.__ready).toBe(true);
    expect(runtime.window.__tl.seek).toEqual(expect.any(Function));

    runtime.window.__tl.seek(0.6);
    expect(runtime.document.documentElement.dataset.time).toBe('0.6');
    expect(runtime.document.documentElement.dataset.progress).toBe('0.5');
    expect(runtime.document.documentElement.style.getPropertyValue('--scene-time')).toBe('0.6s');
    expect(runtime.document.documentElement.style.getPropertyValue('--scene-progress')).toBe('0.5');
    expect(runtime.elements.frame.dataset.time).toBe('0.6');
    expect(runtime.elements.frame.dataset.progress).toBe('0.5');
    expect(runtime.elements.image.style.transform).toContain('scale(');
    expect(runtime.elements.copy.style.opacity).not.toBe('');

    runtime.window.__tl.seek(2);
    expect(runtime.document.documentElement.dataset.time).toBe('1.2');
    expect(runtime.document.documentElement.dataset.progress).toBe('1');
  });

  it('creates the recovered compose_render payload after frame capture', () => {
    const exportInput = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-2',
      outputPath: 'D:/tasks/html-video-2/final.mp4',
      title: 'HTML Story',
      artifact,
      generatedImages: [
        { sceneId: 1, path: 'D:/media/scene-1.png' },
        { sceneId: 2, path: 'D:/media/scene-2.png' },
      ],
      narrationAudio: [
        { sceneId: 1, path: 'D:/media/scene-1.wav' },
        { sceneId: 2, path: 'D:/media/scene-2.wav' },
      ],
      transition: { type: 'fade', duration: 0.3 },
      bgmTargetDb: -26,
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });
    const captured: HtmlVideoCapturedScene[] = [
      { sceneId: 1, framesDir: 'D:/tasks/html-video-2/frames-001', audioPath: 'D:/media/scene-1.wav', fps: 30 },
      { sceneId: 2, framesDir: 'D:/tasks/html-video-2/frames-002', audioPath: 'D:/media/scene-2.wav', fps: 30 },
    ];

    expect(createHtmlVideoComposePayload(exportInput, captured)).toMatchObject({
      mode: 'compose_render',
      work_dir: 'D:/tasks/html-video-2',
      scenes: [
        { frames_dir: 'D:/tasks/html-video-2/frames-001', audio_path: 'D:/media/scene-1.wav', fps: 30 },
        { frames_dir: 'D:/tasks/html-video-2/frames-002', audio_path: 'D:/media/scene-2.wav', fps: 30 },
      ],
      output_path: 'D:/tasks/html-video-2/final.mp4',
      total_duration_s: 2.8,
      bgm_target_db: -26,
      transition: { type: 'fade', duration: 0.3 },
      canvas_w: 1080,
      canvas_h: 1920,
    });
  });
});

function runSceneRuntime(html: string) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const listeners = new Map<string, Array<() => void>>();
  const elements = {
    root: createFakeElement(),
    body: createFakeElement(),
    frame: createFakeElement(),
    image: createFakeElement(),
    veil: createFakeElement(),
    copy: createFakeElement(),
  };
  const document = {
    documentElement: elements.root,
    body: elements.body,
    querySelector(selector: string) {
      const bySelector: Record<string, ReturnType<typeof createFakeElement>> = {
        '.frame': elements.frame,
        '.scene-image': elements.image,
        '.veil': elements.veil,
        '.copy': elements.copy,
      };
      return bySelector[selector] ?? null;
    },
  };
  const window = {
    addEventListener(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  };
  const context = vm.createContext({ document, window });
  for (const script of scripts) {
    vm.runInContext(script, context);
  }

  return {
    document,
    elements,
    window: window as typeof window & {
      __ready: boolean;
      __tl: { current: number; duration: number; seek(time: number): number };
    },
    fireDomContentLoaded() {
      for (const listener of listeners.get('DOMContentLoaded') ?? []) listener();
    },
  };
}

function createFakeElement() {
  const properties = new Map<string, string>();
  return {
    dataset: {} as Record<string, string>,
    style: {
      opacity: '',
      transform: '',
      setProperty(name: string, value: string) {
        properties.set(name, value);
      },
      getPropertyValue(name: string) {
        return properties.get(name) ?? '';
      },
    },
  };
}
