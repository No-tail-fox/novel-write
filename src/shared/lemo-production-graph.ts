import type { EditorialCollagePipelineData } from './editorial-collage';
import type { VoxProductionNode, VoxProductionSettings } from './vox-production';
import { voxReadableNarration, voxShotLocked } from './vox-production';
import { LEMO_EDIT_MAX_ROUNDS } from './creative-animation/lemo-edits';
import { lemoEditNodeId, lemoProjectFiles } from './creative-animation/native-project';

/** Files are authoring units on one absolute timeline, never rendered as independent clips. */
export function buildLemoProjectNodes(d: EditorialCollagePipelineData, settings: VoxProductionSettings, planningVersion = d.productionRun?.planningVersion): VoxProductionNode[] {
  const nodes: VoxProductionNode[] = [];
  const add = (kind: VoxProductionNode['kind'], id: string, dependencies: string[], extra: Partial<VoxProductionNode> = {}) => {
    nodes.push({ id, kind, dependencies, paid: false, status: 'pending', attempt: 0, ...extra }); return id;
  };
  const shots = d.beats.flatMap(b => b.shots), editable = shots.filter(s => !voxShotLocked(settings, s));
  let ready: string | undefined;
  if (editable.length) {
    const plan = add('plan', 'plan', [], { paid: true });
    const film = d.productionRun?.authoringVersion === 2 ? d.creativeFilms?.find(f => f.id === d.productionRun?.filmId) : undefined;
    const project = film?.project;
    // A full-film diagnostic must not reopen the already accepted sample gate.
    const fullReviewStarted = d.productionRun?.nodes.some(n => n.id === 'film-review' && n.attempt > 0) ?? false;
    let planned = plan;
    if (planningVersion === 1) {
      const inventory = add('film-plan-materials', 'film-plan-materials', [plan], { paid: true });
      const units = project?.planning?.units ?? lemoProjectFiles(editable.map(s => s.id)).filter(f => f.kind === 'scene');
      const scenes = units.map(unit => add('film-plan-scene', 'film-plan-scene:' + unit.id, [inventory], { fileId: unit.id, paid: true }));
      planned = add('film-plan-finalize', 'film-plan-finalize', [inventory, ...scenes]);
    }
    const gate = add('film-materials', 'film-materials', [planned]);
    const author = (kind: VoxProductionNode['kind'], id: string, dependencies: string[], fileId: string, repair = false) => {
      if (project?.authoringMode !== 'incremental') return add(kind, id, dependencies, { fileId, paid: true });
      const session = project.editSessions?.[id];
      const repairActive = !repair || (kind === 'film-sample-repair' ? !fullReviewStarted : fullReviewStarted);
      if (!repair || repairActive && project.repairFileIds.includes(fileId) || session) {
        const count = Math.min(LEMO_EDIT_MAX_ROUNDS, (session?.rounds ?? 0) + (session?.done || !repairActive ? 0 : 1));
        for (let round = 1; round <= count; round++) dependencies = [add('film-edit', lemoEditNodeId(id, session?.revision, round), dependencies, { fileId, editSession: id, editRound: round, paid: true })];
      }
      return add(kind, id, dependencies, { fileId });
    };
    const materials = (film?.project?.materials ?? []).map(m => add('film-material', 'film-material:' + m.id, [gate], { materialId: m.id, paid: m.kind === 'generated' }));
    const prepared = materials.length ? materials : [gate];
    const timings = editable.map(shot => {
      const narration = d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)).map(c => c.text).join(' ');
      const continuation = shot.narrationSplit && shot.narrationSplit.sourceShotId !== shot.id;
      const voice = settings.narration && !continuation && voxReadableNarration(narration) ? add('voice', 'voice:' + shot.id, prepared, { shotId: shot.id, paid: true }) : undefined;
      return add('timing', 'timing:' + shot.id, voice ? [voice] : continuation ? ['timing:' + shot.narrationSplit!.sourceShotId] : prepared, { shotId: shot.id });
    });
    const files = lemoProjectFiles(editable.map(s => s.id));
    const shared = author('film-code', 'film-code:shared', timings, 'shared');
    const scenes = files.filter(f => f.kind === 'scene');
    const first = author('film-scene', 'film-scene:' + scenes[0].id, [shared], scenes[0].id);
    const sample = add('film-sample', 'film-sample', [first]);
    const sampleRepairs = ['shared', scenes[0].id].map(fileId => author('film-sample-repair', 'film-sample-repair:' + fileId, [sample], fileId, true));
    const checked = add('film-sample-finalize', 'film-sample-finalize', sampleRepairs);
    const rest = scenes.slice(1).map(f => author('film-scene', 'film-scene:' + f.id, [checked], f.id));
    const director = author('film-director', 'film-director', [checked, ...rest], 'director');
    const review = add('film-review', 'film-review', [director]);
    const repairs = files.map(f => author('film-repair', 'film-repair:' + f.id, [review], f.id, true));
    ready = add('film-finalize', 'film-finalize', repairs);
  }
  const compiled = shots.map(s => add('compile', 'compile:' + s.id, voxShotLocked(settings, s) ? [] : [ready!], { shotId: s.id }));
  add('render', 'render', compiled); add('verify', 'verify', ['render']);
  return nodes;
}
