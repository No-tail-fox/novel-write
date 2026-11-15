import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildLemoUpstreamVideoEnv, runProcess, type LemoUpstreamRenderRuntime } from './lemo-upstream-video';
import { lemoFilmReadcheckScript } from '../services/lemo-page-probe/readcheck-script';

export interface PiFilmReadcheckCue { id: string | number; text: string; startSeconds: number; endSeconds: number }
export interface PiFilmReadcheckOptions {
  runtime: LemoUpstreamRenderRuntime;
  /** Verified root returned by stageLemoUpstreamRenderRoot. */
  upstreamRoot: string; filmDir: string;
  durationSeconds: number; fps: number; width: number; height: number;
  captionMode: 'film' | 'host'; cues: PiFilmReadcheckCue[];
  signal?: AbortSignal; timeoutMs?: number; scratchDir?: string;
}
export interface PiFilmReadcheckInterval { startSeconds: number; endSeconds: number; firstFrame: number; lastFrame: number; frames: number }
export interface PiFilmReadcheckText {
  id: string; text: string; caption: boolean; requiredSeconds: number | null;
  observedFrames: number; fullyVisibleFrames: number; intervals: PiFilmReadcheckInterval[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
}
export interface PiFilmReadcheckError { code: string; captions: 0 | 1; detail: string }
export interface PiFilmReadcheckMode {
  captions: 0 | 1; expectedFrames: number; sampledFrames: number; textFrames: number;
  captionFrames: number; safeAreaViolations: number; texts: PiFilmReadcheckText[];
}
export interface PiFilmReadcheckReceipt {
  engine: 'upstream-page.mjs'; revision: string; entry: string;
  durationSeconds: number; fps: number; width: number; height: number;
  readingPassed: boolean;
  evidenceReason: 'NONCAPTION_READING_AND_CAPTION_RULES' | 'CAPTION_ONLY_FULL_FILM_COVERAGE_PROVEN' | 'INSUFFICIENT_TEXT_EVIDENCE';
  modes: PiFilmReadcheckMode[]; errors: PiFilmReadcheckError[]; stdout: string; stderr: string;
}
const fail = (code: string) => new Error(`PI_FILM_READCHECK_${code}`);
function validate(o: PiFilmReadcheckOptions) {
  if (!o.upstreamRoot || !o.filmDir) throw fail('PATH_INVALID');
  if (!Number.isFinite(o.durationSeconds) || o.durationSeconds <= 0 || o.durationSeconds > 198) throw fail('DURATION_INVALID');
  if (!Number.isFinite(o.fps) || o.fps < 1 || o.fps > 60) throw fail('FPS_INVALID');
  if (![o.width, o.height].every(n => Number.isInteger(n) && n >= 16 && n <= 8192 && n % 2 === 0)) throw fail('CANVAS_SIZE');
  if (!['film', 'host'].includes(o.captionMode)) throw fail('CAPTION_MODE');
  if (!Array.isArray(o.cues) || o.cues.length > 512) throw fail('CUE_LIMIT');
  const ids = new Set<string>();
  for (const cue of o.cues) {
    if (!cue || !(typeof cue.id === 'string' && cue.id.length > 0 && cue.id.length <= 252 || typeof cue.id === 'number' && Number.isFinite(cue.id)) || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 4096 || !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < 0 || cue.endSeconds <= cue.startSeconds || cue.endSeconds > o.durationSeconds || ids.has(String(cue.id))) throw fail('CUE_INVALID');
    ids.add(String(cue.id));
  }
  if (o.timeoutMs !== undefined && (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0 || o.timeoutMs > 600_000)) throw fail('TIMEOUT_INVALID');
}

/** Full rendered-frame observations, never sparse extrapolation. Timeout/cancel rejects only
 * after runProcess kills the tree. Runtime failures yield a failed typed receipt. TEXTS must
 * report canonical complete text (including typewriter blocks), as in upstream readcheck.mjs.
 */
export async function runPiFilmReadcheck(options: PiFilmReadcheckOptions): Promise<PiFilmReadcheckReceipt> {
  validate(options);
  options.signal?.throwIfAborted();
  const marker = JSON.parse(await readFile(join(options.upstreamRoot, '.storydream-render-root.json'), 'utf8')) as { revision: string };
  const receipt: PiFilmReadcheckReceipt = {
    engine: 'upstream-page.mjs', revision: marker.revision, entry: resolve(options.filmDir),
    durationSeconds: options.durationSeconds, fps: options.fps, width: options.width, height: options.height,
    readingPassed: false, evidenceReason: 'INSUFFICIENT_TEXT_EVIDENCE', modes: [], errors: [], stdout: '', stderr: '',
  };
  const parent = resolve(options.scratchDir ?? tmpdir());
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, 'pi-film-readcheck-'));
  try {
    const script = join(scratch, 'readcheck.mjs'), input = join(scratch, 'input.json'), resultPath = join(scratch, 'result.json');
    await writeFile(script, lemoFilmReadcheckScript, 'utf8');
    await writeFile(input, JSON.stringify({ upstreamRoot: resolve(options.upstreamRoot), filmDir: receipt.entry, durationSeconds: options.durationSeconds, fps: options.fps, width: options.width, height: options.height, captionMode: options.captionMode, cues: options.cues, resultPath }), 'utf8');
    const result = await runProcess(options.runtime.nodePath, [script, input], {
      cwd: resolve(options.upstreamRoot), env: buildLemoUpstreamVideoEnv(options.runtime), signal: options.signal,
      timeoutMs: options.timeoutMs ?? 180_000, tree: true, keep: 32 * 1024,
    });
    receipt.stdout = result.stdout; receipt.stderr = result.stderr;
    if (result.code !== 0) receipt.errors.push({ code: 'PROCESS_FAILED', captions: 0, detail: String(result.code) });
    else {
      try {
        if ((await stat(resultPath)).size > 2 * 1024 * 1024) throw fail('RESULT_LIMIT');
        const data = JSON.parse(await readFile(resultPath, 'utf8')) as Pick<PiFilmReadcheckReceipt, 'readingPassed' | 'evidenceReason' | 'modes' | 'errors'>;
        const expected = Math.ceil(options.durationSeconds * options.fps), modes = options.captionMode === 'film' ? [1, 0] : [0];
        if (!Array.isArray(data.errors) || data.errors.length > 200 || !Array.isArray(data.modes) || data.modes.length !== modes.length || data.modes.some((m, i) => m.captions !== modes[i] || m.sampledFrames !== expected || m.expectedFrames !== expected || !Array.isArray(m.texts) || m.texts.length > 1024 || m.texts.reduce((sum, t) => sum + t.intervals.length, 0) > 4096)) throw fail('RESULT_SHAPE');
        receipt.modes = data.modes; receipt.errors = data.errors; receipt.evidenceReason = data.evidenceReason;
        receipt.readingPassed = data.readingPassed === true && data.errors.length === 0;
      } catch (error) { receipt.errors.push({ code: 'RESULT_INVALID', captions: 0, detail: String(error).slice(0, 256) }); }
    }
    return receipt;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
export const piFilmReadcheckInternals = { validate };
