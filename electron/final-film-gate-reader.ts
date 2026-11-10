/**
 * Main-process reader for the advisory final-film gate (`quality-gate.json`, backlog E-5).
 *
 * Security model (mirrors html-video-runtime / managed-history-paths):
 *   - the renderer only sends a task id (and optional episode id); never a path;
 *   - the film path comes from the task's own persisted record (HTML `output.path`, director `director-final-video` asset);
 *   - the film and its sibling `quality-gate.json` must canonically resolve inside the task's managed work directory;
 *   - the report must be a regular, non-symlink file under {@link FINAL_FILM_GATE_REPORT_MAX_BYTES}.
 * Missing → `null`; unreadable / corrupt → `status: 'error'` view. Never throws for file problems.
 */
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { FINAL_FILM_GATE_REPORT_FILE } from '../src/shared/final-film-gate';
import {
  FINAL_FILM_GATE_REPORT_MAX_BYTES, finalFilmGateErrorView, finalFilmGateViewFromReport, type FinalFilmGateView,
} from '../src/shared/final-film-gate-view';
import { directorQualityReview, directorRenderOutputs, type DirectorRenderDocument } from '../src/shared/director-render';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { isHtmlVideoTask, parseHtmlVideoPipelineData } from '../src/shared/html-video-workflow';
import type { Task } from '../src/shared/types';

export type FinalFilmGateTask = Pick<Task, 'id' | 'taskType' | 'pipelineData'>;

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return Boolean(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
}

/**
 * The task's final film as recorded in its own pipeline data (no filesystem access).
 * HTML video: `output.path`. VOX / editorial collage / Music MV / motion comic (incl. Lemo v3): the current
 * `director-final-video` asset of the episode, else the one behind the latest review report, else the newest output.
 * Other task types do not run the gate → `null`.
 */
export function finalFilmPathForTask(task: FinalFilmGateTask, episodeId?: string): string | null {
  try {
    if (isHtmlVideoTask(task)) return parseHtmlVideoPipelineData(task.pipelineData).output?.path || null;
    if (task.taskType !== 'editorial-collage' && task.taskType !== 'motion-comic') return null;
    const document: DirectorRenderDocument = task.taskType === 'editorial-collage'
      ? parseEditorialCollagePipelineData(task.pipelineData)
      : parseMotionComicPipelineData(task.pipelineData);
    const scope = document.workflowKind === 'motion-comic' ? episodeId ?? document.activeEpisodeId : undefined;
    const outputs = directorRenderOutputs(document, scope);
    const reportJobId = directorQualityReview(document, scope).report?.providerJobId;
    const reviewed = reportJobId ? outputs.history.find(asset => asset.providerJobId === reportJobId) : undefined;
    return (outputs.current ?? reviewed ?? outputs.history[0])?.localPath || null;
  } catch {
    return null;
  }
}

/**
 * Load `quality-gate.json` next to `filmPath`, confined to `workDir`.
 * `null` = no report (or the film is outside the managed directory: nothing is read).
 */
export async function readFinalFilmGateForFilm(workDir: string, filmPath: string): Promise<FinalFilmGateView | null> {
  if (!workDir || !filmPath) return null;
  const root = resolve(workDir);
  const film = isAbsolute(filmPath) ? resolve(filmPath) : resolve(root, filmPath);
  if (!isInside(root, film)) return null;
  const filmName = basename(film);
  const missing = (error: unknown) => errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR';
  let canonicalRoot: string;
  let canonicalFilmDir: string;
  try {
    canonicalRoot = await realpath(root);
    canonicalFilmDir = await realpath(dirname(film));
  } catch (error) {
    return missing(error) ? null : finalFilmGateErrorView('FINAL_GATE_REPORT_UNREADABLE', { film: filmName });
  }
  // A link or junction on the way out of the managed directory: never touch what it points to.
  // (HTML films sit directly in the work directory, director films in a sub-directory.)
  if (canonicalFilmDir !== canonicalRoot && !isInside(canonicalRoot, canonicalFilmDir)) return null;
  const canonicalReport = join(canonicalFilmDir, FINAL_FILM_GATE_REPORT_FILE);
  let reportStat;
  try { reportStat = await lstat(canonicalReport); } catch (error) {
    return missing(error) ? null : finalFilmGateErrorView('FINAL_GATE_REPORT_UNREADABLE', { film: filmName });
  }
  if (reportStat.isSymbolicLink() || !reportStat.isFile()) return finalFilmGateErrorView('FINAL_GATE_REPORT_UNREADABLE', { film: filmName });
  if (reportStat.size <= 0 || reportStat.size > FINAL_FILM_GATE_REPORT_MAX_BYTES) return finalFilmGateErrorView('FINAL_GATE_REPORT_INVALID', { film: filmName });
  let raw: unknown;
  try { raw = JSON.parse(await readFile(canonicalReport, 'utf8')); } catch {
    return finalFilmGateErrorView('FINAL_GATE_REPORT_INVALID', { film: filmName });
  }
  let filmModifiedAtMs: number | undefined;
  try {
    const canonicalFilm = await realpath(film);
    if (isInside(canonicalRoot, canonicalFilm)) {
      const filmStat = await stat(canonicalFilm);
      if (filmStat.isFile()) filmModifiedAtMs = filmStat.mtimeMs;
    }
  } catch { /* film gone: the report is still shown, freshness unknown */ }
  return finalFilmGateViewFromReport(raw, { expectedFilm: filmName, ...(filmModifiedAtMs !== undefined ? { filmModifiedAtMs } : {}) });
}

/** IPC entry: the caller has already loaded `task` by id and resolved its managed `workDir`. */
export async function readTaskFinalFilmGate(input: { task: FinalFilmGateTask; workDir: string; episodeId?: string }): Promise<FinalFilmGateView | null> {
  const filmPath = finalFilmPathForTask(input.task, input.episodeId);
  if (!filmPath) return null;
  try { return await readFinalFilmGateForFilm(input.workDir, filmPath); } catch { return finalFilmGateErrorView('FINAL_GATE_REPORT_UNREADABLE', { film: basename(filmPath) }); }
}
