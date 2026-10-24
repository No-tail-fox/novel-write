import { createHash, randomUUID } from 'node:crypto';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, recoverVoxProductionRun, voxProductionInputErrors, type VoxProductionControl, type VoxProductionNode, type VoxProductionSettings, type VoxProductionStart } from '../src/shared/vox-production';

export const voxInputHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface VoxProductionStore {
  load(id: string): Promise<EditorialCollagePipelineData>;
  save(document: EditorialCollagePipelineData, owner?: string): Promise<EditorialCollagePipelineData>;
  projects(): Promise<string[]>;
  acquire?(id: string): () => void;
  checkpoint?(id: string, node: VoxProductionNode, result: EditorialCollagePipelineData): Promise<void>;
  recover?(id: string, node: VoxProductionNode): Promise<EditorialCollagePipelineData | undefined>;
}
export interface VoxProductionRuntime {
  identity: string;
  preflight(document: EditorialCollagePipelineData, settings: VoxProductionSettings, pending?: readonly VoxProductionNode[]): void | (() => void) | Promise<void | (() => void)>;
  isPaid?(document: EditorialCollagePipelineData, node: VoxProductionNode): boolean;
  input(document: EditorialCollagePipelineData, node: VoxProductionNode): unknown;
  execute(document: EditorialCollagePipelineData, node: VoxProductionNode): Promise<EditorialCollagePipelineData>;
  /** Read existing provider receipts only; this method must never dispatch generation. */
  recover?(document: EditorialCollagePipelineData, node: VoxProductionNode): Promise<EditorialCollagePipelineData | undefined>;
}

/** One serial writer per project. A route unmount has no execution ownership. */
export class VoxProductionService {
  private workers = new Map<string, Promise<void>>();
  get busy(): boolean { return this.workers.size > 0 || this.starts.size > 0; }
  private intents = new Map<string, 'pause' | 'cancel'>();
  private starts = new Set<string>();
  private stopping = false;
  constructor(private store: VoxProductionStore, private runtime: (id: string) => Promise<VoxProductionRuntime>, private onError: (error: unknown) => void = console.error) {}

  private reusable(document: EditorialCollagePipelineData, nodes: VoxProductionNode[], runtime: VoxProductionRuntime) {
    const invalid = new Set<string>();
    return nodes.map(node => {
      if (node.status !== 'completed' || node.inputHash !== voxInputHash(runtime.input(document, node)) || node.dependencies.some(dep => invalid.has(dep))) {
        invalid.add(node.id);
        return { ...node, status: 'pending' as const, error: undefined };
      }
      return node;
    });
  }

  async restore() {
    for (const id of await this.store.projects()) {
      try {
        const document = await this.store.load(id);
        if (!document.productionRun || !['running', 'paused'].includes(document.productionRun.status)) continue;
        await this.store.save({ ...document, productionRun: recoverVoxProductionRun(document.productionRun) }, document.productionRun.id);
      } catch (error) {
        // A historical project's recovery failure must not prevent the desktop from opening.
        const detail = error instanceof Error ? error.message : String(error);
        this.onError(new Error(`VOX_PRODUCTION_RESTORE_FAILED: ${id}: ${detail}`, { cause: error }));
      }
    }
  }
  async start(input: VoxProductionStart) {
    if (this.stopping || this.starts.has(input.id) || this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 项目已有制作任务。');
    this.starts.add(input.id);
    let release: (() => void) | undefined, releaseCapacity: (() => void) | undefined;
    try {
      release = this.store.acquire?.(input.id);
      const document = await this.store.load(input.id);
      if (document.productionRun?.status === 'running') throw new Error('VOX_PRODUCTION_BUSY: 项目已有制作任务。');
      if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('VOX_PRODUCTION_STALE: 项目已变化，请重新打开后制作。');
      if (document.productionRun?.nodes.some(node => node.status === 'unknown' || node.status === 'running' && node.paid)) throw new Error('VOX_PRODUCTION_UNKNOWN: 请先核对上次云端请求，不能重新收费提交。');
      const errors = voxProductionInputErrors(document, input.settings);
      if (errors.length) throw new Error(errors.join('\n'));
      const runtime = await this.runtime(input.id);
      let nodes = buildVoxProductionNodes(document, input.settings);
      const previous = document.productionRun;
      if (previous && previous.sourceHash === voxInputHash(document.sourceText) && previous.runtimeIdentity === runtime.identity) {
        const prior = new Map(previous.nodes.map(n => [n.id, n]));
        const candidate = { ...document, productionRun: { ...previous, settings: input.settings } };
        nodes = this.reusable(candidate, nodes.map(n => {
          const old = prior.get(n.id);
          return old?.status === 'completed' && JSON.stringify(old.dependencies) === JSON.stringify(n.dependencies) ? { ...n, paid: old.paid, status: old.status, inputHash: old.inputHash, requestId: old.requestId, attempt: old.attempt } : n;
        }), runtime);
      }
      releaseCapacity = await runtime.preflight(document, input.settings, nodes.filter(n => n.status === 'pending')) || undefined;
      const now = new Date().toISOString();
      const runId = randomUUID();
      const next = await this.store.save({ ...document, productionSettings: input.settings, productionRun: {
        version: 1, id: runId, status: 'running', settings: input.settings,
        sourceHash: voxInputHash(document.sourceText), runtimeIdentity: runtime.identity,
        nodes, createdAt: now, updatedAt: now,
      } }, runId);
      this.launch(input.id, runtime, release, releaseCapacity); release = undefined; releaseCapacity = undefined;
      return next.productionRun!;
    } finally { release?.(); releaseCapacity?.(); this.starts.delete(input.id); }
  }
  async control(input: VoxProductionControl) {
    if (this.starts.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 正在更新任务。');
    this.starts.add(input.id);
    let release: (() => void) | undefined, releaseCapacity: (() => void) | undefined;
    try {
    const document = await this.store.load(input.id), run = document.productionRun;
    if (!run || run.id !== input.runId) throw new Error('VOX_PRODUCTION_STALE: 制作任务已变化。');
    if (input.action === 'reconcile' || input.action === 'confirm-no-result') {
      if (this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 请等待当前步骤保存。');
      if (input.action === 'confirm-no-result') {
        if (!input.evidence || input.evidence.trim().length < 8 || !run.nodes.some(n => n.id === input.nodeId && n.status === 'unknown')) throw new Error('请填写服务商确认无结果的核对依据。');
        return (await this.store.save({ ...document, productionRun: { ...run, status: 'paused', message: '已记录人工核对；点击继续后才会再次提交并可能计费。', nodes: run.nodes.map(n => n.id === input.nodeId ? { ...n, status: 'pending', error: undefined, recoveryNote: input.evidence } : n) } }, run.id)).productionRun!;
      }
      release = this.store.acquire?.(input.id);
      let recovered = document;
      let runtime: VoxProductionRuntime | undefined;
      for (const node of run.nodes.filter(n => n.status === 'unknown')) {
        let receipt = await this.store.recover?.(input.id, node);
        if (!receipt && node.kind === 'image') {
          runtime ??= await this.runtime(input.id);
          if (runtime.identity === run.runtimeIdentity && node.inputHash === voxInputHash(runtime.input(recovered, node))) {
            receipt = await runtime.recover?.(recovered, node);
            if (receipt) {
              receipt = { ...receipt, productionRun: { ...recovered.productionRun!, nodes: recovered.productionRun!.nodes.map(n => n.id === node.id ? { ...n, status: 'completed', inputHash: voxInputHash(runtime!.input(receipt!, node)) } : n) } };
              await this.store.checkpoint?.(input.id, node, receipt);
            }
          }
        }
        if (!receipt || receipt.productionRun?.id !== run.id || receipt.productionRun.runtimeIdentity !== run.runtimeIdentity || receipt.productionRun.nodes.find(n => n.id === node.id)?.requestId !== node.requestId) continue;
        recovered = { ...receipt, updatedAt: recovered.updatedAt, productionRun: { ...recovered.productionRun!, nodes: recovered.productionRun!.nodes.map(n => n.id === node.id ? { ...n, status: 'completed' } : n) } };
      }
      return (await this.store.save({ ...recovered, productionRun: { ...recovered.productionRun!, status: 'paused', message: recovered === document ? '本地没有已保存的请求结果。请核对服务商记录。' : '已恢复本地结果；点击继续将复用成功步骤。' } }, run.id)).productionRun!;
    }
    if (input.action !== 'resume' && this.workers.has(input.id)) {
      this.intents.set(input.id, input.action);
      // In-flight calls finish and persist, then the worker stops dispatching.
      return { ...run, message: input.action === 'pause' ? '暂停中：当前步骤完成并保存后停止。' : '取消中：当前云端结果仍会保存。' };
    }
    if (input.action === 'resume') {
      if (this.stopping || this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 当前步骤仍在执行。');
      if (run.status === 'completed' || run.status === 'cancelled') throw new Error('VOX_PRODUCTION_TERMINAL: 请发起新的制作。');
      if (run.nodes.some(node => node.status === 'unknown')) throw new Error('VOX_PRODUCTION_UNKNOWN: 请核对服务商请求并导入结果，当前任务不能自动重提。');
      if (run.sourceHash !== voxInputHash(document.sourceText)) throw new Error('VOX_PRODUCTION_STALE: 原稿已修改，请创建新的制作计划。');
      const runtime = await this.runtime(input.id);
      if (runtime.identity !== run.runtimeIdentity) throw new Error('VOX_PRODUCTION_CONFIG_CHANGED: 模型或音色配置已改变，请恢复原配置或重新制作。');
      release = this.store.acquire?.(input.id);
      const nodes = this.reusable(document, run.nodes, runtime);
      releaseCapacity = await runtime.preflight(document, run.settings, nodes.filter(n => n.status === 'pending')) || undefined;
      const next = await this.store.save({ ...document, productionRun: { ...run, status: 'running', nodes, message: undefined } }, run.id);
      this.launch(input.id, runtime, release, releaseCapacity); release = undefined; releaseCapacity = undefined;
      return next.productionRun!;
    }
    const next = await this.store.save({ ...document, productionRun: { ...run, status: input.action === 'pause' ? 'paused' : 'cancelled' } }, run.id);
    return next.productionRun!;
    } finally { release?.(); releaseCapacity?.(); this.starts.delete(input.id); }
  }
  private launch(id: string, runtime: VoxProductionRuntime, release?: () => void, releaseCapacity?: () => void) {
    this.intents.delete(id);
    const worker = this.run(id, runtime).catch(async error => {
      this.onError(error);
      const d = await this.store.load(id);
      if (d.productionRun?.status === 'running') await this.store.save({ ...d, productionRun: recoverVoxProductionRun(d.productionRun) }, d.productionRun.id);
    }).catch(this.onError).finally(() => { releaseCapacity?.(); release?.(); this.workers.delete(id); this.intents.delete(id); });
    this.workers.set(id, worker);
  }
  async idle(id: string) { await this.workers.get(id); }
  async stop() { this.stopping = true; for (const id of this.workers.keys()) this.intents.set(id, 'pause'); await Promise.allSettled(this.workers.values()); }
  private async run(id: string, runtime: VoxProductionRuntime) {
    while (true) {
      let document = await this.store.load(id), run = document.productionRun!;
      if (run.status !== 'running') return;
      const intent = this.intents.get(id);
      if (intent || this.stopping) {
        await this.store.save({ ...document, productionRun: { ...run, status: intent === 'cancel' ? 'cancelled' : 'paused' } }, run.id); return;
      }
      const node = run.nodes.find(node => node.status === 'pending' && node.dependencies.every(dep => run.nodes.some(parent => parent.id === dep && parent.status === 'completed')));
      if (!node) {
        const complete = run.nodes.every(node => node.status === 'completed');
        await this.store.save({ ...document, productionRun: { ...run, status: complete ? 'completed' : 'failed', message: complete ? '自动制作完成，成片与媒体检查已保存。' : '制作依赖未完成，请检查失败步骤。' } }, run.id); return;
      }
      const claimed = { ...node, paid: runtime.isPaid?.(document, node) ?? node.paid, status: 'running' as const, attempt: node.attempt + 1, requestId: randomUUID(), inputHash: voxInputHash(runtime.input(document, node)), error: undefined };
      document = await this.store.save({ ...document, productionRun: { ...run, nodes: run.nodes.map(item => item.id === node.id ? claimed : item), updatedAt: new Date().toISOString() } }, run.id);
      try {
        const result = await runtime.execute(document, claimed);
        const latest = await this.store.load(id);
        // Renderer may checkpoint measured timing / quality through the same owner.
        if (latest.productionRun?.id !== run.id) throw new Error('VOX_PRODUCTION_STALE: 任务已替换，结果未写入。');
        if (latest.updatedAt !== document.updatedAt && result.updatedAt !== latest.updatedAt) throw new Error('VOX_PRODUCTION_STALE: 步骤执行期间项目已变化，结果保留在工作目录。');
        const base = { ...result, updatedAt: latest.updatedAt };
        const completed = { ...base, productionRun: { ...latest.productionRun, nodes: latest.productionRun.nodes.map(item => item.id === node.id ? { ...claimed, status: 'completed' as const, inputHash: voxInputHash(runtime.input(base, claimed)) } : item) } };
        await this.store.checkpoint?.(id, claimed, completed);
        await this.store.save(completed, run.id);
      } catch (error) {
        const latest = await this.store.load(id);
        if (latest.productionRun?.id !== run.id) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        // Paid failure may occur after provider accepted the request. Never auto-resubmit it.
        await this.store.save({ ...latest, productionRun: { ...latest.productionRun, status: 'failed', message: detail,
          nodes: latest.productionRun.nodes.map(item => item.id === node.id ? { ...claimed, status: claimed.paid ? 'unknown' : 'failed', error: detail } : item),
        } }, run.id); return;
      }
    }
  }
}
