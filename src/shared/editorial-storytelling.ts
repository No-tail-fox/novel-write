import type { EditorialCollageBeat, EditorialCollageLayer, EditorialCollagePipelineData, EditorialCollageShot } from './editorial-collage';

/** Beat roles describe an outline, not copy intended for the audience. */
export function isEditorialStructureTitle(text: string): boolean {
  return /^(?:钩子|背景|证据|结论|开场|主体|正文|收尾|新节拍|新镜头|关键证据|hook|background|evidence|conclusion)(?:\s*[·.\-—]?\s*\d+)?$/iu.test(text.trim());
}

const cleanCopy = (text: string) => text.replace(/^\s*(?:钩子|背景|证据|结论|开场|主体|正文|收尾)\s*[:：]\s*/u, '').trim().replace(/[。！？!?；;，,\s]+$/gu, '');

/** Conservative local fallback: quote a clause from the source without inventing a claim. */
export function editorialContentTitle(narration: string, fallback = ''): string {
  const firstSentence = narration.trim().split(/[。！？!?；;\n]/u).find((part) => part.trim());
  const clauses = (firstSentence ?? '').split(/[，,：:]/u).map(cleanCopy).filter((part) => part && !isEditorialStructureTitle(part));
  const useful = clauses.find((part) => Array.from(part).length >= 4) ?? clauses[0];
  const text = useful || (!isEditorialStructureTitle(fallback) ? cleanCopy(fallback) : '');
  if (Array.from(text).length <= 32) return text;
  const words = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)];
  let result = '';
  for (const { segment } of words) {
    if (Array.from(result + segment).length > 31) break;
    result += segment;
  }
  return `${(result || Array.from(text).slice(0, 31).join('')).trimEnd()}…`;
}

export function editorialShotNarration(beat: EditorialCollageBeat, shot: EditorialCollageShot): string {
  return shot.subtitleCueIds.flatMap((id) => beat.subtitleCues.find((cue) => cue.id === id)?.text ?? []).join('');
}

export function editorialShotTitle(document: Pick<EditorialCollagePipelineData, 'title'>, beat: EditorialCollageBeat, shot: EditorialCollageShot): string {
  if (shot.title !== undefined) return shot.title;
  const authoredLabel = shot.layers.find((layer) => layer.kind === 'label' && layer.content?.text.trim() && !isEditorialStructureTitle(layer.content.text));
  if (authoredLabel?.content) return authoredLabel.content.text;
  if (beat.title.trim() && !isEditorialStructureTitle(beat.title)) return beat.title;
  return editorialContentTitle(editorialShotNarration(beat, shot) || beat.narration, document.title);
}

/** Repair only the known outline placeholders; preserve custom copy, timing and assets. */
export function normalizeEditorialStoryTitles(document: EditorialCollagePipelineData): EditorialCollagePipelineData {
  let changed = false;
  const beats = document.beats.map((beat) => ({ ...beat, shots: beat.shots.map((shot) => {
    const staleLabels = shot.layers.some((layer) => layer.kind === 'label' && layer.content && isEditorialStructureTitle(layer.content.text));
    if (!staleLabels) return shot;
    const title = editorialShotTitle(document, beat, shot);
    changed = true;
    return { ...shot, title, layers: shot.layers.map((layer) => layer.kind === 'label' && layer.content && isEditorialStructureTitle(layer.content.text)
      ? { ...layer, label: title || '标题', content: { type: 'text' as const, text: title }, ...(title ? {} : { visible: false }) } : layer) };
  }) }));
  return changed ? { ...document, beats } : document;
}

export function updateEditorialTitleLayers(layers: EditorialCollageLayer[], previousTitle: string, title: string): EditorialCollageLayer[] {
  return layers.map((layer) => layer.kind === 'label' && layer.content && (layer.content.text === previousTitle || isEditorialStructureTitle(layer.content.text))
    ? { ...layer, label: title || '标题', content: { type: 'text' as const, text: title }, visible: Boolean(title.trim()) } : layer);
}
