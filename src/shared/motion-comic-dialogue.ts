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


export type MotionComicSpeakerRole = "dialogue" | "monologue" | "narrative";
export type MotionComicBubbleStyle = "speech" | "thought" | "shout" | "caption";
export interface MotionComicBubblePosition {
  x: number;
  y: number;
  tailDirection?: "bottom-left" | "bottom-right" | "top-left" | "top-right" | "none";
}

export const BUBBLE_POSITION_PRESETS = {
  auto: undefined,
  'top-left': { x: 25, y: 22, tailDirection: 'bottom-left' as const },
  'top-right': { x: 75, y: 22, tailDirection: 'bottom-right' as const },
  'center-left': { x: 26, y: 48, tailDirection: 'bottom-left' as const },
  'center-right': { x: 74, y: 48, tailDirection: 'bottom-right' as const },
  'bottom-center': { x: 50, y: 82, tailDirection: 'none' as const },
};

export type BubblePositionPresetKey = keyof typeof BUBBLE_POSITION_PRESETS;

export function resolvePresetFromPosition(pos?: MotionComicBubblePosition): BubblePositionPresetKey {
  if (!pos) return 'auto';
  if (pos.x <= 35 && pos.y <= 35) return 'top-left';
  if (pos.x >= 65 && pos.y <= 35) return 'top-right';
  if (pos.x <= 35 && pos.y > 35 && pos.y < 70) return 'center-left';
  if (pos.x >= 65 && pos.y > 35 && pos.y < 70) return 'center-right';
  if (pos.y >= 70) return 'bottom-center';
  return 'auto';
}

export interface ExtractedDialogueItem {
  speakerName?: string;
  characterId?: string;
  text: string;
  emotion?: string;
  speakerRole: MotionComicSpeakerRole;
  bubbleStyle: MotionComicBubbleStyle;
}

/**
 * Parses script or shot description text into structured dialogue items,
 * identifying characters, emotional tones, monologues, shouts, and narration.
 */
export function extractDialogueFromScript(
  scriptText: string,
  characters?: readonly { value: string; label: string }[],
): ExtractedDialogueItem[] {
  if (!scriptText || !scriptText.trim()) return [];
  const lines = scriptText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result: ExtractedDialogueItem[] = [];

  for (const rawLine of lines) {
    // 1. Narration: 【旁白】... or 旁白: ...
    const narrativeMatch = rawLine.match(/^(?:【(?:旁白|解说|独白)】|(?:旁白|解说|叙述)\s*[:：])\s*(.*)$/);
    if (narrativeMatch) {
      const text = narrativeMatch[1].trim();
      if (text) {
        result.push({
          speakerName: "旁白",
          characterId: undefined,
          text,
          emotion: "平静",
          speakerRole: "narrative",
          bubbleStyle: "caption",
        });
        continue;
      }
    }

    // 2. Inner monologue: (心想: ...) or Character (心想): ...
    const thoughtMatch = rawLine.match(/^(?:([^:：(（]{1,12})\s*)?[（(](?:心想|独白|思忖|暗想|自言自语)\s*[:：]?\s*([^）)]+)[)）]\s*(?:[:：]\s*(.*))?$/);
    if (thoughtMatch) {
      const speakerCandidate = thoughtMatch[1]?.trim();
      const text = (thoughtMatch[3]?.trim() || thoughtMatch[2]?.trim()).replace(/^["“](.*)["”]$/, "$1");
      const matchedChar = characters?.find((c) => speakerCandidate && (c.label === speakerCandidate || speakerCandidate.includes(c.label)));
      if (text) {
        result.push({
          speakerName: matchedChar?.label ?? speakerCandidate ?? "内心独白",
          characterId: matchedChar?.value,
          text,
          emotion: "沉思",
          speakerRole: "monologue",
          bubbleStyle: "thought",
        });
        continue;
      }
    }

    // 3. Dialogue: Character (emotion): "speech" or Character: "speech"
    const dialogueMatch = rawLine.match(/^([^:：(（]{1,12})(?:\s*[（(]([^）)]+)[)）])?\s*[:：]\s*["“]?([^"”]+)["”]?$/);
    if (dialogueMatch) {
      const speakerCandidate = dialogueMatch[1].trim();
      const emotionCandidate = dialogueMatch[2]?.trim();
      const text = dialogueMatch[3].trim();
      const matchedChar = characters?.find((c) => c.label === speakerCandidate || speakerCandidate.includes(c.label));

      const isShout = /[！!]{1,}|大喊|怒吼|咆哮|急促/.test(emotionCandidate || "") || /[！!]{2,}/.test(text);
      const isThought = /心想|暗想|思索/.test(emotionCandidate || "");

      result.push({
        speakerName: matchedChar?.label ?? speakerCandidate,
        characterId: matchedChar?.value,
        text,
        emotion: emotionCandidate || (isShout ? "激动" : "自然"),
        speakerRole: isThought ? "monologue" : "dialogue",
        bubbleStyle: isThought ? "thought" : isShout ? "shout" : "speech",
      });
      continue;
    }

    // 4. Quoted line: "speech"
    const quoteMatch = rawLine.match(/^["“]([^"”]+)["”]$/);
    if (quoteMatch) {
      const text = quoteMatch[1].trim();
      const isShout = /[！!]{2,}/.test(text);
      result.push({
        speakerName: undefined,
        characterId: undefined,
        text,
        emotion: isShout ? "激动" : "自然",
        speakerRole: "dialogue",
        bubbleStyle: isShout ? "shout" : "speech",
      });
      continue;
    }

    // 5. Default line
    const isShout = /[！!]{2,}/.test(rawLine);
    result.push({
      speakerName: undefined,
      characterId: undefined,
      text: rawLine,
      emotion: "自然",
      speakerRole: "dialogue",
      bubbleStyle: isShout ? "shout" : "speech",
    });
  }

  return result;
}

/**
 * Distributes startMs and endMs for extracted dialogue items inside shot boundary.
 */
export function distributeDialogueTiming(
  items: readonly ExtractedDialogueItem[],
  shotStartMs: number,
  shotDurationMs: number,
): Array<ExtractedDialogueItem & { startMs: number; endMs: number }> {
  if (items.length === 0) return [];
  const headMarginMs = Math.min(200, Math.floor(shotDurationMs * 0.05));
  const tailMarginMs = Math.min(200, Math.floor(shotDurationMs * 0.05));
  const usableDurationMs = Math.max(items.length * 500, shotDurationMs - headMarginMs - tailMarginMs);
  const gapMs = items.length > 1 ? Math.min(100, Math.floor((usableDurationMs * 0.1) / (items.length - 1))) : 0;
  const netDurationMs = usableDurationMs - gapMs * (items.length - 1);

  const totalChars = items.reduce((sum, item) => sum + Math.max(2, item.text.length), 0);
  let currentStart = shotStartMs + headMarginMs;

  return items.map((item, index) => {
    const isLast = index === items.length - 1;
    const charWeight = Math.max(2, item.text.length) / totalChars;
    const duration = isLast ? (shotStartMs + shotDurationMs - tailMarginMs - currentStart) : Math.max(400, Math.floor(netDurationMs * charWeight));
    const startMs = currentStart;
    const endMs = Math.min(shotStartMs + shotDurationMs, startMs + duration);
    currentStart = endMs + gapMs;
    return {
      ...item,
      startMs,
      endMs,
    };
  });
}

/** Reuse existing recordings through the normal export path, including older projects. */
export async function prepareMotionComicDialogueForRender(
  document: MotionComicPipelineData,
  measure: (path: string) => Promise<number>,
  episodeId = document.activeEpisodeId,
): Promise<MotionComicPipelineData> {
  const episode = document.episodes.find(item => item.id === episodeId);
  if (!episode) return document; // The render preflight reports a missing episode.
  const shots = episode.scenes.flatMap(scene => scene.shots).filter(shot =>
    shot.renderStrategy !== 'remote-video' || !['native', 'audio-driven'].includes(shot.videoProduction?.audioMode ?? 'post-mix'));
  const shotIds = new Set(shots.map(shot => shot.id));
  const ids = new Set(episode.dialogueCues.filter(cue => shotIds.has(cue.shotId))
    .flatMap(cue => cue.voiceAssetVersionId ?? cue.audioAssetVersionId ?? []));
  const measured = new Map<string, number>();
  const byPath = new Map<string, number>();
  for (const asset of document.assets) {
    if (!ids.has(asset.id) || asset.kind !== 'audio' || !asset.localPath) continue;
    const duration = byPath.get(asset.localPath) ?? await measure(asset.localPath);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('MOTION_COMIC_DIALOGUE_DURATION_INVALID: 无法读取对白音频的实测时长，已停止导出。');
    byPath.set(asset.localPath, duration);
    measured.set(asset.id, Math.round(duration));
  }
  let prepared = { ...document, assets: document.assets.map(asset => measured.has(asset.id) ? { ...asset, durationMs: measured.get(asset.id)! } : asset) };
  for (const shot of shots) prepared = fitMotionComicDialogueTiming(prepared, shot.id);
  const fitted = prepared.episodes.find(item => item.id === episodeId)!;
  for (const cue of fitted.dialogueCues) {
    if (!shotIds.has(cue.shotId)) continue;
    const duration = measured.get(cue.voiceAssetVersionId ?? cue.audioAssetVersionId ?? '');
    if (duration && cue.endMs - cue.startMs + 30 < duration) {
      const shot = shots.find(item => item.id === cue.shotId)!;
      throw new Error(`MOTION_COMIC_DIALOGUE_DOES_NOT_FIT: 镜头“${shot.title}”无法容纳完整对白“${cue.text.slice(0, 18)}”，请增加镜头时长或调整配音语速后重试。`);
    }
  }
  return JSON.stringify(prepared) === JSON.stringify(document) ? document : prepared;
}

/** Fit measured cue recordings without cutting speech or changing shot/video timing. */
export function fitMotionComicDialogueTiming(document: MotionComicPipelineData, shotId: string): MotionComicPipelineData {
  const episode = document.episodes.find(item => item.scenes.some(scene => scene.shots.some(shot => shot.id === shotId)));
  const shot = episode?.scenes.flatMap(scene => scene.shots).find(item => item.id === shotId);
  const owner = episode?.timeline.clips.find(clip => clip.shotId === shotId);
  if (!episode || !shot || !owner) return document;
  const cues = episode.dialogueCues.filter(cue => cue.shotId === shotId).sort((a, b) => a.startMs - b.startMs);
  if (!cues.some(cue => document.assets.some(asset => asset.id === (cue.voiceAssetVersionId ?? cue.audioAssetVersionId) && asset.durationMs))) return document;
  let previousEnd = owner.startMs - 120;
  const fitted = cues.map(cue => {
    const asset = document.assets.find(item => item.id === (cue.voiceAssetVersionId ?? cue.audioAssetVersionId));
    const durationMs = Math.max(1, Math.round(asset?.durationMs ?? cue.endMs - cue.startMs));
    const startMs = Math.max(cue.startMs, previousEnd + 120);
    previousEnd = startMs + durationMs;
    return { cue, startMs, endMs: previousEnd, durationMs };
  });
  let nextStart = owner.startMs + owner.durationMs + 120;
  for (const item of [...fitted].reverse()) {
    item.endMs = Math.min(item.endMs, nextStart - 120);
    item.startMs = item.endMs - item.durationMs;
    nextStart = item.startMs;
  }
  // Keep the recording/history if it cannot fit. Render preflight must report
  // the truncated speech instead of silently exporting an incomplete sentence.
  if (fitted.some(item => item.startMs < owner.startMs)) return document;
  const measuredDuration = (cue: MotionComicDialogueCue) => document.assets.find(asset => asset.id === (cue.voiceAssetVersionId ?? cue.audioAssetVersionId))?.durationMs;
  const byId = new Map(fitted.map(item => [item.cue.id, item]));
  return { ...document, episodes: document.episodes.map(item => item !== episode ? item : {
    ...item,
    dialogueCues: item.dialogueCues.map(cue => {
      const timing = byId.get(cue.id);
      if (!timing || cue.startMs === timing.startMs && cue.endMs === timing.endMs) return cue;
      return invalidateSubtitleAlignment(cue, { startMs: timing.startMs, endMs: timing.endMs }) as MotionComicDialogueCue;
    }),
    timeline: { ...item.timeline, audioClips: item.timeline.audioClips?.map(clip => {
      const timing = fitted.find(value => clip.id === `dialogue-clip-${value.cue.id}`);
      return timing ? { ...clip, startMs: timing.startMs, durationMs: timing.durationMs, ...(measuredDuration(timing.cue) ? { sourceDurationMs: timing.durationMs, sourceMediaDurationMs: timing.durationMs } : {}) } : clip;
    }) },
  }) };
}
