import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildLemoUpstreamVideoEnv, runProcess, type LemoUpstreamRenderRuntime } from './lemo-upstream-video';
import { lemoPageProbeScript } from '../services/lemo-page-probe/script';

export interface LemoPageProbeOptions {
  runtime: LemoUpstreamRenderRuntime;
  /** Verified root returned by stageLemoUpstreamRenderRoot. */
  upstreamRoot: string;
  filmDir: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  times: number[];
  signal?: AbortSignal;
  timeoutMs?: number;
  scratchDir?: string;
}
/** Upstream core/render/readcheck.mjs: IDs can be numbers or strings; boxes are pixels. */
export interface LemoPageText { id: string | number; text: string; x0: number; y0: number; x1: number; y1: number }
export interface LemoPageSample {
  time: number;
  ready: boolean;
  durationSeconds: number | null;
  fontsReady: boolean;
  fonts: Array<{ family: string; status: string }>;
  textsPresent: boolean;
  texts: LemoPageText[];
  eventsPresent: boolean;
  /** Runtime event clocks and types only; arbitrary event payloads are deliberately excluded. */
  events: Array<{ t: number; type: string }>;
  errors: string[];
}
export interface LemoPageProbeReceipt {
  engine: 'upstream-page.mjs';
  revision: string;
  entry: string;
  requestedDurationSeconds: number;
  durationToleranceSeconds: number;
  width: number;
  height: number;
  modes: Array<{ captions: 0 | 1; samples: LemoPageSample[] }>;
  errors: string[];
  /** Runtime checks only. Missing TEXTS is explicitly not a reading-time pass. */
  technicalPassed: boolean;
  textEvidenceComplete: boolean;
  stdout: string;
  stderr: string;
}
const fail = (message: string) => new Error(`LEMO_PAGE_PROBE_${message}`);
function validate(options: LemoPageProbeOptions) {
  if (!options.filmDir || !options.upstreamRoot) throw fail('PATH_INVALID');
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) throw fail('DURATION_INVALID');
  if (!Number.isFinite(options.fps) || options.fps <= 0 || options.fps > 240) throw fail('FPS_INVALID');
  if (!Array.isArray(options.times) || !options.times.length || options.times.length > 64 || options.times.some(t => !Number.isFinite(t) || t < 0 || t >= options.durationSeconds)) throw fail('TIME_INVALID');
  if (![options.width, options.height].every(n => Number.isInteger(n) && n >= 16 && n <= 8192 && n % 2 === 0)) throw fail('CANVAS_SIZE');
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 600_000)) throw fail('TIMEOUT_INVALID');
}

/** Observe the actual page in two independent caption modes. No arbitrary source/query inputs.
 * Timeouts and cancellation reject after process-tree termination. Other runtime failures return
 * a failed receipt. Sparse samples cannot establish continuous reading time between samples.
 */
export async function probeLemoPage(options: LemoPageProbeOptions): Promise<LemoPageProbeReceipt> {
  validate(options);
  options.signal?.throwIfAborted();
  const marker = JSON.parse(await readFile(join(options.upstreamRoot, '.storydream-render-root.json'), 'utf8')) as { revision: string };
  const receipt: LemoPageProbeReceipt = {
    engine: 'upstream-page.mjs', revision: marker.revision, entry: resolve(options.filmDir),
    requestedDurationSeconds: options.durationSeconds, durationToleranceSeconds: 1 / options.fps,
    width: options.width, height: options.height, modes: [], errors: [], technicalPassed: false,
    textEvidenceComplete: false, stdout: '', stderr: '',
  };
  const parent = resolve(options.scratchDir ?? tmpdir());
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, 'lemo-page-probe-'));
  try {
    const script = join(scratch, 'probe.mjs'), input = join(scratch, 'input.json'), resultPath = join(scratch, 'result.json');
    await writeFile(script, lemoPageProbeScript, 'utf8');
    await writeFile(input, JSON.stringify({ upstreamRoot: resolve(options.upstreamRoot), filmDir: receipt.entry, width: options.width, height: options.height, times: options.times, resultPath }), 'utf8');
    const result = await runProcess(options.runtime.nodePath, [script, input], {
      cwd: resolve(options.upstreamRoot), env: buildLemoUpstreamVideoEnv(options.runtime), signal: options.signal,
      timeoutMs: options.timeoutMs ?? 90_000, tree: true, keep: 64 * 1024,
    });
    receipt.stdout = result.stdout; receipt.stderr = result.stderr;
    if (result.code !== 0) receipt.errors.push(`PROCESS_FAILED: ${result.code}`);
    else {
      const size = (await stat(resultPath)).size;
      if (size > 1024 * 1024) throw fail('RESULT_LIMIT');
      const data = JSON.parse(await readFile(resultPath, 'utf8')) as Pick<LemoPageProbeReceipt, 'modes'>;
      if (data.modes.length !== 2 || data.modes.some((mode, index) => mode.captions !== (index === 0 ? 1 : 0) || mode.samples.length !== options.times.length || mode.samples.some((sample, i) => sample.time !== options.times[i]))) throw fail('RESULT_SHAPE');
      receipt.modes = data.modes;
      for (const mode of receipt.modes) for (const sample of mode.samples) {
        const prefix = `captions=${mode.captions} t=${sample.time}: `;
        receipt.errors.push(...sample.errors.map(message => prefix + message));
        if (sample.durationSeconds === null || Math.abs(sample.durationSeconds - options.durationSeconds) > 1 / options.fps + 1e-9) receipt.errors.push(prefix + 'DURATION_MISMATCH');
      }
      receipt.textEvidenceComplete = receipt.modes.every(mode => mode.samples.every(sample => sample.textsPresent && !sample.errors.some(e => e.startsWith('TEXTS_'))));
    }
    receipt.technicalPassed = receipt.errors.length === 0;
    return receipt;
  } finally {
    // Only the private mkdtemp directory created above is removed.
    await rm(scratch, { recursive: true, force: true });
  }
}
export const lemoPageProbeInternals = { validate };
