import type { MotionComicScriptBeat, MotionComicScriptDraft } from '../../shared/motion-comic-planning';

export function beatSelection(beat: MotionComicScriptBeat): string {
  return beat.kind + ':' + (beat.characterKey ?? '');
}

export function speakerOptions(draft: MotionComicScriptDraft, beat: MotionComicScriptBeat) {
  const options = [
    { value: 'dialogue:', label: '对白（待指定说话人）' },
    { value: 'narration:', label: '旁白 / 画外音（无明确角色）' },
    { value: 'action:', label: '动作（不进入配音）' },
    ...draft.characters.flatMap((character) => [
      { value: 'dialogue:' + character.key, label: '对白 · ' + character.name },
      { value: 'narration:' + character.key, label: '内心独白 / 画外音 · ' + character.name },
      { value: 'action:' + character.key, label: '动作 · ' + character.name },
    ]),
  ];
  const value = beatSelection(beat);
  if (!options.some((option) => option.value === value)) options.unshift({ value, label: '无效角色（请重新选择）' });
  return options;
}

/** Update only a unique beat. Role keys may contain colons; never guess or truncate them. */
export function updateFailedBeat(draft: MotionComicScriptDraft, beatKey: string, selection: string): MotionComicScriptDraft {
  const separator = selection.indexOf(':');
  if (separator < 0) return draft;
  const kind = selection.slice(0, separator);
  const characterKey = selection.slice(separator + 1);
  if (kind !== 'action' && kind !== 'dialogue' && kind !== 'narration') return draft;
  if (characterKey && !draft.characters.some((character) => character.key === characterKey)) return draft;
  if (draft.scenes.flatMap((scene) => scene.beats).filter((beat) => beat.key === beatKey).length !== 1) return draft;
  return {
    ...draft,
    scenes: draft.scenes.map((scene) => ({
      ...scene,
      beats: scene.beats.map((beat) => {
        if (beat.key !== beatKey) return beat;
        const { characterKey: _previous, ...rest } = beat;
        return { ...rest, kind, ...(characterKey ? { characterKey } : {}) };
      }),
    })),
  };
}
