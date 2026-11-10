import { describe, expect, it } from 'vitest';
import {
  allocateFrameCounts,
  createVideoSpec,
  frameAt,
  msAt,
  parseVideoSpec,
  projectUsesVideoSpec,
  sampleAt,
  sceneAt,
  sceneEndFrame,
  validateVideoSpec,
  VIDEO_SPEC_VERSION,
  videoSpecDurationMs,
  videoSpecFromHtmlVideoState,
  videoSpecFromStoryboard,
  withVideoSpecVersion,
  type HtmlVideoStateToVideoSpecInput,
  type VideoSpec,
  type VideoSpecInput,
} from '../src/shared/video-spec';
import { allocateHtmlVideoSceneFrameCounts } from '../src/shared/html-video';
import { buildSubtitleTrack } from '../src/shared/story';
import type { HtmlVideoScenePlan, StoryboardScene } from '../src/shared/types';

// ───────────── fixtures ─────────────

function validSpecInput(): VideoSpecInput {
  return {
    specVersion: 1,
    route: 'html',
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationFrames: 150,
    scenes: [
      {
        id: 'a',
        startFrame: 0,
        durationFrames: 60,
        adapter: { kind: 'still', imageRef: 'a.png' },
        narration: { text: '你好，世界', clipId: 'n-a' },
        cues: [
          { text: '你好', startFrame: 0, endFrame: 30, words: [{ text: '你好', startFrame: 0, endFrame: 30 }] },
          { text: '世界', startFrame: 30, endFrame: 60 },
        ],
      },
      { id: 'b', startFrame: 60, durationFrames: 90, adapter: { kind: 'template', templateId: 'cinematic-title' } },
    ],
    audio: {
      tracks: [
        { id: 'narration', kind: 'narration', clips: [{ id: 'n-a', ref: 'a.mp3', sceneId: 'a', startFrame: 0, durationFrames: 55 }] },
        { id: 'music', kind: 'music', ducking: { triggerTrackIds: ['narration'], reductionDb: 12 }, clips: [{ id: 'm', ref: 'bgm.mp3', startFrame: 0, durationFrames: 150, loop: true }] },
      ],
    },
  };
}

type Mutable = Record<string, any>;
function issuesOf(mutate: (spec: Mutable) => void): string[] {
  const spec = structuredClone(validSpecInput()) as Mutable;
  mutate(spec);
  const result = validateVideoSpec(spec);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map(issue => `${issue.path}：${issue.message}`);
}

function htmlPlans(): HtmlVideoScenePlan[] {
  // 与 tests/html-video-runner.test.ts 的 buildTestScenes 相同的形状。
  return ['清晨的港口开始忙碌。', '货轮缓缓驶入码头。', '一天就此开始。'].map((narration, index) => ({
    index: index + 1,
    narration,
    title: `场景 ${index + 1}`,
    captions: [narration],
    sceneTemplate: 'cinematic-title',
    background: { prompt: `${narration} 背景` },
    elements: [{ slot: 0, prompt: `${narration} 前景` }],
  }));
}

function htmlState(): HtmlVideoStateToVideoSpecInput['state'] {
  const scenes = htmlPlans();
  scenes[2] = { ...scenes[2], hiddenElementSlots: [0] };
  return {
    scenes,
    voices: [
      {
        sceneIndex: 1,
        src: 'C:/work/voice/scene-1.mp3',
        durationSec: 2.345,
        text: '清晨的港口开始忙碌。',
        captionCues: [
          { text: '清晨的港口', startSec: 0, endSec: 1.2, source: 'tts', confidence: 0.98, words: [{ text: '清晨的', startSec: 0, endSec: 0.6 }, { text: '港口', startSec: 0.6, endSec: 1.2 }] },
          // TTS 时间戳比实际音频略长：转换时要钳到场景内。
          { text: '开始忙碌', startSec: 1.2, endSec: 2.4, source: 'tts', confidence: 0.97 },
        ],
      },
      { sceneIndex: 2, src: 'C:/work/voice/scene-2.mp3', durationSec: 3.1 },
      { sceneIndex: 3, src: 'C:/work/voice/scene-3.mp3', durationSec: 0.5 },
    ],
    assets: [
      { sceneIndex: 1, kind: 'bg', slot: 0, src: 'C:/work/assets/bg-1.png' },
      { sceneIndex: 1, kind: 'fg', slot: 0, src: 'C:/work/assets/fg-1.png', transparency: 'transparent' },
      { sceneIndex: 2, kind: 'bg', slot: 0, src: 'C:/work/assets/bg-2.png' },
      { sceneIndex: 2, kind: 'fg', slot: 0, src: 'C:/work/assets/fg-2.png', transparency: 'opaque' },
      { sceneIndex: 3, kind: 'bg', slot: 0, src: 'C:/work/assets/bg-3.png' },
      { sceneIndex: 3, kind: 'fg', slot: 0, src: 'C:/work/assets/fg-3.png', transparency: 'transparent' },
    ],
    compositions: [{
      index: 1,
      durationSec: 2.345,
      canvas: { w: 1080, h: 1920 },
      audio: { src: 'C:/work/voice/scene-1.mp3', durationSec: 2.345 },
      background: { src: 'C:/work/assets/bg-1.png' },
      captions: [],
      htmlPath: 'C:/work/compositions/scene-1.html',
      rev: 1,
    }],
    config: { transitionType: 'dissolve', bgmVolume: 'medium', sceneMotion: 'zoom_in', ratio: '9:16' },
  };
}

const storyboardScenes: StoryboardScene[] = [
  { id: 1, cap: '一九七八年冬天，小岗村的十八户农民按下了红手印。', descPrompt: '雪夜农舍', durationMs: 2400 },
  { id: 2, cap: '这份契约改变了中国农村。', descPrompt: '旧契约特写', durationMs: 3150, segments: [{ id: 1, text: '这份契约', durationMs: 1200 }, { id: 2, text: '改变了中国农村。', durationMs: 1950 }] },
  { id: 3, cap: '包产到户从这里开始。', descPrompt: '田野航拍', durationMs: 1870 },
];

// ───────────── 时间换算 ─────────────

describe('frame/ms conversion', () => {
  it('rounds half up at 24 fps and 30 fps', () => {
    expect(frameAt(0, 24)).toBe(0);
    expect(frameAt(20, 24)).toBe(0); // 0.48
    expect(frameAt(21, 24)).toBe(1); // 0.504
    expect(frameAt(62.5, 24)).toBe(2); // exactly 1.5 → 2
    expect(frameAt(1000, 24)).toBe(24);
    expect(frameAt(16, 30)).toBe(0); // 0.48
    expect(frameAt(17, 30)).toBe(1); // 0.51
    expect(frameAt(50, 30)).toBe(2); // exactly 1.5 → 2
    expect(frameAt(1050, 30)).toBe(32); // exactly 31.5 → 32
    expect(frameAt(1000, 30)).toBe(30);
  });

  it('derives ms and 48 kHz samples from integer frames exactly', () => {
    expect(msAt(1, 24)).toBeCloseTo(41.6667, 4);
    expect(msAt(3, 24)).toBe(125);
    expect(msAt(24, 24)).toBe(1000);
    expect(msAt(1, 30)).toBeCloseTo(33.3333, 4);
    expect(msAt(30, 30)).toBe(1000);
    expect(sampleAt(1, 24)).toBe(2000);
    expect(sampleAt(1, 30)).toBe(1600);
    expect(sampleAt(7, 24)).toBe(14000);
  });

  it('round-trips every frame for both fps', () => {
    for (const fps of [24, 30] as const) {
      for (let frame = 0; frame <= 3000; frame += 1) {
        expect(frameAt(msAt(frame, fps), fps)).toBe(frame);
        expect(Number.isInteger(sampleAt(frame, fps))).toBe(true);
      }
    }
  });

  it('rejects unsupported fps and bad times', () => {
    expect(() => frameAt(100, 25 as never)).toThrow(/fps 只支持 24 或 30/);
    expect(() => frameAt(-1, 30)).toThrow(/非负/);
    expect(() => frameAt(Number.NaN, 30)).toThrow(/非负/);
    expect(() => msAt(1.5, 30)).toThrow(/整数/);
  });

  it('allocates frames on the cumulative clock exactly like the HTML route allocator', () => {
    const durationsMs = [2345, 3100, 800, 1234, 4567, 999];
    for (const fps of [24, 30] as const) {
      expect(allocateFrameCounts(durationsMs, fps)).toEqual(allocateHtmlVideoSceneFrameCounts(durationsMs.map(ms => ms / 1000), fps));
      const total = allocateFrameCounts(durationsMs, fps).reduce((sum, count) => sum + count, 0);
      expect(total).toBe(frameAt(durationsMs.reduce((sum, ms) => sum + ms, 0), fps));
    }
    expect(allocateFrameCounts([2345, 3100, 800], 24)).toEqual([56, 75, 19]);
    expect(allocateFrameCounts([1, 1], 24)).toEqual([1, 1]); // 每段至少 1 帧
  });
});

// ───────────── schema ─────────────

describe('VideoSpec schema', () => {
  it('accepts a valid spec and fills documented defaults', () => {
    const result = validateVideoSpec(validSpecInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = result.spec;
    expect(spec.specVersion).toBe(VIDEO_SPEC_VERSION);
    expect(spec.canvas.color).toEqual({ range: 'tv', primaries: 'bt709', matrix: 'bt709', transfer: 'iec61966-2-1' });
    expect(spec.loudness).toEqual({ normalize: true, integratedLufs: -14, truePeakDb: -1, lra: 11 });
    expect(spec.audio.sampleRate).toBe(48000);
    expect(spec.outputs).toEqual([{ kind: 'mp4', videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac', burnCaptions: true }]);
    expect(spec.audio.tracks[1].ducking).toEqual({ triggerTrackIds: ['narration'], reductionDb: 12, attackMs: 50, releaseMs: 300 });
    expect(spec.scenes[1].cues).toEqual([]);
    expect(spec.scenes[1].sources).toEqual([]);
    expect(videoSpecDurationMs(spec)).toBe(5000);
    // JSON 往返后仍然合法且不变（持久化友好）。
    expect(parseVideoSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });

  it('rejects shape errors with Chinese messages and paths', () => {
    expect(issuesOf(spec => { spec.canvas.fps = 25; })).toEqual(['canvas.fps：fps 只支持 24 或 30（ADR-15：创建项目时二选一后锁定）']);
    expect(issuesOf(spec => { spec.canvas.width = 1081; }).join()).toContain('画布宽度必须是偶数');
    expect(issuesOf(spec => { spec.scenes[0].durationFrames = 60.5; }).join()).toContain('scenes[0].durationFrames：场景时长必须是整数帧');
    expect(issuesOf(spec => { spec.scenes[0].durationFrames = 0; }).join()).toContain('场景时长至少为 1 帧');
    expect(issuesOf(spec => { spec.scenes[0].startMs = 0; }).join()).toContain('未知字段：startMs');
    expect(issuesOf(spec => { delete spec.route; }).join()).toContain('route：');
    expect(issuesOf(spec => { spec.scenes[0].adapter = { kind: 'remotion' }; }).join()).toContain('场景适配器 kind 只支持');
    expect(issuesOf(spec => { spec.scenes[1].adapter = { kind: 'video', videoRef: 'v.mp4', muted: false }; }).join()).toContain('视频素材必须静音');
    expect(issuesOf(spec => { spec.audio.sampleRate = 44100; }).join()).toContain('音频采样率必须是 48000 Hz');
    expect(issuesOf(spec => { spec.canvas.color = { range: 'pc' }; }).join()).toContain('色彩范围必须是 tv');
    expect(issuesOf(spec => { spec.scenes = []; }).join()).toContain('至少要有 1 个场景');
    expect(issuesOf(spec => { spec.specVersion = 2; })).toEqual(['specVersion：VideoSpec 版本 2 比当前程序支持的版本 1 新，请升级应用后再打开']);
    expect(issuesOf(spec => { spec.specVersion = 0; }).join()).toContain('specVersion 必须是 1');
    for (const issue of issuesOf(spec => { spec.extra = 1; spec.scenes[0].cues[0].text = 5; })) expect(issue).toMatch(/[\u4e00-\u9fff]/u);
  });

  it('enforces main-track timing invariants', () => {
    expect(issuesOf(spec => { spec.scenes[0].startFrame = 5; spec.scenes[1].startFrame = 65; spec.durationFrames = 155; }).join()).toContain('第一个场景必须从第 0 帧开始');
    expect(issuesOf(spec => { spec.scenes[1].startFrame = 70; spec.durationFrames = 160; spec.audio.tracks[1].clips[0].durationFrames = 160; }).join()).toContain('中间有 10 帧空白');
    expect(issuesOf(spec => { spec.scenes[1].startFrame = 50; spec.durationFrames = 140; spec.audio.tracks[1].clips[0].durationFrames = 140; }).join()).toContain('重叠 10 帧，但没有声明转场');
    expect(issuesOf(spec => { spec.scenes[1].startFrame = 50; spec.scenes[1].transitionIn = { type: 'cut', durationFrames: 0 }; spec.durationFrames = 140; spec.audio.tracks[1].clips[0].durationFrames = 140; }).join()).toContain('没有声明转场');
    expect(issuesOf(spec => { spec.scenes[1].startFrame = 50; spec.scenes[1].transitionIn = { type: 'dissolve', durationFrames: 6 }; spec.durationFrames = 140; spec.audio.tracks[1].clips[0].durationFrames = 140; }).join()).toContain('超过了转场时长 6 帧');
    expect(issuesOf(spec => { spec.durationFrames = 151; }).join()).toContain('总时长 151 帧必须等于最后一个场景的结束帧 150');
    expect(issuesOf(spec => { spec.scenes[1].id = 'a'; }).join()).toContain('id 重复');
    expect(issuesOf(spec => { spec.scenes.reverse(); }).join()).toContain('必须按时间顺序排列');
    expect(issuesOf(spec => { spec.scenes[1].transitionIn = { type: 'fade', durationFrames: 91 }; }).join()).toContain('超过了场景时长 90 帧');
  });

  it('allows an overlap that is covered by a declared transition', () => {
    const spec = structuredClone(validSpecInput()) as Mutable;
    spec.scenes[1].startFrame = 54;
    spec.scenes[1].transitionIn = { type: 'dissolve', durationFrames: 6 };
    spec.durationFrames = 144;
    spec.audio.tracks[1].clips[0].durationFrames = 144;
    const parsed = parseVideoSpec(spec);
    expect(sceneEndFrame(parsed.scenes[1])).toBe(144);
    // 转场重叠区返回正在转入的场景。
    expect(sceneAt(parsed, 53)?.id).toBe('a');
    expect(sceneAt(parsed, 54)?.id).toBe('b');
    expect(sceneAt(parsed, 59)?.id).toBe('b');
    expect(sceneAt(parsed, 60)?.id).toBe('b');
    expect(sceneAt(parsed, 53.5)).toBeUndefined();
  });

  it('keeps cues and words inside their scene', () => {
    expect(issuesOf(spec => { spec.scenes[0].cues[1].endFrame = 61; }).join()).toContain('超出了场景时长 60 帧；字幕必须落在所属场景之内');
    expect(issuesOf(spec => { spec.scenes[0].cues[1].startFrame = 20; }).join()).toContain('与上一条重叠或顺序颠倒');
    expect(issuesOf(spec => { spec.scenes[0].cues[0].endFrame = 0; }).join()).toContain('必须大于开始帧');
    expect(issuesOf(spec => { spec.scenes[0].cues[0].words[0].endFrame = 31; }).join()).toContain('不在字幕区间 [0, 30] 内');
  });

  it('validates the audio timeline', () => {
    expect(issuesOf(spec => { spec.audio.tracks[1].clips[0].durationFrames = 151; }).join()).toContain('超出了总时长 150 帧');
    expect(issuesOf(spec => { spec.audio.tracks[0].clips.push({ id: 'n-b', ref: 'b.mp3', startFrame: 50, durationFrames: 30 }); }).join()).toContain('同一条旁白/音乐轨不允许重叠');
    expect(issuesOf(spec => { spec.audio.tracks[1].ducking.triggerTrackIds = ['voice']; }).join()).toContain('闪避触发轨道 "voice" 不存在');
    expect(issuesOf(spec => { spec.audio.tracks[1].ducking.triggerTrackIds = ['music']; }).join()).toContain('不能用自己触发闪避');
    expect(issuesOf(spec => { spec.audio.tracks[1].clips[0].id = 'n-a'; }).join()).toContain('所有音轨之间也必须唯一');
    expect(issuesOf(spec => { spec.audio.tracks[0].clips[0].sceneId = 'z'; }).join()).toContain('所属场景 "z" 不存在');
    expect(issuesOf(spec => { spec.scenes[0].narration.clipId = 'missing'; }).join()).toContain('不在任何 narration 音轨里');
    expect(issuesOf(spec => { spec.audio.tracks[0].clips[0].fadeInFrames = 30; spec.audio.tracks[0].clips[0].fadeOutFrames = 30; }).join()).toContain('淡入加淡出');
    expect(issuesOf(spec => { spec.audio.tracks[0].clips[0].gainDb = 20; }).join()).toContain('片段增益不能高于 +12 dB');
    expect(issuesOf(spec => { spec.outputs = [{ kind: 'mp4' }, { kind: 'mp4' }]; }).join()).toContain('输出类型 "mp4" 重复');
    // sfx 轨允许叠放。
    const sfx = structuredClone(validSpecInput()) as Mutable;
    sfx.audio.tracks.push({ id: 'sfx', kind: 'sfx', clips: [{ id: 's1', ref: 'whoosh.wav', startFrame: 10, durationFrames: 20 }, { id: 's2', ref: 'hit.wav', startFrame: 15, durationFrames: 5 }] });
    expect(validateVideoSpec(sfx).ok).toBe(true);
  });
});

// ───────────── createVideoSpec / helpers ─────────────

describe('createVideoSpec', () => {
  it('lays scenes end to end on the cumulative clock (24 fps)', () => {
    const spec = createVideoSpec({
      route: 'creative',
      title: '测试片',
      canvas: { width: 1920, height: 1080, fps: 24 },
      scenes: [
        { id: 's1', durationMs: 2345, adapter: { kind: 'lemo', codeRef: 'scenes/s1.js' } },
        { id: 's2', durationFrames: 48, adapter: { kind: 'still', imageRef: 'b.png' } },
        { id: 's3', durationMs: 800, adapter: { kind: 'template', templateId: 'fallback-title', params: { title: '结尾' } } },
      ],
    });
    expect(spec.scenes.map(scene => [scene.startFrame, scene.durationFrames])).toEqual([[0, 56], [56, 48], [104, 19]]);
    expect(spec.durationFrames).toBe(123);
    expect(videoSpecDurationMs(spec)).toBe(5125);
    expect(sceneAt(spec, 0)?.id).toBe('s1');
    expect(sceneAt(spec, 55)?.id).toBe('s1');
    expect(sceneAt(spec, 56)?.id).toBe('s2');
    expect(sceneAt(spec, 122)?.id).toBe('s3');
    expect(sceneAt(spec, 123)).toBeUndefined();
    expect(sceneAt(spec, -1)).toBeUndefined();
  });

  it('throws VIDEO_SPEC_INVALID with Chinese details', () => {
    let error: unknown;
    try {
      createVideoSpec({ route: 'html', canvas: { width: 1080, height: 1920, fps: 30 }, scenes: [{ id: 'bad id', durationFrames: 10, adapter: { kind: 'still', imageRef: 'x.png' } }] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'VIDEO_SPEC_INVALID' });
    expect(String((error as Error).message)).toContain('scenes[0].id：场景 id只能包含字母、数字');
    expect(() => createVideoSpec({ route: 'html', canvas: { width: 1080, height: 1920, fps: 25 as never }, scenes: [] })).toThrow(/fps 只支持 24 或 30/);
  });
});

// ───────────── adapters ─────────────

describe('videoSpecFromHtmlVideoState', () => {
  it('converts a realistic HTML route state at 24 fps', () => {
    const state = htmlState();
    const before = structuredClone(state);
    const spec = videoSpecFromHtmlVideoState({ title: '港口的一天', state, canvas: { width: 1080, height: 1920, fps: 24 }, bgm: { ref: 'C:/bgm/calm.mp3' } });
    expect(state).toEqual(before); // 只读转换，不改原数据
    expect(spec.route).toBe('html');
    expect(spec.scenes.map(scene => [scene.id, scene.startFrame, scene.durationFrames])).toEqual([
      ['scene-1', 0, 56],
      ['scene-2', 56, 75],
      ['scene-3', 131, 19], // 0.5 s 配音按现有规则至少 800 ms
    ]);
    expect(spec.durationFrames).toBe(150);
    const [first, second, third] = spec.scenes;
    expect(first.adapter).toEqual({ kind: 'hyperframes', sceneTemplate: 'cinematic-title', compositionRef: 'C:/work/compositions/scene-1.html', motion: 'zoom_in' });
    expect(first.transitionIn).toBeUndefined();
    expect(second.transitionIn).toEqual({ type: 'dissolve', durationFrames: 7 });
    expect(first.sources.map(source => source.role)).toEqual(['background', 'foreground', 'html']);
    expect(second.sources.map(source => source.ref)).toEqual(['C:/work/assets/bg-2.png']); // 不透明前景被排除
    expect(third.sources.map(source => source.ref)).toEqual(['C:/work/assets/bg-3.png']); // 隐藏槽位被排除
    expect(first.cues).toEqual([
      { text: '清晨的港口', startFrame: 0, endFrame: 29, source: 'tts', confidence: 0.98, words: [{ text: '清晨的', startFrame: 0, endFrame: 14 }, { text: '港口', startFrame: 14, endFrame: 29 }] },
      { text: '开始忙碌', startFrame: 29, endFrame: 56, source: 'tts', confidence: 0.97 }, // 2.4 s 钳到场景末尾
    ]);
    expect(second.cues).toEqual([{ text: '货轮缓缓驶入码头。', startFrame: 0, endFrame: 75, source: 'estimated' }]);
    expect(third.cues).toEqual([{ text: '一天就此开始。', startFrame: 0, endFrame: 12, source: 'estimated' }]); // 只覆盖 0.5 s 的配音
    const [narration, music] = spec.audio.tracks;
    expect(narration.clips.map(clip => [clip.id, clip.sceneId, clip.startFrame, clip.durationFrames])).toEqual([
      ['narration-1', 'scene-1', 0, 56],
      ['narration-2', 'scene-2', 56, 75],
      ['narration-3', 'scene-3', 131, 12],
    ]);
    expect(first.narration).toEqual({ text: '清晨的港口开始忙碌。', clipId: 'narration-1' });
    expect(music).toMatchObject({ kind: 'music', targetDb: -22, ducking: { triggerTrackIds: ['narration'], reductionDb: 12 }, clips: [{ ref: 'C:/bgm/calm.mp3', startFrame: 0, durationFrames: 150, loop: true }] });
    expect(spec.loudness.integratedLufs).toBe(-14);
    expect(validateVideoSpec(JSON.parse(JSON.stringify(spec))).ok).toBe(true);
  });

  it('models the cover as a leading still scene and keeps the opening minimum', () => {
    const spec = videoSpecFromHtmlVideoState({ state: htmlState(), canvas: { width: 1080, height: 1920, fps: 24 }, cover: { ref: 'C:/work/cover.png' } });
    expect(spec.scenes.map(scene => [scene.id, scene.adapter.kind, scene.startFrame, scene.durationFrames])).toEqual([
      ['cover', 'still', 0, 34],
      ['scene-1', 'hyperframes', 34, 144],
      ['scene-2', 'hyperframes', 178, 74],
      ['scene-3', 'hyperframes', 252, 19],
    ]);
    expect(spec.scenes[1].transitionIn).toBeDefined();
    expect(spec.audio.tracks[0].clips[0]).toMatchObject({ startFrame: 34, durationFrames: 56 });
    expect(spec.outputs.map(output => output.kind)).toEqual(['mp4', 'cover']);
  });

  it('refuses to guess timing when a voice is missing', () => {
    const state = htmlState();
    state.voices = state.voices.filter(voice => voice.sceneIndex !== 2);
    expect(() => videoSpecFromHtmlVideoState({ state, canvas: { width: 1080, height: 1920, fps: 30 } })).toThrow(expect.objectContaining({ code: 'VIDEO_SPEC_SOURCE_INCOMPLETE' }));
  });
});

describe('videoSpecFromStoryboard', () => {
  it('converts a template-route storyboard with its subtitle track at 30 fps', () => {
    const subtitles = buildSubtitleTrack(storyboardScenes);
    const spec = videoSpecFromStoryboard({
      title: '小岗村',
      canvas: { width: 1080, height: 1920, fps: 30 },
      scenes: storyboardScenes,
      subtitleCues: subtitles.cues,
      narration: storyboardScenes.map(scene => ({ sceneId: scene.id, path: `C:/task/audio/scene-${scene.id}.mp3` })),
      narrationDurationsMs: [{ sceneId: 1, durationMs: 2300 }],
      images: storyboardScenes.map(scene => ({ sceneId: scene.id, path: `C:/task/images/scene-${scene.id}.png` })),
      videos: [{ sceneId: 2, path: 'C:/task/videos/scene-2.mp4', trimStartMs: 500, fit: 'cover' }],
      templateId: 'documentary',
      bgm: { ref: 'C:/bgm/piano.mp3', targetDb: -24 },
      transition: { type: 'dissolve', durationMs: 200 },
    });
    expect(spec.route).toBe('template');
    expect(spec.scenes.map(scene => [scene.startFrame, scene.durationFrames])).toEqual([[0, 72], [72, 95], [167, 56]]);
    expect(spec.durationFrames).toBe(223);
    expect(spec.scenes[0].adapter).toEqual({ kind: 'template', templateId: 'documentary', params: { caption: storyboardScenes[0].cap, imageRef: 'C:/task/images/scene-1.png' } });
    expect(spec.scenes[1].adapter).toEqual({ kind: 'video', videoRef: 'C:/task/videos/scene-2.mp4', trimStartFrame: 15, fit: 'cover', muted: true });
    expect(spec.scenes[1].transitionIn).toEqual({ type: 'dissolve', durationFrames: 6 });
    // 字幕与场景用同一个累计时钟：每个场景的字幕从第 0 帧开始，到场景最后一帧结束，且条数不丢。
    for (const scene of spec.scenes) {
      const expected = subtitles.cues.filter(cue => `scene-${cue.sceneId}` === scene.id);
      expect(scene.cues.map(cue => cue.text)).toEqual(expected.map(cue => cue.text));
      expect(scene.cues[0].startFrame).toBe(0);
      expect(scene.cues.at(-1)?.endFrame).toBe(scene.durationFrames);
    }
    expect(spec.scenes[1].cues.map(cue => cue.text)).toEqual(['这份契约', '改变了中国农村。']);
    expect(spec.audio.tracks[0].clips.map(clip => clip.durationFrames)).toEqual([69, 95, 56]); // 场景 1 的旁白实测 2.3 s
    expect(spec.audio.tracks[1]).toMatchObject({ targetDb: -24, clips: [{ durationFrames: 223, loop: true }] });
    expect(spec.outputs.map(output => output.kind)).toEqual(['mp4', 'srt']);
  });

  it('uses still scenes without a template and rejects missing material', () => {
    const base = {
      canvas: { width: 1920, height: 1080, fps: 24 as const },
      scenes: storyboardScenes.slice(0, 1),
      narration: [{ sceneId: 1, path: 'a.mp3' }],
    };
    const spec = videoSpecFromStoryboard({ ...base, images: [{ sceneId: 1, path: 'a.png' }] });
    expect(spec.scenes[0].adapter).toEqual({ kind: 'still', imageRef: 'a.png' });
    expect(spec.scenes[0].cues).toEqual([{ text: storyboardScenes[0].cap, startFrame: 0, endFrame: 58, source: 'estimated' }]);
    expect(() => videoSpecFromStoryboard(base)).toThrow(expect.objectContaining({ code: 'VIDEO_SPEC_SOURCE_INCOMPLETE' }));
    expect(() => videoSpecFromStoryboard({ ...base, narration: [] })).toThrow(/缺少旁白音频/);
    expect(() => videoSpecFromStoryboard({ ...base, scenes: [{ ...storyboardScenes[0], durationMs: 0 }], images: [{ sceneId: 1, path: 'a.png' }] })).toThrow(/时长无效/);
  });
});

// ───────────── 新项目开关 ─────────────

describe('projectUsesVideoSpec', () => {
  it('is false for old projects and true only with the creation flag', () => {
    const legacyTask = { id: 't1', title: '旧项目', taskKind: 'html-video', pipelineData: '{"version":2}', productionRoute: 'template' };
    expect(projectUsesVideoSpec(legacyTask)).toBe(false);
    expect(projectUsesVideoSpec(null)).toBe(false);
    expect(projectUsesVideoSpec(undefined)).toBe(false);
    expect(projectUsesVideoSpec('videoSpecVersion')).toBe(false);
    for (const value of [undefined, null, 0, -1, 1.5, '1', true]) {
      expect(projectUsesVideoSpec({ ...legacyTask, videoSpecVersion: value })).toBe(false);
    }
    const created = withVideoSpecVersion(legacyTask);
    expect(created.videoSpecVersion).toBe(1);
    expect(projectUsesVideoSpec(created)).toBe(true);
    expect(legacyTask).not.toHaveProperty('videoSpecVersion');
    // 更新版本的新项目仍属于新架构；读取它的 spec 时会得到“请升级”的明确提示。
    expect(projectUsesVideoSpec({ videoSpecVersion: 2 })).toBe(true);
  });

  it('exposes a single typed spec for consumers', () => {
    const spec: VideoSpec = parseVideoSpec(validSpecInput());
    expect(spec.scenes[0].adapter.kind).toBe('still');
  });
});
