import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { listInstalledInstruments } from '../services/lemo-audio/starter-pack';
import { resolveLemoUpstreamRenderRuntime, runProcess } from './lemo-upstream-video';

const number = z.number().finite();
const timing = { time: number.min(0).max(198), duration: number.min(1 / 48000).max(198),
  gain: number.min(0).max(2).default(1), pan: number.min(-1).max(1).default(0) };
export const piScoreSchema = z.object({ version: z.literal(1), tracks: z.array(z.object({
  instrument: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  notes: z.array(z.object({ ...timing, midi: number.int().min(0).max(127), velocity: number.min(0).max(1) }).strict()).max(1000),
}).strict()).max(32) }).strict();
export const piFoleySchema = z.object({ version: z.literal(1), events: z.array(z.object({
  ...timing, preset: z.enum(['click', 'whoosh', 'impact', 'noise']),
}).strict()).max(256) }).strict();
const requestSchema = z.object({ durationSeconds: number.min(1 / 48000).max(198),
  score: piScoreSchema, foley: piFoleySchema }).strict();
export type PiScoreRequest = z.input<typeof requestSchema>;
export interface PiScoreResult {
  stems: { music: string; ambience: string; sfx: string };
  installedInstruments: string[];
  metadata: Array<{ stem: 'music' | 'ambience' | 'sfx'; durationSeconds: number; frames: number;
    sampleRate: 48000; channels: 2; format: 'float32'; peakAmplitude: number; nonFiniteSamples: 0 }>;
  /** Scheduling facts only, never presented as measured onset evidence. */
  events: Array<{ stem: 'music' | 'ambience' | 'sfx'; startFrame: number; endFrame: number; provenance: 'scheduled' }>;
}
export interface PiScoreOptions {
  pythonRoot: string;
  /** Installed/staged index and sample directory, controlled by the host. */
  instrumentsRoot: string;
  outputDir: string;
  trustedScriptPath?: string;
  runtime?: { ffmpegPath: string };
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Agent input is data only. All paths and executable choices belong exclusively to the host.
 * Reads installed index keys, not sampler.REG. Uses only bundled numpy and ffmpeg. */
export async function renderPiScore(input: PiScoreRequest, options: PiScoreOptions): Promise<PiScoreResult> {
  const request = requestSchema.parse(input);
  const notes = request.score.tracks.flatMap(t => t.notes);
  const events = [...notes, ...request.foley.events];
  if (notes.length > 1000 || events.reduce((n, e) => n + e.duration, 0) > 1800) throw new Error('SCORE_WORK_LIMIT');
  if (events.some(e => e.time + e.duration > request.durationSeconds + 1e-9)) throw new Error('SCORE_TIMING_BOUNDS');
  const installed = await listInstalledInstruments(options.instrumentsRoot);
  if (request.score.tracks.some(t => !installed.includes(t.instrument))) throw new Error('SCORE_INSTRUMENT_NOT_INSTALLED');
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180_000) throw new Error('SCORE_TIMEOUT_INVALID');
  options.signal?.throwIfAborted();
  await mkdir(options.outputDir, { recursive: true });
  const runtime = options.runtime ?? await resolveLemoUpstreamRenderRuntime({ pythonRoot: options.pythonRoot, cacheDir: options.outputDir });
  const dir = await mkdtemp(join(resolve(options.outputDir), 'score-render-'));
  try {
    await writeFile(join(dir, 'score.json'), JSON.stringify(request.score), 'utf8');
    await writeFile(join(dir, 'foley.json'), JSON.stringify(request.foley), 'utf8');
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ durationSeconds: request.durationSeconds,
      instrumentsRoot: resolve(options.instrumentsRoot), ffmpegPath: resolve(runtime.ffmpegPath), outputDir: dir }), 'utf8');
    const script = options.trustedScriptPath ?? fileURLToPath(new URL('../services/lemo-audio/render-score.py', import.meta.url));
    const result = await runProcess(join(resolve(options.pythonRoot), process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
      ['-I', '-B', resolve(script), '--config', configPath], { signal: options.signal, timeoutMs, tree: true, keep: 64 * 1024 });
    if (result.code !== 0) throw new Error(`SCORE_RENDER_FAILED: ${result.stderr}`);
    return JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8')) as PiScoreResult;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
