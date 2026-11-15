import type { EditorialCollagePipelineData } from './editorial-collage';
import type { VoxProductionNode, VoxProductionSettings } from './vox-production';
import { buildLemoUpstreamNodes } from './lemo-upstream-graph';
import { splitPiNarration } from './pi-film-context';

/** Separate v4 graph. A segment may contain many ledger-recorded requests and is never a single-request retry node. */
export function buildPiFilmNodes(document: EditorialCollagePipelineData, settings: VoxProductionSettings): VoxProductionNode[] {
  const legacy = buildLemoUpstreamNodes(document, settings);
  const nodes = legacy.filter(node => ['voice', 'timing', 'compile'].includes(node.kind));
  const timings = nodes.filter(node => node.kind === 'timing').map(node => node.id);
  const compile = nodes.filter(node => node.kind === 'compile').map(node => node.id);
  const film = document.piFilm?.runId === document.productionRun?.id ? document.piFilm : undefined;
  const narration = document.sourceText || document.beats.flatMap(beat => beat.subtitleCues).map(cue => cue.text).join(' ');
   const count = Math.max(1, splitPiNarration(narration).length, (film?.segment ?? 0) + (film?.phase === 'ready' ? 0 : 1));
  if (count > 1000) throw new Error('PI_SEGMENT_LIMIT');
  const add = (id: string, kind: VoxProductionNode['kind'], dependencies: string[], paid = false) => {
    nodes.push({ id, kind, dependencies, paid, status: 'pending', attempt: 0 }); return id;
  };
  let dependencies = timings;
  for (let segment = 1; segment <= count; segment++) dependencies = [add(`pi-segment:${segment}`, 'agent-segment', dependencies, true)];
  const ready = add('pi-ready', 'film-finalize', dependencies);
  const audio = add('pi-audio-master', 'audio-master', [ready]);
  add('render', 'render', [ready, audio, ...compile]);
  add('verify', 'verify', ['render']);
  return nodes;
}
