import type { SceneAsset } from './draft';
import type { StoryboardScene, SubtitleTrack, HtmlVideoTimedCaptionCue } from './types';
import { buildSubtitleTrackFromSceneLines } from './story';

const comparable = (text: string) => Array.from(text.normalize('NFKC').replace(/[\p{P}\s]+/gu, ''));
interface TimedCharacter { text: string; startMs: number; endMs: number }

// Preserve authored text. Use measured speech windows only when the complete text
// matches; edited captions or untrustworthy provider timestamps retain estimation.
export function alignShortVideoSubtitles(scenes: StoryboardScene[], narration: SceneAsset[], original: SubtitleTrack): SubtitleTrack {
  const fallback = buildSubtitleTrackFromSceneLines(scenes, scenes.map(scene => ({ sceneId: scene.id, lines: original.cues.filter(cue => cue.sceneId === scene.id).map(cue => cue.text) })));
  const cues: SubtitleTrack['cues'] = [];
  let sceneStart = 0;
  for (const scene of scenes) {
    const lines = fallback.cues.filter(cue => cue.sceneId === scene.id);
    const voices = narration.filter(asset => asset.sceneId === scene.id).sort((a, b) => (a.turnIndex ?? Number.MAX_SAFE_INTEGER) - (b.turnIndex ?? Number.MAX_SAFE_INTEGER));
    const measured = measuredCharacters(voices);
    const text = lines.flatMap(line => comparable(line.text));
    if (measured && text.length && text.join('') === measured.map(char => char.text).join('')) {
      let offset = 0;
      const aligned = lines.map(line => {
        const size = comparable(line.text).length;
        const startMs = Math.round(sceneStart + (measured[offset]?.startMs ?? 0));
        const endMs = Math.round(sceneStart + (measured[offset + size - 1]?.endMs ?? 0));
        offset += size;
        return { ...line, startMs, endMs };
      });
      if (aligned.every(line => line.endMs > line.startMs && line.endMs <= sceneStart + scene.durationMs)) cues.push(...aligned);
      else cues.push(...lines);
    } else cues.push(...lines);
    sceneStart += scene.durationMs;
  }
  cues.forEach((cue, index) => { cue.index = index + 1; });
  return { cues, srt: cues.map(cue => `${cue.index}\n${time(cue.startMs)} --> ${time(cue.endMs)}\n${cue.text}\n`).join('\n') };
}

function measuredCharacters(voices: SceneAsset[]): TimedCharacter[] | null {
  if (!voices.length) return null;
  const chars: TimedCharacter[] = [];
  let offset = 0;
  for (const voice of voices) {
    if (!Number.isFinite(voice.durationMs) || voice.durationMs! <= 0 || !voice.captionCues?.length) return null;
    let previousEnd = 0;
    for (const cue of voice.captionCues) {
      if ((cue.source !== 'tts' && cue.source !== 'asr') || !validWindow(cue, previousEnd, voice.durationMs! / 1000)
        || !Number.isFinite(cue.confidence) || cue.confidence < 0 || cue.confidence > 1) return null;
      const words = cue.words;
      const useWords = words?.length && comparable(words.map(word => word.text).join('')).join('') === comparable(cue.text).join('')
        && words.every((word, index) => validWindow(word, index ? words[index - 1].endSec : cue.startSec, cue.endSec));
      for (const part of useWords ? words! : [cue]) {
        const letters = comparable(part.text);
        letters.forEach((text, index) => chars.push({ text,
          startMs: offset + 1000 * (part.startSec + (part.endSec - part.startSec) * index / letters.length),
          endMs: offset + 1000 * (part.startSec + (part.endSec - part.startSec) * (index + 1) / letters.length),
        }));
      }
      previousEnd = cue.endSec;
    }
    offset += voice.durationMs!;
  }
  return chars.length ? chars : null;
}
function validWindow(cue: Pick<HtmlVideoTimedCaptionCue, 'startSec' | 'endSec'>, previousEnd: number, end: number): boolean {
  return Number.isFinite(cue.startSec) && Number.isFinite(cue.endSec) && cue.startSec >= previousEnd && cue.endSec > cue.startSec && cue.endSec <= end;
}
function time(ms: number): string {
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
