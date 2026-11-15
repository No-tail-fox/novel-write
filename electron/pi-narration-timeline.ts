import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, extname, dirname } from 'node:path';
import { parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { ProductionAssetVersion } from '../src/shared/production-workflow';
import { materializeProductionAudioClipsForShot } from '../src/shared/production-audio';
import { lemoReservedWindows, lemoLockedShotIds } from '../src/shared/lemo-locked-shots';
import { planNarrationPauses, narrationPauseChangeDecision, type NarrationPause, type NarrationPauseBase } from '../src/shared/creative-animation/narration-pauses';

export interface PiNarrationCue { id: string; text: string; startMs: number; endMs: number; sentenceEnd: boolean }
export interface PiNarrationAudioSlice { path: string; startMs: number; sourceStartMs?: number; durationMs: number }
export interface StagePiNarrationTimelineInput {
  document: EditorialCollagePipelineData;
  /** Trusted host resolver: resolve saved voice records/media URLs here, never in agent code. */
  resolveAudioPath: (asset: ProductionAssetVersion, document: EditorialCollagePipelineData) => string | Promise<string>;
  /** Host-owned read-only material directory. Never grant the agent filesystem write access here. */
  outputDirectory: string;
  /** Private host state, outside the agent's workspace and output directory. One directory per run. */
  stateRoot: string;
  allowNarrationPauses: boolean;
  targetDurationSeconds: number;
  musicMv?: boolean;
}
export interface PiNarrationTimelineResult {
  baselineHash: string; documentHash: string; durationMs: number; cues: PiNarrationCue[]; audioSlices: PiNarrationAudioSlice[];
  materials: { assetVersionId: string; path: string; sha256: string }[];
  lockedWindows: NarrationPauseBase['lockedWindows']; pauses: NarrationPause[]; acceptedChanges: number;
  baselinePath: string; timelinePath: string;
  integration: { status: 'original-document-compatible' | 'external-timeline-required'; reason: string };
}
interface Baseline {
  version: 1; documentHash: string; outputDirectory: string; base: NarrationPauseBase;
  cues: PiNarrationCue[]; audioSlices: PiNarrationAudioSlice[];
  materials: PiNarrationTimelineResult['materials'];
}
interface Receipt { baselineHash: string; pauses: NarrationPause[]; acceptedChanges: number }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
// Bind media and authored timing, not mutable production progress/checkpoints.
const narrationDocumentHash = (document: EditorialCollagePipelineData) => hash(canonical({
  title: document.title, sourceText: document.sourceText, beats: document.beats,
  assets: document.assets.filter(asset => asset.kind === 'audio'), timeline: document.timeline,
  lockedShotIds: document.productionRun?.settings.lockedShotIds ?? document.productionSettings?.lockedShotIds,
}));
const contains = (parent: string, child: string) => { const r = relative(parent, child); return !r || (!r.startsWith('..') && !isAbsolute(r)); };
const queues = new Map<string, Promise<unknown>>();
async function serialized<T>(root: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(root), previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(work); queues.set(key, pending);
  try { return await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
}
async function directory(path: string) {
  if (!isAbsolute(path)) throw new Error('PI_NARRATION_ABSOLUTE_DIRECTORY_REQUIRED');
  await mkdir(path, { recursive: true });
  for (let cursor = resolve(path);;) {
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('PI_NARRATION_UNSAFE_DIRECTORY');
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return realpath(path);
}
async function immutable(path: string, bytes: string | Buffer) {
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o444 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if ((await lstat(path)).isSymbolicLink() || hash(await readFile(path)) !== hash(bytes)) throw new Error('PI_NARRATION_IMMUTABLE_MISMATCH');
  }
}
async function commit(path: string, data: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, canonical(data), { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
/** Match punctuation in the original source as well as visible cue punctuation; wrapping is not an attestation. */
function attest(cues: { id: string; text: string; startMs: number; endMs: number }[], source: string): PiNarrationCue[] {
  const letters: string[] = [], offsets: number[] = [];
  for (let i = 0; i < source.length; i++) if (/[\p{L}\p{N}]/u.test(source[i])) { letters.push(source[i]); offsets.push(i); }
  const plain = letters.join(''); let cursor = 0;
  return cues.map(cue => {
    const text = cue.text.replace(/[^\p{L}\p{N}]/gu, '');
    const index = text ? plain.indexOf(text, cursor) : -1;
    let sourceEnd = false;
    if (index >= 0) {
      const end = index + text.length; cursor = end;
      const suffix = source.slice(offsets[end - 1] + 1, offsets[end] ?? source.length);
      sourceEnd = /^[\s”’"'）)\]】]*[。！？.!?]/u.test(suffix);
    }
    return { ...cue, sentenceEnd: /[。！？.!?][\s”’"'）)\]】]*$/u.test(cue.text) || sourceEnd };
  });
}
function result(baseline: Baseline, receipt: Receipt, stateRoot: string): PiNarrationTimelineResult {
  const plan = planNarrationPauses({ ...baseline.base, allowed: true, musicMv: false }, receipt.pauses);
  const shift = (at: number) => plan.insertions.filter(i => i.atMs <= at).reduce((sum, i) => sum + i.durationMs, 0);
  const audioSlices = baseline.audioSlices.flatMap(slice => {
    const end = slice.startMs + slice.durationMs;
    const cuts = [slice.startMs, ...plan.insertions.filter(i => i.atMs > slice.startMs && i.atMs < end).map(i => i.atMs), end];
    return cuts.slice(0, -1).map((start, index) => ({ path: slice.path, startMs: start + shift(start), sourceStartMs: (slice.sourceStartMs ?? 0) + start - slice.startMs, durationMs: cuts[index + 1] - start }));
  });
  return { baselineHash: receipt.baselineHash, documentHash: baseline.documentHash, materials: baseline.materials, durationMs: plan.durationMs,
    cues: baseline.cues.map((cue, index) => ({ ...cue, startMs: plan.cues[index].startMs, endMs: plan.cues[index].endMs })),
    audioSlices, lockedWindows: baseline.base.lockedWindows, pauses: receipt.pauses, acceptedChanges: receipt.acceptedChanges,
    baselinePath: join(stateRoot, 'baseline.json'), timelinePath: join(stateRoot, 'current-timeline.json'),
    integration: plan.addedDurationMs ? { status: 'external-timeline-required', reason: 'Production shot and beat durations constrain cues. Consume these absolute cues and audio slices with the new film duration; the original document and locked visuals are unchanged.' }
      : { status: 'original-document-compatible', reason: 'The original document remains unchanged.' } };
}
async function load(stateRoot: string) {
  const root = await directory(stateRoot);
  const baseline = JSON.parse(await readFile(join(root, 'baseline.json'), 'utf8')) as Baseline;
  const receipt = JSON.parse(await readFile(join(root, 'current-timeline.json'), 'utf8')) as Receipt;
  if (hash(canonical(baseline)) !== receipt.baselineHash) throw new Error('PI_NARRATION_BASELINE_MISMATCH');
  await directory(baseline.outputDirectory);
  for (const material of baseline.materials) {
    if (!contains(baseline.outputDirectory, material.path) || (await lstat(material.path)).isSymbolicLink() || hash(await readFile(material.path)) !== material.sha256) throw new Error('PI_NARRATION_MATERIAL_MISMATCH');
  }
  return { root, baseline, receipt };
}
/** Stage only existing local speech; this module has no generation/provider dependency. */
export async function stagePiNarrationTimeline(input: StagePiNarrationTimelineInput): Promise<PiNarrationTimelineResult> {
  return serialized(input.stateRoot, async () => {
    const root = await directory(input.stateRoot), outputDirectory = await directory(input.outputDirectory);
    if (contains(root, outputDirectory) || contains(outputDirectory, root)) throw new Error('PI_NARRATION_STATE_MUST_BE_PRIVATE');
    const document = parseEditorialCollagePipelineData(input.document);
    const documentHash = narrationDocumentHash(document);
    const exists = await lstat(join(root, 'baseline.json')).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
    if (exists) {
      const saved = await load(root);
      if (saved.baseline.documentHash !== documentHash || saved.baseline.outputDirectory !== outputDirectory
        || saved.baseline.base.allowed !== input.allowNarrationPauses || saved.baseline.base.musicMv !== !!input.musicMv
        || saved.baseline.base.targetDurationSeconds !== input.targetDurationSeconds) throw new Error('PI_NARRATION_BASELINE_INPUT_CHANGED');
      return result(saved.baseline, saved.receipt, root);
    }
    if (!document.timeline) throw new Error('PI_NARRATION_TIMELINE_REQUIRED');
    const locked = new Set(lemoLockedShotIds(document));
    const shots = document.beats.flatMap(beat => beat.shots);
    const speech = shots.flatMap(shot => materializeProductionAudioClipsForShot(document.timeline, shot))
      .filter(clip => ['narration', 'dialogue'].includes(clip.trackType) && !clip.muted
        && (document.productionRun?.settings.narration !== false || locked.has(clip.shotId ?? '')));
    const materials: Baseline['materials'] = [], audioSlices: PiNarrationAudioSlice[] = [];
    const paths = new Map<string, string>();
    for (const clip of speech) {
      const asset = document.assets.find(a => a.id === clip.assetVersionId && a.kind === 'audio');
      if (!asset) throw new Error('PI_NARRATION_AUDIO_ASSET_MISSING');
      let path = paths.get(asset.id);
      if (!path) {
        const source = await input.resolveAudioPath(asset, document);
        if (!isAbsolute(source) || !(await lstat(source)).isFile()) throw new Error('PI_NARRATION_LOCAL_AUDIO_REQUIRED');
        const bytes = await readFile(source), sha256 = hash(bytes);
        if (!bytes.length) throw new Error('PI_NARRATION_EMPTY_AUDIO');
        const extension = extname(source).toLowerCase();
        if (!/^\.(wav|mp3|m4a|aac|ogg|flac|opus|webm)$/u.test(extension)) throw new Error('PI_NARRATION_AUDIO_EXTENSION');
        path = join(outputDirectory, `${sha256}${extension}`); await immutable(path, bytes);
        paths.set(asset.id, path); materials.push({ assetVersionId: asset.id, path, sha256 });
      }
      if (clip.gainDb || clip.fadeInMs || clip.fadeOutMs || clip.fadeEnvelope) throw new Error('PI_NARRATION_AUDIO_ENVELOPE_UNSUPPORTED');
      const sourceStartMs = clip.sourceStartMs ?? 0;
      const available = clip.sourceMediaDurationMs ?? asset.durationMs;
      const durationMs = Math.min(clip.durationMs!, clip.sourceDurationMs ?? Infinity, available === undefined ? Infinity : available - sourceStartMs);
      if (![clip.startMs, sourceStartMs, durationMs].every(Number.isSafeInteger) || sourceStartMs < 0 || durationMs < 0) throw new Error('PI_NARRATION_AUDIO_TIMING_INVALID');
      if (durationMs) audioSlices.push({ path, startMs: clip.startMs, sourceStartMs, durationMs });
    }
    const voiced = new Set(speech.map(clip => clip.shotId));
    const cueIds = new Set(shots.filter(shot => voiced.has(shot.id)).flatMap(shot => shot.subtitleCueIds));
    const cues = attest(document.beats.flatMap(beat => beat.subtitleCues).filter(cue => cueIds.has(cue.id)).sort((a, b) => a.startMs - b.startMs), document.sourceText ?? '');
    const base: NarrationPauseBase = { durationMs: document.timeline.durationMs, cues, lockedWindows: lemoReservedWindows(document) ?? [], allowed: input.allowNarrationPauses, musicMv: !!input.musicMv, targetDurationSeconds: input.targetDurationSeconds };
    planNarrationPauses({ ...base, allowed: true, musicMv: false }, []);
    const baseline: Baseline = { version: 1, documentHash, outputDirectory, base, cues, audioSlices, materials };
    const receipt: Receipt = { baselineHash: hash(canonical(baseline)), pauses: [], acceptedChanges: 0 };
    await immutable(join(root, 'baseline.json'), canonical(baseline));
    const current = result(baseline, receipt, root);
    await commit(join(root, 'current-timeline.json'), current);
    return current;
  });
}
/** A request replaces the complete pause set. Retries/reordering never accumulate silence or changes. */
export async function requestPiNarrationPauses(input: { stateRoot: string; document: EditorialCollagePipelineData; requested: unknown }): Promise<PiNarrationTimelineResult> {
  return serialized(input.stateRoot, async () => {
    const { root, baseline, receipt } = await load(input.stateRoot);
    if (narrationDocumentHash(parseEditorialCollagePipelineData(input.document)) !== baseline.documentHash) throw new Error('PI_NARRATION_BASELINE_INPUT_CHANGED');
    const plan = planNarrationPauses(baseline.base, input.requested);
    const decision = narrationPauseChangeDecision(receipt.pauses, plan.pauses, receipt.acceptedChanges);
    const next = result(baseline, { baselineHash: receipt.baselineHash, pauses: plan.pauses, acceptedChanges: receipt.acceptedChanges + (decision === 'apply' ? 1 : 0) }, root);
    if (decision === 'apply') await commit(join(root, 'current-timeline.json'), next);
    return next;
  });
}
