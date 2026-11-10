import type { EditorialCollagePipelineData } from './editorial-collage';
import type { VoxProductionNode, VoxProductionSettings } from './vox-production';
import { lemoAgentBudgetExhausted } from './creative-animation/upstream-agent';

/** New runs only. Old version-1/2 projects retain their existing graphs. */
export function buildLemoUpstreamNodes(document: EditorialCollagePipelineData, settings: VoxProductionSettings): VoxProductionNode[] {
  const nodes: VoxProductionNode[] = [];
  const add = (kind: VoxProductionNode['kind'], id: string, dependencies: string[], paid = false, shotId?: string, fileId?: string) => {
    nodes.push({ id, kind, dependencies, paid, shotId, fileId, status: 'pending', attempt: 0 }); return id;
  };
  const timings: string[] = [];
  for (const shot of document.beats.flatMap(beat => beat.shots)) {
    const continuation = shot.narrationSplit && shot.narrationSplit.sourceShotId !== shot.id;
    const text = document.beats.flatMap(beat => beat.subtitleCues).filter(cue => shot.subtitleCueIds.includes(cue.id)).map(cue => cue.text).join(' ');
    const voice = settings.narration && !continuation && /[\p{L}\p{N}]/u.test(text) ? add('voice', `voice:${shot.id}`, [], true, shot.id) : undefined;
    timings.push(add('timing', `timing:${shot.id}`, voice ? [voice] : continuation ? [`timing:${shot.narrationSplit!.sourceShotId}`] : [], false, shot.id));
  }
  const film = document.upstreamFilm?.runId === document.productionRun?.id ? document.upstreamFilm : undefined;
  // One more paid turn while authoring and within the per-run budget (default 64 turns = historical behaviour).
  // Completed turns are never dropped when a user lowers the limit; finalize then reports the resumable limit error.
  const turn = film?.turn ?? 0;
  const count = film?.status === 'ready' || lemoAgentBudgetExhausted(film, settings) ? turn : turn + 1;
  let dependencies = timings;
  for (let turn = 1; turn <= Math.max(1, count); turn++) dependencies = [add('film-edit', `upstream-turn:${turn}`, dependencies, true, undefined, String(turn))];
  // This explicit gate also prevents a budget-exhausted authoring run being marked complete.
  const finalize = add('film-finalize', 'upstream-ready', dependencies);
  add('render', 'render', [finalize]); add('verify', 'verify', ['render']);
  return nodes;
}