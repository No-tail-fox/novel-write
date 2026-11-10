/**
 * O-3：新建 HTML 视频默认走新架构 —— 创建标记、设置、VideoSpec 构建、出片分支、转场封装参数（不联网）。
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildHtmlVideoSpecForRender,
  htmlVideoSpecFps,
  htmlVideoUsesVideoSpec,
  htmlVideoVideoSpecRenderEnabled,
  isFreshHtmlVideoPipeline,
  markHtmlVideoPipelineDataForCreation,
} from '../src/shared/html-video-spec';
import {
  applyHtmlVideoConfigChanges,
  createHtmlVideoPipelineData,
  createHtmlVideoTaskInput,
  invalidateHtmlVideoPipeline,
  parseHtmlVideoPipelineData,
} from '../src/shared/html-video-workflow';
import { htmlVideoBgmTargetDb } from '../src/shared/html-video-config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import { defaultConfig } from '../src/shared/config';
import { applyVoiceTimings } from '../src/shared/video-spec-executor';
import type { HtmlVideoAsset, HtmlVideoPipelineDataV2, HtmlVideoVoiceClip } from '../src/shared/types';
import { muxVideoSpecFilmXfadeArgs, videoSpecTransitionPlan } from '../electron/video-spec-executor-runtime';
import { htmlVideoSpecCaptureRequestAllowed, htmlVideoSpecRenderError } from '../electron/html-video-spec-render';

const COPY = '第一段文案，讲一个故事的开头。\n\n第二段文案，故事继续发展。\n\n第三段文案，故事走向结局。';

function freshPipelineData(): string {
  return createHtmlVideoTaskInput({ copy: COPY, ratio: '9:16', maxScenes: 3 }).pipelineData!;
}

function v2(data: string): HtmlVideoPipelineDataV2 {
  return parseHtmlVideoPipelineData(data) as HtmlVideoPipelineDataV2;
}

describe('(a) creation marking and the global setting', () => {
  it('reads the setting as on when absent and off only for an explicit false', () => {
    expect(htmlVideoVideoSpecRenderEnabled(undefined)).toBe(true);
    expect(htmlVideoVideoSpecRenderEnabled({})).toBe(true);
    expect(htmlVideoVideoSpecRenderEnabled({ htmlVideoVideoSpecRender: true })).toBe(true);
    expect(htmlVideoVideoSpecRenderEnabled({ htmlVideoVideoSpecRender: false })).toBe(false);
    const legacyConfig = normalizeAppConfig(defaultConfig);
    expect(legacyConfig.htmlVideoVideoSpecRender).toBeUndefined();
    expect(htmlVideoVideoSpecRenderEnabled(legacyConfig)).toBe(true);
    expect(normalizeAppConfig({ ...legacyConfig, htmlVideoVideoSpecRender: false }).htmlVideoVideoSpecRender).toBe(false);
  });

  it('marks a freshly created pipeline when on (and absent), and the marker survives parsing and studio edits', () => {
    const fresh = freshPipelineData();
    expect(isFreshHtmlVideoPipeline(JSON.parse(fresh))).toBe(true);
    const marked = markHtmlVideoPipelineDataForCreation(fresh, htmlVideoVideoSpecRenderEnabled({}))!;
    const state = v2(marked);
    expect(state.videoSpecVersion).toBe(1);
    expect(htmlVideoUsesVideoSpec(state)).toBe(true);
    // 工作室编辑（改配置、从某一步重跑）不丢标记。
    expect(invalidateHtmlVideoPipeline(state, 'voice').videoSpecVersion).toBe(1);
    const edited = applyHtmlVideoConfigChanges(state, [{ field: 'transitionType', value: 'wipeleft' }]);
    expect(edited.pipeline.videoSpecVersion).toBe(1);
  });

  it('does not mark when off and strips a renderer-forged marker on fresh creation', () => {
    const fresh = freshPipelineData();
    expect(markHtmlVideoPipelineDataForCreation(fresh, false)).toBe(fresh);
    expect(v2(fresh).videoSpecVersion).toBeUndefined();
    const forged = JSON.stringify({ ...JSON.parse(fresh), videoSpecVersion: 1 });
    expect(v2(markHtmlVideoPipelineDataForCreation(forged, false)!).videoSpecVersion).toBeUndefined();
  });

  it('leaves legacy data and copies of existing tasks exactly as they are (no migration)', () => {
    // 旧数据：没有字段，解析后也没有。
    const legacy = v2(JSON.stringify(createHtmlVideoPipelineData(COPY, { maxScenes: 3 })));
    expect(legacy.videoSpecVersion).toBeUndefined();
    expect(htmlVideoUsesVideoSpec(legacy)).toBe(false);
    // 复制出来的已运行过的旧任务（有配音/素材）：开或关都原样返回，不会被打标记。
    const ran = { ...legacy, revision: 4, voices: [{ sceneIndex: legacy.scenes[0].index, src: 'audio/v.mp3', durationSec: 2 }] };
    const copied = JSON.stringify(ran);
    expect(markHtmlVideoPipelineDataForCreation(copied, true)).toBe(copied);
    expect(markHtmlVideoPipelineDataForCreation(copied, false)).toBe(copied);
    // 复制的新任务保持新版（关掉设置也不删标记）。
    const copiedNew = JSON.stringify({ ...ran, videoSpecVersion: 1 });
    expect(markHtmlVideoPipelineDataForCreation(copiedNew, false)).toBe(copiedNew);
    // 非 V2 / 空 / 损坏的 JSON 原样返回。
    expect(markHtmlVideoPipelineDataForCreation('{}', true)).toBe('{}');
    expect(markHtmlVideoPipelineDataForCreation('not json', true)).toBe('not json');
    expect(markHtmlVideoPipelineDataForCreation(undefined, true)).toBeUndefined();
    // 非法的版本号不会被当成新架构。
    expect(v2(JSON.stringify({ ...legacy, videoSpecVersion: 0 })).videoSpecVersion).toBeUndefined();
    expect(v2(JSON.stringify({ ...legacy, videoSpecVersion: 'x' })).videoSpecVersion).toBeUndefined();
  });

  it('stamps the marker only in the html-video:create-task handler, from the runtime config', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("trustedHandle('html-video:create-task'"), main.indexOf("trustedHandle('html-video:update-config'"));
    expect(handler).toContain('htmlVideoVideoSpecRenderEnabled(await (await getConfigService()).getRuntimeConfig())');
    expect(handler).toContain('pipelineData: markHtmlVideoPipelineDataForCreation(input.pipelineData, videoSpecRender) ?? \'{}\'');
    expect(main.match(/markHtmlVideoPipelineDataForCreation\(/gu)?.length).toBe(1);
    const settings = await readFile(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('label="新建 HTML 视频使用新版渲染引擎"');
    expect(settings).toContain('checked={draft.htmlVideoVideoSpecRender !== false}');
  });
});

// ───────────────────────────── (b) builder ─────────────────────────────

function fixture(options: { cover?: boolean; backgrounds?: number; transitionType?: string; voices?: number[] } = {}) {
  const state = v2(markHtmlVideoPipelineDataForCreation(freshPipelineData(), true)!);
  const scenes = state.scenes.slice(0, 3);
  const voiceSecs = options.voices ?? [2, 1.5, 0.5];
  const voices: HtmlVideoVoiceClip[] = scenes.map((scene, index) => ({
    sceneIndex: scene.index,
    src: `C:/task/audio/voice-${scene.index}.wav`,
    durationSec: voiceSecs[index],
    ...(index === 0 ? { captionCues: [
      { text: '第一句字幕', startSec: 0, endSec: 1, source: 'tts' as const, confidence: 1 },
      { text: '第二句字幕', startSec: 1, endSec: 2, source: 'tts' as const, confidence: 1 },
    ] } : {}),
  }));
  const assets: HtmlVideoAsset[] = scenes.slice(0, options.backgrounds ?? 3).map(scene => ({
    sceneIndex: scene.index, kind: 'bg', slot: 0, src: `C:/task/images/bg-${scene.index}.png`,
  }) as HtmlVideoAsset);
  return buildHtmlVideoSpecForRender({
    title: '测试',
    scenes,
    voices,
    assets,
    config: { ...state.config, bgmVolume: 'soft', ...(options.transitionType ? { transitionType: options.transitionType } : { transitionType: 'dissolve' }) },
    canvas: { width: 720, height: 1280 },
    fps: 24,
    scenePagePaths: new Map(scenes.map(scene => [scene.index, `C:/task/.html-video-staging/render-1/html-scenes/scene-${scene.index}.html`])),
    outputPath: 'C:/task/.html-video-staging/render-1/final.mp4',
    bgmPath: 'C:/task/bgm.mp3',
    ...(options.cover ? { coverPath: 'C:/task/cover.png' } : {}),
  });
}

describe('(b) VideoSpec builder from HTML video state', () => {
  it('lays out measured voice durations on integer frames with allocateFrameCounts', () => {
    const { timedSpec, spec, timings, timing } = fixture();
    expect(timedSpec.canvas).toMatchObject({ width: 720, height: 1280, fps: 24 });
    // 2000 / 1500 / max(800, 500) ms → 累计边界 48 / 84 / 103 帧。
    expect(timedSpec.scenes.map(scene => [scene.id, scene.startFrame, scene.durationFrames])).toEqual([
      ['scene-1', 0, 48], ['scene-2', 48, 36], ['scene-3', 84, 19],
    ]);
    expect(timedSpec.durationFrames).toBe(103);
    expect(applyVoiceTimings(spec, timings, timing)).toEqual(timedSpec);
    // 旁白从场景开头起播，不重叠；音频总长 = 画面总长。
    const narration = timedSpec.audio.tracks.find(track => track.kind === 'narration')!;
    expect(narration.clips.map(clip => [clip.id, clip.startFrame, clip.durationFrames, clip.ref])).toEqual([
      ['narration-1', 0, 48, 'C:/task/audio/voice-1.wav'],
      ['narration-2', 48, 36, 'C:/task/audio/voice-2.wav'],
      ['narration-3', 84, 12, 'C:/task/audio/voice-3.wav'],
    ]);
  });

  it('captures each scene from its HTML page through the hyperframes adapter and keeps timed captions', () => {
    const { timedSpec } = fixture();
    for (const scene of timedSpec.scenes) {
      expect(scene.adapter.kind).toBe('hyperframes');
      expect(scene.adapter.kind === 'hyperframes' && scene.adapter.compositionRef).toMatch(/html-scenes[\\/]scene-\d\.html$/u);
    }
    expect(timedSpec.scenes[0].cues.map(cue => [cue.text, cue.startFrame, cue.endFrame])).toEqual([['第一句字幕', 0, 24], ['第二句字幕', 24, 48]]);
    expect(timedSpec.scenes[1].cues.length).toBeGreaterThan(0);
  });

  it('carries the configured transition (0.3 s) and caps it at half the shortest segment', () => {
    const { timedSpec } = fixture();
    expect(timedSpec.scenes[0].transitionIn).toBeUndefined();
    expect(timedSpec.scenes.slice(1).map(scene => scene.transitionIn)).toEqual([
      { type: 'dissolve', durationFrames: 7 }, { type: 'dissolve', durationFrames: 7 },
    ]);
    expect(videoSpecTransitionPlan(timedSpec)).toEqual([null, { type: 'dissolve', frames: 7 }, { type: 'dissolve', frames: 7 }]);
    const tight = fixture({ voices: [2, 1.5, 0.2] }).timedSpec; // 第三段 800 ms = 19 帧 → 上限 9
    expect(videoSpecTransitionPlan(tight)[2]?.frames).toBe(7);
    const cut = fixture({ transitionType: 'cut' }).timedSpec;
    expect(cut.scenes.every(scene => !scene.transitionIn)).toBe(true);
    expect(videoSpecTransitionPlan(cut).every(step => step === null)).toBe(true);
    const defaulted = fixture({ transitionType: 'unknown-type' }).timedSpec;
    expect(defaulted.scenes[1].transitionIn?.type).toBe('fade');
  });

  it('adds BGM at the user volume without ducking and normalizes the film to -14 LUFS / -1 dBTP', () => {
    const { timedSpec } = fixture();
    const music = timedSpec.audio.tracks.find(track => track.kind === 'music')!;
    expect(music.targetDb).toBe(htmlVideoBgmTargetDb('soft'));
    expect(music.ducking).toBeUndefined();
    expect(music.clips).toEqual([expect.objectContaining({ ref: 'C:/task/bgm.mp3', startFrame: 0, durationFrames: 103, loop: true })]);
    expect(timedSpec.loudness).toMatchObject({ normalize: true, integratedLufs: -14, truePeakDb: -1 });
    expect(timedSpec.outputs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'mp4', path: 'C:/task/.html-video-staging/render-1/final.mp4' })]));
  });

  it('keeps the legacy opening rule: cover 1.4 s and first scene at least 6 s when there is a montage', () => {
    const { timedSpec } = fixture({ cover: true, backgrounds: 3 });
    expect(timedSpec.scenes[0]).toMatchObject({ id: 'cover', startFrame: 0, durationFrames: 34, adapter: { kind: 'still', imageRef: 'C:/task/cover.png' } });
    // 第一个场景配音只有 2 s，但开场蒙太奇要求至少 6 s（144 帧）；没有 minSceneMsById 时会被压回 48 帧。
    expect(timedSpec.scenes[1]).toMatchObject({ id: 'scene-1', startFrame: 34, durationFrames: 144 });
    expect(timedSpec.scenes[1].transitionIn).toEqual({ type: 'dissolve', durationFrames: 7 });
    expect(timedSpec.durationFrames).toBe(34 + 144 + 36 + 19);
    const narration = timedSpec.audio.tracks.find(track => track.kind === 'narration')!;
    expect(narration.clips[0]).toMatchObject({ startFrame: 34, durationFrames: 48 });
  });

  it('uses the first scene duration for the cover when there is no montage (legacy sidecar default)', () => {
    const { timedSpec, opening } = fixture({ cover: true, backgrounds: 1 });
    expect(opening).toBe(false);
    expect(timedSpec.scenes[0]).toMatchObject({ id: 'cover', durationFrames: 48 });
    expect(timedSpec.scenes[1]).toMatchObject({ id: 'scene-1', startFrame: 48, durationFrames: 48 });
  });

  it('fails with VIDEO_SPEC_RENDER_* when voices or scene pages are missing', () => {
    expect(() => fixture({ voices: [2, 0, 1] })).toThrow(expect.objectContaining({ code: 'VIDEO_SPEC_RENDER_SPEC_INVALID' }));
  });

  it('captures at the runtime frame rate (24 unless the runtime is 30)', () => {
    expect(htmlVideoSpecFps(24)).toBe(24);
    expect(htmlVideoSpecFps(30)).toBe(30);
    expect(htmlVideoSpecFps(25)).toBe(24);
  });
});

describe('(c) render branch selection', () => {
  it('routes marked tasks to renderVideoSpec and keeps runtime.render for everything else', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const slice = main.slice(main.indexOf('async function runHtmlVideoTask('), main.indexOf('async function probeHtmlVideoMedia('));
    expect(slice).toContain('render: htmlVideoUsesVideoSpec(initialState) ? runtime.renderVideoSpec : runtime.render,');
    expect(slice).not.toContain('renderVideoSpec ?? ');
    expect(htmlVideoUsesVideoSpec(v2(freshPipelineData()))).toBe(false);
    expect(htmlVideoUsesVideoSpec(v2(markHtmlVideoPipelineDataForCreation(freshPipelineData(), true)!))).toBe(true);
  });

  it('keeps the legacy render body free of VideoSpec code (no mid-run fallback either way)', async () => {
    const runtime = await readFile(new URL('../electron/html-video-runtime.ts', import.meta.url), 'utf8');
    const legacy = runtime.slice(runtime.indexOf('    async render(input) {'), runtime.indexOf('    // O-3 (2026-11-10): VideoSpec render for new tasks.'));
    expect(legacy.length).toBeGreaterThan(1000);
    expect(legacy).not.toMatch(/videoSpec|VideoSpec/u);
    expect(legacy).toContain('await options.renderer.render(composition, { signal })');
    const fresh = runtime.slice(runtime.indexOf('    async renderVideoSpec(input) {'), runtime.indexOf('function htmlVideoRenderArtifactIdentity('));
    expect(fresh).not.toContain('options.renderer.render');
    expect(fresh).toContain("destinationPath: join(workDir, 'final.mp4')");
    expect(fresh).toContain('renderArtifactProofs.set(output');
  });

  it('maps executor failures to VIDEO_SPEC_RENDER_* task errors', () => {
    const error = htmlVideoSpecRenderError({ failures: [{ nodeId: 'render:scene-2', kind: 'render', sceneId: 'scene-2', status: 'failed', code: 'CAPTURE_HOST_TIMEOUT', message: '采集超时', action: 'retry', hint: '' } as never] });
    expect(error.code).toBe('VIDEO_SPEC_RENDER_SCENE_FAILED');
    expect(error.message).toContain('scene-2');
    expect(htmlVideoSpecRenderError({ failures: [] }).code).toBe('VIDEO_SPEC_RENDER_FAILED');
  });

  it('only lets the capture window read data:, blob: and files inside the task directory', () => {
    const root = process.platform === 'win32' ? 'C:\\task' : '/task';
    const inside = process.platform === 'win32' ? 'file:///C:/task/images/a.png' : 'file:///task/images/a.png';
    const outside = process.platform === 'win32' ? 'file:///C:/other/a.png' : 'file:///other/a.png';
    expect(htmlVideoSpecCaptureRequestAllowed(inside, root)).toBe(true);
    expect(htmlVideoSpecCaptureRequestAllowed(outside, root)).toBe(false);
    expect(htmlVideoSpecCaptureRequestAllowed('data:image/png;base64,AAAA', root)).toBe(true);
    expect(htmlVideoSpecCaptureRequestAllowed('https://fonts.example.com/a.woff2', root)).toBe(false);
  });
});

describe('xfade mux arguments', () => {
  it('pads the outgoing segment and offsets each transition at the incoming scene start', () => {
    const args = muxVideoSpecFilmXfadeArgs({
      segments: [
        { path: '/w/a.mp4', startFrame: 0, durationFrames: 48, transitionIn: null },
        { path: '/w/b.mp4', startFrame: 48, durationFrames: 36, transitionIn: { type: 'wipeleft', frames: 7 } },
        { path: '/w/c.mp4', startFrame: 84, durationFrames: 19, transitionIn: null },
      ],
      audioPath: '/w/timeline.wav', outputPath: '/w/out.mp4', fps: 24, totalFrames: 103,
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[0:v]tpad=stop_mode=clone:stop=7,setpts=N/(24*TB),fps=24[s0]');
    expect(graph).toContain('[1:v]setpts=N/(24*TB),fps=24[s1]');
    expect(graph).toContain('[s0][s1]xfade=transition=wipeleft:duration=0.291667:offset=2[x1]');
    expect(graph).toContain('[x1][s2]concat=n=2:v=1:a=0[x2]');
    expect(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 2)).toEqual(['-frames:v', '103']);
    expect(args).toContain('bt709');
  });
});
