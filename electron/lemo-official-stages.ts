import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { editorialLayerPrompt } from '../src/shared/editorial-motion';
import { LemoStageStore } from '../services/lemo-agent-worker/stage-store';
import { LemoRequestLedger } from '../services/lemo-agent-worker/request-ledger';
import { rejectLedgerLinks } from '../services/lemo-agent-worker/ledger-owner';
import { prepareLemoStateDirectory } from '../services/lemo-agent-worker/paths';
import { lemoSessionFingerprints, runOfficialLemoAgentSession, type OfficialLemoSessionOptions } from './lemo-agent-session-runtime';
import { openLemoExecutionBudget } from './lemo-execution-budget';
import { openLemoNativeBudget } from './lemo-native-budget';

export const officialStageHash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export async function readOfficialStageFile(path: string, maximum = 1024 * 1024) {
  await rejectLedgerLinks(path); const s = await lstat(path);
  if (!s.isFile() || s.nlink !== 1 || s.size < 1 || s.size > maximum) throw new Error('LEMO_CREATIVE_STAGE_FILE');
  return readFile(path);
}
export async function writeOfficialStageJson(path: string, value: unknown) {
  await rejectLedgerLinks(path); await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' }); await rename(temporary, path);
}
export function officialTreatmentInput(d: EditorialCollagePipelineData) {
  const settings = d.productionRun!.settings;
  return { version: 1, title: d.title, source: d.sourceText, ratio: d.ratio, authoring: settings.authoring, preset: settings.presetId, data: settings.data, archives: settings.archives,
    shotIds: [...new Set(d.beats.flatMap(b => b.shots.map(s => s.narrationSplit?.sourceShotId ?? s.id)))] };
}
export function officialVoiceLockInput(d: EditorialCollagePipelineData) {
  const voices = new Set(d.beats.flatMap(b => b.shots.map(s => s.voiceAssetVersionId)).filter(Boolean));
  return { version: 1, narration: d.productionRun!.settings.narration, durationMs: d.timeline?.durationMs, cues: d.beats.flatMap(b => b.subtitleCues),
    clips: d.timeline?.clips.map(c => ({ shotId: c.shotId, startMs: c.startMs, durationMs: c.durationMs })),
    voices: d.assets.filter(a => voices.has(a.id)).map(a => ({ id: a.id, path: a.localPath, sha256: a.sha256, durationMs: a.durationMs })) };
}
export async function ensureOfficialCreativeWorkflow(root: string, runId: string, session: Pick<OfficialLemoSessionOptions, 'maxRequests' | 'timeoutMs' | 'maxEstimatedCostUsd'> & Partial<Pick<OfficialLemoSessionOptions, 'provider' | 'maxOutputTokens'>>) {
  const path = join(root, 'creative-workflow.json');
  if (!existsSync(path)) {
    if (existsSync(join(root, 'ledger', 'requests.jsonl')) || existsSync(join(root, 'execution-intent.json'))) throw new Error('LEMO_CREATIVE_WORKFLOW_RECEIPT_MISSING');
    await writeOfficialStageJson(path, { version: 1, runId, ledgerInitialized: false });
  }
  const state = JSON.parse((await readOfficialStageFile(path, 8192)).toString('utf8'));
  if (state.version !== 1 || state.runId !== runId || typeof state.ledgerInitialized !== 'boolean') throw new Error('LEMO_CREATIVE_WORKFLOW_IDENTITY');
  const ledger = await LemoRequestLedger.open(join(root, 'ledger'), session.maxRequests, { existingOnly: state.ledgerInitialized });
  try {
    if (ledger.summary().blocked) throw new Error('LEMO_LEDGER_BLOCKED');
    if (session.provider && session.provider.protocol !== 'anthropic') await openLemoNativeBudget(root, { protocol: session.provider.protocol,
      timeoutMs: session.timeoutMs, maxRequests: session.maxRequests, maxOutputTokens: session.maxOutputTokens! }, state.ledgerInitialized);
    else if (session.maxEstimatedCostUsd !== undefined) await openLemoExecutionBudget(root,
      { timeoutMs: session.timeoutMs, maxEstimatedCostUsd: session.maxEstimatedCostUsd }, state.ledgerInitialized);
  } finally { await ledger.close(); }
  if (!state.ledgerInitialized) await writeOfficialStageJson(path, { ...state, ledgerInitialized: true });
}
export async function assertOfficialSharedLedger(root: string, maxRequests: number) {
  const ledger = await LemoRequestLedger.open(join(root, 'ledger'), maxRequests, { existingOnly: true });
  try { if (ledger.summary().blocked) throw new Error('LEMO_LEDGER_BLOCKED'); } finally { await ledger.close(); }
}
/** Each mandatory stage gets one review; subsequent reviews and selected-shot repair sessions share one run allowance. */
export async function officialRepairBudgetUsage(executionRoot: string, currentRoot: string, runId: string, repairIds: string[]) {
  if (repairIds.some(id => !/^official-repair:[a-f0-9-]{36}$/.test(id))) throw new Error('LEMO_REPAIR_NODE_REQUIRED');
  const roots = [executionRoot, join(executionRoot, 'stages', 'style-frame'), ...repairIds.map(id => join(executionRoot, 'stages', id.replace(':', '-')))];
  let otherReviewRounds = 0;
  for (const root of roots) {
    const path = join(root, 'stage', 'stage.json'); if (root === currentRoot || !existsSync(path)) continue;
    const saved = JSON.parse((await readOfficialStageFile(path, 4 * 1024 * 1024)).toString('utf8'));
    if (saved.version !== 1 || saved.runId !== runId || !Array.isArray(saved.toolEvents) || saved.toolEvents.length > 5000
      || saved.toolEvents.some((e: { tool?: unknown; phase?: unknown }) => !e || typeof e.tool !== 'string' || !['started', 'completed', 'failed'].includes(String(e.phase)))) throw new Error('LEMO_REPAIR_BUDGET_RECEIPT');
    otherReviewRounds += Math.max(0, saved.toolEvents.filter((e: { tool: string; phase: string }) => e.tool === 'mcp__storydream_film__review_film' && e.phase === 'started').length - 1);
  }
  return { otherReviewRounds, repairSessions: repairIds.length };
}
const planSchema = z.object({ version: z.literal(1), shots: z.array(z.object({ id: z.string().min(1), title: z.string().min(1).max(80), scenePrompt: z.string().min(20).max(5000) }).strict()).min(1).max(500) }).strict();
type StageOptions = { executionRoot: string; upstreamRoot: string; session: Omit<OfficialLemoSessionOptions, 'action' | 'runRoot' | 'upstreamRoot' | 'runId' | 'stageId' | 'prompt'> };
export async function officialTreatment(d: EditorialCollagePipelineData, options: StageOptions, create: boolean, signal?: AbortSignal) {
  const input = officialTreatmentInput(d), root = join(options.executionRoot, 'stages', 'treatment'), project = join(root, 'sdk-state', 'project');
  const inputPath = join(root, 'inputs.json');
  if (!create && !existsSync(inputPath)) return;
  await ensureOfficialCreativeWorkflow(options.executionRoot, d.productionRun!.id, options.session);
  if (create) await prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: root, upstreamRoot: options.upstreamRoot }, 'sdk-state');
  const prompt = ['STORYDREAM_CREATIVE_STAGE=treatment',
    'Use the fixed original Lemo creative skill. Produce a real treatment for the supplied approved source and style. Do not render or generate audio in this planning stage.',
    'Write TREATMENT.md (at least 160 characters) explaining thesis, narrative structure, visual metaphors, composition, movement and style continuity.',
    'Also write SHOT_PLAN.json: {"version":1,"shots":[{"id":"exact supplied shot ID","title":"short title","scenePrompt":"specific visual direction, at least 20 characters"}]}. Include each supplied shot ID exactly once. Never rewrite narration or request additional paid services.',
    'The host validates and locks these artifacts before preparing images, a real style sample, measured narration and full film authoring.',
    'STORYDREAM_TREATMENT_CONTEXT=' + JSON.stringify(input)].join('\n');
  const session: OfficialLemoSessionOptions = { ...options.session, executionRoot: options.executionRoot, upstreamRoot: options.upstreamRoot, runRoot: root,
    runId: d.productionRun!.id, stageId: 'treatment', action: 'start', prompt };
  const inputHash = officialStageHash(JSON.stringify(input));
  if (existsSync(inputPath)) { const saved = JSON.parse((await readOfficialStageFile(inputPath, 8192)).toString('utf8')); if (saved.inputHash !== inputHash) throw new Error('LEMO_TREATMENT_INPUT_CHANGED'); }
  else { if (existsSync(join(root, 'stage', 'stage.json'))) throw new Error('LEMO_TREATMENT_INPUT_RECEIPT_MISSING'); await writeOfficialStageJson(inputPath, { inputHash }); }
  if (existsSync(join(root, 'execution-intent.json')) && (!existsSync(join(root, 'stage', 'stage.json')) || !existsSync(join(root, 'stage', 'stage-identity.json')))) throw new Error('LEMO_OFFICIAL_STAGE_RECEIPT_MISSING');
  const snapshot = async () => { const store = await LemoStageStore.open({ directory: join(root, 'stage'), projectDirectory: project, runId: session.runId, stageId: session.stageId, ...lemoSessionFingerprints(session) }); try { return store.snapshot(); } finally { await store.close(); } };
  let state = await snapshot();
  if (state.status === 'unknown' || state.pendingToolOperations) throw new Error('LEMO_OFFICIAL_STAGE_UNKNOWN');
  if (state.status !== 'completed') {
    if (!create) return;
    await writeOfficialStageJson(join(root, 'execution-intent.json'), { version: 1, runId: session.runId, ...lemoSessionFingerprints(session) });
    const result = await runOfficialLemoAgentSession({ ...session, action: state.attempt ? 'resume' : 'start', signal });
    await writeOfficialStageJson(join(root, 'session-receipt.json'), result);
    if (result.receipt.status !== 'completed') throw new Error('LEMO_OFFICIAL_SESSION_' + result.receipt.status.toUpperCase());
    state = await snapshot();
  }
  await assertOfficialSharedLedger(options.executionRoot, options.session.maxRequests);
  if (state.status !== 'completed' || state.pendingToolOperations) throw new Error('LEMO_TREATMENT_NOT_READY');
  const artifacts = await Promise.all(['TREATMENT.md', 'SHOT_PLAN.json'].map(async path => { const bytes = await readOfficialStageFile(join(project, path), 256 * 1024); const saved = state.artifacts.find(a => a.path === path); if (!saved || saved.sha256 !== officialStageHash(bytes) || saved.byteLength !== bytes.length) throw new Error('LEMO_TREATMENT_ARTIFACT_CHANGED'); return bytes; }));
  if (artifacts[0].toString('utf8').trim().length < 160) throw new Error('LEMO_TREATMENT_CONTENT_REQUIRED');
  const plan = planSchema.parse(JSON.parse(artifacts[1].toString('utf8')));
  if (plan.shots.length !== input.shotIds.length || new Set(plan.shots.map(s => s.id)).size !== input.shotIds.length || plan.shots.some(s => !input.shotIds.includes(s.id))) throw new Error('LEMO_TREATMENT_SHOT_IDS');
  return { ...d, beats: d.beats.map(b => ({ ...b, shots: b.shots.map(s => { const p = plan.shots.find(p => p.id === (s.narrationSplit?.sourceShotId ?? s.id))!;
    return { ...s, title: p.title, scenePrompt: p.scenePrompt, layers: s.layers.map(l => l.content ? l : { ...l, prompt: editorialLayerPrompt(l.kind, p.scenePrompt) }) }; }) })) };
}
export async function officialVoiceLock(d: EditorialCollagePipelineData, root: string, create: boolean) {
  const input = officialVoiceLockInput(d);
  if (!input.durationMs || input.durationMs <= 0) throw new Error('LEMO_VOICE_LOCK_TIMING');
  if (input.narration && d.beats.some(b => b.shots.some(s => b.subtitleCues.some(c => s.subtitleCueIds.includes(c.id) && /[\p{L}\p{N}]/u.test(c.text))
    && !d.assets.some(a => a.id === s.voiceAssetVersionId && a.kind === 'audio' && a.localPath && (a.durationMs ?? 0) > 0)))) throw new Error('LEMO_VOICE_LOCK_AUDIO_REQUIRED');
  const voices = await Promise.all(input.voices.map(async v => { if (!v.path || !v.durationMs || v.durationMs <= 0) throw new Error('LEMO_VOICE_LOCK_AUDIO');
    const bytes = await readOfficialStageFile(v.path, 512 * 1024 * 1024); const sha256 = officialStageHash(bytes); if (v.sha256 && v.sha256 !== sha256) throw new Error('LEMO_VOICE_LOCK_AUDIO_CHANGED'); return { ...v, sha256, bytes: bytes.length }; }));
  if (input.narration && !voices.length && input.cues.some(c => /[\p{L}\p{N}]/u.test(c.text))) throw new Error('LEMO_VOICE_LOCK_AUDIO_REQUIRED');
  const manifest = { version: 1, inputHash: officialStageHash(JSON.stringify(input)), voices, durationMs: input.durationMs };
  const path = join(root, 'stages', 'voice-lock.json');
  if (existsSync(path)) { const saved = JSON.parse((await readOfficialStageFile(path)).toString('utf8')); if (JSON.stringify(saved) !== JSON.stringify(manifest)) throw new Error('LEMO_VOICE_LOCK_CHANGED'); }
  else if (create) await writeOfficialStageJson(path, manifest); else return;
  return d;
}
