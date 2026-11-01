import type { DirectorRenderScene } from '../director-render';

export interface NativeRenderStage {
  scene: DirectorRenderScene;
  windows: Array<{ scene: DirectorRenderScene; localOffsetMs: number }>;
}

/** Consecutive editing windows of one film share one browser and one frame clock. */
export function coalesceDirectorNativeScenes(scenes: readonly DirectorRenderScene[]): NativeRenderStage[] {
  const stages: NativeRenderStage[] = [];
  for (const scene of scenes) {
    const previous = stages.at(-1);
    const a = previous?.scene.animation, b = scene.animation;
    const contiguous = previous && a?.code.engine === 'lemo-native' && b?.code.engine === 'lemo-native'
      && a.native && b.native && a.native.filmId === b.native.filmId
      && a.code.source === b.code.source && a.code.compiled === b.code.compiled
      && a.native.width === b.native.width && a.native.height === b.native.height && a.native.fps === b.native.fps
      && a.native.filmDurationMs === b.native.filmDurationMs
      && Math.abs(a.native.startMs + (a.native.sourceDurationMs ?? previous.scene.durationMs) - b.native.startMs) < .001
      && Math.abs((a.native.sourceDurationMs ?? a.native.durationMs) / a.native.durationMs - (b.native.sourceDurationMs ?? b.native.durationMs) / b.native.durationMs) < 1e-9
      && JSON.stringify(a.native.assetIds) === JSON.stringify(b.native.assetIds)
      && JSON.stringify(previous.scene.animationAssets) === JSON.stringify(scene.animationAssets)
      && (!scene.transitionIn || (scene.transitionIn.type === 'cut' && scene.transitionIn.durationMs === 0));
    if (!contiguous) {
      stages.push({ scene, windows: [{ scene, localOffsetMs: 0 }] });
      continue;
    }
    const offset = previous.scene.durationMs;
    const audio = (source: DirectorRenderScene) => source.audioClips ?? [{
      id: 'native-voice-' + source.id, assetVersionId: source.id, path: source.audioPath,
      trackType: 'narration' as const, startMs: 0, durationMs: source.durationMs, gainDb: 0,
    }];
    const cues = (source: DirectorRenderScene) => source.subtitleCues ?? (source.caption.trim() ? [{ id: 'native-caption-' + source.id, text: source.caption, startMs: 0, endMs: source.durationMs }] : []);
    previous.windows.push({ scene, localOffsetMs: offset });
    previous.scene = { ...previous.scene, durationMs: offset + scene.durationMs,
      caption: previous.scene.caption + '\n' + scene.caption,
      animation: { ...a!, native: { ...a!.native!, durationMs: offset + scene.durationMs, ...(a!.native!.sourceDurationMs !== undefined || b!.native!.sourceDurationMs !== undefined ? { sourceDurationMs: (a!.native!.sourceDurationMs ?? offset) + (b!.native!.sourceDurationMs ?? scene.durationMs) } : {}) } },
      subtitleCues: [...cues(previous.scene), ...cues(scene).map(cue => ({ ...cue, startMs: cue.startMs + offset, endMs: cue.endMs + offset, ...('tokens' in cue && cue.tokens ? { tokens: cue.tokens.map(token => ({ ...token, startMs: token.startMs + offset, endMs: token.endMs + offset })) } : {}) }))],
      audioClips: [...audio(previous.scene), ...audio(scene).map(clip => ({ ...clip, id: scene.id + ':' + clip.id, startMs: clip.startMs + offset }))],
    };
  }
  return stages;
}
