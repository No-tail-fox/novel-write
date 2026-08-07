import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildHtmlVideoExportInput,
  createHtmlVideoComposePayload,
  type HtmlVideoCapturedScene,
} from '@shared/html-video';
import {
  applyHtmlVideoSceneChanges,
  createHtmlVideoPipelineData,
  createHtmlVideoTaskInput,
  htmlVideoSteps,
  MAX_HTML_VIDEO_PLANNING_TEXT_CHARS,
  MAX_HTML_VIDEO_PIPELINE_FILE_BYTES,
  MAX_HTML_VIDEO_SOURCE_CHARS,
  parseHtmlVideoPipelineData,
  planHtmlVideoScenes,
  prepareHtmlVideoPipelineForRerender,
  recoverHtmlVideoPipelineDataForRetry,
  tabForHtmlVideoStep,
  validateHtmlVideoScenePlans,
} from '@shared/html-video-workflow';
import { HTML_VIDEO_SCENE_TEMPLATES, normalizeHtmlVideoSceneTemplate } from '@shared/html-video-scene-templates';
import { draftTemplates } from '@shared/templates';
import type {
  HtmlVideoAsset,
  HtmlVideoCompositionSnapshot,
  HtmlVideoScenePlan,
  HtmlVideoVoiceClip,
  PipelineArtifact,
} from '@shared/types';

const electronHarness = vi.hoisted(() => {
  type CaptureImage = { getSize(): { width: number; height: number }; toJPEG(quality: number): Buffer };
  type ScriptExecutor = (script: string) => Promise<unknown>;

  const captureImage: CaptureImage = {
    getSize: () => ({ ...state.captureSize }),
    toJPEG: () => Buffer.from('jpeg'),
  };
  const state = {
    activeWindows: 0,
    maxActiveWindows: 0,
    captureCalls: 0,
    captureSize: { width: 320, height: 568 },
    capturePlans: [] as Array<() => Promise<CaptureImage>>,
    executeScripts: [] as string[],
    scriptExecutor: null as ScriptExecutor | null,
    instances: [] as FakeBrowserWindow[],
  };

  class FakeBrowserWindow {
    private destroyed = false;
    private readonly onceListeners = new Map<string, () => void>();

    readonly webContents = {
      on: () => undefined,
      setWindowOpenHandler: () => undefined,
      setZoomFactor: () => undefined,
      executeJavaScript: (script: string) => {
        state.executeScripts.push(script);
        return state.scriptExecutor?.(script) ?? Promise.resolve(true);
      },
      capturePage: () => {
        state.captureCalls += 1;
        return state.capturePlans.shift()?.() ?? Promise.resolve(captureImage);
      },
    };

    readonly options: unknown;

    constructor(options: unknown) {
      this.options = options;
      state.instances.push(this);
      state.activeWindows += 1;
      state.maxActiveWindows = Math.max(state.maxActiveWindows, state.activeWindows);
    }

    loadURL(_url: string): Promise<void> {
      return Promise.resolve();
    }

    once(event: string, listener: () => void): void {
      this.onceListeners.set(event, listener);
    }

    show(): void {}

    isDestroyed(): boolean {
      return this.destroyed;
    }

    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      state.activeWindows -= 1;
      this.onceListeners.get('closed')?.();
    }
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    captureImage,
    state,
    reset() {
      for (const instance of state.instances) instance.destroy();
      state.activeWindows = 0;
      state.maxActiveWindows = 0;
      state.captureCalls = 0;
      state.captureSize = { width: 320, height: 568 };
      state.capturePlans.length = 0;
      state.executeScripts.length = 0;
      state.scriptExecutor = null;
      state.instances.length = 0;
    },
  };
});

vi.mock('electron', () => ({ BrowserWindow: electronHarness.BrowserWindow }));

const sidecarHarness = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../src/shared/storybound-sidecar', () => ({
  runStoryboundMediaSidecar: sidecarHarness.run,
}));

import {
  cleanupHtmlVideoFrameDirectories,
  createElectronHtmlVideoRenderer,
} from '../electron/html-video-renderer';

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

beforeEach(() => {
  electronHarness.reset();
  sidecarHarness.run.mockReset().mockResolvedValue({
    output_path: 'final.mp4',
    source_path: '_source.mp4',
  });
});
afterEach(() => electronHarness.reset());

describe('HTML video pipeline V2 contract', () => {
  it('uses six visible steps and keeps done as a terminal-only state', () => {
    expect(htmlVideoSteps.map((step) => (step as { key?: string }).key)).toEqual([
      'rewrite',
      'planning',
      'assets',
      'voice',
      'preview',
      'render',
    ]);

    const data = createHtmlVideoPipelineData('第一句。\n\n第二句。', { ratio: '9:16', style: 'modern-film' });
    expect(data).toMatchObject({
      version: 2,
      revision: 0,
      current: 'rewrite',
      warnings: [],
      config: { ratio: '9:16', style: 'modern-film' },
    });
    expect(Object.keys(data.steps)).toEqual([
      'rewrite',
      'planning',
      'assets',
      'voice',
      'preview',
      'render',
    ]);
    expect(data.steps.rewrite.status).toBe('pending');

    const taskInput = createHtmlVideoTaskInput({
      copy: '第一句。',
      ratio: '9:16',
      style: 'modern-film',
      ttsProvider: 'minimax',
      voiceId: 'female-shaonv',
      ttsSpeed: 1.15,
    });
    expect(taskInput.pipelineStep).toBe('rewrite');
    expect(taskInput).toMatchObject({
      ttsProvider: 'minimax',
      speaker: 'female-shaonv',
      ttsSpeed: 1.15,
    });
    expect(JSON.parse(taskInput.pipelineData ?? '{}')).toMatchObject({
      version: 2,
      current: 'rewrite',
      config: {
        ttsProvider: 'minimax',
        voiceId: 'female-shaonv',
        ttsSpeed: 1.15,
      },
    });
    expect(tabForHtmlVideoStep('rewrite')).toBe('text');
    expect(tabForHtmlVideoStep('planning')).toBe('text');
    expect(tabForHtmlVideoStep('preview')).toBe('preview');
    expect(tabForHtmlVideoStep('render')).toBe('output');
    expect(tabForHtmlVideoStep('done')).toBe('output');
  });

  it('preserves AI research intent when creating an HTML video task', () => {
    const selectedSources = [{
      source: 'web' as const,
      provider: 'bing' as const,
      title: '参考资料',
      content: '可核对的网页正文',
      url: 'https://example.com/reference',
    }];
    const input = createHtmlVideoTaskInput({
      copy: '根据资料生成的文案。',
      mode: 'ai',
      aiKeyword: ' 人物主题 ',
      aiSources: ['web'],
      selectedSources,
      extraRequirements: ' 500 字左右 ',
      ratio: '9:16',
      style: 'modern-film',
    });

    expect(input).toMatchObject({
      mode: 'ai',
      aiKeyword: '人物主题',
      aiSources: ['web'],
      selectedSources,
      extraRequirements: '500 字左右',
      materialSource: 'ai',
      taskType: 'html-video',
    });
  });

  it('round-trips only a valid optional full configuration snapshot hash', () => {
    const pipeline = createHtmlVideoPipelineData('配置快照哈希。');
    pipeline.configSnapshotHash = 'a'.repeat(64);
    expect(parseHtmlVideoPipelineData(JSON.stringify(pipeline)).configSnapshotHash).toBe('a'.repeat(64));
    pipeline.configSnapshotHash = 'not-a-sha256';
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(pipeline))).toThrow(/configSnapshotHash|SHA-256/i);
  });

  it('normalizes old plan snapshots without losing scenes or generated media', () => {
    const legacy = JSON.stringify({
      pipelineStep: 'plan',
      scenesPlanned: 1,
      scenesCompleted: 0,
      videoTitle: '旧任务',
      scenes: [{
        index: 1,
        narration: '必须保留的旧场景',
        title: '旧场景',
        captions: ['必须保留的旧场景'],
        sceneTemplate: 'cinematic-title',
        background: { prompt: '旧背景' },
        elements: [{ slot: 0, prompt: '旧前景' }],
      }],
      assetImages: [
        { sceneIndex: 1, kind: 'bg', slot: 0, src: 'D:/legacy/bg.png' },
        { sceneIndex: 1, kind: 'fg', slot: 0, src: 'D:/legacy/fg.png' },
      ],
      voiceClips: [{ sceneIndex: 1, src: 'D:/legacy/voice.wav', durationSec: 1.5 }],
      compositions: [],
      htmlPaths: ['D:/legacy/scene.html'],
      _cfg: { ratio: '9:16', style: 'legacy-film' },
    });

    const normalized = parseHtmlVideoPipelineData(legacy);
    expect(normalized).toMatchObject({
      version: 2,
      current: 'planning',
      scenes: [{ index: 1, narration: '必须保留的旧场景', title: '旧场景' }],
      assets: [
        { sceneIndex: 1, kind: 'bg', slot: 0, src: 'D:/legacy/bg.png' },
        { sceneIndex: 1, kind: 'fg', slot: 0, src: 'D:/legacy/fg.png' },
      ],
      voices: [{ sceneIndex: 1, src: 'D:/legacy/voice.wav', durationSec: 1.5 }],
      config: { ratio: '9:16', style: 'legacy-film' },
    });
    expect(normalized.scenes).toHaveLength(1);
    expect(normalized.scenes[0].background.prompt).toBe('旧背景');
  });

  it('rejects malformed, unsupported, and oversized pipeline JSON', () => {
    for (const value of [
      '{',
      'null',
      '[]',
      JSON.stringify({ version: 99 }),
      JSON.stringify({ version: 2, revision: 0, current: 'rewrite', warnings: [], steps: {}, scenes: 'invalid' }),
      JSON.stringify({ scenes: null, _cfg: {} }),
    ]) {
      expect(() => parseHtmlVideoPipelineData(value)).toThrow(/HTML video pipeline/i);
    }

    const oversized = JSON.stringify({ padding: 'x'.repeat(1_000_001) });
    expect(() => parseHtmlVideoPipelineData(oversized)).toThrow(/HTML video pipeline.*large/i);

    const malformedCover = JSON.parse(JSON.stringify(createHtmlVideoPipelineData('封面校验。'))) as Record<string, unknown>;
    malformedCover.output = {
      path: 'D:/output.mp4',
      sizeBytes: 1024,
      cover: { title: 42, subtitle: [], summary: '', tags: [], comments: [] },
    };
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(malformedCover))).toThrow(/HTML video pipeline.*cover/i);
  });

  it('rejects V2 and legacy pipeline configs above the shared scene limit', () => {
    const v2 = createHtmlVideoPipelineData('场景。');
    v2.config.maxScenes = 31;
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(v2))).toThrow(/maxScenes|scene.*30|maximum/i);
    expect(() => parseHtmlVideoPipelineData(JSON.stringify({
      _cfg: { maxScenes: 31 },
    }))).toThrow(/maxScenes|scene.*30|maximum/i);
  });

  it('rejects HTML pipeline source text above its dedicated size limit', async () => {
    const workflow = await import('@shared/html-video-workflow') as Record<string, unknown>;
    expect(workflow.MAX_HTML_VIDEO_SOURCE_CHARS).toBe(16_384);
    expect(() => createHtmlVideoPipelineData('x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1))).toThrow(/source|copy|16|large|long/i);
    expect(createHtmlVideoPipelineData('x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS)).scenes).toHaveLength(1);

    const worstCaseTask = createHtmlVideoTaskInput({
      copy: '\0'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS),
      ratio: '9:16',
      style: 'worst-case-json',
    });
    expect(worstCaseTask.pipelineData).toBeDefined();
    expect(worstCaseTask.pipelineData!.length)
      .toBeLessThan(workflow.MAX_HTML_VIDEO_PIPELINE_JSON_CHARS as number);

    const exactCap = createHtmlVideoPipelineData('x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS));
    expect(exactCap.scenes[0].background.prompt.length).toBeLessThanOrEqual(MAX_HTML_VIDEO_SOURCE_CHARS);
    expect(exactCap.scenes[0].elements[0].prompt.length).toBeLessThanOrEqual(MAX_HTML_VIDEO_SOURCE_CHARS);
  });

  it('rejects oversized persisted scene arrays in V2 and legacy snapshots', () => {
    const baseScene = createHtmlVideoPipelineData('场景。').scenes[0];
    const scenes = Array.from({ length: 31 }, (_, index) => ({ ...baseScene, index: index + 1 }));
    const v2 = createHtmlVideoPipelineData('场景。');
    v2.scenes = scenes;

    expect(() => parseHtmlVideoPipelineData(JSON.stringify(v2))).toThrow(/scenes|scene.*30|maximum/i);
    expect(() => parseHtmlVideoPipelineData(JSON.stringify({ scenes, _cfg: {} }))).toThrow(/scenes|scene.*30|maximum/i);
  });

  it('rejects persisted scene arrays above their configured maxScenes', () => {
    const baseScene = createHtmlVideoPipelineData('场景。').scenes[0];
    const scenes = [
      { ...baseScene, index: 1 },
      { ...baseScene, index: 2 },
    ];
    const v2 = createHtmlVideoPipelineData('场景。');
    v2.config.maxScenes = 1;
    v2.scenes = scenes;

    expect(() => parseHtmlVideoPipelineData(JSON.stringify(v2))).toThrow(/scenes|scene.*1|maximum/i);
    expect(() => parseHtmlVideoPipelineData(JSON.stringify({
      scenes,
      _cfg: { maxScenes: 1 },
    }))).toThrow(/scenes|scene.*1|maximum/i);
  });

  it('enforces contiguous V2 and legacy scene indexes and defaults missing legacy indexes by position', () => {
    const scenes = createHtmlVideoPipelineData('第一场。\n\n第二场。').scenes;
    const duplicate = createHtmlVideoPipelineData('第一场。\n\n第二场。');
    duplicate.scenes = scenes.map((scene) => ({ ...scene, index: 1 }));
    duplicate.assets = [{ sceneIndex: 1, kind: 'bg', slot: 0, src: 'D:/bg.png' }];
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(duplicate))).toThrow(/scene indexes|contiguous|index/i);

    const gap = createHtmlVideoPipelineData('第一场。\n\n第二场。');
    gap.scenes = scenes.map((scene, index) => ({ ...scene, index: index === 0 ? 1 : 3 }));
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(gap))).toThrow(/scene indexes|contiguous|index/i);

    const legacyScenes = scenes.map(({ index: _index, ...scene }) => scene);
    const legacy = parseHtmlVideoPipelineData(JSON.stringify({ scenes: legacyScenes, _cfg: { maxScenes: 2 } }));
    expect(legacy.scenes.map((scene) => scene.index)).toEqual([1, 2]);
  });

  it('rejects persisted step artifact sizes above the shared file-byte limit', async () => {
    const workflow = await import('@shared/html-video-workflow') as Record<string, unknown>;
    expect(workflow.MAX_HTML_VIDEO_PIPELINE_FILE_BYTES).toBe(4_000_000);
    const pipeline = createHtmlVideoPipelineData('场景。');
    pipeline.steps.rewrite.artifactSize = MAX_HTML_VIDEO_PIPELINE_FILE_BYTES + 1;
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(pipeline))).toThrow(/artifactSize|file|4000000|maximum/i);
  });

  it('accepts only canonical SHA-256 step artifact hashes', () => {
    const pipeline = JSON.parse(JSON.stringify(createHtmlVideoPipelineData('场景。'))) as {
      steps: Record<string, Record<string, unknown>>;
    };
    pipeline.steps.rewrite.artifactHash = 'not-a-sha256';
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(pipeline))).toThrow(/artifactHash|hash|SHA-256/i);

    pipeline.steps.rewrite.artifactHash = 'a'.repeat(64);
    expect(parseHtmlVideoPipelineData(JSON.stringify(pipeline)).steps.rewrite.artifactHash).toBe('a'.repeat(64));
  });

  it('bounds V2 and legacy artifact arrays and rejects ambiguous relationships', () => {
    const scene = createHtmlVideoPipelineData('场景。').scenes[0];
    const background: HtmlVideoAsset = { sceneIndex: 1, kind: 'bg', slot: 0, src: 'D:/bg.png' };
    const foreground: HtmlVideoAsset = { sceneIndex: 1, kind: 'fg', slot: 0, src: 'D:/fg.png' };
    const cases = [
      { key: 'assets', legacyKey: 'assetImages', value: [background, { ...background }] },
      { key: 'assets', legacyKey: 'assetImages', value: [background, { ...foreground, slot: 9 }] },
      { key: 'voices', legacyKey: 'voiceClips', value: [validVoice(2)] },
      { key: 'compositions', legacyKey: 'compositions', value: [validComposition(2)] },
    ] as const;

    for (const entry of cases) {
      const v2 = createHtmlVideoPipelineData('场景。');
      (v2 as unknown as Record<string, unknown>)[entry.key] = entry.value;
      expect(() => parseHtmlVideoPipelineData(JSON.stringify(v2))).toThrow(/asset|voice|composition|scene|slot|duplicate|complete/i);
      expect(() => parseHtmlVideoPipelineData(JSON.stringify({
        scenes: [scene],
        [entry.legacyKey]: entry.value,
        _cfg: { foreground: true },
      }))).toThrow(/asset|voice|composition|scene|slot|duplicate|complete/i);
    }

    const tooManyAssets = Array.from({ length: 6 }, (_, slot): HtmlVideoAsset => ({
      sceneIndex: 1,
      kind: slot === 0 ? 'bg' : 'fg',
      slot,
      src: `D:/asset-${slot}.png`,
    }));
    const oversized = createHtmlVideoPipelineData('场景。');
    oversized.assets = tooManyAssets;
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(oversized))).toThrow(/assets.*5|maximum/i);
  });

  it('preserves empty unfinished artifact arrays and accepts exact completed sets', () => {
    const unfinished = parseHtmlVideoPipelineData(JSON.stringify(createHtmlVideoPipelineData('场景。')));
    expect(unfinished.assets).toEqual([]);
    expect(unfinished.voices).toEqual([]);
    expect(unfinished.compositions).toEqual([]);

    const completed = createHtmlVideoPipelineData('场景。');
    completed.assets = [
      { sceneIndex: 1, kind: 'bg', slot: 0, src: 'D:/bg.png' },
      { sceneIndex: 1, kind: 'fg', slot: 0, src: 'D:/fg.png' },
    ];
    completed.voices = [validVoice(1)];
    completed.compositions = [validComposition(1)];
    expect(parseHtmlVideoPipelineData(JSON.stringify(completed))).toMatchObject({
      assets: completed.assets,
      voices: completed.voices,
      compositions: completed.compositions,
    });
  });

  it('preserves Storybound scene visibility and layout overrides', () => {
    const pipeline = createHtmlVideoPipelineData('场景。');
    pipeline.scenes[0] = {
      ...pipeline.scenes[0],
      titleHidden: true,
      foregroundHidden: true,
      hiddenElementSlots: [0],
      titleScale: 1.15,
      titleTopOverride: 9,
      captionScale: 0.9,
      captionYOverride: 82,
    };

    expect(parseHtmlVideoPipelineData(JSON.stringify(pipeline)).scenes[0]).toMatchObject({
      titleHidden: true,
      foregroundHidden: true,
      hiddenElementSlots: [0],
      titleScale: 1.15,
      titleTopOverride: 9,
      captionScale: 0.9,
      captionYOverride: 82,
    });
  });

  it('rejects invalid Storybound scene override values', () => {
    const invalidBoolean = createHtmlVideoPipelineData('场景。');
    (invalidBoolean.scenes[0] as unknown as Record<string, unknown>).titleHidden = 'yes';
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(invalidBoolean))).toThrow(/titleHidden|boolean/i);

    const duplicateSlots = createHtmlVideoPipelineData('场景。');
    duplicateSlots.scenes[0].hiddenElementSlots = [0, 0];
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(duplicateSlots))).toThrow(/hiddenElementSlots|duplicate/i);

    const invalidScale = createHtmlVideoPipelineData('场景。');
    invalidScale.scenes[0].captionScale = 4;
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(invalidScale))).toThrow(/captionScale|maximum|range/i);
  });

  it('applies bounded Storybound scene changes without clearing existing media', () => {
    const pipeline = createHtmlVideoPipelineData('场景。');
    pipeline.assets = [{ sceneIndex: 1, kind: 'bg', slot: 0, src: 'D:/bg.png' }];
    pipeline.voices = [validVoice(1)];
    pipeline.compositions = [validComposition(1)];
    const next = applyHtmlVideoSceneChanges(pipeline, 1, [
      { field: 'title', value: '新标题' },
      { field: 'captions', value: ['字幕一', '字幕二'] },
      { field: 'sceneTemplate', value: 'split-right' },
      { field: 'elementHidden', slot: 0, value: true },
    ]);

    expect(next.scenes[0]).toMatchObject({
      title: '新标题',
      captions: ['字幕一', '字幕二'],
      sceneTemplate: 'split-right',
      hiddenElementSlots: [0],
    });
    expect(next.assets).toEqual(pipeline.assets);
    expect(next.voices).toEqual(pipeline.voices);
    expect(next.compositions).toEqual(pipeline.compositions);
    expect(next.revision).toBe(pipeline.revision + 1);
  });

  it('adds the next available foreground slot and enforces the four-slot limit', () => {
    const pipeline = createHtmlVideoPipelineData('场景。');
    pipeline.scenes[0].elements = [{ slot: 1, prompt: '前景 2' }];
    const next = applyHtmlVideoSceneChanges(pipeline, 1, [{ field: 'addElement', value: '手动新增前景' }]);
    expect(next.scenes[0].elements).toEqual([
      { slot: 0, prompt: '手动新增前景' },
      { slot: 1, prompt: '前景 2' },
    ]);

    next.scenes[0].elements = Array.from({ length: 4 }, (_, slot) => ({ slot, prompt: `前景 ${slot + 1}` }));
    expect(() => applyHtmlVideoSceneChanges(next, 1, [{ field: 'addElement', value: '超出限制' }]))
      .toThrow(/最多包含 4 个前景/u);
  });

  it('publishes 29 animated scene presets and normalizes legacy ids', () => {
    expect(HTML_VIDEO_SCENE_TEMPLATES).toHaveLength(29);
    expect(new Set(HTML_VIDEO_SCENE_TEMPLATES.map((template) => template.id)).size).toBe(29);
    expect(HTML_VIDEO_SCENE_TEMPLATES.every((template) => (
      template.choreography.background.preset
      && template.choreography.caption.preset
      && template.choreography.elements.length > 0
    ))).toBe(true);
    expect(HTML_VIDEO_SCENE_TEMPLATES.find((template) => template.id === 'three-float')?.choreography.elements)
      .toMatchObject([
        { preset: 'float', startSec: 0.3 },
        { preset: 'float', startSec: 0.7 },
        { preset: 'float', startSec: 1.1 },
      ]);
    expect(normalizeHtmlVideoSceneTemplate('split-left')).toBe('right-text-left-object');
    expect(normalizeHtmlVideoSceneTemplate('unknown-template')).toBe('center-focus');
  });

  it('preserves verified foreground transparency through pipeline persistence', () => {
    const pipeline = createHtmlVideoPipelineData('场景。', { foreground: true });
    pipeline.scenes = [{
      index: 1,
      narration: '场景。',
      title: '场景',
      captions: ['场景。'],
      sceneTemplate: 'center-focus',
      background: { prompt: '背景' },
      elements: [{ slot: 0, prompt: '人物' }],
    }];
    pipeline.assets = [
      { sceneIndex: 1, kind: 'bg', slot: 0, src: 'D:/bg.png' },
      { sceneIndex: 1, kind: 'fg', slot: 0, src: 'D:/fg.png', transparency: 'transparent' },
    ];
    expect(parseHtmlVideoPipelineData(JSON.stringify(pipeline)).assets[1]?.transparency).toBe('transparent');
    pipeline.assets[1].transparency = 'unknown' as never;
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(pipeline))).toThrow(/transparency is invalid/i);
  });

  it('returns a completed composition to the render checkpoint without discarding previews', () => {
    const pipeline = createHtmlVideoPipelineData('场景。');
    pipeline.compositions = [validComposition(1)];
    pipeline.output = { path: 'D:/output.mp4', sizeBytes: 20, durationSec: 1 };
    pipeline.steps.render = { status: 'completed' };
    pipeline.current = 'done';
    const next = prepareHtmlVideoPipelineForRerender(pipeline);
    expect(next.current).toBe('render');
    expect(next.steps.render.status).toBe('pending');
    expect(next.compositions).toEqual(pipeline.compositions);
    expect(next.output).toBeUndefined();
  });

  it('bounds persisted warnings, legacy paths, cover lists, composition captions, and caption colors', () => {
    const pipeline = createHtmlVideoPipelineData('场景。');
    pipeline.warnings = Array.from({ length: 65 }, () => 'warning');
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(pipeline))).toThrow(/warnings.*64|maximum/i);

    expect(() => parseHtmlVideoPipelineData(JSON.stringify({
      scenes: [],
      htmlPaths: Array.from({ length: 31 }, (_, index) => `D:/scene-${index}.html`),
      _cfg: {},
    }))).toThrow(/htmlPaths.*30|maximum/i);
    expect(() => parseHtmlVideoPipelineData(JSON.stringify({
      scenes: [],
      htmlPaths: ['x'.repeat(4097)],
      _cfg: {},
    }))).toThrow(/htmlPaths|4096|characters/i);

    const withCover = createHtmlVideoPipelineData('场景。');
    withCover.output = {
      path: 'D:/output.mp4',
      sizeBytes: 1,
      cover: {
        title: 'title',
        subtitle: Array.from({ length: 33 }, () => 'subtitle'),
        summary: 'summary',
        tags: [],
        comments: [],
      },
    };
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(withCover))).toThrow(/cover\.subtitle.*32|maximum/i);

    const withCaptions = createHtmlVideoPipelineData('场景。');
    const composition = validComposition(1);
    composition.captions = Array.from({ length: 33 }, (_, index) => ({
      id: String(index),
      text: 'caption',
      startSec: 0,
      durationSec: 1,
    }));
    withCaptions.compositions = [composition];
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(withCaptions))).toThrow(/captions.*32|maximum/i);

    const withColors = createHtmlVideoPipelineData('场景。');
    withColors.config.captionColors = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`color-${index}`, '#fff']));
    expect(() => parseHtmlVideoPipelineData(JSON.stringify(withColors))).toThrow(/captionColors.*32|maximum/i);
  });

  it('rejects V2 and legacy scenes above the shared element limit', async () => {
    const workflow = await import('@shared/html-video-workflow') as Record<string, unknown>;
    expect(workflow.MAX_HTML_VIDEO_ELEMENTS_PER_SCENE).toBe(4);
    const baseScene = createHtmlVideoPipelineData('场景。').scenes[0];
    const elements = Array.from({ length: 5 }, (_, slot) => ({ slot, prompt: `前景 ${slot}` }));
    const scene = { ...baseScene, elements };
    const v2 = createHtmlVideoPipelineData('场景。');
    v2.scenes = [scene];

    expect(() => parseHtmlVideoPipelineData(JSON.stringify(v2))).toThrow(/elements|element.*4|maximum/i);
    expect(() => parseHtmlVideoPipelineData(JSON.stringify({ scenes: [scene], _cfg: {} })))
      .toThrow(/elements|element.*4|maximum/i);
  });

  it('rejects V2 and legacy scenes above the shared caption limit', async () => {
    const workflow = await import('@shared/html-video-workflow') as Record<string, unknown>;
    expect(workflow.MAX_HTML_VIDEO_CAPTIONS_PER_SCENE).toBe(32);
    const baseScene = createHtmlVideoPipelineData('场景。').scenes[0];
    const scene = { ...baseScene, captions: Array.from({ length: 33 }, () => '') };
    const v2 = createHtmlVideoPipelineData('场景。');
    v2.scenes = [scene];

    expect(() => parseHtmlVideoPipelineData(JSON.stringify(v2))).toThrow(/captions|caption.*32|maximum/i);
    expect(() => parseHtmlVideoPipelineData(JSON.stringify({ scenes: [scene], _cfg: {} })))
      .toThrow(/captions|caption.*32|maximum/i);
  });

  it('rejects oversized runtime captions before reading their items', () => {
    const scene = structuredClone(createHtmlVideoPipelineData('场景。').scenes[0]);
    let captionAccessed = false;
    const captions = new Array<string>(33);
    Object.defineProperty(captions, 0, {
      get() {
        captionAccessed = true;
        throw new Error('caption was accessed');
      },
    });
    scene.captions = captions;

    expect(() => validateHtmlVideoScenePlans([scene])).toThrow(/captions|caption.*32|maximum/i);
    expect(captionAccessed).toBe(false);
  });

  it.each([
    ['narration', (scene: HtmlVideoScenePlan, text: string) => { scene.narration = text; }],
    ['title', (scene: HtmlVideoScenePlan, text: string) => { scene.title = text; }],
    ['caption', (scene: HtmlVideoScenePlan, text: string) => { scene.captions = [text]; }],
    ['sceneTemplate', (scene: HtmlVideoScenePlan, text: string) => { scene.sceneTemplate = text; }],
    ['background prompt', (scene: HtmlVideoScenePlan, text: string) => { scene.background.prompt = text; }],
    ['element prompt', (scene: HtmlVideoScenePlan, text: string) => { scene.elements[0].prompt = text; }],
  ] as const)('rejects a planning %s above the shared text limit', (_field, mutate) => {
    const scene = structuredClone(createHtmlVideoPipelineData('场景。').scenes[0]);
    mutate(scene, 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1));

    expect(() => validateHtmlVideoScenePlans([scene])).toThrow(/text|characters|length|large|32/i);
  });

  it('rejects aggregate planning text above the shared budget', async () => {
    const workflow = await import('@shared/html-video-workflow') as Record<string, unknown>;
    expect(workflow.MAX_HTML_VIDEO_PLANNING_TEXT_CHARS).toBe(69_632);
    expect(MAX_HTML_VIDEO_PLANNING_TEXT_CHARS).toBe(4 * MAX_HTML_VIDEO_SOURCE_CHARS + 4096);
    const text = 'x'.repeat(15_000);
    const scene = structuredClone(createHtmlVideoPipelineData('场景。').scenes[0]);
    scene.narration = text;
    scene.title = text;
    scene.captions = [text];
    scene.background.prompt = text;
    scene.elements[0].prompt = text;

    expect(() => validateHtmlVideoScenePlans([scene])).toThrow(/planning|text|budget|large|69/i);
  });

  it('bounds legacy deterministic captions and merges the remaining text without loss', () => {
    const narration = 'a;'.repeat(100);
    const parsed = parseHtmlVideoPipelineData(JSON.stringify({
      scenes: [{ index: 1, narration, title: '字幕尾段' }],
      _cfg: { maxScenes: 1 },
    }));

    expect(parsed.scenes[0].captions).toHaveLength(32);
    expect(parsed.scenes[0].captions.join('')).toBe(narration);
  });

  it('rejects deterministic planner limits before splitting the source copy', () => {
    let splitCalls = 0;
    const splitTrap = {
      split() {
        splitCalls += 1;
        throw new Error('source copy was split');
      },
    } as unknown as string;

    expect(() => planHtmlVideoScenes(splitTrap, 31)).toThrow(/maxScenes|scene.*30|maximum/i);
    expect(splitCalls).toBe(0);
    expect(() => planHtmlVideoScenes('x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1), 1))
      .toThrow(/source|copy|16|characters|maximum/i);
  });

  it('does not materialize an unbounded split array for delimiter-heavy copy', () => {
    let unboundedSplitCalled = false;
    const copyText = Array.from({ length: 100 }, (_, index) => `场景 ${index + 1}。`).join('\n\n');
    const copy = {
      length: copyText.length,
      slice(start?: number, end?: number) {
        return copyText.slice(start, end);
      },
      split(separator: string | RegExp, limit?: number) {
        if (limit === undefined) {
          unboundedSplitCalled = true;
          throw new Error('unbounded source split');
        }
        return copyText.split(separator, limit);
      },
      [Symbol.toPrimitive]() {
        return copyText;
      },
    };

    expect(planHtmlVideoScenes(copy as unknown as string, 30)).toHaveLength(30);
    expect(unboundedSplitCalled).toBe(false);
  });

  it('rejects oversized runtime scene arrays before parsing their items', () => {
    let sceneItemAccessed = false;
    const untouchedScene = new Proxy({}, {
      get() {
        sceneItemAccessed = true;
        throw new Error('scene item was accessed');
      },
    });

    expect(() => validateHtmlVideoScenePlans(Array.from({ length: 31 }, () => untouchedScene)))
      .toThrow(/scenes|scene.*30|maximum/i);
    expect(sceneItemAccessed).toBe(false);
  });

  it('rebuilds invalid persisted snapshots from recoverable task configuration before retry', async () => {
    const workflow = await import('@shared/html-video-workflow') as Record<string, unknown>;
    const recover = workflow.recoverHtmlVideoPipelineDataForRetry;
    expect(recover).toBeTypeOf('function');
    if (typeof recover !== 'function') return;

    const task = {
      inputText: '第一句。\n\n第二句。',
      ratio: '1:1',
      style: 'paper-cut',
      ttsProvider: 'minimax',
      speaker: 'female-shaonv',
      ttsSpeed: 1.2,
      bgmId: 'bgm-recovery',
      targetScenes: 2,
      storyboardSceneCount: undefined,
      coverImageMode: 'titled',
      coverTemplateId: 'cinematic-poster',
    };
    const invalidSnapshots = [
      '{',
      JSON.stringify({ version: 99 }),
      JSON.stringify({ padding: 'x'.repeat(1_000_001) }),
    ];

    for (const pipelineData of invalidSnapshots) {
      const patch = (recover as (input: typeof task & { pipelineData?: string }) => {
        pipelineData: string;
        pipelineStep: string;
        currentStep: number;
        failedStep: number | null;
        retryFromStep: number | null;
      } | null)({ ...task, pipelineData });
      expect(patch).toMatchObject({
        pipelineStep: 'rewrite',
        currentStep: 0,
        failedStep: null,
        retryFromStep: null,
      });
      expect(parseHtmlVideoPipelineData(patch?.pipelineData)).toMatchObject({
        version: 2,
        current: 'rewrite',
        warnings: [
          expect.stringMatching(/损坏.*重建/u),
          expect.stringMatching(/配置恢复.*默认值.*transitionType.*coverRatio/u),
          expect.stringMatching(/无法从任务镜像恢复.*captionPreset.*draftTemplate/u),
        ],
        scenes: [{ index: 1 }, { index: 2 }],
        config: {
          ratio: '1:1',
          style: 'paper-cut',
          ttsProvider: 'minimax',
          voiceId: 'female-shaonv',
          ttsSpeed: 1.2,
          bgmId: 'bgm-recovery',
          maxScenes: 2,
          coverImageMode: 'auto',
          coverTemplate: 'cinematic-poster',
        },
      });
    }

    const valid = JSON.stringify(createHtmlVideoPipelineData('有效快照。'));
    expect((recover as (input: typeof task & { pipelineData?: string }) => unknown)({
      ...task,
      pipelineData: valid,
    })).toBeNull();

    const oversizedRecovery = (recover as (input: typeof task & { pipelineData?: string }) => {
      pipelineData: string;
    } | null)({
      ...task,
      inputText: Array.from({ length: 31 }, (_, index) => `第 ${index + 1} 个场景。`).join('\n\n'),
      pipelineData: '{',
      targetScenes: 31,
    });
    const recovered = parseHtmlVideoPipelineData(oversizedRecovery?.pipelineData);
    expect(recovered.config.maxScenes).toBe(30);
    expect(recovered.scenes).toHaveLength(30);
    expect(recovered.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/30|上限/u)]));
  });

  it('rejects an oversized retry recovery source with a stable actionable error', () => {
    expect(() => recoverHtmlVideoPipelineDataForRetry({
      inputText: 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1),
      pipelineData: '{',
      ratio: '9:16',
      style: 'legacy',
      ttsProvider: 'mock',
      speaker: 'voice',
      ttsSpeed: 1,
      bgmId: '',
      targetScenes: 1,
      storyboardSceneCount: 1,
      coverImageMode: 'titled',
      coverTemplateId: 'cinematic-poster',
      htmlVideoForeground: true,
    })).toThrow(expect.objectContaining({ code: 'HTML_VIDEO_SOURCE_TOO_LARGE' }));

    expect(() => recoverHtmlVideoPipelineDataForRetry({
      inputText: 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1),
      pipelineData: JSON.stringify(createHtmlVideoPipelineData('有效快照。')),
      ratio: '9:16',
      style: 'legacy',
      ttsProvider: 'mock',
      speaker: 'voice',
      ttsSpeed: 1,
      bgmId: '',
      targetScenes: 1,
      storyboardSceneCount: 1,
      coverImageMode: 'titled',
      coverTemplateId: 'cinematic-poster',
      htmlVideoForeground: true,
    })).toThrow(expect.objectContaining({ code: 'HTML_VIDEO_SOURCE_TOO_LARGE' }));
  });
});

function validVoice(sceneIndex: number): HtmlVideoVoiceClip {
  return { sceneIndex, src: `D:/voice-${sceneIndex}.wav`, durationSec: 1, text: `场景 ${sceneIndex}` };
}

function validComposition(index: number): HtmlVideoCompositionSnapshot {
  return {
    index,
    durationSec: 1,
    canvas: { w: 320, h: 568 },
    audio: { src: `D:/voice-${index}.wav`, durationSec: 1 },
    background: { src: `D:/bg-${index}.png` },
    captions: [{ id: `${index}-0`, text: `场景 ${index}`, startSec: 0, durationSec: 1 }],
    htmlPath: `D:/scene-${index}.html`,
  };
}

describe('HTML video composition contract', () => {
  it('compiles scene-template choreography into the shared GSAP timeline', () => {
    const scenePlans: HtmlVideoScenePlan[] = artifact.scenes.map((scene) => ({
      index: scene.id,
      narration: scene.cap,
      title: '动态标题',
      captions: [scene.cap],
      sceneTemplate: scene.id === 1 ? 'three-float' : 'center-focus',
      background: { prompt: scene.descPrompt },
      elements: scene.id === 1
        ? [0, 1, 2].map((slot) => ({ slot, prompt: `前景 ${slot + 1}` }))
        : [],
    }));
    const input = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-choreography',
      outputPath: 'D:/tasks/html-video-choreography/final.mp4',
      title: '动态版式',
      artifact,
      scenePlans,
      generatedImages: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/${scene.id}.png` })),
      foregroundImages: [0, 1, 2].map((slot) => ({ sceneId: 1, path: `D:/media/1-fg-${slot}.png`, slot })),
      narrationAudio: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/${scene.id}.wav` })),
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });

    const html = input.scenes[0].html;
    expect(html).toContain('id="scene-title"');
    expect(html).toContain('data-template-background-motion="kenburns"');
    expect(html).toContain('storydream-render=1');
    expect(html).toContain("applySceneAnimation('#foreground-1', 'float', 0.3");
    expect(html).toContain("applySceneAnimation('#foreground-2', 'float', 0.7");
    expect(html).toContain("applySceneAnimation('#foreground-3', 'float', 1.1");
    expect(html).toContain('id="scene-captions"');
    expect(html).toContain("applySceneAnimation('#scene-captions', 'rise-caption'");
  });

  it('encodes fragment characters in local scene asset file URLs', () => {
    const imagePath = join(tmpdir(), 'storydream # team', 'scene image.png');
    const audioPath = join(tmpdir(), 'storydream # team', 'scene voice.wav');
    const input = buildHtmlVideoExportInput({
      workDir: join(tmpdir(), 'storydream-html-special-path'),
      outputPath: join(tmpdir(), 'storydream-html-special-path', 'final.mp4'),
      title: 'Special path story',
      artifact,
      generatedImages: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: imagePath })),
      narrationAudio: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: audioPath })),
      fps: 1,
      canvas_w: 320,
      canvas_h: 568,
    });

    expect(input.scenes[0].html).toContain(`src="${pathToFileURL(imagePath).toString()}"`);
    expect(input.scenes[0].html).toContain(`src="${pathToFileURL(audioPath).toString()}"`);
  });

  it('bounds hidden renderer readiness and frame capture and always destroys the window', async () => {
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');

    expect(renderer).toContain('hiddenWindowReadyTimeoutMs');
    expect(renderer).toContain('hiddenFrameTimeoutMs');
    expect(renderer).toContain('withRendererTimeout');
    expect(renderer).toContain('?storydream-render=1');
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
      foregroundImages: [
        { sceneId: 1, path: 'D:/media/scene-1-fg.png' },
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
    expect(input.scenes[0].html).toContain('scene-foreground');
    expect(input.scenes[0].html).toContain('scene-1-fg.png');

    const runtime = runSceneRuntime(input.scenes[0].html);
    expect(runtime.timeline.options).toEqual({ paused: true });
    expect(runtime.timeline.fromToCalls.map(([selector]) => selector)).toEqual(expect.arrayContaining([
      '#scene-background',
      '#scene-veil',
      '#scene-title',
      '#foreground-1',
      '#scene-captions',
    ]));
    expect(runtime.window.__timelines['storydream-scene-1']).toBe(runtime.timeline);
    runtime.fireDomContentLoaded();
    expect(runtime.window.__ready).toBe(true);
    expect(runtime.window.__tl.seek).toEqual(expect.any(Function));
    expect(runtime.timeline.seekCalls).toEqual([0]);
    expect(runtime.timeline.pauseCalls).toBe(1);
    expect(runtime.postedMessages).toEqual([
      expect.objectContaining({
        type: 'storydream:hyperframes-runtime-ready',
        compositionId: 'storydream-scene-1',
        hasGsap: true,
        compositionReady: true,
        timelineKeys: ['storydream-scene-1'],
        timelineDuration: 1.2,
        backgroundReady: true,
        mediaReferences: [],
      }),
      expect.objectContaining({
        source: 'hf-preview',
        type: 'ready',
        protocolVersion: 1,
      }),
      expect.objectContaining({
        source: 'hf-preview',
        type: 'timeline',
        protocolVersion: 1,
        durationInFrames: 36,
        durationSeconds: 1.2,
        compositionWidth: 1080,
        compositionHeight: 1920,
        scenes: [{ id: 'storydream-scene-1', start: 0, duration: 1.2 }],
      }),
    ]);
  });

  it('uses Storybound scene plans for timed captions, visibility and iframe transport', () => {
    const scenePlans: HtmlVideoScenePlan[] = artifact.scenes.map((scene, index) => ({
      index: scene.id,
      narration: scene.cap,
      title: index === 0 ? '场景标题' : '第二场景',
      titleHidden: index === 0,
      captions: index === 0 ? ['第一条字幕', '第二条字幕'] : [scene.cap],
      sceneTemplate: index === 0 ? 'split-left' : 'center-focus',
      foregroundHidden: index === 0,
      hiddenElementSlots: [],
      titleScale: 1.1,
      titleTopOverride: 12,
      captionScale: 0.9,
      captionYOverride: 84,
      background: { prompt: scene.descPrompt },
      elements: index === 0 ? [{ slot: 0, prompt: '透明前景' }] : [],
    }));
    const input = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-storybound',
      outputPath: 'D:/tasks/html-video-storybound/final.mp4',
      title: '任务标题',
      artifact,
      scenePlans,
      generatedImages: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/${scene.id}.png` })),
      foregroundImages: [{ sceneId: 1, path: 'D:/media/1-fg.png', slot: 0 }],
      narrationAudio: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/${scene.id}.wav` })),
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });

    const html = input.scenes[0].html;
    expect(input.scenes[0]).toMatchObject({ title: '场景标题', captions: ['第一条字幕', '第二条字幕'] });
    expect(html).not.toContain('class="title">场景标题</div>');
    expect(html).not.toContain('1-fg.png');
    expect(html).toContain('data-scene-template="right-text-left-object"');
    expect(html).toContain('第一条字幕');
    expect(html).toContain('第二条字幕');
    expect(html).toContain('type: \'hvtick\'');
    expect(html).toContain("message.type === 'hvplay'");
    expect(html).toContain("message.type === 'hvpause'");
    expect(html).toContain("message.type === 'hvseek'");
    expect(html).toContain("message.type === 'hvrestart'");
    expect(html).toContain('fitScene');
    expect(html).toContain('measureText');
  });

  it('applies draft frame layout and camera motion to generated HyperFrames scenes', () => {
    const template = structuredClone(draftTemplates[1]);
    template.image.motion = 'zoom_pan_up';
    template.image.motionStrength = 1.5;
    template.frame = {
      enabled: true,
      headerColor: '#112233',
      headerColorEnd: '#334455',
      footerColor: '#556677',
      footerColorEnd: '#778899',
      imageBorderColor: '#abcdef',
      imageBorderWidth: 16,
      imageBorderSides: 'horizontal',
    };
    const input = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-template',
      outputPath: 'D:/tasks/html-video-template/final.mp4',
      title: 'Template motion story',
      artifact,
      generatedImages: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.png` })),
      narrationAudio: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.wav` })),
      draftTemplate: template,
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });

    const html = input.scenes[0].html;
    expect(html).toContain('data-draft-motion="zoom_pan_up"');
    expect(html).toContain('data-draft-frame="true"');
    expect(html).toContain('top: 28.9063%');
    expect(html).toContain('height: 42.1875%');
    expect(html).toContain('linear-gradient(90deg, #112233, #334455)');
    expect(html).toContain('linear-gradient(90deg, #556677, #778899)');
    expect(html).toContain('border-top: 16px solid #abcdef');
    expect(html).toContain('border-bottom: 16px solid #abcdef');
    const runtime = runSceneRuntime(html);
    expect(runtime.timeline.fromToCalls).toContainEqual([
      '#scene-background',
      { scale: 1, yPercent: 6 },
      { scale: 1.12, yPercent: -6, duration: 1.2, ease: 'none' },
      0,
    ]);

    const stoppedTemplate = structuredClone(template);
    stoppedTemplate.image.motionStrength = 0;
    const stoppedInput = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-template-stopped',
      outputPath: 'D:/tasks/html-video-template-stopped/final.mp4',
      title: 'Stopped template motion story',
      artifact,
      generatedImages: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.png` })),
      narrationAudio: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.wav` })),
      draftTemplate: stoppedTemplate,
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });
    const stoppedRuntime = runSceneRuntime(stoppedInput.scenes[0].html);
    expect(stoppedRuntime.timeline.fromToCalls.filter((call) => call[0] === '#scene-background')).toEqual([]);

    const overrideInput = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-template-override',
      outputPath: 'D:/tasks/html-video-template-override/final.mp4',
      title: 'Overridden template motion story',
      artifact,
      generatedImages: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.png` })),
      narrationAudio: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.wav` })),
      draftTemplate: template,
      sceneMotion: 'pan_right',
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });
    expect(overrideInput.scenes[0].html).toContain('data-draft-motion="pan_right"');
    expect(runSceneRuntime(overrideInput.scenes[0].html).timeline.fromToCalls).toContainEqual([
      '#scene-background',
      { scale: 1.08, xPercent: -4 },
      { scale: 1.08, xPercent: 4, duration: 1.2, ease: 'none' },
      0,
    ]);

    const disabledInput = buildHtmlVideoExportInput({
      workDir: 'D:/tasks/html-video-template-disabled',
      outputPath: 'D:/tasks/html-video-template-disabled/final.mp4',
      title: 'Disabled template motion story',
      artifact,
      generatedImages: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.png` })),
      narrationAudio: artifact.scenes.map((scene) => ({ sceneId: scene.id, path: `D:/media/scene-${scene.id}.wav` })),
      draftTemplate: template,
      sceneMotion: 'none',
      fps: 30,
      canvas_w: 1080,
      canvas_h: 1920,
    });
    expect(disabledInput.scenes[0].html).toContain('data-draft-motion="none"');
    expect(runSceneRuntime(disabledInput.scenes[0].html).timeline.fromToCalls.filter((call) => call[0] === '#scene-background')).toEqual([]);
  });

  it('delegates playback to the registered HyperFrames GSAP timeline', () => {
    const html = buildRuntimeSceneHtml();
    const runtime = runSceneRuntime(html);
    runtime.fireDomContentLoaded();

    expect(html).toContain('scene-audio');
    expect(html).toContain('src="./hyperframe.runtime.gsap.iife.js"');
    expect(html).not.toContain('requestAnimationFrame');
    expect(html).toContain("tl.eventCallback('onUpdate', postTick)");
    expect(html).toContain("tl.eventCallback('onComplete', postTick)");
    expect(html).toContain("message.type === 'hvplay'");
    runtime.window.__tl.play();
    runtime.window.__tl.seek(0.3, false);
    runtime.window.__tl.pause();
    expect(runtime.timeline.playCalls).toBe(1);
    expect(runtime.timeline.seekCalls).toEqual([0, 0.3]);
    expect(runtime.timeline.pauseCalls).toBe(2);
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

  it('propagates cancellation through preview capture and compose rendering', async () => {
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');

    expect(renderer).toContain('signal?: AbortSignal');
    expect(renderer).toContain('throwIfAborted');
    expect(renderer).toContain('capturePreview');
    expect(renderer).toContain('openPreview');
    expect(renderer).toMatch(/runStoryboundMediaSidecar\(payload,\s*\{\s*signal\s*\}\)/);
    expect(renderer).toContain('rm(framesDir, { recursive: true, force: true })');
  });
});

describe('Electron HTML video capture contract', () => {
  it('uses an offscreen surface for hidden full-canvas capture', async () => {
    await withRendererTestDir(async (workDir) => {
      electronHarness.state.scriptExecutor = createReadyScriptExecutor([]);

      await createElectronHtmlVideoRenderer().capturePreview(previewInput(workDir, 'offscreen'));

      expect(electronHarness.state.instances[0]?.options).toMatchObject({
        show: false,
        width: 320,
        height: 568,
        useContentSize: true,
        webPreferences: { offscreen: true },
      });
    });
  });

  it('rejects a screen-clamped capture before sending cropped frames to the sidecar', async () => {
    await withRendererTestDir(async (workDir) => {
      electronHarness.state.scriptExecutor = createReadyScriptExecutor([]);
      electronHarness.state.captureSize = { width: 320, height: 417 };

      await expect(createElectronHtmlVideoRenderer().render(rendererInput(workDir)))
        .rejects.toMatchObject({ code: 'HTML_VIDEO_CAPTURE_SIZE_MISMATCH' });
      expect(sidecarHarness.run).not.toHaveBeenCalled();
      await expectFrameDirectoriesMissing(workDir, [1]);
    });
  });

  it('removes all captured frame directories after a successful render', async () => {
    await withRendererTestDir(async (workDir) => {
      electronHarness.state.scriptExecutor = createReadyScriptExecutor([]);

      await expect(createElectronHtmlVideoRenderer().render(rendererInput(workDir))).resolves.toMatchObject({
        outputPath: 'final.mp4',
        sourceVideoPath: '_source.mp4',
      });
      await expectFrameDirectoriesMissing(workDir, [1, 2]);
    });
  });

  it('removes captured frame directories when compose rendering fails', async () => {
    await withRendererTestDir(async (workDir) => {
      electronHarness.state.scriptExecutor = createReadyScriptExecutor([]);
      const failure = new Error('compose failed');
      sidecarHarness.run.mockRejectedValueOnce(failure);

      const pending = createElectronHtmlVideoRenderer().render(rendererInput(workDir));

      await expect(pending).rejects.toBe(failure);
      await expectFrameDirectoriesMissing(workDir, [1, 2]);
    });
  });

  it('removes captured frame directories when capture is cancelled', async () => {
    await withRendererTestDir(async (workDir) => {
      electronHarness.state.scriptExecutor = createReadyScriptExecutor([]);
      const capture = deferred<typeof electronHarness.captureImage>();
      electronHarness.state.capturePlans.push(() => capture.promise);
      const controller = new AbortController();
      const reason = new DOMException('cancel render', 'AbortError');
      const pending = createElectronHtmlVideoRenderer().render(
        rendererInput(workDir),
        { signal: controller.signal },
      );
      await waitFor(() => electronHarness.state.captureCalls === 1);

      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      capture.resolve(electronHarness.captureImage);
      await expectFrameDirectoriesMissing(workDir, [1]);
    });
  });

  it('removes captured frame directories when a scene capture fails', async () => {
    await withRendererTestDir(async (workDir) => {
      electronHarness.state.scriptExecutor = createReadyScriptExecutor([]);
      const failure = new Error('scene capture failed');
      electronHarness.state.capturePlans.push(() => Promise.reject(failure));

      const pending = createElectronHtmlVideoRenderer().render(rendererInput(workDir));

      await expect(pending).rejects.toBe(failure);
      await expectFrameDirectoriesMissing(workDir, [1]);
    });
  });

  it('keeps the primary render error first when frame cleanup also fails', async () => {
    const primaryError = new Error('render failed');
    const firstCleanupError = new Error('cleanup one failed');
    const secondCleanupError = new Error('cleanup two failed');

    const error: unknown = await cleanupHtmlVideoFrameDirectories(
      ['frames-001', 'frames-002'],
      { error: primaryError },
      async (path) => {
        throw path.endsWith('001') ? firstCleanupError : secondCleanupError;
      },
    ).then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      primaryError,
      firstCleanupError,
      secondCleanupError,
    ]);
  });

  it('serializes hidden capture across renderer instances', async () => {
    await withRendererTestDir(async (workDir) => {
      const firstCapture = deferred<typeof electronHarness.captureImage>();
      electronHarness.state.capturePlans.push(
        () => firstCapture.promise,
        () => Promise.resolve(electronHarness.captureImage),
      );
      const first = createElectronHtmlVideoRenderer().capturePreview(previewInput(workDir, 'first'));
      await waitFor(() => electronHarness.state.captureCalls === 1);
      const second = createElectronHtmlVideoRenderer().capturePreview(previewInput(workDir, 'second'));
      await nextTurn();

      expect(electronHarness.state.captureCalls).toBe(1);
      expect(electronHarness.state.maxActiveWindows).toBe(1);
      firstCapture.resolve(electronHarness.captureImage);

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(electronHarness.state.captureCalls).toBe(2);
      expect(electronHarness.state.maxActiveWindows).toBe(1);
    });
  });

  it('removes an aborted capture waiter without entering or blocking the next capture', async () => {
    await withRendererTestDir(async (workDir) => {
      const firstCapture = deferred<typeof electronHarness.captureImage>();
      electronHarness.state.capturePlans.push(
        () => firstCapture.promise,
        () => Promise.resolve(electronHarness.captureImage),
      );
      const renderer = createElectronHtmlVideoRenderer();
      const first = renderer.capturePreview(previewInput(workDir, 'first'));
      await waitFor(() => electronHarness.state.captureCalls === 1);

      const controller = new AbortController();
      const abortListener = vi.spyOn(controller.signal, 'addEventListener');
      const cancelled = createElectronHtmlVideoRenderer().capturePreview(
        previewInput(workDir, 'cancelled', controller.signal),
      );
      await waitFor(() => abortListener.mock.calls.some(([event]) => event === 'abort'));
      const third = createElectronHtmlVideoRenderer().capturePreview(previewInput(workDir, 'third'));
      controller.abort(new DOMException('cancelled while waiting', 'AbortError'));

      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      expect(electronHarness.state.captureCalls).toBe(1);
      firstCapture.resolve(electronHarness.captureImage);
      await expect(Promise.all([first, third])).resolves.toHaveLength(2);
      expect(electronHarness.state.captureCalls).toBe(2);
      expect(electronHarness.state.instances).toHaveLength(2);
      expect(electronHarness.state.maxActiveWindows).toBe(1);
    });
  });

  it('releases the capture lock after a capture failure', async () => {
    await withRendererTestDir(async (workDir) => {
      const failedCapture = deferred<typeof electronHarness.captureImage>();
      electronHarness.state.capturePlans.push(
        () => failedCapture.promise,
        () => Promise.resolve(electronHarness.captureImage),
      );
      const first = createElectronHtmlVideoRenderer().capturePreview(previewInput(workDir, 'failed'));
      await waitFor(() => electronHarness.state.captureCalls === 1);
      const second = createElectronHtmlVideoRenderer().capturePreview(previewInput(workDir, 'next'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(electronHarness.state.captureCalls).toBe(1);
      const firstFailure = expect(first).rejects.toThrow('capture failed');
      failedCapture.reject(new Error('capture failed'));

      await firstFailure;
      await expect(second).resolves.toContain('next.jpg');
      expect(electronHarness.state.captureCalls).toBe(2);
      expect(electronHarness.state.maxActiveWindows).toBe(1);
    });
  });

  it('starts the generated timeline after opening a visible preview', async () => {
    await withRendererTestDir(async (workDir) => {
      await createElectronHtmlVideoRenderer().openPreview({
        workDir,
        htmlPath: join(workDir, 'scene.html'),
        canvas: { width: 320, height: 568 },
      });

      expect(electronHarness.state.executeScripts).toEqual(
        expect.arrayContaining([expect.stringContaining('window.__tl.play()')]),
      );
    });
  });

  it.each([
    {
      label: 'already complete with no decoded width',
      image: { complete: true, naturalWidth: 0, addEventListener: () => undefined },
    },
    {
      label: 'emits an image error while loading',
      image: {
        complete: false,
        naturalWidth: 0,
        addEventListener(event: string, listener: () => void) {
          if (event === 'error') queueMicrotask(listener);
        },
      },
    },
  ])('rejects a scene whose image $label and destroys its window', async ({ image }) => {
    await withRendererTestDir(async (workDir) => {
      electronHarness.state.scriptExecutor = createReadyScriptExecutor([image]);
      const error = await createElectronHtmlVideoRenderer()
        .capturePreview(previewInput(workDir, 'broken'))
        .then(() => null, (reason: unknown) => reason);

      expect(String(error)).toBe(
        'Error: HTML scene image failed to load. Verify the task image assets and retry.',
      );
      expect(String(error)).not.toContain(workDir);
      expect(electronHarness.state.instances.every((window) => window.isDestroyed())).toBe(true);
    });
  });
});

function runSceneRuntime(html: string) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const listeners = new Map<string, Array<() => void>>();
  const postedMessages: unknown[] = [];
  const timeline = {
    options: null as { paused: boolean } | null,
    fromToCalls: [] as unknown[][],
    setCalls: [] as unknown[][],
    seekCalls: [] as number[],
    playCalls: 0,
    pauseCalls: 0,
    fromTo(...args: unknown[]) {
      this.fromToCalls.push(args);
      return this;
    },
    set(...args: unknown[]) {
      this.setCalls.push(args);
      return this;
    },
    seek(time: number, _suppressEvents?: boolean) {
      this.seekCalls.push(time);
      return this;
    },
    play() {
      this.playCalls += 1;
      return this;
    },
    pause() {
      this.pauseCalls += 1;
      return this;
    },
    duration() {
      return Number(this.setCalls.at(-1)?.[2] ?? 0);
    },
  };
  const gsap = {
    timeline(options: { paused: boolean }) {
      timeline.options = options;
      return timeline;
    },
  };
  const window = {
    __timelines: {} as Record<string, typeof timeline>,
    gsap,
    parent: {
      postMessage(message: unknown) {
        postedMessages.push(message);
      },
    },
    addEventListener(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  };
  const context = vm.createContext({
    gsap,
    matchMedia: () => ({ matches: false }),
    window,
  });
  for (const script of scripts) {
    vm.runInContext(script, context);
  }

  return {
    timeline,
    postedMessages,
    window: window as typeof window & {
      __ready: boolean;
      __tl: typeof timeline;
    },
    fireDomContentLoaded() {
      for (const listener of listeners.get('DOMContentLoaded') ?? []) listener();
    },
  };
}

function buildRuntimeSceneHtml(): string {
  return buildHtmlVideoExportInput({
    workDir: 'D:/tasks/html-video-runtime',
    outputPath: 'D:/tasks/html-video-runtime/final.mp4',
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
    fps: 30,
    canvas_w: 1080,
    canvas_h: 1920,
  }).scenes[0].html;
}

function rendererInput(workDir: string) {
  return buildHtmlVideoExportInput({
    workDir,
    outputPath: join(workDir, 'final.mp4'),
    title: 'Renderer cleanup test',
    artifact,
    generatedImages: [
      { sceneId: 1, path: join(workDir, 'scene-1.png') },
      { sceneId: 2, path: join(workDir, 'scene-2.png') },
    ],
    narrationAudio: [
      { sceneId: 1, path: join(workDir, 'scene-1.wav') },
      { sceneId: 2, path: join(workDir, 'scene-2.wav') },
    ],
    fps: 1,
    canvas_w: 320,
    canvas_h: 568,
  });
}

async function expectFrameDirectoriesMissing(workDir: string, sceneIds: number[]): Promise<void> {
  for (const sceneId of sceneIds) {
    const path = join(workDir, `frames-${String(sceneId).padStart(3, '0')}`);
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

function previewInput(workDir: string, name: string, signal?: AbortSignal) {
  return {
    workDir,
    htmlPath: join(workDir, `${name}.html`),
    outputPath: join(workDir, `${name}.jpg`),
    canvas: { width: 320, height: 568 },
    signal,
  };
}

function createReadyScriptExecutor(images: unknown[]) {
  return async (script: string): Promise<unknown> => {
    if (!script.includes('document.readyState')) return true;
    return vm.runInNewContext(script, {
      clearInterval,
      document: {
        fonts: { ready: Promise.resolve() },
        images,
        readyState: 'complete',
      },
      requestAnimationFrame(callback: () => void) {
        queueMicrotask(callback);
      },
      setInterval,
      window: { __ready: true, __tl: { seek: () => 0 } },
    });
  };
}

async function withRendererTestDir(run: (workDir: string) => Promise<void>): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'storydream-renderer-'));
  try {
    await mkdir(workDir, { recursive: true });
    await run(workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  throw new Error('Timed out waiting for renderer test condition.');
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
