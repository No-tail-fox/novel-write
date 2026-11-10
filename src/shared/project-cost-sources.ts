import type { AppConfig } from './types';
import { llmUsageTokens, type CostKind, type CostLedgerEntry, type CostOutcome, type ProjectCostImageEstimate } from './project-cost';

/**
 * U-5 / H-5: pure normalizers from each route's existing records into cost ledger rows.
 * Inputs are parsed JSON of unknown age, so every field is read defensively (old projects must load).
 * Nothing here can trigger a provider call.
 */

export interface CostModelHint { provider: string; model: string }
/** Model names from the project's runtime config, used where a record does not store the model. */
export interface CostModelHints { llm: CostModelHint; image: CostModelHint; tts: CostModelHint }

type Json = Record<string, unknown>;
const object = (value: unknown): Json | undefined => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined);
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const charCount = (value: string) => [...value.replace(/\s+/gu, '')].length;

export function projectCostModelHints(config: AppConfig): CostModelHints {
  const imageModel = config.imageProvider === 'jimeng' ? config.jimeng?.reqKey || config.jimeng?.model
    : config.imageProvider === 'custom' ? config.customImage?.model
      : config.gptImage?.model || config.image?.model;
  const tts = config.tts?.provider ?? '';
  const ttsModel = tts === 'minimax' ? config.tts?.minimax?.model : tts === 'volcengine' ? config.tts?.volcengine?.resourceId : '';
  return {
    llm: { provider: config.llm?.provider ?? '', model: config.llm?.model ?? '' },
    image: { provider: config.imageProvider ?? '', model: imageModel ?? '' },
    tts: { provider: tts, model: ttsModel ?? '' },
  };
}

const hintFor = (hints: CostModelHints, kind: CostKind): CostModelHint => (kind === 'llm' ? hints.llm : kind === 'image' ? hints.image : kind === 'tts' ? hints.tts : { provider: '', model: '' });

/** Which pipeline shape a task's `pipelineData` has (detected by shape; no schema parse). */
export function projectCostPipelineKind(data: unknown): 'html' | 'vox' | 'other' {
  const value = object(data);
  if (!value) return 'other';
  if (value.version === 2 && object(value.steps) && Array.isArray(value.assets) && Array.isArray(value.voices)) return 'html';
  if (Array.isArray(value.beats) && (object(value.productionRun) || Array.isArray(value.providerJobs))) return 'vox';
  return 'other';
}

function voxNodeKind(kind: string): CostKind {
  return kind === 'image' || kind === 'film-material' ? 'image' : kind === 'voice' ? 'tts' : 'llm';
}

function voxNodeOutcome(node: Json): CostOutcome | undefined {
  const status = text(node.status);
  if (status === 'completed') return 'received';
  if (status === 'running' || status === 'unknown') return 'unknown';
  if (status !== 'failed') return undefined; // pending: nothing sent yet
  // A failed node whose response arrived (e.g. a parse failure after a 200) was still billed.
  if (node.resultReceived === true || object(node.llmResponse)) return 'received';
  return /LLM_NOT_SUBMITTED|NOT_SUBMITTED|not-sent/u.test(text(node.error)) ? 'not-sent' : 'rejected';
}

/**
 * VOX / Lemo production journal (pipelineData.productionRun) + director video jobs (providerJobs).
 * `lemoTurnsCounted`: Lemo v3 agent turns are counted from their turn receipts instead of the graph nodes.
 */
export function costEntriesFromVoxDocument(data: unknown, hints: CostModelHints, options: { lemoTurnsCounted?: boolean } = {}): CostLedgerEntry[] {
  const document = object(data);
  if (!document) return [];
  const entries: CostLedgerEntry[] = [];
  const run = object(document.productionRun);
  const narration = new Map<string, string>();
  const cues = new Map<string, string>();
  for (const beat of array(document.beats)) for (const cue of array(object(beat)?.subtitleCues)) cues.set(text(object(cue)?.id), text(object(cue)?.text));
  for (const beat of array(document.beats)) for (const shot of array(object(beat)?.shots)) {
    const value = object(shot);
    if (value) narration.set(text(value.id), array(value.subtitleCueIds).map((id) => cues.get(text(id)) ?? '').join(''));
  }
  for (const raw of array(run?.nodes)) {
    const node = object(raw);
    if (!node || node.paid !== true) continue;
    if (options.lemoTurnsCounted && text(node.id).startsWith('upstream-turn:')) continue;
    const outcome = voxNodeOutcome(node);
    if (!outcome) continue;
    const kind = voxNodeKind(text(node.kind));
    const hint = hintFor(hints, kind);
    const usage = object(object(node.llmResponse)?.usage);
    const characters = kind === 'tts' ? charCount(narration.get(text(node.shotId)) ?? '') : 0;
    entries.push({ kind, ...hint, outcome, at: text(run?.updatedAt), source: `vox-node:${text(node.kind)}`,
      ...(llmUsageTokens(usage) ?? {}), ...(characters ? { characters } : {}), ...(kind === 'image' ? { images: 1 } : {}) });
  }
  for (const raw of array(document.providerJobs)) {
    const job = object(raw);
    if (!job || text(job.capability) !== 'image-to-video') continue;
    const status = text(job.status);
    const outcome: CostOutcome | undefined = status === 'completed' ? 'received' : status === 'running' ? 'unknown'
      : status === 'failed' || status === 'cancelled' ? (job.remoteTaskId ? 'unknown' : 'rejected') : undefined;
    if (!outcome) continue;
    entries.push({ kind: 'video', provider: text(job.providerId), model: text(job.model), outcome, at: text(job.updatedAt), source: 'provider-job' });
  }
  return entries;
}

/** Evidence of one Lemo v3 agent turn directory (`vox-production/lemo-agent/<runId>/turn-NNNN`). */
export interface LemoTurnEvidence {
  runId: string;
  turn: number;
  at: string;
  submitted: boolean;
  submittedRequestId?: string;
  response?: { usage?: Record<string, unknown> };
  rejected?: { reason?: string; requestId?: string };
  interrupted: boolean;
  /** `rejected-submission-*.json`: earlier submissions the provider refused / the user confirmed produced nothing. */
  rejectedSubmissions: number;
  image?: { status?: string };
  /** `image-abandoned-*.json`: the user confirmed with the provider that the request produced nothing. */
  abandonedImages: number;
}

export function costEntriesFromLemoTurns(turns: readonly LemoTurnEvidence[], hints: CostModelHints): CostLedgerEntry[] {
  const entries: CostLedgerEntry[] = [];
  const llm = (outcome: CostOutcome, turn: LemoTurnEvidence, usage?: Record<string, unknown>) =>
    entries.push({ kind: 'llm', ...hints.llm, outcome, at: turn.at, source: 'lemo-turn', ...(llmUsageTokens(usage) ?? {}) });
  const image = (outcome: CostOutcome, turn: LemoTurnEvidence) => entries.push({ kind: 'image', ...hints.image, outcome, images: 1, at: turn.at, source: 'lemo-image' });
  for (const turn of turns) {
    for (let index = 0; index < turn.rejectedSubmissions; index += 1) llm('rejected', turn);
    // rejected.json may belong to an earlier (renamed) submission; it only settles the current one when the ids match.
    const rejectedCurrent = turn.rejected && (!turn.submitted || !turn.rejected.requestId || !turn.submittedRequestId || turn.rejected.requestId === turn.submittedRequestId);
    if (turn.response) llm('received', turn, object(turn.response.usage));
    else if (rejectedCurrent) llm(turn.rejected!.reason === 'local-authorization-before-dispatch' ? 'not-sent' : 'rejected', turn);
    else if (turn.submitted) llm('unknown', turn); // interrupted or crashed mid-request: possibly billed
    for (let index = 0; index < turn.abandonedImages; index += 1) image('rejected', turn);
    const status = turn.image?.status;
    if (status === 'received') image('received', turn);
    else if (status === 'rejected') image('rejected', turn);
    else if (status === 'submitted' || status === 'skipped') image('unknown', turn);
  }
  return entries;
}

/** Marker in the file name of an image reused for an identical prompt in the same run (H-5 dedupe). */
export const HTML_REUSED_IMAGE_MARKER = '.reuse-';
export function htmlAssetPromptKey(kind: string, prompt: string): string {
  return `${kind}\u0000${prompt.trim().replace(/\s+/gu, ' ')}`;
}

/** HTML route pipeline state: every stored asset / voice clip is one received provider result. */
export function costEntriesFromHtmlPipeline(data: unknown, hints: CostModelHints): CostLedgerEntry[] {
  const state = object(data);
  if (!state) return [];
  const entries: CostLedgerEntry[] = [];
  const at = text(object(object(state.steps)?.assets)?.completedAt) || '';
  for (const raw of array(state.assets)) {
    const asset = object(raw);
    if (!asset || text(asset.src).includes(HTML_REUSED_IMAGE_MARKER)) continue;
    entries.push({ kind: 'image', ...hints.image, outcome: 'received', images: 1, at, source: `html-asset:${text(asset.kind)}` });
  }
  if (text(object(state.coverAsset)?.mode) === 'auto') entries.push({ kind: 'image', ...hints.image, outcome: 'received', images: 1, at: text(object(state.coverAsset)?.createdAt), source: 'html-cover' });
  for (const raw of array(state.voices)) {
    const voice = object(raw);
    if (!voice) continue;
    const characters = charCount(text(voice.text));
    entries.push({ kind: 'tts', ...hints.tts, outcome: 'received', at, source: 'html-voice', ...(characters ? { characters } : {}) });
  }
  return entries;
}

/** Template route: one stored provider output file = one received call (regenerations overwrite → lower bound). */
export function costEntriesFromProviderFiles(files: { images: number; audio: number; at: string }, hints: CostModelHints): CostLedgerEntry[] {
  return [
    ...Array.from({ length: files.images }, (): CostLedgerEntry => ({ kind: 'image', ...hints.image, outcome: 'received', images: 1, at: files.at, source: 'provider-images' })),
    ...Array.from({ length: files.audio }, (): CostLedgerEntry => ({ kind: 'tts', ...hints.tts, outcome: 'received', at: files.at, source: 'provider-audio' })),
  ];
}

/** H-5: images the current plan will request, so the user sees it before starting. */
export function expectedProjectImages(task: { storyboardSceneCount?: number; targetScenes?: number }, data: unknown, maxAgentImages?: number): ProjectCostImageEstimate | undefined {
  const kind = projectCostPipelineKind(data);
  const value = object(data);
  if (kind === 'html' && value) {
    const scenes = array(value.scenes).map(object).filter((scene): scene is Json => Boolean(scene));
    if (!scenes.length) return undefined;
    const config = object(value.config) ?? {};
    const keys: string[] = [];
    for (const scene of scenes) {
      keys.push(htmlAssetPromptKey('bg', text(object(scene.background)?.prompt)));
      if (config.foreground !== false) for (const element of array(scene.elements)) keys.push(htmlAssetPromptKey('fg', text(object(element)?.prompt)));
    }
    const cover = config.coverImageMode === 'auto' ? 1 : 0;
    const count = keys.length + cover, unique = new Set(keys).size + cover;
    return { count, unique, basis: 'plan', label: `预计生图 ${count} 张${unique < count ? `（相同提示词去重后 ${unique} 张）` : ''}` };
  }
  if (kind === 'vox' && value) {
    const run = object(value.productionRun);
    if (run?.authoringVersion === 3) {
      return maxAgentImages ? { count: maxAgentImages, basis: 'upper-bound', label: `最多生图 ${maxAgentImages} 张（Agent 插画上限）` } : { count: 0, basis: 'plan', label: '预计生图 0 张（未开启 Agent 插画）' };
    }
    const nodes = array(run?.nodes).map(object).filter((node): node is Json => Boolean(node) && node!.paid === true && voxNodeKind(text(node!.kind)) === 'image');
    if (!run) return undefined;
    return { count: nodes.length, basis: 'plan', label: `预计生图 ${nodes.length} 张` };
  }
  const scenes = task.storyboardSceneCount || task.targetScenes;
  return scenes && scenes > 0 ? { count: scenes, basis: 'plan', label: `预计生图 ${scenes} 张（每个分镜 1 张）` } : undefined;
}
