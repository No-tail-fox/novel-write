import type { StoryboardScene } from './types';

export type PodcastTurnSpeaker = 'A' | 'B';

export interface PodcastDialogueTurn {
  sceneId: number;
  speaker: PodcastTurnSpeaker;
  turnIndex: number;
  text: string;
}

const turnLabelPattern = /(^|[\s。！？!?；;])(?:(?:Host\s*)?([AB])|(?:主持人|主播)\s*([ABＡＢ])|(咔仔|大壹|刘飞|潇磊))\s*[:：]\s*/giu;
const sentencePattern = /[^。！？!?；;]+[。！？!?；;]?/g;
const displayNameSpeakers: Record<string, PodcastTurnSpeaker> = {
  咔仔: 'A',
  刘飞: 'A',
  大壹: 'B',
  潇磊: 'B',
};

export function splitPodcastDialogue(scene: Pick<StoryboardScene, 'id' | 'cap'>): PodcastDialogueTurn[] {
  const caption = scene.cap.trim();
  if (!caption) return [];

  const labeled = parseLabeledTurns(scene.id, caption);
  if (labeled.length > 0) return labeled;

  return splitFallbackSentences(scene.id, caption);
}

function parseLabeledTurns(sceneId: number, caption: string): PodcastDialogueTurn[] {
  const labels = Array.from(caption.matchAll(turnLabelPattern));
  if (labels.length === 0) return [];
  const turns: PodcastDialogueTurn[] = [];
  labels.forEach((match, index) => {
    const textStart = matchIndex(match) + match[0].length;
    const textEnd = index + 1 < labels.length ? labelStartIndex(labels[index + 1]) : caption.length;
    const text = caption.slice(textStart, textEnd).trim();
    if (text) {
      turns.push({
        sceneId,
        speaker: normalizeLabelMatch(match),
        turnIndex: turns.length + 1,
        text,
      });
    }
  });
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

function normalizeLabelMatch(match: RegExpMatchArray): PodcastTurnSpeaker {
  const displayName = match[4];
  if (displayName) return displayNameSpeakers[displayName] ?? 'A';
  return normalizeSpeaker(match[2] ?? match[3] ?? 'A');
}

function labelStartIndex(match: RegExpMatchArray): number {
  return matchIndex(match) + (match[1]?.length ?? 0);
}

function matchIndex(match: RegExpMatchArray): number {
  return match.index ?? 0;
}
