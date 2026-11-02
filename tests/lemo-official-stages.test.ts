import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nativeDocument, nativeOperations, nativeSettings } from './lemo-native.fixture';
import { buildLemoOfficialNodes } from '../src/shared/lemo-upstream-graph';
import { LemoStageStore } from '../services/lemo-agent-worker/stage-store';
import { LemoRequestLedger } from '../services/lemo-agent-worker/request-ledger';
import { lemoSessionFingerprints, type OfficialLemoSessionOptions } from '../electron/lemo-agent-session-runtime';
import { assertOfficialSharedLedger, ensureOfficialCreativeWorkflow, officialRepairBudgetUsage, officialStageHash, officialTreatment, officialTreatmentInput, officialVoiceLock } from '../electron/lemo-official-stages';
import { createVoxProductionRuntime } from '../electron/vox-production-runtime';

const calls = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('../electron/lemo-agent-session-runtime', async original => ({ ...await original<typeof import('../electron/lemo-agent-session-runtime')>(), runOfficialLemoAgentSession: calls.session }));
const roots: string[] = [];
beforeEach(() => { calls.session.mockReset(); });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(narration = false) {
  const base = resolve('.artifacts/lemo-stage-unit'); await mkdir(base, { recursive: true }); const root = await mkdtemp(join(base, 'stage-')); roots.push(root);
  const document = nativeDocument(), settings = nativeSettings({ narration });
  document.productionRun = { version: 1, id: randomUUID(), authoringVersion: 4, status: 'paused', settings, nodes: buildLemoOfficialNodes(document, settings), sourceHash: officialStageHash(document.sourceText!), runtimeIdentity: 'fixture', createdAt: document.createdAt, updatedAt: document.updatedAt };
  const options = { executionRoot: root, upstreamRoot: resolve('vendor/lemo-upstream'), session: { nodeExecutable: process.execPath, workerPath: resolve('services/lemo-agent-worker/dist/worker.mjs'),
    provider: { protocol: 'anthropic' as const, messagesUrl: 'https://fixture.invalid/v1/messages', apiKey: 'no-credential', auth: 'bearer' as const, model: 'fixture' }, maxOutputTokens: 1024, maxRequests: 12, maxTurns: 8, timeoutMs: 30000, requestTimeoutMs: 10000 } };
  return { root, document, options };
}
function completeTreatment(transform?: (plan: { version: number; shots: Array<{ id: string; title: string; scenePrompt: string }> }) => void) {
  calls.session.mockImplementation(async (options: OfficialLemoSessionOptions) => {
    const project = join(options.runRoot, 'sdk-state', 'project');
    const marker = options.prompt.split('\n').find(l => l.startsWith('STORYDREAM_TREATMENT_CONTEXT='))!;
    const input = JSON.parse(marker.slice('STORYDREAM_TREATMENT_CONTEXT='.length));
    const plan = { version: 1, shots: input.shotIds.map((id: string) => ({ id, title: 'Approved ' + id, scenePrompt: 'A deliberate garden composition with large foliage, blue-green palette and strong movement direction.' })) }; transform?.(plan);
    const store = await LemoStageStore.open({ directory: join(options.runRoot, 'stage'), projectDirectory: project, runId: options.runId, stageId: options.stageId, ...lemoSessionFingerprints(options) });
    try {
      await store.startAttempt('start'); await store.recordSession(randomUUID());
      await writeFile(join(project, 'TREATMENT.md'), 'Offline fixture treatment. Use two linked scenes with a clear visual thesis, controlled palette, larger foreground shapes and continuous motion. Respect the approved source and timing. Show the causal relationship with a deliberate transition; do not invent facts or replace the narration.', 'utf8');
      await writeFile(join(project, 'SHOT_PLAN.json'), JSON.stringify(plan), 'utf8');
      await store.complete({ status: 'completed', artifacts: ['TREATMENT.md', 'SHOT_PLAN.json'] });
    } finally { await store.close(); }
    return { receipt: { status: 'completed' } };
  });
}
describe('durable treatment and voice-lock stages', () => {
  it('applies validated treatment files and recovers completed stages without another request', async () => {
    const f = await fixture(); completeTreatment();
    const result = await officialTreatment(f.document, f.options, true); expect(result!.beats[0].shots[0].title).toContain('Approved');
    const recovered = await officialTreatment(result!, f.options, false); expect(recovered!.beats).toEqual(result!.beats); expect(calls.session).toHaveBeenCalledOnce();
    expect(officialTreatmentInput(result!)).toEqual(officialTreatmentInput(f.document));
  });
  it.each(['TREATMENT.md', 'SHOT_PLAN.json'])('rejects changed %s without resubmitting the completed stage', async path => {
    const f = await fixture(); completeTreatment(); await officialTreatment(f.document, f.options, true);
    await writeFile(join(f.root, 'stages/treatment/sdk-state/project', path), 'tampered', 'utf8');
    await expect(officialTreatment(f.document, f.options, true)).rejects.toThrow('LEMO_TREATMENT_ARTIFACT_CHANGED'); expect(calls.session).toHaveBeenCalledOnce();
  });
  it('rejects a missing or duplicated shot plan entry', async () => {
    const f = await fixture(); completeTreatment(p => { p.shots[0].id = 'not-an-approved-shot'; });
    await expect(officialTreatment(f.document, f.options, true)).rejects.toThrow('LEMO_TREATMENT_SHOT_IDS');
  });
  it('blocks an unresolved original ledger before dispatching treatment', async () => {
    const f = await fixture(); await ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, f.options.session);
    const ledger = await LemoRequestLedger.open(join(f.root, 'ledger'), 12, { existingOnly: true }); await ledger.begin('a'.repeat(64)); await ledger.close();
    await expect(officialTreatment(f.document, f.options, true)).rejects.toThrow('LEMO_LEDGER_BLOCKED'); expect(calls.session).not.toHaveBeenCalled();
  });
  it('does not reconstruct a missing workflow marker around an existing ledger', async () => {
    const f = await fixture(); await ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, f.options.session); await unlink(join(f.root, 'creative-workflow.json'));
    await expect(ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, f.options.session)).rejects.toThrow('LEMO_CREATIVE_WORKFLOW_RECEIPT_MISSING');
    await expect(readFile(join(f.root, 'creative-workflow.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not reconstruct a missing initialized ledger', async () => {
    const f = await fixture(); await ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, f.options.session); await unlink(join(f.root, 'ledger/requests.jsonl'));
    await expect(ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, f.options.session)).rejects.toThrow();
    await expect(assertOfficialSharedLedger(f.root, 12)).rejects.toThrow();
    await expect(readFile(join(f.root, 'ledger/requests.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('initializes one budget before the first request and refuses a deleted zero-request budget', async () => {
    const f = await fixture(), session = { ...f.options.session, maxEstimatedCostUsd: 1 };
    await ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, session);
    const original = JSON.parse(await readFile(join(f.root, 'execution-budget.json'), 'utf8'));
    expect(original.policy).toEqual({ timeoutMs: session.timeoutMs, maxEstimatedCostUsd: 1 });
    await ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, session);
    expect(JSON.parse(await readFile(join(f.root, 'execution-budget.json'), 'utf8')).startedAt).toBe(original.startedAt);
    await unlink(join(f.root, 'execution-budget.json'));
    await expect(ensureOfficialCreativeWorkflow(f.root, f.document.productionRun!.id, session)).rejects.toThrow('LEMO_BUDGET_RECEIPT_MISSING');
    await expect(readFile(join(f.root, 'execution-budget.json'))).rejects.toMatchObject({ code: 'ENOENT' }); expect(calls.session).not.toHaveBeenCalled();
  });
  it('rejects lost stage identity after an attempted treatment', async () => {
    const f = await fixture(); completeTreatment(); await officialTreatment(f.document, f.options, true);
    await unlink(join(f.root, 'stages/treatment/stage/stage-identity.json'));
    await expect(officialTreatment(f.document, f.options, true)).rejects.toThrow('LEMO_OFFICIAL_STAGE_RECEIPT_MISSING'); expect(calls.session).toHaveBeenCalledOnce();
  });
  it('locks actual audio bytes and measured duration, then detects audio or cue changes', async () => {
    const f = await fixture(true), path = join(f.root, 'fixture-audio.wav'); await writeFile(path, 'local fixture audio bytes', 'utf8');
    f.document.assets.push({ id: 'voice', assetId: 'voice', kind: 'audio', localPath: path, durationMs: 3000, createdAt: f.document.createdAt });
    for (const b of f.document.beats) for (const s of b.shots) s.voiceAssetVersionId = 'voice';
    await expect(officialVoiceLock(f.document, f.root, true)).resolves.toBeDefined();
    await expect(officialVoiceLock(f.document, f.root, false)).resolves.toBeDefined();
    const changed = structuredClone(f.document); changed.beats[0].subtitleCues[0].endMs -= 1;
    await expect(officialVoiceLock(changed, f.root, false)).rejects.toThrow('LEMO_VOICE_LOCK_CHANGED');
    await writeFile(path, 'different audio bytes', 'utf8'); await expect(officialVoiceLock(f.document, f.root, false)).rejects.toThrow('LEMO_VOICE_LOCK_CHANGED');
    expect(calls.session).not.toHaveBeenCalled();
  });
  it('requires audio for every readable narrated shot, not just one shot', async () => {
    const f = await fixture(true), path = join(f.root, 'fixture-audio.wav'); await writeFile(path, 'fixture', 'utf8');
    f.document.assets.push({ id: 'voice', assetId: 'voice', kind: 'audio', localPath: path, durationMs: 3000, createdAt: f.document.createdAt });
    f.document.beats[0].shots[0].voiceAssetVersionId = 'voice';
    await expect(officialVoiceLock(f.document, f.root, true)).rejects.toThrow('LEMO_VOICE_LOCK_AUDIO_REQUIRED');
  });
  it('keeps style sample inputs stable when measured narration retimes layer motion', async () => {
    const f = await fixture(), runtime = createVoxProductionRuntime(nativeOperations()), node = f.document.productionRun!.nodes.find(n => n.id === 'official-style-frame')!;
    const before = runtime.input(f.document, node), changed = structuredClone(f.document);
    for (const b of changed.beats) for (const s of b.shots) { s.durationMs += 800; for (const layer of s.layers) for (const frame of layer.motion) frame.atMs += 500; }
    expect(runtime.input(changed, node)).toEqual(before);
  });
  it('pools previous stage review rounds and shot-repair sessions in the same run', async () => {
    const f = await fixture(), repairId = 'official-repair:' + randomUUID(), currentRoot = join(f.root, 'stages', repairId.replace(':', '-'));
    for (const [root, count] of [[f.root, 2], [join(f.root, 'stages/style-frame'), 3]] as const) {
      await mkdir(join(root, 'stage'), { recursive: true });
      await writeFile(join(root, 'stage/stage.json'), JSON.stringify({ version: 1, runId: f.document.productionRun!.id, toolEvents: Array.from({ length: count }, () => ({ tool: 'mcp__storydream_film__review_film', phase: 'started' })) }), 'utf8');
    }
    expect(await officialRepairBudgetUsage(f.root, currentRoot, f.document.productionRun!.id, [repairId])).toEqual({ otherReviewRounds: 3, repairSessions: 1 });
    expect(await officialRepairBudgetUsage(f.root, f.root, f.document.productionRun!.id, [])).toEqual({ otherReviewRounds: 2, repairSessions: 0 });
    await expect(officialRepairBudgetUsage(f.root, currentRoot, 'different-run', [repairId])).rejects.toThrow('LEMO_REPAIR_BUDGET_RECEIPT');
  });
});
