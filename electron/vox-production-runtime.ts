import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { rebuildEditorialTimeline, type EditorialCollagePipelineData, type EditorialCollageShot } from '../src/shared/editorial-collage';
import { createEditorialCuePlan } from '../src/shared/editorial-cue-plan';
import { editorialLayerPrompt } from '../src/shared/editorial-motion';
import { fitEditorialNarrationTiming } from '../src/shared/editorial-narration-timing';
import { invalidateSubtitleAlignment } from '../src/shared/audio-alignment';
import { createVoxAnimation, validateVoxAnimation, voxPropsSchema } from '../src/shared/vox-animation';
import { directorDocumentRenderFingerprint, directorQualityReview, directorRenderOutputs, buildDirectorRenderScenes } from '../src/shared/director-render';
import { directorImageInput, editorialVoiceInput, applyEditorialImageRecord, applyEditorialVoiceRecord, type DirectorVoiceProviderStatus } from '../src/features/director-desk/director-generation';
import type { VoxProductionNode, VoxProductionSettings } from '../src/shared/vox-production';
import type { BackgroundRemovalMetadata, ImageLabRecord, VoiceLabRecord } from '../src/shared/types';
import type { VoxProductionRuntime } from './vox-production-service';
import { voxReadableNarration } from '../src/shared/vox-production';
import { voxDataPresentation } from '../src/shared/vox-data-chart';
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
  compileCode(source: string): { compiled: string };
  generateCode?(input: VoxGenerateRequest, styleId: string, requestId: string): Promise<string>;
  previewCode?(document: Document, shotId: string, requestId: string): Promise<string[]>;
  verifyVideo(path: string, expectedDurationMs: number, narration: boolean): Promise<void>;
}

/** Model calls are bounded by the service's durable claims. All three presets share the real renderer. */
export function createVoxProductionRuntime(ops: VoxProductionOperations): VoxProductionRuntime {
  return {
    identity: ops.identity,
    preflight: ops.preflight,
    isPaid: (d, node) => {
      if (node.kind !== 'code-repair') return node.paid;
      const authoring = shotFor(d, node.shotId).animation?.authoring;
      return authoring?.status === 'needs-repair' && authoring.attempts.length < 2;
    },
    async recover(d, node) {
      if (node.kind !== 'image' || !node.requestId || !ops.recoverImage) return undefined;
      const input = directorImageInput(d, node.shotId!, node.layerId);
      const record = await ops.recoverImage(input, node.requestId);
      if (!record) return undefined;
      if (record.status !== 'generated') throw new Error(record.errorMessage || 'VOX_IMAGE_RECOVERY_FAILED');
      return applyEditorialImageRecord(d, node.shotId!, record, ops.imageModel, input);
    },
    input(d, node) {
      const settings = settingsFor(d);
      // Authoring changes how an approved visual brief is animated, not its paid planning inputs.
      if (node.kind === 'plan') {
        const { authoring: _authoring, ...preset } = settings;
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
      if (node.kind === 'animation') return { preset: settings, ...(settings.authoring ? { adapterRevision: CREATIVE_ADAPTER_REVISION, upstreamRevision: LEMO_REVISION } : {}), duration: shot.durationMs, layers: shot.layers, title: shot.title, cues: d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)), ...(settings.presetId === 'data-map' ? { dataChartRevision: 2, introductory: d.beats.flatMap(b => b.shots).find(s => !settings.lockedShotIds.includes(s.id))?.id === shot.id } : {}) };
      // A later repair changes code/status, never the claimed inputs of an earlier paid call.
      if (['code', 'code-review', 'code-repair', 'code-finalize'].includes(node.kind)) return {
        settings, adapterRevision: CREATIVE_ADAPTER_REVISION, upstreamRevision: LEMO_REVISION,
        ...(node.kind === 'code-review' || node.kind === 'code-finalize' ? { reviewRevision: CREATIVE_REVIEW_REVISION } : {}),
        template: shot.animation?.template, duration: shot.durationMs, ratio: d.ratio, scenePrompt: shot.scenePrompt,
        cues: d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)),
        ...(node.kind !== 'code' ? { originalSource: shot.animation?.authoring?.attempts[0]?.source } : {}),
        ...(node.kind === 'code-finalize' ? { repairedSource: shot.animation?.authoring?.attempts[1]?.source } : {}),
      };
      return { animation: shot.animation, layers: shot.layers, duration: shot.durationMs, ratio: d.ratio };
    },
    async execute(d, node) {
      const settings = settingsFor(d);
      if (node.kind === 'plan') {
        const shots = d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, narration: editorialVoiceInput(d, s.id, ops.voice).text })));
        const strategy = settings.presetId === 'paper-explainer'
          ? 'Plan concrete editorial paper collage subjects and separate clean background plates. Avoid metaphoric cubes, text on images, charts or unverified numbers.'
          : settings.presetId === 'data-map'
            ? `Use ONLY these sourced data rows: ${JSON.stringify(settings.data)}. Explain their meaning without inventing values or locations. Charts and routes will be built in code.`
            : `Use ONLY imported archive references: ${JSON.stringify(settings.archives)}. Never fabricate historical evidence. Plan short captions and neutral paper backdrops.`;
        const plan = planSchema.parse(await ops.plan(`Return JSON {"shots":[{"id":"exact input id","title":"short Chinese title","scenePrompt":"specific visual brief in English"}]}. One entry for EVERY input shot, no added or missing IDs. Preserve the exact narration; you only plan visuals. ${strategy}\n${JSON.stringify(shots)}`));
        if (plan.shots.length !== shots.length || new Set(plan.shots.map(s => s.id)).size !== shots.length || plan.shots.some(s => !shots.some(input => input.id === s.id))) throw new Error('VOX_PLAN_IDS: 画面计划未完整对应现有镜头，已停止。');
        return rebuildEditorialTimeline({ ...d, beats: d.beats.map(b => ({ ...b, shots: b.shots.map(s => {
          if (settings.lockedShotIds.includes(s.id)) return s;
          const planned = plan.shots.find(p => p.id === s.id)!;
          return { ...s, title: planned.title, scenePrompt: planned.scenePrompt, layers: s.layers.map(l => l.content ? { ...l, content: { ...l.content, text: planned.title } } : { ...l, prompt: editorialLayerPrompt(l.kind, planned.scenePrompt) }) };
        }) })) });
      }
      if (node.kind === 'render') return ops.render(d);
      if (node.kind === 'verify') {
        const output = directorRenderOutputs(d).current;
        if (!output?.localPath || directorQualityReview(d).report?.status !== 'passed') throw new Error('VOX_VERIFY_GATE: 当前成片未通过质量门控。');
        await ops.verifyVideo(output.localPath, d.timeline?.durationMs ?? 0, settings.narration);
        return { ...d, stage: 'completed' };
      }
      const shot = shotFor(d, node.shotId);
      const locked = settings.lockedShotIds.includes(shot.id);
      if (node.kind === 'code' || node.kind === 'code-repair') {
        if (locked || node.kind === 'code-repair' && (shot.animation?.authoring?.status !== 'needs-repair' || shot.animation.authoring.attempts.length >= 2)) return d;
        if (!ops.generateCode || !shot.animation) throw new Error('CREATIVE_CODE_UNAVAILABLE: 代码创作运行时不可用。');
        const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId)!;
        const original = shot.animation;
        const startMs = d.timeline?.clips.find(c => c.shotId === shot.id)?.startMs ?? 0;
        const cues = d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)).map(c => ({ text: c.text, startMs: Math.max(0, c.startMs - startMs), endMs: Math.min(shot.durationMs, c.endMs - startMs) }));
        const prompt = [
          `镜头视觉意图：${shot.scenePrompt}。按 ${style.cn} 的视觉语法创作完整镜头。`,
          `旁白及镜头内相对时间（毫秒）：${JSON.stringify(cues)}`,
          '素材按 assetIds 顺序使用；背景和透明主体分层，不得重复绘制同一个主体。仅展示当前旁白对应的数据，不添加未经核实的信息。',
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
        return applyEditorialVoiceRecord(d, shot.id, record, ops.voiceModel, input, true, durationMs);
      }
      if (node.kind === 'timing') {
        if (locked) return d;
        if (!settings.narration) return updateShot({ ...d,
          beats: d.beats.map(b => ({ ...b, subtitleCues: b.subtitleCues.map(c => shot.subtitleCueIds.includes(c.id) ? invalidateSubtitleAlignment(c, { audioAssetVersionId: null, voiceId: null, voiceSpeed: null }) : c) })),
          timeline: d.timeline ? { ...d.timeline, audioClips: d.timeline.audioClips?.filter(c => c.shotId !== shot.id || !['narration', 'dialogue'].includes(c.trackType)) } : undefined,
        }, shot.id, s => ({ ...s, voiceAssetVersionId: undefined }));
        return fitEditorialNarrationTiming(d, [shot.id]);
      }
      if (node.kind === 'animation') {
        if (locked) return d;
        const beat = d.beats.find(b => b.id === shot.beatId)!;
        const cues = beat.subtitleCues.filter(c => shot.subtitleCueIds.includes(c.id));
        const animation = createVoxAnimation(shot.title || '', '');
        const imageIds = shot.layers.filter(l => !l.content && l.visible !== false).flatMap(l => l.assetVersionId ? [l.assetVersionId] : []);
        // Legacy drafts can have a single plate; semantic layers still own its motion.
        let templateId = imageIds.length === 1 ? 'paper-popup' : 'paper-actors';
        let props: Record<string, unknown> = { title: shot.title || '', assetIds: imageIds };
        if (settings.presetId === 'data-map') {
          const hasCoordinates = settings.data.every(row => row.lat !== undefined && row.lng !== undefined);
          templateId = hasCoordinates ? 'map-multi-stop' : 'data-bars';
          props = { ...props, assetIds: [], unit: settings.dataUnit ?? '', source: [...new Set(settings.data.map(r => r.source))].join('；').slice(0, 400), items: settings.data.map(({ label, value, lat, lng }) => ({ label, value, lat: lat ?? 0, lng: lng ?? 0 })) };
          if (!hasCoordinates) props.dataPresentation = voxDataPresentation(
            settings.data.map(row => row.label), cues,
            d.timeline?.clips.find(clip => clip.shotId === shot.id)?.startMs ?? 0,
            d.beats.flatMap(b => b.shots).find(s => !settings.lockedShotIds.includes(s.id))?.id === shot.id,
          );
        } else if (settings.presetId === 'archival-story') {
          templateId = 'paper-polaroids';
          props.source = [...new Set(settings.archives.map(r => r.source))].join('；').slice(0, 400);
        }
        const style = settings.authoring && resolveCreativeStyle(settings.authoring.styleId, settings.presetId);
        if (style?.adapter) Object.assign(props, { background: style.adapter.background, foreground: style.adapter.foreground, accent: style.adapter.accent });
        animation.template = { id: templateId, props: voxPropsSchema.parse(props) };
        // Leave saved author choices intact, including an explicit 200 ms dissolve.
        // New starter plans omit the default, so creative production can choose a cut.
        return updateShot(d, shot.id, s => ({ ...s, renderStrategy: 'remotion', animation,
          ...(settings.authoring && !s.transitionIn ? { transitionIn: { type: 'cut' as const, durationMs: 0 } } : {}),
          cuePlan: settings.presetId === 'paper-explainer' ? createEditorialCuePlan(cues, s.layers, s.motionStyle ?? 'focus-reveal') : undefined }));
      }
      if (node.kind === 'compile') {
        if (locked && shot.renderStrategy !== 'remotion') { buildDirectorRenderScenes(d, undefined, { shotIds: [shot.id] }); return d; }
        if (!shot.animation) throw new Error(`VOX_COMPILE_EMPTY: ${shot.id} 没有动画。请补齐或解除锁定。`);
        const issues = validateVoxAnimation(shot.animation, d.assets);
        if (issues.length) throw new Error(`${shot.id}: ${issues.join('；')}`);
        if (shot.animation.mode === 'code' && ops.compileCode(shot.animation.code.source).compiled !== shot.animation.code.compiled) throw new Error('VOX_COMPILE_STALE: 自定义代码编译结果已过期。');
        const ids = new Set([...shot.animation.template.props.assetIds, ...shot.layers.filter(l => settings.presetId === 'paper-explainer' && !l.content && l.visible !== false).flatMap(l => l.assetVersionId ? [l.assetVersionId] : [])]);
        for (const id of ids) { const path = d.assets.find(a => a.id === id)?.localPath; if (!path || !(await stat(path)).size) throw new Error(`VOX_ASSET_MISSING: ${shot.id}/${id}`); }
        return d;
      }
      throw new Error(`VOX_NODE_UNSUPPORTED: ${node.kind}`);
    },
  };
}
