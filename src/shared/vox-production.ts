import { z } from 'zod';
import type { EditorialCollagePipelineData } from './editorial-collage';
import { resolveCreativeStyle } from './creative-animation/styles';

const id = z.string().min(1).max(256);
export const VOX_PRODUCTION_PRESETS = [
  { id: 'paper-explainer', version: 1, label: '纸拼贴讲解', description: '独立背景与透明主体，跟随旁白揭示重点。', strategy: 'semantic-paper' },
  { id: 'data-map', version: 1, label: '数据与地图', description: '用有出处的数值或坐标，生成图表或路线。', strategy: 'sourced-data' },
  { id: 'archival-story', version: 1, label: '档案叙事', description: '使用已导入且标明出处的资料，逐条展示证据。', strategy: 'sourced-archive' },
] as const;
export type VoxProductionPreset = typeof VOX_PRODUCTION_PRESETS[number];
export const voxProductionSettingsSchema = z.object({
  version: z.literal(1), presetId: z.enum(['paper-explainer', 'data-map', 'archival-story']), presetVersion: z.literal(1),
  narration: z.boolean().default(true),
  lockedShotIds: z.array(id).max(500).default([]),
  authoring: z.object({ mode: z.enum(['template', 'ai-code']), styleId: z.string().min(1).max(120) }).strict().optional(),
  dataUnit: z.string().max(30).optional(),
  data: z.array(z.object({ label: z.string().min(1).max(160), value: z.number().finite(), source: z.string().min(1).max(400),
    lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
  }).strict()).max(24).default([]),
  archives: z.array(z.object({ assetVersionId: id, source: z.string().min(1).max(400), license: z.string().min(1).max(512) }).strict()).max(100).default([]),
}).strict();
export type VoxProductionSettings = z.infer<typeof voxProductionSettingsSchema>;
export const voxReadableNarration = (text: string) => /[\p{L}\p{N}]/u.test(text);
export const voxProductionNodeSchema = z.object({
  id, kind: z.enum(['plan', 'image', 'cutout', 'voice', 'timing', 'animation', 'code', 'code-review', 'code-repair', 'code-finalize', 'compile', 'render', 'verify']),
  shotId: id.optional(), layerId: id.optional(), dependencies: z.array(id).max(500),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'unknown']),
  paid: z.boolean(), inputHash: z.string().max(128).optional(), attempt: z.number().int().nonnegative(),
  requestId: id.optional(), error: z.string().max(65536).optional(), recoveryNote: z.string().max(2000).optional(),
}).strict();
export type VoxProductionNode = z.infer<typeof voxProductionNodeSchema>;
export const voxProductionRunSchema = z.object({
  version: z.literal(1), id, status: z.enum(['running', 'paused', 'failed', 'completed', 'cancelled']),
  settings: voxProductionSettingsSchema,
  sourceHash: z.string().max(128), runtimeIdentity: z.string().max(8000),
  nodes: z.array(voxProductionNodeSchema).max(8003),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  message: z.string().max(65536).optional(),
}).strict();
export type VoxProductionRun = z.infer<typeof voxProductionRunSchema>;
export const voxProductionStartSchema = z.object({ id, expectedUpdatedAt: z.string().datetime(), settings: voxProductionSettingsSchema }).strict();
export type VoxProductionStart = z.infer<typeof voxProductionStartSchema>;
export const voxProductionControlSchema = z.object({ id, runId: id, action: z.enum(['pause', 'resume', 'cancel', 'reconcile', 'confirm-no-result']),
  nodeId: id.optional(), evidence: z.string().trim().min(8).max(2000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'confirm-no-result' && (!value.nodeId || !value.evidence)) ctx.addIssue({ code: 'custom', message: '请填写待核对步骤与服务商核对依据。' });
});
export type VoxProductionControl = z.infer<typeof voxProductionControlSchema>;

export function voxProductionSettings(presetId: VoxProductionSettings['presetId'] = 'paper-explainer'): VoxProductionSettings {
  return voxProductionSettingsSchema.parse({ version: 1, presetId, presetVersion: 1 });
}
export function voxProductionInputErrors(document: EditorialCollagePipelineData, settings: VoxProductionSettings): string[] {
  const errors: string[] = [];
  if (settings.authoring && !resolveCreativeStyle(settings.authoring.styleId, settings.presetId)?.adapter) errors.push('所选风格仅收录资料，尚未适配；请选择已适配风格。');
  if (!document.sourceText?.trim() || !document.beats.some(beat => beat.shots.length)) errors.push('请先填写文案并创建分镜。');
  if (settings.presetId === 'data-map' && settings.data.length < 2) errors.push('请补充至少两条有来源的真实数据；也可以切换纸拼贴讲解。');
  if (settings.presetId === 'data-map' && settings.data.length > 12 && !settings.data.every(row => row.lat !== undefined && row.lng !== undefined)) errors.push('柱状图最多支持 12 条数据；请减少数据或填写完整地点坐标。');
  if (settings.presetId === 'data-map' && settings.data.some(row => row.lat !== undefined) && !settings.data.every(row => row.lat !== undefined && row.lng !== undefined)) errors.push('路线中的每条数据都需填写经纬度。');
  if (settings.data.some(row => (row.lat === undefined) !== (row.lng === undefined))) errors.push('地点必须同时填写纬度和经度。');
  if (settings.presetId === 'archival-story' && (!settings.archives.length || settings.archives.some(ref => !document.assets.some(asset => asset.id === ref.assetVersionId && asset.kind === 'image' && asset.localPath)))) errors.push('请导入真实档案图片并填写出处与许可；也可以切换纸拼贴讲解。');
  const shotIds = new Set(document.beats.flatMap(beat => beat.shots.map(shot => shot.id)));
  if (settings.lockedShotIds.some(shotId => !shotIds.has(shotId))) errors.push('锁定的镜头已删除，请重新选择。');
  for (const shot of document.beats.flatMap(beat => beat.shots)) {
    if (shot.animation && (shot.animation.mode === 'code' || shot.animation.code.source.trim()) && !shot.animation.authoring && !settings.lockedShotIds.includes(shot.id)) errors.push(`镜头 ${shot.id} 有自定义代码，请先锁定镜头以保留它。`);
  }
  return errors;
}

/** Separate versioned DAG: legacy director batch records retain their original schema. */
export function buildVoxProductionNodes(document: EditorialCollagePipelineData, settings: VoxProductionSettings): VoxProductionNode[] {
  const nodes: VoxProductionNode[] = [];
  const add = (kind: VoxProductionNode['kind'], nodeId: string, dependencies: string[], shotId?: string, layerId?: string, paid = false) => {
    nodes.push({ id: nodeId, kind, dependencies, shotId, layerId, paid, status: 'pending', attempt: 0 }); return nodeId;
  };
  add('plan', 'plan', [], undefined, undefined, true);
  const compiled: string[] = [];
  for (const shot of document.beats.flatMap(beat => beat.shots)) {
    const locked = settings.lockedShotIds.includes(shot.id);
    const visual: string[] = [];
    if (!locked && settings.presetId !== 'data-map') for (const layer of shot.layers.filter(layer => layer.visible !== false && !layer.content)) {
      // Archival inputs are imported evidence, never fabricated by an image model.
      const image = add('image', `image:${shot.id}:${layer.id}`, ['plan'], shot.id, layer.id, settings.presetId !== 'archival-story' || layer.kind === 'background');
      visual.push(['subject', 'archival'].includes(layer.kind) && settings.presetId === 'paper-explainer' ? add('cutout', `cutout:${shot.id}:${layer.id}`, [image], shot.id, layer.id) : image);
    }
    const narration = document.beats.flatMap(beat => beat.subtitleCues).filter(cue => shot.subtitleCueIds.includes(cue.id)).map(cue => cue.text).join(' ');
    const speech = settings.narration && !locked && voxReadableNarration(narration) ? add('voice', `voice:${shot.id}`, ['plan'], shot.id, undefined, true) : 'plan';
    const timing = add('timing', `timing:${shot.id}`, [speech], shot.id);
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
