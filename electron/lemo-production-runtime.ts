import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { lemoCreativeTextSchema, checkLemoPayloadResource } from '../src/shared/creative-animation/creative-text';
import type { EditorialCollagePipelineData as Document } from '../src/shared/editorial-collage';
import { directorCanvasForRatio } from '../src/shared/director-render';
import { LEMO_NATIVE_ENGINE, LEMO_NATIVE_REVISION, LEMO_FOLLOW_STYLE_SUBTITLES, resolveLemoAnimation } from '../src/shared/creative-animation/native-film';
import { LEMO_REVISION, resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import type { VoxProductionNode } from '../src/shared/vox-production';
import type { VoxProductionOperations } from './vox-production-runtime';
import { compileLemoNative } from './lemo-native-compiler';
import { activeNativeFilm, isNativeRun, shots, editable, timeline, imageAssets, filmSettings, saveFilm, attachFilm } from './lemo-production-document';
export { activeNativeFilm, isNativeRun } from './lemo-production-document';
const planSchema = z.object({ treatment: lemoCreativeTextSchema, fps: z.number().int().min(12).max(60).default(24) }).strict().superRefine(checkLemoPayloadResource);

/** Inputs exclude later review mutations, so durable paid claims remain reusable. */
export function nativeProductionInput(d: Document, node: VoxProductionNode): unknown | undefined {
  if (!isNativeRun(d)) return undefined;
  const settings = d.productionRun!.settings;
  const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId)!;
  if (node.kind === 'plan') return { engine: LEMO_NATIVE_ENGINE, revision: LEMO_NATIVE_REVISION, upstream: LEMO_REVISION, source: d.sourceText, style: style.slug, ...filmSettings(d), ratio: d.ratio, locked: settings.lockedShotIds, shots: shots(d).map(s => ({ id: s.id, subtitleStyle: s.subtitleStyle || LEMO_FOLLOW_STYLE_SUBTITLES })), assets: imageAssets(d) };
  if (node.kind.startsWith('film-')) {
    const film = activeNativeFilm(d);
    return { engine: LEMO_NATIVE_ENGINE, revision: LEMO_NATIVE_REVISION, upstream: LEMO_REVISION, style: style.slug, treatment: film?.treatment, fps: film?.fps,
      sourceText: d.sourceText, ratio: d.ratio, timeline: timeline(d), assets: imageAssets(d), ...filmSettings(d),
      ...(node.kind !== 'film-code' ? { source: film?.attempts[node.kind === 'film-finalize' ? film.attempts.length - 1 : 0]?.source } : {}),
      ...(node.kind === 'film-repair' ? { error: film?.repairDiagnostic } : {}) };
  }
  if (node.kind === 'compile') { const shot = shots(d).find(s => s.id === node.shotId)!; return { animation: resolveLemoAnimation(shot.animation, d.creativeFilms), duration: shot.durationMs, ratio: d.ratio }; }
  return undefined;
}

export async function executeNativeProduction(d: Document, node: VoxProductionNode, ops: VoxProductionOperations): Promise<Document | undefined> {
  if (!isNativeRun(d)) return undefined;
  const settings = d.productionRun!.settings;
  const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId)!;
  if (node.kind === 'plan') {
    if (!ops.planFilm) throw new Error('LEMO_PLAN_UNAVAILABLE: 缺少原生全片导演接口。');
    const plan = planSchema.parse(await ops.planFilm(JSON.stringify({ script: d.sourceText, style: style.slug, settings: filmSettings(d),
      canvas: directorCanvasForRatio(d.ratio), provisionalTimeline: timeline(d), assets: imageAssets(d), constraints: 'Preserve the full approved script. Existing shot windows are editing markers, not independent title-card scenes. Host narration durations will be measured before code creation. Plan continuous native camera/transitions. All new visual artwork is drawn in code; imported evidence is supplied by id.' }), style.slug));
    const referenced = new Set(shots(d).flatMap(s => s.animation?.native?.filmId ? [s.animation.native.filmId] : []));
    return saveFilm({ ...d, creativeFilms: d.creativeFilms?.filter(f => referenced.has(f.id)) }, { id: randomUUID(), styleId: style.slug, upstreamRevision: LEMO_REVISION,
      treatment: plan.treatment, fps: plan.fps, ...directorCanvasForRatio(d.ratio), durationMs: d.timeline?.durationMs ?? shots(d).reduce((sum,s) => sum+s.durationMs,0), assetIds: imageAssets(d).map(a => a.id), source: '', compiled: '', status: 'planned', attempts: [] });
  }
  if (!node.kind.startsWith('film-')) return undefined;
  const original = activeNativeFilm(d);
  if (!original) throw new Error('LEMO_PLAN_MISSING: 请先完成全片导演方案。');
  if (node.kind === 'film-code' || node.kind === 'film-repair') {
    if (node.kind === 'film-repair' && (original.status !== 'needs-repair' || original.attempts.length >= 2)) return d;
    if (!ops.generateFilm) throw new Error('LEMO_CODE_UNAVAILABLE: 缺少原生全片代码接口。');
    const durationMs = d.timeline!.durationMs;
    const prompt = JSON.stringify({ treatment: original.treatment, script: d.sourceText, style: style.slug, canvas: directorCanvasForRatio(d.ratio), fps: original.fps, durationMs,
      timeline: timeline(d), assets: imageAssets(d), ...filmSettings(d),
      ...(node.kind === 'film-repair' ? { repair: original.error } : {}),
      delivery: 'One full film with the exact absolute clock. Keep the full story across every shot window. Narration and selected music are mixed externally. Render titles/captions yourself in the chosen style. Each visible Canvas/WebGL subtitle must have TEXTS metadata with its exact cueId. Do not add proxy captions. The final frame must remain resolved; do not leave an empty black tail.' });
    // Network/transport exceptions propagate to the durable journal; no silent retry.
    const raw = await ops.generateFilm(prompt, style.slug, node.kind === 'film-repair' ? original.source : undefined);
    const source = raw.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
    const tooLong = source.length > 500000;
    return saveFilm(d, { ...original, durationMs, assetIds: imageAssets(d).map(a => a.id), source: source.slice(0,500000), compiled: '', status: node.kind === 'film-code' ? 'generated' : 'repaired',
      attempts: [...(node.kind === 'film-code' ? [] : original.attempts), { requestId: node.requestId!, source: source.slice(0,500000) }], error: tooLong ? 'LEMO_CODE: 全片源码超过 500000 字符，已停止。' : undefined });
  }
  if (node.kind === 'film-finalize' && original.status === 'reviewed') return d;
  if (!['film-review','film-finalize'].includes(node.kind)) return undefined;
  let compiling = true;
  try {
    if (original.error && original.status !== 'needs-repair') throw new Error(original.error);
    const result = compileLemoNative(original.source);
    if (result.engine !== 'lemo-native') throw new Error('LEMO_CODE: 需要完整 HTML 原生动画，不能替换为模板组件。');
    compiling = false;
    const candidate = attachFilm(d, { ...original, compiled: result.compiled });
    if (!ops.previewCode) throw new Error('LEMO_PREVIEW_UNAVAILABLE: 缺少实际浏览器预览检查。');
    const previewPaths: string[] = [];
    for (const shot of editable(candidate)) previewPaths.push(...await ops.previewCode(candidate, shot.id, `${node.requestId}-${shot.id}`));
    return attachFilm(candidate, { ...original, compiled: result.compiled, status: 'reviewed', error: undefined, previewPaths });
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0,8000);
    if (!compiling && !/CREATIVE_(?:LAYOUT|EMPTY_FRAME|CODE_RUNTIME|CONTENT):|LEMO_(?:CODE|DURATION|TEXTS):/.test(detail)) throw error;
    if (node.kind === 'film-finalize') throw new Error('LEMO_NATIVE_FAILED: 原生动画修复后仍未通过检查，已停止制作并保留源码。' + detail);
    return saveFilm(d, { ...original, status: 'needs-repair', compiled: '', error: detail, repairDiagnostic: detail });
  }
}
