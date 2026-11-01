import { buildLemoUpstreamNodes } from './lemo-upstream-graph';
import { buildLemoProjectNodes } from './lemo-production-graph';
import { LEMO_NATIVE_ENGINE } from './creative-animation/native-film';
import { z } from 'zod';
import type { EditorialCollagePipelineData, EditorialCollageShot } from './editorial-collage';
import { resolveCreativeStyle } from './creative-animation/styles';
import { isDefinitiveImageProviderFailure } from './image-provider-error';
import { isDefinitiveLlmProviderRejection } from './llm-provider-error';

const id = z.string().min(1).max(256);
export const VOX_PRODUCTION_PRESETS = [
  { id: 'paper-explainer', version: 1, label: '纸拼贴讲解', description: '独立背景与透明主体，跟随旁白揭示重点。', strategy: 'semantic-paper' },
  { id: 'data-map', version: 1, label: '数据与地图', description: '用有出处的数值或坐标，生成图表或路线。', strategy: 'sourced-data' },
  { id: 'archival-story', version: 1, label: '档案叙事', description: '使用已导入且标明出处的资料，逐条展示证据。', strategy: 'sourced-archive' },
] as const;
export type VoxProductionPreset = typeof VOX_PRODUCTION_PRESETS[number];
export const voxProjectMusicSchema = z.object({
  id, title: z.string().min(1).max(512), path: z.string().min(1).max(8192),
  durationMs: z.number().finite().int().min(1000), gainDb: z.number().min(-60).max(0).default(-18),
  loop: z.boolean().default(true), fadeInMs: z.number().int().min(0).max(5000).default(800),
  fadeOutMs: z.number().int().min(0).max(5000).default(1200),
}).strict();
export type VoxProjectMusic = z.infer<typeof voxProjectMusicSchema>;
export const voxProductionSettingsSchema = z.object({
  version: z.literal(1), presetId: z.enum(['paper-explainer', 'data-map', 'archival-story']), presetVersion: z.literal(1),
  narration: z.boolean().default(true),
  generateImages: z.boolean().optional(),
  music: voxProjectMusicSchema.optional(),
  lockedShotIds: z.array(id).max(500).default([]),
  authoring: z.object({ mode: z.enum(['template', 'ai-code', 'existing-assets']), styleId: z.string().min(1).max(120), brief: z.string().max(2000).optional() }).strict().optional(),
  dataUnit: z.string().max(30).optional(),
  data: z.array(z.object({ label: z.string().min(1).max(160), value: z.number().finite(), source: z.string().min(1).max(400),
    lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
  }).strict()).max(24).default([]),
  archives: z.array(z.object({ assetVersionId: id, source: z.string().min(1).max(400), license: z.string().min(1).max(512) }).strict()).max(100).default([]),
}).strict().transform(({ authoring, ...settings }) => ({
  ...settings,
  generateImages: settings.generateImages ?? authoring?.mode !== 'existing-assets',
  ...(authoring ? { authoring: { ...authoring, mode: authoring.mode === 'existing-assets' ? 'ai-code' as const : authoring.mode } } : {}),
}));
export type VoxProductionSettings = z.infer<typeof voxProductionSettingsSchema>;
/** A continuation inherits the original shot's edit lock. */
export const voxShotLocked = (settings: Pick<VoxProductionSettings, 'lockedShotIds'>, shot: Pick<EditorialCollageShot, 'id' | 'narrationSplit'>) =>
  settings.lockedShotIds.includes(shot.id) || !!shot.narrationSplit && settings.lockedShotIds.includes(shot.narrationSplit.sourceShotId);
/** Shared entry point; each method owns a separate production graph and visual rules. */
export function voxProductionEngine(settings: Pick<VoxProductionSettings, 'authoring'>): typeof LEMO_NATIVE_ENGINE | 'legacy' {
  return settings.authoring?.mode === 'ai-code' ? LEMO_NATIVE_ENGINE : 'legacy';
}
export const voxReadableNarration = (text: string) => /[\p{L}\p{N}]/u.test(text);
export const voxProductionNodeSchema = z.object({
  id, kind: z.enum(['plan', 'image', 'cutout', 'voice', 'timing', 'animation', 'code', 'code-review', 'code-repair', 'code-finalize', 'film-plan-materials', 'film-plan-scene', 'film-plan-finalize', 'film-materials', 'film-material', 'film-edit', 'film-scene', 'film-director', 'film-sample', 'film-sample-repair', 'film-sample-finalize', 'film-code', 'film-review', 'film-repair', 'film-finalize', 'compile', 'render', 'verify']),
  shotId: id.optional(), layerId: id.optional(), fileId: id.optional(), editSession: id.optional(), editRound: z.number().int().min(1).max(16).optional(), materialId: id.optional(), dependencies: z.array(id).max(500),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'unknown']),
  paid: z.boolean(), inputHash: z.string().max(128).optional(), attempt: z.number().int().nonnegative(),
  resultReceived: z.boolean().optional(),
  // Failed planning replies are diagnostics, never validated treatment or authored film source.
  llmResponse: z.object({
    text: z.string().max(500000), truncated: z.boolean(), requestId: id.nullable(),
    finishReason: z.string().max(128).nullable().optional(), usage: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
  requestId: id.optional(), retryOfRequestId: id.optional(), error: z.string().max(65536).optional(), recoveryNote: z.string().max(2000).optional(),
}).strict();
export type VoxProductionNode = z.infer<typeof voxProductionNodeSchema>;

export function isVoxProductionSubmissionRejection(node: VoxProductionNode, message: string): boolean {
  if (node.resultReceived) return false; // A local persistence failure cannot undo a paid result.
  if (['image', 'film-material'].includes(node.kind)) return isDefinitiveImageProviderFailure(message);
  // Planning is one synchronous request. Do not infer outcomes for multi-request code/edit nodes.
  return (['plan', 'film-plan-materials', 'film-plan-scene'].includes(node.kind) || node.kind === 'film-edit' && node.id.startsWith('upstream-turn:')) && isDefinitiveLlmProviderRejection(message);
}

// Older journals marked every paid error as unknown, including explicit HTTP rejections.
export function voxProductionNodeStatus(node: VoxProductionNode): VoxProductionNode['status'] {
  return node.status === 'unknown' && isVoxProductionSubmissionRejection(node, node.error ?? '') ? 'failed' : node.status;
}

export const voxProductionRunSchema = z.object({
  version: z.literal(1), id, status: z.enum(['running', 'paused', 'failed', 'completed', 'cancelled']),
  settings: voxProductionSettingsSchema,
  planningVersion: z.literal(1).optional(),
  engine: z.literal(LEMO_NATIVE_ENGINE).optional(), filmId: id.optional(), authoringVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  sourceHash: z.string().max(128), runtimeIdentity: z.string().max(8000),
  nodes: z.array(voxProductionNodeSchema).max(8003),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  message: z.string().max(65536).optional(),
}).strict();
export type VoxProductionRun = z.infer<typeof voxProductionRunSchema>;
export const voxProductionStartSchema = z.object({ id, expectedUpdatedAt: z.string().datetime(), settings: voxProductionSettingsSchema }).strict();
export type VoxProductionStart = z.infer<typeof voxProductionStartSchema>;
export const voxProductionControlSchema = z.object({ id, runId: id, action: z.enum(['pause', 'resume', 'cancel', 'recheck-code', 'reconcile', 'confirm-no-result', 'retry-unknown']),
  nodeId: id.optional(), evidence: z.string().trim().min(8).max(2000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'confirm-no-result' && (!value.nodeId || !value.evidence)) ctx.addIssue({ code: 'custom', message: '请填写待核对步骤与服务商核对依据。' });
  if (value.action === 'retry-unknown' && !value.nodeId) ctx.addIssue({ code: 'custom', message: '请选择要重试的步骤。' });
});
export type VoxProductionControl = z.infer<typeof voxProductionControlSchema>;

export function voxProductionSettings(presetId: VoxProductionSettings['presetId'] = 'paper-explainer'): VoxProductionSettings {
  return voxProductionSettingsSchema.parse({ version: 1, presetId, presetVersion: 1 });
}
export function voxProductionNeedsTextModel(nodes: readonly VoxProductionNode[]): boolean {
  return nodes.some(node => ['plan', 'film-plan-materials', 'film-plan-scene', 'code', 'code-repair', 'film-edit', 'film-code', 'film-scene', 'film-director', 'film-sample-repair', 'film-repair'].includes(node.kind));
}
export function voxProductionInputErrors(document: EditorialCollagePipelineData, settings: VoxProductionSettings): string[] {
  const errors: string[] = [];
  if (settings.authoring && !resolveCreativeStyle(settings.authoring.styleId, settings.presetId)?.adapter) errors.push('未找到所选风格，请重新选择。');
  if (!document.sourceText?.trim() || !document.beats.some(beat => beat.shots.length)) errors.push('请先填写文案并创建分镜。');
  if (settings.presetId === 'data-map' && settings.data.length < 2) errors.push('请补充至少两条有来源的真实数据；也可以切换纸拼贴讲解。');
  if (settings.presetId === 'data-map' && settings.data.length > 12 && !settings.data.every(row => row.lat !== undefined && row.lng !== undefined)) errors.push('柱状图最多支持 12 条数据；请减少数据或填写完整地点坐标。');
  if (settings.presetId === 'data-map' && settings.data.some(row => row.lat !== undefined) && !settings.data.every(row => row.lat !== undefined && row.lng !== undefined)) errors.push('路线中的每条数据都需填写经纬度。');
  if (settings.data.some(row => (row.lat === undefined) !== (row.lng === undefined))) errors.push('地点必须同时填写纬度和经度。');
  if (settings.presetId === 'archival-story' && (!settings.archives.length || settings.archives.some(ref => !document.assets.some(asset => asset.id === ref.assetVersionId && asset.kind === 'image' && asset.localPath)))) errors.push('请导入真实档案图片并填写出处与许可；也可以切换纸拼贴讲解。');
  const shotIds = new Set(document.beats.flatMap(beat => beat.shots.map(shot => shot.id)));
  if (settings.lockedShotIds.some(shotId => !shotIds.has(shotId))) errors.push('锁定的镜头已删除，请重新选择。');
  for (const shot of document.beats.flatMap(beat => beat.shots)) {
    if (shot.animation && (shot.animation.mode === 'code' || shot.animation.code.source.trim()) && !shot.animation.authoring && !voxShotLocked(settings, shot)) errors.push(`镜头 ${shot.id} 有自定义代码，请先锁定镜头以保留它。`);
  }
  return errors;
}

/** Separate versioned DAG: legacy director batch records retain their original schema. */
export function buildVoxProductionNodes(document: EditorialCollagePipelineData, settings: VoxProductionSettings, engine: typeof LEMO_NATIVE_ENGINE | 'legacy' = voxProductionEngine(settings), authoringVersion = 1, planningVersion?: 1): VoxProductionNode[] {
  if (engine === LEMO_NATIVE_ENGINE && authoringVersion === 3) return buildLemoUpstreamNodes(document, settings);
  if (engine === LEMO_NATIVE_ENGINE && authoringVersion === 2) return buildLemoProjectNodes(document, settings, planningVersion);
  const nodes: VoxProductionNode[] = [];
  const add = (kind: VoxProductionNode['kind'], nodeId: string, dependencies: string[], shotId?: string, layerId?: string, paid = false) => {
    nodes.push({ id: nodeId, kind, dependencies, shotId, layerId, paid, status: 'pending', attempt: 0 }); return nodeId;
  };
  if (engine === LEMO_NATIVE_ENGINE) {
    const shots = document.beats.flatMap(beat => beat.shots);
    const editable = shots.filter(shot => !voxShotLocked(settings, shot));
    const plan = editable.length ? add('plan', 'plan', [], undefined, undefined, true) : undefined;
    const timings: string[] = [];
    for (const shot of editable) {
      const narration = document.beats.flatMap(beat => beat.subtitleCues).filter(cue => shot.subtitleCueIds.includes(cue.id)).map(cue => cue.text).join(' ');
      const continuation = shot.narrationSplit && shot.narrationSplit.sourceShotId !== shot.id;
      const voice = settings.narration && !continuation && voxReadableNarration(narration) ? add('voice', `voice:${shot.id}`, [plan!], shot.id, undefined, true) : undefined;
      timings.push(add('timing', `timing:${shot.id}`, voice ? [voice] : continuation ? ['timing:' + shot.narrationSplit!.sourceShotId] : [plan!], shot.id));
    }
    let ready: string | undefined;
    if (editable.length) {
      const code = add('film-code', 'film-code', timings, undefined, undefined, true);
      const review = add('film-review', 'film-review', [code]);
      const repair = add('film-repair', 'film-repair', [review], undefined, undefined, true);
      ready = add('film-finalize', 'film-finalize', [repair]);
    }
    const compiled = shots.map(shot => add('compile', `compile:${shot.id}`, voxShotLocked(settings, shot) ? [] : [ready!], shot.id));
    add('render', 'render', compiled); add('verify', 'verify', ['render']);
    return nodes;
  }
  const plan = add('plan', 'plan', [], undefined, undefined, true);
  const compiled: string[] = [];
  for (const shot of document.beats.flatMap(beat => beat.shots)) {
    const locked = voxShotLocked(settings, shot);
    const continuation = shot.narrationSplit && shot.narrationSplit.sourceShotId !== shot.id;
    const visual: string[] = continuation ? ['animation:' + shot.narrationSplit!.sourceShotId] : [];
    if (!locked && !continuation && settings.presetId !== 'data-map') for (const layer of shot.layers.filter(layer => layer.visible !== false && !layer.content)) {
      // Archival inputs are imported evidence, never fabricated by an image model.
      const imported = settings.presetId === 'archival-story' && layer.kind !== 'background';
      if (!settings.generateImages && !imported) continue;
      const image = add('image', `image:${shot.id}:${layer.id}`, [plan], shot.id, layer.id, !imported);
      visual.push(['subject', 'archival'].includes(layer.kind) && settings.presetId === 'paper-explainer' ? add('cutout', `cutout:${shot.id}:${layer.id}`, [image], shot.id, layer.id) : image);
    }
    const narration = document.beats.flatMap(beat => beat.subtitleCues).filter(cue => shot.subtitleCueIds.includes(cue.id)).map(cue => cue.text).join(' ');
    const speech = settings.narration && !locked && !continuation && voxReadableNarration(narration) ? add('voice', `voice:${shot.id}`, [plan], shot.id, undefined, true) : undefined;
    const timing = add('timing', `timing:${shot.id}`, speech ? [speech] : continuation ? ['timing:' + shot.narrationSplit!.sourceShotId] : [plan], shot.id);
    const animation = add('animation', `animation:${shot.id}`, [...visual, timing], shot.id);
    let ready = animation;
    if (!locked && settings.authoring?.mode === 'ai-code') {
      const code = add('code', `code:${shot.id}`, [animation], shot.id, undefined, true);
      const review = add('code-review', `code-review:${shot.id}`, [code], shot.id);
      const repair = add('code-repair', `code-repair:${shot.id}`, [review], shot.id, undefined, true);
      ready = add('code-finalize', `code-finalize:${shot.id}`, [repair], shot.id);
    }
    compiled.push(add('compile', `compile:${shot.id}`, [ready], shot.id));
  }
  add('render', 'render', compiled);
  add('verify', 'verify', ['render']);
  return nodes;
}

export function recoverVoxProductionRun(run: VoxProductionRun): VoxProductionRun {
  if (!['running', 'paused'].includes(run.status)) return run;
  return { ...run, status: 'paused', message: '应用已重启。请检查后继续；结果不明的云端请求不会自动重发。', nodes: run.nodes.map(node => node.status !== 'running' ? node : {
    ...node, status: node.paid ? 'unknown' : 'pending', error: node.paid ? '请求已发出但结果未持久化。请到服务商核对，并导入结果；不能自动重提。' : undefined,
  }) };
}
