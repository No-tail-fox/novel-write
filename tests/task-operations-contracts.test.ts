import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ORDINARY_TASK_STAGES,
  assertTaskLifecycleAction,
  taskProgressSnapshot,
  taskProgressStages,
  taskStepPosition,
  taskTerminalStep,
} from '../src/shared/task-progress';
import { collectTaskEventPages } from '../src/shared/state-reconciliation';
import { FileDatabase } from '../src/shared/storage';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import type { Task } from '../src/shared/types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Task',
    inputText: 'input',
    taskKind: 'story',
    processingMode: 'full-auto',
    publishMode: 'review-rewrite',
    status: 'running',
    currentStep: 0,
    track: 'character-story',
    style: 'photo-real',
    speaker: 'voice',
    ratio: '9:16',
    templateId: 'default',
    bgmId: '',
    pausePoints: [],
    outputDir: '',
    errorMessage: '',
    createdAt: '2026-07-20T00:00:00.000Z',
    completedAt: null,
    startedAt: null,
    lastHeartbeatAt: null,
    mode: 'paste',
    aiKeyword: '',
    aiSources: [],
    selectedSources: [],
    extraRequirements: '',
    imagePromptReference: '',
    promptTemplateId: null,
    promptTemplateType: null,
    referenceImagePath: '',
    rewriteIntensity: 'standard',
    narrativePov: 'keep-original',
    keepPromotion: false,
    ttsProvider: 'volcengine',
    ttsSpeed: 1,
    step3PromptSnapshot: '',
    musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
    failedStep: null,
    retryFromStep: null,
    artifactStatePath: '',
    videoForm: 'narration',
    llmProfileId: null,
    materialSource: 'ai',
    productInfo: null,
    materialPerson: null,
    draftDir: null,
    fixedIntro: null,
    outroCta: null,
    lockIntroSentences: 0,
    taskType: 'story',
    pipelineStep: 'new',
    pipelineData: '{}',
    targetLength: 1500,
    scriptFormat: 'narration',
    podcastImageMode: 'multi',
    podcastSpeakers: null,
    podcastSpeakerA: null,
    podcastSpeakerB: null,
    coverImageMode: 'off',
    coverTemplateId: 'cinematic-poster',
    runGeneration: 0,
    ...overrides,
  };
}

describe('task operation contracts', () => {
  it('centralizes seven ordinary stages and one-based step positions', () => {
    expect(ORDINARY_TASK_STAGES).toHaveLength(7);
    expect(taskStepPosition(4)).toBe(5);
    expect(taskTerminalStep(task())).toBe(7);
    expect(taskProgressSnapshot(task({ currentStep: 4 }))).toMatchObject({ completed: 4, total: 7, position: 5 });
  });

  it('reports HTML and clip-only progress against their real terminal steps', () => {
    expect(taskTerminalStep(task({ taskType: 'html-video' }))).toBe(6);
    expect(taskProgressStages(task({ taskType: 'html-video' }))).toHaveLength(6);
    expect(taskProgressStages(task({ taskType: 'html-video' }))[0]).toMatchObject({ title: '改写 + 分句' });
    expect(taskProgressSnapshot(task({ taskType: 'html-video', status: 'completed', currentStep: 6 }))).toMatchObject({ completed: 6, total: 6 });
    expect(taskTerminalStep(task({ processingMode: 'clip-only' }))).toBe(4);
    expect(taskProgressStages(task({ processingMode: 'clip-only' }))).toHaveLength(4);
    expect(taskProgressSnapshot(task({ processingMode: 'clip-only', status: 'completed', currentStep: 4 }))).toMatchObject({ completed: 4, total: 4 });
  });

  it('makes task detail consume every cursor page and removes inline progress guesses', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const detail = await readFile(new URL('../src/features/tasks/TaskDetailPage.tsx', import.meta.url), 'utf8');
    const refresh = main.slice(main.indexOf('const refreshTaskDetail'), main.indexOf('const refreshViralEvents'));

    expect(refresh).toContain('collectTaskEventPages');
    expect(refresh).toContain('api.listTaskEvents(taskId, { cursor, limit: 100 })');
    expect(detail).toContain('taskProgressSnapshot(activeTask)');
    expect(detail).toContain('taskProgressStages(activeTask)');
    expect(detail).toContain('progressStages.map');
    expect(detail).toContain('{progress.total} 步流水线');
    expect(detail).not.toContain('7 步流水线');
    expect(detail).not.toContain('pipelineSteps.length');
    expect(main).not.toContain('task.currentStep >= 7');
  });

  it('collects task event pages by sequence in timeline order and rejects cursor loops', async () => {
    const event = (seq: number) => ({ taskId: 'task-1', seq, type: 'step', step: 0, agent: null, tool: null, detail: String(seq), dataJson: null, ts: seq });
    const items = await collectTaskEventPages(
      { items: [event(3), event(2)], nextCursor: 'page-2' },
      async () => ({ items: [event(2), event(1)], nextCursor: null }),
    );
    expect(items.map((item) => item.seq)).toEqual([1, 2, 3]);

    await expect(collectTaskEventPages(
      { items: [event(1)], nextCursor: 'loop' },
      async () => ({ items: [], nextCursor: 'loop' }),
    )).rejects.toThrow(/CURSOR_LOOP/u);
  });

  it('maps continue, retry, and cancel to distinct legal queue commands', async () => {
    const queue = await readFile(new URL('../src/features/tasks/QueuePage.tsx', import.meta.url), 'utf8');

    expect(queue).toContain('continueTask');
    expect(queue).toContain("api.updateTaskStatus(task.id, 'running')");
    expect(queue).toContain('retryFailedTask');
    expect(queue).toContain('api.retryTask(task.id)');
    expect(queue.match(/>继续<\/button>/gu)).toHaveLength(1);
    expect(queue.match(/>重试<\/button>/gu)).toHaveLength(1);
    expect(queue).toContain("task.status === 'paused'");
    expect(queue).toContain("task.status === 'failed' || task.status === 'cancelled'");
  });

  it('isolates task event writes and cursors by persisted run generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-task-generation-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      const created = await db.createTask({ inputText: 'generation test' });
      const firstRun = await db.beginTaskRun(created.id);
      expect(firstRun.runGeneration).toBe(1);
      await db.addTaskEvent(created.id, { type: 'step', detail: 'first-a', runGeneration: 1 });
      await db.addTaskEvent(created.id, { type: 'step', detail: 'first-b', runGeneration: 1 });
      const firstPage = await db.listTaskEvents(created.id, { limit: 1 });
      expect(firstPage.nextCursor).toBeTruthy();

      const secondRun = await db.beginTaskRun(created.id);
      expect(secondRun.runGeneration).toBe(2);
      await db.addTaskEvent(created.id, { type: 'step', detail: 'second', runGeneration: 2 });

      await expect(db.addTaskEvent(created.id, { type: 'step', detail: 'stale', runGeneration: 1 }))
        .rejects.toThrow(/STALE_TASK_RUN/u);
      await expect(db.listTaskEvents(created.id, { limit: 1, cursor: firstPage.nextCursor }))
        .rejects.toThrow(/CURSOR_STALE/u);
      const current = await db.listTaskEvents(created.id, { limit: 10 });
      expect(current.items.map((event) => [event.detail, event.runGeneration])).toEqual([['second', 2]]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('begins a generation before every initial or resumed task runtime', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const createHandler = main.slice(main.indexOf("trustedHandle('task:create-and-run'"), main.indexOf("trustedHandle('viral:create-and-run'"));
    const htmlCreateHandler = main.slice(main.indexOf("trustedHandle('html-video:create-task'"), main.indexOf("trustedHandle('html-video:update-config'"));
    const viralProductionHandler = main.slice(main.indexOf("trustedHandle('viral:create-production-task'"), main.indexOf("trustedHandle('task:update-status'"));
    const resume = main.slice(main.indexOf('async function resumeTaskRun'), main.indexOf('async function resumeLatestTaskRun'));
    expect(createHandler).toContain('beginTaskRun');
    expect(htmlCreateHandler).toContain('beginTaskRun');
    expect(viralProductionHandler).toContain('beginTaskRun');
    expect(resume).toContain('beginTaskRun');
  });

  it('writes artifact restart events inside the newly begun run generation', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    for (const [channel, nextChannel] of [
      ['task:regenerate-image', 'task:regenerate-narration'],
      ['task:regenerate-narration', 'task:update-image-prompt'],
      ['task:rerun-step', 'task:get-artifacts'],
    ] as const) {
      const handler = main.slice(main.indexOf(`trustedHandle('${channel}'`), main.indexOf(`trustedHandle('${nextChannel}'`));
      const resume = handler.slice(handler.indexOf('resumeLatestTaskRun('));
      expect(resume).toContain('async (runningTask) =>');
      expect(resume).toContain('runGeneration: runningTask.runGeneration');
      expect(resume.indexOf('addTaskEvent')).toBeLessThan(resume.indexOf('publishTaskEvent'));
    }
  });

  it('evicts prior-generation task events during reconciliation and delta replay', async () => {
    const [reconciliation, delta] = await Promise.all([
      readFile(new URL('../src/shared/state-reconciliation.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/state-delta.ts', import.meta.url), 'utf8'),
    ]);
    const merge = reconciliation.slice(reconciliation.indexOf('export function mergeReconciliationSlices'), reconciliation.indexOf('export function mergeBootstrapTemplateDetails'));
    expect(merge).toContain('result.task?.runGeneration');
    expect(merge).toContain('event.runGeneration === result.task!.runGeneration');
    expect(delta).toContain('delta.event.runGeneration !== task.runGeneration');
    expect(delta).toContain('filterTaskEventsByGeneration');
  });

  it('accepts only legal lifecycle actions and rejects archived tasks', () => {
    expect(() => assertTaskLifecycleAction(task({ status: 'paused' }), 'continue')).not.toThrow();
    expect(() => assertTaskLifecycleAction(task({ status: 'running' }), 'pause')).not.toThrow();
    expect(() => assertTaskLifecycleAction(task({ status: 'paused' }), 'pause')).not.toThrow();
    expect(() => assertTaskLifecycleAction(task({ status: 'pending' }), 'cancel')).not.toThrow();
    expect(() => assertTaskLifecycleAction(task({ status: 'cancelled' }), 'cancel')).not.toThrow();
    expect(() => assertTaskLifecycleAction(task({ status: 'failed' }), 'retry')).not.toThrow();
    expect(() => assertTaskLifecycleAction(task({ status: 'running' }), 'retry')).toThrow(/TASK_LIFECYCLE_INVALID/u);
    expect(() => assertTaskLifecycleAction(task({ status: 'running' }), 'retry', { hasActiveRun: true })).not.toThrow();
    expect(() => assertTaskLifecycleAction(task({ status: 'completed' }), 'pause', { hasActiveRun: true }))
      .toThrow(/TASK_LIFECYCLE_INVALID/u);
    expect(() => assertTaskLifecycleAction(task({ status: 'completed' }), 'cancel', { hasActiveRun: true }))
      .toThrow(/TASK_LIFECYCLE_INVALID/u);
    expect(() => assertTaskLifecycleAction(task({ status: 'paused', archivedAt: '2026-07-20T00:00:00.000Z' }), 'continue'))
      .toThrow(/TASK_ARCHIVED/u);

    expect(ipcInputSchemas['task:update-status'].safeParse({ id: 'task-1', status: 'running' }).success).toBe(true);
    expect(ipcInputSchemas['task:update-status'].safeParse({ id: 'task-1', status: 'completed' }).success).toBe(false);
  });

  it('guards both task control handlers before resuming runtime work', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const update = main.slice(main.indexOf("trustedHandle('task:update-status'"), main.indexOf("trustedHandle('task:retry'"));
    const retry = main.slice(main.indexOf("trustedHandle('task:retry'"), main.indexOf("trustedHandle('task:regenerate-image'"));
    expect(update).toContain('assertTaskLifecycleAction');
    expect(retry).toContain('assertTaskLifecycleAction');
    expect(update.indexOf('assertTaskLifecycleAction')).toBeLessThan(update.indexOf('taskWorkDir'));
    expect(retry.indexOf('assertTaskLifecycleAction')).toBeLessThan(retry.indexOf('taskWorkDir'));
    const intentPersistence = main.slice(main.indexOf('async function applyTaskRunIntent'), main.indexOf('async function runHtmlVideoTask'));
    expect(intentPersistence).toContain('assertTaskLifecycleAction(latestTask, action, { hasActiveRun: true })');
  });
});
