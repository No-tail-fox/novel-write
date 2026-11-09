/** Interpret source formatting, not a character-deleting subtitle validator. */
function markupMask(source: string): Set<number> {
  const removed = new Set<number>(), protectedChars = new Set<number>();
  const escaped = (index: number) => { let count = 0; while (index > 0 && source[--index] === '\\') count++; return count % 2 === 1; };
  for (const match of source.matchAll(/(`+)[^`]*?\1/g)) for (let i = match.index!; i < match.index! + match[0].length; i++) protectedChars.add(i);
  const mark = (start: number, length: number) => { for (let i = start; i < start + length; i++) if (!protectedChars.has(i)) removed.add(i); };
  for (const match of source.matchAll(/^[ \t]{0,3}(#{1,6})[ \t]+(?=\S)/gm)) {
    const start = match.index! + match[0].indexOf('#'); if (!protectedChars.has(start)) mark(start, match[1].length);
  }
  for (const match of source.matchAll(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g)) {
    const start = match.index!, end = start + match[0].length - 2;
    if (escaped(start) || escaped(end) || protectedChars.has(start) || protectedChars.has(end)) continue;
    // Intraword underscores, unmatched marks and literal symbols survive.
    if (match[1] === '__' && (/[\p{L}\p{N}_]/u.test(source[start - 1] ?? '') || /[\p{L}\p{N}_]/u.test(source[end + 2] ?? ''))) continue;
    mark(start, 2); mark(end, 2);
  }
  return removed;
}
export function editorialScriptPlainText(source: string): string {
  const mask = markupMask(source);
  return source.split('').filter((_, index) => !mask.has(index)).join('').replace(/\s+/gu, ' ').trim();
}
/** Exact whole-script matching protects user-edited captions. Source offsets are
 * mapped before cue splitting, including paired markup spanning multiple cues.
 * This is a read-only presentation of legacy data: no timing/audio/source edits.
 */
export function editorialPresentationCues<T extends { text: string }>(source: string | undefined, cues: readonly T[]): T[] {
  if (!source) return [...cues];
  const mask = markupMask(source);
  if (!mask.size) return [...cues];
  const positions = [...source.matchAll(/\S/gu)].map(match => match.index!);
  const compact = (text: string) => text.replace(/\s/gu, '');
  if (compact(cues.map(cue => cue.text).join('')) !== compact(source)) return [...cues];
  let cursor = 0;
  const projected = cues.map(cue => {
    let text = '';
    for (const character of cue.text) {
      if (/\s/u.test(character)) text += character;
      else { if (!mask.has(positions[cursor])) text += character; cursor++; }
    }
    return text === cue.text ? cue : { ...cue, text };
  });
  // Never invent timing or silently discard a format-only legacy caption.
  return projected.some(cue => !cue.text.trim()) ? [...cues] : projected;
}