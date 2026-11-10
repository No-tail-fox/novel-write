import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import type { VoxProductionNode, VoxProductionRun, VoxProductionSettings } from '../src/shared/vox-production';
import { buildDirectorRenderScenes, directorCanvasForRatio } from '../src/shared/director-render';
import { DIRECTOR_VISUAL_FPS, directorVisualFps } from '../src/shared/production-visual-continuity';
import { lemoLockedShotIds, lemoReservedWindowsBrief } from '../src/shared/lemo-locked-shots';
import { resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import { readLemoUpstreamManifest, type LemoSourceOptions } from './lemo-upstream-source';
import { stepLemoUpstreamAgent, recoverLemoUpstreamAgentTurn, LemoAgentImageUnknownError, type LemoAgentImages, type LemoAgentOptions } from './lemo-upstream-agent';
import { sha256File, type LemoAssetInput, type LemoAssetMedia } from './lemo-upstream-assets';
import { lemoAgentArchiveAssets, lemoAgentImagePolicy } from '../src/shared/creative-animation/agent-assets';
import { lemoAgentMaxTurns } from '../src/shared/creative-animation/upstream-agent';
import { lemoAgentMaxCost } from '../src/shared/creative-animation/agent-cost';
import { createLemoAgentCostControl, type LemoAgentCostPricing } from './lemo-agent-cost';
import { reviewLemoUpstreamProject } from './lemo-upstream-renderer';
import { loadOpuscar98StyleReference, opuscar98Number, OPUSCAR98_SOURCE } from './lemo-opuscar98';

export type LemoProductionLibrary = Omit<LemoSourceOptions, 'filmDir'>;
export async function preflightLemoUpstream(library: LemoProductionLibrary, style: string) {
  const manifest = await readLemoUpstreamManifest(library.upstreamRoot);
  const o98 = opuscar98Number(style) !== undefined;
  for (const path of ['DIRECTOR.md', 'TECHNIQUE.md', ...(o98 ? ['MY-STYLES.md', OPUSCAR98_SOURCE] : [`styles/${style}/STYLE.md`])]) {
    if (!manifest.files.some(file => file.path === path) || !existsSync(join(library.upstreamRoot, path))) throw new Error('LEMO_LIBRARY_MISSING: ' + path);
  }
  if (o98) await loadOpuscar98StyleReference(library.upstreamRoot, style);
  if (!existsSync(join(library.threeRoot, 'build/three.module.js'))) throw new Error('LEMO_THREE_MISSING');
}
export function lemoAgentRoot(work: string, runId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('LEMO_RUN_PATH');
  return join(work, 'lemo-agent', runId);
}
export function lemoProductionContext(document: EditorialCollagePipelineData, styleReference?: string) {
  const run = document.productionRun!;
  const style = resolveCreativeStyle(run.settings.authoring?.styleId, run.settings.presetId);
  if (!style) throw new Error('LEMO_STYLE_MISSING');
  if (opuscar98Number(style.slug) !== undefined && !styleReference) throw new Error('LEMO_O98_REFERENCE_MISSING');
  // L-3: only runs with locked shots get the reserved-window line; default contexts (and hashes) are unchanged.
  const reserved = lemoReservedWindowsBrief(document, run.settings);
  return { runId: run.id, styleId: style.slug, ...(styleReference ? { styleReference } : {}), ...directorCanvasForRatio(document.ratio), durationSeconds: (document.timeline?.durationMs ?? 0) / 1000,
    brief: [document.title, document.sourceText, run.settings.authoring?.brief ?? '',
      'Approved narration and absolute timeline in milliseconds; keep the wording and respect all cue windows:',
      JSON.stringify({ cues: document.beats.flatMap(beat => beat.subtitleCues), shots: document.beats.flatMap(beat => beat.shots.map(shot => ({ id: shot.id, title: shot.title, direction: shot.scenePrompt, durationMs: shot.durationMs, startMs: document.timeline?.clips.find(clip => clip.shotId === shot.id)?.startMs }))) }),
      'Sourced facts (do not invent data): ' + JSON.stringify(run.settings.data),
      'Imported archive descriptions (do not invent evidence or unavailable media): ' + JSON.stringify(run.settings.archives),
      ...(reserved ? [reserved] : []),
    ].join('\n') };
}
/**
 * L-3 preflight: every locked shot must be renderable by its own per-shot path (existing code,
 * layers or video), because its frames replace the Agent film's window at export.
 */
export function assertLemoLockedShotsRenderable(document: EditorialCollagePipelineData, settings: VoxProductionSettings) {
  const ids = lemoLockedShotIds(document, settings);
  if (!ids.length) return;
  // Probe as a per-shot (non-v3) render with this run's settings; the run start rebuilds the timeline the same way.
  const run = { ...(document.productionRun ?? {}), settings, authoringVersion: undefined } as unknown as VoxProductionRun;
  const probe = rebuildEditorialTimeline({ ...document, productionRun: run });
  const shots = probe.beats.flatMap(beat => beat.shots);
  const failures = ids.flatMap(id => {
    const index = shots.findIndex(shot => shot.id === id), label = `镜头 ${index + 1}「${shots[index]?.title || id}」`;
    try {
      const [scene] = buildDirectorRenderScenes(probe, undefined, { shotIds: [id] });
      if (directorVisualFps([scene]) > DIRECTOR_VISUAL_FPS) return [`${label}帧率高于 ${DIRECTOR_VISUAL_FPS} fps`];
      return [];
    } catch (error) {
      return [`${label}：${(error instanceof Error ? error.message : String(error)).replace(/^DIRECTOR_RENDER_PREFLIGHT_FAILED:\s*/, '').replace(/镜头 1(?![0-9])[：:]?/g, '')}`];
    }
  });
  if (failures.length) throw new Error(`LEMO_LOCKED_SHOT_UNRENDERABLE: 保留的镜头没有可直接渲染的画面，无法拼回原生整片：${failures.join('；').slice(0, 1500)}。请解除这些镜头的锁定，或先补齐它们的画面后再制作。`);
}
export function createLemoUpstreamOperations(library: LemoProductionLibrary, work: string, model: LemoAgentOptions['model'], host?: LemoUpstreamMaterialHost, pricing?: LemoAgentCostPricing | (() => LemoAgentCostPricing | Promise<LemoAgentCostPricing>)) {
  const options = async (d: EditorialCollagePipelineData, node: VoxProductionNode): Promise<LemoAgentOptions> => {
    const styleId = resolveCreativeStyle(d.productionRun!.settings.authoring?.styleId, d.productionRun!.settings.presetId)?.slug ?? '';
    const base = lemoProductionContext(d, opuscar98Number(styleId) !== undefined ? await loadOpuscar98StyleReference(library.upstreamRoot, styleId) : undefined);
    const material = d.productionRun!.assetChannel ? await lemoMaterialContext(d, host) : undefined;
    const context = { ...base, ...material?.context };
    const root = lemoAgentRoot(work, context.runId);
    return { root, upstreamRoot: library.upstreamRoot, context,
      turn: Number(node.fileId), requestId: node.requestId, retryOfRequestId: node.retryOfRequestId, model,
      maxTurns: lemoAgentMaxTurns(d.productionRun!.settings.agentMaxTurns), ...(node.skipImage && node.retryOfRequestId ? { skipUnknownImage: true } : {}),
      // L-4: cost budget/estimate from this run's receipts; outside the context hash and the model's messages.
      ...(pricing ? { cost: createLemoAgentCostControl(root, lemoAgentMaxCost(d.productionRun!.settings.agentMaxCost), pricing) } : {}),
      ...(material?.assetHost ? { assetHost: material.assetHost } : {}), ...(material?.images ? { images: material.images } : {}),
      review: (filmDir, outputDir, times) => reviewLemoUpstreamProject({ ...library, filmDir, outputDir, times, width: context.width, height: context.height }) };
  };
  return {
    upstreamStep: async (d: EditorialCollagePipelineData, node: VoxProductionNode) => ({ ...d, upstreamFilm: await stepLemoUpstreamAgent(await options(d, node)) }),
    recoverUpstreamStep: async (d: EditorialCollagePipelineData, node: VoxProductionNode) => {
      const input = await options(d, node);
      let film = await recoverLemoUpstreamAgentTurn(input.root, input.turn!);
      // A response persisted before the process died can be executed without another model call.
      if (!film && existsSync(join(input.root, `turn-${String(input.turn).padStart(4, '0')}`, 'response.json'))) {
        const mustNotCharge = async (): Promise<never> => { throw new Error('LEMO_RECOVERY_MUST_NOT_CHARGE'); };
        try {
          // Free replay: estimate only, never a budget stop (a replay never submits a paid request anyway).
          film = await stepLemoUpstreamAgent({ ...input, model: mustNotCharge, ...(input.cost ? { cost: { estimate: input.cost.estimate } } : {}), ...(input.images ? { images: { ...input.images, recoveryOnly: true, generate: mustNotCharge } } : {}) });
        } catch (error) {
          // A replay that would need a new paid image (or whose image outcome is unknown) stays unresolved.
          if (error instanceof LemoAgentImageUnknownError || /^LEMO_RECOVERY_MUST_NOT_CHARGE/.test((error as Error)?.message ?? '')) return undefined;
          throw error;
        }
      }
      return film ? { ...d, upstreamFilm: film } : undefined;
    },
  };
}

/** Host services for the material channel; main.ts wires ffmpeg and the configured image provider. */
export interface LemoUpstreamMaterialHost {
  media(): Promise<LemoAssetMedia>;
  /** Present only when an image provider is connected. */
  images?: LemoAgentImages;
}
export async function lemoMaterialContext(d: EditorialCollagePipelineData, host: LemoUpstreamMaterialHost | undefined) {
  const settings = d.productionRun!.settings;
  const archives = lemoAgentArchiveAssets(d, settings);
  if (archives.length !== settings.archives.length) throw new Error('LEMO_ASSET_MISSING: 有素材引用找不到对应的图片或视频文件，请重新导入。');
  const assets: LemoAssetInput[] = [];
  const files: Record<string, string> = {};
  for (const [index, { ref, asset }] of archives.entries()) {
    const id = `a${String(index + 1).padStart(2, '0')}`;
    let sha256: string;
    try { sha256 = await sha256File(asset.localPath); } catch { throw new Error(`LEMO_ASSET_MISSING: 找不到素材文件：${asset.localPath}`); }
    assets.push({ id, kind: asset.kind, sha256, description: (ref.description || asset.prompt || asset.localPath.split(/[\\/]/).at(-1) || id).slice(0, 400), source: ref.source, license: ref.license });
    files[id] = asset.localPath;
  }
  const policy = lemoAgentImagePolicy(settings);
  if (settings.agentImages?.enabled && policy.denied) throw new Error('LEMO_IMAGE_DENIED: ' + policy.denied);
  if (policy.enabled && !host?.images) throw new Error('LEMO_IMAGE_PROVIDER: 已允许 AI 生成插画，但没有可用的生图服务。请在设置中连接生图服务，或关闭该选项。');
  const enabled = assets.length > 0 || policy.enabled;
  if (enabled && !host) throw new Error('LEMO_ASSET_CHANNEL: 素材通道不可用。');
  return {
    context: { ...(assets.length ? { assets } : {}), ...(policy.enabled ? { imageGeneration: { maxImages: policy.maxImages } } : {}) },
    assetHost: enabled ? { files, media: await host!.media() } : undefined,
    images: policy.enabled ? host!.images : undefined,
  };
}
