import type { EditorialCollagePipelineData } from './editorial-collage';
import type { CodeVideoPolicy } from './creative-animation/production-policy';

export const DEFAULT_PI_SEGMENT_CHARS = 12_000;
const MAX_SEGMENT_CHARS = 24_000;
export const MAX_PI_HANDOFF_CHARS = 4_000;
const MAX_SUMMARY_CHARS = MAX_PI_HANDOFF_CHARS;

/** Deterministic lossless text windows; prefer sentence, then whitespace, then grapheme boundaries. */
export function splitPiNarration(text: string, maxChars = DEFAULT_PI_SEGMENT_CHARS): string[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 128 || maxChars > MAX_SEGMENT_CHARS) throw new Error('PI_CONTEXT_CHUNK_LIMIT');
  if (!text.trim()) return [];
  if (text.length > 1000 * MAX_SEGMENT_CHARS) throw new Error('PI_CONTEXT_TOTAL_TOO_LARGE');
  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), item => ({ text: item.segment, end: item.index + item.segment.length }));
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const limit = Math.min(text.length, start + maxChars);
    if (limit === text.length) { chunks.push(text.slice(start)); break; }
    const candidates = parts.filter(part => part.end > start && part.end <= limit);
    if (!candidates.length) throw new Error('PI_CONTEXT_GRAPHEME_TOO_LARGE');
    const sentence = [...candidates].reverse().find(part => /[。！？.!?\n]/u.test(part.text));
    const word = [...candidates].reverse().find(part => /\s/u.test(part.text));
    const end = (sentence ?? word ?? candidates.at(-1)!).end;
    chunks.push(text.slice(start, end)); start = end;
  }
  if (chunks.length > 1000 || chunks.join('') !== text) throw new Error('PI_CONTEXT_SEGMENT_LIMIT');
  return chunks;
}

function boundedJson(value: unknown, maxChars: number, error: string): string {
  const json = JSON.stringify(value);
  if (json.length > maxChars) throw new Error(error);
  return json;
}

/** Short global constraints, not a duplicate of source text, cues, or all shots. */
export function buildPiGlobalPlan(document: EditorialCollagePipelineData, durationMs: number, segmentCount: number, policy: CodeVideoPolicy): string {
  const plan = {
    title: document.title,
    thesis: document.productionRun?.settings.authoring?.brief ?? '',
    targetDurationSeconds: policy.targetDurationSeconds,
    actualNarrationDurationSeconds: durationMs / 1000,
    segmentCount,
    segmentRule: 'Ordered contiguous narration windows. Preserve wording, facts and meaning. Use prior handoff for continuity; final clock and audio are host-owned.',
    data: document.productionRun?.settings.data ?? [],
    narrationEnabled: document.productionRun?.settings.narration !== false,
    captionMode: policy.captionMode,
    archives: document.productionRun?.settings.archives.map(({ assetVersionId, source, description, license }) => ({ assetVersionId, source, description, license })) ?? [],
  };
  return boundedJson(plan, 12_000, 'PI_CONTEXT_GLOBAL_PLAN_TOO_LARGE');
}

/** A bounded prompt: global summary plus only the current narration window and previous handoff. */
export function buildPiSegmentPrompt(input: {
  globalPlan: string; narration: string; segment: number; segmentCount: number; previousSummary?: string; narrationEnabled?: boolean; captionMode?: 'film' | 'host';
}): string {
  const summary = input.previousSummary?.trim() ?? '';
  if (summary.length > MAX_SUMMARY_CHARS) throw new Error('PI_CONTEXT_SUMMARY_TOO_LARGE');
  if (!Number.isSafeInteger(input.segment) || input.segment < 1 || input.segment > input.segmentCount || input.narration.length > DEFAULT_PI_SEGMENT_CHARS) {
    throw new Error('PI_CONTEXT_SEGMENT_RANGE');
  }
  const prompt = [
    'GLOBAL FILM PLAN (same across all segments):', input.globalPlan,
    input.narrationEnabled === false ? `SOURCE TEXT WINDOW ${input.segment}/${input.segmentCount} (NO NARRATION AUDIO):\n${input.narration}\nUse only for meaning; the host supplies no spoken narration.` : `CURRENT NARRATION WINDOW ${input.segment}/${input.segmentCount}:\n${input.narration}`,
    input.captionMode === 'film'
      ? 'Narration captions are authored in film code from exact host cues when present; do not assume host caption overlays.'
      : input.narrationEnabled === false
        ? 'Narration is disabled. Source text is context, not a host caption cue or speech timing. Host overlays only cues that exist in material/narration/cues.json; do not invent or duplicate captions.'
        : 'The host overlays exact original-text cues from material/narration/cues.json. Do not write duplicate subtitles or invent dialogue.',
    input.narrationEnabled === false && input.captionMode === 'host'
      ? 'Source text is not captioned by the host when there are no narration cues. Preserve any explicitly requested explanatory visual copy in the film; visual titles and labels are separate.'
      : 'Keep visual titles and labels distinct from spoken narration and timed caption cues.',
    'Visual text such as titles, labels, signs and explanatory copy remains film-authored and distinct from spoken narration and host captions.',
    summary ? `PREVIOUS SEGMENT HANDOFF (advisory):\n${summary}` : 'PREVIOUS SEGMENT HANDOFF: none; establish the film opening.',
    'CONTINUITY CONTRACT: keep typography, palette, title grammar, sound palette and transition motif consistent. Do not repeat prior source content, alter facts, or author outside this window. Read material/narration/cues.json only when speech timing is needed.',
  ].join('\n\n');
  if (prompt.length > 20_000) throw new Error('PI_CONTEXT_PROMPT_TOO_LARGE');
  return prompt;
}

const summaryHeadings = ['## Segment handoff', '## Segment summary', '## Segment continuity'] as const;
/** Extract a bounded handoff only from the treatment's explicit host-reviewed segment handoff section. */
export function parsePiSegmentHandoff(treatment: string): string {
  const lines = treatment.split(/\r?\n/u);
  const start = lines.findIndex(line => summaryHeadings.some(heading => line.trim().toLowerCase() === heading.toLowerCase()));
  if (start < 0) throw new Error('PI_SEGMENT_HANDOFF_REQUIRED');
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/u.test(line)) break;
    body.push(line);
  }
  const summary = body.join('\n').trim();
  if (!summary || summary.length > MAX_SUMMARY_CHARS) throw new Error('PI_SEGMENT_HANDOFF_INVALID');
  return summary;
}
