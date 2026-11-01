import { buildLemoUpstreamNodes } from '../src/shared/lemo-upstream-graph';
import { assertLemoUpstreamFilmCurrent } from './lemo-upstream-agent';
import { reconcileLemoEditSessions } from './lemo-incremental-resume';
import { workflowPrompt } from '../src/shared/workflow-prompt-runtime';
import type { LlmTextResult } from '../src/shared/llm-provider';
import { buildLemoProjectNodes } from '../src/shared/lemo-production-graph';
import { isProjectRun, lemoProjectInput, executeLemoProject, lemoMaterialInput, applyLemoMaterialRecord } from './lemo-project-runtime';
import { nativeProductionInput, executeNativeProduction, isNativeRun, activeNativeFilm } from './lemo-production-runtime';
import { resolveLemoAnimation } from '../src/shared/creative-animation/native-film';
import { assembleCreativeShot } from '../src/shared/creative-animation/assemble';
import { CREATIVE_RENDER_REVISION } from '../src/shared/creative-animation/render-spec';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { rebuildEditorialTimeline, type EditorialCollagePipelineData, type EditorialCollageShot } from '../src/shared/editorial-collage';
import { editorialLayerPrompt } from '../src/shared/editorial-motion';
import { fitEditorialNarrationTiming } from '../src/shared/editorial-narration-timing';
import { validateVoxAnimation } from '../src/shared/vox-animation';
import { directorDocumentRenderFingerprint, directorQualityReview, directorRenderOutputs, buildDirectorRenderScenes } from '../src/shared/director-render';
import { directorImageInput, editorialVoiceInput, applyEditorialImageRecord, applyEditorialVoiceRecord, type DirectorVoiceProviderStatus } from '../src/features/director-desk/director-generation';
import type { VoxProductionNode, VoxProductionSettings } from '../src/shared/vox-production';
import type { BackgroundRemovalMetadata, ImageLabRecord, VoiceLabRecord } from '../src/shared/types';
import type { VoxProductionRuntime } from './vox-production-service';
import { buildVoxProductionNodes, voxShotLocked, voxReadableNarration } from '../src/shared/vox-production';
import { resolveCreativeStyle, LEMO_REVISION, CREATIVE_ADAPTER_REVISION } from '../src/shared/creative-animation/styles';
import { CREATIVE_REVIEW_REVISION } from '../src/shared/creative-animation/review';
import type { VoxGenerateRequest } from '../src/shared/vox-animation';

type Document = EditorialCollagePipelineData;
const shotFor = (d: Document, id?: string) => {
  const shot = d.beats.flatMap(b => b.shots).find(s => s.id === id);
  if (!shot) throw new Error(`VOX_SHOT_MISSING: ${id}`);
  return shot;
};
const updateShot = (d: Document, id: string, update: (s: EditorialCollageShot) => EditorialCollageShot) => rebuildEditorialTimeline({ ...d, beats: d.beats.map(b => ({ ...b, shots: b.shots.map(s => s.id === id ? update(s) : s) })) });
const settingsFor = (d: Document) => d.productionRun!.settings;
const planSchema = z.object({ shots: z.array(z.object({ id: z.string(), title: z.string().max(80), scenePrompt: z.string().min(10).max(5000) }).strict()).max(500) }).strict();

export interface VoxProductionOperations {
  nativePlanningVersion?: 1;
  upstreamStep?(document: Document, node: VoxProductionNode): Promise<Document>;
  recoverUpstreamStep?(document: Document, node: VoxProductionNode): Promise<Document | undefined>;
  identity: string;
  imageModel: string;
  voiceModel: string;
  voice: Pick<DirectorVoiceProviderStatus, 'provider' | 'voiceId' | 'voiceLabel' | 'speed'>;
  preflight: VoxProductionRuntime['preflight'];
  plan(prompt: string): Promise<unknown>;
  image(input: ReturnType<typeof directorImageInput>, requestId: string): Promise<ImageLabRecord>;
  recoverImage?(input: ReturnType<typeof directorImageInput>, requestId: string): Promise<ImageLabRecord | undefined>;
  speech(input: ReturnType<typeof editorialVoiceInput>, requestId: string): Promise<{ record: VoiceLabRecord; durationMs: number }>;
  cutout(path: string): Promise<{ outputPath: string; metadata: BackgroundRemovalMetadata }>;
  render(d: Document): Promise<Document>;
  compileCode(source: string): { compiled: string; engine?: 'lemo-native' };
  planFilm?(prompt: string, styleId: string, receipt?: { runId: string; requestId: string }): Promise<unknown>;
  editFilmFile?(prompt: string, styleId: string, fileId: string): Promise<LlmTextResult>;
  authorFilmFile?(prompt: string, styleId: string, fileId: string, repair: boolean): Promise<LlmTextResult>;
  generateFilm?(prompt: string, styleId: string, source?: string): Promise<string>;
  generateCode?(input: VoxGenerateRequest, styleId: string, requestId: string): Promise<string>;
  previewCode?(document: Document, shotId: string, requestId: string): Promise<string[]>;
  verifyVideo(path: string, expectedDurationMs: number, requireAudio: boolean): Promise<void>;
}

/** Model calls are bounded by the service's durable claims. All three presets share the real renderer. */
export function createVoxProductionRuntime(ops: VoxProductionOperations): VoxProductionRuntime {
  return {
    identity: ops.identity,
    reconcile: d => d.productionRun?.authoringVersion === 3 ? d : reconcileLemoEditSessions(d),
    nativePlanningVersion: ops.nativePlanningVersion,
    nativeWorkflowVersion: ops.upstreamStep ? 3 : ops.authorFilmFile || ops.editFilmFile ? 2 : undefined,
    expand: d => d.productionRun?.authoringVersion === 3 ? buildLemoUpstreamNodes(d, d.productionRun.settings) : isProjectRun(d) ? (activeNativeFilm(d)?.project ? buildLemoProjectNodes(d, d.productionRun!.settings) : undefined)
      : d.productionRun ? buildVoxProductionNodes(d, d.productionRun.settings, d.productionRun.engine ?? 'legacy', d.productionRun.authoringVersion) : undefined,
    preflight: ops.preflight,
    isPaid: (d, node) => {
      if (isProjectRun(d)) {
        if (node.kind === 'film-edit' && /^(film-repair|film-sample-repair):/.test(node.editSession ?? '')) return !!activeNativeFilm(d)?.project?.repairFileIds.includes(node.fileId!);
        if (node.kind === 'film-repair' || node.kind === 'film-sample-repair') return activeNativeFilm(d)?.project?.authoringMode !== 'incremental' && !!activeNativeFilm(d)?.project?.repairFileIds.includes(node.fileId!);
        if (node.kind === 'film-material') return activeNativeFilm(d)?.project?.materials.find(m => m.id === node.materialId)?.kind === 'generated';
      }
      if (node.kind === 'film-repair') return activeNativeFilm(d)?.status === 'needs-repair' && (activeNativeFilm(d)?.attempts.length ?? 0) < 2;
      if (node.kind !== 'code-repair') return node.paid;
      const authoring = shotFor(d, node.shotId).animation?.authoring;
      return authoring?.status === 'needs-repair' && authoring.attempts.length < 2;
    },
    async recover(d, node) {
      if (d.productionRun?.authoringVersion === 3 && node.kind === 'film-edit') return ops.recoverUpstreamStep?.(d, node);
      if (node.kind === 'film-material' && node.requestId && ops.recoverImage) {
        const record = await ops.recoverImage(lemoMaterialInput(d, node), node.requestId);
        return record ? applyLemoMaterialRecord(d, node, record, ops.imageModel) : undefined;
      }
      if (node.kind !== 'image' || !node.requestId || !ops.recoverImage) return undefined;
      const input = directorImageInput(d, node.shotId!, node.layerId);
      const record = await ops.recoverImage(input, node.requestId);
      if (!record) return undefined;
      if (record.status !== 'generated') throw new Error(record.errorMessage || 'VOX_IMAGE_RECOVERY_FAILED');
      return applyEditorialImageRecord(d, node.shotId!, record, ops.imageModel, input);
    },
    input(d, node) {
      const upstream = d.productionRun?.authoringVersion === 3;
      if (upstream && node.kind === 'film-edit') return {
        workflow: 3, runId: d.productionRun!.id, turn: node.fileId, source: d.sourceText,
        authoring: d.productionRun!.settings.authoring, ratio: d.ratio, duration: d.timeline?.durationMs,
        cues: d.beats.flatMap(b => b.subtitleCues),
      };
      if (upstream && node.kind === 'film-finalize') return { runId: d.productionRun!.id, sourceHash: d.upstreamFilm?.sourceHash, duration: d.timeline?.durationMs };
      const project = upstream ? undefined : lemoProjectInput(d, node);
      if (project !== undefined) return { input: project, ...(node.kind === 'film-material' ? { model: ops.imageModel } : {}) };
      const native = upstream ? undefined : nativeProductionInput(d, node);
      if (native !== undefined) return native;
      const settings = settingsFor(d);
      // Default-on settings keep the hashes of journals saved before this option existed.
      const { music: _music, ...visualSettings } = settings;
      const { generateImages, ...legacySettings } = visualSettings;
      const inputSettings = generateImages ? legacySettings : visualSettings;
      // Authoring changes how an approved visual brief is animated, not its paid planning inputs.
      if (node.kind === 'plan') {
        const { authoring: _authoring, ...preset } = inputSettings;
        return { source: d.sourceText, preset, shots: d.beats.flatMap(b => b.shots.map(s => s.id)) };
      }
      if (node.kind === 'render') return directorDocumentRenderFingerprint(d);
      if (node.kind === 'verify') return { output: directorRenderOutputs(d).current?.sha256, fingerprint: directorDocumentRenderFingerprint(d) };
      const shot = shotFor(d, node.shotId);
      if (node.kind === 'image') {
        const { selectedAssetIds: _selected, renderStrategy: _strategy, ...input } = directorImageInput(d, shot.id, node.layerId);
        return { input, archives: settings.archives, preset: settings.presetId };
      }
      if (node.kind === 'voice') { const { selectedAssetId: _selected, ...input } = editorialVoiceInput(d, shot.id, ops.voice); return input; }
      if (node.kind === 'cutout') return { asset: shot.layers.find(l => l.id === node.layerId)?.assetVersionId };
      if (node.kind === 'timing') return { voice: shot.voiceAssetVersionId, duration: d.assets.find(a => a.id === shot.voiceAssetVersionId)?.durationMs, cues: d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)).map(c => c.text) };
      if (node.kind === 'animation') return { rendererRevision: CREATIVE_RENDER_REVISION, preset: inputSettings, ...(settings.authoring ? { adapterRevision: CREATIVE_ADAPTER_REVISION, upstreamRevision: LEMO_REVISION } : {}), duration: shot.durationMs, layers: shot.layers, title: shot.title, cues: d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)), ...(settings.presetId === 'data-map' ? { dataChartRevision: 2, introductory: d.beats.flatMap(b => b.shots).find(s => !voxShotLocked(settings, s))?.id === shot.id } : {}) };
      // A later repair changes code/status, never the claimed inputs of an earlier paid call.
      if (['code', 'code-review', 'code-repair', 'code-finalize'].includes(node.kind)) return {
        settings: inputSettings, adapterRevision: CREATIVE_ADAPTER_REVISION, upstreamRevision: LEMO_REVISION,
        ...(node.kind === 'code-review' || node.kind === 'code-finalize' ? { reviewRevision: CREATIVE_REVIEW_REVISION } : {}),
        template: shot.animation?.template, duration: shot.durationMs, ratio: d.ratio, scenePrompt: shot.scenePrompt,
        cues: d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)),
        ...(node.kind !== 'code' ? { originalSource: shot.animation?.authoring?.attempts[0]?.source } : {}),
        ...(node.kind === 'code-finalize' ? { repairedSource: shot.animation?.authoring?.attempts[1]?.source } : {}),
      };
      return { animation: shot.animation, layers: shot.layers, duration: shot.durationMs, ratio: d.ratio };
    },
    async execute(d, node) {
      if (d.productionRun?.authoringVersion === 3 && node.kind === 'film-edit') {
        if (!ops.upstreamStep) throw new Error('LEMO_AGENT_UNAVAILABLE');
        return ops.upstreamStep(d, node);
      }
      if (d.productionRun?.authoringVersion === 3 && node.kind === 'film-finalize') {
        if (!d.upstreamFilm || d.upstreamFilm.runId !== d.productionRun.id) throw new Error('LEMO_AGENT_NOT_READY');
        await assertLemoUpstreamFilmCurrent(d.upstreamFilm, (d.timeline?.durationMs ?? 0) / 1000);
        return d;
      }
      const native = d.productionRun?.authoringVersion === 3 ? undefined : isProjectRun(d) ? await executeLemoProject(d, node, ops) : await executeNativeProduction(d, node, ops);
      if (native) return native;
      const settings = settingsFor(d);
      if (node.kind === 'plan') {
        const shots = d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, narration: editorialVoiceInput(d, s.id, ops.voice).text })));
        const strategy = settings.presetId === 'paper-explainer'
          ? workflowPrompt("creative-strategy-1", 'Plan concrete subjects, their visible actions or relationships, and separate contextual environments. Keep the brief independent of art style, material, animation technique or engine. Avoid decorative cubes, text on images, charts or unverified numbers.')
          : settings.presetId === 'data-map'
            ? workflowPrompt("creative-strategy-2", `Use ONLY these sourced data rows: ${JSON.stringify(settings.data)}. Explain their meaning without inventing values or locations. Charts and routes will be built in code.`, { value1: (JSON.stringify(settings.data)) })
            : workflowPrompt("creative-strategy-3", `Use ONLY imported archive references: ${JSON.stringify(settings.archives)}. Never fabricate historical evidence. Plan short captions and neutral contextual backdrops, independent of art style or material.`, { value1: (JSON.stringify(settings.archives)) });
        const imageStrategy = settings.generateImages ? '' : workflowPrompt("creative-image-strategy-1", 'Image generation is disabled. Plan visuals achievable with code-drawn shapes, typography, diagrams and any existing imported images. Do not require new image assets or external downloads.');
        const plan = planSchema.parse(await ops.plan(workflowPrompt("creative-plan", `Return JSON {"shots":[{"id":"exact input id","title":"short Chinese title","scenePrompt":"specific visual brief in English"}]}. One entry for EVERY input shot, no added or missing IDs. Preserve the exact narration; you only plan visuals. ${strategy} ${imageStrategy}\n${JSON.stringify(shots)}`, { strategy: (strategy), imageStrategy: (imageStrategy), value3: (JSON.stringify(shots)) })));
        if (plan.shots.length !== shots.length || new Set(plan.shots.map(s => s.id)).size !== shots.length || plan.shots.some(s => !shots.some(input => input.id === s.id))) throw new Error('VOX_PLAN_IDS: 画面计划未完整对应现有镜头，已停止。');
        return rebuildEditorialTimeline({ ...d, beats: d.beats.map(b => ({ ...b, shots: b.shots.map(s => {
          if (voxShotLocked(settings, s)) return s;
          const planned = plan.shots.find(p => p.id === s.id)!;
          return { ...s, title: planned.title, scenePrompt: planned.scenePrompt, layers: s.layers.map(l => l.content ? { ...l, content: { ...l.content, text: planned.title } } : { ...l, prompt: editorialLayerPrompt(l.kind, planned.scenePrompt) }) };
        }) })) });
      }
      if (node.kind === 'render') return ops.render(d);
      if (node.kind === 'verify') {
        const output = directorRenderOutputs(d).current;
        if (!output?.localPath || directorQualityReview(d).report?.status !== 'passed') throw new Error('VOX_VERIFY_GATE: 当前成片未通过质量门控。');
        const requireAudio = settings.narration || Boolean(settings.music?.path) || Boolean(d.timeline?.audioClips?.length);
        await ops.verifyVideo(output.localPath, d.timeline?.durationMs ?? 0, requireAudio);
        return { ...d, stage: 'completed' };
      }
      const shot = shotFor(d, node.shotId);
      const locked = voxShotLocked(settings, shot);
      if (node.kind === 'code' || node.kind === 'code-repair') {
        if (locked || node.kind === 'code-repair' && (shot.animation?.authoring?.status !== 'needs-repair' || shot.animation.authoring.attempts.length >= 2)) return d;
        if (!ops.generateCode || !shot.animation) throw new Error('CREATIVE_CODE_UNAVAILABLE: 代码创作运行时不可用。');
        const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId)!;
        const original = shot.animation;
        const startMs = d.timeline?.clips.find(c => c.shotId === shot.id)?.startMs ?? 0;
        const cues = d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)).map(c => ({ text: c.text, startMs: Math.max(0, c.startMs - startMs), endMs: Math.min(shot.durationMs, c.endMs - startMs) }));
        const prompt = [
          `镜头视觉意图：${shot.scenePrompt}。按 ${style.cn} 的视觉语法创作完整镜头。`,
          style.adapter!.direction,
          '保存的镜头描述可能带有旧制作风格：沿用其中的主体、动作与构图，画面材质和运动语言以本次所选风格为准；保留物体本身的真实属性，不把旧纸拼贴等表现方式混入新风格。',
          ...(style.adapter!.adaptationNote ? [`当前宿主适配范围：${style.adapter!.adaptationNote}`] : []),
          ...(settings.authoring?.brief?.trim() ? [`作者的画面与动效要求：${settings.authoring.brief.trim()}`] : []),
          `旁白及镜头内相对时间（毫秒）：${JSON.stringify(cues)}`,
          '首帧即有可辨识的主体与完整背景；入场只运动局部元素，不让全画面从黑色或透明淡入。尾部至少保留 250 毫秒完整构图，主体和背景持续到最后一帧，不整体淡黑、清空或提前卸载。镜头间转场由合成器完成。',
          settings.generateImages ? '素材按 assetIds 顺序使用；背景和透明主体分层，不得重复绘制同一个主体。' : '已关闭生图：只使用 props.assetIds 中已有的图片，其余画面用代码绘制图形、文字与示意关系；没有图片也要形成完整画面，不引用缺失图片或外部资源。',
          '仅展示当前旁白对应的数据，不添加未经核实的信息。',
          node.kind === 'code-repair' ? `修复上次明确的编译或预览错误：${original.authoring?.error}. 保持内容与事实不变。` : '',
        ].join('\n');
        // Do not catch transport errors: their paid result is ambiguous and must be reconciled.
        const raw = await ops.generateCode({ requestId: node.requestId!, prompt, source: node.kind === 'code-repair' ? original.code.source : undefined,
          templateId: original.template.id, props: original.template.props, durationMs: shot.durationMs, ratio: d.ratio }, style.slug, node.requestId!);
        const source = raw.trim().replace(/^```(?:tsx|typescript|jsx|javascript)?\s*/i, '').replace(/\s*```$/, '');
        return updateShot(d, shot.id, s => ({ ...s, animation: { ...original, mode: 'template', code: { source: source.slice(0, 100000), compiled: '', prompt: prompt.slice(0, 10000) },
          authoring: { owner: 'creative-production', revision: 1, styleId: style.slug, upstreamRevision: LEMO_REVISION,
            status: node.kind === 'code-repair' ? 'repaired' : 'generated', attempts: [...(node.kind === 'code-repair' ? original.authoring?.attempts ?? [] : []), { requestId: node.requestId!, source: source.slice(0, 100000) }],
            ...(source.length > 100000 ? { error: '生成代码超过 100000 字符限制。' } : {}),
          } } }));
      }
      if (node.kind === 'code-review' || node.kind === 'code-finalize') {
        if (locked || !shot.animation?.authoring) return d;
        const original = shot.animation, authoring = original.authoring!;
        if (node.kind === 'code-finalize' && authoring.status === 'reviewed') return d;
        let compiling = true;
        try {
          if (authoring.error && authoring.status !== 'needs-repair') throw new Error(authoring.error);
          const compiled = ops.compileCode(original.code.source).compiled;
          compiling = false;
          const candidate = updateShot(d, shot.id, s => ({ ...s, animation: { ...original, mode: 'code', code: { ...original.code, compiled } } }));
          if (!ops.previewCode) throw new Error('CREATIVE_PREVIEW_UNAVAILABLE: 缺少浏览器预览检查。');
          const previewPaths = await ops.previewCode(candidate, shot.id, node.requestId!);
          return updateShot(candidate, shot.id, s => ({ ...s, animation: { ...s.animation!, authoring: { ...authoring, status: 'reviewed', error: undefined, previewPaths } } }));
        } catch (error) {
          const detail = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
          // Missing files, capture host failures and timeouts require local recovery,
          // not another paid code request. Only explicit code/layout failures repair.
          if (!compiling && !/CREATIVE_(?:LAYOUT|EMPTY_FRAME|CODE_RUNTIME|CONTENT):/.test(detail)) throw error;
          return updateShot(d, shot.id, s => ({ ...s, animation: { ...original, mode: 'template', code: { ...original.code, compiled: '' },
            authoring: { ...authoring, status: node.kind === 'code-review' ? 'needs-repair' : 'fallback', error: detail } } }));
        }
      }
      if (node.kind === 'image') {
        const layer = shot.layers.find(l => l.id === node.layerId)!;
        if (settings.presetId === 'archival-story' && layer.kind !== 'background') {
          const index = d.beats.flatMap(b => b.shots.flatMap(s => s.layers.filter(l => l.visible !== false && !l.content && l.kind !== 'background').map(l => `${s.id}:${l.id}`))).indexOf(`${shot.id}:${layer.id}`);
          const ref = settings.archives[index % settings.archives.length];
          return updateShot({ ...d, assets: d.assets.map(a => a.id === ref.assetVersionId ? { ...a, license: ref.license, prompt: `资料出处：${ref.source}` } : a) }, shot.id, s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, source: 'local-file', kind: 'archival', assetVersionId: ref.assetVersionId, fit: 'contain' } : l) }));
        }
        const input = directorImageInput(d, shot.id, node.layerId);
        const record = await ops.image(input, node.requestId!);
        if (record.status !== 'generated') throw new Error(record.errorMessage || 'VOX_IMAGE_FAILED');
        return applyEditorialImageRecord(d, shot.id, record, ops.imageModel, input);
      }
      if (node.kind === 'cutout') {
        const layer = shot.layers.find(l => l.id === node.layerId)!;
        const asset = d.assets.find(a => a.id === layer.assetVersionId);
        if (!asset?.localPath) throw new Error('VOX_CUTOUT_INPUT: 缺少主体图片。');
        const result = await ops.cutout(asset.localPath);
        if (result.metadata.quality !== 'passed') throw new Error('VOX_CUTOUT_REVIEW: 主体透明边缘需要人工检查。');
        const cutout = { ...asset, id: randomUUID(), localPath: result.outputPath, sha256: result.metadata.outputSha256, backgroundRemoval: result.metadata, createdAt: new Date().toISOString() };
        return updateShot({ ...d, assets: [...d.assets, cutout] }, shot.id, s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, assetVersionId: cutout.id } : l) }));
      }
      if (node.kind === 'voice') {
        const input = editorialVoiceInput(d, shot.id, ops.voice);
        // Old drafts and resumed DAGs can include intentionally silent shots.
        if (!voxReadableNarration(input.text)) return d;
        const { record, durationMs } = await ops.speech(input, node.requestId!);
        if (record.status !== 'generated' || durationMs <= 0) throw new Error(record.errorMessage || 'VOX_SPEECH_FAILED');
        // The paid receipt is checkpointed before the separate, recoverable timing repair step.
        return applyEditorialVoiceRecord(d, shot.id, record, ops.voiceModel, input, true, durationMs, false);
      }
      if (node.kind === 'timing') {
        if (locked) return d;
        if (!settings.narration) return d;
        return fitEditorialNarrationTiming(d, [shot.id]);
      }
      if (node.kind === 'animation') {
        if (locked) return d;
        const parent = shot.narrationSplit && shot.narrationSplit.sourceShotId !== shot.id ? shotFor(d, shot.narrationSplit.sourceShotId) : undefined;
        return updateShot(d, shot.id, s => assembleCreativeShot(d, parent ? { ...s, layers: s.layers.map(layer => ({ ...layer, assetVersionId: parent.layers.find(l => l.id === layer.id)?.assetVersionId ?? layer.assetVersionId })) } : s, settings));
      }
      if (node.kind === 'compile') {
        if (shot.animation?.native) {
          if (!locked && activeNativeFilm(d)?.status !== 'reviewed') throw new Error('LEMO_NATIVE_NOT_REVIEWED: 原生全片尚未通过检查。');
          if (shot.durationMs !== shot.animation.native.durationMs) throw new Error('LEMO_WINDOW_STALE: 镜头时长已修改，请重新制作全片。');
          const resolved = resolveLemoAnimation(shot.animation, d.creativeFilms)!;
          const compiled = ops.compileCode(resolved.code.source);
          if (compiled.engine !== 'lemo-native' || compiled.compiled !== resolved.code.compiled) throw new Error('LEMO_COMPILE_STALE: 原生动画编译结果已过期。');
          buildDirectorRenderScenes(d, undefined, { shotIds: [shot.id] });
          for (const id of resolved.native!.assetIds) { const path = d.assets.find(a => a.id === id)?.localPath; if (!path || !(await stat(path)).size) throw new Error(`VOX_ASSET_MISSING: ${shot.id}/${id}`); }
          return d;
        }
        if (locked && shot.renderStrategy !== 'remotion') { buildDirectorRenderScenes(d, undefined, { shotIds: [shot.id] }); return d; }
        if (!shot.animation) throw new Error(`VOX_COMPILE_EMPTY: ${shot.id} 没有动画。请补齐或解除锁定。`);
        const issues = validateVoxAnimation(shot.animation, d.assets);
        if (issues.length) throw new Error(`${shot.id}: ${issues.join('；')}`);
        if (shot.animation.mode === 'code' && ops.compileCode(shot.animation.code.source).compiled !== shot.animation.code.compiled) throw new Error('VOX_COMPILE_STALE: 自定义代码编译结果已过期。');
        const ids = new Set([...shot.animation.template.props.assetIds, ...shot.layers.filter(l => shot.cuePlan && !l.content && l.visible !== false).flatMap(l => l.assetVersionId ? [l.assetVersionId] : [])]);
        for (const id of ids) { const path = d.assets.find(a => a.id === id)?.localPath; if (!path || !(await stat(path)).size) throw new Error(`VOX_ASSET_MISSING: ${shot.id}/${id}`); }
        return d;
      }
      throw new Error(`VOX_NODE_UNSUPPORTED: ${node.kind}`);
    },
  };
}
