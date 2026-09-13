export type DirectorBatchCapability = 'image' | 'video' | 'voice' | 'render';
export type DirectorBatchScope = 'missing' | 'failed' | 'all';
export type DirectorBatchNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface DirectorBatchShotState {
  id: string;
  title: string;
  renderStrategy: 'deterministic-layers' | 'living-poster' | 'hybrid';
  imageReady: boolean;
  videoReady: boolean;
  voiceReady: boolean;
  imageFailed: boolean;
  videoFailed: boolean;
  voiceFailed: boolean;
  estimatedImageCost?: number;
  estimatedVideoCost?: number;
  estimatedVoiceCost?: number;
}

export interface DirectorBatchNode {
  id: string;
  capability: DirectorBatchCapability;
  shotId?: string;
  title: string;
  status: DirectorBatchNodeStatus;
  estimatedCost: number;
  dependencies: string[];
  error?: string;
}

export interface DirectorBatchPlan {
  nodes: DirectorBatchNode[];
  estimatedCost: number;
  imageCount: number;
  videoCount: number;
  voiceCount: number;
  renderCount: number;
}

export interface DirectorBatchPlanInput {
  scope: DirectorBatchScope;
  capabilities: Record<DirectorBatchCapability, boolean>;
  shots: readonly DirectorBatchShotState[];
  outputReady: boolean;
  renderFailed?: boolean;
}

export function directorBatchHistoryDemand(nodes: readonly Pick<DirectorBatchNode, 'capability' | 'shotId'>[], shots: readonly { id: string; voiceGenerationCount?: number }[]): ProductionHistoryUsage {
  const voiceCounts = new Map(shots.map((shot) => [shot.id, shot.voiceGenerationCount ?? 1]));
  const demand = { assets: 0, providerJobs: 0, qualityReports: 0 };
  for (const node of nodes) {
    const count = node.capability === 'voice' ? (voiceCounts.get(node.shotId ?? '') ?? 1) : 1;
    demand.assets += count;
    demand.providerJobs += count;
    if (node.capability === 'render') demand.qualityReports += 1;
  }
  return demand;
}

export interface DirectorBatchHandlers {
  image?: (node: DirectorBatchNode) => Promise<void>;
  video?: (node: DirectorBatchNode) => Promise<void>;
  voice?: (node: DirectorBatchNode) => Promise<void>;
  render?: (node: DirectorBatchNode) => Promise<void>;
}

export interface DirectorBatchRunSummary {
  nodes: DirectorBatchNode[];
  completed: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

export interface DirectorBatchController {
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  isPaused: () => boolean;
  isCancelled: () => boolean;
  waitUntilRunnable: () => Promise<void>;
}

export function createDirectorBatchPlan(input: DirectorBatchPlanInput): DirectorBatchPlan {
  const nodes: DirectorBatchNode[] = [];
  for (const shot of input.shots) {
    const imageRequested = input.capabilities.image && shouldPlan(input.scope, shot.imageReady, shot.imageFailed);
    const videoRequested = input.capabilities.video
      && shot.renderStrategy !== 'deterministic-layers'
      && shouldPlan(input.scope, shot.videoReady, shot.videoFailed);
    const imageRequiredForVideo = videoRequested && !shot.imageReady;
    const imagePlanned = imageRequested || imageRequiredForVideo;
    const imageNodeId = `batch:image:${shot.id}`;

    if (imagePlanned) {
      nodes.push({
        id: imageNodeId,
        capability: 'image',
        shotId: shot.id,
        title: `${shot.title} · 画面`,
        status: 'pending',
        estimatedCost: nonNegativeCost(shot.estimatedImageCost),
        dependencies: [],
      });
    }
    if (input.capabilities.voice && shouldPlan(input.scope, shot.voiceReady, shot.voiceFailed)) {
      nodes.push({
        id: `batch:voice:${shot.id}`,
        capability: 'voice',
        shotId: shot.id,
        title: `${shot.title} · 配音`,
        status: 'pending',
        estimatedCost: nonNegativeCost(shot.estimatedVoiceCost),
        dependencies: [],
      });
    }
    if (videoRequested) {
      nodes.push({
        id: `batch:video:${shot.id}`,
        capability: 'video',
        shotId: shot.id,
        title: `${shot.title} · 动态视频`,
        status: 'pending',
        estimatedCost: nonNegativeCost(shot.estimatedVideoCost),
        dependencies: imagePlanned ? [imageNodeId] : [],
      });
    }
  }
  if (input.capabilities.render && shouldPlan(input.scope, input.outputReady, input.renderFailed ?? false)) {
    nodes.push({
      id: 'batch:render:project',
      capability: 'render',
      title: '生成成片',
      status: 'pending',
      estimatedCost: 0,
      dependencies: nodes.map((node) => node.id),
    });
  }
  return summarizePlan(nodes);
}

export function createDirectorBatchController(): DirectorBatchController {
  let paused = false;
  let cancelled = false;
  const waiters = new Set<() => void>();
  const release = () => {
    for (const waiter of waiters) waiter();
    waiters.clear();
  };
  return {
    pause: () => { if (!cancelled) paused = true; },
    resume: () => { paused = false; release(); },
    cancel: () => { cancelled = true; paused = false; release(); },
    isPaused: () => paused,
    isCancelled: () => cancelled,
    waitUntilRunnable: async () => {
      if (!paused || cancelled) return;
      await new Promise<void>((resolve) => waiters.add(resolve));
    },
  };
}

export async function runDirectorBatchPlan(
  sourceNodes: readonly DirectorBatchNode[],
  handlers: DirectorBatchHandlers,
  options: {
    concurrency?: number;
    controller?: DirectorBatchController;
    onUpdate?: (node: DirectorBatchNode) => void;
    /** Restore terminal nodes; callers must reconcile remote work before re-queuing in-flight nodes. */
    initialNodes?: readonly DirectorBatchNode[];
    /** Persist ordered snapshots of the complete DAG after every node transition. */
    onStateChange?: (nodes: readonly DirectorBatchNode[]) => Promise<void> | void;
  } = {},
): Promise<DirectorBatchRunSummary> {
  const initialById = new Map((options.initialNodes ?? []).map((node) => [node.id, node]));
  const nodes: DirectorBatchNode[] = sourceNodes.map((node) => ({
    ...node,
    dependencies: [...node.dependencies],
    status: ['completed', 'failed', 'cancelled', 'skipped'].includes(initialById.get(node.id)?.status ?? '')
      ? initialById.get(node.id)!.status
      : 'pending',
    error: initialById.get(node.id)?.error,
  }));
  const controller = options.controller ?? createDirectorBatchController();
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 1)));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const currentNodeIds = new Set(nodes.map((node) => node.id));
  const running = new Set<Promise<void>>();
  const activeNodeIds = new Set<string>();
  let persistenceTail: Promise<void> = Promise.resolve();
  let fatalError: Error | undefined;

  const update = (node: DirectorBatchNode, status: DirectorBatchNodeStatus, error?: string): Promise<void> => {
    node.status = status;
    node.error = error;
    options.onUpdate?.(cloneNode(node));
    if (options.onStateChange) {
      const snapshot = nodes.map(cloneNode);
      const saved = persistenceTail.then(async () => {
        if (fatalError) throw fatalError;
        await options.onStateChange?.(snapshot);
      });
      persistenceTail = saved.catch((error) => { fatalError ??= error instanceof Error ? error : new Error(String(error)); });
      return saved;
    }
    return Promise.resolve();
  };
  const runNode = async (node: DirectorBatchNode) => {
    await update(node, 'running');
    if (fatalError) throw fatalError;
    if (controller.isCancelled() || controller.isPaused()) {
      await update(node, controller.isCancelled() ? 'cancelled' : 'pending');
      return;
    }
    try {
      const handler = handlers[node.capability];
      if (!handler) throw new Error(`${directorBatchCapabilityLabel(node.capability)}处理器未接入。`);
      await handler(cloneNode(node));
    } catch (error) {
      await update(node, 'failed', error instanceof Error ? error.message : String(error));
      return;
    }
    await update(node, 'completed');
  };

  const currentDependencies = (node: DirectorBatchNode): DirectorBatchNode[] => node.dependencies
    .filter((dependencyId) => currentNodeIds.has(dependencyId))
    .map((dependencyId) => nodeById.get(dependencyId))
    .filter((dependency): dependency is DirectorBatchNode => dependency !== undefined);
  const propagateBlockedDependencies = async () => {
    let changed = false;
    do {
      changed = false;
      for (const node of nodes) {
        if (node.status !== 'pending') continue;
        const blockedBy = currentDependencies(node).find((dependency) => !activeNodeIds.has(dependency.id) && (
          dependency.status === 'failed'
          || dependency.status === 'cancelled'
          || dependency.status === 'skipped'
        ));
        if (!blockedBy) continue;
        await update(node, 'skipped', `${blockedBy.title}未成功，已跳过${node.title}。`);
        changed = true;
      }
    } while (changed);
  };
  const isReady = (node: DirectorBatchNode) => node.status === 'pending'
    && !activeNodeIds.has(node.id)
    && currentDependencies(node).every((dependency) => dependency.status === 'completed' && !activeNodeIds.has(dependency.id));
  const start = (node: DirectorBatchNode) => {
    activeNodeIds.add(node.id);
    let task: Promise<void>;
    task = runNode(node).catch((error) => { fatalError ??= error instanceof Error ? error : new Error(String(error)); }).finally(() => { running.delete(task); activeNodeIds.delete(node.id); });
    running.add(task);
  };

  try {
    while (nodes.some((node) => node.status === 'pending') || running.size > 0) {
      if (fatalError) throw fatalError;
      if (controller.isCancelled()) {
        for (const node of nodes) {
          if (node.status === 'pending' && !activeNodeIds.has(node.id)) await update(node, 'cancelled');
        }
        if (running.size > 0) await Promise.all(running);
        break;
      }

      await propagateBlockedDependencies();
      if (fatalError) throw fatalError;

      if (controller.isPaused()) {
        if (running.size > 0) await Promise.race(running);
        else await controller.waitUntilRunnable();
        continue;
      }

      for (const node of nodes) {
        if (running.size >= concurrency || fatalError || controller.isPaused() || controller.isCancelled()) break;
        if (isReady(node)) start(node);
      }

      if (running.size > 0) {
        await Promise.race(running);
        continue;
      }

      const unresolved = nodes.filter((node) => node.status === 'pending');
      if (unresolved.length > 0) {
        for (const node of unresolved) {
          await update(node, 'failed', '检测到循环或无法解析的批处理依赖。');
        }
      }
    }

    await persistenceTail;
    if (fatalError) throw fatalError;
    return summarizeRun(nodes);
  } finally {
    // Drain provider calls already in flight before exposing a persistence failure.
    await Promise.all(running);
    await persistenceTail;
  }
}

export function directorBatchCapabilityLabel(capability: DirectorBatchCapability): string {
  if (capability === 'image') return '画面';
  if (capability === 'video') return '动态视频';
  if (capability === 'voice') return '配音';
  return '成片';
}

export function directorBatchStatusLabel(status: DirectorBatchNodeStatus): string {
  if (status === 'running') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'skipped') return '已跳过';
  return '等待开始';
}

function shouldPlan(scope: DirectorBatchScope, ready: boolean, failed: boolean): boolean {
  if (scope === 'all') return true;
  if (scope === 'failed') return failed;
  return !ready || failed;
}

function nonNegativeCost(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function summarizePlan(nodes: DirectorBatchNode[]): DirectorBatchPlan {
  return {
    nodes,
    estimatedCost: Math.round(nodes.reduce((total, node) => total + node.estimatedCost, 0) * 10000) / 10000,
    imageCount: nodes.filter((node) => node.capability === 'image').length,
    videoCount: nodes.filter((node) => node.capability === 'video').length,
    voiceCount: nodes.filter((node) => node.capability === 'voice').length,
    renderCount: nodes.filter((node) => node.capability === 'render').length,
  };
}

function summarizeRun(nodes: DirectorBatchNode[]): DirectorBatchRunSummary {
  return {
    nodes: nodes.map(cloneNode),
    completed: nodes.filter((node) => node.status === 'completed').length,
    failed: nodes.filter((node) => node.status === 'failed').length,
    cancelled: nodes.filter((node) => node.status === 'cancelled').length,
    skipped: nodes.filter((node) => node.status === 'skipped').length,
  };
}

function cloneNode(node: DirectorBatchNode): DirectorBatchNode {
  return { ...node, dependencies: [...node.dependencies] };
}
import type { ProductionHistoryUsage } from '../../shared/production-history';
