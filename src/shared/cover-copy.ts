import type { CoverMetadata } from './types';

const characterTrackIds = new Set(['character-story', '人物故事']);
const hookSignalPattern = /\d|却|竟|从.+到|为何|为什么|怎么|如何|一生|命运|逆袭|翻身|改写|最后|最终|无人|唯一|输|赢|败|称帝|当选|被|靠|守|救|离开|归来|真相|秘密|代价|结局/u;

export const characterCoverDisplayRules = [
  '【草稿封面展示硬约束：优先于上方模板中的旧 title 规则】',
  '1. cover.title 是画面最上方的点击钩子，必须用 6-14 字概括最强冲突、反差、数字、悬念或结果。',
  '2. title 严禁只输出人物姓名、人物身份、书名、品牌名或主题名；人物姓名应放在标签或简介中。',
  '3. cover.subtitle 提供 1-2 条补充钩子，每条不超过 14 字，与 title 形成递进，不得重复 title。',
  '4. 错误示例：title=李明博。正确示例：title=从纸箱到总统，subtitle=[66岁生日逆转命运]。',
  '5. 输出前自检：单独看 title 和 subtitle，观众是否会因为反差或悬念想继续看；如果只是知道“讲的是谁”，必须重写。',
].join('\n');

export function isCharacterStoryTrack(track: string | undefined): boolean {
  return characterTrackIds.has(track?.trim().toLowerCase() ?? '');
}

export function resolveCoverDisplayMetadata(
  cover: CoverMetadata,
  options: { track?: string; sourceText?: string } = {},
): CoverMetadata {
  const title = cleanCoverLine(cover.title);
  const subtitle = uniqueLines(cover.subtitle.map(cleanCoverLine).filter(Boolean));
  const normalized = {
    ...cover,
    title,
    subtitle,
  };
  if (!isCharacterStoryTrack(options.track)) return normalized;

  const sourceText = options.sourceText?.trim() ?? '';
  const fallbackLines = deriveHookLines(sourceText, title);
  if (!isBareCharacterIdentity(title, cover.tags, sourceText)) {
    return {
      ...normalized,
      subtitle: subtitle.length > 0
        ? subtitle
        : fallbackLines.filter((line) => !sameCoverLine(line, title)).slice(0, 2),
    };
  }

  const promotedTitle = subtitle[0] || fallbackLines[0] || title;
  const explicitSubtitle = subtitle.slice(1).filter((line) => !sameCoverLine(line, promotedTitle));
  const remainingSubtitle = (explicitSubtitle.length > 0
    ? explicitSubtitle
    : fallbackLines.filter((line) => !sameCoverLine(line, promotedTitle)))
    .slice(0, 2);

  return {
    ...normalized,
    title: promotedTitle,
    subtitle: remainingSubtitle,
  };
}

function isBareCharacterIdentity(title: string, tags: string[], sourceText: string): boolean {
  const compactTitle = identityKey(title);
  if (!compactTitle || hookSignalPattern.test(title)) return false;
  if (!/^[\p{Script=Han}·]{2,6}$/u.test(compactTitle)) return false;

  const sourceMentions = sourceText ? sourceText.split(compactTitle).length - 1 : 0;
  const hasIdentityTag = tags.some((tag) => identityKey(tag) === compactTitle);
  return hasIdentityTag || sourceMentions >= 2;
}

function deriveHookLines(sourceText: string, identityTitle: string): string[] {
  if (!sourceText) return [];
  const escapedIdentity = escapeRegExp(identityKey(identityTitle));
  const identityPattern = escapedIdentity ? new RegExp(escapedIdentity, 'gu') : null;
  const candidates = sourceText
    .replace(/\r/g, '')
    .split(/[\n。！？!?；;，,：:]/u)
    .map((line) => cleanCoverLine(identityPattern ? line.replace(identityPattern, '') : line))
    .filter((line) => visibleLength(line) >= 4 && visibleLength(line) <= 18)
    .map((line, index) => ({ line, index, score: hookScore(line) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ line }) => line);
  return uniqueLines(candidates).slice(0, 4);
}

function hookScore(line: string): number {
  let score = visibleLength(line) >= 6 && visibleLength(line) <= 14 ? 3 : 0;
  if (/\d/u.test(line)) score += 6;
  if (/却|竟|反而|没想到|无人|唯一|从.+到/u.test(line)) score += 5;
  if (/当选|称帝|逆袭|翻身|改写|输|赢|败|归来|离开|守|救/u.test(line)) score += 4;
  if (/为何|为什么|怎么|如何|真相|秘密|结局|代价/u.test(line)) score += 3;
  return score;
}

function cleanCoverLine(value: string): string {
  return value
    .replace(/^(?:主标题|副标题|标题)\s*[:：]\s*/u, '')
    .replace(/^[“”"'《》【】\s]+|[“”"'《》【】\s]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = identityKey(line);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameCoverLine(left: string, right: string): boolean {
  return identityKey(left) === identityKey(right);
}

function identityKey(value: string): string {
  return value.replace(/^#+/u, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

function visibleLength(value: string): number {
  return Array.from(value.replace(/\s+/g, '')).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
