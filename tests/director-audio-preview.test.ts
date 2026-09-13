import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, index: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current: value }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
import { DirectorAudioClip, type DirectorPreviewAudioClip } from '../src/features/director-desk/DirectorAudioPreview';

describe('Director multi-track preview transport', () => {
  let gain = { value: 0 };
  let resume: () => Promise<void>;
  let audio: { currentTime: number; paused: boolean; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> };
  const errors = vi.fn();
  const clip = { id: 'one', url: 'file:///fixture.wav', startMs: 0, durationMs: 1000, sourceStartMs: 100, gainDb: 0, fadeInMs: 800, fadeOutMs: 800 };
  function render(timeMs: number, playing: boolean, currentClip: DirectorPreviewAudioClip = clip) {
    hooks.index = 0;
    hooks.effects = [];
    DirectorAudioClip({ clip: currentClip, timeMs, playing, muted: false, onError: errors });
    hooks.refs[0].current = audio;
    return hooks.effects[1]();
  }
  beforeEach(() => {
    hooks.refs = [];
    errors.mockClear();
    gain = { value: 0 };
    resume = () => Promise.resolve();
    audio = { currentTime: 0, paused: true, play: vi.fn(async () => { audio.paused = false; }), pause: vi.fn(() => { audio.paused = true; }) };
    vi.stubGlobal('AudioContext', class {
      destination = {};
      createGain() { return { gain, connect: vi.fn() }; }
      createMediaElementSource() { return { connect: (node: unknown) => node }; }
      resume() { return resume(); }
      close() { return Promise.resolve(); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('seeks even a 100ms source trim before the initial play', async () => {
    render(0, true);
    expect(audio.currentTime).toBe(0.1);
    await Promise.resolve();
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
  it('multiplies overlapping fades just like FFmpeg', () => {
    render(500, true);
    expect(gain.value).toBeCloseTo(0.390625, 8);
  });
  it('does not start a delayed audio context after pausing', async () => {
    let release!: () => void;
    resume = () => new Promise<void>((resolve) => { release = resolve; });
    render(0, true);
    render(0, false);
    release();
    await Promise.resolve();
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.paused).toBe(true);
  });
  it('stops at the cue boundary', () => {
    render(1000, true);
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('resumes a split fragment at its source position and inherited fade level', () => {
    render(1500, true, { ...clip, startMs: 1500, durationMs: 1500, sourceStartMs: 1800, sourceDurationMs: 1300,
      gainDb: -9, fadeEnvelope: { offsetMs: 1300, durationMs: 2600, fadeInMs: 2000, fadeOutMs: 1800 } });
    expect(audio.currentTime).toBe(1.8);
    expect(gain.value).toBeCloseTo(Math.pow(10, -9 / 20) * (1300 / 2000) * (1300 / 1800), 10);
    render(2800, true, { ...clip, startMs: 2800, durationMs: 200, sourceDurationMs: 0 });
    expect(audio.pause).toHaveBeenCalled();
  });
});
