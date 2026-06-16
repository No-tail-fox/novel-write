import type { StoryboardScene } from './types';

export type PodcastTurnSpeaker = 'A' | 'B';

export interface PodcastDialogueTurn {
  sceneId: number;
  speaker: PodcastTurnSpeaker;
  turnIndex: number;
  text: string;
}

const labeledTurnPattern = /^\s*(?:Host\s*)?([AB])\s*[:：]\s*(.+)$/i;
const chineseLabeledTurnPattern = /^\s*(?:主持人|主播)\s*([ABＡＢ])\s*[:：]\s*(.+)$/i;
const sentencePattern = /[^。！？!?；;]+[。！？!?；;]?/g;

export function splitPodcastDialogue(scene: Pick<StoryboardScene, 'id' | 'cap'>): PodcastDialogueTurn[] {
  const caption = scene.cap.trim();
  if (!caption) return [];

  const labeled = parseLabeledTurns(scene.id, caption);
  if (labeled.length > 0) return labeled;

  return splitFallbackSentences(scene.id, caption);
}

function parseLabeledTurns(sceneId: number, caption: string): PodcastDialogueTurn[] {
  const turns: PodcastDialogueTurn[] = [];
  for (const rawLine of caption.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(chineseLabeledTurnPattern) ?? line.match(labeledTurnPattern);
    if (!match) continue;
    const text = match[2]?.trim();
    if (!text) continue;
    turns.push({
      sceneId,
      speaker: normalizeSpeaker(match[1]),
      turnIndex: turns.length + 1,
      text,
    });
  }
  return turns;
}

function splitFallbackSentences(sceneId: number, caption: string): PodcastDialogueTurn[] {
  const sentences = Array.from(caption.matchAll(sentencePattern))
    .map((match) => match[0].trim())
    .filter(Boolean);
  const parts = sentences.length > 0 ? sentences : [caption];
  return parts.map((text, index) => ({
    sceneId,
    speaker: index % 2 === 0 ? 'A' : 'B',
    turnIndex: index + 1,
    text,
  }));
}

function normalizeSpeaker(value: string): PodcastTurnSpeaker {
  const normalized = value.toUpperCase();
  return normalized === 'B' || normalized === 'Ｂ' ? 'B' : 'A';
}
