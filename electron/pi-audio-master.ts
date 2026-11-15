import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { lemoAudioMixSchema, type LemoAudioStemMetadata, type LemoAudioValidationInput } from '../src/shared/creative-animation/agent-audio';
import { resolveLemoUpstreamRenderRuntime, runProcess, type LemoUpstreamRenderRuntime } from './lemo-upstream-video';

const seconds = z.number().finite().nonnegative();
const interval = z.object({ t0: seconds, t1: seconds }).strict().refine(x => x.t1 > x.t0);
const requestSchema = z.object({
  durationSeconds: z.number().finite().positive().max(198),
  mix: lemoAudioMixSchema,
  stems: z.object({ music: z.string().min(1).optional(), ambience: z.string().min(1).optional(), sfx: z.string().min(1).optional() }).strict(),
  narration: z.array(z.object({ path: z.string().min(1), sourceStartSeconds: seconds, t0: seconds, t1: seconds,
    gainDb: z.number().finite().default(0) }).strict().refine(x => x.t1 > x.t0)).max(1000),
  /** Final timeline windows already approved by host pause planning. Never inserts time. */
  approvedPauses: z.array(interval).max(50),
}).strict();
export type PiAudioMasterRequest = z.input<typeof requestSchema>;
export interface PiAudioMasterResult {
  outputPath: string;
  premasterPath: string;
  metadataPath: string;
  stems: LemoAudioStemMetadata[];
  narration: Array<{ t0: number; t1: number }>;
  silenceMeasurements: NonNullable<LemoAudioValidationInput['silenceMeasurements']>;
  pauseMeasurements: Array<{ t0: number; t1: number; peakAmplitude: number; provenance: 'measured' }>;
  premaster: AudioMeasurement;
  master: AudioMeasurement;
  loudness: { integratedLufs: number | null; truePeakDbtp: number | null; targetLufs: -14; targetTruePeakDbtp: -1.2 };
  /** This mixer does not identify events in decoded SFX. */
  onsets: [];
}
export interface AudioMeasurement {
  durationSeconds: number; sampleRate: 48000; channels: 2; format: 'float32'; peakAmplitude: number; nonFiniteSamples: number;
}
export interface PiAudioMasterOptions {
  pythonRoot: string;
  outputDir: string;
  /** Host-owned installed script location, never supplied by agent tool arguments. */
  trustedScriptPath?: string;
  runtime?: Pick<LemoUpstreamRenderRuntime, 'ffmpegPath'>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Trusted host entry point: data-only JSON, isolated Python, no shell or agent source. Each call
 * publishes into a unique directory; failure removes only that directory. All times are final. */
export async function masterPiAudio(input: PiAudioMasterRequest, options: PiAudioMasterOptions): Promise<PiAudioMasterResult> {
  const request = requestSchema.parse(input); // clone: caller mutations cannot change the job
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('AUDIO_TIMEOUT_INVALID');
  options.signal?.throwIfAborted();
  const names = Object.keys(request.stems);
  if (names.sort().join(',') !== Object.keys(request.mix.stems).sort().join(',')) throw new Error('AUDIO_STEMS_MISMATCH');
  for (const name of ['music', 'ambience'] as const) {
    if (request.mix.duck[name] !== undefined && !request.stems[name]) throw new Error('AUDIO_DUCK_ABSENT_STEM');
  }
  const intervals = [...request.narration, ...request.approvedPauses, ...request.mix.silences];
  if (intervals.some(x => x.t1 > request.durationSeconds)) throw new Error('AUDIO_TIMING_BOUNDS');
  for (const transition of request.mix.transitions) {
    if ((transition.kind === 'J' ? transition.at - transition.lead : transition.at) < 0
      || (transition.kind === 'L' ? transition.at + transition.tail : transition.at) > request.durationSeconds) throw new Error('AUDIO_TRANSITION_BOUNDS');
  }
  if (request.approvedPauses.some(p => request.narration.some(n => n.t0 < p.t1 && n.t1 > p.t0))) throw new Error('AUDIO_PAUSE_NARRATION_OVERLAP');
  for (const value of [...Object.values(request.mix.stems).map(x => x.gainDb), ...request.narration.map(x => x.gainDb)]) {
    if (Math.abs(value) > 120) throw new Error('AUDIO_GAIN_OUT_OF_RANGE');
  }
  for (const name of names as Array<keyof typeof request.stems>) request.stems[name] = resolve(request.stems[name]!);
  request.narration.forEach(x => { x.path = resolve(x.path); });
  for (const path of [...Object.values(request.stems), ...request.narration.map(x => x.path)]) {
    if (!(await stat(path)).isFile()) throw new Error('AUDIO_INPUT_NOT_FILE');
  }
  await mkdir(options.outputDir, { recursive: true });
  const runtime = options.runtime ?? await resolveLemoUpstreamRenderRuntime({ pythonRoot: options.pythonRoot, cacheDir: options.outputDir });
  const dir = await mkdtemp(join(resolve(options.outputDir), 'audio-master-'));
  try {
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ ...request, ffmpegPath: resolve(runtime.ffmpegPath), outputDir: dir }), 'utf8');
    const script = options.trustedScriptPath ?? fileURLToPath(new URL('../services/lemo-audio/master.py', import.meta.url));
    const result = await runProcess(join(resolve(options.pythonRoot), process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
      ['-I', '-B', resolve(script), '--config', configPath], { signal: options.signal, timeoutMs, tree: true, keep: 64 * 1024 });
    if (result.code !== 0) throw new Error(`AUDIO_MASTER_FAILED: ${result.stderr}`);
    return JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8')) as PiAudioMasterResult;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
