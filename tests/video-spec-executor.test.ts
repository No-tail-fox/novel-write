import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/app-error';
import { allocateFrameCounts, createVideoSpec, frameAt, type VideoSpec } from '../src/shared/video-spec';
import {
  VideoSpecExecutorNodeError,
  applyVoiceTimings,
  parseVideoSpecExecutorCheckpoint,
  runVideoSpecExecutor,
  videoSpecExecutorHash,
  type SceneRenderRequest,
  type VideoSpecExecutorCheckpoint,
  type VideoSpecExecutorDeps,
  type VideoSpecExecutorEvent,
  type VoiceSynthesisRequest,
} from '../src/shared/video-spec-executor';
import { SIDECAR_OUTPUT_COLOR_ARGS } from '../src/shared/storybound-sidecar';
import {
  VIDEO_SPEC_OUTPUT_COLOR_ARGS,
  concatListLine,
  muxVideoSpecFilmArgs,
  runVideoSpecExecutorForProject,
  videoSpecExecutorStrategy,
} from '../electron/video-spec-executor-runtime';

// ───────────── fixtures ─────────────

interface DraftScene { id: string; narration?: string; frames?: number }

function draftSpec(scenes: DraftScene[] = [{ id: 's1', narration: '第一段' }, { id: 's2', narration: '第二段' }, { id: 's3', narration: '第三段' }]): VideoSpec {
  const total = scenes.reduce((sum, scene) => sum + (scene.frames ?? 30), 0);
  return createVideoSpec({
    route: 'html',
    canvas: { width: 1080, height: 1920, fps: 30 },
    scenes: scenes.map(scene => ({
      id: scene.id,
      durationFrames: scene.frames ?? 30,
      adapter: { kind: 'hyperframes' as const, compositionRef: `${scene.id}.html` },
      ...(scene.narration ? { narration: { text: scene.narration } } : {}),
    })),
    audio: {
      tracks: [
        { id: 'narration', kind: 'narration', clips: [] },
        { id: 'music', kind: 'music', ducking: { triggerTrackIds: ['narration'], reductionDb: 12 }, clips: [{ id: 'bgm', ref: 'bgm.mp3', startFrame: 0, durationFrames: total, loop: true }] },
      ],
    },
  });
}

interface FakeOptions {
  voiceMs?: Record<string, number>;
  failVoice?: (request: VoiceSynthesisRequest) => unknown;
  failRender?: (request: SceneRenderRequest) => unknown;
  onVoice?: (request: VoiceSynthesisRequest) => void | Promise<void>;
  onRender?: (request: SceneRenderRequest) => void | Promise<void>;
  gate?: () => Promise<{ status: 'passed' | 'warning' | 'failed' | 'error'; summary?: string }>;
}

function fake(options: FakeOptions = {}) {
  const calls: string[] = [];
  const saved: VideoSpecExecutorCheckpoint[] = [];
  const deps: VideoSpecExecutorDeps = {
    async synthesizeVoice(request) {
      calls.push(`voice:${request.sceneId}`);
      await options.onVoice?.(request);
      const error = options.failVoice?.(request);
      if (error) throw error;
      return { ref: `vo/${request.sceneId}.wav`, durationMs: options.voiceMs?.[request.sceneId] ?? 1500, receiptId: `tts-${request.sceneId}-${request.attempt}` };
    },
    async renderScene(request) {
      calls.push(`render:${request.scene.id}`);
      await options.onRender?.(request);
      const error = options.failRender?.(request);
      if (error) throw error;
      request.onProgress({ captured: request.scene.durationFrames, total: request.scene.durationFrames });
      return { ref: `seg/${request.scene.id}.mp4`, frames: request.scene.durationFrames };
    },
    async renderAudio() { calls.push('audio'); return { ref: 'audio.wav' }; },
    async mux(request) {
      calls.push('mux');
      expect(request.segments.map(segment => segment.ref)).toEqual(request.spec.scenes.map(scene => `seg/${scene.id}.mp4`));
      return { ref: 'film.mp4' };
    },
    async gate() { calls.push('gate'); return options.gate ? options.gate() : { status: 'passed', summary: '通过' }; },
    saveCheckpoint(checkpoint) { saved.push(structuredClone(checkpoint)); },
    delay: async () => {},
  };
  return { deps, calls, saved };
}

const connReset = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const connRefused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ───────────── tests ─────────────

describe('video-spec executor: voice first, frame windows from measured durations', () => {
  it('synthesizes every narration before any scene work and windows scenes with the canonical allocator', async () => {
    const spec = draftSpec();
    const before = structuredClone(spec);
    const voiceMs = { s1: 2345, s2: 3100, s3: 1234 };
    const { deps, calls } = fake({ voiceMs });
    const result = await runVideoSpecExecutor(spec, deps);

    expect(result.status).toBe('completed');
    expect(result.filmRef).toBe('film.mp4');
    const lastVoice = Math.max(...['s1', 's2', 's3'].map(id => calls.indexOf(`voice:${id}`)));
    const firstRender = Math.min(...['s1', 's2', 's3'].map(id => calls.indexOf(`render:${id}`)));
    expect(lastVoice).toBeLessThan(firstRender);
    expect(calls.slice(-3)).toEqual(['audio', 'mux', 'gate']);

    const counts = allocateFrameCounts([2345, 3100, 1234], 30);
    const timed = result.spec!;
    expect(timed.scenes.map(scene => scene.durationFrames)).toEqual(counts);
    expect(timed.scenes.map(scene => scene.startFrame)).toEqual([0, counts[0], counts[0] + counts[1]]);
    expect(timed.durationFrames).toBe(frameAt(2345 + 3100 + 1234, 30));
    const narration = timed.audio.tracks.find(track => track.id === 'narration')!;
    expect(narration.clips.map(clip => [clip.ref, clip.sceneId, clip.startFrame])).toEqual([
      ['vo/s1.wav', 's1', 0], ['vo/s2.wav', 's2', counts[0]], ['vo/s3.wav', 's3', counts[0] + counts[1]],
    ]);
    expect(timed.scenes.every(scene => narration.clips.some(clip => clip.id === scene.narration?.clipId))).toBe(true);
    // 铺满全片的 BGM 随新总时长伸缩
    expect(timed.audio.tracks.find(track => track.id === 'music')!.clips[0].durationFrames).toBe(timed.durationFrames);
    // 输入 spec 不被修改
    expect(spec).toEqual(before);
  });

  it('keeps un-narrated scenes at their authored frames and applies the minimum scene length', () => {
    const spec = draftSpec([{ id: 'a', narration: '短' }, { id: 'b', frames: 45 }, { id: 'c', narration: '长一点' }]);
    const timed = applyVoiceTimings(spec, new Map([
      ['a', { ref: 'a.wav', durationMs: 500 }],
      ['c', { ref: 'c.wav', durationMs: 2000, cues: [{ text: '长一点', startMs: 0, endMs: 1900 }] }],
    ]));
    expect(timed.scenes.map(scene => [scene.startFrame, scene.durationFrames])).toEqual([[0, 24], [24, 45], [69, 60]]);
    const narration = timed.audio.tracks.find(track => track.kind === 'narration')!.clips;
    expect(narration.find(clip => clip.sceneId === 'a')!.durationFrames).toBe(frameAt(500, 30));
    expect(timed.scenes[2].cues).toEqual([{ text: '长一点', startFrame: 0, endFrame: frameAt(1900, 30), source: 'tts' }]);
  });
});

describe('video-spec executor: parallel scenes with failure isolation', () => {
  it('never runs more scenes at once than the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const { deps } = fake({
      onRender: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 15));
        active -= 1;
      },
    });
    const spec = draftSpec(['a', 'b', 'c', 'd', 'e'].map(id => ({ id, narration: id })));
    const result = await runVideoSpecExecutor(spec, deps, { sceneConcurrency: 2 });
    expect(result.status).toBe('completed');
    expect(peak).toBe(2);
  });

  it('isolates a failed scene, reports its code, and retries just that scene later', async () => {
    let failS2 = true;
    const first = fake({ failRender: request => (failS2 && request.scene.id === 's2' ? new AppError('CAPTURE_HOST_PAGE_ERROR', '场景页面报错') : undefined) });
    const run1 = await runVideoSpecExecutor(draftSpec(), first.deps, { sceneConcurrency: 3 });
    expect(run1.status).toBe('blocked');
    expect(first.calls).toEqual(expect.arrayContaining(['render:s1', 'render:s2', 'render:s3', 'audio']));
    expect(first.calls).not.toContain('mux');
    expect(run1.failures).toEqual([expect.objectContaining({ nodeId: 'render:s2', sceneId: 's2', status: 'rejected', code: 'CAPTURE_HOST_PAGE_ERROR', action: 'fail' })]);
    expect(run1.checkpoint.nodes['render:s1'].status).toBe('received');
    expect(run1.checkpoint.nodes['render:s3'].status).toBe('received');

    // 不点名重试时，失败场景保持失败，其他节点全部跳过
    const second = fake();
    const run2 = await runVideoSpecExecutor(draftSpec(), second.deps, { checkpoint: roundTrip(run1.checkpoint) });
    expect(second.calls).toEqual([]);
    expect(run2.status).toBe('blocked');

    failS2 = false;
    const third = fake();
    const run3 = await runVideoSpecExecutor(draftSpec(), third.deps, { checkpoint: roundTrip(run2.checkpoint), retryScenes: ['s2'] });
    expect(third.calls).toEqual(['render:s2', 'mux', 'gate']);
    expect(run3.status).toBe('completed');
    expect(run3.checkpoint.nodes['render:s2'].attempts).toBe(2);
  });

  it('auto-retries a retryable free step within the shared retry budget', async () => {
    const { deps, calls } = fake({ failRender: request => (request.scene.id === 's1' && request.attempt === 1 ? new AppError('CAPTURE_HOST_LOAD_TIMEOUT', '页面加载超时', true) : undefined) });
    const result = await runVideoSpecExecutor(draftSpec(), deps);
    expect(result.status).toBe('completed');
    expect(calls.filter(call => call === 'render:s1')).toHaveLength(2);
    expect(result.checkpoint.nodes['render:s1']).toMatchObject({ status: 'received', attempts: 2, autoRetries: 1 });
    expect(result.checkpoint.retryBudget).toMatchObject({ used: 1, nodes: { 'render:s1': 1 } });
  });

  it('blocks only the scene whose paid authoring result is unknown', async () => {
    const { deps, calls } = fake();
    const authorCalls: string[] = [];
    deps.authorScene = async request => {
      authorCalls.push(request.scene.id);
      if (request.scene.id === 's2') throw connReset();
      return { ref: `${request.scene.id}.authored.html` };
    };
    const result = await runVideoSpecExecutor(draftSpec(), deps);
    expect(result.status).toBe('blocked');
    expect(authorCalls.sort()).toEqual(['s1', 's2', 's3']);
    expect(calls).toEqual(expect.arrayContaining(['render:s1', 'render:s3']));
    expect(calls).not.toContain('render:s2');
    expect(result.failures).toEqual([expect.objectContaining({ nodeId: 'author:s2', status: 'unknown', action: 'await-user' })]);
  });
});

describe('video-spec executor: paid results are never resent automatically', () => {
  it('stops at unknown for a paid TTS call, does not resend on resume, and resends only after explicit confirmation', async () => {
    const first = fake({ failVoice: request => (request.sceneId === 's2' ? connReset() : undefined) });
    const run1 = await runVideoSpecExecutor(draftSpec(), first.deps);
    expect(run1.status).toBe('blocked');
    expect(run1.spec).toBeUndefined();
    expect(first.calls.filter(call => call === 'voice:s2')).toHaveLength(1);
    expect(first.calls.some(call => call.startsWith('render:'))).toBe(false);
    expect(run1.failures).toEqual([expect.objectContaining({ nodeId: 'voice:s2', status: 'unknown', action: 'await-user' })]);

    const second = fake();
    const run2 = await runVideoSpecExecutor(draftSpec(), second.deps, { checkpoint: roundTrip(run1.checkpoint) });
    expect(second.calls).toEqual([]);
    expect(run2.status).toBe('blocked');

    const third = fake();
    const run3 = await runVideoSpecExecutor(draftSpec(), third.deps, { checkpoint: roundTrip(run2.checkpoint), resendUnknownNodeIds: ['voice:s2'] });
    expect(third.calls.filter(call => call.startsWith('voice:'))).toEqual(['voice:s2']);
    expect(run3.status).toBe('completed');
    expect(run3.checkpoint.nodes['voice:s2'].attempts).toBe(2);
  });

  it('recovers an unknown paid result from its receipt for free instead of resending', async () => {
    const { deps, calls } = fake({ failVoice: request => (request.sceneId === 's2' ? connReset() : undefined) });
    const recovered: Array<{ idempotencyKeys: string[] }> = [];
    deps.recover = { voice: async request => { recovered.push(request); return { ref: 'vo/s2-recovered.wav', durationMs: 2000 }; } };
    const result = await runVideoSpecExecutor(draftSpec(), deps);
    expect(result.status).toBe('completed');
    expect(calls.filter(call => call === 'voice:s2')).toHaveLength(1);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].idempotencyKeys[0]).toMatch(/^voice:s2@[0-9a-f]{16}#1$/u);
    expect(result.spec!.audio.tracks.find(track => track.kind === 'narration')!.clips.find(clip => clip.sceneId === 's2')!.ref).toBe('vo/s2-recovered.wav');
  });

  it('auto-resends a paid single-request call that provably never left the machine (not-sent)', async () => {
    const { deps, calls } = fake({ failVoice: request => (request.sceneId === 's1' && request.attempt === 1 ? connRefused() : undefined) });
    const result = await runVideoSpecExecutor(draftSpec(), deps);
    expect(result.status).toBe('completed');
    expect(calls.filter(call => call === 'voice:s1')).toHaveLength(2);
    expect(result.checkpoint.retryBudget.used).toBe(1);
  });

  it('keeps a definitive paid refusal rejected until it is retried by id', async () => {
    let refuse = true;
    const refusal = () => new VideoSpecExecutorNodeError('PROVIDER_CONTENT_POLICY', '内容未通过服务商审核', { outcome: 'rejected', retry: 'never' });
    const first = fake({ failVoice: request => (refuse && request.sceneId === 's1' ? refusal() : undefined) });
    const run1 = await runVideoSpecExecutor(draftSpec(), first.deps);
    expect(run1.failures).toEqual([expect.objectContaining({ nodeId: 'voice:s1', status: 'rejected', code: 'PROVIDER_CONTENT_POLICY' })]);
    expect(first.calls.filter(call => call === 'voice:s1')).toHaveLength(1);
    refuse = false;
    const second = fake();
    await runVideoSpecExecutor(draftSpec(), second.deps, { checkpoint: run1.checkpoint });
    expect(second.calls).toEqual([]);
    const third = fake();
    const run3 = await runVideoSpecExecutor(draftSpec(), third.deps, { checkpoint: run1.checkpoint, retryNodeIds: ['voice:s1'] });
    expect(run3.status).toBe('completed');
    expect(third.calls[0]).toBe('voice:s1');
  });
});

describe('video-spec executor: checkpoints and resume', () => {
  it('resumes a completed run without calling any dependency', async () => {
    const first = fake();
    const run1 = await runVideoSpecExecutor(draftSpec(), first.deps);
    const events: VideoSpecExecutorEvent[] = [];
    const second = fake();
    const run2 = await runVideoSpecExecutor(draftSpec(), second.deps, { checkpoint: roundTrip(run1.checkpoint), onProgress: event => events.push(event) });
    expect(second.calls).toEqual([]);
    expect(run2).toMatchObject({ status: 'completed', filmRef: 'film.mp4', gate: { status: 'passed', advisory: true } });
    expect(events.filter(event => event.type === 'node').every(event => event.type === 'node' && event.state === 'skipped')).toBe(true);
  });

  it('does not resend a paid call that was in flight when the process crashed', async () => {
    let crash: VideoSpecExecutorCheckpoint | undefined;
    const first = fake({ onVoice: request => { if (request.sceneId === 's1') crash = structuredClone(first.saved.at(-1)); } });
    await runVideoSpecExecutor(draftSpec(), first.deps, { voiceConcurrency: 1 });
    expect(crash!.nodes['voice:s1']).toMatchObject({ status: 'unknown', attempts: 1 });
    expect(crash!.nodes['voice:s2']).toBeUndefined();

    const resumed = fake();
    const result = await runVideoSpecExecutor(draftSpec(), resumed.deps, { checkpoint: roundTrip(crash) });
    expect(resumed.calls).toEqual(['voice:s2', 'voice:s3']);
    expect(result.status).toBe('blocked');
    expect(result.failures).toEqual([expect.objectContaining({ nodeId: 'voice:s1', status: 'unknown', code: 'VIDEO_SPEC_EXECUTOR_RESULT_UNKNOWN' })]);
  });

  it('re-runs a free step that was in flight when the process crashed, skipping completed paid work', async () => {
    let crash: VideoSpecExecutorCheckpoint | undefined;
    const first = fake({ onRender: request => { if (request.scene.id === 's2') crash = structuredClone(first.saved.at(-1)); } });
    await runVideoSpecExecutor(draftSpec(), first.deps, { sceneConcurrency: 1 });
    expect(crash!.nodes['render:s2'].status).toBe('unknown');
    const resumed = fake();
    const result = await runVideoSpecExecutor(draftSpec(), resumed.deps, { checkpoint: crash, sceneConcurrency: 1 });
    expect(resumed.calls).toEqual(['render:s2', 'render:s3', 'audio', 'mux', 'gate']);
    expect(result.status).toBe('completed');
  });

  it('derives node ids and hashes deterministically from spec content', async () => {
    const a = await runVideoSpecExecutor(draftSpec(), fake().deps);
    const b = await runVideoSpecExecutor(draftSpec(), fake().deps);
    const shape = (checkpoint: VideoSpecExecutorCheckpoint) => Object.values(checkpoint.nodes).map(node => [node.id, node.hash]).sort();
    expect(shape(a.checkpoint)).toEqual(shape(b.checkpoint));
    expect(Object.keys(a.checkpoint.nodes).sort()).toEqual(['audio', 'gate', 'mux', 'render:s1', 'render:s2', 'render:s3', 'voice:s1', 'voice:s2', 'voice:s3']);
    expect(a.checkpoint.specHash).toBe(videoSpecExecutorHash(draftSpec()));
    const profiled = await runVideoSpecExecutor(draftSpec(), fake().deps, { voiceProfile: 'warm-female' });
    expect(profiled.checkpoint.nodes['voice:s1'].hash).not.toBe(a.checkpoint.nodes['voice:s1'].hash);
    expect(videoSpecExecutorHash({ b: 1, a: [1, 2] })).toBe(videoSpecExecutorHash({ a: [1, 2], b: 1 }));
  });

  it('re-synthesizes only the narration whose text changed', async () => {
    const run1 = await runVideoSpecExecutor(draftSpec(), fake().deps);
    const second = fake();
    const edited = draftSpec([{ id: 's1', narration: '第一段' }, { id: 's2', narration: '改过的第二段' }, { id: 's3', narration: '第三段' }]);
    const run2 = await runVideoSpecExecutor(edited, second.deps, { checkpoint: run1.checkpoint });
    expect(second.calls.filter(call => call.startsWith('voice:'))).toEqual(['voice:s2']);
    expect(run2.status).toBe('completed');
  });

  it('rejects a corrupt checkpoint instead of silently starting over', async () => {
    const { deps, calls } = fake();
    await expect(runVideoSpecExecutor(draftSpec(), deps, { checkpoint: { kind: 'video-spec-executor', version: 1, nodes: 'x' } })).rejects.toMatchObject({ code: 'VIDEO_SPEC_EXECUTOR_CHECKPOINT_INVALID' });
    expect(calls).toEqual([]);
    expect(parseVideoSpecExecutorCheckpoint(null)).toBeUndefined();
  });

  it('fails the run when the checkpoint cannot be saved before a paid request', async () => {
    const { deps, calls } = fake();
    deps.saveCheckpoint = () => { throw new Error('disk full'); };
    await expect(runVideoSpecExecutor(draftSpec(), deps)).rejects.toMatchObject({ code: 'VIDEO_SPEC_EXECUTOR_CHECKPOINT_FAILED' });
    expect(calls).toEqual([]);
  });
});

describe('video-spec executor: cancellation, progress and advisory gate', () => {
  it('stops scheduling on abort, keeps finished work, and resumes afterwards', async () => {
    const controller = new AbortController();
    const first = fake({
      onRender: async request => {
        if (request.scene.id !== 's1') return;
        controller.abort();
        expect(request.signal.aborted).toBe(true);
        throw abortError();
      },
    });
    const run1 = await runVideoSpecExecutor(draftSpec(), first.deps, { signal: controller.signal, sceneConcurrency: 1 });
    expect(run1.status).toBe('cancelled');
    expect(first.calls).toEqual(['voice:s1', 'voice:s2', 'voice:s3', 'render:s1']);
    expect(run1.checkpoint.nodes['render:s1'].status).toBe('not-sent');
    expect(run1.checkpoint.nodes['voice:s1'].status).toBe('received');

    const second = fake();
    const run2 = await runVideoSpecExecutor(draftSpec(), second.deps, { checkpoint: run1.checkpoint, sceneConcurrency: 1 });
    expect(second.calls).toEqual(['render:s1', 'render:s2', 'render:s3', 'audio', 'mux', 'gate']);
    expect(run2.status).toBe('completed');
  });

  it('treats a paid call cancelled in flight as unknown (never auto-resent)', async () => {
    const controller = new AbortController();
    const { deps } = fake({ onVoice: request => { if (request.sceneId === 's1') { controller.abort(); throw abortError(); } } });
    const result = await runVideoSpecExecutor(draftSpec(), deps, { signal: controller.signal, voiceConcurrency: 1 });
    expect(result.status).toBe('cancelled');
    expect(result.checkpoint.nodes['voice:s1']).toMatchObject({ status: 'unknown', error: { action: 'cancelled' } });
    expect(result.failures[0].hint).toContain('不会自动重发');
  });

  it('does nothing when started with an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, calls } = fake();
    const result = await runVideoSpecExecutor(draftSpec(), deps, { signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect(calls).toEqual([]);
  });

  it('emits stage, node and scene-progress events in pipeline order', async () => {
    const events: VideoSpecExecutorEvent[] = [];
    await runVideoSpecExecutor(draftSpec(), fake().deps, { onProgress: event => events.push(event) });
    expect(events.filter(event => event.type === 'stage' && event.state === 'start').map(event => event.type === 'stage' && event.stage)).toEqual(['voice', 'scenes', 'audio', 'mux', 'gate']);
    expect(events.filter(event => event.type === 'scene-progress').map(event => event.type === 'scene-progress' && event.sceneId).sort()).toEqual(['s1', 's2', 's3']);
    const nodeEvents = events.filter((event): event is Extract<VideoSpecExecutorEvent, { type: 'node' }> => event.type === 'node');
    expect(nodeEvents.find(event => event.nodeId === 'voice:s1' && event.state === 'running')).toBeTruthy();
    expect(nodeEvents.at(-1)).toMatchObject({ nodeId: 'gate', state: 'received', completed: 9, total: 9 });
  });

  it('treats the final gate as advisory: failures and crashes never block delivery', async () => {
    const failed = await runVideoSpecExecutor(draftSpec(), fake({ gate: async () => ({ status: 'failed', summary: '响度偏离' }) }).deps);
    expect(failed).toMatchObject({ status: 'completed', filmRef: 'film.mp4', gate: { status: 'failed', summary: '响度偏离', advisory: true } });
    const crashed = await runVideoSpecExecutor(draftSpec(), fake({ gate: async () => { throw new AppError('FINAL_GATE_ERROR', 'probe 失败'); } }).deps);
    expect(crashed.status).toBe('completed');
    expect(crashed.gate).toMatchObject({ status: 'error', advisory: true });
    expect(crashed.gate!.summary).toContain('FINAL_GATE_ERROR');
    expect(crashed.failures).toEqual([]);
  });
});

describe('video-spec executor runtime wiring (no ffmpeg)', () => {
  it('uses the unified executor only for VideoSpec projects (ADR-03)', async () => {
    expect(videoSpecExecutorStrategy({ videoSpecVersion: 1 })).toBe('unified');
    expect(videoSpecExecutorStrategy({})).toBe('legacy');
    // 版本比程序新的项目仍是新架构项目：走 unified，由 parseVideoSpec 报“请升级”，不悄悄退回旧管线。
    expect(videoSpecExecutorStrategy({ videoSpecVersion: 2 })).toBe('unified');
    expect(videoSpecExecutorStrategy({ videoSpecVersion: 0 })).toBe('legacy');
    expect(videoSpecExecutorStrategy(null)).toBe('legacy');
    let called = false;
    await expect(runVideoSpecExecutorForProject({ id: 'old' }, draftSpec(), { workDir: '.', synthesizeVoice: async () => { called = true; return { ref: 'x', durationMs: 1 }; } }))
      .rejects.toMatchObject({ code: 'VIDEO_SPEC_EXECUTOR_LEGACY_PROJECT' });
    expect(called).toBe(false);
  });

  it('tags the final encode bt709 / tv exactly like the Storybound sidecar', () => {
    expect([...VIDEO_SPEC_OUTPUT_COLOR_ARGS]).toEqual([...SIDECAR_OUTPUT_COLOR_ARGS]);
    const args = muxVideoSpecFilmArgs({ listPath: 'list.txt', audioPath: 'a.wav', outputPath: 'out.mp4', fps: 30, totalFrames: 120 });
    expect(args.join(' ')).toContain('-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc iec61966-2-1');
    expect(args.join(' ')).toContain('-frames:v 120 -r 30');
    expect(concatListLine("C:\\work\\it's\\a.mp4")).toBe("file 'file:C:/work/it'\\''s/a.mp4'");
  });
});
