import type { ConfiguredJsonLlm } from '../src/shared/llm-provider';
import { generateMotionComicPlan, generateMotionComicScript } from '../src/shared/motion-comic-planner';
import type { MotionComicScriptStore } from '../src/shared/motion-comic-script-store';
import type { MotionComicScriptTask, MotionComicScriptCandidate, MotionComicScriptRevisionInput } from '../src/shared/motion-comic-script-batch';

export interface MotionComicScriptRuntime {
  provider: string;
  model: string;
  llm: ConfiguredJsonLlm;
}

/** Durable per-project serial worker. UI lifetime never owns script execution. */
export class MotionComicScriptBatchService {
  private readonly workers = new Map<string, { controller: AbortController; completion: Promise<void>; taskId?: string; wake: boolean }>();
  private stopping = false;
  private readonly storyboardWorkers = new Map<string, { controller: AbortController; completion: Promise<void> }>();
  get busy(): boolean { return this.workers.size > 0 || this.storyboardWorkers.size > 0; }

  constructor(private readonly store: MotionComicScriptStore, private readonly runtime: () => Promise<MotionComicScriptRuntime>,
    private readonly onError: (error: unknown) => void = console.error) {}

  start(projectId: string): void {
    if (this.stopping) return;
    const existing = this.workers.get(projectId);
    if (existing) { existing.wake = true; return; }
    const worker = { controller: new AbortController(), completion: Promise.resolve(), taskId: undefined as string | undefined, wake: false };
    this.workers.set(projectId, worker);
    worker.completion = this.run(projectId, worker).catch(this.onError).finally(() => {
      this.workers.delete(projectId);
      if (worker.wake && !this.stopping) this.start(projectId);
    });
  }

  async restore(): Promise<void> { for (const id of await this.store.pendingProjects()) this.start(id); }

  async control(projectId: string, action: 'pause' | 'resume' | 'cancel', taskId?: string) {
    const snapshot = await this.store.control(projectId, action, taskId);
    if (action === 'cancel' && this.workers.get(projectId)?.taskId === taskId) this.workers.get(projectId)?.controller.abort();
    if (action === 'resume') this.start(projectId);
    return snapshot;
  }

  async idle(projectId: string): Promise<void> {
    while (this.workers.has(projectId)) await this.workers.get(projectId)?.completion;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const worker of this.workers.values()) worker.controller.abort();
    for (const worker of this.storyboardWorkers.values()) worker.controller.abort();
    await Promise.all([...this.workers.values(), ...this.storyboardWorkers.values()].map((worker) => worker.completion));
  }

  async startStoryboard(input: MotionComicScriptRevisionInput) {
    if (this.stopping) throw new Error('MOTION_COMIC_STOPPING: 应用正在退出。');
    if (this.storyboardWorkers.has(input.id)) throw new Error('MOTION_COMIC_STORYBOARD_BUSY: 本项目已有分镜任务。');
    let complete!: () => void;
    const worker = { controller: new AbortController(), completion: new Promise<void>((resolve) => { complete = resolve; }) };
    this.storyboardWorkers.set(input.id, worker);
    try {
      const approved = await this.store.approvedRevision(input);
      worker.controller.signal.throwIfAborted();
      const snapshot = await this.store.beginStoryboard(input);
      worker.controller.signal.throwIfAborted();
      if (approved.storyboard) { this.storyboardWorkers.delete(input.id); complete(); return snapshot; }
      void (async () => {
        try {
          const runtime = await this.runtime();
          worker.controller.signal.throwIfAborted();
          const { document, task, approval } = await this.store.approvedRevision(input, true);
          if (runtime.provider !== task.provider || runtime.model !== task.model) throw new Error('生成模型或渠道已变化，请恢复已批准剧本使用的配置后重试。');
          const source = document.sourceDocument!.episodes.find((item) => item.id === task.sourceEpisodeId)!;
          const candidate = (await this.store.snapshot(input.id)).candidates.find((item) => item.taskId === task.id)!;
          worker.controller.signal.throwIfAborted();
          const result = await generateMotionComicPlan({ id: input.id, expectedUpdatedAt: document.updatedAt,
            sourceText: source.sourceText, instructions: approval.instructions, targetDurationSec: approval.targetDurationSec }, document, runtime.llm,
          { model: runtime.model, signal: worker.controller.signal, resume: { script: approval.script, adjustments: candidate.adjustments, repaired: false } });
          worker.controller.signal.throwIfAborted();
          await this.store.saveStoryboard(input, { taskId: task.id, outputRevision: approval.outputRevision, plan: result.plan, warnings: result.warnings });
        } catch (error) {
          await this.store.failStoryboard(input, error instanceof Error ? error.message : String(error));
        }
      })().catch(this.onError).finally(() => { this.storyboardWorkers.delete(input.id); complete(); });
      return snapshot;
    } catch (error) {
      try { await this.store.failStoryboard(input, error instanceof Error ? error.message : String(error)); }
      finally { this.storyboardWorkers.delete(input.id); complete(); }
      throw error;
    }
  }

  async storyboardIdle(projectId: string): Promise<void> { await this.storyboardWorkers.get(projectId)?.completion; }

  private async run(projectId: string, worker: { controller: AbortController; taskId?: string; wake: boolean }): Promise<void> {
    while (!this.stopping) {
      worker.wake = false;
      worker.controller = new AbortController();
      const task = await this.store.claim(projectId);
      if (!task) return;
      worker.taskId = task.id;
      try {
        if (this.stopping || worker.controller.signal.aborted) { await this.interrupted(task); continue; }
        const current = (await this.store.snapshot(projectId)).tasks.find((item) => item.id === task.id);
        if (current?.status !== 'running' || current.attempt !== task.attempt) continue;
        worker.controller.signal.throwIfAborted();
        const runtime = await this.runtime();
        if (runtime.provider !== task.provider || runtime.model !== task.model) throw new Error('生成模型或渠道已变化，请按当前配置重新提交；不会静默切换模型。');
        const document = await this.store.readProject(projectId);
        const source = document.sourceDocument?.episodes.find((item) => item.id === task.sourceEpisodeId);
        if (!source) throw new Error('源分集已删除。');
        const { prior } = this.store.dependencies(document, task, await this.store.snapshot(projectId));
        if (this.stopping || worker.controller.signal.aborted) { await this.interrupted(task); continue; }
        let invalid: Pick<MotionComicScriptCandidate, 'script' | 'issues' | 'adjustments'> | undefined;
        try {
          const result = await generateMotionComicScript({ id: projectId, expectedUpdatedAt: document.updatedAt,
            sourceText: source.sourceText, instructions: task.instructions, targetDurationSec: task.targetDurationSec }, document, runtime.llm,
          { model: runtime.model, signal: worker.controller.signal, previousScripts: prior, onScriptInvalid: async (failure) => { invalid = failure; } });
          if (!worker.controller.signal.aborted) await this.store.finish(task, { script: result.script, adjustments: result.adjustments, issues: [] });
          else await this.interrupted(task);
        } catch (error) {
          if (invalid && !worker.controller.signal.aborted) await this.store.finish(task, invalid);
          else throw error;
        }
      } catch (error) {
        await this.store.fail(task, error instanceof Error ? error.message : String(error), this.stopping);
      } finally {
        worker.taskId = undefined;
      }
    }
  }

  private async interrupted(task: MotionComicScriptTask): Promise<void> { await this.store.fail(task, '执行中断，等待恢复。', this.stopping); }
}
