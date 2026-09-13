import { tokenizeSubtitleText } from './audio-alignment';

export const EDITORIAL_MAX_SOURCE_LENGTH = 1_000_000;
export const EDITORIAL_MAX_DURATION_MS = 120 * 60_000;
export const EDITORIAL_MAX_SHOTS = 500;
export type EditorialScriptDuration = 15_000 | 30_000 | 60_000 | 'auto';

export interface EditorialScriptCue { text: string; durationMs: number }
export interface EditorialScriptShot { durationMs: number; cues: EditorialScriptCue[] }
export interface EditorialScriptBeat { sectionIndex: number; title: string; narration: string; durationMs: number; shots: EditorialScriptShot[] }
export interface EditorialScriptPlan {
  durationMs: number;
  minimumDurationMs: number;
  sourceGraphemeCount: number;
  minimumReadingCharsPerSecond: number;
  maximumCueCharsPerSecond: number;
  beats: EditorialScriptBeat[];
  shotCount: number;
}

const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const words = new Intl.Segmenter('zh', { granularity: 'word' });

/** Reading estimate only; actual speech timestamps remain owned by audio alignment. */
export function editorialCueReadingMs(text: string): number {
  const units = tokenizeSubtitleText(text).reduce((sum, token) => sum + (/^[\p{P}\p{S}]+$/u.test(token) ? .35 : /^\p{Script=Han}$/u.test(token) ? 1 : Math.max(2, [...token].length / 4)), 0);
  return Math.max(1000, Math.ceil(units * 250));
}

export function splitEditorialScriptText(text: string, maxCharacters = 18): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error('Invalid subtitle width.');
  const characters = Array.from(graphemes.segment(text), (part) => part.segment);
  const chunks: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let end = Math.min(characters.length, start + maxCharacters);
    if (end < characters.length) {
      for (let index = end - 1; index > start; index -= 1) {
        if (/\s/u.test(characters[index]) || (index >= start + Math.floor(maxCharacters / 2) && /[。！？!?；;，,、:：]/u.test(characters[index]))) { end = index + 1; break; }
      }
    }
    const chunk = characters.slice(start, end).join('');
    if (chunk.trim()) chunks.push(chunk);
    else if (chunks.length) chunks[chunks.length - 1] += chunk;
    start = end;
  }
  return chunks;
}

export function planEditorialScript(sourceText: string, requested: EditorialScriptDuration = 30_000): EditorialScriptPlan {
  if (sourceText.length > EDITORIAL_MAX_SOURCE_LENGTH) throw new Error('EDITORIAL_SOURCE_TOO_LONG: 原稿最多 1,000,000 个字符。');
  const normalized = sourceText.replace(/\s+/gu, ' ').trim();
  if (!normalized) throw new Error('EDITORIAL_SOURCE_EMPTY: 请填写原始文案。');
  if (normalized.length > 18 * (EDITORIAL_MAX_DURATION_MS / 1000)) throw new Error('EDITORIAL_SCRIPT_CAPACITY: 全文超过单项目 120 分钟容量，请按章节分别创建项目。');
  const sentences = normalized.split(/(?<=[。！？!?；;])/u).filter(Boolean);
  const sections = ['', '', '', ''];
  if (sentences.length >= 4) {
    sentences.forEach((sentence, index) => { sections[Math.floor(index * 4 / sentences.length)] += sentence; });
  } else {
    // Partition on word boundaries; cue splitting below also preserves graphemes.
    let offset = 0;
    let section = 0;
    for (const part of words.segment(normalized)) {
      if (part.segment.trim()) section = Math.min(3, Math.floor(offset * 4 / normalized.length));
      sections[section] += part.segment;
      offset += part.segment.length;
    }
  }
  const titles = ['钩子', '背景', '证据', '结论'];
  const baseDurations = requested === 'auto' ? [0, 0, 0, 0] : requested === 15_000 ? [2000, 4333, 4334, 4333] : requested === 30_000 ? [3000, 9000, 9000, 9000] : [3000, 19000, 19000, 19000];
  const entries = sections.map((text) => {
    const cues = splitEditorialScriptText(text).map((cue) => ({ text: cue, durationMs: editorialCueReadingMs(cue) }));
    if (cues.some((cue) => cue.durationMs > 15000)) throw new Error('EDITORIAL_SCRIPT_CAPACITY: 单句包含过多组合字符，请分段整理原稿后重试。');
    return { cues, minimum: Math.max(requested === 'auto' ? 0 : 1000, cues.reduce((sum, cue) => sum + cue.durationMs, 0)) };
  });
  const minimumDurationMs = entries.reduce((sum, entry) => sum + entry.minimum, 0);
  if (minimumDurationMs > EDITORIAL_MAX_DURATION_MS) throw new Error(`EDITORIAL_SCRIPT_CAPACITY: 全文预计至少 ${Math.ceil(minimumDurationMs / 60_000)} 分钟，超过单项目 120 分钟容量，请按章节分别创建项目。`);
  if (requested !== 'auto' && minimumDurationMs > requested) throw new Error(`EDITORIAL_SCRIPT_TOO_FAST: 当前文案预计至少 ${Math.ceil(minimumDurationMs / 1000)} 秒，超过所选 ${requested / 1000} 秒。请缩短文案或选择“按全文分配时长”。`);
  const extra = requested === 'auto' ? 0 : requested - minimumDurationMs;
  const weights = entries.map((entry, index) => Math.max(0, baseDurations[index] - entry.minimum));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  const beats: EditorialScriptBeat[] = [];
  entries.forEach((entry, sectionIndex) => {
    const cumulative = weights.slice(0, sectionIndex + 1).reduce((sum, weight) => sum + weight, 0);
    const nextAllocated = sectionIndex === 3 ? extra : Math.round(extra * cumulative / (weightSum || 1));
    const durationMs = entry.minimum + nextAllocated - allocated;
    allocated = nextAllocated;
    const cueMinimum = entry.cues.reduce((sum, cue) => sum + cue.durationMs, 0);
    const capacity = entry.cues.reduce((sum, cue) => sum + 15000 - cue.durationMs, 0);
    const surplus = Math.min(durationMs - cueMinimum, capacity);
    let distributed = 0;
    let cumulativeCapacity = 0;
    const cues = entry.cues.map((cue) => {
      cumulativeCapacity += 15000 - cue.durationMs;
      const next = Math.round(surplus * cumulativeCapacity / (capacity || 1));
      const result = { ...cue, durationMs: cue.durationMs + next - distributed };
      distributed = next;
      return result;
    });
    const shots: EditorialScriptShot[] = [];
    let shot: EditorialScriptShot = { durationMs: 0, cues: [] };
    for (const cue of cues) {
      if (shot.durationMs + cue.durationMs > 15000 && shot.cues.length) { shots.push(shot); shot = { durationMs: 0, cues: [] }; }
      if (cue.durationMs > 15000) throw new Error('EDITORIAL_SCRIPT_CAPACITY: 单句与所选时长不匹配，请选择按全文分配时长。');
      shot.cues.push(cue);
      shot.durationMs += cue.durationMs;
    }
    if (shot.cues.length) shots.push(shot);
    let remaining = durationMs - shots.reduce((sum, item) => sum + item.durationMs, 0);
    while (remaining > 0) { const duration = Math.min(15000, remaining); shots.push({ durationMs: duration, cues: [] }); remaining -= duration; }
    // Beat and shot capacities match the persisted document contract.
    let group: EditorialScriptShot[] = [];
    let cueCount = 0;
    let part = 1;
    const flush = () => {
      if (!group.length) return;
      beats.push({ sectionIndex, title: `${titles[sectionIndex]}${part > 1 ? ` · ${part}` : ''}`, narration: group.flatMap((item) => item.cues.map((cue) => cue.text)).join(''), durationMs: group.reduce((sum, item) => sum + item.durationMs, 0), shots: group });
      group = []; cueCount = 0; part += 1;
    };
    for (const item of shots) {
      if (group.length >= 100 || cueCount + item.cues.length > 200) flush();
      group.push(item); cueCount += item.cues.length;
    }
    flush();
  });
  const shotCount = beats.reduce((sum, beat) => sum + beat.shots.length, 0);
  if (beats.length > 12 || shotCount > EDITORIAL_MAX_SHOTS) throw new Error('EDITORIAL_SCRIPT_CAPACITY: 全文超过单项目 12 个节拍或 500 个镜头容量，请按章节分别创建项目。');
  const sourceGraphemeCount = [...graphemes.segment(normalized)].filter(({ segment }) => !/\s/u.test(segment)).length;
  const allCues = entries.flatMap((entry) => entry.cues);
  const maximumCueCharsPerSecond = allCues.reduce((maximum, cue) => {
    const count = [...graphemes.segment(cue.text)].filter(({ segment }) => !/\s/u.test(segment)).length;
    return Math.max(maximum, count / (cue.durationMs / 1000));
  }, 0);
  return {
    durationMs: beats.reduce((sum, beat) => sum + beat.durationMs, 0),
    minimumDurationMs,
    sourceGraphemeCount,
    minimumReadingCharsPerSecond: sourceGraphemeCount / (minimumDurationMs / 1000),
    maximumCueCharsPerSecond,
    beats,
    shotCount,
  };
}
