import { redactErrorText } from '../src/shared/app-error';
import { VoxProductionStepError } from './vox-production-step-error';
import { LlmJsonParseError } from '../src/shared/llm-provider';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { piFilmReadyErrors } from '../src/shared/creative-animation/pi-film';
import { createHash, randomUUID } from 'node:crypto';
import { rebuildEditorialTimeline, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, isLemoImageUnknownNode, isVoxProductionSubmissionRejection, lemoAgentBudgetResume, voxProductionEngine, recoverVoxProductionRun, voxProductionInputErrors, voxProductionNodeStatus, voxProductionSingleRequestNode, type VoxProductionControl, type VoxProductionNode, type VoxProductionRun, type VoxProductionSettings, type VoxProductionStart } from '../src/shared/vox-production';
import { classifyProviderFailure, providerBackoffMs, type ProviderFailure } from '../src/shared/provider-failure';
import { autoRetryNotice, consumeRetryBudget, decideUnknownNodeAction, isAutoRetryEligible, normalizeRetryBudget, provenFailureOutcome, receiptRecoveredText, retryBudgetExhaustedText, retryBudgetNodeUsed, UNKNOWN_NODE_ACTION_TEXT, type RetryBudgetLimits, type UnknownNodeInfo } from '../src/shared/retry-budget';

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
  nativeWorkflowVersion?: 3 | 4;
  interrupt?(reason: 'pause' | 'cancel'): void | Promise<void>;
  expand?(document: EditorialCollagePipelineData): VoxProductionNode[] | undefined;
  preflight(document: EditorialCollagePipelineData, settings: VoxProductionSettings, pending?: readonly VoxProductionNode[]): void | (() => void) | Promise<void | (() => void)>;
  isPaid?(document: EditorialCollagePipelineData, node: VoxProductionNode): boolean;
  input(document: EditorialCollagePipelineData, node: VoxProductionNode): unknown;
  execute(document: EditorialCollagePipelineData, node: VoxProductionNode): Promise<EditorialCollagePipelineData>;
  /** Read existing provider receipts only; this method must never dispatch generation. */
  recover?(document: EditorialCollagePipelineData, node: VoxProductionNode): Promise<EditorialCollagePipelineData | undefined>;
}
export interface VoxProductionServiceOptions {
  /** G-7 automatic retry caps (defaults: 6 per run, 2 per node). */
  retryLimits?: Partial<RetryBudgetLimits>;
  /** Delay before automatic retry number `retry` (1-based, per node). Defaults to exponential backoff honouring Retry-After. */
  retryDelayMs?: (retry: number, failure: ProviderFailure) => number;
}
/** Nodes whose provider receipt can be read without dispatching generation. */
const voxReceiptRecoverableKind = (run: Pick<VoxProductionRun, 'authoringVersion'>, node: Pick<VoxProductionNode, 'kind'>) =>
  node.kind === 'image' || run.authoringVersion === 3 && node.kind === 'film-edit' || run.authoringVersion === 4 && node.kind === 'agent-segment';

/** Historical Lemo journals stay readable, but never enter an execution or migration path. */
export function assertVoxProductionRunSupported(run: VoxProductionRun | undefined): void {
  if (run && run.authoringVersion !== 3 && run.authoringVersion !== 4 && (run.engine === LEMO_NATIVE_ENGINE || run.authoringVersion !== undefined)) {
    throw new Error('LEMO_LEGACY_RUN_UNSUPPORTED: 旧版 Lemo 制作任务不再支持执行，请新建制作任务；原任务与素材已保留。');
  }
}

/** One serial writer per project. A route unmount has no execution ownership. */
export class VoxProductionService {
  private workers = new Map<string, Promise<void>>();
  private activeRuntimes = new Map<string, VoxProductionRuntime>();
  get busy(): boolean { return this.workers.size > 0 || this.starts.size > 0; }
  private intents = new Map<string, 'pause' | 'cancel'>();
  private starts = new Set<string>();
  private stopping = false;
  constructor(private store: VoxProductionStore, private runtime: (id: string, startSettings?: VoxProductionSettings) => Promise<VoxProductionRuntime>, private onError: (error: unknown) => void = console.error, private options: VoxProductionServiceOptions = {}) {}

  private reusable(document: EditorialCollagePipelineData, nodes: VoxProductionNode[], runtime: VoxProductionRuntime) {
    const invalid = new Set<string>();
    return nodes.map(node => {
      if (node.status !== 'completed' || node.inputHash !== voxInputHash(runtime.input(document, node)) || node.dependencies.some(dep => invalid.has(dep))) {
        if (document.productionRun?.authoringVersion === 4 && node.kind === 'agent-segment' && node.status === 'completed') throw new Error('PI_RECONCILIATION_REQUIRED: 已完成分段的输入已变化，请核对记录或新建制作。');
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
        if (document.productionRun.authoringVersion !== 3 && document.productionRun.authoringVersion !== 4 && (document.productionRun.engine === LEMO_NATIVE_ENGINE || document.productionRun.authoringVersion !== undefined)) continue;
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
      if (document.productionRun?.nodes.some(node => voxProductionNodeStatus(node) === 'unknown' || node.status === 'running' && node.paid)) throw new Error('VOX_PRODUCTION_UNKNOWN: 请先核对上次云端请求，不能重新收费提交。');
      const errors = voxProductionInputErrors(document, input.settings);
      if (errors.length) throw new Error(errors.join('\n'));
      const runtime = await this.runtime(input.id, input.settings);
      const engine = voxProductionEngine(input.settings) === LEMO_NATIVE_ENGINE ? LEMO_NATIVE_ENGINE : undefined;
      const authoringVersion = engine ? runtime.nativeWorkflowVersion : undefined;
      if (engine && authoringVersion !== 3 && authoringVersion !== 4) throw new Error('LEMO_AGENT_UNAVAILABLE: 当前运行时不支持 Lemo v3/v4。');
      if (authoringVersion === 4) input = { ...input, settings: { ...input.settings, piMaxRequests: input.settings.piMaxRequests ?? 120 } };
      const previous = document.productionRun;
      let nodes = buildVoxProductionNodes(authoringVersion === 4 ? { ...document, piFilm: undefined } : authoringVersion === 3 ? { ...document, upstreamFilm: undefined } : document, input.settings, engine ?? 'legacy', authoringVersion);
      if (previous && previous.sourceHash === voxInputHash(document.sourceText) && previous.runtimeIdentity === runtime.identity && previous.engine === engine && previous.authoringVersion === authoringVersion) {
        const prior = new Map(previous.nodes.map(n => [n.id, n]));
        const candidate = { ...document, productionRun: { ...previous, settings: input.settings, engine } };
        nodes = this.reusable(candidate, nodes.map(n => {
          const old = prior.get(n.id);
          return (authoringVersion !== 3 && authoringVersion !== 4 || n.kind === 'voice' || n.kind === 'timing') && old?.status === 'completed' && JSON.stringify(old.dependencies) === JSON.stringify(n.dependencies) ? { ...n, paid: old.paid, status: old.status, inputHash: old.inputHash, requestId: old.requestId, attempt: old.attempt } : n;
        }), runtime);
      }
      releaseCapacity = await runtime.preflight(document, input.settings, nodes.filter(n => n.status === 'pending')) || undefined;
      const now = new Date().toISOString();
      const runId = randomUUID();
      const next = await this.store.save(rebuildEditorialTimeline({ ...document, ...(authoringVersion === 4 ? { piFilm: undefined } : authoringVersion === 3 ? { upstreamFilm: undefined } : {}), productionSettings: input.settings, productionRun: {
        version: 1, id: runId, status: 'running', settings: input.settings, ...(authoringVersion === 3 ? { assetChannel: 1 as const } : {}), ...(engine ? { engine, ...(authoringVersion ? { authoringVersion } : {}) } : {}),
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
    if (input.action !== 'pause' && input.action !== 'cancel') assertVoxProductionRunSupported(run);
    if (!['pause', 'cancel', 'resume', 'retry-unknown', 'skip-unknown-image', 'reconcile', 'confirm-no-result', 'confirm-human-review'].includes(input.action)) throw new Error('VOX_CONTROL_UNSUPPORTED: 不支持此制作操作。');
    if (input.action === 'confirm-human-review') {
      if (this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 当前步骤仍在执行。');
      const film = document.piFilm;
      if (run.authoringVersion !== 4 || !film || film.runId !== run.id || piFilmReadyErrors(film).length || !film.evidence) throw new Error('PI_HUMAN_REVIEW_NOT_READY: 影片证据未就绪或已过期，请重新生成后再确认。');
      if (film.evidence.humanReviewed) return run;
      return (await this.store.save({ ...document, piFilm: { ...film, evidence: { ...film.evidence, humanReviewed: true } } }, run.id)).productionRun!;
    }
    if (input.action === 'retry-unknown' || input.action === 'skip-unknown-image') {
      if (this.stopping || this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 当前步骤仍在执行。');
      if (!['failed', 'paused'].includes(run.status)) throw new Error('VOX_PRODUCTION_TERMINAL: 当前任务状态不能重试。');
      const skip = input.action === 'skip-unknown-image';
      const target = run.nodes.find(node => node.id === input.nodeId && voxProductionNodeStatus(node) === 'unknown' && (!skip || isLemoImageUnknownNode(run, node)));
      if (!target) throw new Error('VOX_PRODUCTION_STALE: 待重试步骤已变化，请刷新进度。');
      if (run.authoringVersion === 4 && target.kind === 'agent-segment') throw new Error('PI_RECONCILIATION_REQUIRED: 请先核对整个分段的请求记录。');
      if (run.sourceHash !== voxInputHash(document.sourceText)) throw new Error('VOX_PRODUCTION_STALE: 原稿已修改，请创建新的制作计划。');
      const runtime = await this.runtime(input.id);
      release = this.store.acquire?.(input.id);
      const protectedUnknown = new Set(run.nodes.filter(node => node.id !== target.id && voxProductionNodeStatus(node) === 'unknown').map(node => node.id));
      const nodes = this.reusable(document, run.nodes.map(node => node.id === target.id ? { ...node, status: 'pending' as const, retryOfRequestId: node.requestId, error: undefined, skipImage: skip ? true as const : undefined } : node), runtime)
        .map(node => protectedUnknown.has(node.id) ? { ...node, status: 'unknown' as const } : node);
      if (nodes.find(node => node.id === target.id)!.dependencies.some(dependency => !nodes.some(node => node.id === dependency && node.status === 'completed'))) {
        throw new Error('VOX_PRODUCTION_DEPENDENCY: 前置步骤尚未完成，请先恢复前置步骤。');
      }
      releaseCapacity = await runtime.preflight(document, run.settings, nodes.filter(node => node.status === 'pending')) || undefined;
      const next = await this.store.save({ ...document, productionRun: { ...run, status: 'running', runtimeIdentity: runtime.identity, nodes, retryBudget: undefined, message: skip ? '已跳过结果未知的插画：不会重新提交，Agent 将改用代码或现有素材继续。' : '正在直接重试所选步骤；其他待核对请求不会自动重发。' } }, run.id);
      this.launch(input.id, runtime, release, releaseCapacity); release = undefined; releaseCapacity = undefined;
      return next.productionRun!;
    }
    if (input.action === 'reconcile' || input.action === 'confirm-no-result') {
      if (this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 请等待当前步骤保存。');
      if (input.action === 'confirm-no-result') {
        if (run.authoringVersion === 4 && run.nodes.some(n => n.id === input.nodeId && n.kind === 'agent-segment')) throw new Error('PI_RECONCILIATION_REQUIRED: 分段内的每个请求必须通过记录核对。');
        if (!input.evidence || input.evidence.trim().length < 8 || !run.nodes.some(n => n.id === input.nodeId && n.status === 'unknown')) throw new Error('请填写服务商确认无结果的核对依据。');
        return (await this.store.save({ ...document, productionRun: { ...run, status: 'paused', message: '已记录人工核对；点击继续后才会再次提交并可能计费。', nodes: run.nodes.map(n => n.id === input.nodeId ? { ...n, status: 'pending', retryOfRequestId: n.requestId, error: undefined, recoveryNote: input.evidence, skipImage: undefined } : n) } }, run.id)).productionRun!;
      }
      release = this.store.acquire?.(input.id);
      let recovered = document;
      let runtime: VoxProductionRuntime | undefined;
      for (const node of run.nodes.filter(n => n.status === 'unknown')) {
        recovered = await this.recoverReceipt(input.id, run, recovered, node, async () => runtime ??= await this.runtime(input.id)) ?? recovered;
      }
      return (await this.store.save({ ...recovered, productionRun: { ...recovered.productionRun!, status: 'paused', message: recovered === document ? '本地没有已保存的请求结果。请核对服务商记录。' : recovered.productionRun!.nodes.some(n => n.status === 'unknown') ? '已恢复本地收到的内容；仍有云端最终结果待核对，不能自动重新提交。' : '已恢复本地结果；点击继续将复用成功步骤。' } }, run.id)).productionRun!;
    }
    if (input.action !== 'resume' && this.workers.has(input.id)) {
      this.intents.set(input.id, input.action);
      await this.activeRuntimes.get(input.id)?.interrupt?.(input.action);
      // In-flight calls finish and persist, then the worker stops dispatching.
      return { ...run, message: input.action === 'pause' ? '暂停中：当前步骤完成并保存后停止。' : '取消中：当前云端结果仍会保存。' };
    }
    if (input.action === 'resume') {
      if (this.stopping || this.workers.has(input.id)) throw new Error('VOX_PRODUCTION_BUSY: 当前步骤仍在执行。');
      if (run.status === 'completed' || run.status === 'cancelled') throw new Error('VOX_PRODUCTION_TERMINAL: 请发起新的制作。');
      if (run.nodes.some(node => voxProductionNodeStatus(node) === 'unknown')) throw new Error('VOX_PRODUCTION_UNKNOWN: 请核对服务商请求并导入结果，当前任务不能自动重提。');
      if (run.sourceHash !== voxInputHash(document.sourceText)) throw new Error('VOX_PRODUCTION_STALE: 原稿已修改，请创建新的制作计划。');
      const runtime = await this.runtime(input.id);
      release = this.store.acquire?.(input.id);
      // Budget increases resume v3 from its saved turn without invalidating paid inputs.
      const savedBudget = input.budget ?? document.productionSettings;
      const budgetResumedRun = run.authoringVersion === 3 || run.authoringVersion === 4 ? lemoAgentBudgetResume(run, savedBudget) : run;
      const resumedRun = run.authoringVersion === 4 && budgetResumedRun.settings.piMaxRequests === undefined
        ? { ...budgetResumedRun, settings: { ...budgetResumedRun.settings, piMaxRequests: 120 } } : budgetResumedRun;
      const resumed = { ...document, productionRun: resumedRun };
      const nodes = this.reusable(resumed, run.nodes, runtime);
      releaseCapacity = await runtime.preflight(resumed, run.settings, nodes.filter(n => n.status === 'pending')) || undefined;
      // An explicit resume starts a fresh automatic-retry budget (G-7); the user has decided to continue.
      const next = await this.store.save({ ...resumed, productionRun: { ...resumedRun, status: 'running', runtimeIdentity: runtime.identity, nodes, retryBudget: undefined, message: undefined } }, run.id);
      this.launch(input.id, runtime, release, releaseCapacity); release = undefined; releaseCapacity = undefined;
      return next.productionRun!;
    }
    const next = await this.store.save({ ...document, productionRun: { ...run, status: input.action === 'pause' ? 'paused' : 'cancelled' } }, run.id);
    return next.productionRun!;
    } finally { release?.(); releaseCapacity?.(); this.starts.delete(input.id); }
  }
  /** Free receipt lookup for one unknown node: journal checkpoint first, then a provider receipt. Never dispatches generation. */
  private async recoverReceipt(id: string, run: VoxProductionRun, current: EditorialCollagePipelineData, node: VoxProductionNode, runtimeFor: () => Promise<VoxProductionRuntime>): Promise<EditorialCollagePipelineData | undefined> {
    let receipt = await this.store.recover?.(id, node);
    if (!receipt && voxReceiptRecoverableKind(run, node)) {
      const runtime = await runtimeFor();
      if (runtime.identity === run.runtimeIdentity && node.inputHash === voxInputHash(runtime.input(current, node))) {
        receipt = await runtime.recover?.(current, node);
        if (receipt) {
          receipt = { ...receipt, productionRun: { ...current.productionRun!, nodes: current.productionRun!.nodes.map(n => n.id === node.id ? { ...n, status: 'completed', inputHash: voxInputHash(runtime.input(receipt!, node)) } : n) } };
          await this.store.checkpoint?.(id, node, receipt);
        }
      }
    }
    if (!receipt || receipt.productionRun?.id !== run.id || receipt.productionRun.runtimeIdentity !== run.runtimeIdentity || receipt.productionRun.nodes.find(n => n.id === node.id)?.requestId !== node.requestId) return undefined;
    const saved = receipt.productionRun;
    return { ...receipt, updatedAt: current.updatedAt, productionRun: { ...current.productionRun!, ...(saved.filmId ? { filmId: saved.filmId } : {}), nodes: current.productionRun!.nodes.map(n => {
      const item = saved.nodes.find(r => r.id === n.id && r.requestId === n.requestId);
      // Failed final checks also reopen targeted repair nodes. Restore those with the source receipt.
      return item && (n.id === node.id || saved.nodes.find(r => r.id === node.id)?.status === 'failed') ? { ...n, ...item } : n;
    }) } };
  }
  /**
   * G-7: after a node fails, try a free receipt recovery for unknown outcomes, then a budgeted automatic
   * retry when resending cannot double-bill. Paid unknown nodes stay blocked for the user. Returns true
   * when the run should keep going.
   */
  private async autoResolveFailure(id: string, runtime: VoxProductionRuntime, persisted: EditorialCollagePipelineData, nodeId: string, error: unknown, resultReceived: boolean): Promise<boolean> {
    const run = persisted.productionRun, node = run?.nodes.find(n => n.id === nodeId);
    if (!run || !node || run.status !== 'failed' || this.stopping || this.intents.has(id)) return false;
    const status = voxProductionNodeStatus(node);
    if (status !== 'unknown' && status !== 'failed') return false;
    if (run.authoringVersion === 4 && node.kind === 'agent-segment') {
      // A segment owns many requests. Neither its final exception nor a generic
      // provider rejection proves the outcome of its earlier gateway calls.
      try {
        const recovered = await this.recoverReceipt(id, run, persisted, node, async () => runtime);
        if (recovered?.productionRun?.nodes.find(n => n.id === node.id)?.status === 'completed') {
          await this.store.save({ ...recovered, productionRun: { ...recovered.productionRun, status: 'running', message: receiptRecoveredText(node.id) } }, run.id);
          return true;
        }
      } catch (recoveryError) { this.onError(recoveryError); }
      return false;
    }
    const failure = classifyProviderFailure({ error });
    if (failure.kind === 'aborted') return false;
    const proven = provenFailureOutcome(failure, resultReceived);
    const budget = normalizeRetryBudget(run.retryBudget, this.options.retryLimits);
    const info: UnknownNodeInfo = {
      paid: node.paid, kind: node.kind, hasReceipt: !!node.requestId,
      recoverable: status === 'unknown' && (!!this.store.recover || !!runtime.recover && voxReceiptRecoverableKind(run, node)),
      // A refusal on a node still marked unknown cannot vouch for earlier requests of the same node.
      outcome: status === 'unknown' && proven === 'rejected' ? 'unknown' : proven,
      retry: failure.retry, singleRequest: voxProductionSingleRequestNode(node), budget, nodeId: node.id,
    };
    let action = decideUnknownNodeAction(info);
    if (action === 'recover-from-receipt') {
      let recovered: EditorialCollagePipelineData | undefined;
      try { recovered = await this.recoverReceipt(id, run, persisted, node, async () => runtime); } catch (recoveryError) { this.onError(recoveryError); }
      if (recovered?.productionRun?.nodes.find(n => n.id === node.id)?.status === 'completed') {
        await this.store.save({ ...recovered, productionRun: { ...recovered.productionRun, status: 'running', message: receiptRecoveredText(node.id),
          nodes: recovered.productionRun.nodes.map(n => n.id === node.id ? { ...n, error: undefined } : n) } }, run.id);
        return true;
      }
      action = decideUnknownNodeAction({ ...info, recoveryAttempted: true });
      if (action === 'await-user') {
        await this.store.save({ ...persisted, productionRun: { ...run, message: `${run.message ?? ''}\n${UNKNOWN_NODE_ACTION_TEXT['await-user']}`.trim().slice(0, 65536) } }, run.id);
        return false;
      }
    }
    if (action === 'auto-retry') {
      const next = consumeRetryBudget(budget, node.id), retry = retryBudgetNodeUsed(next, node.id);
      const note = autoRetryNotice(node.id, next, node.id, failure.label).slice(0, 2000);
      await this.store.save({ ...persisted, productionRun: { ...run, status: 'running', message: note, retryBudget: next,
        nodes: run.nodes.map(n => n.id === node.id ? { ...n, status: 'pending' as const, retryOfRequestId: n.requestId, recoveryNote: note } : n) } }, run.id);
      const delay = this.options.retryDelayMs?.(retry, failure) ?? providerBackoffMs(retry, { baseMs: 1000, maxMs: 15_000, retryAfterMs: failure.retryAfterMs });
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      return true;
    }
    // Resending would have been safe, but the shared budget is spent: say why it stopped.
    if (isAutoRetryEligible(info)) await this.store.save({ ...persisted, productionRun: { ...run, message: `${run.message ?? ''}\n${retryBudgetExhaustedText(budget, node.id)}`.trim().slice(0, 65536) } }, run.id);
    return false;
  }
  private launch(id: string, runtime: VoxProductionRuntime, release?: () => void, releaseCapacity?: () => void) {
    this.intents.delete(id);
    this.activeRuntimes.set(id, runtime);
    const worker = this.run(id, runtime).catch(async error => {
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
    }).catch(this.onError).finally(() => { releaseCapacity?.(); release?.(); this.workers.delete(id); this.activeRuntimes.delete(id); this.intents.delete(id); });
    this.workers.set(id, worker);
  }
  async idle(id: string) { await this.workers.get(id); }
  async stop() {
    this.stopping = true;
    for (const id of this.workers.keys()) this.intents.set(id, 'pause');
    await Promise.allSettled([...this.activeRuntimes.values()].map(runtime => runtime.interrupt?.('pause')));
    await Promise.allSettled(this.workers.values());
  }
  private async run(id: string, runtime: VoxProductionRuntime) {
    const expansionReleases: (() => void)[] = [];
    try { while (true) {
      let document = await this.store.load(id), run = document.productionRun!;
      if (run.status !== 'running') return;
      const intent = this.intents.get(id);
      if (intent || this.stopping) {
        await this.store.save({ ...document, productionRun: { ...run, status: intent === 'cancel' ? 'cancelled' : 'paused' } }, run.id); return;
      }
      assertVoxProductionRunSupported(run);
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
        const result = await runtime.execute(document, claimed);
        executed = true;
        const latest = await this.store.load(id);
        // Renderer may checkpoint measured timing / quality through the same owner.
        if (latest.productionRun?.id !== run.id) throw new Error('VOX_PRODUCTION_STALE: 任务已替换，结果未写入。');
        if (latest.updatedAt !== document.updatedAt && result.updatedAt !== latest.updatedAt) throw new Error('VOX_PRODUCTION_STALE: 步骤执行期间项目已变化，结果保留在工作目录。');
        const base = { ...result, updatedAt: latest.updatedAt };
        const split = node.kind === 'timing' && base.beats.flatMap(b => b.shots).length !== document.beats.flatMap(b => b.shots).length;
        const v4Segment = run.authoringVersion === 4 && node.kind === 'agent-segment';
        const piReady = v4Segment && base.piFilm?.runId === run.id && base.piFilm.phase === 'ready';
        const completed = { ...base, productionRun: { ...latest.productionRun, ...(base.productionRun?.filmId ? { filmId: base.productionRun.filmId } : {}),
          ...(split ? { message: '已按实测旁白自动拆分镜头，正在继续制作。' } : {}),
          ...(v4Segment && !piReady
            ? { status: 'paused' as const, message: 'Pi 已保存当前分段；继续制作将恢复当前分段。' } : {}),
          // A non-ready film has only a checkpoint, not a completed graph node.
          nodes: latest.productionRun.nodes.map(item => item.id === node.id
            ? { ...claimed, status: v4Segment && !piReady ? 'pending' as const : 'completed' as const, inputHash: voxInputHash(runtime.input(base, claimed)) }
            : (split || v4Segment && piReady) && item.status === 'completed'
              ? { ...item, inputHash: voxInputHash(runtime.input(base, item)), ...(item.paid ? { recoveryNote: item.recoveryNote ?? '自动拆镜后复用已保存结果。' } : {}) } : item),
        } };
        await this.store.checkpoint?.(id, claimed, completed);
        await this.store.save(completed, run.id);
      } catch (error) {
        const latest = await this.store.load(id);
        if (latest.productionRun?.id !== run.id) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        // A save/download failure can lose a paid result; an explicit submission rejection cannot.
        const rejected = !executed && isVoxProductionSubmissionRejection(claimed, detail);
        const known = error instanceof VoxProductionStepError;
        // This receipt applies only to the single-request planner, never a multi-request authoring node.
        const response = claimed.kind === 'plan' && (error instanceof LlmJsonParseError || error instanceof LlmTextInterruptedError) ? error.result : undefined;
        const responseComplete = Boolean(response && error instanceof LlmJsonParseError);
        const llmResponse = response ? {
          text: response.raw.slice(0, 500000), truncated: response.raw.length > 500000,
          requestId: response.requestId?.slice(0, 256) || null,
          finishReason: response.finishReason?.slice(0, 128) ?? null, usage: response.usage,
        } : undefined;
        const saved = known ? { ...error.document, updatedAt: latest.updatedAt } : latest;
        const failed: EditorialCollagePipelineData = { ...saved, productionRun: { ...latest.productionRun, status: 'failed', message: detail,
          nodes: (known ? saved.productionRun!.nodes : latest.productionRun.nodes).map(item => item.id === node.id ? { ...claimed, ...(known && run.authoringVersion === 4 && node.kind === 'agent-segment' ? { inputHash: voxInputHash(runtime.input(saved, claimed)) } : {}), resultReceived: executed || responseComplete, ...(llmResponse ? { llmResponse } : {}), status: claimed.paid && !rejected && !responseComplete && (!known || !error.outcomeKnown) ? 'unknown' : 'failed', error: detail } : item),
        } };
        if (known || llmResponse) await this.store.checkpoint?.(id, claimed, failed);
        const persisted = await this.store.save(failed, run.id);
        if (await this.autoResolveFailure(id, runtime, persisted, node.id, error, executed || responseComplete)) continue;
        const intent = this.intents.get(id);
        if (intent) await this.store.save({ ...persisted, productionRun: { ...persisted.productionRun!, status: intent === 'cancel' ? 'cancelled' : 'paused' } }, run.id);
        return;
      }
    } } finally { for (const release of expansionReleases.reverse()) release(); }
  }
}
