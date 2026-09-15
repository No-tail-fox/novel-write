import { rebuildEditorialTimeline, type EditorialCollagePipelineData } from './editorial-collage';
import { hashSubtitleAlignment, invalidateSubtitleAlignment, isSubtitleAlignmentValid } from './audio-alignment';
import type { ProductionAudioClip } from './production-audio';

const speechTracks = new Set(['narration', 'dialogue']);
const tailMs = 160;

/** Re-probe selected recordings before export so old projects can reuse their audio. */
export async function prepareEditorialNarrationForRender(
  document: EditorialCollagePipelineData,
  measure: (path: string) => Promise<number>,
): Promise<EditorialCollagePipelineData> {
  const ids = new Set(document.beats.flatMap(beat => beat.shots.flatMap(shot => shot.voiceAssetVersionId ?? [])));
  const measured = new Map<string, number>();
  for (const asset of document.assets) {
    if (!ids.has(asset.id) || asset.kind !== 'audio' || !asset.localPath) continue;
    const duration = await measure(asset.localPath);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('EDITORIAL_NARRATION_DURATION_INVALID: 无法读取旁白实测时长，已停止导出。');
    measured.set(asset.id, Math.round(duration));
  }
  const withDurations = { ...document, assets: document.assets.map(asset => measured.has(asset.id) ? { ...asset, durationMs: measured.get(asset.id)! } : asset) };
  const prepared = fitEditorialNarrationTiming(withDurations);
  return JSON.stringify(prepared) === JSON.stringify(document) ? document : prepared;
}

/** Full-shot generated speech follows its recording; authored source trims remain edits. */
export function fitEditorialNarrationTiming(document: EditorialCollagePipelineData, shotIds?: readonly string[]): EditorialCollagePipelineData {
  const selected = shotIds ? new Set(shotIds) : undefined;
  const assets = new Map(document.assets.map(asset => [asset.id, asset]));
  const oldStarts = new Map(document.timeline?.clips.map(clip => [clip.shotId, clip.startMs]));
  const nextStarts = new Map<string, number>();
  const fullRecordings = new Map<string, { assetId: string; durationMs: number; oldClip?: ProductionAudioClip }>();
  let cursor = 0;
  const beats = document.beats.map(beat => {
    const beatStart = cursor;
    let oldOffset = 0;
    const cueUpdates = new Map<string, typeof beat.subtitleCues[number]>();
    const shots = beat.shots.map(shot => {
      const oldStart = oldStarts.get(shot.id) ?? beat.startMs + oldOffset;
      oldOffset += shot.durationMs;
      const start = cursor;
      nextStarts.set(shot.id, start);
      const owned = document.timeline?.audioClips?.filter(clip => clip.shotId === shot.id) ?? [];
      const speech = owned.filter(clip => speechTracks.has(clip.trackType));
      const source = assets.get(shot.voiceAssetVersionId ?? '');
      const measured = source?.durationMs;
      const automaticClip = speech.length === 1 && ['narration-clip-' + shot.id, 'legacy-narration-' + shot.id].includes(speech[0].id) ? speech[0] : undefined;
      const previouslyMeasured = automaticClip?.sourceMediaDurationMs ?? measured;
      const fullSource = automaticClip && automaticClip.assetVersionId === source?.id && !automaticClip.muted
        && automaticClip.startMs === oldStart && (automaticClip.sourceStartMs ?? 0) === 0
        && (automaticClip.sourceDurationMs === undefined || automaticClip.sourceDurationMs === previouslyMeasured)
        && (automaticClip.durationMs === undefined || automaticClip.durationMs === previouslyMeasured || automaticClip.durationMs === Math.min(shot.durationMs, previouslyMeasured ?? 0));
      const shouldFit = (!selected || selected.has(shot.id)) && source?.kind === 'audio'
        && typeof measured === 'number' && Number.isFinite(measured) && measured > 0
        && (speech.length === 0 || fullSource);
      let durationMs = shot.durationMs;
      if (shouldFit) {
        if (measured > 15_000) throw new Error(`EDITORIAL_NARRATION_TOO_LONG: 镜头“${shot.title || shot.id}”旁白长 ${Math.ceil(measured / 1000)} 秒，超过单镜 15 秒，请拆分镜头后再导出；不会截掉尾音。`);
        const otherAudioEnd = owned.filter(clip => !speechTracks.has(clip.trackType)).reduce((end, clip) => Math.max(end, clip.startMs - oldStart + (clip.durationMs ?? clip.sourceDurationMs ?? shot.durationMs)), 0);
        // Round down to integer milliseconds after choosing the covering frame,
        // so ceil(duration * fps) cannot accidentally request one extra frame.
        const frameDuration = Math.floor(Math.ceil((measured + tailMs) * 24 / 1000) * 1000 / 24);
        durationMs = Math.max(otherAudioEnd, Math.min(15_000, Math.max(800, frameDuration)));
        fullRecordings.set(shot.id, { assetId: source.id, durationMs: Math.ceil(measured), oldClip: automaticClip });
      }
      const cues = shot.subtitleCueIds.flatMap(id => beat.subtitleCues.find(cue => cue.id === id) ?? []);
      const firstCue = Math.min(...cues.map(cue => cue.startMs));
      const lastCue = Math.max(...cues.map(cue => cue.endMs));
      for (const cue of cues) {
        const hasTrueTiming = isSubtitleAlignmentValid(cue) && ['provider', 'whisper', 'manual'].includes(cue.alignmentSource ?? '');
        const scaleCue = shouldFit && !hasTrueTiming && lastCue > firstCue;
        const startMs = scaleCue ? start + Math.round((cue.startMs - firstCue) / (lastCue - firstCue) * measured!) : cue.startMs + start - oldStart;
        const endMs = scaleCue ? start + Math.round((cue.endMs - firstCue) / (lastCue - firstCue) * measured!) : cue.endMs + start - oldStart;
        if (endMs > start + durationMs || startMs < start) throw new Error(`EDITORIAL_NARRATION_CUE_RANGE: 镜头“${shot.title || shot.id}”的手动字幕超出实测旁白范围，请检查时间戳。`);
        if (startMs === cue.startMs && endMs === cue.endMs) { cueUpdates.set(cue.id, cue); continue; }
        const shifted = { ...cue, startMs, endMs };
        if (endMs - startMs === cue.endMs - cue.startMs && isSubtitleAlignmentValid(cue)) {
          shifted.tokens = cue.tokens?.map(token => ({ ...token, startMs: token.startMs + startMs - cue.startMs, endMs: token.endMs + startMs - cue.startMs }));
          shifted.alignmentFingerprint = hashSubtitleAlignment(shifted);
          cueUpdates.set(cue.id, shifted);
        } else cueUpdates.set(cue.id, invalidateSubtitleAlignment(shifted));
      }
      cursor += durationMs;
      if (durationMs === shot.durationMs) return shot;
      const scale = durationMs / shot.durationMs;
      return { ...shot, durationMs,
        camera: shot.camera.map(frame => ({ ...frame, atMs: Math.min(durationMs, Math.round(frame.atMs * scale)) })),
        layers: shot.layers.map(layer => ({ ...layer, motion: layer.motion.map(frame => ({ ...frame, atMs: Math.min(durationMs, Math.round(frame.atMs * scale)) })) })),
      };
    });
    return { ...beat, startMs: beatStart, durationMs: cursor - beatStart, shots, subtitleCues: beat.subtitleCues.map(cue => cueUpdates.get(cue.id) ?? cue) };
  });
  const audioClips = (document.timeline?.audioClips ?? []).filter(clip => !fullRecordings.has(clip.shotId ?? '') || !speechTracks.has(clip.trackType)).map(clip => ({ ...clip,
    startMs: clip.startMs + (nextStarts.get(clip.shotId ?? '') ?? 0) - (oldStarts.get(clip.shotId ?? '') ?? 0),
  }));
  for (const [shotId, recording] of fullRecordings) audioClips.push({ ...recording.oldClip, id: recording.oldClip?.id ?? `narration-clip-${shotId}`,
    shotId, assetVersionId: recording.assetId, trackType: 'narration', startMs: nextStarts.get(shotId)!,
    sourceStartMs: 0, sourceDurationMs: recording.durationMs, sourceMediaDurationMs: recording.durationMs, durationMs: recording.durationMs, gainDb: recording.oldClip?.gainDb ?? 0,
  });
  const next = rebuildEditorialTimeline({ ...document, beats, ...(document.timeline ? { timeline: { ...document.timeline, audioClips } } : {}) });
  if (JSON.stringify(next) === JSON.stringify(document)) return document;
  return { ...next, stage: 'assets', assets: next.assets.map(asset => asset.assetId === 'director-final-video' ? { ...asset, selected: false, pinned: false } : asset) };
}
