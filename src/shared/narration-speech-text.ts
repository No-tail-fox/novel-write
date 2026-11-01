/** Derive speech-only text; never mutate the manuscript or subtitle cues. */
export function narrationSpeechText(text: string): string {
  return text
    // Headings may be inline after the storyboard collapses paragraph whitespace.
    .replace(/(^|\s)#{1,6}\s+(?=\S)/gu, '$1')
    .replace(/^\s{0,3}>\s?/gmu, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gmu, '')
    .replace(/!?\[([^\]\n]+)\]\((?:https?:\/\/|mailto:)[^\s)]+(?:\s+"[^"\n]*")?\)/gu, '$1')
    // Only paired, non-whitespace-delimited emphasis; preserve arithmetic and identifiers.
    .replace(/\*\*(?=\S)([^*]*?\S)\*\*/gu, '$1')
    .replace(/(?<![\p{L}\p{N}_])__(?=\S)([^_]*?\S)__(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, '$1')
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/`([^`\n]+)`/gu, '$1')
    .replace(/\s+/gu, ' ').trim();
}
