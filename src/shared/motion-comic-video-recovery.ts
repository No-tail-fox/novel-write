import { z } from 'zod';
import type { MotionComicPipelineData } from './motion-comic';
import type { AppMutationResult } from './types';

const recoveryId = z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/u, 'Invalid recovery identifier.');
const remoteTaskId = recoveryId.refine((value) => !/^https?:/iu.test(value), 'A URL is not a task identifier.');
const recoveryBase = {
  id: recoveryId,
  shotId: recoveryId,
  jobId: recoveryId,
  expectedUpdatedAt: z.string().max(64).datetime({ offset: true }),
};

/** Manual reconciliation only: neither action submits or queries a provider. */
export const motionComicVideoRecoveryInputSchema = z.discriminatedUnion('action', [
  z.object({ ...recoveryBase, action: z.literal('attach-remote-task'), remoteTaskId }).strict(),
  z.object({ ...recoveryBase, action: z.literal('confirm-not-submitted'), confirmedNotSubmitted: z.literal(true) }).strict(),
]);
export type MotionComicVideoRecoveryInput = z.infer<typeof motionComicVideoRecoveryInputSchema>;
export interface MotionComicVideoRecoveryResult {
  document: MotionComicPipelineData;
  mutation: AppMutationResult | null;
}
