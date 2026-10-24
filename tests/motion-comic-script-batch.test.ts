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
