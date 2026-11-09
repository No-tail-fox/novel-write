import { bakeEditorialSemanticMotion, rebuildEditorialTimeline, sliceEditorialFrames, type EditorialCollagePipelineData, type EditorialSubtitleCue } from './editorial-collage';
import { hashSubtitleAlignment, hashSubtitleText, invalidateSubtitleAlignment, isSubtitleAlignmentValid } from './audio-alignment';
import { sliceProductionAudioClip } from './production-audio';
import { PROJECT_MUSIC_PREFIX } from './editorial-music';
import { lemoProjectFiles } from './creative-animation/native-project';

const MAX_SHOT_MS = 15_000;
const MIN_SHOT_MS = 800;
const frameCeil = (ms: number) => Math.floor(Math.ceil(ms * 24 / 1000) * 1000 / 24);
type Unit = { text: string; startMs: number; endMs: number; token?: NonNullable<EditorialSubtitleCue['tokens']>[number] };

function unitsFor(cue: EditorialSubtitleCue): Unit[] {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(cue.text)].map(part => part.segment);
  const measured = isSubtitleAlignmentValid(cue) && ['provider', 'whisper', 'manual'].includes(cue.alignmentSource ?? '');
  if (measured && cue.tokens?.length) {
    let offset = 0;
    const units: Unit[] = [];
    for (const token of cue.tokens) {
      const from = offset;
      let text = '';
      const compact = (s: string) => s.normalize('NFC').replace(/\s/gu, '');
      while (offset < graphemes.length && compact(text).length < compact(token.text).length) text += graphemes[offset++];
      if (compact(text) !== compact(token.text)) break;
      units.push({ text: graphemes.slice(from, offset).join(''), startMs: token.startMs, endMs: token.endMs, token });
    }
    if (units.length === cue.tokens.length && units.every(unit => unit.endMs - unit.startMs <= MAX_SHOT_MS) && !graphemes.slice(offset).join('').trim()) {
      units[units.length - 1].text += graphemes.slice(offset).join('');
      return units;
    }
  }
  return graphemes.map((text, index) => ({ text,
    startMs: cue.startMs + (cue.endMs - cue.startMs) * index / graphemes.length,
    endMs: cue.startMs + (cue.endMs - cue.startMs) * (index + 1) / graphemes.length,
  }));
}

/** Prefer sentence/clause ends; word timestamps are used when the provider supplied them. */
function cutPoints(units: Unit[], startMs: number, durationMs: number): number[] {
  const cuts = [0];
  while (durationMs - cuts[cuts.length - 1] > MAX_SHOT_MS) {
    const from = cuts[cuts.length - 1];
    const remaining = durationMs - from;
    const target = from + remaining / Math.ceil(remaining / MAX_SHOT_MS);
    const maximum = Math.min(from + MAX_SHOT_MS, durationMs - MIN_SHOT_MS);
    const candidates = units.flatMap((unit, index) => {
      const at = frameCeil(unit.endMs - startMs);
      const next = units[index + 1]?.text ?? '';
      if (at < from + MIN_SHOT_MS || at > maximum || /^[，。！？、；：,.!?;:）】》」』”’]/u.test(next) || /[（【《「『“‘]$/u.test(unit.text)) return [];
      const penalty = /[。！？.!?][”’」』）】》]*$/u.test(unit.text) ? 0 : /[，,；;：:]/u.test(unit.text) ? 350 : unit.token ? 700 : 1200;
      return [{ at, score: Math.abs(at - target) + penalty }];
    });
    candidates.sort((a, b) => a.score - b.score || a.at - b.at);
    cuts.push(candidates[0]?.at ?? Math.min(maximum, frameCeil(target)));
  }
  return [...cuts, durationMs];
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base, index = 2;
  while (used.has(id)) id = base + '-' + index++;
  used.add(id);
  return id;
}

/** Split measured speech without regenerating it: every source sample belongs to exactly one child. */
export function splitLongEditorialNarration(document: EditorialCollagePipelineData): EditorialCollagePipelineData {
  const longIds = document.beats.flatMap(b => b.shots.filter(s => s.durationMs > MAX_SHOT_MS).map(s => s.id));
  if (!longIds.length) return document;
  const baked = bakeEditorialSemanticMotion(document, longIds);
  const shotIds = new Set(baked.beats.flatMap(b => b.shots.map(s => s.id)));
  const cueIds = new Set(baked.beats.flatMap(b => b.subtitleCues.map(c => c.id)));
  const clipIds = new Set(baked.timeline?.audioClips?.map(c => c.id));
  const audioClips = (baked.timeline?.audioClips ?? []).filter(c => !longIds.includes(c.shotId ?? '') && !c.id.startsWith(PROJECT_MUSIC_PREFIX));
  const beats = baked.beats.map(beat => {
    const replacedCues = new Set<string>();
    const newCues: EditorialSubtitleCue[] = [];
    const shots = beat.shots.flatMap(shot => {
      if (!longIds.includes(shot.id)) return [shot];
      const startMs = baked.timeline!.clips.find(c => c.shotId === shot.id)!.startMs;
      const cues = shot.subtitleCueIds.flatMap(id => beat.subtitleCues.find(c => c.id === id) ?? []);
      const unitLists = cues.map(cue => ({ cue, units: unitsFor(cue) }));
      cues.forEach(cue => replacedCues.add(cue.id));
      const cuts = cutPoints(unitLists.flatMap(entry => entry.units), startMs, shot.durationMs);
      const ownedAudio = baked.timeline?.audioClips?.filter(c => c.shotId === shot.id && !c.id.startsWith(PROJECT_MUSIC_PREFIX)) ?? [];
      return cuts.slice(0, -1).map((from, index) => {
        const to = cuts[index + 1], durationMs = to - from;
        const id = index === 0 ? shot.id : uniqueId(shot.id.slice(0, 230) + '-part-' + (index + 1), shotIds);
        const subtitleCueIds: string[] = [];
        for (const { cue, units } of unitLists) {
          const selected = units.filter(unit => {
            const middle = (unit.startMs + unit.endMs) / 2 - startMs;
            return middle >= from && (middle < to || index === cuts.length - 2 && middle <= to);
          });
          if (!selected.length) continue;
          const cueId = uniqueId(cue.id.slice(0, 230) + '-part-' + (index + 1), cueIds);
          const text = selected.map(unit => unit.text).join('');
          const piece = { ...cue, id: cueId, shotId: id, text,
            startMs: Math.max(startMs + from, Math.round(selected[0].startMs)),
            endMs: Math.min(startMs + to, Math.round(selected[selected.length - 1].endMs)),
          };
          const hasTokens = selected.every(unit => unit.token && unit.startMs >= piece.startMs && unit.endMs <= piece.endMs);
          const next = hasTokens ? { ...piece, tokens: selected.map(unit => ({ ...unit.token!, text: unit.text })), textHash: hashSubtitleText(text) } : invalidateSubtitleAlignment(piece);
          if (hasTokens) next.alignmentFingerprint = hashSubtitleAlignment(next);
          newCues.push(next); subtitleCueIds.push(cueId);
        }
        const slices = ownedAudio.flatMap(clip => {
          const slice = sliceProductionAudioClip(clip, startMs + from, startMs + to, startMs + shot.durationMs);
          return slice ? [{ ...slice, id: index === 0 ? clip.id : uniqueId(clip.id.slice(0, 230) + '-part-' + (index + 1), clipIds), shotId: id }] : [];
        });
        audioClips.push(...slices);
        return { ...shot, id, durationMs, subtitleCueIds,
          voiceAssetVersionId: slices.some(clip => ['narration', 'dialogue'].includes(clip.trackType) && clip.assetVersionId === shot.voiceAssetVersionId) ? shot.voiceAssetVersionId : undefined,
          narrationSplit: { sourceShotId: shot.narrationSplit?.sourceShotId ?? shot.id, sourceStartMs: (shot.narrationSplit?.sourceStartMs ?? 0) + from, sourceDurationMs: shot.narrationSplit?.sourceDurationMs ?? shot.durationMs, sourceVoiceAssetVersionId: shot.voiceAssetVersionId },
          ...(index ? { transitionIn: { type: 'cut' as const, durationMs: 0 } } : {}),
          ...(shot.animation?.native ? { animation: { ...shot.animation, native: { ...shot.animation.native, startMs: shot.animation.native.startMs + from * (shot.animation.native.sourceDurationMs ?? shot.animation.native.durationMs) / shot.animation.native.durationMs, durationMs, sourceDurationMs: durationMs * (shot.animation.native.sourceDurationMs ?? shot.animation.native.durationMs) / shot.animation.native.durationMs } } } : {}),
          camera: sliceEditorialFrames(shot.camera, from, to, { atMs: 0, x: .5, y: .5, zoom: 1 }),
          layers: shot.layers.map(layer => ({ ...layer, motion: sliceEditorialFrames(layer.motion, from, to, { atMs: 0, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1 }) })),
        };
      });
    });
    return { ...beat, shots, subtitleCues: [...beat.subtitleCues.filter(c => !replacedCues.has(c.id)), ...newCues].sort((a, b) => a.startMs - b.startMs) };
  });
  // Narration is resolved before any film source is authored. Refresh these empty file assignments after the topology changes.
  const editableIds = beats.flatMap(b => b.shots).filter(s => !document.productionRun?.settings.lockedShotIds.includes(s.narrationSplit?.sourceShotId ?? s.id)).map(s => s.id);
  const creativeFilms = baked.creativeFilms?.map(film => film.project && film.project.files.every(file => !file.source && !file.attempts.length)
    ? { ...film, project: { ...film.project, files: lemoProjectFiles(editableIds) } } : film);
  audioClips.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  return rebuildEditorialTimeline({ ...baked, beats, ...(creativeFilms ? { creativeFilms } : {}), timeline: { ...baked.timeline!, audioClips } });
}
