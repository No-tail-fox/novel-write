import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { voxProductionSettings, type VoxProductionNode } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { LemoRequestLedger } from '../services/lemo-agent-worker/request-ledger';
import { LemoStageStore } from '../services/lemo-agent-worker/stage-store';
import { lemoSessionFingerprints, type OfficialLemoSessionOptions } from '../electron/lemo-agent-session-runtime';
import { createLemoOfficialOperations, lemoOfficialRunRoot, type LemoOfficialProductionOptions } from '../electron/lemo-official-production';

const offline = vi.hoisted(() => ({ session: vi.fn(), review: vi.fn() }));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer(data: Buffer) {
  const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }),
    toPNG: () => Buffer.from(data), resize() { return this; } };
  return image;
} } }));
vi.mock('../electron/lemo-agent-session-runtime', async importOriginal => ({
  ...await importOriginal<typeof import('../electron/lemo-agent-session-runtime')>(), runOfficialLemoAgentSession: offline.session,
}));
vi.mock('../electron/lemo-upstream-renderer', () => ({ reviewLemoUpstreamProject: offline.review }));

const temporaryRoot = resolve('.artifacts/lemo-official-production-20261102/tmp/host-safety');
const directories: string[] = [];
const inFlightCases = new Set<Promise<void>>();
function filesystemCase<Arguments extends unknown[]>(body: (...args: Arguments) => Promise<void>) {
  return (...args: Arguments) => {
    const running = body(...args);
    inFlightCases.add(running);
    // The runner still receives the original rejection, including assertion
    // errors. These handlers only track when filesystem work has truly stopped.
    void running.then(() => inFlightCases.delete(running), () => inFlightCases.delete(running));
    return running;
  };
}
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const materialId = 'asset_fixture';
const materialName = 'materials/' + sha256(materialId).slice(0, 24) + '.png';
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFwoAAAAASUVORK5CYII=', 'base64');
const node: VoxProductionNode = { id: 'official-authoring', kind: 'film-edit', fileId: 'official-film',
  dependencies: [], status: 'pending', attempt: 0, paid: true };

beforeEach(() => { offline.session.mockReset().mockRejectedValue(new Error('OFFLINE_SESSION_BOUNDARY')); offline.review.mockReset(); });
afterEach(async () => {
  // A Vitest timeout ends its wait, not the underlying async test. Drain that
  // body before removing directories it could otherwise still be creating.
  await Promise.allSettled([...inFlightCases]);
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(temporaryRoot + sep)) throw new Error('FIXTURE_PATH');
    await rm(directory, { recursive: true, force: true });
  }
});
async function temporaryDirectory() {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, 'lemo-official-host-')); directories.push(directory); return directory;
}
async function fixture(material = true) {
  const directory = await temporaryDirectory();
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'offline-host', title: 'Offline host safety', ratio: '16:9' }),
    'The offline fixture preserves approved source content.', '2026-11-02T00:00:00.000Z', 15000);
  const settings = { ...voxProductionSettings(), generateImages: false, narration: false,
    authoring: { mode: 'ai-code' as const, styleId: 'watercolor' } };
  document.productionRun = { version: 1, id: 'same_official_run', status: 'paused', authoringVersion: 4, engine: LEMO_NATIVE_ENGINE,
    settings, nodes: [node], sourceHash: sha256(document.sourceText ?? ''), runtimeIdentity: 'offline-host',
    createdAt: document.createdAt, updatedAt: document.updatedAt };
  if (material) {
    const source = join(directory, 'source.png'); await writeFile(source, imageBytes);
    document.assets.push({ id: materialId, assetId: 'original-image', kind: 'image', localPath: source, createdAt: document.createdAt });
    document.beats[0].shots[0].keyframeAssetVersionId = materialId;
  }
  const options: LemoOfficialProductionOptions = { work: join(directory, 'work'),
    library: { upstreamRoot: resolve('vendor/lemo-upstream'), threeRoot: resolve('node_modules/three') },
    session: { nodeExecutable: process.execPath, workerPath: join(directory, 'unused-offline-worker.cjs'),
      provider: { protocol: 'anthropic', messagesUrl: 'https://provider.invalid/v1/messages', apiKey: 'offline-unused', auth: 'x-api-key', model: 'offline-model' },
      maxOutputTokens: 8192, maxRequests: 3, maxTurns: 3, timeoutMs: 10000, requestTimeoutMs: 10000 } };
  const root = lemoOfficialRunRoot(options.work, document.productionRun.id); const project = join(root, 'sdk-state', 'project');
  const operations = createLemoOfficialOperations(options);
  return { directory, document, root, project, options, operations, start: () => operations.officialStep(document, node),
    recover: () => operations.recoverOfficialStep(document, node) };
}
async function knownAttempt(f: Awaited<ReturnType<typeof fixture>>) {
  await expect(f.start()).rejects.toThrow('OFFLINE_SESSION_BOUNDARY');
  const session = offline.session.mock.calls.at(-1)![0] as OfficialLemoSessionOptions;
  const store = await LemoStageStore.open({ directory: join(f.root, 'stage'), projectDirectory: f.project,
    runId: f.document.productionRun!.id, stageId: 'film', ...lemoSessionFingerprints(session) });
  try {
    await store.startAttempt('start'); await store.recordSession('55555555-5555-4555-8555-555555555555');
    await store.complete({ status: 'failed', resultSubtype: 'error_max_turns' });
  } finally { await store.close(); }
  return session;
}

describe('official review repair rounds persist across resume', () => {
  it.each([0, 2])('rejects another review after the original initial plus %s repair rounds', filesystemCase(async (repairRounds: number) => {
    const f = await fixture(false); f.options.session.maxRepairRounds = repairRounds;
    await expect(f.start()).rejects.toThrow('OFFLINE_SESSION_BOUNDARY');
    const initial = offline.session.mock.calls.at(-1)![0] as OfficialLemoSessionOptions;
    const store = await LemoStageStore.open({ directory: join(f.root, 'stage'), projectDirectory: f.project, runId: initial.runId, stageId: initial.stageId, ...lemoSessionFingerprints(initial) });
    try {
      await store.startAttempt('start'); await store.recordSession('55555555-5555-4555-8555-555555555555');
      for (let i = 0; i <= repairRounds; i++) {
        const event = { version: 1 as const, operationId: 'review-' + i, tool: 'mcp__storydream_film__review_film', argumentsSha256: 'a'.repeat(64), at: new Date().toISOString() };
        await store.recordToolEvent({ ...event, phase: 'started' }); await store.recordToolEvent({ ...event, phase: 'completed' });
      }
      await store.complete({ status: 'failed', resultSubtype: 'error_max_turns' });
    } finally { await store.close(); }
    const responses: unknown[] = [];
    offline.session.mockImplementation(async (session: OfficialLemoSessionOptions) => {
      expect(session.action).toBe('resume');
      responses.push(await session.invokeHostTool!({ version: 1, action: 'host-tool', runId: session.runId, stageId: session.stageId, operationId: 'new-review', tool: 'review_film', input: {} }, new AbortController().signal));
      return { receipt: { status: 'failed' } };
    });
    await expect(f.start()).rejects.toThrow('LEMO_OFFICIAL_SESSION_FAILED');
    await expect(f.start()).rejects.toThrow('LEMO_OFFICIAL_SESSION_FAILED');
    expect(responses).toHaveLength(2);
    for (const response of responses) expect(response).toMatchObject({ isError: true, sideEffectApplied: false, content: [{ text: expect.stringContaining('LEMO_REPAIR_BUDGET_EXHAUSTED') }] });
    expect(offline.review).not.toHaveBeenCalled();
  }));
});

describe('official host material files preserve filesystem ownership', () => {
  it.each(['material', 'manifest'] as const)('refuses a preexisting %s hardlink without overwriting the external file', filesystemCase(async (kind: 'material' | 'manifest') => {
    const f = await fixture(kind === 'material'); const target = join(f.project, kind === 'material' ? materialName : 'MATERIALS.json');
    await mkdir(dirname(target), { recursive: true });
    const external = join(f.directory, 'external-original');
    const original = kind === 'material' ? imageBytes : Buffer.from('[]\n');
    await writeFile(external, original); await link(external, target);
    await expect(f.start()).rejects.toThrow('LEMO_OFFICIAL_MATERIAL_CONFLICT');
    expect(await readFile(external)).toEqual(original); expect((await lstat(external)).nlink).toBe(2);
    expect(offline.session).not.toHaveBeenCalled(); expect(offline.review).not.toHaveBeenCalled();
  }));

  it('accepts an identical single-link material left by interrupted input preparation', filesystemCase(async () => {
    const f = await fixture(); const target = join(f.project, materialName); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, imageBytes); const original = await lstat(target);
    await expect(f.start()).rejects.toThrow('OFFLINE_SESSION_BOUNDARY');
    expect((await lstat(target)).ino).toBe(original.ino); expect(await readFile(target)).toEqual(imageBytes);
    expect(offline.session).toHaveBeenCalledTimes(1);
  }));

  it('refuses a conflicting single-link material instead of replacing it', filesystemCase(async () => {
    const f = await fixture(); const target = join(f.project, materialName); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, 'existing source must remain untouched', 'utf8');
    await expect(f.start()).rejects.toThrow('LEMO_OFFICIAL_MATERIAL_CONFLICT');
    expect(await readFile(target, 'utf8')).toBe('existing source must remain untouched'); expect(offline.session).not.toHaveBeenCalled();
  }));

  it.each(['material', 'manifest'] as const)('refuses a %s that gains a hardlink before recovery', filesystemCase(async (kind: 'material' | 'manifest') => {
    const f = await fixture(); await knownAttempt(f);
    const target = join(f.project, kind === 'material' ? materialName : 'MATERIALS.json'); const original = await readFile(target);
    const external = join(f.directory, 'late-external-alias'); await link(target, external);
    await expect(f.recover()).rejects.toThrow(kind === 'material' ? 'LEMO_OFFICIAL_MATERIAL_CHANGED' : 'LEMO_OFFICIAL_MATERIAL_MANIFEST_CHANGED');
    expect(await readFile(external)).toEqual(original); expect(offline.session).toHaveBeenCalledTimes(1);
  }));

  it.each(['material', 'manifest'] as const)('refuses an oversized %s before resuming', filesystemCase(async (kind: 'material' | 'manifest') => {
    const f = await fixture(); await knownAttempt(f);
    const target = join(f.project, kind === 'material' ? materialName : 'MATERIALS.json'); await writeFile(target, Buffer.alloc(1024 * 1024 + 1));
    await expect(f.start()).rejects.toThrow(kind === 'material' ? 'LEMO_OFFICIAL_MATERIAL_CHANGED' : 'LEMO_OFFICIAL_MATERIAL_MANIFEST_CHANGED');
    expect(offline.session).toHaveBeenCalledTimes(1);
  }));
});

describe('official host existing-stage ledger continuity', () => {
  it.each(['stage.json', 'stage-identity.json', 'whole-stage'] as const)('blocks missing %s under an existing execution intent without recreating a stage', filesystemCase(async (missing: 'stage.json' | 'stage-identity.json' | 'whole-stage') => {
    const f = await fixture(); await knownAttempt(f);
    const directory = join(f.root, 'stage');
    const target = missing === 'whole-stage' ? directory : join(directory, missing);
    await rm(target, { recursive: missing === 'whole-stage', force: true });
    await expect(f.start()).rejects.toThrow('LEMO_OFFICIAL_STAGE_RECEIPT_MISSING');
    await expect(f.recover()).rejects.toThrow('LEMO_OFFICIAL_STAGE_RECEIPT_MISSING');
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(offline.session).toHaveBeenCalledTimes(1);
  }));

  it.each(['start', 'recover'] as const)('does not recreate a missing journal during %s of an existing stage', filesystemCase(async (action: 'start' | 'recover') => {
    const f = await fixture(); await knownAttempt(f); const directory = join(f.root, 'ledger');
    const ledger = await LemoRequestLedger.open(directory, 3, { existingOnly: true });
    await ledger.begin('d'.repeat(64)); await ledger.close();
    const journal = join(directory, 'requests.jsonl'); await unlink(journal);
    await expect(f[action]()).rejects.toThrow();
    await expect(lstat(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(offline.session).toHaveBeenCalledTimes(1); expect(offline.review).not.toHaveBeenCalled();
  }));

  it('blocks an unresolved existing ledger without another SDK dispatch', filesystemCase(async () => {
    const f = await fixture(); await knownAttempt(f); const directory = join(f.root, 'ledger');
    const ledger = await LemoRequestLedger.open(directory, 3, { existingOnly: true });
    const requestId = await ledger.begin('e'.repeat(64)); await ledger.close();
    const original = await readFile(join(directory, 'requests.jsonl'));
    await expect(f.start()).rejects.toThrow('LEMO_LEDGER_BLOCKED'); await expect(f.recover()).rejects.toThrow('LEMO_LEDGER_BLOCKED');
    expect(await readFile(join(directory, 'requests.jsonl'))).toEqual(original);
    const reopened = await LemoRequestLedger.open(directory, 3, { existingOnly: true });
    try { expect(reopened.lookup('e'.repeat(64))?.requestId).toBe(requestId); expect(reopened.summary()).toMatchObject({ requests: 1, unknown: 1, blocked: true }); }
    finally { await reopened.close(); }
    expect(offline.session).toHaveBeenCalledTimes(1);
  }));

  it('existingOnly fails without creating a journal when no previous ledger exists', filesystemCase(async () => {
    const directory = join(await temporaryDirectory(), 'absent-ledger');
    await expect(LemoRequestLedger.open(directory, 3, { existingOnly: true })).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(directory, 'requests.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(directory, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('existingOnly opens the original unresolved journal without resetting IDs or history', filesystemCase(async () => {
    const directory = join(await temporaryDirectory(), 'ledger'); const first = await LemoRequestLedger.open(directory, 3);
    const requestId = await first.begin('f'.repeat(64)); await first.close(); const original = await readFile(join(directory, 'requests.jsonl'));
    const resumed = await LemoRequestLedger.open(directory, 3, { existingOnly: true });
    try { expect(resumed.lookup('f'.repeat(64))).toMatchObject({ requestId }); expect(resumed.summary()).toMatchObject({ requests: 1, unknown: 1, blocked: true }); }
    finally { await resumed.close(); }
    expect(await readFile(join(directory, 'requests.jsonl'))).toEqual(original);
  }));
});
