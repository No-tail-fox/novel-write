import { useEffect, useRef } from 'react';
import { productionAudioClipGainAtTime, type ProductionAudioFadeEnvelope } from '../../shared/production-audio';

export interface DirectorPreviewAudioClip {
  id: string;
  url: string;
  /** Project-global milliseconds, matching persisted timeline clips. */
  startMs: number;
  durationMs: number;
  sourceStartMs?: number;
  sourceDurationMs?: number;
  gainDb?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  fadeEnvelope?: ProductionAudioFadeEnvelope;
  muted?: boolean;
}

/** Shared-clock playback for non-destructive timeline audio edits. */
export function DirectorAudioPreview({ clips, timeMs, playing, muted, onError }: {
  clips: readonly DirectorPreviewAudioClip[];
  timeMs: number;
  playing: boolean;
  muted: boolean;
  onError: (message: string) => void;
}) {
  return <>{clips.map((clip) => <DirectorAudioClip key={`${clip.id}:${clip.url}`} clip={clip} timeMs={timeMs} playing={playing} muted={muted} onError={onError} />)}</>;
}

export function DirectorAudioClip({ clip, timeMs, playing, muted, onError }: {
  clip: DirectorPreviewAudioClip;
  timeMs: number;
  playing: boolean;
  muted: boolean;
  onError: (message: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const graph = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const pending = useRef(false);
  const failed = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      generation.current += 1;
      audio?.pause();
      void graph.current?.context.close().catch(() => undefined);
      graph.current = null;
    };
  }, []);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const elapsed = timeMs - clip.startMs;
    const sourceDuration = Math.min(clip.durationMs, clip.sourceDurationMs ?? clip.durationMs);
    if (!playing || muted || clip.muted || elapsed < 0 || elapsed >= sourceDuration) {
      generation.current += 1;
      audio.pause();
      return;
    }
    if (!graph.current) {
      try {
        const context = new AudioContext();
        const gain = context.createGain();
        context.createMediaElementSource(audio).connect(gain).connect(context.destination);
        graph.current = { context, gain };
      } catch {
        if (!failed.current) onError('音频混音预览无法启动，请检查音频设备。');
        failed.current = true;
        return;
      }
    }
    graph.current.gain.gain.value = productionAudioClipGainAtTime(clip, timeMs);
    const target = ((clip.sourceStartMs ?? 0) + elapsed) / 1000;
    if ((audio.paused && !pending.current) || Math.abs(audio.currentTime - target) > 0.12) audio.currentTime = target;
    if (audio.paused && !pending.current && !failed.current) {
      pending.current = true;
      const request = generation.current;
      void graph.current.context.resume().then(() => request === generation.current ? audio.play() : undefined).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        failed.current = true;
        onError('音频片段无法播放，请检查文件或重新生成对白。');
      }).finally(() => { pending.current = false; });
    }
  }, [clip, muted, onError, playing, timeMs]);
  return <audio ref={audioRef} src={clip.url} preload="auto" data-audio-clip-id={clip.id} />;
}
