import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { FileDatabase } from '../src/shared/storage';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { assertMotionComicScriptTransition } from '../src/shared/motion-comic-script-batch';
import { MotionComicScriptBatchService } from '../electron/motion-comic-script-batch-service';
import type { ConfiguredJsonLlm } from '../src/shared/llm-provider';
import { applyMotionComicPlan, isUntouchedMotionComicStarter, type MotionComicScriptDraft, type MotionComicStoryboardDraft } from '../src/shared/motion-comic-planning';

const sourceText = '雨夜里，阿青收到一封信。';
export function batchScript(): MotionComicScriptDraft {
  return { title: '雨夜来信', logline: '一封信打破日常。', characters: [], sceneAssets: [{ key: 'room', label: '门厅', description: '雨夜门厅', prompt: '雨夜门厅', continuityNotes: '左侧光' }], props: [],
    scenes: [{ key: 'scene', actIndex: 1, actTitle: '来信', actBoundaryReason: '信件到来打破日常。', title: '来信', summary: '阿青收到信。', locationKey: 'room',
      beats: [{ key: 'beat', sourceUnitIds: ['S1'], kind: 'action', text: '阿青收到一封信。' }] }] };
}
async function fixture(run: (db: FileDatabase, id: string, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'storydream-batch-'));
  const file = join(root, 'data.sqlite');
  const db = await FileDatabase.open(file);
  try {
    const task = await db.createMotionComicTask({ title: '雨夜来信', premise: sourceText, ratio: '9:16', source: {
      kind: 'novel', adaptationMode: 'novel-adaptation', fileName: '来信.txt', originalText: sourceText.repeat(3),
      episodes: [1, 2, 3].map((number) => ({ title: `第${number}集`, sourceText })),
    } });
    const doc = parseMotionComicPipelineData(task.pipelineData);
    const saved = await db.saveMotionComicTask({ id: task.id, expectedUpdatedAt: doc.updatedAt, document: { ...doc, sourceDocument: {
      kind: 'novel', adaptationMode: 'novel-adaptation', fileName: '来信.txt', originalText: sourceText.repeat(3), importedAt: doc.updatedAt,
      episodes: [1, 2, 3].map((number) => ({ id: `source-${number}`, number, title: `第${number}集`, sourceText })),
    } } });
    await run(db, saved.id, file);
  } finally { await db.close(); await rm(root, { recursive: true, force: true }); }
}
const config = { provider: 'test', model: 'test-model' };
async function enqueue(db: FileDatabase, id: string) { const doc = await db.motionComicScripts.readProject(id); return db.motionComicScripts.enqueue({ id, expectedUpdatedAt: doc.updatedAt, scope: 'missing' }, config); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function batchStoryboard(): MotionComicStoryboardDraft {
  return { shots: [{ key: 'shot', sceneKey: 'scene', title: '收到来信', durationSec: 5,
    prompt: '雨夜门厅，阿青收到来信。', motionPrompt: '伸手接信，镜头缓推。', framing: '中景',
    characterLookKeys: [], propKeys: [], beatKeys: ['beat'],
    continuity: { startState: '站在门口', endState: '拿到信件', screenDirection: '面向左侧', actionBeats: ['伸手', '接信'] } }] };
}
async function approveFirst(db: FileDatabase, id: string) {
  await enqueue(db, id);
  const task = (await db.motionComicScripts.claim(id))!;
  await db.motionComicScripts.finish(task, { script: batchScript(), issues: [], adjustments: [] });
  const document = await db.motionComicScripts.readProject(id);
  await db.motionComicScripts.approve({ id, expectedUpdatedAt: document.updatedAt, revisions: [{ taskId: task.id, outputRevision: 1 }] });
  return { id, taskId: task.id, outputRevision: 1, expectedUpdatedAt: (await db.motionComicScripts.readProject(id)).updatedAt };
}

async function proposalFixture(db: FileDatabase, id: string) {
  await enqueue(db, id);
  const task = (await db.motionComicScripts.claim(id))!;
  await db.motionComicScripts.finish(task, { script: batchScript(), issues: [], adjustments: [] });
  return { id, taskId: task.id, outputRevision: 1, expectedUpdatedAt: (await db.motionComicScripts.readProject(id)).updatedAt,
    sceneKey: 'scene', beatKey: 'beat', instruction: '细化接信动作', requestId: 'request-1' };
}

describe('isolated local script proposals', () => {
  it('deduplicates concurrent requests and atomically adopts just one same-baseline proposal', async () => fixture(async (db, id) => {
    const input = await proposalFixture(db, id);
    const before = await db.motionComicScripts.snapshot(id);
    const entered = deferred<void>(); const answer = deferred<{ json: { text: string } }>();
    const run = vi.fn().mockImplementation(() => { entered.resolve(); return answer.promise; });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm }));
    const first = service.proposeChange(input); await entered.promise;
    expect((await service.proposeChange(input)).proposals![0].status).toBe('running');
    expect(run).toHaveBeenCalledTimes(1);
    answer.resolve({ json: { text: '阿青伸手，接住雨夜送来的一封信。' } });
    const generated = await first;
    expect(generated.candidates).toEqual(before.candidates);
    expect(generated.tasks).toEqual(before.tasks);
    expect(generated.approvals).toEqual(before.approvals);
    expect(generated.originals![0].script).toEqual(batchScript());
    await expect(service.proposeChange({ ...input, instruction: 'different' })).rejects.toThrow('REQUEST_CONFLICT');
    const second = await service.proposeChange({ ...input, requestId: 'request-2' });
    const results = await Promise.allSettled(second.proposals!.map(p => db.motionComicScripts.adoptProposal({ id, taskId: input.taskId, outputRevision: 1, expectedUpdatedAt: input.expectedUpdatedAt, proposalId: p.id })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const final = await db.motionComicScripts.snapshot(id);
    expect(final.tasks[0].outputRevision).toBe(2); expect(final.tasks[0].status).toBe('review');
    expect(final.approvals).toEqual([]); expect(final.proposals!.map(p => p.status).sort()).toEqual(['applied', 'stale']);
    expect(final.originals).toEqual(before.originals);
    await service.stop();
  }));
  it('retains late results as stale after human edits and never overwrites current', async () => fixture(async (db, id) => {
    const input = await proposalFixture(db, id);
    const pending = await db.motionComicScripts.beginProposal(input, config);
    const script = batchScript(); script.scenes[0].beats[0].text = '人工保存的新稿。';
    await db.motionComicScripts.edit({ id, taskId: input.taskId, outputRevision: 1, expectedUpdatedAt: input.expectedUpdatedAt, script });
    const result = await db.motionComicScripts.finishProposal(id, pending.proposal.id, '迟到的模型结果。');
    expect(result.proposals![0]).toMatchObject({ status: 'stale', proposedText: '迟到的模型结果。' });
    expect(result.candidates[0].script).toEqual(script);
    await expect(db.motionComicScripts.adoptProposal({ id, taskId: input.taskId, outputRevision: 2, expectedUpdatedAt: input.expectedUpdatedAt, proposalId: pending.proposal.id })).rejects.toThrow('STALE');
    expect(result.originals![0].script).toEqual(batchScript());
  }));
  it('persists failures, rejects out-of-scope output and never retries the same request', async () => fixture(async (db, id) => {
    const input = await proposalFixture(db, id);
    const run = vi.fn().mockResolvedValue({ json: { text: '新文本', kind: 'dialogue' } });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm }));
    expect((await service.proposeChange(input)).proposals![0].status).toBe('failed');
    await service.proposeChange(input); expect(run).toHaveBeenCalledTimes(1);
    expect((await db.motionComicScripts.snapshot(id)).candidates[0].outputRevision).toBe(1);
    await service.stop();
  }));
  it('marks interrupted proposal failed on reopen and preserves original insert-once', async () => fixture(async (db, id, file) => {
    const input = await proposalFixture(db, id);
    await db.motionComicScripts.beginProposal(input, config);
    await db.close();
    const reopened = await FileDatabase.open(file);
    try {
      const snapshot = await reopened.motionComicScripts.snapshot(id);
      expect(snapshot.proposals![0].status).toBe('failed');
      expect((await reopened.motionComicScripts.beginProposal(input, config)).claimed).toBe(false);
      expect(snapshot.originals![0].script).toEqual(batchScript());
    } finally { await reopened.close(); }
  }));
  it('marks late proposals stale after project input changes', async () => fixture(async (db, id) => {
    const input = await proposalFixture(db, id);
    const pending = await db.motionComicScripts.beginProposal(input, config);
    const document = await db.motionComicScripts.readProject(id);
    document.sourceDocument!.episodes[0].sourceText += '新的剧情。';
    await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document });
    const result = await db.motionComicScripts.finishProposal(id, pending.proposal.id, '模型返回的局部文本。');
    expect(result.proposals![0].status).toBe('stale');
    expect(result.candidates[0].script).toEqual(batchScript());
  }));
  it('retains failed validation and rolls back invalid adoption without consuming proposal', async () => fixture(async (db, id) => {
    const input = await proposalFixture(db, id);
    const p = await db.motionComicScripts.beginProposal(input, config);
    await db.motionComicScripts.finishProposal(id, p.proposal.id, '阿青伸手接信。');
    const sql = (db as unknown as { db: import('sql.js').Database }).db;
    const before = await db.motionComicScripts.snapshot(id);
    const corrupted = { ...before.proposals![0], originalText: '并非原文' };
    sql.run('UPDATE motion_comic_script_proposals SET data = ? WHERE id = ?', [JSON.stringify(corrupted), p.proposal.id]);
    await expect(db.motionComicScripts.adoptProposal({ id, taskId: input.taskId, outputRevision: 1, expectedUpdatedAt: input.expectedUpdatedAt, proposalId: p.proposal.id })).rejects.toThrow('TARGET_CHANGED');
    expect((await db.motionComicScripts.snapshot(id)).candidates).toEqual(before.candidates);
    expect((await db.motionComicScripts.snapshot(id)).proposals![0].status).toBe('ready');
  }));
  it('does not backfill legacy human current as original on migration', async () => fixture(async (db, id, file) => {
    const input = await proposalFixture(db, id);
    const script = batchScript(); script.scenes[0].beats[0].text = '历史人工稿。';
    await db.motionComicScripts.edit({ id, taskId: input.taskId, outputRevision: 1, expectedUpdatedAt: input.expectedUpdatedAt, script });
    const sql = (db as unknown as { db: import('sql.js').Database }).db;
    sql.run('DELETE FROM motion_comic_script_originals');
    await db.motionComicScripts.control(id, 'pause');
    await db.close();
    const reopened = await FileDatabase.open(file);
    try {
      const snapshot = await reopened.motionComicScripts.snapshot(id);
      expect(snapshot.originals).toEqual([]);
      expect(snapshot.candidates[0].origin).toBe('human'); expect(snapshot.candidates[0].script).toEqual(script);
    } finally { await reopened.close(); }
  }));
  it('blocks proposals after asset confirmation', async () => fixture(async (db, id) => {
    const input = await proposalFixture(db, id);
    await db.motionComicScripts.approve({ id, expectedUpdatedAt: input.expectedUpdatedAt, revisions: [{ taskId: input.taskId, outputRevision: 1 }] });
    await expect(db.motionComicScripts.beginProposal({ ...input, expectedUpdatedAt: (await db.motionComicScripts.readProject(id)).updatedAt }, config)).rejects.toThrow();
    expect((await db.motionComicScripts.snapshot(id)).proposals).toEqual([]);
  }));
});

async function appliedProposalFixture(db: FileDatabase, id: string) {
  const input = await proposalFixture(db, id);
  const { proposal } = await db.motionComicScripts.beginProposal(input, config);
  await db.motionComicScripts.finishProposal(id, proposal.id, '阿青伸手接住来信。');
  const adopted = await db.motionComicScripts.adoptProposal({ id, taskId: input.taskId, outputRevision: 1, expectedUpdatedAt: input.expectedUpdatedAt, proposalId: proposal.id });
  return { input: { id, taskId: input.taskId, outputRevision: 2, expectedUpdatedAt: input.expectedUpdatedAt, proposalId: proposal.id }, adopted };
}

describe('safe local proposal reversion', () => {
  it('restores only original target text as r+1, retains history and never rewrites immutable original', async () => fixture(async (db, id) => {
    const { input, adopted } = await appliedProposalFixture(db, id);
    expect(adopted.proposals![0].appliedScriptHash).toMatch(/^[a-f0-9]{64}$/);
    const result = await db.motionComicScripts.revertProposal(input);
    expect(result.candidates[0]).toMatchObject({ outputRevision: 3, origin: 'human', script: batchScript() });
    expect(result.tasks[0]).toMatchObject({ outputRevision: 3, status: 'review' });
    expect(result.proposals![0]).toEqual({ ...adopted.proposals![0], status: 'reverted', revertedRevision: 3 });
    expect(result.originals).toEqual(adopted.originals);
    expect(result.originals![0].outputRevision).toBe(1);
    await expect(db.motionComicScripts.revertProposal(input)).rejects.toThrow('STALE');
    await expect(db.motionComicScripts.revertProposal({ ...input, outputRevision: 3 })).rejects.toThrow('NOT_APPLIED');
    expect(await db.motionComicScripts.snapshot(id)).toEqual(result);
  }));
  it('serializes duplicate concurrent reverts into a single new revision', async () => fixture(async (db, id) => {
    const { input } = await appliedProposalFixture(db, id);
    const results = await Promise.allSettled([db.motionComicScripts.revertProposal(input), db.motionComicScripts.revertProposal(input)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.motionComicScripts.snapshot(id)).candidates[0].outputRevision).toBe(3);
  }));
  it('rejects stale revision, mismatched task, unknown proposal and project CAS without writes', async () => fixture(async (db, id) => {
    const { input, adopted } = await appliedProposalFixture(db, id);
    for (const patch of [{ outputRevision: 1 }, { taskId: 'another-task' }, { proposalId: 'unknown' }, { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }]) {
      await expect(db.motionComicScripts.revertProposal({ ...input, ...patch })).rejects.toThrow();
      expect(await db.motionComicScripts.snapshot(id)).toEqual(adopted);
    }
  }));
  it('rejects human edits even when the adopted target remains unchanged', async () => fixture(async (db, id) => {
    const { input, adopted } = await appliedProposalFixture(db, id);
    const script = structuredClone(adopted.candidates[0].script); script.title = '人工改标题';
    const edited = await db.motionComicScripts.edit({ id, taskId: input.taskId, outputRevision: 2, expectedUpdatedAt: input.expectedUpdatedAt, script });
    await expect(db.motionComicScripts.revertProposal({ ...input, outputRevision: 3 })).rejects.toThrow('STALE');
    expect(await db.motionComicScripts.snapshot(id)).toEqual(edited);
  }));
  it('checks full adopted hash, not only revision and target text', async () => fixture(async (db, id) => {
    const { input, adopted } = await appliedProposalFixture(db, id);
    const candidate = structuredClone(adopted.candidates[0]); candidate.script.title = '同版本人工修改';
    const sql = (db as unknown as { db: import('sql.js').Database }).db;
    sql.run('UPDATE motion_comic_script_candidates SET data = ? WHERE task_id = ?', [JSON.stringify(candidate), input.taskId]);
    await expect(db.motionComicScripts.revertProposal(input)).rejects.toThrow('STALE');
    expect((await db.motionComicScripts.snapshot(id)).candidates[0]).toEqual(candidate);
  }));
  it('rejects legacy missing hash, fingerprint mismatch and invalid restored text without consuming history', async () => fixture(async (db, id) => {
    const { input, adopted } = await appliedProposalFixture(db, id);
    for (const [patch, error] of [[{ appliedScriptHash: undefined }, 'REVERT_UNAVAILABLE'], [{ inputFingerprint: 'changed' }, 'STALE'], [{ originalText: '字'.repeat(2001) }, '2000']] as const) {
      const proposal = { ...adopted.proposals![0], ...patch };
      (db as unknown as { db: import('sql.js').Database }).db.run('UPDATE motion_comic_script_proposals SET data = ? WHERE id = ?', [JSON.stringify(proposal), input.proposalId]);
      await expect(db.motionComicScripts.revertProposal(input)).rejects.toThrow(error);
      const snapshot = await db.motionComicScripts.snapshot(id);
      expect(snapshot.candidates).toEqual(adopted.candidates);
      expect(snapshot.proposals![0].status).toBe('applied');
    }
  }));
  it('rejects asset-confirmed scripts', async () => fixture(async (db, id) => {
    const { input } = await appliedProposalFixture(db, id);
    await db.motionComicScripts.approve({ id, expectedUpdatedAt: input.expectedUpdatedAt, revisions: [{ taskId: input.taskId, outputRevision: 2 }] });
    const locked = await db.motionComicScripts.snapshot(id);
    await expect(db.motionComicScripts.revertProposal({ ...input, expectedUpdatedAt: (await db.motionComicScripts.readProject(id)).updatedAt })).rejects.toThrow();
    expect(await db.motionComicScripts.snapshot(id)).toEqual(locked);
  }));
  it('rejects changed dependency fingerprint with a fresh project timestamp', async () => fixture(async (db, id) => {
    const { input } = await appliedProposalFixture(db, id);
    const document = await db.motionComicScripts.readProject(id);
    document.sourceDocument!.episodes[0].sourceText += '追加剧情。';
    await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document });
    await expect(db.motionComicScripts.revertProposal({ ...input, expectedUpdatedAt: (await db.motionComicScripts.readProject(id)).updatedAt })).rejects.toThrow('STALE');
    expect((await db.motionComicScripts.snapshot(id)).candidates[0].outputRevision).toBe(2);
  }));
  it('invalidates same-base pending proposals and downstream scripts', async () => fixture(async (db, id) => {
    const { input } = await appliedProposalFixture(db, id);
    const pending = await db.motionComicScripts.beginProposal({ id, taskId: input.taskId, outputRevision: 2, expectedUpdatedAt: input.expectedUpdatedAt, sceneKey: 'scene', beatKey: 'beat', instruction: '继续修改', requestId: 'after-adopt' }, config);
    const downstream = (await db.motionComicScripts.claim(id))!;
    await db.motionComicScripts.finish(downstream, { script: batchScript(), issues: [], adjustments: [] });
    const result = await db.motionComicScripts.revertProposal(input);
    expect(result.proposals!.find(p => p.id === pending.proposal.id)?.status).toBe('stale');
    expect(result.tasks.find(t => t.id === downstream.id)?.status).toBe('stale');
    expect(result.originals).toHaveLength(2);
  }));
  it('marks a legacy approval stale when reverting', async () => fixture(async (db, id) => {
    const { input, adopted } = await appliedProposalFixture(db, id);
    const task = adopted.tasks[0];
    const approval = { sourceEpisodeId: task.sourceEpisodeId, taskId: task.id, outputRevision: 2, inputFingerprint: task.inputFingerprint, script: adopted.candidates[0].script, model: task.model, instructions: task.instructions, approvedAt: input.expectedUpdatedAt, stale: false };
    const sql = (db as unknown as { db: import('sql.js').Database }).db;
    sql.run('INSERT INTO motion_comic_script_approvals(project_id, source_episode_id, data) VALUES (?, ?, ?)', [id, task.sourceEpisodeId, JSON.stringify(approval)]);
    sql.run('UPDATE motion_comic_script_tasks SET data = ? WHERE id = ?', [JSON.stringify({ ...task, status: 'approved' }), task.id]);
    const result = await db.motionComicScripts.revertProposal(input);
    expect(result.approvals[0].stale).toBe(true);
    expect(result.tasks[0].status).toBe('review');
    expect(result.storyboards).toEqual([]);
  }));
  it('persists adopted hash across reopen and reverted history across another reopen', async () => fixture(async (db, id, file) => {
    const { input, adopted } = await appliedProposalFixture(db, id);
    await db.close();
    const reopened = await FileDatabase.open(file);
    let result;
    try {
      expect((await reopened.motionComicScripts.snapshot(id)).proposals).toEqual(adopted.proposals);
      result = await reopened.motionComicScripts.revertProposal(input);
    } finally { await reopened.close(); }
    const again = await FileDatabase.open(file);
    try {
      expect(await again.motionComicScripts.snapshot(id)).toEqual(result);
      await expect(again.motionComicScripts.revertProposal({ ...input, outputRevision: 3 })).rejects.toThrow('NOT_APPLIED');
      expect((await again.motionComicScripts.snapshot(id)).candidates[0].outputRevision).toBe(3);
    } finally { await again.close(); }
  }));
});

describe('durable novel script workflow', () => {
  it('rejects illegal state transitions', () => { expect(() => assertMotionComicScriptTransition('queued', 'approved')).toThrow('TRANSITION'); });
  it('deduplicates, executes in source order, keeps scripts separate from shots, and cascades stale revisions', async () => fixture(async (db, id) => {
    expect((await enqueue(db, id)).tasks).toHaveLength(3);
    expect((await enqueue(db, id)).tasks).toHaveLength(3);
    for (const number of [1, 2, 3]) {
      const task = (await db.motionComicScripts.claim(id))!;
      expect(task.sourceEpisodeId).toBe(`source-${number}`);
      expect(await db.motionComicScripts.claim(id)).toBeNull();
      await db.motionComicScripts.finish(task, { script: batchScript(), issues: [], adjustments: [] });
    }
    const before = await db.motionComicScripts.readProject(id);
    let snapshot = await db.motionComicScripts.snapshot(id);
    await db.motionComicScripts.approve({ id, expectedUpdatedAt: before.updatedAt, revisions: [{ taskId: snapshot.tasks[0].id, outputRevision: 1 }] });
    const approved = await db.motionComicScripts.readProject(id);
    expect(approved.episodes).toEqual(before.episodes);
    const script = batchScript(); script.scenes[0].beats[0].text = '阿青在门口收到来信。';
    snapshot = await db.motionComicScripts.edit({ id, taskId: snapshot.tasks[1].id, outputRevision: 1, expectedUpdatedAt: approved.updatedAt, script });
    expect(snapshot.tasks.map((item) => item.status)).toEqual(['approved', 'review', 'stale']);
    await expect(db.motionComicScripts.approve({ id, expectedUpdatedAt: approved.updatedAt, revisions: [{ taskId: snapshot.tasks[1].id, outputRevision: 1 }] })).rejects.toThrow('REVISION');
    expect((await enqueue(db, id)).tasks).toHaveLength(4);
  }));
  it('persists candidates across restart and recovers interrupted running work', async () => fixture(async (db, id, file) => {
    await enqueue(db, id);
    const first = (await db.motionComicScripts.claim(id))!;
    await db.motionComicScripts.finish(first, { script: batchScript(), issues: [], adjustments: [] });
    await db.motionComicScripts.claim(id);
    await db.close();
    const reopened = await FileDatabase.open(file);
    try { expect((await reopened.motionComicScripts.snapshot(id)).tasks.map((item) => item.status)).toEqual(['script-ready', 'queued', 'queued']); }
    finally { await reopened.close(); }
  }));
  it('confirms assets at approval and reuses them across episodes without invalidating prior approval', async () => fixture(async (db, id) => {
    await enqueue(db, id);
    for (let index = 0; index < 3; index += 1) {
      const task = (await db.motionComicScripts.claim(id))!;
      const script = batchScript();
      script.characters = [{ key: 'person', name: '阿青', aliases: ['青姐'], role: '主角', identityPrompt: '短发', personality: '谨慎', voiceNotes: '低声',
        looks: [{ key: 'look', label: index === 2 ? '夜行服' : '常服', appearancePrompt: '短发', wardrobe: '灰衣', continuityNotes: '左袖补丁' }] }];
      await db.motionComicScripts.finish(task, { script, issues: [], adjustments: [] });
    }
    let snapshot = await db.motionComicScripts.snapshot(id);
    for (const task of snapshot.tasks) {
      const current = await db.motionComicScripts.readProject(id);
      snapshot = await db.motionComicScripts.approve({ id, expectedUpdatedAt: current.updatedAt, revisions: [{ taskId: task.id, outputRevision: 1 }] });
      expect(snapshot.tasks.filter((item) => item.status === 'stale')).toHaveLength(0);
    }
    const document = await db.motionComicScripts.readProject(id);
    expect(document.characters).toHaveLength(1); expect(document.characters[0].looks).toHaveLength(2); expect(document.sceneAssets).toHaveLength(1);
    expect(snapshot.approvals.every((item) => item.assetsConfirmedAt && item.script.characters[0].existingCharacterId === document.characters[0].id)).toBe(true);
    expect(snapshot.candidates[0].script.characters[0].existingCharacterId).toBeUndefined();
    expect(document.assets).toEqual([]); expect(document.providerJobs).toEqual([]);
    expect((await db.motionComicScripts.refresh(id)).tasks.every((item) => item.status === 'approved')).toBe(true);
  }));
  it('rolls back the whole bulk approval when a later episode has an ambiguous identity', async () => fixture(async (db, id) => {
    let document = await db.motionComicScripts.readProject(id);
    document.sceneAssets = ['one', 'two'].map((assetId) => ({ id: assetId, label: '门厅', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: [] }));
    document.series.sceneAssetIds = ['one', 'two'];
    await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document });
    await enqueue(db, id);
    for (let index = 0; index < 2; index += 1) {
      const task = (await db.motionComicScripts.claim(id))!; const script = batchScript();
      if (!index) script.sceneAssets[0].label = '书房';
      await db.motionComicScripts.finish(task, { script, issues: [], adjustments: [] });
    }
    document = await db.motionComicScripts.readProject(id);
    const snapshot = await db.motionComicScripts.snapshot(id);
    await expect(db.motionComicScripts.approve({ id, expectedUpdatedAt: document.updatedAt, revisions: snapshot.tasks.slice(0, 2).map((item) => ({ taskId: item.id, outputRevision: 1 })) })).rejects.toThrow('AMBIGUOUS');
    expect((await db.motionComicScripts.snapshot(id)).approvals).toEqual([]);
    expect((await db.motionComicScripts.readProject(id)).sceneAssets).toEqual(document.sceneAssets);
  }));
  it('runs scripts only and supplies saved prior revisions to the next model call', async () => fixture(async (db, id) => {
    await enqueue(db, id);
    const run = vi.fn().mockResolvedValue({ json: batchScript() });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm }));
    service.start(id); service.start(id); await service.idle(id);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.every(([request]) => request.name === 'motion-comic-script')).toBe(true);
    expect(JSON.parse(run.mock.calls[1][0].messages[1].content).seriesContext.previousScripts).toHaveLength(1);
    expect((await db.motionComicScripts.snapshot(id)).tasks.every((item) => item.status === 'script-ready')).toBe(true);
    expect((await db.motionComicScripts.snapshot(id)).approvals).toEqual([]);
    await service.stop();
  }));
  it('pauses after current work and cancellation never approves results', async () => fixture(async (db, id) => {
    await enqueue(db, id);
    await db.motionComicScripts.control(id, 'pause');
    expect(await db.motionComicScripts.claim(id)).toBeNull();
    await db.motionComicScripts.control(id, 'resume');
    const task = (await db.motionComicScripts.claim(id))!;
    await db.motionComicScripts.control(id, 'cancel', task.id);
    await db.motionComicScripts.finish(task, { script: batchScript(), issues: [], adjustments: [] });
    expect((await db.motionComicScripts.snapshot(id)).candidates).toEqual([]);
  }));
  it('requires approval, runs storyboard only, and persists its separate candidate across restart', async () => fixture(async (db, id, file) => {
    const queued = await enqueue(db, id);
    const document = await db.motionComicScripts.readProject(id);
    const run = vi.fn().mockResolvedValue({ json: batchStoryboard() });
    const runtime = vi.fn().mockResolvedValue({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, runtime);
    try {
      await expect(service.startStoryboard({ id, taskId: queued.tasks[0].id, outputRevision: 1, expectedUpdatedAt: document.updatedAt })).rejects.toThrow('APPROVAL_REQUIRED');
      expect(runtime).not.toHaveBeenCalled();
      const revision = await approveFirst(db, id);
      await service.startStoryboard(revision);
      await service.storyboardIdle(id);
      const snapshot = await db.motionComicScripts.snapshot(id);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][0].name).toBe('motion-comic-storyboard');
      expect(snapshot.storyboards).toHaveLength(1);
      expect(snapshot.storyboards[0].plan.script).toEqual(snapshot.approvals[0].script);
      expect(snapshot.tasks[0].storyboardStatus).toBe('ready');
      expect((await db.motionComicScripts.readProject(id)).episodes).toEqual(document.episodes);
      await service.startStoryboard(revision);
      expect(run).toHaveBeenCalledTimes(1);
      await db.close();
      const reopened = await FileDatabase.open(file);
      try { expect((await reopened.motionComicScripts.snapshot(id)).storyboards).toEqual(snapshot.storyboards); }
      finally { await reopened.close(); }
    } finally { await service.stop(); }
  }));
  it.each([false, true])('accepts unrelated saves but rejects changed source while storyboard runs (source changed: %s)', async (changeSource) => fixture(async (db, id) => {
    const revision = await approveFirst(db, id);
    const started = deferred<void>();
    const response = deferred<{ json: MotionComicStoryboardDraft }>();
    const run = vi.fn().mockImplementation(() => { started.resolve(); return response.promise; });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm }));
    try {
      await service.startStoryboard(revision);
      await started.promise;
      const document = await db.motionComicScripts.readProject(id);
      if (changeSource) document.sourceDocument!.episodes[0].sourceText = '雨夜里，阿青收到两封信。';
      await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document });
      response.resolve({ json: batchStoryboard() });
      await service.storyboardIdle(id);
      const snapshot = await db.motionComicScripts.refresh(id);
      expect(run).toHaveBeenCalledTimes(1);
      expect(snapshot.storyboards).toHaveLength(changeSource ? 0 : 1);
      expect(snapshot.tasks[0].status).toBe(changeSource ? 'stale' : 'approved');
      expect(snapshot.tasks[0].storyboardStatus).toBe(changeSource ? 'failed' : 'ready');
    } finally { response.resolve({ json: batchStoryboard() }); await service.stop(); }
  }));
  it('rechecks approval inside atomic project commit when a source dependency changes', async () => fixture(async (db, id) => {
    const revision = await approveFirst(db, id);
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run: vi.fn().mockResolvedValue({ json: batchStoryboard() }) } as unknown as ConfiguredJsonLlm }));
    try {
      await service.startStoryboard(revision); await service.storyboardIdle(id);
      const { document, storyboard } = await db.motionComicScripts.approvedRevision(revision);
      const next = applyMotionComicPlan(document, storyboard!.plan, { sourceEpisodeId: 'source-1', replaceStarter: isUntouchedMotionComicStarter(document) });
      const changed = batchScript(); changed.scenes[0].beats[0].text = '阿青在门厅接过信。';
      await expect(db.motionComicScripts.edit({ ...revision, script: changed })).rejects.toThrow('REVISION');
      // An approved revision cannot be edited in place, but a source dependency can change.
      const save = { ...document, sourceDocument: { ...document.sourceDocument!, episodes: document.sourceDocument!.episodes.map((item, index) => index ? item : { ...item, continuityHook: '新的线索' }) } };
      await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document: save });
      const current = await db.motionComicScripts.readProject(id);
      const latestRevision = { ...revision, expectedUpdatedAt: current.updatedAt };
      await expect(db.saveMotionComicTask({ id, expectedUpdatedAt: current.updatedAt, document: { ...next, updatedAt: current.updatedAt } }, () => { db.motionComicScripts.assertApprovedRevision(latestRevision); })).rejects.toThrow('APPROVAL_REQUIRED');
      expect((await db.motionComicScripts.readProject(id)).episodes).toEqual(document.episodes);
    } finally { await service.stop(); }
  }));
  it('applies reviewed storyboards without media calls and protects the existing production from reapply', async () => fixture(async (db, id) => {
    const revision = await approveFirst(db, id);
    const run = vi.fn().mockResolvedValue({ json: batchStoryboard() });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm }));
    try {
      await service.startStoryboard(revision); await service.storyboardIdle(id);
      const { document, storyboard } = await db.motionComicScripts.approvedRevision(revision);
      expect(isUntouchedMotionComicStarter(document)).toBe(true);
      const next = applyMotionComicPlan(document, storyboard!.plan, { sourceEpisodeId: 'source-1', replaceStarter: true, reviewedAdjustments: true });
      await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document: next }, () => { db.motionComicScripts.assertApprovedRevision(revision); });
      const saved = await db.motionComicScripts.readProject(id);
      expect(saved.episodes).toHaveLength(1);
      expect(saved.episodes[0].planningEvidence?.sourceEpisodeId).toBe('source-1');
      expect(saved.episodes[0].scenes[0].shots).toHaveLength(1);
      expect(saved.assets).toEqual([]); expect(saved.providerJobs).toEqual([]);
      expect((await db.motionComicScripts.refresh(id)).tasks[0].status).toBe('approved');
      await expect(db.motionComicScripts.approvedRevision({ ...revision, expectedUpdatedAt: saved.updatedAt })).rejects.toThrow('PROTECTED');
      expect(() => applyMotionComicPlan(saved, storyboard!.plan, { sourceEpisodeId: 'source-1' })).toThrow('SOURCE_EPISODE_PLANNED');
      expect(run).toHaveBeenCalledTimes(1);
    } finally { await service.stop(); }
  }));
  it('invalidates approval when the series Bible changes, but ignores reference-only additions', async () => fixture(async (db, id) => {
    const revision = await approveFirst(db, id);
    let document = await db.motionComicScripts.readProject(id);
    document.assets.push({ id: 'reference', assetId: 'reference', kind: 'image', createdAt: document.updatedAt, localPath: 'reference.png' });
    await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document });
    expect((await db.motionComicScripts.refresh(id)).tasks[0].status).toBe('approved');
    document = await db.motionComicScripts.readProject(id);
    document.series.tone = '轻喜剧';
    await db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document });
    const snapshot = await db.motionComicScripts.refresh(id);
    expect(snapshot.tasks[0].status).toBe('stale'); expect(snapshot.approvals[0].stale).toBe(true);
    document = await db.motionComicScripts.readProject(id);
    await expect(db.motionComicScripts.approvedRevision({ ...revision, expectedUpdatedAt: document.updatedAt })).rejects.toThrow('APPROVAL_REQUIRED');
  }));
  it.each(['claim', 'runtime'] as const)('does not call the model when cancelled during %s preflight', async (phase) => fixture(async (db, id) => {
    await enqueue(db, id);
    const entered = deferred<void>(); const gate = deferred<void>();
    if (phase === 'claim') {
      const claim = db.motionComicScripts.claim.bind(db.motionComicScripts);
      vi.spyOn(db.motionComicScripts, 'claim').mockImplementationOnce(async (projectId) => { const task = await claim(projectId); entered.resolve(); await gate.promise; return task; });
    }
    const run = vi.fn().mockResolvedValue({ json: batchScript() });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => {
      if (phase === 'runtime') { entered.resolve(); await gate.promise; }
      return { ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm };
    });
    try {
      service.start(id); await entered.promise;
      const task = (await db.motionComicScripts.snapshot(id)).tasks[0];
      await service.control(id, 'pause');
      await service.control(id, 'cancel', task.id);
      gate.resolve(); await service.idle(id);
      expect(run).not.toHaveBeenCalled();
      expect((await db.motionComicScripts.snapshot(id)).tasks[0].status).toBe('cancelled');
      expect((await db.motionComicScripts.snapshot(id)).candidates).toEqual([]);
    } finally { gate.resolve(); await service.stop(); }
  }));
  it('cancels an in-flight model call, ignores its late result and resumes remaining episodes', async () => fixture(async (db, id) => {
    await enqueue(db, id);
    const entered = deferred<void>();
    const response = deferred<{ json: MotionComicScriptDraft }>();
    let signal: AbortSignal | undefined;
    const run = vi.fn().mockImplementationOnce((request) => {
      signal = request.signal;
      entered.resolve();
      return response.promise;
    }).mockResolvedValue({ json: batchScript() });
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm }));
    try {
      service.start(id); await entered.promise;
      const first = (await db.motionComicScripts.snapshot(id)).tasks[0];
      await service.control(id, 'pause');
      await service.control(id, 'cancel', first.id);
      expect(signal?.aborted).toBe(true);
      response.resolve({ json: batchScript() });
      await service.idle(id);
      const paused = await db.motionComicScripts.snapshot(id);
      expect(paused.tasks.map(task => task.status)).toEqual(['cancelled', 'queued', 'queued']);
      expect(paused.candidates).toEqual([]);
      await service.control(id, 'resume'); await service.idle(id);
      const resumed = await db.motionComicScripts.snapshot(id);
      expect(resumed.tasks.map(task => task.status)).toEqual(['cancelled', 'script-ready', 'script-ready']);
      expect(resumed.candidates).toHaveLength(2);
      expect(run).toHaveBeenCalledTimes(3);
    } finally { response.resolve({ json: batchScript() }); await service.stop(); }
  }));
  it('ignores completions from earlier attempts after recovery', async () => fixture(async (db, id) => {
    await enqueue(db, id);
    const old = (await db.motionComicScripts.claim(id))!;
    await db.motionComicScripts.fail(old, '模拟进程中断', true);
    const current = (await db.motionComicScripts.claim(id))!;
    expect(current.attempt).toBe(old.attempt + 1);
    await db.motionComicScripts.finish(old, { script: batchScript(), issues: [], adjustments: [] });
    await db.motionComicScripts.fail(old, '过时错误');
    expect((await db.motionComicScripts.snapshot(id)).tasks[0].status).toBe('running');
    expect((await db.motionComicScripts.snapshot(id)).candidates).toEqual([]);
    await db.motionComicScripts.finish(current, { script: batchScript(), issues: [], adjustments: [] });
    expect((await db.motionComicScripts.snapshot(id)).tasks[0].status).toBe('script-ready');
  }));
  it('waits for storyboard preflight on shutdown and records interrupted storyboard recovery', async () => fixture(async (db, id, file) => {
    const revision = await approveFirst(db, id);
    const entered = deferred<void>();
    const gate = deferred<void>();
    const original = db.motionComicScripts.approvedRevision.bind(db.motionComicScripts);
    vi.spyOn(db.motionComicScripts, 'approvedRevision').mockImplementation(async (input) => { entered.resolve(); await gate.promise; return original(input); });
    const runtime = vi.fn();
    const service = new MotionComicScriptBatchService(db.motionComicScripts, runtime);
    const starting = service.startStoryboard(revision).catch(() => {});
    await entered.promise;
    let stopped = false;
    const stopping = service.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    gate.resolve(); await starting; await stopping;
    expect(runtime).not.toHaveBeenCalled();
    await db.motionComicScripts.beginStoryboard(revision);
    await db.close();
    const reopened = await FileDatabase.open(file);
    try {
      const snapshot = await reopened.motionComicScripts.snapshot(id);
      expect(snapshot.tasks[0].status).toBe('approved');
      expect(snapshot.tasks[0].storyboardStatus).toBe('failed');
      expect(snapshot.approvals).toHaveLength(1);
    } finally { await reopened.close(); }
  }));
});
