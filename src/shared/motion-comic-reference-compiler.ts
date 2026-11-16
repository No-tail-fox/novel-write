import type { MotionComicPipelineData, MotionComicShot } from './motion-comic';
import type { MotionComicSubmittedReference } from './motion-comic-video';

export type MotionComicReferenceKind = 'look' | 'scene' | 'prop';
export function motionComicReferenceToken(kind: MotionComicReferenceKind, id: string): string {
  return `@{${kind}:${encodeURIComponent(id)}}`;
}

export interface MotionComicResolvedMention {
  kind: MotionComicReferenceKind;
  ownerId: string;
  assetVersionId: string;
  referenceNumber: number;
}
interface Entity {
  kind: MotionComicReferenceKind | 'character';
  id: string;
  name: string;
}

/** Compile only authored fields against the exact ordered images in the request. Never bind assets. */
export function compileMotionComicReferenceMentions(input: {
  document: MotionComicPipelineData;
  shot: MotionComicShot;
  references: readonly MotionComicSubmittedReference[];
  prompt: string;
  motionPrompt: string;
}): { prompt: string; motionPrompt: string; resolved: MotionComicResolvedMention[] } {
  const { document, shot, references } = input;
  const entities: Entity[] = [
    ...document.characters.map(c => ({ kind: 'character' as const, id: c.id, name: c.name })),
    ...document.sceneAssets.map(s => ({ kind: 'scene' as const, id: s.id, name: s.label })),
    ...document.props.map(p => ({ kind: 'prop' as const, id: p.id, name: p.label })),
  ];
  const names = [...new Set(entities.map(e => e.name).filter(Boolean))].sort((a, b) => b.length - a.length);
  const resolved: MotionComicResolvedMention[] = [];
  const fail = (code: string, message: string): never => { throw new Error(`DIRECTOR_VIDEO_MENTION_${code}: ${message}`); };
  function resolve(entity: Entity): string {
    if (shot.videoProduction?.referenceMode !== 'references') {
      return fail('MODE', `“${entity.name}”的参考图引用需要切换到多参考模式。`);
    }
    let kind: MotionComicReferenceKind;
    let ownerId = entity.id;
    let label = entity.name;
    if (entity.kind === 'character') {
      const character = document.characters.find(c => c.id === entity.id)!;
      const looks = character.looks.filter(l => shot.characterLookIds.includes(l.id));
      if (looks.length > 1) return fail('AMBIGUOUS', `人物“${entity.name}”绑定了多个造型，请使用指定造型的引用。`);
      if (!looks.length) return fail('UNBOUND', `人物“${entity.name}”尚未绑定到本镜，请先绑定对应造型。`);
      kind = 'look'; ownerId = looks[0].id;
      label = `${entity.name} / ${looks[0].label}`;
    } else {
      kind = entity.kind;
      const bound = kind === 'look' ? shot.characterLookIds.includes(ownerId)
        : kind === 'scene' ? shot.sceneAssetId === ownerId : shot.propAssetIds.includes(ownerId);
      if (!bound) return fail('UNBOUND', `“${label}”尚未绑定到本镜，请先绑定对应资产。`);
    }
    const referenceKind = kind === 'look' ? 'character' : kind === 'prop' ? 'object' : 'scene';
    const matches = references.flatMap((r, index) => r.ownerId === ownerId && r.kind === referenceKind ? [{ r, index }] : []);
    if (matches.length > 1) return fail('AMBIGUOUS', `“${label}”在提交参考图中重复，请检查绑定。`);
    if (!matches.length || !matches[0].r.path.trim()) return fail('REFERENCE_MISSING', `“${label}”缺少已确认并提交的固定参考图。`);
    const { r, index } = matches[0];
    const mention = { kind, ownerId, assetVersionId: r.assetVersionId, referenceNumber: index + 1 };
    if (!resolved.some(m => m.kind === kind && m.ownerId === ownerId)) resolved.push(mention);
    return `${label}（参考图${index + 1}）`;
  }
  function typed(raw: string): string {
    const match = /^@\{(look|scene|prop):([^{}]+)\}$/u.exec(raw);
    if (!match) return fail('TOKEN_INVALID', '无法识别的明确参考图引用，请重新插入人物造型、场景或道具引用。');
    let id: string;
    try { id = decodeURIComponent(match[2]); } catch { return fail('TOKEN_INVALID', '参考图引用的标识编码无效，请重新插入。'); }
    const kind = match[1] as MotionComicReferenceKind;
    const candidates: Entity[] = kind === 'look'
      ? document.characters.flatMap(c => c.looks.filter(l => l.id === id).map(l => ({ kind, id, name: `${c.name} / ${l.label}` })))
      : entities.filter(e => e.kind === kind && e.id === id);
    if (!candidates.length) return fail('UNKNOWN', '引用的资产已不存在，请重新插入参考图引用。');
    if (candidates.length !== 1) return fail('AMBIGUOUS', '引用的稳定标识不唯一，请检查资产。');
    return resolve(candidates[0]);
  }
  function compile(text: string): string {
    // Preserve fenced/inline Markdown code, escaped characters, and email addresses verbatim.
    const protectedSpans = /(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[^\n]*(?:\n|$)|(?![\s\S])))|(`+)[\s\S]*?\3|^(?: {4}|\t)[^\n]*|\\[\s\S]|[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}/gmu;
    let output = '', offset = 0;
    // Scan ordinary spans separately so replacement length never affects source offsets.
    function scan(plain: string): string {
      let result = '';
      for (let i = 0; i < plain.length;) {
        if (plain[i] !== '@') { result += plain[i++]; continue; }
        if (i > 0 && /[A-Za-z0-9_.%+\-@]/u.test(plain[i - 1])) { result += plain[i++]; continue; }
        if (plain[i + 1] === '{') {
          const end = plain.indexOf('}', i + 2);
          if (end < 0) return fail('TOKEN_INVALID', '参考图引用缺少结束括号，请重新插入。');
          result += typed(plain.slice(i, end + 1)); i = end + 1; continue;
        }
        const rest = plain.slice(i + 1);
        const name = names.find(n => rest.startsWith(n) && !(/[A-Za-z0-9_]$/u.test(n) && /^[A-Za-z0-9_]/u.test(rest.slice(n.length))));
        if (!name) { result += plain[i++]; continue; }
        const candidates = entities.filter(e => e.name === name);
        if (candidates.length !== 1) return fail('AMBIGUOUS', `名称“${name}”对应多个资产，请使用指定资产的引用。`);
        result += resolve(candidates[0]); i += name.length + 1;
      }
      return result;
    }
    for (const match of text.matchAll(protectedSpans)) {
      output += scan(text.slice(offset, match.index)) + match[0]; offset = match.index! + match[0].length;
    }
    return output + scan(text.slice(offset));
  }
  return { prompt: compile(input.prompt), motionPrompt: compile(input.motionPrompt), resolved };
}
