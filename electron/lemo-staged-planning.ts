import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { EditorialCollagePipelineData as Document } from '../src/shared/editorial-collage';
import type { VoxProductionNode } from '../src/shared/vox-production';
import type { VoxProductionOperations } from './vox-production-runtime';
import { directorCanvasForRatio } from '../src/shared/director-render';
import { lemoProjectFiles } from '../src/shared/creative-animation/native-project';
import { lemoOutlineSchema, lemoPlanningMaterialsSchema, lemoScenePlanSchema, isLemoPlanningNode, lemoPlanningShotIds } from '../src/shared/creative-animation/native-planning';
import { LEMO_REVISION, resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import { activeNativeFilm, editable, shots, timeline, filmSettings, saveFilm } from './lemo-production-document';
import { VoxProductionStepError } from './vox-production-step-error';

const inventory = (d: Document) => d.assets.filter(a => a.kind === 'image' && a.localPath && !a.assetId.startsWith('shot-keyframe-lemo-material:')).map(a => ({ id: a.id, label: a.prompt ?? a.id }));
const stop = (d: Document, error: unknown): never => { throw new VoxProductionStepError('LEMO_PLAN_INVALID: ' + String(error).slice(0, 7800), d, true); };
const active = (d: Document) => {
  const film = activeNativeFilm(d), project = film?.project, planning = project?.planning;
  if (!film || !project || !planning) return stop(d, '缺少分阶段规划检查点，请先完成全局大纲。');
  return { film, project, planning };
};

export function lemoStagedPlanningInput(d: Document, node: VoxProductionNode, base: unknown) {
  if (node.kind === 'plan') return base;
  const { project, planning } = active(d);
  if (node.kind === 'film-plan-materials') return { base, outline: planning.outline };
  if (node.kind === 'film-plan-scene') return { base, outline: planning.outline, materials: project.materials,
    unit: planning.units.find(u => u.id === node.fileId), timeline: timeline(d, false).filter(w => planning.units.find(u => u.id === node.fileId)?.shotIds.includes(w.id)) };
  return { base, outline: planning.outline, units: planning.units, scenes: planning.scenes, materials: project.materials, materialsReady: planning.materialsReady };
}

/** One paid call per graph node. Persistence, receipts and unknown outcomes remain owned by the production service. */
export async function executeLemoStagedPlanning(d: Document, node: VoxProductionNode, ops: VoxProductionOperations): Promise<Document | undefined> {
  if (d.productionRun?.planningVersion !== 1 || !isLemoPlanningNode(node.kind) && node.kind !== 'film-plan-finalize') return undefined;
  const settings = d.productionRun.settings, style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId)!;
  const common = { projectVersion: 2, planningVersion: 1, style: style.slug, settings: filmSettings(d), canvas: directorCanvasForRatio(d.ratio), generateImages: settings.generateImages };
  const call = async (stage: 'outline' | 'materials' | 'scene', payload: object) => {
    if (!ops.planFilm) return stop(d, '缺少导演方案接口。');
    return ops.planFilm(JSON.stringify({ ...common, planningStage: stage, ...payload }), style.slug,
      node.requestId ? { runId: d.productionRun!.id, requestId: node.requestId } : undefined);
  };
  if (node.kind === 'plan') {
    const files = lemoProjectFiles(editable(d).map(s => s.id));
    const units = files.filter(f => f.kind === 'scene').map(({ id, shotIds }) => ({ id, shotIds }));
    const result = await call('outline', { script: d.sourceText, units, assets: inventory(d), durationMs: d.timeline!.durationMs });
    let outline;
    try { outline = lemoOutlineSchema.parse(result); } catch (error) { return stop(d, error); }
    const referenced = new Set(shots(d).flatMap(s => s.animation?.native?.filmId ? [s.animation.native.filmId] : []));
    return saveFilm({ ...d, creativeFilms: d.creativeFilms?.filter(f => referenced.has(f.id)) }, {
      id: randomUUID(), styleId: style.slug, upstreamRevision: LEMO_REVISION, treatment: outline.treatment, fps: outline.fps,
      ...directorCanvasForRatio(d.ratio), durationMs: d.timeline!.durationMs, assetIds: [], source: '', compiled: '', status: 'planning', attempts: [],
      project: { version: 2, ...(ops.editFilmFile ? { authoringMode: 'incremental', editSessions: {} } : {}),
        planning: { version: 1, outline, units, materialsReady: false, scenes: [], complete: false },
        materials: [], bindings: {}, files, repairFileIds: [], samplePaths: [] },
    });
  }
  const { film, project, planning } = active(d);
  if (node.kind === 'film-plan-materials') {
    const result = await call('materials', { script: d.sourceText, outline: planning.outline, assets: inventory(d) });
    try {
      const { materials } = lemoPlanningMaterialsSchema.parse(result);
      if (new Set(materials.map(m => m.id)).size !== materials.length) throw Error('素材 ID 重复。');
      if (style.category_en === 'Edit & Documentary' && !materials.some(m => m.kind === 'evidence')) throw Error('纪实风格必须使用有出处与许可的真实证据。');
      for (const material of materials) {
        if (material.kind === 'generated') {
          if (!settings.generateImages) throw Error('已关闭生图，不能规划需要生成的素材。');
          continue;
        }
        const asset = d.assets.find(a => a.id === material.assetId && a.kind === 'image' && a.localPath);
        if (!asset) throw Error('未导入素材 ' + material.id);
        if (!(await stat(asset.localPath!)).size) throw Error('素材文件为空：' + material.id);
        if (material.kind === 'evidence') {
          const provenance = settings.archives.find(a => a.assetVersionId === asset.id);
          if (!provenance?.source.trim() || !provenance.license.trim() || asset.providerJobId && d.providerJobs.some(j => j.id === asset.providerJobId && j.capability === 'text-to-image')) throw Error('证据必须有真实出处和许可，不能由生成图片冒充。');
        }
      }
      return saveFilm(d, { ...film, project: { ...project, materials, planning: { ...planning, materialsReady: true, scenes: [], complete: false } } });
    } catch (error) { return stop(d, error); }
  }
  if (!planning.materialsReady) return stop(d, '素材规划尚未完成。');
  if (node.kind === 'film-plan-scene') {
    const unit = planning.units.find(u => u.id === node.fileId);
    if (!unit) return stop(d, '分段任务已变化。');
    const windows = timeline(d).filter(w => unit.shotIds.includes(w.id));
    if (windows.length !== unit.shotIds.length) return stop(d, '待规划镜头已变化。');
    const result = await call('scene', { outline: planning.outline, file: unit, provisionalTimeline: windows,
      materials: project.materials.map(({ id, kind, description }) => ({ id, kind, description })) });
    try {
      const scene = lemoScenePlanSchema.parse(result);
      if (scene.fileId !== unit.id || JSON.stringify(scene.shots.map(s => s.shotId)) !== JSON.stringify(unit.shotIds)) throw Error('分段必须按顺序覆盖每个原始镜头，不能缺漏、重复或新增镜头。');
      if (scene.shots.some(s => s.materialIds.some(id => !project.materials.some(m => m.id === id)))) throw Error('分段引用了未规划的素材。');
      const scenes = [...planning.scenes.filter(s => s.fileId !== unit.id), scene];
      return saveFilm(d, { ...film, project: { ...project, planning: { ...planning, scenes, complete: false } } });
    } catch (error) { return stop(d, error); }
  }
  const ordered = planning.units.map(unit => planning.scenes.find(s => s.fileId === unit.id));
  const expected = [...new Set(lemoPlanningShotIds(project, editable(d), editable(d).map(s => s.id)))];
  if (new Set(planning.units.map(u => u.id)).size !== planning.units.length || JSON.stringify(planning.units.flatMap(u => u.shotIds)) !== JSON.stringify(expected) || planning.scenes.length !== planning.units.length || ordered.some((s, i) => !s || JSON.stringify(s.shots.map(w => w.shotId)) !== JSON.stringify(planning.units[i].shotIds))) return stop(d, '导演方案未完整覆盖全部镜头，不能进入素材制作或代码创作。');
  if (ordered.some(s => s!.shots.some(w => w.materialIds.some(id => !project.materials.some(m => m.id === id))))) return stop(d, '导演方案存在未知素材引用。');
  // Keep the full plan and legacy treatment intact; length advice must not truncate persisted prose.
  const treatment = planning.outline.treatment + '\n\n' + ordered.map(s => s!.fileId + ': ' + s!.summary).join('\n');
  return saveFilm(d, { ...film, treatment, status: 'planned', project: { ...project, planning: { ...planning, scenes: ordered.map(s => s!), complete: true } } });
}
