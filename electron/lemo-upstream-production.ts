import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { VoxProductionNode } from '../src/shared/vox-production';
import { directorCanvasForRatio } from '../src/shared/director-render';
import { resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import { readLemoUpstreamManifest, type LemoSourceOptions } from './lemo-upstream-source';
import { stepLemoUpstreamAgent, recoverLemoUpstreamAgentTurn, type LemoAgentOptions } from './lemo-upstream-agent';
import { reviewLemoUpstreamProject } from './lemo-upstream-renderer';

export type LemoProductionLibrary = Omit<LemoSourceOptions, 'filmDir'>;
export async function preflightLemoUpstream(library: LemoProductionLibrary, style: string) {
  const manifest = await readLemoUpstreamManifest(library.upstreamRoot);
  for (const path of ['DIRECTOR.md', 'TECHNIQUE.md', `styles/${style}/STYLE.md`]) {
    if (!manifest.files.some(file => file.path === path) || !existsSync(join(library.upstreamRoot, path))) throw new Error('LEMO_LIBRARY_MISSING: ' + path);
  }
  if (!existsSync(join(library.threeRoot, 'build/three.module.js'))) throw new Error('LEMO_THREE_MISSING');
}
export function lemoAgentRoot(work: string, runId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('LEMO_RUN_PATH');
  return join(work, 'lemo-agent', runId);
}
export function lemoProductionContext(document: EditorialCollagePipelineData) {
  const run = document.productionRun!;
  const style = resolveCreativeStyle(run.settings.authoring?.styleId, run.settings.presetId);
  if (!style) throw new Error('LEMO_STYLE_MISSING');
  return { runId: run.id, styleId: style.slug, ...directorCanvasForRatio(document.ratio), durationSeconds: (document.timeline?.durationMs ?? 0) / 1000,
    brief: [document.title, document.sourceText, run.settings.authoring?.brief ?? '',
      'Approved narration and absolute timeline in milliseconds; keep the wording and respect all cue windows:',
      JSON.stringify({ cues: document.beats.flatMap(beat => beat.subtitleCues), shots: document.beats.flatMap(beat => beat.shots.map(shot => ({ id: shot.id, title: shot.title, direction: shot.scenePrompt, durationMs: shot.durationMs, startMs: document.timeline?.clips.find(clip => clip.shotId === shot.id)?.startMs }))) }),
      'Sourced facts (do not invent data): ' + JSON.stringify(run.settings.data),
      'Imported archive descriptions (do not invent evidence or unavailable media): ' + JSON.stringify(run.settings.archives),
    ].join('\n') };
}
export function createLemoUpstreamOperations(library: LemoProductionLibrary, work: string, model: LemoAgentOptions['model']) {
  const options = (d: EditorialCollagePipelineData, node: VoxProductionNode): LemoAgentOptions => {
    const context = lemoProductionContext(d);
    return { root: lemoAgentRoot(work, context.runId), upstreamRoot: library.upstreamRoot, context,
      turn: Number(node.fileId), requestId: node.requestId, retryOfRequestId: node.retryOfRequestId, model,
      review: (filmDir, outputDir, times) => reviewLemoUpstreamProject({ ...library, filmDir, outputDir, times, width: context.width, height: context.height }) };
  };
  return {
    upstreamStep: async (d: EditorialCollagePipelineData, node: VoxProductionNode) => ({ ...d, upstreamFilm: await stepLemoUpstreamAgent(options(d, node)) }),
    recoverUpstreamStep: async (d: EditorialCollagePipelineData, node: VoxProductionNode) => {
      const input = options(d, node);
      let film = await recoverLemoUpstreamAgentTurn(input.root, input.turn!);
      // A response persisted before the process died can be executed without another model call.
      if (!film && existsSync(join(input.root, `turn-${String(input.turn).padStart(4, '0')}`, 'response.json'))) {
        film = await stepLemoUpstreamAgent({ ...input, model: async () => { throw new Error('LEMO_RECOVERY_MUST_NOT_CHARGE'); } });
      }
      return film ? { ...d, upstreamFilm: film } : undefined;
    },
  };
}
