import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { ProductionAssetVersion } from '../src/shared/production-workflow';
import { directorCanvasForRatio } from '../src/shared/director-render';
import { piFilmReadyErrors } from '../src/shared/creative-animation/pi-film';
import { exportLemoUpstreamProject } from './lemo-upstream-renderer';
import { piProductionPaths } from './pi-production-paths';
import { piDataHash, piFilmSourceHash } from './pi-film-fingerprint';
import { sha256File, verifyLemoAssets } from './lemo-upstream-assets';
import { stagePiNarrationTimeline } from './pi-narration-timeline';
import { buildPiFilmExportScenes } from './pi-film-export-scenes';
import { piArtifactRefSchema } from '../src/shared/creative-animation/pi-film';

export async function preparePiFilmExport(options: {
  document: EditorialCollagePipelineData; work: string;
  library: { upstreamRoot: string; threeRoot: string; pythonRoot?: string; cacheDir?: string; resourceRoot?: string };
  resolveAudioPath: (asset: ProductionAssetVersion, document: EditorialCollagePipelineData) => string | Promise<string>;
  signal?: AbortSignal;
}) {
  const { document } = options, film = document.piFilm;
  if (!film || !document.productionRun || film.runId !== document.productionRun.id || piFilmReadyErrors(film).length || !film.audioMaster) throw new Error('PI_EXPORT_NOT_READY');
  const paths = piProductionPaths(options.work, film.runId);
  if (await piFilmSourceHash(paths.project) !== film.sourceHash) throw new Error('PI_EXPORT_SOURCE_CHANGED');
  const masterPath = join(paths.root, piArtifactRefSchema.parse(film.audioMaster.path));
  if (await sha256File(masterPath) !== film.audioMaster.sha256) throw new Error('PI_EXPORT_AUDIO_CHANGED');
  const timeline = await stagePiNarrationTimeline({ document, resolveAudioPath: options.resolveAudioPath,
    outputDirectory: paths.narration, stateRoot: paths.narrationState, allowNarrationPauses: film.policy.allowNarrationPauses, targetDurationSeconds: film.policy.targetDurationSeconds });
  if (piDataHash(timeline) !== film.timelineHash || piDataHash(await verifyLemoAssets(paths.project) ?? []) !== film.assetHash) throw new Error('PI_EXPORT_TIMELINE_OR_ASSETS_CHANGED');
  const canvas = directorCanvasForRatio(document.ratio);
  if (film.evidence!.renderIdentity.width !== canvas.width || film.evidence!.renderIdentity.height !== canvas.height) throw new Error('PI_EXPORT_CANVAS_CHANGED');
  const picture = await exportLemoUpstreamProject({ ...options.library, filmDir: paths.project,
    outputDir: join(paths.root, 'exports', randomUUID()), durationSeconds: film.actualDurationSeconds,
    fps: film.evidence!.renderIdentity.fps, ...canvas, engine: 'upstream', captions: film.policy.captionMode === 'film' ? 1 : 0, signal: options.signal });
  if (await piFilmSourceHash(paths.project) !== film.sourceHash) throw new Error('PI_EXPORT_SOURCE_CHANGED');
  if (!picture.receipt.technicalPassed) throw new Error('PI_EXPORT_TECHNICAL_FAILED');
  const srtTime = (ms: number) => { const n = Math.round(ms); return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')},${String(n % 1000).padStart(3, '0')}`; };
  const subtitlePath = join(paths.root, 'captions.srt');
  await writeFile(subtitlePath, timeline.cues.map((cue, i) => `${i + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`).join('\n'), 'utf8');
  return { subtitlePath, picturePath: picture.outputPath, scenes: buildPiFilmExportScenes(document, picture.outputPath, masterPath, timeline), durationMs: timeline.durationMs, timeline };
}
