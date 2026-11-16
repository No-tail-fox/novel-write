import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { buildLemoUpstreamVideoEnv, defaultLemoUpstreamRenderCacheDir, lemoUpstreamVideoInternals, type LemoUpstreamRenderRuntime } from './lemo-upstream-video';

export interface LemoUpstreamStillsOptions {
  /** Bundled Playwright driver runtime used by video.mjs. */
  runtime: LemoUpstreamRenderRuntime;
  /** SHA-verified staged root produced by stageLemoUpstreamRenderRoot. */
  upstreamRoot: string;
  /** Directory containing index.html and the film's @film resources. */
  filmDir: string;
  /** Caller-owned review root. Run-specific artifact directories are namespaced below it. */
  outputDir: string;
  /** Explicit still times in seconds. Each must be in [0, durationSeconds). */
  times: number[];
  /** Only the upstream caption switch is exposed; arbitrary query injection is not accepted. */
  captions?: 0 | 1;
  durationSeconds: number;
  width: number;
  height: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Short shared cache root for private renderer scratch. Defaults to the shared render cache. */
  scratchDir?: string;
}

export interface LemoUpstreamStillsReceipt {
  revision: string;
  entry: string;
  durationSeconds: number;
  width: number;
  height: number;
  times: number[];
  frames: Array<{ time: number; path: string }>;
  errors: string[];
  missingResources: Array<{ path: string; status: number }>;
  warnings: string[];
  technicalPassed: boolean;
  aestheticReview: false;
  engine: 'upstream-still.mjs';
  renderSeconds?: number;
  stdout?: string;
  stderr?: string;
  logPath?: string;
}

const error = (message: string) => new Error(`LEMO_UPSTREAM_STILLS_${message}`);
const isFile = async (path: string) => (await stat(path).catch(() => undefined))?.isFile() ?? false;
const tail = lemoUpstreamVideoInternals.tail;

/** Parse the warnings that still.mjs/page.mjs deliberately leaves on stderr. */
export function parseLemoUpstreamStillLog(stderr: string) {
  const missingResources: Array<{ path: string; status: number }> = [];
  const warnings: string[] = [];
  for (const line of stderr.split(/\r?\n/u)) {
    const missing = /^\[page\] optional file missing: (\S+) \((\d{3}),/u.exec(line);
    if (missing) {
      let path = missing[1];
      try { path = new URL(path).pathname; } catch { /* preserve non-URL diagnostics */ }
      if (missingResources.length < 200) missingResources.push({ path, status: Number(missing[2]) });
    } else if (/^\[(?:page|note|pageerror)\]/u.test(line) && warnings.length < 100 && !warnings.includes(line)) {
      warnings.push(line.slice(0, 1500));
    }
  }
  return { missingResources, warnings };
}

function validate(options: LemoUpstreamStillsOptions) {
  if (options.captions !== undefined && options.captions !== 0 && options.captions !== 1) throw error('QUERY_INVALID');
  if (!options.filmDir || !options.upstreamRoot || !options.outputDir) throw error('INVALID_OPTIONS: missing path');
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) throw error('DURATION_INVALID');
  if (!Array.isArray(options.times) || !options.times.length || options.times.some(time => !Number.isFinite(time) || time < 0 || time >= options.durationSeconds)) {
    throw error(`TIME_INVALID: times must be finite and in [0, ${options.durationSeconds})`);
  }
  if (![options.width, options.height].every(value => Number.isInteger(value) && value >= 16 && value <= 8192 && value % 2 === 0)) throw error('CANVAS_SIZE');
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw error('TIMEOUT_INVALID');
}

/** Render exact upstream still.mjs frames with the same bundled Node/browser environment as video.mjs. */
export async function renderLemoUpstreamStills(options: LemoUpstreamStillsOptions): Promise<LemoUpstreamStillsReceipt> {
  validate(options);
  options.signal?.throwIfAborted();
  if (!await isFile(join(options.upstreamRoot, 'core', 'render', 'still.mjs'))) throw error(`SCRIPT_MISSING: ${join(options.upstreamRoot, 'core', 'render', 'still.mjs')}`);
  if (!await isFile(join(options.filmDir, 'index.html'))) throw error(`FILM_MISSING: ${join(options.filmDir, 'index.html')}`);

  const scratchRoot = resolve(options.scratchDir ?? defaultLemoUpstreamRenderCacheDir());
  const artifactRoot = resolve(defaultLemoUpstreamRenderCacheDir());
  await Promise.all([mkdir(scratchRoot, { recursive: true }), mkdir(artifactRoot, { recursive: true })]);
  const runId = randomUUID();
  const finalDir = join(artifactRoot, `review-${runId}`);
  await mkdir(finalDir, { recursive: false });
  const scratch = await mkdtemp(join(scratchRoot, `stills-${runId}-`));
  const revision = JSON.parse(await readFile(join(options.upstreamRoot, '.storydream-render-root.json'), 'utf8').catch(() => '{"revision":"unknown"}')) as { revision?: string };
  const receipt: LemoUpstreamStillsReceipt = { revision: revision.revision ?? 'unknown', entry: options.filmDir, durationSeconds: options.durationSeconds,
    width: options.width, height: options.height, times: [...options.times], frames: [], errors: [], missingResources: [], warnings: [],
    technicalPassed: false, aestheticReview: false, engine: 'upstream-still.mjs' };
  const script = join(options.upstreamRoot, 'core', 'render', 'still.mjs');
  const outDir = join(scratch, 'frames');
  const logPath = join(scratch, 'render.log');
  const args = [script, resolve(options.filmDir), ...options.times.map(String), '--size', `${options.width}x${options.height}`, '--out', outDir, '--prefix', 't_'];
  if (options.captions !== undefined) args.push('--q', `captions=${options.captions}`);
  const started = Date.now();
  try {
    await mkdir(outDir, { recursive: true });
    const result = await lemoUpstreamVideoInternals.runProcess(options.runtime.nodePath, args, {
      cwd: options.upstreamRoot, env: buildLemoUpstreamVideoEnv(options.runtime), signal: options.signal,
      timeoutMs: options.timeoutMs, tree: true, keep: 512 * 1024,
    });
    receipt.renderSeconds = (Date.now() - started) / 1000;
    receipt.stdout = result.stdout; receipt.stderr = result.stderr; receipt.logPath = join(finalDir, 'render.log');
    await writeFile(logPath, `$ ${options.runtime.nodePath} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`, 'utf8');
    await copyFile(logPath, receipt.logPath);
    const page = parseLemoUpstreamStillLog(result.stderr);
    receipt.missingResources = page.missingResources; receipt.warnings = page.warnings;
    if (result.code !== 0) receipt.errors.push(`LEMO_UPSTREAM_STILLS_RENDER_FAILED: ${tail(result.stderr) || tail(result.stdout) || `exit code ${result.code}`}`);
    for (let index = 0; index < options.times.length; index++) {
      const timeText = String(options.times[index]);
      const source = join(outDir, `t_${timeText}.jpg`);
      if (!await isFile(source)) receipt.errors.push(`LEMO_UPSTREAM_STILLS_FRAME_MISSING: ${source}`);
      else receipt.frames.push({ time: options.times[index], path: join(finalDir, `frame-${index}-${options.times[index].toFixed(3)}.jpg`) });
    }
    receipt.technicalPassed = result.code === 0 && receipt.errors.length === 0;
    if (receipt.technicalPassed) {
      options.signal?.throwIfAborted();
      for (let index = 0; index < options.times.length; index++) {
        const source = join(outDir, `t_${String(options.times[index])}.jpg`);
        const target = join(finalDir, `frame-${index}-${options.times[index].toFixed(3)}.jpg`);
        await copyFile(source, target);
      }
      await writeFile(join(finalDir, 'review.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
      await writeFile(join(artifactRoot, 'review.json'), JSON.stringify({ version: 1, artifactDirectory: finalDir, receiptPath: join(finalDir, 'review.json'), logPath: receipt.logPath, frames: receipt.frames }, null, 2) + '\n', 'utf8');
    }
  } catch (caught) {
    receipt.technicalPassed = false;
    receipt.frames = [];
    receipt.errors.push(caught instanceof Error ? caught.message : String(caught));
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
  if (!receipt.technicalPassed) {
    await mkdir(finalDir, { recursive: true }).catch(() => {});
    await writeFile(join(finalDir, 'review.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8').catch(() => {});
    await writeFile(join(artifactRoot, 'review.json'), JSON.stringify({ version: 1, artifactDirectory: finalDir, receiptPath: join(finalDir, 'review.json'), logPath: receipt.logPath }, null, 2) + '\n', 'utf8').catch(() => {});
  }
  options.signal?.throwIfAborted();
  return receipt;
}

export const lemoUpstreamStillsInternals = { validate };
