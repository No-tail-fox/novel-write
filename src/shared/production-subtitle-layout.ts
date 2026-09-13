import { z } from 'zod';
import type { ProductionQualityCheck } from './production-workflow';

declare global {
  interface Window {
    __tl?: { seek: (seconds: number) => Promise<unknown> };
  }
}

const rectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict();
const issueSchema = z.enum(['outside-safe-area', 'too-many-lines', 'title-overlap', 'cue-overlap', 'empty-text-bounds']);
const glyphCoverageSchema = z.object({
  status: z.enum(['ok', 'failed', 'unavailable']),
  /** Layout rectangles are evidence only; a font-engine verifier is required to pass the quality gate. */
  verification: z.enum(['layout-only', 'font-engine']).default('layout-only'),
  codePointCount: z.number().int().nonnegative(),
  renderedCodePointCount: z.number().int().nonnegative(),
  missingCodePoints: z.array(z.string().min(1).max(16)).max(256),
  fontFamilies: z.array(z.string().max(1024)).max(32).optional(),
  glyphCount: z.number().int().nonnegative().optional(),
}).strict();
const cueSchema = z.object({
  cueId: z.string().min(1).max(256).optional(),
  startMs: z.number().finite().nonnegative(), endMs: z.number().finite().nonnegative(),
  bounds: rectSchema, textBounds: rectSchema.nullable(), lineCount: z.number().int().nonnegative(),
  fontFamily: z.string().max(1024), fontSize: z.number().finite().positive(),
  issues: z.array(issueSchema).max(5),
  glyphCoverage: glyphCoverageSchema.optional(),
}).strict();
const visibilitySampleSchema = z.object({
  atMs: z.number().finite().nonnegative(),
  activeCueIds: z.array(z.string().max(256)).max(100),
}).strict();

export const productionSubtitleSceneLayoutSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'), shotId: z.string().min(1).max(256),
    width: z.number().int().positive(), height: z.number().int().positive(), fontsReady: z.literal(true),
    viewportWidth: z.number().int().positive(), viewportHeight: z.number().int().positive(),
    safeArea: rectSchema, titleBounds: rectSchema.nullable(), titleOutsideSafeArea: z.boolean(),
    cues: z.array(cueSchema).max(100), visibilitySamples: z.array(visibilitySampleSchema).max(200).optional(),
  }).strict(),
  z.object({ status: z.literal('failed'), shotId: z.string().min(1).max(256), error: z.string().min(1).max(2000) }).strict(),
]);

export const productionSubtitleLayoutEvidenceSchema = z.object({
  version: z.literal(1), measuredAt: z.iso.datetime(),
  scenes: z.array(productionSubtitleSceneLayoutSchema).max(500),
}).strict();

export type ProductionSubtitleSceneLayout = z.infer<typeof productionSubtitleSceneLayoutSchema>;
export type ProductionSubtitleLayoutEvidence = z.infer<typeof productionSubtitleLayoutEvidenceSchema>;

export function evaluateDirectorSubtitleLayout(
  scenes: readonly { id: string; index: number; durationMs: number; caption: string; subtitleCues?: readonly { id: string; text: string; startMs: number; endMs: number }[] }[],
  evidence: unknown,
  canvas: { width: number; height: number },
  sceneStarts?: ReadonlyMap<string, number>,
): ProductionQualityCheck[] {
  const parsed = productionSubtitleLayoutEvidenceSchema.safeParse(evidence);
  const measurements = parsed.success ? parsed.data.scenes : [];
  const byShot = new Map(measurements.map(scene => [scene.shotId, scene]));
  const completeSet = measurements.length === scenes.length && byShot.size === scenes.length;
  const issues: string[] = []; const missing: string[] = []; const glyphIssues: string[] = []; let glyphEvidenceComplete = measurements.length > 0;
  const affectedShots = new Set<string>(); const affectedCues = new Set<string>(); const glyphShots = new Set<string>();
  const labels = { 'outside-safe-area': '超出画面 5% 安全区', 'too-many-lines': '超过 3 行', 'title-overlap': '与标题重叠', 'cue-overlap': '与同时出现的字幕重叠', 'empty-text-bounds': '没有取得文字边界' };
  let offset = 0; let measuredCues = 0; let maxLines = 0;
  const visibilityIssues: string[] = [];
  for (const scene of scenes) {
    const sceneStart = sceneStarts?.get(scene.id) ?? offset;
    const cues = scene.subtitleCues ?? (scene.caption.trim() ? [{ id: undefined, text: scene.caption, startMs: 0, endMs: scene.durationMs }] : []);
    if (cues.length) glyphShots.add(scene.id);
    cues.forEach(cue => {
      if (/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(cue.text)) glyphIssues.push(`镜头 ${scene.index} 字幕含替换字符或控制字符`);
    });
    const measured = byShot.get(scene.id);
    const valid = completeSet && measured?.status === 'ok' && measured.width === canvas.width && measured.height === canvas.height
      && measured.cues.length === cues.length && cues.every((cue, index) => {
        const result = measured.cues[index];
        return result.cueId === cue.id && result.startMs === sceneStart + cue.startMs && result.endMs === sceneStart + cue.endMs;
      });
    if (!valid || measured?.status !== 'ok') {
      missing.push(`镜头 ${scene.index} ${measured?.status === 'failed' ? '排版测量失败' : '缺少匹配当前画布与字幕的测量'}`);
      affectedShots.add(scene.id);
      if (cues.length) glyphEvidenceComplete = false;
    } else {
      if (measured.titleOutsideSafeArea) { issues.push(`镜头 ${scene.index} 标题超出画面安全区`); affectedShots.add(scene.id); }
      const expectedSamples = cues.flatMap((cue, index) => [
        { atMs: sceneStart + cue.startMs, activeCueIds: cues.map((candidate, candidateIndex) => (candidate.startMs <= cue.startMs && cue.startMs < candidate.endMs) ? (candidate.id ?? `#${candidateIndex}`) : '').filter(Boolean) },
        { atMs: sceneStart + cue.endMs, activeCueIds: cues.map((candidate, candidateIndex) => (candidate.startMs <= cue.endMs && cue.endMs < candidate.endMs) ? (candidate.id ?? `#${candidateIndex}`) : '').filter(Boolean) },
      ]);
      if (!measured.visibilitySamples || expectedSamples.some(expected => {
        const actual = measured.visibilitySamples?.find(sample => Math.abs(sample.atMs - expected.atMs) < 0.01);
        return !actual || JSON.stringify(actual.activeCueIds) !== JSON.stringify(expected.activeCueIds);
      })) visibilityIssues.push(`镜头 ${scene.index} 字幕切换边界未取得匹配的实际可见 cue`);
        measured.cues.forEach((cue, index) => {
        if (!cue.glyphCoverage || cue.glyphCoverage.verification !== 'font-engine') glyphEvidenceComplete = false;
        else if (cue.glyphCoverage.status === 'unavailable') glyphEvidenceComplete = false;
        else if (cue.glyphCoverage.status !== 'ok' || cue.glyphCoverage.renderedCodePointCount < cue.glyphCoverage.codePointCount || cue.glyphCoverage.missingCodePoints.length) glyphIssues.push(`镜头 ${scene.index} 第 ${index + 1} 句存在缺失字形`);
        measuredCues += 1; maxLines = Math.max(maxLines, cue.lineCount);
        if (cue.issues.length) {
          issues.push(`镜头 ${scene.index} 第 ${index + 1} 句（实测 ${cue.lineCount} 行）：${cue.issues.map(issue => labels[issue]).join('、')}`);
          affectedShots.add(scene.id); if (cue.cueId) affectedCues.add(cue.cueId);
        }
      });
    }
    offset = sceneStart + scene.durationMs;
  }
  const summarize = (items: string[]) => items.slice(0, 20).join('；') + (items.length > 20 ? `；另有 ${items.length - 20} 项` : '');
  return [{
    id: 'subtitle-text-safety', label: '字幕、标题排版与画面安全区', severity: 'manual',
    status: issues.length ? 'failed' : missing.length ? 'pending' : 'passed',
    detail: issues.length || missing.length ? summarize([...issues, ...missing]) : `已在 ${canvas.width}×${canvas.height} 输出画布测量 ${measuredCues} 句字幕，最多 ${maxLines} 行，标题与字幕未重叠。`,
    ...(affectedShots.size ? { recheckScope: { kind: 'subtitle' as const, shotIds: [...affectedShots], cueIds: [...affectedCues].slice(0, 500) } } : {}),
  }, {
    id: 'subtitle-glyphs', label: '字幕字形完整性', severity: 'manual',
    status: glyphIssues.length ? 'failed' : glyphShots.size && !glyphEvidenceComplete ? 'pending' : 'passed',
    detail: glyphIssues.length ? summarize(glyphIssues) : glyphShots.size && !glyphEvidenceComplete ? '部分字幕缺少逐字字体引擎覆盖证据，请重新测量或人工复核。' : glyphShots.size ? '已通过 Chromium 与系统字体引擎逐字字形覆盖验证。' : '当前成片没有字幕。',
    ...(glyphShots.size ? { recheckScope: { kind: 'subtitle' as const, shotIds: [...glyphShots] } } : {}),
  }, {
    id: 'subtitle-visibility', label: '字幕切换与时间线可见性', severity: 'manual',
    status: visibilityIssues.length ? 'pending' : 'passed',
    detail: visibilityIssues.length ? visibilityIssues.slice(0, 20).join('；') : '已在输出时间线的每个字幕开始/结束边界核对实际可见 cue。',
    ...(visibilityIssues.length ? { recheckScope: { kind: 'subtitle' as const, shotIds: scenes.map(scene => scene.id) } } : {}),
  }];
}

/** Execute in the hidden output window after the real timeline is ready. */
export async function measureDirectorSubtitleVisibility(input: {
  startMs: number; durationMs: number;
  cues: readonly { id?: string; startMs: number; endMs: number }[];
}): Promise<{ atMs: number; activeCueIds: string[] }[]> {
  if (!window.__tl || typeof window.__tl.seek !== 'function') throw new Error('Subtitle timeline unavailable.');
  const times = [...new Set(input.cues.flatMap(cue => [cue.startMs, cue.endMs]))].sort((a, b) => a - b);
  const subtitles = Array.from(document.querySelectorAll<HTMLElement>('[data-cue-start]'));
  const samples: { atMs: number; activeCueIds: string[] }[] = [];
  for (const localMs of times) {
    await window.__tl.seek(localMs / 1000);
    samples.push({ atMs: input.startMs + localMs, activeCueIds: subtitles.map((element, index) => element.dataset.cueId || `#${index}`).filter((_, index) => !subtitles[index].hidden) });
  }
  await window.__tl.seek(0);
  return samples;
}

/** Self-contained DOM function, executed in the actual hidden output window. */
export function measureDirectorSubtitleLayout(input: { shotId: string; startMs: number; durationMs: number; width: number; height: number }): ProductionSubtitleSceneLayout {
  const frame = document.querySelector<HTMLElement>('.frame');
  if (!frame || document.fonts.status !== 'loaded') throw new Error('Subtitle frame or loaded fonts unavailable.');
  const width = innerWidth; const height = innerHeight;
  const safeArea = { x: width * .05, y: height * .05, width: width * .9, height: height * .9 };
  const rect = (box: DOMRect) => ({ x: box.x, y: box.y, width: box.width, height: box.height });
  const outside = (box: { x: number; y: number; width: number; height: number }) => box.x < safeArea.x - 1
    || box.y < safeArea.y - 1 || box.x + box.width > safeArea.x + safeArea.width + 1 || box.y + box.height > safeArea.y + safeArea.height + 1;
  const overlaps = (a: DOMRect | null, b: DOMRect | null) => Boolean(a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1);
  const textRects = (element: HTMLElement) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const boxes: DOMRect[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      boxes.push(...Array.from(range.getClientRects()).filter(box => box.width > 0 && box.height > 0));
    }
    const x = Math.min(...boxes.map(box => box.left)); const y = Math.min(...boxes.map(box => box.top));
    const bounds = boxes.length ? new DOMRect(x, y, Math.max(...boxes.map(box => box.right)) - x, Math.max(...boxes.map(box => box.bottom)) - y) : null;
    const lines: number[] = [];
    boxes.forEach(box => { if (!lines.some(top => Math.abs(top - box.top) < 2)) lines.push(box.top); });
    return { bounds, lines: lines.length };
  };
  const title = frame.querySelector<HTMLElement>('.title');
  const titleBounds = title ? textRects(title).bounds : null;
  const captions = Array.from(frame.querySelectorAll<HTMLElement>('.caption'));
  const measured = captions.map(element => {
    const hidden = element.hidden;
    try {
      element.hidden = false;
      const style = getComputedStyle(element);
      const text = textRects(element);
      const box = element.getBoundingClientRect();
      const lineCount = Math.max(text.lines, Math.round((box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight)));
      const startMs = input.startMs + Number(element.dataset.cueStart ?? 0);
      const endMs = input.startMs + Number(element.dataset.cueEnd ?? input.durationMs);
      const issues: z.infer<typeof issueSchema>[] = [];
      if (!text.bounds && element.textContent?.trim()) issues.push('empty-text-bounds');
      if (outside(box) || (text.bounds && outside(text.bounds))) issues.push('outside-safe-area');
      if (lineCount > 3) issues.push('too-many-lines');
      if (overlaps(text.bounds, titleBounds)) issues.push('title-overlap');
      const sourceText = element.textContent ?? '';
      const codePoints = Array.from(sourceText).filter((character) => !/\s/u.test(character));
      const missingCodePoints: string[] = [];
      let renderedCodePointCount = 0;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode: Node | null;
      while ((textNode = walker.nextNode())) {
        const value = textNode.textContent ?? '';
        let offset = 0;
        for (const character of Array.from(value)) {
          const endOffset = offset + character.length;
          if (!/\s/u.test(character)) {
            const range = document.createRange();
            range.setStart(textNode, offset); range.setEnd(textNode, endOffset);
            const visible = Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
            const fontReady = document.fonts.check(`${style.fontSize} ${style.fontFamily}`, character);
            if (visible && fontReady) renderedCodePointCount += 1;
            else if (!missingCodePoints.includes(character)) missingCodePoints.push(character);
          }
          offset = endOffset;
        }
      }
      const glyphCoverage = { verification: 'layout-only' as const, status: document.fonts.status === 'loaded' ? (missingCodePoints.length ? 'failed' as const : 'ok' as const) : 'unavailable' as const, codePointCount: codePoints.length, renderedCodePointCount, missingCodePoints };
      return { cue: {
        ...(element.dataset.cueId ? { cueId: element.dataset.cueId } : {}), startMs, endMs,
        bounds: rect(box), textBounds: text.bounds ? rect(text.bounds) : null, lineCount,
        fontFamily: style.fontFamily, fontSize: parseFloat(style.fontSize), issues, glyphCoverage,
      }, textBounds: text.bounds };
    } finally { element.hidden = hidden; }
  });
  measured.forEach((item, index) => {
    if (measured.some((other, otherIndex) => index !== otherIndex && item.cue.startMs < other.cue.endMs
      && other.cue.startMs < item.cue.endMs && overlaps(item.textBounds, other.textBounds))) item.cue.issues.push('cue-overlap');
  });
  // Capture normalization scales the entire CSS viewport to the encoded canvas.
  const scaleX = input.width / width; const scaleY = input.height / height;
  const outputRect = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x * scaleX, y: box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY });
  return { status: 'ok', shotId: input.shotId, width: input.width, height: input.height, viewportWidth: width, viewportHeight: height,
    fontsReady: true, safeArea: outputRect(safeArea),
    titleBounds: titleBounds ? outputRect(titleBounds) : null, titleOutsideSafeArea: Boolean(titleBounds && outside(titleBounds)),
    cues: measured.map(({ cue }) => ({ ...cue, bounds: outputRect(cue.bounds), textBounds: cue.textBounds ? outputRect(cue.textBounds) : null, fontSize: cue.fontSize * scaleY })) };
}
