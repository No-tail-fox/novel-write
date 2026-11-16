import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DirectorAudioClip } from '../src/features/director-desk/DirectorAudioPreview';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { sliceProductionAudioClip } from '../src/shared/production-audio';
import { motionComicPreviewAudioClips } from '../src/features/motion-comic/motion-comic-audio-preview';
import { buildDirectorRenderScenes } from '../src/shared/director-render';

const now = '2026-09-18T00:00:00.000Z';
const documentData = createMotionComicStarterProject(createMotionComicDraft({ id: 'real-audio', title: 'Audio', premise: 'Local', now }), 'Episode', now);
const episode = documentData.episodes[0];
const shot = episode.scenes.flatMap(s => s.shots)[1];
Object.assign(shot, { durationMs: 8000, renderStrategy: 'image-motion', dialogueCueIds: [], voiceAssetVersionId: undefined, firstFrameAssetVersionId: 'image' });
const owner = episode.timeline.clips.find(c => c.shotId === shot.id)!;
owner.durationMs = 8000;
documentData.assets.push({ id: 'image', assetId: 'image', kind: 'image', localPath: 'unused.png', createdAt: now }, { id: 'tone', assetId: 'tone', kind: 'audio', localPath: 'tone.wav', durationMs: 8000, createdAt: now });
const original = { id: 'tone', assetVersionId: 'tone', shotId: shot.id, trackType: 'music' as const, startMs: owner.startMs, durationMs: 8000, sourceStartMs: 0, sourceDurationMs: 8000, gainDb: 0, fadeInMs: 4000, fadeOutMs: 0 };
episode.timeline.audioClips = [sliceProductionAudioClip(original, owner.startMs, owner.startMs + 2000, owner.startMs + 8000)!, { ...sliceProductionAudioClip(original, owner.startMs + 2000, owner.startMs + 8000, owner.startMs + 8000)!, id: 'second' }];
const preview = motionComicPreviewAudioClips(episode, shot, documentData).find(c => c.id === 'second')!;
const exported = buildDirectorRenderScenes(documentData, episode.id, { shotIds: [shot.id] })[0].audioClips!;
const NativeContext = window.AudioContext;
let analyser: AnalyserNode;
let context: AudioContext;
let actualGain: GainNode;
// Real nodes and real media decoding. This instrumentation only adds an analyser tap.
window.AudioContext = class extends NativeContext {
  constructor() { super({ sampleRate: 44100 }); context = this; }
  createGain() {
    const gain = super.createGain();
    actualGain = gain;
    analyser = this.createAnalyser(); analyser.fftSize = 8192;
    gain.connect(analyser);
    return gain;
  }
};
const root = createRoot(document.getElementById('root')!);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const errors: string[] = [];
async function capture(time: number, control = false, negative = false) {
  const clip = { ...preview, url: '/tone.wav', ...(control ? { fadeEnvelope: undefined, fadeInMs: 0, fadeOutMs: 0 } : {}), ...(negative ? { fadeEnvelope: undefined } : {}) };
  flushSync(() => root.render(<DirectorAudioClip key={`${time}-${control}-${negative}`} clip={clip} timeMs={owner.startMs + time * 1000} playing muted={false} onError={e => errors.push(e)} />));
  const readyDeadline = performance.now() + 5000;
  while (context.state !== 'running' || document.querySelector('audio')!.paused || document.querySelector('audio')!.currentTime < time + 0.25) {
    if (performance.now() > readyDeadline) throw new Error('Real audio playback did not become ready');
    await wait(25);
  }
  await wait(250);
  const values: number[] = [];
  const data = new Float32Array(8192);
  for (let i = 0; i < 12; i++) {
    analyser.getFloatTimeDomainData(data);
    values.push(Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length));
    await wait(25);
  }
  const audio = document.querySelector('audio')!;
  const result = { time, control, negative, rms: values.reduce((s, v) => s + v, 0) / values.length, gain: actualGain.gain.value, mediaTime: audio.currentTime, readyState: audio.readyState, contextState: context.state, sampleRate: context.sampleRate };
  flushSync(() => root.render(null));
  return result;
}
(window as any).fixture = { preview, exported, original, startMs: owner.startMs };
(window as any).runAudio = async () => {
  const offline = new OfflineAudioContext(1, 44100 * 8, 44100);
  const decoded = await offline.decodeAudioData(await (await fetch('/tone.wav')).arrayBuffer());
  const captures = [];
  for (const time of [2.5, 3, 4.5]) {
    const reference = await capture(time, true);
    const faded = await capture(time);
    const negative = await capture(time, false, true);
    captures.push({ time, reference, faded, negative, ratio: faded.rms / reference.rms, negativeRatio: negative.rms / reference.rms });
  }
  return { decoded: { duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels }, captures, errors, userAgent: navigator.userAgent };
};
