import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileDatabase } from '../src/shared/storage';
import { resolveProjectActivity, type ProjectProviderActivity } from '../src/shared/project-activity';
import { taskStatusDetail } from '../src/features/projects/project-task-status';
import { MotionComicScriptBatchService } from '../electron/motion-comic-script-batch-service';
import type { ConfiguredJsonLlm } from '../src/shared/llm-provider';
import type { MotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import type { MotionComicScriptRevisionInput } from '../src/shared/motion-comic-script-batch';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { voxProductionSettings, type VoxProductionRun } from '../src/shared/vox-production';

const sourceText = '阿青收到一封信。';
const config = { provider: 'test', model: 'test' };
const script: MotionComicScriptDraft = {
  title: '来信', logline: '一封来信。', characters: [], props: [],
  sceneAssets: [{ key: 'room', label: '门厅', description: '门厅', prompt: '门厅', continuityNotes: '左侧光' }],
  scenes: [{ key: 'scene', actIndex: 1, actTitle: '来信', actBoundaryReason: '信件到来。', title: '来信', summary: '收到信件。', locationKey: 'room',
    beats: [{ key: 'beat', sourceUnitIds: ['S1'], kind: 'action', text: sourceText }] }],
};

async function fixture(run: (db: FileDatabase, id: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'storydream-project-activity-'));
  const db = await FileDatabase.open(join(root, 'data.db'));
  try {
    const task = await db.createMotionComicTask({ title: '来信', premise: sourceText, source: {
      kind: 'novel', adaptationMode: 'novel-adaptation', fileName: '来信.txt', originalText: sourceText,
      episodes: [{ title: '第一集', sourceText }],
    } });
    await run(db, task.id);
  } finally { await db.close(); await rm(root, { recursive: true, force: true }); }
}

async function enqueue(db: FileDatabase, id: string) {
  const document = await db.motionComicScripts.readProject(id);
  return db.motionComicScripts.enqueue({ id, expectedUpdatedAt: document.updatedAt, scope: 'missing' }, config);
}

describe('project activity summaries', () => {
  it('shows durable script work and reviews without locking the editable project or returning heavy fields', async () => fixture(async (db, id) => {
    const changed = vi.fn();
    db.motionComicScripts.onChange = changed;
    expect((await db.getTaskSummary(id))?.projectActivity?.detail).toBe('当前阶段：分集剧本');
    await enqueue(db, id);
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('pending');
    const claimed = (await db.motionComicScripts.claim(id))!;
    const summary = (await db.listTaskSummaries()).items[0];
    expect(summary.status).toBe('draft');
    expect(summary.projectActivity).toMatchObject({ status: 'running', detail: '正在生成剧本 · 剧本 0/1 集' });
    expect(taskStatusDetail(summary)).toContain('正在生成剧本');
    expect(summary).not.toHaveProperty('pipelineData');
    expect(summary).not.toHaveProperty('inputText');
    const document = await db.motionComicScripts.readProject(id);
    await expect(db.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document })).resolves.toBeTruthy();
    await db.motionComicScripts.finish(claimed, { script, issues: [], adjustments: [] });
    expect((await db.getTaskSummary(id))?.projectActivity).toMatchObject({ label: '待审核' });
    expect(changed.mock.calls).toEqual([[id], [id], [id]]);
    const current = await db.motionComicScripts.readProject(id);
    const revision: MotionComicScriptRevisionInput = { id, taskId: claimed.id, outputRevision: 1, expectedUpdatedAt: current.updatedAt };
    await db.motionComicScripts.approve({ id, expectedUpdatedAt: current.updatedAt, revisions: [{ taskId: revision.taskId, outputRevision: revision.outputRevision }] });
    expect((await db.getTaskSummary(id))?.projectActivity?.detail).toContain('剧本已批准');
    revision.expectedUpdatedAt = (await db.motionComicScripts.readProject(id)).updatedAt;
    await db.motionComicScripts.beginStoryboard(revision);
    expect((await db.getTaskSummary(id))?.projectActivity).toMatchObject({ status: 'running', detail: '正在生成分镜' });
    await db.motionComicScripts.failStoryboard(revision, 'offline');
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('failed');
    await db.motionComicScripts.beginStoryboard(revision);
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('running');
  }));

  it('tracks a detached worker through completion using committed change notifications', async () => fixture(async (db, id) => {
    await enqueue(db, id);
    let resolve!: (value: { json: MotionComicScriptDraft }) => void;
    const run = vi.fn(() => new Promise<{ json: MotionComicScriptDraft }>((done) => { resolve = done; }));
    const published: Promise<string | undefined>[] = [];
    db.motionComicScripts.onChange = (projectId) => { published.push(db.getTaskSummary(projectId).then((item) => item?.projectActivity?.label)); };
    const service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm }));
    try {
      service.start(id);
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
      expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('running');
      resolve({ json: script });
      await service.idle(id);
      expect((await db.getTaskSummary(id))?.projectActivity?.label).toBe('待审核');
      expect(await Promise.all(published)).toContain('运行中');
      expect(await Promise.all(published)).toContain('待审核');
    } finally { await service.stop(); }
  }));

  it('handles pause and retries using the latest script attempt', async () => fixture(async (db, id) => {
    await enqueue(db, id);
    await db.motionComicScripts.control(id, 'pause');
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('paused');
    await db.motionComicScripts.control(id, 'resume');
    const first = (await db.motionComicScripts.claim(id))!;
    await db.motionComicScripts.fail(first, 'offline');
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('failed');
    await enqueue(db, id);
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('pending');
    const retry = (await db.motionComicScripts.claim(id))!;
    await db.motionComicScripts.finish(retry, { script, issues: [], adjustments: [] });
    expect((await db.getTaskSummary(id))?.projectActivity?.label).toBe('待审核');
    const changed = vi.fn();
    db.motionComicScripts.onChange = changed;
    await expect(db.motionComicScripts.approve({ id, expectedUpdatedAt: '2000-01-01T00:00:00.000Z', revisions: [{ taskId: retry.id, outputRevision: 1 }] })).rejects.toThrow('MOTION_COMIC_STALE_WRITE');
    expect(changed).not.toHaveBeenCalled();
  }));

  it('reads persisted director batches and isolates concurrent live operations', async () => fixture(async (db, id) => {
    const batch = await db.createDirectorBatch({ workflowKind: 'director', projectId: id, status: 'running', concurrency: 1,
      plan: { scope: 'missing', capabilities: { image: true, video: false, voice: false, render: false }, outputReady: false, renderFailed: false, shots: [] },
      nodes: [{ id: 'image', capability: 'image', title: '画面', status: 'running', estimatedCost: 0, dependencies: [] }],
    });
    expect((await db.getTaskSummary(id))?.projectActivity).toMatchObject({ status: 'running', detail: '正在批量生成 · 0/1' });
    await db.updateDirectorBatch(batch.id, { status: 'failed' });
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('failed');
    const retry = await db.createDirectorBatch({ ...batch, id: undefined, status: 'completed', nodes: [{ ...batch.nodes[0], status: 'completed' }] });
    expect((await db.getTaskSummary(id))?.projectActivity?.label).toBe('制作中');
    const finishFirst = db.beginProjectActivity(id, '正在渲染成片');
    const finishSecond = db.beginProjectActivity(id, '正在生成镜头视频');
    finishFirst();
    expect((await db.getTaskSummary(id))?.projectActivity).toMatchObject({ status: 'running', detail: '正在生成镜头视频' });
    finishSecond();
    expect((await db.getTaskSummary(id))?.projectActivity?.label).toBe('制作中');
    await db.deleteDirectorBatch(retry.id);
    expect((await db.getTaskSummary(id))?.projectActivity?.status).toBe('failed');
    const ordinary = await db.createTask({ title: '普通任务', inputText: '正文', taskType: 'story' });
    await db.updateTask(ordinary.id, { status: 'draft' });
    expect((await db.getTaskSummary(ordinary.id))?.projectActivity).toBeUndefined();
  }));

  it('summarizes VOX production nodes without exposing the production document', async () => fixture(async (db) => {
    const task = await db.createEditorialCollageTask({ title: 'VOX 制作', sourceText });
    let document = parseEditorialCollagePipelineData(task.pipelineData);
    const run: VoxProductionRun = {
      version: 1, id: 'production', status: 'running', settings: voxProductionSettings(), sourceHash: 'source', runtimeIdentity: 'test',
      createdAt: task.createdAt, updatedAt: task.createdAt,
      nodes: [{ id: 'image', kind: 'image', dependencies: [], status: 'running', paid: true, attempt: 1 }],
    };
    const save = async (status: VoxProductionRun['status']) => {
      const saved = await db.saveEditorialCollageTask({ id: task.id, expectedUpdatedAt: document.updatedAt, document: { ...document, productionRun: { ...run, status } } }, run.id);
      document = parseEditorialCollagePipelineData(saved.pipelineData);
      return db.getTaskSummary(task.id);
    };
    expect((await save('running'))?.projectActivity).toMatchObject({ status: 'running', detail: '正在生成画面 · 0/1' });
    expect((await save('paused'))?.projectActivity?.status).toBe('paused');
    expect((await save('failed'))?.projectActivity?.status).toBe('failed');
    const completed = await save('completed');
    expect(completed?.projectActivity?.status).toBe('completed');
    expect(completed).not.toHaveProperty('productionRun');
    expect(completed).not.toHaveProperty('pipelineData');
  }));
});

describe('project activity precedence', () => {
  const empty = { scripts: [], batches: [], jobs: [] };
  const job: ProjectProviderActivity = { nodeId: 'shot', capability: 'image-to-video', status: 'running', attempt: 1, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' };
  it('ignores superseded provider attempts and distinguishes assets from final completion', () => {
    expect(resolveProjectActivity(empty)).toBeUndefined();
    expect(resolveProjectActivity({ ...empty, jobs: [job] })?.status).toBe('running');
    const completed = { ...job, attempt: 2, status: 'completed' as const };
    expect(resolveProjectActivity({ ...empty, jobs: [completed, job] })?.label).toBe('制作中');
    expect(resolveProjectActivity({ ...empty, jobs: [{ ...job, status: 'failed' }, completed] })?.status).toBe('draft');
    expect(resolveProjectActivity({ ...empty, stage: 'completed', jobs: [completed] })?.status).toBe('completed');
    expect(resolveProjectActivity({ ...empty, stage: 'completed', jobs: [job] })?.status).toBe('running');
  });
  it('ignores applied storyboards and keeps actual work ahead of paused queues and historical failures', () => {
    expect(resolveProjectActivity({ ...empty, scripts: [{ status: 'approved', storyboardStatus: 'ready', applied: true }] })).toBeUndefined();
    expect(resolveProjectActivity({ ...empty, scripts: [{ status: 'approved', storyboardStatus: 'ready', applied: false }] })?.label).toBe('待审核');
    expect(resolveProjectActivity({ ...empty, paused: true, scripts: [{ status: 'queued', applied: false }, { status: 'running', applied: false }] })?.status).toBe('running');
    expect(resolveProjectActivity({ ...empty, batches: [{ status: 'failed', total: 1, completed: 0 }], jobs: [job] })?.status).toBe('running');
  });
});
