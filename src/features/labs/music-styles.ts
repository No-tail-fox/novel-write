import { MUSIC_STYLE_GROUPS, type MusicStyleTag } from './music-style-catalog';

export const musicStyleKey = (tag: MusicStyleTag) => tag.en.trim().toLocaleLowerCase();
const entries = MUSIC_STYLE_GROUPS.flatMap(group => group.categories.flatMap(category => category.tags));
export const MUSIC_STYLE_COUNT = entries.length;
function unique(tags: readonly MusicStyleTag[]): MusicStyleTag[] {
  return [...new Map(tags.map(tag => [musicStyleKey(tag), tag])).values()];
}
export const MUSIC_STYLE_TAGS = unique(entries);
const byLabel = new Map<string, MusicStyleTag>();
for (const tag of entries) {
  for (const label of [tag.zh, tag.en]) {
    const key = label.toLocaleLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, tag);
  }
}
const lookup = (text: string) => byLabel.get(text.trim().toLocaleLowerCase());
export function findMusicStyles(query: string): MusicStyleTag[] {
  const needle = query.trim().toLocaleLowerCase();
  return unique(entries.filter(tag => tag.zh.toLocaleLowerCase().includes(needle) || tag.en.toLocaleLowerCase().includes(needle)));
}
export function selectedMusicStyles(value: string): MusicStyleTag[] {
  return unique(value.split(/[,，;；\n]+/u).flatMap(part => {
    const tag = lookup(part);
    return tag ? [tag] : [];
  }));
}
/** Only exact catalog tokens are managed by the picker; free-form prose stays intact. */
export function mergeMusicStyles(value: string, selected: readonly MusicStyleTag[], english: boolean): string {
  const parts = value.split(/([,，;；\n]+)/u);
  const hasTags = parts.some((part, index) => index % 2 === 0 && lookup(part));
  let custom = value;
  if (hasTags) {
    custom = '';
    for (let index = 0; index < parts.length; index += 2) {
      if (!parts[index].trim() || lookup(parts[index])) continue;
      custom += `${custom ? parts[index - 1] : ''}${parts[index]}`;
    }
    custom = custom.trim();
  }
  const tags = unique(selected).map(tag => english ? tag.en : tag.zh).join(', ');
  return tags ? `${custom.trimEnd()}${custom.trim() ? ', ' : ''}${tags}` : custom;
}
