import type { EditorialCollagePipelineData } from './editorial-collage';
import type { VoxProductionNode, VoxProductionSettings } from './vox-production';
import { LEMO_AGENT_MAX_TURNS } from './creative-animation/upstream-agent';

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
  const count = Math.min(LEMO_AGENT_MAX_TURNS, (film?.turn ?? 0) + (film?.status === 'ready' ? 0 : 1));
  let dependencies = timings;
  for (let turn = 1; turn <= Math.max(1, count); turn++) dependencies = [add('film-edit', `upstream-turn:${turn}`, dependencies, true, undefined, String(turn))];
  // This explicit gate also prevents a budget-exhausted authoring run being marked complete.
  const finalize = add('film-finalize', 'upstream-ready', dependencies);
  add('render', 'render', [finalize]); add('verify', 'verify', ['render']);
  return nodes;
}

/** Durable creative stages share a run; retries never manufacture a fresh stage. */
export function buildLemoOfficialNodes(document: EditorialCollagePipelineData, settings: VoxProductionSettings): VoxProductionNode[] {
  const nodes: VoxProductionNode[] = [];
  const add = (kind: VoxProductionNode['kind'], id: string, dependencies: string[], paid = false, shotId?: string, layerId?: string, fileId?: string) => {
    nodes.push({ id, kind, dependencies, paid, shotId, layerId, fileId, status: 'pending', attempt: 0 }); return id;
  };
  const ready: string[] = [];
  const phased = !document.productionRun || document.productionRun.nodes.some(n => n.id === 'official-treatment');
  const treatment = phased ? add('film-edit', 'official-treatment', [], true, undefined, undefined, 'official-treatment') : undefined;
  const visualReady: string[] = [];
  const materials = new Map<string, string[]>();
  const shots = document.beats.flatMap(beat => beat.shots);
  for (const shot of shots) {
    const continuation = shot.narrationSplit && shot.narrationSplit.sourceShotId !== shot.id;
    const locked = settings.lockedShotIds.includes(shot.id) || !!shot.narrationSplit && settings.lockedShotIds.includes(shot.narrationSplit.sourceShotId);
    if (locked || continuation || settings.presetId === 'data-map') continue;
    for (const layer of shot.layers.filter(layer => layer.visible !== false && !layer.content)) {
      const imported = settings.presetId === 'archival-story' && layer.kind !== 'background';
      if (!settings.generateImages && !imported) continue;
      const image = add('image', `image:${shot.id}:${layer.id}`, treatment ? [treatment] : [], !imported, shot.id, layer.id);
      const material = ['subject', 'archival'].includes(layer.kind) && settings.presetId === 'paper-explainer'
        ? add('cutout', `cutout:${shot.id}:${layer.id}`, [image], false, shot.id, layer.id) : image;
      materials.set(shot.id, [...(materials.get(shot.id) ?? []), material]);
      visualReady.push(material);
    }
  }
  const style = phased ? add('film-edit', 'official-style-frame', [treatment!, ...visualReady], true, undefined, undefined, 'official-style-frame') : undefined;
  for (const shot of shots) {
    const continuation = shot.narrationSplit && shot.narrationSplit.sourceShotId !== shot.id;
    const locked = settings.lockedShotIds.includes(shot.id) || !!shot.narrationSplit && settings.lockedShotIds.includes(shot.narrationSplit.sourceShotId);
    const text = document.beats.flatMap(beat => beat.subtitleCues).filter(cue => shot.subtitleCueIds.includes(cue.id)).map(cue => cue.text).join(' ');
    const voice = settings.narration && !locked && !continuation && /[\p{L}\p{N}]/u.test(text) ? add('voice', `voice:${shot.id}`, style ? [style] : [], true, shot.id) : undefined;
    ready.push(add('timing', `timing:${shot.id}`, [...(materials.get(shot.id) ?? []), ...(voice ? [voice] : continuation ? [`timing:${shot.narrationSplit!.sourceShotId}`] : style ? [style] : [])], false, shot.id));
  }
  const voiceLock = phased ? add('film-edit', 'official-voice-lock', ready, false, undefined, undefined, 'official-voice-lock') : undefined;
  const authoring = add('film-edit', 'official-authoring', voiceLock ? [voiceLock] : ready, true, undefined, undefined, 'official-film');
  let finalSource = authoring;
  for (const repair of document.productionRun?.nodes.filter(n => n.id.startsWith('official-repair:')) ?? []) {
    nodes.push({ ...repair, dependencies: [finalSource] }); finalSource = repair.id;
  }
  const finalize = add('film-finalize', 'official-ready', [finalSource]);
  add('render', 'render', [finalize]); add('verify', 'verify', ['render']);
  return nodes;
}
