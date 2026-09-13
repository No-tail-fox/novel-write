import { invalidateSubtitleAlignment } from './audio-alignment';
import type { MotionComicCharacter, MotionComicDialogueCue, MotionComicPipelineData } from './motion-comic';

export interface MotionComicVoiceDefaults {
  provider: 'volcengine' | 'minimax';
  voiceId: string;
  speed: number;
}

export function motionComicDialogueCuesToGenerate(document: MotionComicPipelineData, shotId: string, cueId?: string): MotionComicDialogueCue[] {
  const episode = document.episodes.find((item) => item.scenes.some((scene) => scene.shots.some((shot) => shot.id === shotId)));
  const cues = episode?.dialogueCues.filter((cue) => cue.shotId === shotId && (!cueId || cue.id === cueId) && cue.text.trim()) ?? [];
  const missing = cues.filter((cue) => !cue.voiceAssetVersionId || !document.assets.some((asset) => asset.id === cue.voiceAssetVersionId && asset.kind === 'audio' && asset.localPath));
  return missing.length > 0 ? missing : cues;
}

/** Resolve from current canonical data, never from a captured UI shot. */
export function motionComicDialogueInput(document: MotionComicPipelineData, shotId: string, cueId: string, defaults: MotionComicVoiceDefaults) {
  const episode = document.episodes.find((item) => item.scenes.some((scene) => scene.shots.some((shot) => shot.id === shotId)));
  const shot = episode?.scenes.flatMap((scene) => scene.shots).find((item) => item.id === shotId);
  const cue = episode?.dialogueCues.find((item) => item.id === cueId && item.shotId === shotId);
  if (!shot || !cue || !shot.dialogueCueIds.includes(cueId)) throw new Error('对白不属于当前镜头。');
  if (!cue.text.trim()) throw new Error('当前对白正文为空。');
  const character = document.characters.find((item) => item.id === cue.characterId);
  if (character?.voiceId && character.voiceProvider && character.voiceProvider !== defaults.provider) {
    throw new Error(`角色“${character.name}”的音色属于另一配音服务，请在系列圣经重新选择音色。`);
  }
  return {
    projectId: document.id, shotId, cueId, characterId: cue.characterId,
    text: cue.text, provider: defaults.provider,
    voiceId: character?.voiceId || shot.voiceId || defaults.voiceId,
    speed: character?.voiceSpeed ?? shot.voiceSpeed ?? defaults.speed,
    startMs: cue.startMs, endMs: cue.endMs,
    defaults: { provider: defaults.provider, voiceId: defaults.voiceId, speed: defaults.speed },
  };
}

export type MotionComicDialogueInput = ReturnType<typeof motionComicDialogueInput>;

export function motionComicDialogueInputMatches(document: MotionComicPipelineData, input: MotionComicDialogueInput): boolean {
  try {
    return JSON.stringify(motionComicDialogueInput(document, input.shotId, input.cueId, input.defaults)) === JSON.stringify(input);
  } catch { return false; }
}

/** Changing a series voice invalidates affected speech, not unrelated dialogue. */
export function updateMotionComicCharacterVoice(document: MotionComicPipelineData, characterId: string, update: {
  voiceProvider: 'volcengine' | 'minimax'; voiceId?: string; voiceSpeed?: number;
}): MotionComicPipelineData {
  const character = document.characters.find((item) => item.id === characterId);
  if (!character) throw new Error('未找到配音角色。');
  if (update.voiceSpeed !== undefined && (!Number.isFinite(update.voiceSpeed) || update.voiceSpeed < 0.5 || update.voiceSpeed > 2)) throw new Error('角色语速必须为 0.5–2 倍。');
  const nextCharacter: MotionComicCharacter = { ...character, ...update };
  if (!nextCharacter.voiceId) { delete nextCharacter.voiceId; delete nextCharacter.voiceProvider; }
  if (character.voiceId === nextCharacter.voiceId && character.voiceProvider === nextCharacter.voiceProvider && character.voiceSpeed === nextCharacter.voiceSpeed) return document;
  return {
    ...document,
    characters: document.characters.map((item) => item === character ? nextCharacter : item),
    episodes: document.episodes.map((episode) => {
      const affected = episode.dialogueCues.filter((cue) => cue.characterId === characterId);
      const shotIds = new Set(affected.map((cue) => cue.shotId));
      const clipIds = new Set(affected.map((cue) => `dialogue-clip-${cue.id}`));
      return {
        ...episode,
        dialogueCues: episode.dialogueCues.map((cue) => {
          if (cue.characterId !== characterId) return cue;
          const next = invalidateSubtitleAlignment(cue, { audioAssetVersionId: null, voiceId: null, voiceSpeed: null }) as MotionComicDialogueCue;
          delete next.voiceAssetVersionId;
          return next;
        }),
        scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => shotIds.has(shot.id) ? { ...shot, voiceAssetVersionId: undefined } : shot) })),
        timeline: { ...episode.timeline, ...(episode.timeline.audioClips ? { audioClips: episode.timeline.audioClips.filter((clip) => !clipIds.has(clip.id)) } : {}) },
      };
    }),
  };
}
