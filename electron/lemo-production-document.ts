import { editorialPresentationCues } from '../src/shared/editorial-script-markup';
import { voxShotLocked } from '../src/shared/vox-production';
import { randomUUID } from 'node:crypto';
import { createVoxAnimation } from '../src/shared/vox-animation';
import { directorCanvasForRatio } from '../src/shared/director-render';
import { rebuildEditorialTimeline, type EditorialCollagePipelineData as Document } from '../src/shared/editorial-collage';
import { LEMO_NATIVE_ENGINE, LEMO_NATIVE_REVISION, LEMO_FOLLOW_STYLE_SUBTITLES, resolveLemoAnimation, type LemoNativeFilm } from '../src/shared/creative-animation/native-film';
import { LEMO_REVISION, resolveCreativeStyle } from '../src/shared/creative-animation/styles';

export const isNativeRun = (d: Document) => d.productionRun?.engine === LEMO_NATIVE_ENGINE;
export const activeNativeFilm = (d: Document) => d.creativeFilms?.find(f => f.id === d.productionRun?.filmId);
export const shots = (d: Document) => d.beats.flatMap(b => b.shots);
export const editable = (d: Document) => shots(d).filter(s => !voxShotLocked(d.productionRun!.settings, s));
export function timeline(d: Document, presentation = true) {
  const rawCues = d.beats.flatMap(b => b.subtitleCues);
  const cues = presentation ? editorialPresentationCues(d.sourceText, rawCues) : rawCues;
  return shots(d).map(shot => {
    const startMs = d.timeline?.clips.find(c => c.shotId === shot.id)?.startMs ?? 0;
    return { id: shot.id, startMs, durationMs: shot.durationMs, locked: voxShotLocked(d.productionRun!.settings, shot),
      subtitleStyle: shot.subtitleStyle || LEMO_FOLLOW_STYLE_SUBTITLES,
      cues: cues.filter(c => shot.subtitleCueIds.includes(c.id)).map(c => ({ id: c.id, text: c.text, startMs: c.startMs, endMs: c.endMs, ...(c.tokens ? { tokens: c.tokens } : {}) })) };
  });
}
/** Caption ownership is a host contract, independent of editable style instructions. */
export function lemoCaptionContract(kind: string) {
  return {
    currentFile: kind,
    owner: 'scene',
    cueIds: 'Use input.timeline[].cues[].id for caption cueId; input.timeline[].id is a shot ID, never a caption cue ID.',
    timing: 'Cue startMs/endMs are absolute milliseconds. Captions are visible on [startMs,endMs); render(t) and texts(t) use absolute seconds.',
    scene: 'Each scene draws and reports its assigned captions exactly once, preserving all characters and cue IDs.',
    director: 'Only compose scene render(t) calls and aggregate active scene texts(t). Do not draw captions again, create a second lyric table, substitute shot IDs, or filter out visible text metadata by size or cue ID.',
    shared: 'Provide drawing primitives only. Do not own caption tables or per-cue timing. Preserve shared APIs during repairs.',
  };
}
export function imageAssets(d: Document) {
  const used = new Set([...shots(d).flatMap(s => [...s.layers.flatMap(l => l.assetVersionId ? [l.assetVersionId] : []), ...s.animation?.native?.assetIds ?? s.animation?.template.props.assetIds ?? []]), ...d.productionRun!.settings.archives.map(a => a.assetVersionId), ...Object.values(activeNativeFilm(d)?.project?.bindings ?? {})]);
  return d.assets.filter(a => a.kind === 'image' && a.localPath && used.has(a.id)).map(a => ({ id: a.id, label: a.prompt ?? a.id, kind: a.kind, sha256: a.sha256 }));
}
/** Visual authoring inputs; music and voice providers are consumed by the shared audio pipeline. */
export function filmSettings(d: Document) {
  const s = d.productionRun!.settings;
  return { presetId: s.presetId, presetVersion: s.presetVersion, dataUnit: s.dataUnit, narration: s.narration, data: s.data, archives: s.archives, brief: s.authoring?.brief };
}
export const saveFilm = (d: Document, film: LemoNativeFilm): Document => ({ ...d, creativeFilms: [...d.creativeFilms?.filter(f => f.id !== film.id) ?? [], film], productionRun: { ...d.productionRun!, filmId: film.id } });
export function attachFilm(d: Document, film: LemoNativeFilm): Document {
  const settings = d.productionRun!.settings;
  return rebuildEditorialTimeline({ ...saveFilm(d, film), beats: d.beats.map(beat => ({ ...beat, shots: beat.shots.map(shot => {
    if (voxShotLocked(settings, shot)) return shot;
    const startMs = d.timeline?.clips.find(c => c.shotId === shot.id)?.startMs ?? 0;
    const animation = createVoxAnimation();
    animation.mode = 'code'; animation.code.engine = 'lemo-native';
    animation.native = { filmId: film.id, startMs, durationMs: shot.durationMs, filmDurationMs: film.durationMs, width: film.width, height: film.height, fps: film.fps, assetIds: film.assetIds };
    animation.authoring = { owner: 'creative-production', revision: 1, styleId: film.styleId, upstreamRevision: film.upstreamRevision, status: film.status === 'reviewed' ? 'reviewed' : 'generated', attempts: [] };
    return { ...shot, renderStrategy: 'remotion' as const, transitionIn: { type: 'cut' as const, durationMs: 0 }, animation };
  }) })) });
}

