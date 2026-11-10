/**
 * Lemo v3 (upstream agent) material policy, shared by the renderer form, input validation and the host.
 *
 * - Asset channel (P1-4): user-imported images/videos with source + license are staged into the
 *   agent project under assets/ (read-only for the agent) and listed in assets/MANIFEST.json.
 * - Image channel (P2-4): optional, off by default. The agent may request at most `maxImages`
 *   illustrations through the host's configured image provider. Never for evidence/documentary styles.
 */
import type { EditorialCollagePipelineData } from '../editorial-collage';
import type { VoxProductionSettings } from '../vox-production';
import { resolveCreativeStyle } from './styles';

export const LEMO_AGENT_ASSET_LIMIT = 24;
export const LEMO_AGENT_IMAGE_DEFAULT = 6;
export const LEMO_AGENT_IMAGE_MAX = 12;
export const LEMO_ASSET_VIDEO_MAX_SECONDS = 30;
/** Upstream categories whose films are built from real material; generated pictures would read as evidence. */
export const LEMO_EVIDENCE_STYLE_CATEGORIES: readonly string[] = ['Edit & Documentary', 'Evidence Films'];

type Settings = Pick<VoxProductionSettings, 'authoring' | 'presetId' | 'archives' | 'agentImages'>;

export function lemoStyleRequiresRealMaterial(styleSlug: string | undefined, presetId = 'paper-explainer'): boolean {
  const style = resolveCreativeStyle(styleSlug, presetId);
  return !!style && LEMO_EVIDENCE_STYLE_CATEGORIES.includes(style.category_en);
}

export interface LemoAgentImagePolicy { enabled: boolean; maxImages: number; denied?: string }
export function lemoAgentImagePolicy(settings: Settings): LemoAgentImagePolicy {
  const maxImages = Math.min(LEMO_AGENT_IMAGE_MAX, Math.max(1, settings.agentImages?.maxImages ?? LEMO_AGENT_IMAGE_DEFAULT));
  if (settings.authoring?.mode !== 'ai-code' || !settings.agentImages?.enabled) return { enabled: false, maxImages };
  if (lemoStyleRequiresRealMaterial(settings.authoring.styleId, settings.presetId)) {
    return { enabled: false, maxImages, denied: '纪实/证据类风格只使用真实素材，不能生成插画。' };
  }
  return { enabled: true, maxImages };
}

export type LemoAgentAssetKind = 'image' | 'video';
/** Imported archives that the agent may use, in the order the user listed them. */
export function lemoAgentArchiveAssets(document: Pick<EditorialCollagePipelineData, 'assets'>, settings: Pick<Settings, 'archives'>) {
  return settings.archives.flatMap(ref => {
    const asset = document.assets.find(item => item.id === ref.assetVersionId);
    return asset && (asset.kind === 'image' || asset.kind === 'video') && asset.localPath
      ? [{ ref, asset: asset as typeof asset & { kind: LemoAgentAssetKind; localPath: string } }] : [];
  });
}

/** Form/start validation for the Lemo route; returns user-facing Chinese messages. */
export function lemoAgentAssetErrors(document: Pick<EditorialCollagePipelineData, 'assets'>, settings: Settings): string[] {
  if (settings.authoring?.mode !== 'ai-code') return [];
  const errors: string[] = [];
  const usable = lemoAgentArchiveAssets(document, settings);
  if (usable.length !== settings.archives.length) errors.push('有素材引用找不到对应的图片或视频文件，请重新导入或删除该条。');
  if (settings.archives.length > LEMO_AGENT_ASSET_LIMIT) errors.push(`创意动画一次最多交给 Agent ${LEMO_AGENT_ASSET_LIMIT} 份素材。`);
  if (new Set(settings.archives.map(ref => ref.assetVersionId)).size !== settings.archives.length) errors.push('同一份素材只能添加一次。');
  if (settings.agentImages?.enabled && lemoStyleRequiresRealMaterial(settings.authoring.styleId, settings.presetId)) {
    errors.push('所选风格属于纪实/证据类，只能使用导入的真实素材；请关闭“允许 AI 生成插画”或换一种风格。');
  }
  return errors;
}
