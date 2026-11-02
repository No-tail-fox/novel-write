import { redactErrorText } from '../src/shared/app-error';
import { VoxProductionStepError } from './vox-production-step-error';
import { LlmJsonParseError } from '../src/shared/llm-provider';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { createHash, randomUUID } from 'node:crypto';
import { rebuildEditorialTimeline, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, isVoxProductionSubmissionRejection, voxProductionEngine, recoverVoxProductionRun, voxProductionInputErrors, voxProductionNodeStatus, type VoxProductionControl, type VoxProductionNode, type VoxProductionSettings, type VoxProductionStart } from '../src/shared/vox-production';

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
  nativeWorkflowVersion?: 2 | 3 | 4;
  nativePlanningVersion?: 1;
  /** Repair invalidated authoring journals locally before graph expansion; no provider calls. */
  reconcile?(document: EditorialCollagePipelineData): EditorialCollagePipelineData;
  expand?(document: EditorialCollagePipelineData): VoxProductionNode[] | undefined;
  preflight(document: EditorialCollagePipelineData, settings: VoxProductionSettings, pending?: readonly VoxProductionNode[]): void | (() => void) | Promise<void | (() => void)>;
  isPaid?(document: EditorialCollagePipelineData, node: VoxProductionNode): boolean;
  input(document: EditorialCollagePipelineData, node: VoxProductionNode): unknown;
  execute(document: EditorialCollagePipelineData, node: VoxProductionNode, signal?: AbortSignal): Promise<EditorialCollagePipelineData>;
  /** Read existing provider receipts only; this method must never dispatch generation. */
  recover?(document: EditorialCollagePipelineData, node: VoxProductionNode): Promise<EditorialCollagePipelineData | undefined>;
}

/** One serial writer per project. A route unmount has no execution ownership. */
export class VoxProductionService {
  private workers = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  get busy(): boolean { return this.workers.size > 0 || this.starts.size > 0; }
  private intents = new Map<string, 'pause' | 'cancel'>();
  private starts = new Set<string>();
  private stopping = false;
  constructor(private store: VoxProductionStore, private runtime: (id: string, settings: VoxProductionSettings) => Promise<VoxProductionRuntime>, private onError: (error: unknown) => void = console.error) {}

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
      const existing = document.productionRun;
      if (existing && (existing.engine === LEMO_NATIVE_ENGINE || voxProductionEngine(existing.settings) === LEMO_NATIVE_ENGINE || existing.authoringVersion !== undefined) && existing.authoringVersion !== 4) throw new Error('LEMO_WORKFLOW_UNSUPPORTED: 当前仅支持官方 SDK v4 制作；旧版项目暂不迁移或续跑。');
      if (document.productionRun?.status === 'running') throw new Error('VOX_PRODUCTION_BUSY: 项目已有制作任务。');
      if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('VOX_PRODUCTION_STALE: 项目已变化，请重新打开后制作。');
      if (document.productionRun?.nodes.some(node => voxProductionNodeStatus(node) === 'unknown' || node.status === 'running' && node.paid)) throw new Error('VOX_PRODUCTION_UNKNOWN: 请先核对上次云端请求，不能重新收费提交。');
      if (document.productionRun?.authoringVersion === 4 && document.productionRun.nodes.some(node => node.kind === 'film-edit' && node.id.startsWith('official-') && node.attempt > 0 && node.status !== 'completed')) {
        throw new Error('LEMO_OFFICIAL_RUN_PENDING: 官方制作阶段仍未完成，请在原任务内核对或继续，不能新建任务绕过原账本。');
      }
      const errors = voxProductionInputErrors(document, input.settings);
      if (errors.length) throw new Error(errors.join('\n'));
      const runtime = await this.runtime(input.id, input.settings);
      const engine = voxProductionEngine(input.settings) === LEMO_NATIVE_ENGINE ? LEMO_NATIVE_ENGINE : undefined;
      if (engine && runtime.nativeWorkflowVersion !== 4) throw new Error('LEMO_OFFICIAL_UNAVAILABLE: 当前制作必须使用官方 SDK v4，旧制作运行时不可作为替代。');
      const authoringVersion = engine ? 4 as const : undefined;
      const previous = document.productionRun;
      let nodes = buildVoxProductionNodes(authoringVersion === 4 ? { ...document, upstreamFilm: undefined, productionRun: undefined } : document, input.settings, engine ?? 'legacy', authoringVersion);
      if (previous && previous.sourceHash === voxInputHash(document.sourceText) && previous.runtimeIdentity === runtime.identity && previous.engine === engine && previous.authoringVersion === authoringVersion) {
        const prior = new Map(previous.nodes.map(n => [n.id, n]));
        const candidate = { ...document, productionRun: { ...previous, settings: input.settings, engine } };
        nodes = this.reusable(candidate, nodes.map(n => {
          const old = prior.get(n.id);
          const reusable = authoringVersion !== 4 || ['image', 'cutout', 'voice', 'timing'].includes(n.kind);
          return reusable && old?.status === 'completed' && JSON.stringify(old.dependencies) === JSON.stringify(n.dependencies) ? { ...n, paid: old.paid, status: old.status, inputHash: old.inputHash, requestId: old.requestId, attempt: old.attempt } : n;
        }), runtime);
      }
      releaseCapacity = await runtime.preflight(document, input.settings, nodes.filter(n => n.status === 'pending')) || undefined;
      const now = new Date().toISOString();
      const runId = randomUUID();
      const next = await this.store.save(rebuildEditorialTimeline({ ...document, ...(authoringVersion === 4 ? { upstreamFilm: undefined } : {}), productionSettings: input.settings, productionRun: {
        version: 1, id: runId, status: 'running', settings: input.settings, ...(engine ? { engine, authoringVersion } : {}),
        sourceHash: voxInputHash(document.sourceText), runtimeIdentity: runtime.identity,
        nodes, createdAt: now, updatedAt: now,
      } }), runId);
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
    if ((run.engine === LEMO_NATIVE_ENGINE || voxProductionEngine(run.settings) === LEMO_NATIVE_ENGINE || run.authoringVersion !== undefined) && run.authoringVersion !== 4) throw new Error('LEMO_WORKFLOW_UNSUPPORTED: 当前仅支持官方 SDK v4 制作；旧版项目暂不迁移或续跑。');
    if (input.action === 'recheck-code') throw new Error('LEMO_WORKFLOW_UNSUPPORTED: 旧版代码复查入口已停用，请使用官方 SDK v4 制作。');
    if (input.action === 'repair-shot') {
      if (this.stopping || this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 当前步骤仍在执行。');
      if (run.authoringVersion !== 4 || !run.nodes.some(n => n.id === 'official-treatment') || !document.upstreamFilm || document.upstreamFilm.runId !== run.id) throw new Error('LEMO_REPAIR_PHASED_FILM_REQUIRED: 请先完成分阶段官方制作。');
      if (run.sourceHash !== voxInputHash(document.sourceText)) throw new Error('VOX_PRODUCTION_STALE: 原稿已修改。');
      if (!input.shotId || !input.instructions || input.instructions.trim().length < 8 || !document.beats.some(b => b.shots.some(s => s.id === input.shotId))) throw new Error('LEMO_REPAIR_SHOT_REQUIRED');
      if (run.nodes.some(n => !['official-ready', 'render', 'verify'].includes(n.id) && n.status !== 'completed')) throw new Error('LEMO_REPAIR_PENDING: 请先恢复或核对未完成步骤。');
      const repairs = run.nodes.filter(n => n.id.startsWith('official-repair:'));
      if (repairs.length >= (run.settings.lemoBudget?.maxRepairRounds ?? 3)) throw new Error('LEMO_REPAIR_BUDGET_EXHAUSTED: 已用完本次制作的镜头修复次数。');
      const runtime = await this.runtime(input.id, run.settings);
      if (runtime.identity !== run.runtimeIdentity) throw new Error('LEMO_OFFICIAL_CONFIG_CHANGED');
      release = this.store.acquire?.(input.id);
      const id = 'official-repair:' + randomUUID();
      const repair: VoxProductionNode = { id, kind: 'film-edit', fileId: id, shotId: input.shotId, repairInstructions: input.instructions.trim(), repairSourceHash: document.upstreamFilm.sourceHash,
        dependencies: [repairs.at(-1)?.id ?? 'official-authoring'], paid: true, status: 'pending', attempt: 0 };
      const before = run.nodes.filter(n => !['official-ready', 'render', 'verify'].includes(n.id));
      const after = run.nodes.filter(n => ['official-ready', 'render', 'verify'].includes(n.id)).map(n => ({ ...n, status: 'pending' as const, error: undefined, ...(n.id === 'official-ready' ? { dependencies: [id] } : {}) }));
      const nodes = [...before, repair, ...after];
      releaseCapacity = await runtime.preflight(document, run.settings, [repair, ...after]) || undefined;
      const next = await this.store.save({ ...document, productionRun: { ...run, status: 'running', nodes, message: '正在修复所选镜头；沿用原账本、素材、旁白和时间轴，随后重新导出与验收。' } }, run.id);
      this.launch(input.id, runtime, release, releaseCapacity); release = undefined; releaseCapacity = undefined;
      return next.productionRun!;
    }
    if (input.action === 'retry-unknown') {
      if (this.stopping || this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 当前步骤仍在执行。');
      if (!['failed', 'paused'].includes(run.status)) throw new Error('VOX_PRODUCTION_TERMINAL: 当前任务状态不能重试。');
      const target = run.nodes.find(node => node.id === input.nodeId && voxProductionNodeStatus(node) === 'unknown');
      if (!target) throw new Error('VOX_PRODUCTION_STALE: 待重试步骤已变化，请刷新进度。');
      if (run.sourceHash !== voxInputHash(document.sourceText)) throw new Error('VOX_PRODUCTION_STALE: 原稿已修改，请创建新的制作计划。');
      const runtime = await this.runtime(input.id, run.settings);
      release = this.store.acquire?.(input.id);
      const protectedUnknown = new Set(run.nodes.filter(node => node.id !== target.id && voxProductionNodeStatus(node) === 'unknown').map(node => node.id));
      const nodes = this.reusable(document, run.nodes.map(node => node.id === target.id ? { ...node, status: 'pending' as const, retryOfRequestId: node.requestId, error: undefined } : node), runtime)
        .map(node => protectedUnknown.has(node.id) ? { ...node, status: 'unknown' as const } : node);
      if (nodes.find(node => node.id === target.id)!.dependencies.some(dependency => !nodes.some(node => node.id === dependency && node.status === 'completed'))) {
        throw new Error('VOX_PRODUCTION_DEPENDENCY: 前置步骤尚未完成，请先恢复前置步骤。');
      }
      releaseCapacity = await runtime.preflight(document, run.settings, nodes.filter(node => node.status === 'pending')) || undefined;
      if (run.authoringVersion === 4 && runtime.identity !== run.runtimeIdentity) throw new Error('LEMO_OFFICIAL_CONFIG_CHANGED: 官方制作必须保留原工程模型配置，请恢复原配置后在同一任务内继续。');
      const next = await this.store.save({ ...document, productionRun: { ...run, status: 'running', runtimeIdentity: runtime.identity, nodes, message: run.authoringVersion === 4 && target.kind === 'film-edit' ? '正在检查原官方会话并继续；未决请求不会被跳过。' : '正在直接重试所选步骤；其他待核对请求不会自动重发。' } }, run.id);
      this.launch(input.id, runtime, release, releaseCapacity); release = undefined; releaseCapacity = undefined;
      return next.productionRun!;
    }
    if (input.action === 'reconcile' || input.action === 'confirm-no-result') {
      if (this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 请等待当前步骤保存。');
      if (input.action === 'confirm-no-result') {
        if (!input.evidence || input.evidence.trim().length < 8 || !run.nodes.some(n => n.id === input.nodeId && n.status === 'unknown')) throw new Error('请填写服务商确认无结果的核对依据。');
        return (await this.store.save({ ...document, productionRun: { ...run, status: 'paused', message: run.authoringVersion === 4 && run.nodes.some(n => n.id === input.nodeId && n.kind === 'film-edit') ? '已记录人工核对；继续制作仍须通过原官方会话的恢复检查。' : '已记录人工核对；点击继续后才会再次提交并可能计费。', nodes: run.nodes.map(n => n.id === input.nodeId ? { ...n, status: 'pending', retryOfRequestId: n.requestId, error: undefined, recoveryNote: input.evidence } : n) } }, run.id)).productionRun!;
      }
      release = this.store.acquire?.(input.id);
      let recovered = document;
      let runtime: VoxProductionRuntime | undefined;
      for (const node of run.nodes.filter(n => n.status === 'unknown')) {
        let receipt = await this.store.recover?.(input.id, node);
        if (!receipt && (node.kind === 'image' || run.authoringVersion === 4 && node.kind === 'film-edit')) {
          runtime ??= await this.runtime(input.id, run.settings);
          if (runtime.identity === run.runtimeIdentity && node.inputHash === voxInputHash(runtime.input(recovered, node))) {
            receipt = await runtime.recover?.(recovered, node);
            if (receipt) {
              receipt = { ...receipt, productionRun: { ...recovered.productionRun!, nodes: recovered.productionRun!.nodes.map(n => n.id === node.id ? { ...n, status: 'completed', inputHash: voxInputHash(runtime!.input(receipt!, node)) } : n) } };
              await this.store.checkpoint?.(input.id, node, receipt);
            }
          }
        }
        if (!receipt || receipt.productionRun?.id !== run.id || receipt.productionRun.runtimeIdentity !== run.runtimeIdentity || receipt.productionRun.nodes.find(n => n.id === node.id)?.requestId !== node.requestId) continue;
        recovered = { ...receipt, updatedAt: recovered.updatedAt, productionRun: { ...recovered.productionRun!, ...(receipt.productionRun.filmId ? { filmId: receipt.productionRun.filmId } : {}), nodes: recovered.productionRun!.nodes.map(n => {
          const saved = receipt.productionRun!.nodes.find(r => r.id === n.id && r.requestId === n.requestId);
          // Failed final checks also reopen targeted repair nodes. Restore those with the source receipt.
          return saved && (n.id === node.id || receipt.productionRun!.nodes.find(r => r.id === node.id)?.status === 'failed') ? { ...n, ...saved } : n;
        }) } };
      }
      return (await this.store.save({ ...recovered, productionRun: { ...recovered.productionRun!, status: 'paused', message: recovered === document ? '本地没有已保存的请求结果。请核对服务商记录。' : recovered.productionRun!.nodes.some(n => n.status === 'unknown') ? '已恢复本地收到的内容；仍有云端最终结果待核对，不能自动重新提交。' : '已恢复本地结果；点击继续将复用成功步骤。' } }, run.id)).productionRun!;
    }
    if (input.action !== 'resume' && this.workers.has(input.id)) {
      this.intents.set(input.id, input.action);
      this.controllers.get(input.id)?.abort();
      if (run.authoringVersion === 4) return { ...run, message: input.action === 'pause' ? '暂停中：正在停止当前官方会话，已提交请求将保留核对状态。' : '取消中：正在停止当前官方会话，未确认的云端结果不会自动重发。' };
      // In-flight calls finish and persist, then the worker stops dispatching.
      return { ...run, message: input.action === 'pause' ? '暂停中：当前步骤完成并保存后停止。' : '取消中：当前云端结果仍会保存。' };
    }
    if (input.action === 'resume') {
      if (this.stopping || this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 当前步骤仍在执行。');
      if (run.status === 'completed' || run.status === 'cancelled') throw new Error('VOX_PRODUCTION_TERMINAL: 请发起新的制作。');
      if (run.nodes.some(node => voxProductionNodeStatus(node) === 'unknown')) throw new Error('VOX_PRODUCTION_UNKNOWN: 请核对服务商请求并导入结果，当前任务不能自动重提。');
      if (run.sourceHash !== voxInputHash(document.sourceText)) throw new Error('VOX_PRODUCTION_STALE: 原稿已修改，请创建新的制作计划。');
      const runtime = await this.runtime(input.id, run.settings);
      release = this.store.acquire?.(input.id);
      const nodes = this.reusable(document, run.nodes, runtime);
      releaseCapacity = await runtime.preflight(document, run.settings, nodes.filter(n => n.status === 'pending')) || undefined;
      if (run.authoringVersion === 4 && runtime.identity !== run.runtimeIdentity) throw new Error('LEMO_OFFICIAL_CONFIG_CHANGED: 官方制作必须保留原工程模型配置，请恢复原配置后在同一任务内继续。');
      const next = await this.store.save({ ...document, productionRun: { ...run, status: 'running', runtimeIdentity: runtime.identity, nodes, message: undefined } }, run.id);
      this.launch(input.id, runtime, release, releaseCapacity); release = undefined; releaseCapacity = undefined;
      return next.productionRun!;
    }
    const next = await this.store.save({ ...document, productionRun: { ...run, status: input.action === 'pause' ? 'paused' : 'cancelled' } }, run.id);
    return next.productionRun!;
    } finally { release?.(); releaseCapacity?.(); this.starts.delete(input.id); }
  }
  private launch(id: string, runtime: VoxProductionRuntime, release?: () => void, releaseCapacity?: () => void) {
    this.intents.delete(id);
    const controller = new AbortController(); this.controllers.set(id, controller);
    const worker = this.run(id, runtime, controller.signal).catch(async error => {
      this.onError(error);
      const d = await this.store.load(id);
      if (d.productionRun?.status === 'running') {
        const recovered = recoverVoxProductionRun(d.productionRun);
        const code = (error as NodeJS.ErrnoException)?.code;
        const detail = redactErrorText(error instanceof Error ? error.message : String(error)).slice(0, 1200);
        const message = code === 'ENOSPC' || /ENOSPC|no space left on device/i.test(detail)
          ? '磁盘空间不足，制作已暂停。已保存步骤保留；释放工作目录所在磁盘空间后继续，结果不明的云端请求不会自动重发。'
          : '制作执行异常，已暂停并保留已保存步骤：' + detail + '。结果不明的云端请求不会自动重发。';
        await this.store.save({ ...d, productionRun: { ...recovered, message } }, d.productionRun.id);
      }
    }).catch(this.onError).finally(() => { releaseCapacity?.(); release?.(); this.workers.delete(id); this.intents.delete(id); this.controllers.delete(id); });
    this.workers.set(id, worker);
  }
  async idle(id: string) { await this.workers.get(id); }
  async stop() { this.stopping = true; for (const id of this.workers.keys()) { this.intents.set(id, 'pause'); this.controllers.get(id)?.abort(); } await Promise.allSettled(this.workers.values()); }
  private async run(id: string, runtime: VoxProductionRuntime, signal: AbortSignal) {
    const expansionReleases: (() => void)[] = [];
    try { while (true) {
      let document = await this.store.load(id), run = document.productionRun!;
      if (run.status !== 'running') return;
      const intent = this.intents.get(id);
      if (intent || this.stopping) {
        await this.store.save({ ...document, productionRun: { ...run, status: intent === 'cancel' ? 'cancelled' : 'paused' } }, run.id); return;
      }
      const reconciled = runtime.reconcile?.(document);
      if (reconciled && reconciled !== document) {
        document = await this.store.save(reconciled, run.id); run = document.productionRun!;
      }
      const expanded = runtime.expand?.(document);
      if (expanded) {
        const previous = new Map(run.nodes.map(n => [n.id, n]));
        const additions = expanded.filter(n => !previous.has(n.id));
        const nodes = expanded.map(n => {
          const old = previous.get(n.id);
          return old && JSON.stringify(old.dependencies) === JSON.stringify(n.dependencies) ? old : { ...n, attempt: old?.attempt ?? 0 };
        });
        if (JSON.stringify(nodes) !== JSON.stringify(run.nodes)) {
          try {
            if (additions.length) { const release = await runtime.preflight(document, run.settings, additions); if (release) expansionReleases.push(release); }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.store.save({ ...document, productionRun: { ...run, status: 'failed', message } }, run.id); return;
          }
          document = await this.store.save({ ...document, productionRun: { ...run, nodes } }, run.id); run = document.productionRun!;
        }
      }
      const node = run.nodes.find(node => node.status === 'pending' && node.dependencies.every(dep => run.nodes.some(parent => parent.id === dep && parent.status === 'completed')));
      if (!node) {
        const complete = run.nodes.every(node => node.status === 'completed');
        const unresolved = run.nodes.some(node => voxProductionNodeStatus(node) === 'unknown');
        await this.store.save({ ...document, productionRun: { ...run, status: complete ? 'completed' : unresolved ? 'paused' : 'failed', message: complete ? '自动制作完成，成片与媒体检查已保存。' : unresolved ? '已完成当前可执行步骤；仍有云端请求待核对或重试。' : '制作依赖未完成，请检查失败步骤。' } }, run.id); return;
      }
      const claimed = { ...node, paid: runtime.isPaid?.(document, node) ?? node.paid, status: 'running' as const, attempt: node.attempt + 1, requestId: randomUUID(), inputHash: voxInputHash(runtime.input(document, node)), resultReceived: false, llmResponse: undefined, error: undefined };
      document = await this.store.save({ ...document, productionRun: { ...run, nodes: run.nodes.map(item => item.id === node.id ? claimed : item), message: undefined, updatedAt: new Date().toISOString() } }, run.id);
      let executed = false;
      try {
        const result = await runtime.execute(document, claimed, signal);
        executed = true;
        const latest = await this.store.load(id);
        // Renderer may checkpoint measured timing / quality through the same owner.
        if (latest.productionRun?.id !== run.id) throw new Error('VOX_PRODUCTION_STALE: 任务已替换，结果未写入。');
        if (latest.updatedAt !== document.updatedAt && result.updatedAt !== latest.updatedAt) throw new Error('VOX_PRODUCTION_STALE: 步骤执行期间项目已变化，结果保留在工作目录。');
        const base = { ...result, updatedAt: latest.updatedAt };
        const split = node.kind === 'timing' && base.beats.flatMap(b => b.shots).length !== document.beats.flatMap(b => b.shots).length;
        // Measured timing is a downstream output, not a new purchase of the provisional scene plan.
        const retimedPlanning = node.kind === 'timing' && latest.productionRun.planningVersion === 1;
        const completed = { ...base, productionRun: { ...latest.productionRun, ...(base.productionRun?.filmId ? { filmId: base.productionRun.filmId } : {}),
          ...(split ? { message: '已按实测旁白自动拆分镜头，正在继续制作。' } : {}),
          // Structural repair adopts upstream receipts. Resuming must not charge again for these saved successes.
          nodes: latest.productionRun.nodes.map(item => item.id === node.id
            ? { ...claimed, status: 'completed' as const, inputHash: voxInputHash(runtime.input(base, claimed)) }
            : (split || retimedPlanning && ['plan', 'film-plan-materials', 'film-plan-scene', 'film-plan-finalize'].includes(item.kind)) && item.status === 'completed'
              ? { ...item, inputHash: voxInputHash(runtime.input(base, item)), ...(item.paid ? { recoveryNote: item.recoveryNote ?? (split ? '自动拆镜后复用已保存结果。' : '实测旁白校时后复用已保存规划。') } : {}) } : item),
        } };
        await this.store.checkpoint?.(id, claimed, completed);
        // Preserve a late received result for explicit reconciliation, while the
        // cancelled live attempt remains unknown instead of silently succeeding.
        if (run.authoringVersion === 4 && signal.aborted) throw new Error('LEMO_OFFICIAL_INTERRUPTED: 官方会话已停止，请核对已保存的阶段结果。');
        await this.store.save(completed, run.id);
      } catch (error) {
        const latest = await this.store.load(id);
        if (latest.productionRun?.id !== run.id) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        // A save/download failure can lose a paid result; an explicit submission rejection cannot.
        const rejected = !executed && isVoxProductionSubmissionRejection(claimed, detail);
        const known = error instanceof VoxProductionStepError;
        const interrupted = run.authoringVersion === 4 && signal.aborted;
        // This receipt applies only to the single-request planner, never a multi-request authoring node.
        const response = ['plan', 'film-plan-materials', 'film-plan-scene'].includes(claimed.kind) && (error instanceof LlmJsonParseError || error instanceof LlmTextInterruptedError) ? error.result : undefined;
        const responseComplete = Boolean(response && error instanceof LlmJsonParseError);
        const llmResponse = response ? {
          text: response.raw.slice(0, 500000), truncated: response.raw.length > 500000,
          requestId: response.requestId?.slice(0, 256) || null,
          finishReason: response.finishReason?.slice(0, 128) ?? null, usage: response.usage,
        } : undefined;
        const saved = known ? { ...error.document, updatedAt: latest.updatedAt } : latest;
        const failed: EditorialCollagePipelineData = { ...saved, productionRun: { ...latest.productionRun, status: interrupted ? this.intents.get(id) === 'cancel' ? 'cancelled' : 'paused' : 'failed', message: detail,
          nodes: (known ? saved.productionRun!.nodes : latest.productionRun.nodes).map(item => item.id === node.id ? { ...claimed, resultReceived: executed || responseComplete, ...(llmResponse ? { llmResponse } : {}), status: interrupted ? claimed.paid ? 'unknown' : 'pending' : claimed.paid && !rejected && !responseComplete && (!known || !error.outcomeKnown) ? 'unknown' : 'failed', error: detail } : item),
        } };
        if (known || llmResponse) await this.store.checkpoint?.(id, claimed, failed);
        await this.store.save(failed, run.id);
        return;
      }
    } } finally { for (const release of expansionReleases.reverse()) release(); }
  }
}
