/** Detect Huobao-style references only for characters explicitly known to this project. */
export function findCharacterTimbreReference(
  text: string,
  characters: readonly { name: string }[],
): string | undefined {
  const names = [...new Set(characters.map(character => character.name.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (!names.length) return undefined;

  // Backtick code and escaped hashes are literal text. Ordinary quotation marks
  // do not escape references: “#阿青：你好” can still request a character voice.
  const searchable = text.replace(/(`+)[\s\S]*?\1/gu, ' ');
  const alternatives = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  // Unicode boundaries prevent partial names / ordinary hashtags, including
  // Chinese suffixes. Punctuation immediately after a name is a valid boundary.
  const reference = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_#\\\\])#(${alternatives})(?:音色)?(?![\\p{L}\\p{N}\\p{M}_])`, 'u');
  return reference.exec(searchable)?.[1];
}

export function assertCharacterTimbreReferencesSupported(
  prompts: readonly string[],
  characters: readonly { name: string }[],
): void {
  if (prompts.some(prompt => findCharacterTimbreReference(prompt, characters) !== undefined)) {
    throw new Error('DIRECTOR_VIDEO_CHARACTER_TIMBRE_UNSUPPORTED: 当前服务尚未支持角色音色样本引用；请移除#角色名标记，角色样本仍可保存与试听');
  }
}
