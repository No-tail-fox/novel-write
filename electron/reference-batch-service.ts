import { randomUUID } from 'node:crypto';
import { createDirectorBatchController, runDirectorBatchPlan, type DirectorBatchController } from '../src/shared/director-batch-runner';
import type { CreateDirectorBatchInput, DirectorBatchRecord, UpdateDirectorBatchInput } from '../src/shared/director-batch-persistence';
import { referenceBatchRequestCount } from '../src/shared/reference-batch';
import { AppError, normalizeAppError } from '../src/shared/app-error';
import type { ReferenceBatchControlInput, ReferenceBatchNodeData, ReferenceBatchSubmitInput } from '../src/shared/reference-batch';
import { parseMotionComicPipelineData, type MotionComicSaveInput } from '../src/shared/motion-comic';
import { assertProductionHistoryCapacity } from '../src/shared/production-history';
import { isDefinitiveImageProviderFailure } from '../src/shared/image-provider-error';
import type { ImageLabGenerateInput, ImageLabRecord, Task } from '../src/shared/types';
import type { DirectorImageProviderStatus } from '../src/features/director-desk/director-generation';
import { applyGeneratedMotionComicReference, motionComicReferenceGenerationFingerprint, motionComicReferenceGenerationRequests, motionComicReferenceGenerationLabel } from '../src/features/motion-comic/motion-comic-reference-generation';

interface ReferenceBatchDatabase {
  getTaskDetail(id: string): Promise<Task | null>;
  saveMotionComicTask(input: MotionComicSaveInput): Promise<Task>;
  createDirectorBatch(input: CreateDirectorBatchInput): Promise<DirectorBatchRecord>;
  getDirectorBatch(id: string): Promise<DirectorBatchRecord | null>;
  listDirectorBatches(options?: { projectId?: string }): Promise<DirectorBatchRecord[]>;
  updateDirectorBatch(id: string, patch: UpdateDirectorBatchInput): Promise<DirectorBatchRecord>;
  getImageLabRecordDetail(id: string): Promise<ImageLabRecord | null>;
}
export interface ReferenceBatchDependencies {
  getDb(): Promise<ReferenceBatchDatabase>;
  getProvider(projectId: string): Promise<{ provider: DirectorImageProviderStatus; configurationFingerprint: string }>;
  generate(input: ImageLabGenerateInput, options: { recoveryOnly: boolean }): Promise<ImageLabRecord>;
  authorize(): Promise<void>;
  hashFile(path: string): Promise<string>;
  publishProject(task: Task): Promise<unknown>;
  publishBatch(batch: DirectorBatchRecord): Promise<unknown>;
  reserveProject(projectId: string): () => void;
  registerTask?(batch: DirectorBatchRecord): () => void;
}

/** Main-process owner of the existing director batch runner; no renderer lifetime dependency. */
export function createReferenceBatchService(deps: ReferenceBatchDependencies) {
  let stopping = false;
  const active = new Map<string, { controller: DirectorBatchController; done: Promise<void>; persist?: (patch: UpdateDirectorBatchInput) => Promise<unknown> }>();
  const submitting = new Set<string>();
  const documentFor = async (id: string) => {
    const task = await (await deps.getDb()).getTaskDetail(id);
    if (!task || task.taskType !== 'motion-comic') throw new AppError('REFERENCE_BATCH_PROJECT_MISSING', '漫剧项目已不存在或类型不匹配，请返回项目列表重新打开有效的漫剧项目。');
    return parseMotionComicPipelineData(task.pipelineData);
  };
  const submissions = new Set<Promise<DirectorBatchRecord>>();
  function submit(input: ReferenceBatchSubmitInput) {
    const promise = submitImpl(input);
    submissions.add(promise);
    void promise.finally(() => submissions.delete(promise)).catch(() => {});
    return promise;
  }
  async function submitImpl(input: ReferenceBatchSubmitInput) {
    await deps.authorize();
    if (stopping) throw new AppError('REFERENCE_BATCH_STOPPING', '应用正在关闭，未启动新的参考图生成。请重新打开应用后查看已有批次。');
    if (submitting.has(input.projectId)) throw new AppError('REFERENCE_BATCH_PROJECT_BUSY', '本项目已有未结束的参考图批次（包括已暂停的批次）。请先恢复查询并完成当前批次，或取消当前批次后再提交；请勿重复点击提交。');
    submitting.add(input.projectId);
    let release = () => {};
    try {
      release = deps.reserveProject(input.projectId);
      const db = await deps.getDb();
      if ((await db.listDirectorBatches({ projectId: input.projectId })).some(b => b.plan.purpose === 'reference-generation' && ['queued', 'running', 'paused', 'cancelling'].includes(b.status))) throw new AppError('REFERENCE_BATCH_PROJECT_BUSY', '本项目已有未结束的参考图批次（包括已暂停的批次）。请先恢复查询并完成当前批次，或取消当前批次后再提交；请勿重复点击提交。');
      const document = await documentFor(input.projectId);
      if (document.updatedAt !== input.expectedProjectUpdatedAt) throw new AppError('MOTION_COMIC_STALE_WRITE', '项目内容已更新，本次未提交参考图生成。请刷新项目并核对所选资产后重新提交。');
      if (!input.targets.length || input.targets.length > 500) throw new AppError('REFERENCE_BATCH_TARGET_LIMIT', '请选择 1 至 500 项有效资产后再提交参考图批次。');
      const keys = input.targets.map(t => `${t.kind}:${t.id}`);
      if (new Set(keys).size !== keys.length) throw new AppError('REFERENCE_BATCH_DUPLICATE_TARGET', '所选资产有重复项，本次未提交生成。请取消重复选择后再提交。');
      const requestCount = referenceBatchRequestCount(input.targets);
      assertProductionHistoryCapacity(document, { assets: requestCount, providerJobs: requestCount });
      const { provider, configurationFingerprint } = await deps.getProvider(input.projectId);
      if (!provider.connected) throw new AppError('REFERENCE_BATCH_MODEL_UNAVAILABLE', provider.unavailableReason || '图片模型尚未就绪，本次未提交生成。请先检查图片服务配置。');
      const nodes: DirectorBatchRecord['nodes'] = [];
      for (const target of input.targets) {
        const requests = motionComicReferenceGenerationRequests(document, target, provider, { composeMultiple: input.composeMultiple });
        const needsAnchor = target.kind === 'look' && !requests[0].input.referenceImagePaths?.length;
        if (needsAnchor && (!provider.supportsReferenceImages || provider.maxReferenceImages < 1)) throw new AppError('MOTION_COMIC_REFERENCE_UNSUPPORTED', '三视图需要支持参考图编辑的图片模型，以正面图保持人物身份一致。');
        const frontNodeId = randomUUID();
        for (const request of requests) {
        const identityAnchorNodeId = needsAnchor && request.view !== 'front' ? frontNodeId : undefined;
        const requestId = randomUUID();
        const inputSnapshot = { ...request.input, id: requestId, imageProfileId: provider.profileId };
        const referenceFiles = await Promise.all((inputSnapshot.referenceImagePaths ?? []).map(async path => ({ path, sha256: await deps.hashFile(path) })));
        nodes.push({ id: request.view === 'front' ? frontNodeId : randomUUID(), capability: 'image', title: `${motionComicReferenceGenerationLabel(document, target)}${request.view ? ` · ${{ front: '正面', side: '侧面', back: '背面' }[request.view]}` : ''}`, status: 'pending', estimatedCost: 0, dependencies: identityAnchorNodeId ? [identityAnchorNodeId] : [], reference: {
          target: { ...target }, identityAnchorNodeId, view: request.view, composeMultiple: input.composeMultiple, requestId, attempt: 1, inputSnapshot,
          inputFingerprint: motionComicReferenceGenerationFingerprint(document, target, provider, { view: request.view, composeMultiple: input.composeMultiple }), provider,
          configurationFingerprint, referenceFiles, submissionState: 'not-submitted', applyState: 'pending',
        } });
        }
      }
      const batch = await db.createDirectorBatch({ workflowKind: 'director', projectId: input.projectId, episodeId: null, concurrency: input.concurrency ?? 1, status: 'queued',
        plan: { purpose: 'reference-generation', schemaVersion: 1, selectionMode: input.selectionMode, scope: 'all', capabilities: { image: true, video: false, voice: false, render: false }, outputReady: false, renderFailed: false, shots: [] }, nodes });
      await deps.publishBatch(batch);
      if (stopping) return await db.updateDirectorBatch(batch.id, { status: 'paused', recoveryRequired: true, recoveryReason: '应用关闭前已保存，尚未提交。' });
      start(batch);
      return batch;
    } finally { release(); submitting.delete(input.projectId); }
  }
  function start(batch: DirectorBatchRecord, reconcileOnly = false) {
    if (stopping) throw new AppError('REFERENCE_BATCH_STOPPING', '应用正在关闭，未启动新的参考图生成。请重新打开应用后查看已有批次。');
    if (active.has(batch.id)) return;
    const controller = createDirectorBatchController();
    const done = Promise.resolve().then(() => execute(batch, controller, reconcileOnly)).catch(async error => {
      const db = await deps.getDb();
      const saved = await db.updateDirectorBatch(batch.id, { status: 'paused', recoveryRequired: true, recoveryReason: normalizeAppError(error).message });
      await deps.publishBatch(saved);
    }).finally(() => { active.delete(batch.id); });
    active.set(batch.id, { controller, done });
  }
  async function execute(batch: DirectorBatchRecord, controller: DirectorBatchController, reconcileOnly: boolean) {
    const db = await deps.getDb();
    let release = () => {};
    let unregister = () => {};
    const data = new Map(batch.nodes.map(n => [n.id, structuredClone(n.reference!)]));
    let nodes = structuredClone(batch.nodes);
    let tail: Promise<unknown> = Promise.resolve();
    const save = (patch: UpdateDirectorBatchInput = {}) => {
      const snapshot = nodes.map(n => ({ ...n, reference: structuredClone(data.get(n.id)!) }));
      const operation = tail.then(async () => {
        batch = await db.updateDirectorBatch(batch.id, { expectedUpdatedAt: batch.updatedAt, nodes: snapshot, ...patch });
        await deps.publishBatch(batch);
      });
      tail = operation;
      return operation;
    };
    active.get(batch.id)!.persist = save;
    try {
      release = deps.reserveProject(batch.projectId);
      unregister = deps.registerTask?.(batch) ?? (() => {});
      await deps.authorize();
      await save({ status: 'running', recoveryRequired: false, recoveryReason: '' });
      const runnable = reconcileOnly ? nodes.filter(n => !['not-submitted', 'rejected'].includes(n.reference?.submissionState ?? '')) : nodes;
      await runDirectorBatchPlan(runnable, { image: async node => {
        const ref = data.get(node.id)!;
        let record = await db.getImageLabRecordDetail(ref.requestId);
        if (record?.status !== 'generated') {
          if (ref.submissionState === 'not-submitted' && !record) {
            const latest = await documentFor(batch.projectId);
            let unchanged = false;
            try { unchanged = motionComicReferenceGenerationFingerprint(latest, ref.target, ref.provider, ref) === ref.inputFingerprint; } catch { /* Target removed. */ }
            if (!unchanged) { ref.applyState = 'stale'; await save(); return; }
          }
          if (ref.identityAnchorNodeId && !ref.identityAnchor) {
            // Resolve once and persist the exact derived input before any POST. Reconcile never
            // reaches unsubmitted nodes, and submitted nodes always retain this same identity image.
            const anchor = data.get(ref.identityAnchorNodeId);
            const front = anchor && await db.getImageLabRecordDetail(anchor.requestId);
            if (anchor?.submissionState !== 'resolved' || anchor.applyState !== 'applied' || front?.status !== 'generated' || !front.imagePath) throw new AppError('REFERENCE_BATCH_IDENTITY_ANCHOR_MISSING', '正面参考图尚未就绪或输入已变化，未提交侧面和背面。');
            const sha256 = await deps.hashFile(front.imagePath);
            ref.identityAnchor = { requestId: anchor.requestId, path: front.imagePath, sha256 };
            ref.inputSnapshot = { ...ref.inputSnapshot, smartMode: 'reference-edit', referenceImagePath: front.imagePath, referenceImagePaths: [front.imagePath], prompt: `${ref.inputSnapshot.prompt}\n以所附正面图为唯一人物身份与服装基准，只改变观察角度。严格保持脸型、发型、帽子佩戴状态、鞋色、服装和配饰。` };
            ref.referenceFiles = [{ path: front.imagePath, sha256 }];
            await save();
          }
          await deps.authorize();
          const currentProvider = await deps.getProvider(batch.projectId);
          if (currentProvider.configurationFingerprint !== ref.configurationFingerprint) throw new AppError('REFERENCE_BATCH_MODEL_CHANGED', '图片模型配置已变化，未继续提交生成。请核对原批次结果和当前模型配置后再操作。');
          for (const file of ref.referenceFiles) if (await deps.hashFile(file.path) !== file.sha256) throw new AppError('REFERENCE_BATCH_REFERENCE_FILE_CHANGED', '参考图片文件已变化，未继续提交生成。请核对参考图及已有批次结果后再操作。');
          const recoveryOnly = ref.submissionState !== 'not-submitted' || Boolean(record);
          ref.submissionState = 'submitted';
          await save(); // Durable intent precedes every possible provider POST.
          try {
            record = await deps.generate(ref.inputSnapshot, { recoveryOnly });
            if (record.status !== 'generated' || !record.imagePath) throw new AppError('REFERENCE_BATCH_RESULT_UNKNOWN', record.errorMessage || '图片服务尚未返回可用结果，请恢复查询原请求；请勿重复提交生成。');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Only a refusal of the original submission proves no task was accepted. A failed
            // recovery/poll cannot settle an earlier, possibly billed request.
            if (!recoveryOnly && isDefinitiveImageProviderFailure(message)) {
              ref.submissionState = 'rejected';
              await save();
            } else {
              ref.submissionState = 'unknown';
              await save({ recoveryRequired: true, recoveryReason: '结果未明，仅可用原请求核对，禁止重新提交。' });
            }
            throw error;
          }
        }
        ref.submissionState = 'resolved';
        await save(); // ImageLab service has durably saved the result before attachment.
        await apply(batch.projectId, ref, record!);
        await save();
      } }, { concurrency: batch.concurrency, controller, initialNodes: nodes,
        onStateChange: async snapshot => { const updated = new Map(snapshot.map(n => [n.id, n])); nodes = nodes.map(n => ({ ...(updated.get(n.id) ?? n) })); await save(); },
      });
      const unresolved = [...data.values()].some(r => r.submissionState === 'unknown' || r.submissionState === 'submitted') || nodes.some(n => n.status === 'pending');
      if (stopping) nodes = nodes.map(n => n.status === 'cancelled' ? { ...n, status: 'pending' } : n);
      await save({ status: stopping ? 'paused' : controller.isCancelled() ? 'cancelled' : unresolved ? 'paused' : nodes.some(n => n.status === 'failed') ? 'failed' : 'completed', recoveryRequired: stopping || unresolved });
    } finally { unregister(); release(); }
  }
  async function apply(projectId: string, ref: ReferenceBatchNodeData, record: ImageLabRecord) {
    const db = await deps.getDb();
    const assetId = `motion-comic-reference-${record.id}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const document = await documentFor(projectId);
      if (document.assets.some(a => a.id === assetId)) { ref.applyState = 'applied'; ref.resultAssetVersionId = assetId; return; }
      let matches = false;
      try {
        const current = await deps.getProvider(projectId);
        matches = current.configurationFingerprint === ref.configurationFingerprint && motionComicReferenceGenerationFingerprint(document, ref.target, current.provider, ref) === ref.inputFingerprint;
        for (const file of ref.referenceFiles) if (await deps.hashFile(file.path) !== file.sha256) matches = false;
      } catch { /* Deleted targets or unavailable references retain image history. */ }
      if (!matches) { ref.applyState = 'stale'; return; }
      const next = applyGeneratedMotionComicReference(document, ref.target, record, ref.provider, ref);
      try {
        const saved = await db.saveMotionComicTask({ id: projectId, expectedUpdatedAt: document.updatedAt, document: next });
        ref.applyState = 'applied'; ref.resultAssetVersionId = assetId;
        await deps.publishProject(saved);
        return;
      } catch (error) { if (!String(error).includes('MOTION_COMIC_STALE_WRITE')) throw error; }
    }
    throw new AppError('REFERENCE_BATCH_CAS_RETRY_EXHAUSTED', '项目持续被其他操作更新，生成结果尚未挂接。请停止编辑并恢复查询当前批次；无需重新生成。');
  }
  async function control(input: ReferenceBatchControlInput) {
    await deps.authorize();
    const db = await deps.getDb();
    let batch = await db.getDirectorBatch(input.id);
    if (!batch || batch.plan.purpose !== 'reference-generation') throw new AppError('REFERENCE_BATCH_NOT_FOUND', '参考图批次已不存在，请刷新项目任务列表后重新选择。');
    if (input.action === 'resume' && (batch.status === 'cancelled' || batch.cancelRequested)) throw new AppError('REFERENCE_BATCH_CANCELLED', '该参考图批次已取消，不能继续提交。请先核对已提交请求的结果，需要新增候选时另建批次。');
    const running = active.get(input.id);
    if (running) {
      if (input.action === 'reconcile') {
        if (!running.controller.isPaused()) throw new AppError('REFERENCE_BATCH_ACTIVE', '批次仍在运行，请先暂停并等待已发请求结束，再点击“恢复查询”；请勿重复提交。');
        const pendingIds = new Set(batch.nodes.filter(n => n.status === 'pending').map(n => n.id));
        running.controller.cancel();
        await running.done;
        const settled = (await db.getDirectorBatch(input.id))!;
        await db.updateDirectorBatch(input.id, { status: 'paused', nodes: settled.nodes.map(n => pendingIds.has(n.id) && n.status === 'cancelled' ? { ...n, status: 'pending' } : n) });
        return control(input);
      }
      if (input.action === 'resume' && batch.nodes.some(n => ['unknown', 'submitted'].includes(n.reference?.submissionState ?? ''))) throw new AppError('REFERENCE_BATCH_RECONCILE_REQUIRED', '当前批次有已提交但结果待核对的请求。请先点击“恢复查询”核对原请求，确认结果后再继续未提交项；请勿重复提交。');
      if (input.action === 'pause') running.controller.pause();
      else if (input.action === 'cancel') running.controller.cancel();
      else running.controller.resume();
      await running.persist?.({ status: input.action === 'pause' ? 'paused' : input.action === 'cancel' ? 'cancelling' : 'running', pauseRequested: input.action === 'pause', cancelRequested: input.action === 'cancel' });
      return (await db.getDirectorBatch(input.id))!;
    }
    if (input.action === 'pause' || input.action === 'cancel') {
      batch = await db.updateDirectorBatch(input.id, { status: input.action === 'pause' ? 'paused' : 'cancelled' });
      await deps.publishBatch(batch); return batch;
    }
    if (input.action === 'resume' && batch.nodes.some(n => ['unknown', 'submitted'].includes(n.reference?.submissionState ?? ''))) throw new AppError('REFERENCE_BATCH_RECONCILE_REQUIRED', '当前批次有已提交但结果待核对的请求。请先点击“恢复查询”核对原请求，确认结果后再继续未提交项；请勿重复提交。');
    batch = await db.updateDirectorBatch(input.id, { status: 'queued', nodes: batch.nodes.map(n => n.status === 'completed' || n.status === 'cancelled' || n.reference?.submissionState === 'rejected' || (input.action === 'reconcile' && n.reference?.submissionState === 'not-submitted') ? n : { ...n, status: 'pending', error: undefined }) });
    start(batch, input.action === 'reconcile'); return batch;
  }
  async function recover() {
    const db = await deps.getDb();
    for (const batch of await db.listDirectorBatches()) {
      if (batch.plan.purpose !== 'reference-generation' || !['queued', 'running', 'cancelling'].includes(batch.status)) continue;
      // Startup never authorizes a fresh request implicitly. Reconcile is explicit.
      await db.updateDirectorBatch(batch.id, { status: 'paused', recoveryRequired: true, recoveryReason: '应用重启，请核对原请求后继续。' });
    }
  }
  async function stop() {
    stopping = true;
    // Cancellation drains issued calls; pending nodes are restored to pending above.
    for (const entry of active.values()) entry.controller.cancel();
    await Promise.allSettled([...submissions]);
    await Promise.all([...active.values()].map(entry => entry.done));
  }
  return { submit, control, recover, stop, get busy() { return active.size > 0 || submitting.size > 0; }, waitForIdle: async (id: string) => { await active.get(id)?.done; } };
}
