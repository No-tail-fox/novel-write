export const MAX_DIRECTOR_BATCH_SHOTS = 500;
export const MAX_DIRECTOR_BATCH_NODES = MAX_DIRECTOR_BATCH_SHOTS * 3 + 1;
export const MAX_DIRECTOR_BATCH_DEPENDENCIES = MAX_DIRECTOR_BATCH_NODES - 1;

export type DirectorBatchStatus = 'draft' | 'queued' | 'running' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface DirectorBatchNodeSnapshot {
  id: string;
  capability: 'image' | 'video' | 'voice' | 'render';
  shotId?: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  estimatedCost: number;
  dependencies: string[];
  error?: string;
}

export interface DirectorBatchPlanSnapshot {
  scope: 'missing' | 'failed' | 'all';
  capabilities: Record<'image' | 'video' | 'voice' | 'render', boolean>;
  outputReady: boolean;
  renderFailed: boolean;
  /** Immutable copy of the shot inputs used to build the DAG. */
  shots: readonly unknown[];
}

export interface DirectorBatchRecord {
  id: string;
  workflowKind: 'director' | 'image-lab';
  projectId: string;
  episodeId: string | null;
  status: DirectorBatchStatus;
  concurrency: number;
  pauseRequested: boolean;
  cancelRequested: boolean;
  recoveryRequired: boolean;
  recoveryReason: string;
  plan: DirectorBatchPlanSnapshot;
  nodes: DirectorBatchNodeSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDirectorBatchInput {
  id?: string;
  workflowKind: DirectorBatchRecord['workflowKind'];
  projectId: string;
  episodeId?: string | null;
  status?: DirectorBatchStatus;
  concurrency: number;
  pauseRequested?: boolean;
  cancelRequested?: boolean;
  recoveryRequired?: boolean;
  recoveryReason?: string;
  plan: DirectorBatchPlanSnapshot;
  nodes: readonly DirectorBatchNodeSnapshot[];
}

export interface UpdateDirectorBatchInput {
  expectedUpdatedAt?: string;
  status?: DirectorBatchStatus;
  concurrency?: number;
  pauseRequested?: boolean;
  cancelRequested?: boolean;
  recoveryRequired?: boolean;
  recoveryReason?: string;
  plan?: DirectorBatchPlanSnapshot;
  nodes?: readonly DirectorBatchNodeSnapshot[];
}

export function normalizeDirectorBatchConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.floor(value)));
}

export function normalizeDirectorBatchRecord(input: DirectorBatchRecord): DirectorBatchRecord {
  return {
    ...input,
    projectId: input.projectId.trim(),
    episodeId: input.episodeId?.trim() || null,
    concurrency: normalizeDirectorBatchConcurrency(input.concurrency),
    pauseRequested: Boolean(input.pauseRequested),
    cancelRequested: Boolean(input.cancelRequested),
    recoveryRequired: Boolean(input.recoveryRequired),
    recoveryReason: input.recoveryReason ?? '',
    plan: {
      ...input.plan,
      shots: input.plan.shots.map((shot) => shot && typeof shot === 'object' ? { ...(shot as Record<string, unknown>) } : shot),
      capabilities: { ...input.plan.capabilities },
    },
    nodes: input.nodes.map((node) => ({ ...node, dependencies: [...node.dependencies] })),
  };
}
