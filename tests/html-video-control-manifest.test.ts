import { describe, expect, it } from 'vitest';
import {
  createHtmlVideoJobConfig,
  htmlVideoBgmTargetDb,
  htmlVideoAspectRatioOrDefault,
  htmlVideoConfigEnvelopeForStage,
  htmlVideoConfigForStage,
  preserveHtmlVideoJobConfig,
  recoverHtmlVideoJobConfig,
} from '@shared/html-video-config';
import {
  HTML_VIDEO_CONTROL_FIELDS,
  HTML_VIDEO_CONTROL_MANIFEST_V1,
  HTML_VIDEO_CONTROL_MANIFEST_VERSION,
} from '@shared/html-video-control-manifest';
import {
  applyHtmlVideoConfigChanges,
  createHtmlVideoPipelineData,
  createHtmlVideoTaskInput,
  parseHtmlVideoPipelineData,
  tabForHtmlVideoStep,
  taskProgressLabel,
} from '@shared/html-video-workflow';
import type { HtmlVideoConfigChange, HtmlVideoJobConfig, HtmlVideoVisibleStep } from '@shared/types';

const APPROVED_HTML_VIDEO_FIELDS = [
  'style',
  'voiceId',
  'ttsProvider',
  'ttsSpeed',
  'bgmId',
  'captionPreset',
  'captionAnim',
  'captionColors',
  'bgmVolume',
  'transitionType',
  'coverImageMode',
  'coverTemplate',
  'coverRatio',
  'draftTemplate',
  'foreground',
  'maxScenes',
  'ratio',
] as const satisfies readonly (keyof HtmlVideoJobConfig)[];

const fullCustomConfig: Required<HtmlVideoJobConfig> = {
  style: 'custom-editorial-film',
  voiceId: 'voice-custom',
  ttsProvider: 'minimax',
  ttsSpeed: 1.25,
  bgmId: 'bgm-custom',
  captionPreset: 'editorial',
  captionAnim: 'pop',
  captionColors: { text: '#ffffff', accent: '#11aabb' },
  bgmVolume: 'medium',
  transitionType: 'dissolve',
  coverImageMode: 'custom-cover-mode',
  coverTemplate: 'custom-cover-template',
  coverRatio: 'custom-cover-ratio',
  draftTemplate: 'custom-draft-template',
  foreground: false,
  maxScenes: 12,
  ratio: '4:3',
};

describe('HTML video control manifest', () => {
  it('governs exactly all 17 approved fields with complete metadata', () => {
    expect(HTML_VIDEO_CONTROL_MANIFEST_VERSION).toBe(1);
    expect([...HTML_VIDEO_CONTROL_FIELDS].sort()).toEqual([...APPROVED_HTML_VIDEO_FIELDS].sort());
    expect(Object.keys(HTML_VIDEO_CONTROL_MANIFEST_V1).sort()).toEqual([...APPROVED_HTML_VIDEO_FIELDS].sort());

    for (const field of APPROVED_HTML_VIDEO_FIELDS) {
      expect(HTML_VIDEO_CONTROL_MANIFEST_V1[field]).toEqual(expect.objectContaining({
        defaultResolver: field,
        schema: expect.any(String),
        uiLocation: expect.any(String),
        persistencePath: 'pipelineData.config',
        legacyMirror: expect.toSatisfy((value: unknown) => value === null || typeof value === 'string'),
        promptStages: ['rewrite', 'planning'],
        promptDependencyStages: expect.any(Array),
        consumerStages: expect.any(Array),
        invalidateFrom: expect.toSatisfy((value: unknown) => value === null || typeof value === 'string'),
        availability: expect.stringMatching(/^(editable|read-only-compatible)$/u),
        tests: expect.arrayContaining([expect.any(String)]),
      }));
    }

    expect(HTML_VIDEO_CONTROL_MANIFEST_V1.transitionType).toEqual(expect.objectContaining({
      promptStages: ['rewrite', 'planning'],
      promptDependencyStages: [],
      consumerStages: ['render'],
      invalidateFrom: 'render',
      availability: 'editable',
    }));
    for (const field of ['captionPreset', 'captionAnim', 'captionColors'] as const) {
      expect(HTML_VIDEO_CONTROL_MANIFEST_V1[field]).toEqual(expect.objectContaining({
        consumerStages: ['preview', 'render'],
        invalidateFrom: 'preview',
        availability: 'editable',
      }));
    }
    expect(Object.entries(HTML_VIDEO_CONTROL_MANIFEST_V1)
      .filter(([, entry]) => entry.availability === 'read-only-compatible')
      .map(([field]) => field)
      .sort()).toEqual([
        'coverImageMode',
        'coverRatio',
        'coverTemplate',
        'draftTemplate',
      ]);

    expect(Object.fromEntries(Object.entries(HTML_VIDEO_CONTROL_MANIFEST_V1).map(([field, value]) => [
      field,
      value.legacyMirror,
    ]))).toEqual({
      style: 'style',
      voiceId: 'speaker',
      ttsProvider: 'ttsProvider',
      ttsSpeed: 'ttsSpeed',
      bgmId: 'bgmId',
      captionPreset: null,
      captionAnim: null,
      captionColors: null,
      bgmVolume: null,
      transitionType: null,
      coverImageMode: 'coverImageMode',
      coverTemplate: 'coverTemplateId',
      coverRatio: null,
      draftTemplate: null,
      foreground: 'htmlVideoForeground',
      maxScenes: 'targetScenes|storyboardSceneCount',
      ratio: 'ratio',
    });
  });

  it('creates one deterministic complete config and deep-clones mutable defaults and overrides', () => {
    const first = createHtmlVideoJobConfig();
    const second = createHtmlVideoJobConfig();
    expect(Object.keys(first).sort()).toEqual([
      'bgmId',
      'coverImageMode',
      'coverRatio',
      'coverTemplate',
      'foreground',
      'maxScenes',
      'ratio',
      'style',
      'transitionType',
      'ttsProvider',
      'ttsSpeed',
      'voiceId',
    ]);
    expect(first).toEqual({
      style: 'modern-film',
      voiceId: '',
      ttsProvider: 'volcengine',
      ttsSpeed: 1,
      bgmId: '',
      transitionType: 'fade',
      coverImageMode: 'titled',
      coverTemplate: 'cinematic-poster',
      coverRatio: '3:4',
      foreground: true,
      maxScenes: 8,
      ratio: '9:16',
    });
    expect(first).toEqual(second);
    expect(first).not.toHaveProperty('captionPreset');
    expect(first).not.toHaveProperty('captionAnim');
    expect(first).not.toHaveProperty('captionColors');
    expect(first).not.toHaveProperty('bgmVolume');
    expect(first).not.toHaveProperty('draftTemplate');

    const overrideColors = { text: '#123456' };
    const overridden = createHtmlVideoJobConfig({ ...fullCustomConfig, captionColors: overrideColors });
    overrideColors.text = '#000000';
    expect(overridden).toEqual({ ...fullCustomConfig, captionColors: { text: '#123456' } });
    expect(overridden.captionColors).not.toBe(overrideColors);
  });

  it('preserves omissions in existing snapshots while V2 and legacy _cfg round-trip every present field', () => {
    expect(preserveHtmlVideoJobConfig({ style: 'legacy-only-style' })).toEqual({ style: 'legacy-only-style' });

    const partialV2 = createHtmlVideoPipelineData('缺失字段兼容。');
    partialV2.config = { style: 'legacy-only-style' };
    expect(parseHtmlVideoPipelineData(JSON.stringify(partialV2)).config).toEqual({
      style: 'legacy-only-style',
    });

    const v2 = createHtmlVideoPipelineData('完整配置。', fullCustomConfig);
    const parsedV2 = parseHtmlVideoPipelineData(JSON.stringify(v2));
    expect(parsedV2.config).toEqual(fullCustomConfig);
    expect(parsedV2.config.captionColors).not.toBe(fullCustomConfig.captionColors);

    const parsedLegacy = parseHtmlVideoPipelineData(JSON.stringify({
      version: 1,
      scenes: [],
      _cfg: fullCustomConfig,
    }));
    expect(parsedLegacy.config).toEqual(fullCustomConfig);
    expect(parsedLegacy.config.captionColors).not.toBe(fullCustomConfig.captionColors);
  });

  it('stores all 17 new-task values under pipelineData.config and only mirrors documented legacy columns', () => {
    const input = createHtmlVideoTaskInput({ copy: '完整新任务配置。', ...fullCustomConfig });
    const pipeline = parseHtmlVideoPipelineData(input.pipelineData);
    expect(pipeline.config).toEqual(fullCustomConfig);
    expect(input).toMatchObject({
      style: fullCustomConfig.style,
      speaker: fullCustomConfig.voiceId,
      ttsProvider: fullCustomConfig.ttsProvider,
      ttsSpeed: fullCustomConfig.ttsSpeed,
      bgmId: fullCustomConfig.bgmId,
      ratio: fullCustomConfig.ratio,
      targetScenes: fullCustomConfig.maxScenes,
      coverImageMode: fullCustomConfig.coverImageMode,
      coverTemplateId: fullCustomConfig.coverTemplate,
      htmlVideoForeground: fullCustomConfig.foreground,
    });
    expect(input).not.toHaveProperty('captionPreset');
    expect(input).not.toHaveProperty('transitionType');
  });

  it('reports defaulted fields during recovery instead of silently replacing missing custom values', () => {
    const recovered = recoverHtmlVideoJobConfig({
      style: 'recovered-custom-style',
      captionPreset: 'classic',
    });
    expect(recovered.config).toMatchObject({
      style: 'recovered-custom-style',
      captionPreset: 'classic',
    });
    expect(recovered.defaultedFields).toEqual(expect.arrayContaining([
      'voiceId',
      'ttsProvider',
      'transitionType',
      'ratio',
    ]));
    expect(recovered.defaultedFields).not.toEqual(expect.arrayContaining([
      'captionAnim',
      'captionColors',
      'bgmVolume',
      'draftTemplate',
    ]));
    expect(recovered.missingCompatibleFields).toEqual([
      'captionAnim',
      'captionColors',
      'bgmVolume',
      'draftTemplate',
    ]);
    expect(recovered.warnings).toEqual([
      expect.stringContaining(recovered.defaultedFields.join(', ')),
      expect.stringContaining(recovered.missingCompatibleFields.join(', ')),
    ]);
  });

  it.each([
    [{ ttsProvider: 'unknown-provider' }, /ttsProvider/i],
    [{ ttsSpeed: 0.09 }, /ttsSpeed/i],
    [{ ttsSpeed: 10.01 }, /ttsSpeed/i],
    [{ bgmVolume: 'silent' }, /bgmVolume/i],
    [{ transitionType: 'shell;rm' }, /transitionType/i],
    [{ ratio: '3:2' }, /ratio/i],
    [{ maxScenes: 0 }, /maxScenes/i],
    [{ maxScenes: 31 }, /maxScenes/i],
  ] as Array<[Record<string, unknown>, RegExp]>)('rejects invalid governed config %# before persistence', (patch, message) => {
    expect(() => preserveHtmlVideoJobConfig(patch as HtmlVideoJobConfig)).toThrow(message);
  });

  it('rejects unknown consumed caption values while retaining unrelated compatible strings', () => {
    const captionColors = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`color-${index}`, '#fff']));
    expect(() => preserveHtmlVideoJobConfig({ captionColors })).toThrow(/captionColors/i);
    expect(() => preserveHtmlVideoJobConfig({ captionPreset: 'vendor-custom-preset' })).toThrow(/captionPreset/i);
    expect(preserveHtmlVideoJobConfig({
      coverImageMode: 'vendor-custom-cover-mode',
      draftTemplate: 'vendor-custom-draft',
    })).toEqual({
      coverImageMode: 'vendor-custom-cover-mode',
      draftTemplate: 'vendor-custom-draft',
    });
  });

  it('keeps missing BGM volume equivalent to soft without persisting a synthetic value', () => {
    expect(htmlVideoBgmTargetDb(undefined)).toBe(-28);
    expect(htmlVideoBgmTargetDb('soft')).toBe(-28);
    expect(htmlVideoBgmTargetDb('medium')).toBe(-22);
    expect(htmlVideoBgmTargetDb('loud')).toBe(-16);
  });

  it('uses the shared video ratio default while preserving compatible output aspect ratios', () => {
    expect(htmlVideoAspectRatioOrDefault('16:9')).toBe(16 / 9);
    expect(htmlVideoAspectRatioOrDefault('3:4')).toBe(3 / 4);
    expect(htmlVideoAspectRatioOrDefault('invalid')).toBe(9 / 16);
    expect(htmlVideoAspectRatioOrDefault(undefined)).toBe(9 / 16);
  });

  it('projects only manifest-declared consumers into each stage input/hash boundary', () => {
    const expected: Record<HtmlVideoVisibleStep, Partial<HtmlVideoJobConfig>> = {
      rewrite: { maxScenes: 12 },
      planning: { maxScenes: 12 },
      assets: { style: 'custom-editorial-film', foreground: false, ratio: '4:3' },
      voice: { voiceId: 'voice-custom', ttsProvider: 'minimax', ttsSpeed: 1.25 },
      preview: {
        captionPreset: 'editorial',
        captionAnim: 'pop',
        captionColors: { text: '#ffffff', accent: '#11aabb' },
        ratio: '4:3',
      },
      render: {
        bgmId: 'bgm-custom',
        captionPreset: 'editorial',
        captionAnim: 'pop',
        captionColors: { text: '#ffffff', accent: '#11aabb' },
        bgmVolume: 'medium',
        ratio: '4:3',
        transitionType: 'dissolve',
      },
    };
    for (const stage of Object.keys(expected) as HtmlVideoVisibleStep[]) {
      expect(htmlVideoConfigForStage(fullCustomConfig, stage)).toEqual(expected[stage]);
      const envelope = htmlVideoConfigEnvelopeForStage(fullCustomConfig, stage);
      expect(envelope.config).toEqual(expected[stage]);
      expect(envelope.configSnapshot).toEqual(fullCustomConfig);
      expect(envelope.configSnapshot).not.toBe(fullCustomConfig);
    }
  });

  it('keeps stage/tab mapping at six HTML stages while ordinary tasks report seven', () => {
    expect(tabForHtmlVideoStep('rewrite')).toBe('text');
    expect(tabForHtmlVideoStep('planning')).toBe('text');
    expect(tabForHtmlVideoStep('render')).toBe('output');
    expect(tabForHtmlVideoStep('done')).toBe('output');
    expect(tabForHtmlVideoStep('cover')).toBe('text');
    expect(taskProgressLabel({ taskType: 'html-video', currentStep: 4 })).toBe('4/6');
    expect(taskProgressLabel({ taskType: 'standard', currentStep: 4 })).toBe('4/7');
  });

  it('applies only consumer-backed config changes and invalidates from the earliest declared stage', () => {
    const pipeline = createHtmlVideoPipelineData('Task 16 config mutation');
    pipeline.current = 'done';
    for (const step of Object.keys(pipeline.steps) as HtmlVideoVisibleStep[]) {
      pipeline.steps[step] = {
        status: 'completed',
        inputHash: `${step}-input`,
        artifactPath: `steps/${step}.json`,
        artifactSize: 10,
      };
    }
    pipeline.output = { path: 'final.mp4', sizeBytes: 100 };

    const result = applyHtmlVideoConfigChanges(pipeline, [
      { field: 'transitionType', value: 'dissolve' },
      { field: 'style', value: 'ink-editorial' },
    ]);

    expect(result.changedFields).toEqual(['transitionType', 'style']);
    expect(result.invalidateFrom).toBe('assets');
    expect(result.pipeline.config).toMatchObject({ transitionType: 'dissolve', style: 'ink-editorial' });
    expect(result.pipeline.steps.rewrite).toEqual(pipeline.steps.rewrite);
    expect(result.pipeline.steps.planning).toEqual(pipeline.steps.planning);
    expect(result.pipeline.steps.assets).toEqual({ status: 'pending' });
    expect(result.pipeline.steps.render).toEqual({ status: 'pending' });
    expect(result.pipeline.scenes).toEqual(pipeline.scenes);
    expect(result.pipeline).not.toHaveProperty('output');
    expect(result.pipeline.revision).toBe(pipeline.revision + 1);
    expect(result.pipeline).not.toHaveProperty('configSnapshotHash');
  });

  it('applies caption changes from preview while preserving earlier artifacts', () => {
    const pipeline = createHtmlVideoPipelineData('Task 17 caption mutation');
    pipeline.current = 'done';
    for (const step of Object.keys(pipeline.steps) as HtmlVideoVisibleStep[]) {
      pipeline.steps[step] = { status: 'completed', inputHash: `${step}-input`, artifactPath: `steps/${step}.json`, artifactSize: 10 };
    }
    pipeline.compositions = [{ index: 1, durationSec: 1, canvas: { w: 720, h: 1280 }, audio: { src: 'voice.wav', durationSec: 1 }, background: { src: 'bg.png' }, captions: [] }];
    pipeline.output = { path: 'final.mp4', sizeBytes: 100 };

    const result = applyHtmlVideoConfigChanges(pipeline, [
      { field: 'captionPreset', value: 'karaoke' },
      { field: 'captionAnim', value: 'pop' },
      { field: 'captionColors', value: { accent: '#36d7c5' } },
    ]);

    expect(result.changedFields).toEqual(['captionPreset', 'captionAnim', 'captionColors']);
    expect(result.invalidateFrom).toBe('preview');
    expect(result.pipeline.steps.voice).toEqual(pipeline.steps.voice);
    expect(result.pipeline.steps.preview).toEqual({ status: 'pending' });
    expect(result.pipeline.steps.render).toEqual({ status: 'pending' });
    expect(result.pipeline.compositions).toEqual([]);
    expect(result.pipeline).not.toHaveProperty('output');
    expect(result.pipeline.config.captionColors).toEqual({ accent: '#36d7c5' });
  });

  it('rejects an identical caption color map regardless of object identity or key order', () => {
    const pipeline = createHtmlVideoPipelineData('Task 17 caption no-op');
    pipeline.config.captionColors = { text: '#ffffff', accent: '#36d7c5' };
    const before = JSON.stringify(pipeline);

    expect(() => applyHtmlVideoConfigChanges(pipeline, [
      { field: 'captionColors', value: { accent: '#36d7c5', text: '#ffffff' } },
    ])).toThrow(/没有发生变化|UNCHANGED/i);
    expect(JSON.stringify(pipeline)).toBe(before);
  });

  it('rejects read-only-compatible, duplicate, empty, and invalid config changes without mutating the pipeline', () => {
    const pipeline = createHtmlVideoPipelineData('immutable rejection');
    const before = JSON.stringify(pipeline);
    for (const changes of [
      [{ field: 'coverRatio', value: '1:1' }],
      [{ field: 'draftTemplate', value: 'draft-1' }],
      [{ field: 'ratio', value: '9:16' }, { field: 'ratio', value: '1:1' }],
      [],
      [{ field: 'ttsSpeed', value: Number.POSITIVE_INFINITY }],
    ] as unknown as HtmlVideoConfigChange[][]) {
      expect(() => applyHtmlVideoConfigChanges(pipeline, changes)).toThrow();
      expect(JSON.stringify(pipeline)).toBe(before);
    }
  });
});
