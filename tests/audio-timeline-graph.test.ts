import { describe, expect, it } from 'vitest';
import {
  AUDIO_TIMELINE_DUCKING, AudioTimelineError, audioTimelineStrategy, buildAudioTimelineGraph, ffmpegInputUrl,
} from '../src/shared/audio-timeline-graph';
import { FINAL_FILM_LOUDNESS, loudnormMeasureFilter, type LoudnormMeasurement } from '../src/shared/loudness';
import { VIDEO_SPEC_VERSION, type VideoSpecAudioTrackInput, type VideoSpecFps, type VideoSpecInput } from '../src/shared/video-spec';

function spec(fps: VideoSpecFps, durationFrames: number, tracks: VideoSpecAudioTrackInput[], extra: Partial<VideoSpecInput> = {}): VideoSpecInput {
  return {
    specVersion: VIDEO_SPEC_VERSION,
    route: 'template',
    canvas: { width: 320, height: 180, fps },
    durationFrames,
    scenes: [{ id: 's1', startFrame: 0, durationFrames, adapter: { kind: 'still', imageRef: 'a.png' } }],
    audio: { sampleRate: 48_000, tracks },
    ...extra,
  };
}

const inputsFor = (ids: string[]) => new Map(ids.map(id => [id, `C:\\media dir\\${id}.wav`]));
const measurement: LoudnormMeasurement = { input_i: '-20.31', input_tp: '-5.02', input_lra: '3.10', input_thresh: '-30.55', target_offset: '0.12' };

describe('buildAudioTimelineGraph', () => {
  it('places every clip at an exact sample offset at 24 and 30 fps (no float ms)', () => {
    for (const [fps, perFrame] of [[24, 2000], [30, 1600]] as const) {
      const graph = buildAudioTimelineGraph(spec(fps, 300, [
        { id: 'narration', kind: 'narration', clips: [
          { id: 'n1', ref: 'n1.wav', startFrame: 0, durationFrames: 37 },
          { id: 'n2', ref: 'n2.wav', startFrame: 37, durationFrames: 101 },
          { id: 'n3', ref: 'n3.wav', startFrame: 199, durationFrames: 101 },
        ] },
      ]), inputsFor(['n1', 'n2', 'n3']));
      expect(graph.durationSamples).toBe(300 * perFrame);
      expect(graph.clips.map(clip => clip.delaySamples)).toEqual([0, 37 * perFrame, 199 * perFrame]);
      expect(graph.clips.map(clip => clip.lengthSamples)).toEqual([37 * perFrame, 101 * perFrame, 101 * perFrame]);
      expect(graph.filterComplex).toContain(`adelay=delays=${37 * perFrame}S:all=1`);
      expect(graph.filterComplex).toContain(`adelay=delays=${199 * perFrame}S:all=1`);
      // First clip starts at 0 → no adelay at all; no ms-based delay anywhere.
      expect(graph.filterComplex.match(/adelay=/g)).toHaveLength(2);
      expect(graph.filterComplex).not.toMatch(/adelay=delays=[\d.]+(?!S)[:|,\]]/);
      expect(graph.filterComplex).toContain(`atrim=start_sample=0:end_sample=${37 * perFrame}`);
      // Whole timeline padded/trimmed to the exact total before and after loudnorm.
      expect(graph.filterComplex.split(`apad=whole_len=${300 * perFrame},atrim=end_sample=${300 * perFrame}`).length - 1).toBeGreaterThanOrEqual(3);
      expect(graph.inputs).toEqual(['-i', 'file:C:\\media dir\\n1.wav', '-i', 'file:C:\\media dir\\n2.wav', '-i', 'file:C:\\media dir\\n3.wav']);
      expect(graph.outputLabel).toBe('aout');
      expect(graph.filterComplex.endsWith('[aout]')).toBe(true);
    }
  });

  it('builds one graph: per-track amix normalize=0, final amix, aresample 48000 and unique labels', () => {
    const graph = buildAudioTimelineGraph(spec(30, 90, [
      { id: 'narration', kind: 'narration', clips: [
        { id: 'n1', ref: 'n1.wav', startFrame: 0, durationFrames: 30 },
        { id: 'n2', ref: 'n2.wav', startFrame: 30, durationFrames: 30 },
      ] },
      { id: 'sfx', kind: 'sfx', gainDb: -3, clips: [{ id: 'x1', ref: 'x.wav', startFrame: 10, durationFrames: 5, gainDb: 2 }] },
    ]), inputsFor(['n1', 'n2', 'x1']));
    const fc = graph.filterComplex;
    expect(fc).toContain('[c0_0][c0_1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0');
    expect(fc).toContain('[t0][t1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0');
    expect(fc).toContain('volume=2dB');
    expect(fc).toContain('volume=-3dB');
    expect(fc).toContain('aresample=48000');
    expect(fc).not.toContain('sidechaincompress');
    expect(fc).toContain(loudnormMeasureFilter(FINAL_FILM_LOUDNESS));
    expect(graph.loudnorm).toBe('measure');
    // Each output label is defined exactly once.
    const defined = [...fc.matchAll(/\[([a-z0-9_]+)\](?=;|$)/g)].map(match => match[1]);
    expect(new Set(defined).size).toBe(defined.length);
    expect(defined).toEqual(expect.arrayContaining(['c0_0', 'c0_1', 'c1_2', 't0', 't1', 'mix', 'aout']));
    // Every filter-produced label is consumed (except the output).
    for (const label of defined.filter(item => item !== 'aout')) expect(fc.split(`[${label}]`).length - 1).toBe(2);
    // Deterministic.
    expect(buildAudioTimelineGraph(spec(30, 90, [
      { id: 'narration', kind: 'narration', clips: [
        { id: 'n1', ref: 'n1.wav', startFrame: 0, durationFrames: 30 },
        { id: 'n2', ref: 'n2.wav', startFrame: 30, durationFrames: 30 },
      ] },
      { id: 'sfx', kind: 'sfx', gainDb: -3, clips: [{ id: 'x1', ref: 'x.wav', startFrame: 10, durationFrames: 5, gainDb: 2 }] },
    ]), inputsFor(['n1', 'n2', 'x1'])).filterComplex).toBe(fc);
  });

  it('loops with -stream_loop, trims from sourceStartMs in samples and fades in/out by samples', () => {
    const graph = buildAudioTimelineGraph(spec(24, 240, [
      { id: 'music', kind: 'music', targetDb: -18, clips: [{ id: 'bgm', ref: 'bgm.mp3', startFrame: 24, durationFrames: 216, sourceStartMs: 1500, fadeInFrames: 12, fadeOutFrames: 48, loop: true }] },
    ]), new Map([['bgm.mp3', 'D:/music/bgm.mp3']]));
    expect(graph.inputs).toEqual(['-stream_loop', '-1', '-i', 'file:D:/music/bgm.mp3']);
    const length = 216 * 2000;
    const fc = graph.filterComplex;
    expect(fc).toContain(`atrim=start_sample=${1500 * 48}:end_sample=${1500 * 48 + length}`);
    expect(fc).toContain(`apad=whole_len=${length},atrim=end_sample=${length}`);
    expect(fc).toContain('afade=t=in:ss=0:ns=24000');
    expect(fc).toContain(`afade=t=out:ss=${length - 96000}:ns=96000`);
    expect(fc).toContain('adelay=delays=48000S:all=1');
    expect(fc).toContain('volume=-18dB'); // targetDb = fixed gain (legacy bgm_target_db semantics)
    expect(graph.clips[0]).toMatchObject({ loop: true, sourceStartSamples: 72000, fadeInSamples: 24000, fadeOutSamples: 96000 });
    // A non-looping clip gets no -stream_loop.
    const plain = buildAudioTimelineGraph(spec(24, 48, [{ id: 'sfx', kind: 'sfx', clips: [{ id: 'a', ref: 'a.wav', startFrame: 0, durationFrames: 48 }] }]), inputsFor(['a']));
    expect(plain.inputs).toEqual(['-i', 'file:C:\\media dir\\a.wav']);
    expect(plain.filterComplex).not.toContain('afade');
  });

  it('adds sidechaincompress ducking only when configured and the trigger track has clips', () => {
    const tracks = (ducking: boolean, triggerClips = true): VideoSpecAudioTrackInput[] => [
      { id: 'narration', kind: 'narration', clips: triggerClips ? [{ id: 'n1', ref: 'n1.wav', startFrame: 10, durationFrames: 30 }] : [] },
      { id: 'music', kind: 'music', ...(ducking ? { ducking: { triggerTrackIds: ['narration'], reductionDb: 12, attackMs: 50, releaseMs: 300 } } : {}),
        clips: [{ id: 'm1', ref: 'm.wav', startFrame: 0, durationFrames: 60, loop: true }] },
    ];
    const inputs = inputsFor(['n1', 'm1']);
    const ducked = buildAudioTimelineGraph(spec(30, 60, tracks(true)), inputs);
    expect(ducked.filterComplex).toContain('[t0]asplit=2[t0s0][t0s1]');
    expect(ducked.filterComplex).toMatch(/\[t1\]\[t0s1\]sidechaincompress=threshold=0\.003162:ratio=1\.6667:attack=50:release=300:makeup=1:detection=rms/);
    expect(ducked.filterComplex).toContain('[t0s0][d1]amix=inputs=2');
    expect(ducked.tracks.find(track => track.trackId === 'music')?.ducking).toMatchObject({ triggerTrackIds: ['narration'], ratio: 1.6667, reductionDb: 12 });
    // nominal −20 dBFS trigger 30 dB above threshold: reduction = 30 × (1 − 1/ratio) = 12 dB.
    const ratio = ducked.tracks[1].ducking!.ratio;
    expect((AUDIO_TIMELINE_DUCKING.nominalTriggerDb - AUDIO_TIMELINE_DUCKING.thresholdDb) * (1 - 1 / ratio)).toBeCloseTo(12, 2);

    const plain = buildAudioTimelineGraph(spec(30, 60, tracks(false)), inputs);
    expect(plain.filterComplex).not.toContain('sidechaincompress');
    expect(plain.filterComplex).not.toContain('asplit');
    expect(plain.tracks.every(track => track.ducking === null)).toBe(true);

    const silentTrigger = buildAudioTimelineGraph(spec(30, 60, tracks(true, false)), inputsFor(['m1']));
    expect(silentTrigger.filterComplex).not.toContain('sidechaincompress');

    const big = buildAudioTimelineGraph(spec(30, 60, [tracks(true)[0], { ...tracks(true)[1], ducking: { triggerTrackIds: ['narration'], reductionDb: 40 } }]), inputs);
    expect(big.tracks[1].ducking?.ratio).toBe(20);
  });

  it('mixes several trigger tracks into one side-chain', () => {
    const graph = buildAudioTimelineGraph(spec(30, 60, [
      { id: 'narration', kind: 'narration', clips: [{ id: 'n1', ref: 'n1.wav', startFrame: 0, durationFrames: 30 }] },
      { id: 'narration2', kind: 'narration', clips: [{ id: 'n2', ref: 'n2.wav', startFrame: 30, durationFrames: 30 }] },
      { id: 'music', kind: 'music', ducking: { triggerTrackIds: ['narration', 'narration2'], reductionDb: 10 }, clips: [{ id: 'm1', ref: 'm.wav', startFrame: 0, durationFrames: 60 }] },
    ]), inputsFor(['n1', 'n2', 'm1']));
    expect(graph.filterComplex).toContain('[t0s1][t1s1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[sc2]');
    expect(graph.filterComplex).toContain('[t2][sc2]sidechaincompress=');
  });

  it('applies the second loudnorm pass with measured values, skips on silence and honours normalize=false', () => {
    const base = spec(30, 30, [{ id: 'narration', kind: 'narration', clips: [{ id: 'n1', ref: 'n1.wav', startFrame: 0, durationFrames: 30 }] }]);
    const inputs = inputsFor(['n1']);
    const applied = buildAudioTimelineGraph(base, inputs, { loudnorm: measurement });
    expect(applied.loudnorm).toBe('apply');
    expect(applied.filterComplex).toContain('loudnorm=I=-14:TP=-1:LRA=11:measured_I=-20.31:measured_TP=-5.02:measured_LRA=3.10:measured_thresh=-30.55:offset=0.12:linear=true');
    // loudnorm outputs 192 kHz → resampled back to 48 kHz and trimmed to the exact length afterwards.
    expect(applied.filterComplex).toMatch(/linear=true,aresample=48000,aformat=[^\]]*,apad=whole_len=48000,atrim=end_sample=48000,asetpts=PTS-STARTPTS\[aout\]$/);
    const skipped = buildAudioTimelineGraph(base, inputs, { loudnorm: null });
    expect(skipped.loudnorm).toBe('skip');
    expect(skipped.filterComplex).not.toContain('loudnorm');
    const off = buildAudioTimelineGraph({ ...base, loudness: { normalize: false } }, inputs, { loudnorm: measurement });
    expect(off.loudnorm).toBe('off');
    expect(off.filterComplex).not.toContain('loudnorm');
    const custom = buildAudioTimelineGraph({ ...base, loudness: { integratedLufs: -16, truePeakDb: -1.5 } }, inputs);
    expect(custom.filterComplex).toContain('loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json');
  });

  it('renders silence for a spec without audio clips', () => {
    const graph = buildAudioTimelineGraph(spec(24, 48, []), new Map());
    expect(graph.inputs).toEqual([]);
    expect(graph.filterComplex).toMatch(/^anullsrc=r=48000:cl=stereo,apad=whole_len=96000,atrim=end_sample=96000/);
  });

  it('escapes input paths: file: prefix against option/protocol injection, rejects control characters', () => {
    expect(ffmpegInputUrl('-y.wav')).toBe('file:-y.wav');
    expect(ffmpegInputUrl('concat:a.wav|b.wav')).toBe('file:concat:a.wav|b.wav');
    expect(ffmpegInputUrl('file:x.wav')).toBe('file:x.wav');
    expect(() => ffmpegInputUrl('a\nb.wav')).toThrow(/控制字符/);
    expect(() => ffmpegInputUrl('  ')).toThrow(/路径为空/);
    // Paths never enter the filter text (inputs are referenced by index), so `[ ] ; , '` cannot break the graph.
    const weird = "C:\\a;b,[c]'d\\e.wav";
    const graph = buildAudioTimelineGraph(spec(30, 30, [{ id: 'sfx', kind: 'sfx', clips: [{ id: 'x', ref: 'x.wav', startFrame: 0, durationFrames: 30 }] }]), new Map([['x', weird]]));
    expect(graph.inputs).toEqual(['-i', `file:${weird}`]);
    expect(graph.filterComplex).not.toContain(weird);
    expect(graph.filterComplex.startsWith('[0:a:0]')).toBe(true);
  });

  it('rejects an invalid spec (validateVideoSpec) and missing inputs with AUDIO_TIMELINE_* codes', () => {
    const bad = spec(30, 30, [{ id: 'music', kind: 'music', clips: [{ id: 'm', ref: 'm.wav', startFrame: 20, durationFrames: 30 }] }]);
    const error = (() => { try { buildAudioTimelineGraph(bad, inputsFor(['m'])); } catch (caught) { return caught; } })();
    expect(error).toBeInstanceOf(AudioTimelineError);
    expect(error).toMatchObject({ code: 'AUDIO_TIMELINE_SPEC_INVALID' });
    expect((error as AudioTimelineError).issues[0].message).toContain('超出了总时长');
    expect(() => buildAudioTimelineGraph({ ...spec(25 as VideoSpecFps, 30, []) }, new Map())).toThrow(/fps/);
    expect(() => buildAudioTimelineGraph(spec(30, 30, [{ id: 'sfx', kind: 'sfx', clips: [{ id: 'x', ref: 'x.wav', startFrame: 0, durationFrames: 30 }] }]), new Map()))
      .toThrow(expect.objectContaining({ code: 'AUDIO_TIMELINE_INPUT_MISSING' }));
  });
});

describe('audioTimelineStrategy', () => {
  it('is timeline only for VideoSpec projects (ADR-03)', () => {
    expect(audioTimelineStrategy({ videoSpecVersion: 1 })).toBe('timeline');
    expect(audioTimelineStrategy({ videoSpecVersion: 2 })).toBe('timeline');
    expect(audioTimelineStrategy({})).toBe('legacy');
    expect(audioTimelineStrategy({ videoSpecVersion: '1' })).toBe('legacy');
    expect(audioTimelineStrategy(null)).toBe('legacy');
  });
});
