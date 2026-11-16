import { randomUUID } from 'node:crypto';
import { AppError } from '../src/shared/app-error';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { motionComicVideoRecoveryInputSchema, type MotionComicVideoRecoveryInput, type MotionComicVideoRecoveryResult } from '../src/shared/motion-comic-video-recovery';
import { latestProductionProviderJob } from '../src/shared/production-workflow';
import type { FileDatabase } from '../src/shared/storage';
import type { AppDelta } from '../src/shared/types';

export interface MotionComicVideoRecoveryDependencies {
  database: Pick<FileDatabase, 'getTaskDetail' | 'saveMotionComicTask'>;
  isActive: (projectId: string, shotId: string) => boolean;
  publishTaskUpsert: (database: FileDatabase, id: string) => Promise<AppDelta | null>;
  now?: () => string;
}

/** Call while holding the generation factory's recovery lock. No provider IO. */
export async function recoverMotionComicVideoSubmission(raw: MotionComicVideoRecoveryInput, dependencies: MotionComicVideoRecoveryDependencies): Promise<MotionComicVideoRecoveryResult> {
  const input = motionComicVideoRecoveryInputSchema.parse(raw);
  const { database } = dependencies;
  if (dependencies.isActive(input.id, input.shotId)) throw new AppError('DIRECTOR_VIDEO_RECOVERY_ACTIVE', '原视频请求仍在执行，请等待请求结束后核对。');
  const task = await database.getTaskDetail(input.id);
  if (!task || task.id !== input.id || task.taskType !== 'motion-comic' || task.archivedAt) throw new AppError('DIRECTOR_VIDEO_RECOVERY_PROJECT_INVALID', '漫剧项目不存在、已归档或不可修改。');
  const document = parseMotionComicPipelineData(task.pipelineData);
  if (document.id !== input.id) throw new AppError('DIRECTOR_VIDEO_RECOVERY_PROJECT_INVALID', '视频任务与项目不匹配。');
  if (document.updatedAt !== input.expectedUpdatedAt) throw new AppError('MOTION_COMIC_STALE_WRITE', '项目已变化，请刷新后重新核对。');
  const episode = document.episodes.find(item => item.scenes.some(scene => scene.shots.some(shot => shot.id === input.shotId)));
  const job = document.providerJobs.find(item => item.id === input.jobId);
  if (!episode || !job || job.workflowKind !== 'motion-comic' || job.nodeId !== input.shotId || job.episodeId !== episode.id || job.capability !== 'image-to-video'
    || latestProductionProviderJob(document.providerJobs, input.shotId, 'image-to-video', episode.id)?.id !== job.id) {
    throw new AppError('DIRECTOR_VIDEO_RECOVERY_JOB_INVALID', '所选任务不属于当前镜头的最新视频请求。');
  }
  if (job.status !== 'running' || job.remoteTaskId?.trim() || !job.error?.trim()) throw new AppError('DIRECTOR_VIDEO_RECOVERY_STATE_INVALID', '仅可人工核对已结束请求、没有云端编号且记录了错误的未知提交。');
  if (input.action === 'attach-remote-task' && document.providerJobs.some(item => item.id !== job.id && item.providerId === job.providerId && item.remoteTaskId === input.remoteTaskId)) {
    throw new AppError('DIRECTOR_VIDEO_REMOTE_TASK_CONFLICT', '该云端编号已绑定本项目其他请求，请重新核对。');
  }
  const now = dependencies.now?.() ?? new Date().toISOString();
  const evidence = JSON.stringify({ action: input.action, jobId: job.id, checkedAt: now, ...(input.action === 'attach-remote-task' ? { remoteTaskId: input.remoteTaskId } : { confirmedNotSubmitted: true }), previousError: job.error });
  const recovered = { ...document, providerJobs: [
    ...document.providerJobs.map(item => item.id !== job.id ? item : { ...item,
      ...(input.action === 'attach-remote-task' ? { remoteTaskId: input.remoteTaskId, phase: 'submitted' as const } : { status: 'failed' as const }),
      updatedAt: now, error: `人工核对：${evidence}`,
    }),
    { id: `video-recovery-${randomUUID()}`, workflowKind: 'motion-comic' as const, nodeId: job.nodeId, episodeId: job.episodeId, providerId: job.providerId, model: job.model,
      capability: 'video-submission-recovery', status: 'completed' as const, inputHash: job.inputHash, idempotencyKey: `manual-recovery:${job.id}:${now}`,
      estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now, error: evidence },
  ] };
  if (dependencies.isActive(input.id, input.shotId)) throw new AppError('DIRECTOR_VIDEO_RECOVERY_ACTIVE', '原视频请求仍在执行，请稍后核对。');
  const saved = await database.saveMotionComicTask({ id: input.id, expectedUpdatedAt: input.expectedUpdatedAt, document: recovered });
  const delta = await dependencies.publishTaskUpsert(database as FileDatabase, saved.id);
  return { document: parseMotionComicPipelineData(saved.pipelineData), mutation: delta as MotionComicVideoRecoveryResult['mutation'] };
}
