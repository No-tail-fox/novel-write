import type { ImageLabGenerateInput } from './types';
import type { DirectorImageProviderStatus } from '../features/director-desk/director-generation';

export interface ReferenceBatchTarget { kind: 'look' | 'scene' | 'prop'; id: string }
export interface ReferenceBatchSubmitInput {
  projectId: string;
  expectedProjectUpdatedAt: string;
  targets: ReferenceBatchTarget[];
  selectionMode: 'category' | 'selected';
  concurrency?: number;
  composeMultiple?: boolean;
}
export function referenceBatchRequestCount(targets: readonly ReferenceBatchTarget[]): number {
  return targets.reduce((count, target) => count + (target.kind === 'look' ? 3 : 1), 0);
}

export interface ReferenceBatchControlInput { id: string; action: 'pause' | 'resume' | 'cancel' | 'reconcile' }
export interface ReferenceBatchNodeData {
  target: ReferenceBatchTarget;
  /** First generated front image required before this view may be submitted. */
  identityAnchorNodeId?: string;
  /** Durable resolved anchor, retained across recovery without deriving another input. */
  identityAnchor?: { requestId: string; path: string; sha256: string };
  view?: 'front' | 'side' | 'back';
  composeMultiple?: boolean;
  inputSnapshot: ImageLabGenerateInput;
  inputFingerprint: string;
  provider: DirectorImageProviderStatus;
  /** Non-secret model configuration identity. */
  configurationFingerprint: string;
  referenceFiles: Array<{ path: string; sha256: string }>;
  requestId: string;
  attempt: number;
  submissionState: 'not-submitted' | 'submitted' | 'rejected' | 'unknown' | 'resolved';
  applyState: 'pending' | 'applied' | 'stale';
  resultAssetVersionId?: string;
}
