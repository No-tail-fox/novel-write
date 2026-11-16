// AI motion-comic remote shot-video generation (submit / resume / stale-result preservation), split out of main.ts (O-5).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { normalizeAppError } from '../src/shared/app-error';
import { directorCanvasForRatio, type DirectorGenerateShotVideoRequest, type DirectorGenerateShotVideoResult } from '../src/shared/director-render';
import { parseMotionComicPipelineData, type MotionComicEpisode, type MotionComicPipelineData } from '../src/shared/motion-comic';
import { buildMotionComicShotContinuityAdvice, motionComicPreviousShot, type MotionComicShotContinuityAdvice } from '../src/shared/motion-comic-continuity';
import { motionComicVideoInputFrames, motionComicVideoInputFingerprintSource, selectMotionComicVideoRoute } from '../src/shared/motion-comic-video';
import type { ProductionHistoryReservation } from '../src/shared/production-history';
import { latestProductionProviderJob } from '../src/shared/production-workflow';
import type { projectRuntimeConfig } from '../src/shared/project-models';
import type { FileDatabase } from '../src/shared/storage';
import type { AppDelta, Task } from '../src/shared/types';
import { createConfiguredVideoProvider, validateVideoGenerationRequest, type VideoGenerationRequest } from '../src/shared/video-provider';
import { downloadVerifiedVideoResult } from './resumable-transfer';
import { sampleMotionComicCutFrames, type ContinuityFramePair } from './motion-comic-continuity-probe';
import { sweepStaleResumableParts } from './resumable-part-sweep';

export interface MotionComicShotVideoDependencies {
  getProjectRuntimeConfig: (project: Task | string) => Promise<ReturnType<typeof projectRuntimeConfig>>;
  taskWorkDir: (task: Pick<Task, 'managedStorageKey'>) => string;
  publishTaskUpsert: (database: FileDatabase, taskId: string, cached?: boolean) => Promise<AppDelta | null>;
  normalizeSceneVideo: (
    sourcePath: string,
    outputPath: string,
    preserveAudio?: boolean,
    signal?: AbortSignal,
  ) => Promise<{ durationMs: number; width: number; height: number }>;
}

export function createMotionComicShotVideo({ getProjectRuntimeConfig, taskWorkDir, publishTaskUpsert, normalizeSceneVideo }: MotionComicShotVideoDependencies) {
const active = new Set<string>();
async function executeMotionComicShotVideo(
  database: FileDatabase,
  task: Task,
  input: DirectorGenerateShotVideoRequest,
  reservation: ProductionHistoryReservation,
  recoveryOnly = false,
) {
  const document = parseMotionComicPipelineData(task.pipelineData);
  if (task.id !== input.id || document.id !== input.id) throw new Error('DIRECTOR_VIDEO_PROJECT_INVALID: 视频任务与项目不匹配。');
  if (document.updatedAt !== input.expectedUpdatedAt) {
    throw new Error('MOTION_COMIC_STALE_WRITE: 项目已发生变化，请刷新后重新生成。');
  }
  const episode = document.episodes.find((candidate) => candidate.scenes.some((scene) => scene.shots.some((shot) => shot.id === input.shotId)));
  const shot = episode?.scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === input.shotId);
  if (!episode || !shot) throw new Error(`DIRECTOR_VIDEO_SHOT_NOT_FOUND: ${input.shotId}`);
  const latestJob = latestProductionProviderJob(document.providerJobs, shot.id, 'image-to-video', episode.id);
  if (recoveryOnly && !latestJob?.remoteTaskId) throw new Error('DIRECTOR_VIDEO_TASK_ID_REQUIRED: 仅能恢复已有云端任务编号的结果，本次不会提交新任务。');
  const resumableJob = latestJob?.status === 'running' || (recoveryOnly && latestJob?.remoteTaskId) ? latestJob : undefined;
  if (resumableJob && !resumableJob.remoteTaskId) {
    throw new Error('DIRECTOR_VIDEO_SUBMIT_STATE_UNKNOWN: 上次提交在返回云端任务 ID 前中断。为避免重复计费，本次不会自动重提；请先到服务商后台核对任务。');
  }

  // Recovery must retain the original intent, even if the caller requests another mode.
  const adoption = resumableJob ? resumableJob.videoAdoption ?? 'automatic' : input.adoption ?? 'automatic';
  const candidateOnly = adoption === 'candidate';
  const runtimeConfig = await getProjectRuntimeConfig(task);
  let request: VideoGenerationRequest | undefined;
  let provider: ReturnType<typeof createConfiguredVideoProvider>;
  let selectedProvider: (typeof runtimeConfig.video.providers)[number];
  let estimatedCost: number;
  let inputHash: string;
  if (resumableJob) {
    const recoveryProvider = runtimeConfig.video.providers.find((candidate) => candidate.id === resumableJob.providerId && candidate.model === resumableJob.model);
    if (!recoveryProvider) {
      throw new Error(`DIRECTOR_VIDEO_PROVIDER_UNAVAILABLE: 原云端任务所属 Provider ${resumableJob.providerId} / ${resumableJob.model} 已不可用。AI 漫剧视频不会自动切换任务所属服务。`);
    }
    selectedProvider = recoveryProvider;
    estimatedCost = resumableJob.estimatedCost;
    inputHash = resumableJob.inputHash;
    provider = createConfiguredVideoProvider(runtimeConfig, taskWorkDir(task), undefined, {
      recoveryProviderId: resumableJob.providerId,
      downloadResult: downloadVerifiedVideoResult,
    });
  } else {
    const frames = motionComicVideoInputFrames(document, shot);
    for (const [label, asset] of [['首帧', frames.first], ['尾帧', frames.last]] as const) {
      if (!asset?.localPath) continue;
      const metadata = await stat(asset.localPath).catch(() => null);
      if (!metadata?.isFile() || metadata.size <= 0) throw new Error(`DIRECTOR_VIDEO_FRAME_MISSING: 当前镜头${label}文件不存在或为空，请重新生成图片。`);
    }
    const returnedVideoJobs = new Set(document.assets.filter(asset => asset.kind === 'video' && asset.providerJobId).map(asset => asset.providerJobId));
    const committedVideoCost = document.providerJobs
      .filter((job) => job.capability === 'image-to-video')
      // A synchronous provider may return paid media without a cloud task ID. Keep its
      // estimate committed after validation/processing failure, while excluding requests
      // definitively rejected before any result or remote submission receipt existed.
      .reduce((total, job) => total + (job.actualCost ?? (job.remoteTaskId || returnedVideoJobs.has(job.id)
        || job.phase === 'downloaded' || job.phase === 'completed' || !['failed', 'cancelled'].includes(job.status) ? job.estimatedCost : 0)), 0);
    const remainingBudget = Math.max(0, runtimeConfig.video.automation.budgetLimit - committedVideoCost);
    const selection = selectMotionComicVideoRoute(runtimeConfig, document, shot, remainingBudget);
    request = selection.request;
    const requiredCapabilities = selection.capabilities;
    const route = selection.route;
    for(const path of [...(request.referenceImages??[]).map(r=>r.path),...(request.referenceAudioPaths??[])]) {
      const info=await stat(path).catch(()=>null);
      if(!info?.isFile()||info.size<=0)throw new Error('DIRECTOR_VIDEO_REFERENCE_MISSING: 参考文件不存在或为空，请重新选择。');
    }
    if (route.kind !== 'provider') {
      throw new Error(`DIRECTOR_VIDEO_PROVIDER_UNAVAILABLE: ${route.reason} AI 漫剧视频不会自动降级或切换任务所属服务。`);
    }
    validateVideoGenerationRequest(route.provider, request);
    selectedProvider = route.provider;
    estimatedCost = route.estimatedCost;
    inputHash = createHash('sha256').update(JSON.stringify(motionComicVideoInputFingerprintSource(
      document,
      shot,
      route.provider.id,
      route.provider.model,
    ))).digest('hex');
    provider = createConfiguredVideoProvider({...runtimeConfig,video:{...runtimeConfig.video,providers:[route.provider]}}, taskWorkDir(task), {
      durationSec: request.durationSec,
      requiredCapabilities,
      remainingBudget,
    }, { submitRetryCount: 0, downloadResult: downloadVerifiedVideoResult });
  }
  // Recovery uses the submitted input, even when the current shot has since changed.
  const submittedFingerprint = resumableJob?.videoInputSnapshot
    ? JSON.parse(resumableJob.videoInputSnapshot) as { ratio?: string; durationSec?: number; production?: { audioMode?: string } }
    : undefined;
  const submittedAudioMode = resumableJob
    ? submittedFingerprint?.production?.audioMode ?? 'post-mix'
    : shot.videoProduction?.audioMode ?? 'post-mix';
  const preserveSubmittedAudio = submittedAudioMode === 'native' || submittedAudioMode === 'audio-driven';
  let jobId = resumableJob?.id;
  if (!resumableJob) {
    jobId = `director-video-job-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const attempt = document.providerJobs.filter((job) => job.nodeId === shot.id && job.capability === 'image-to-video').length + 1;
    const runningJob: MotionComicPipelineData['providerJobs'][number] = {
      id: jobId,
      workflowKind: 'motion-comic',
      nodeId: shot.id,
      episodeId: episode.id,
      providerId: selectedProvider.id,
      model: selectedProvider.model,
      capability: 'image-to-video',
      status: 'running',
      inputHash,
      videoAdoption: adoption,
      videoInputSnapshot: JSON.stringify(motionComicVideoInputFingerprintSource(document, shot, selectedProvider.id, selectedProvider.model)),
      phase: 'prepared',
      idempotencyKey: `${document.id}:${episode.id}:${shot.id}:video:${inputHash}:${attempt}`,
      estimatedCost,
      attempt,
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    const runningDocument: MotionComicPipelineData = {
      ...document,
      stage: 'keyframes',
      estimatedCost: document.estimatedCost + estimatedCost,
      costApprovedAt: document.costApprovedAt ?? startedAt,
      costSummary: `远程镜头视频：${selectedProvider.name} / ${selectedProvider.model}，${estimatedCost > 0 ? `本镜头预计 ${estimatedCost.toFixed(2)}` : '费用未知，以服务商实际账单为准'}。`,
      // Keep the current usable picture until a new output passes validation and is committed.
      assets: document.assets,
      providerJobs: [...document.providerJobs, runningJob],
      episodes: document.episodes,
    };
    const runningTask = await database.saveMotionComicTask({ id: document.id, expectedUpdatedAt: document.updatedAt, document: runningDocument });
    reservation.consume({ providerJobs: 1 });
    await publishTaskUpsert(database, runningTask.id);
  }
  if (!jobId) throw new Error('DIRECTOR_VIDEO_JOB_INVALID: 无法建立视频任务。');

  const jobMatches = (job: MotionComicPipelineData['providerJobs'][number]) =>
    job.id === jobId && job.workflowKind === 'motion-comic' && job.episodeId === episode.id
    && job.nodeId === shot.id && job.capability === 'image-to-video' && job.inputHash === inputHash
    && job.providerId === selectedProvider.id && job.model === selectedProvider.model
    && (job.videoAdoption ?? 'automatic') === adoption;

  const persistRemoteTaskId = async (remoteTaskId: string): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latestTask = await database.getTaskDetail(document.id);
      if (!latestTask) throw new Error(`DIRECTOR_PROJECT_NOT_FOUND: ${document.id}`);
      const latest = parseMotionComicPipelineData(latestTask.pipelineData);
      const persisted = latest.id === document.id ? latest.providerJobs.find(jobMatches) : undefined;
      if (!persisted) throw new Error(`DIRECTOR_VIDEO_JOB_NOT_FOUND: ${jobId}`);
      if (persisted.remoteTaskId === remoteTaskId) return;
      if (persisted.remoteTaskId && persisted.remoteTaskId !== remoteTaskId) throw new Error('DIRECTOR_VIDEO_REMOTE_TASK_CONFLICT: 云端任务 ID 与已保存记录不一致。');
      const now = new Date().toISOString();
      try {
        const saved = await database.saveMotionComicTask({
          id: latest.id,
          expectedUpdatedAt: latest.updatedAt,
          document: { ...latest, providerJobs: latest.providerJobs.map((candidate) => candidate.id === jobId ? { ...candidate, remoteTaskId, phase: 'submitted' as const, updatedAt: now } : candidate) },
        });
        await publishTaskUpsert(database, saved.id);
        return;
      } catch (error) {
        if (!(error instanceof Error && /^MOTION_COMIC_STALE_WRITE:/u.test(error.message)) || attempt === 2) throw error;
      }
    }
  };

  const outputDir = join(taskWorkDir(task), 'director-videos');
  const outputPath = join(outputDir, `${randomUUID()}.mp4`);
  const temporaryPath = `${outputPath}.tmp.mp4`;
  let chargedCost: number | undefined;
  let preservedStaleResult = false;
  // C-2: drop this task's abandoned resumable download parts (age-bounded) before a new download.
  await sweepTaskResumableParts(taskWorkDir(task));
  try {
    const generated = resumableJob
      ? await provider.resume!(resumableJob.remoteTaskId!, { estimatedCost: resumableJob.estimatedCost })
      : await provider.generate({ ...request!, onSubmitted: persistRemoteTaskId });
    chargedCost = resumableJob?.estimatedCost ?? generated.estimatedCost;
    await mkdir(outputDir, { recursive: true });
    const probe = await normalizeSceneVideo(generated.path, temporaryPath, preserveSubmittedAudio);
    if (probe.width <= 0 || probe.height <= 0) throw new Error('DIRECTOR_VIDEO_OUTPUT_INVALID: 视频尺寸不可读取。');
    // Advisory only (C-2): sampled before the final read so the save window stays short; failures are ignored.
    const cutFrames = await sampleShotCutFrames(database, document.id, episode.id, shot.id, temporaryPath);

    // Publish the file once; rebuild the completion against each fresh revision on conflict.
    await rename(temporaryPath, outputPath);
    const assetId = `director-video-asset-${randomUUID()}`;
    for (let completionAttempt = 0; completionAttempt < 3; completionAttempt += 1) {
      const latestTask = await database.getTaskDetail(document.id);
      if (!latestTask) throw new Error(`DIRECTOR_PROJECT_NOT_FOUND: ${document.id}`);
      const latest = parseMotionComicPipelineData(latestTask.pipelineData);
      const latestEpisode = latest.episodes.find((candidate) => candidate.id === episode.id);
      const latestShot = latestEpisode?.scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === shot.id);
      let currentHash = '';
      let currentPrompt = '';
      let currentValidation: { durationMs: number; ratio: string } | undefined;
      try {
        if (latestShot) {
          const currentFingerprint = motionComicVideoInputFingerprintSource(latest, latestShot, generated.providerId, generated.model);
          currentHash = createHash('sha256').update(JSON.stringify(currentFingerprint)).digest('hex');
          currentPrompt = currentFingerprint.prompt;
          currentValidation = { durationMs: latestShot.durationMs, ratio: currentFingerprint.ratio };
        }
      } catch {
        currentHash = '';
      }
      const persistedJob = latest.providerJobs.find(jobMatches);
      if (latest.id !== document.id || !persistedJob || (persistedJob.status !== 'running' && !recoveryOnly)) {
        throw new Error('DIRECTOR_VIDEO_JOB_INVALID: 视频任务绑定已变化，不能写入结果。');
      }
      const currentJob = latestProductionProviderJob(latest.providerJobs, shot.id, 'image-to-video', episode.id);
      const stale = !latestShot || currentJob?.id !== jobId || latestShot.videoJobId !== shot.videoJobId || latestShot.renderStrategy !== 'remote-video' || !currentValidation || currentHash !== inputHash;
      // Validate against the submitted contract even when authored inputs changed during generation.
      const expectedRatio = submittedFingerprint?.ratio ?? request?.ratio ?? document.ratio;
      const expectedDurationMs = resumableJob ? (submittedFingerprint?.durationSec ?? shot.durationMs / 1000) * 1000 : request!.durationSec * 1000;
      let outputValidation: MotionComicPipelineData['assets'][number]['outputValidation'];
      try {
        if (probe.durationMs + 100 < expectedDurationMs) throw new Error(`DIRECTOR_VIDEO_OUTPUT_TOO_SHORT: 当前镜头需要 ${(expectedDurationMs / 1000).toFixed(1)} 秒，生成视频只有 ${(probe.durationMs / 1000).toFixed(1)} 秒。`);
        assertMotionComicVideoOutputRatio(expectedRatio, probe.width, probe.height);
      } catch (error) {
        const validation = normalizeAppError(error, { code: 'DIRECTOR_VIDEO_OUTPUT_INVALID', message: '视频输出校验未通过。', retryable: false });
        outputValidation = { status: 'rejected', code: validation.code, reason: validation.message, width: probe.width, height: probe.height, expectedRatio, expectedDurationMs };
      }
      const shouldAdopt = !candidateOnly && !stale && !outputValidation;
      const finishedAt = new Date().toISOString();
      const logicalAssetId = `shot-video-${shot.id}`;
      const continuityAdvice = stale ? undefined : shotContinuityAdvice(cutFrames, latestEpisode, shot.id, assetId);
      const videoAsset: MotionComicPipelineData['assets'][number] = {
        id: assetId,
        assetId: logicalAssetId,
        kind: 'video',
        localPath: outputPath,
        prompt: (request?.prompt ?? currentPrompt) || shot.prompt,
        providerJobId: jobId,
        provider: generated.providerName,
        model: generated.model,
        license: generated.license,
        durationMs: probe.durationMs,
        ...(outputValidation ? { outputValidation } : {}),
        episodeId: episode.id,
        createdAt: finishedAt,
        selected: shouldAdopt,
        pinned: false,
      };
      const completedCost = resumableJob?.estimatedCost ?? generated.estimatedCost;
      const completedDocument: MotionComicPipelineData = {
        ...latest,
        assets: [...latest.assets.map((asset) => shouldAdopt && asset.assetId === logicalAssetId ? { ...asset, selected: false } : asset), videoAsset],
        providerJobs: latest.providerJobs.map((candidate) => candidate.id === jobId ? {
          ...candidate,
          status: outputValidation ? 'failed' as const : 'completed' as const,
          phase: 'completed' as const,
          remoteTaskId: generated.remoteTaskId ?? candidate.remoteTaskId,
          updatedAt: finishedAt,
          // A returned result consumes the original estimate even when validation rejects it.
          estimatedCost: Math.max(candidate.estimatedCost, completedCost),
          ...(outputValidation ? { error: outputValidation.reason } : stale ? { error: '生成完成，但镜头输入已变化；结果保留在历史版本中。' } : { error: undefined }),
        } : candidate),
        episodes: !shouldAdopt ? latest.episodes : latest.episodes.map((candidateEpisode) => candidateEpisode.id !== episode.id ? candidateEpisode : {
          ...candidateEpisode,
          scenes: candidateEpisode.scenes.map((scene) => ({
            ...scene,
            shots: scene.shots.map((candidate) => !stale && candidate.id === shot.id
              ? { ...candidate, videoJobId: jobId, videoAssetVersionId: assetId, continuityAdvice }
              : candidate),
          })),
          timeline: {
            ...candidateEpisode.timeline,
            clips: candidateEpisode.timeline.clips.map((clip) => !stale && clip.shotId === shot.id
              ? { ...clip, assetVersionIds: [...new Set([...clip.assetVersionIds.filter((id) => latest.assets.find((asset) => asset.id === id)?.kind !== 'video'), assetId])], source: 'ai-video' as const }
              : clip),
          },
        }),
      };
      let saved: Task;
      try {
        saved = await database.saveMotionComicTask({ id: latest.id, expectedUpdatedAt: latest.updatedAt, document: completedDocument });
      } catch (error) {
        if (error instanceof Error && /^MOTION_COMIC_STALE_WRITE:/u.test(error.message) && completionAttempt < 2) continue;
        throw error;
      }
      // A later notification failure must never delete a durably committed asset.
      preservedStaleResult = true;
      reservation.consume({ assets: 1 });
      const mutation = await publishTaskUpsert(database, saved.id);
      const result: DirectorGenerateShotVideoResult = {
        videoAssetVersionId: assetId,
        videoJobId: jobId,
        providerId: generated.providerId,
        providerName: generated.providerName,
        model: generated.model,
        estimatedCost: completedCost,
        durationMs: probe.durationMs,
      };
      if (outputValidation) throw new Error(`${outputValidation.code}: ${outputValidation.reason}`);
      if (stale) {
        preservedStaleResult = true;
        throw new Error('DIRECTOR_VIDEO_INPUT_CHANGED: 生成期间镜头已发生变化，结果已保留为未选中的历史版本。');
      }
      return { result, mutation };
    }
    throw new Error('MOTION_COMIC_STALE_WRITE: 视频结果保存冲突，请恢复原云端任务。');
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (!preservedStaleResult) await rm(outputPath, { force: true }).catch(() => undefined);
    const normalized = normalizeAppError(error, { code: 'DIRECTOR_VIDEO_GENERATION_FAILED', message: 'AI 漫剧远程视频生成失败。', retryable: true });
    if (!preservedStaleResult) {
      const failedTask = await database.getTaskDetail(document.id).catch(() => null);
      if (failedTask?.pipelineData) {
        const latest = parseMotionComicPipelineData(failedTask.pipelineData);
        const existing = latest.id === document.id ? latest.providerJobs.find(jobMatches) : undefined;
        if (existing?.status === 'running') {
          const finishedAt = new Date().toISOString();
          const terminal = motionComicVideoFailureIsTerminal(error, normalized.code, {
            charged: chargedCost !== undefined,
            remoteTaskId: existing.remoteTaskId,
          });
          const failedDocument: MotionComicPipelineData = {
            ...latest,
            providerJobs: latest.providerJobs.map((candidate) => candidate.id === jobId ? {
              ...candidate,
              status: terminal ? 'failed' as const : 'running' as const,
              updatedAt: finishedAt,
              error: normalized.message.slice(0, 65_536),
              ...(chargedCost !== undefined ? { estimatedCost: Math.max(candidate.estimatedCost, chargedCost), phase: 'downloaded' as const } : {}),
            } : candidate),
          };
          const saved = await database.saveMotionComicTask({ id: latest.id, expectedUpdatedAt: latest.updatedAt, document: failedDocument }).catch(() => null);
          if (saved) await publishTaskUpsert(database, saved.id);
        }
      }
    }
    throw normalized;
  }
}

const UNCERTAIN_VIDEO_SUBMISSION_HTTP_STATUSES = new Set([408, 425, 429]);

function motionComicVideoFailureIsTerminal(
  error: unknown,
  normalizedCode: string,
  state: { charged: boolean; remoteTaskId?: string },
): boolean {
  // Saving/notification failures after a paid result must recover the known task, never submit again.
  if (state.remoteTaskId && /^(?:MOTION_COMIC_STALE_WRITE|DIRECTOR_PROJECT_NOT_FOUND)$/u.test(normalizedCode)) return false;
  if (/^(?:VIDEO_PROVIDER_(?:JOB_FAILED|INVALID_OUTPUT)|DIRECTOR_VIDEO_OUTPUT_(?:TOO_SHORT|INVALID|RATIO_MISMATCH))$/u.test(normalizedCode)) return true;
  // A known remote task also survives local normalization, filesystem and database failures.
  // Polling it again retrieves the paid result without submitting a second generation.
  if (state.remoteTaskId) return false;
  if (state.charged) return true;
  if (/^VIDEO_PROVIDER_(?:NOT_CONFIGURED|PROMPT_REQUIRED|FIRST_FRAME_REQUIRED|DURATION_INVALID|DURATION_UNSUPPORTED|RATIO_UNSUPPORTED|RESOLUTION_UNSUPPORTED|CAPABILITY_MISSING|BUDGET_EXCEEDED|REFERENCE_(?:INVALID|LIMIT|MODE_CONFLICT)|PROMPT_TOO_LONG|ROUTE_MISMATCH|RETRY_INVALID|TASK_ID_REQUIRED)$/u.test(normalizedCode)) {
    return true;
  }

  const status = videoProviderHttpStatus(error);
  if (status !== undefined) {
    return status >= 400 && status < 500 && !UNCERTAIN_VIDEO_SUBMISSION_HTTP_STATUSES.has(status);
  }

  // Some compatible APIs omit the HTTP status from an otherwise explicit rejection payload.
  // Keep generic transport errors resumable, and only close the job for an unambiguous rejection.
  if (normalizedCode === 'VIDEO_PROVIDER_HTTP_ERROR') {
    return /\b(?:bad[_ -]?request|invalid[_ -]?(?:request|api[_ -]?key|token|credential|parameter|model)|incorrect[_ -]?api[_ -]?key|authentication[_ -]?(?:failed|required)|unauthorized|forbidden|access[_ -]?denied|permission[_ -]?denied|model[_ -]?not[_ -]?found|request[_ -]?rejected|unprocessable|payment[_ -]?required|insufficient[_ -]?(?:balance|quota)|content[_ -]?policy)\b|(?:请求|内容).{0,12}(?:拒绝|不允许|违规)|(?:鉴权|认证|权限|参数|模型|余额|配额).{0,12}(?:无效|失败|不足|拒绝|不存在|超限)/iu.test(videoProviderErrorText(error));
  }
  return false;
}

function videoProviderHttpStatus(error: unknown): number | undefined {
  let current = error;
  const visited = new Set<object>();
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; cause?: unknown };
    for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599) return value;
    }
    current = candidate.cause;
  }
  const match = videoProviderErrorText(error).match(/(?:\bHTTP(?:_ERROR)?|\bstatus)\s*[:(]?\s*([45]\d{2})\b|^\s*([45]\d{2})\b/iu);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

function videoProviderErrorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '';
}

function assertMotionComicVideoOutputRatio(ratio: string, width: number, height: number): void {
  const expected = directorCanvasForRatio(ratio);
  const expectedAspectRatio = expected.width / expected.height;
  const actualAspectRatio = width / height;
  const relativeError = Math.abs(actualAspectRatio / expectedAspectRatio - 1);
  if (relativeError > 0.03) {
    throw new Error(`DIRECTOR_VIDEO_OUTPUT_RATIO_MISMATCH: 当前项目画幅为 ${ratio}，生成视频尺寸 ${width}x${height} 与目标宽高比偏差 ${(relativeError * 100).toFixed(1)}%。`);
  }
}

  async function withMotionComicShotVideoRecoveryLock<T>(id: string, shotId: string, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([id, shotId]);
    if (active.has(key)) throw new Error('DIRECTOR_VIDEO_REQUEST_ACTIVE: 当前镜头的视频请求仍在执行，请等待结束后再核对。');
    active.add(key);
    try { return await work(); } finally { active.delete(key); }
  }
  const run = (recoveryOnly: boolean, database: FileDatabase, task: Task, input: DirectorGenerateShotVideoRequest, reservation: ProductionHistoryReservation) =>
    withMotionComicShotVideoRecoveryLock(input.id, input.shotId, () => executeMotionComicShotVideo(database, task, input, reservation, recoveryOnly));
  return {
    generateMotionComicShotVideo: (database: FileDatabase, task: Task, input: DirectorGenerateShotVideoRequest, reservation: ProductionHistoryReservation) => run(false, database, task, input, reservation),
    recoverMotionComicShotVideo: (database: FileDatabase, task: Task, input: DirectorGenerateShotVideoRequest, reservation: ProductionHistoryReservation) => run(true, database, task, input, reservation),
    isActive: (id: string, shotId: string) => active.has(JSON.stringify([id, shotId])),
    withMotionComicShotVideoRecoveryLock,
  };
}

async function sweepTaskResumableParts(workDir: string): Promise<void> {
  await sweepStaleResumableParts({ tasksRoot: dirname(workDir), storageKeys: [basename(workDir)] }).catch(() => undefined);
}

interface ShotCutFrames extends ContinuityFramePair {
  previousShotId: string;
  previousVideoAssetVersionId: string;
}

/** Last frame of the previous shot's selected video + first frame of the new video. Never throws. */
async function sampleShotCutFrames(
  database: FileDatabase,
  documentId: string,
  episodeId: string,
  shotId: string,
  videoPath: string,
): Promise<ShotCutFrames | undefined> {
  try {
    const task = await database.getTaskDetail(documentId);
    if (!task) return undefined;
    const current = parseMotionComicPipelineData(task.pipelineData);
    const episode = current.episodes.find((candidate) => candidate.id === episodeId);
    const previous = episode ? motionComicPreviousShot(episode, shotId) : undefined;
    const previousVideoAssetVersionId = previous?.videoAssetVersionId;
    if (!previous || !previousVideoAssetVersionId) return undefined;
    const previousVideo = current.assets.find((asset) => asset.id === previousVideoAssetVersionId && asset.kind === 'video' && asset.localPath);
    if (!previousVideo?.localPath) return undefined;
    const frames = await sampleMotionComicCutFrames({ previousVideoPath: previousVideo.localPath, videoPath });
    return frames ? { ...frames, previousShotId: previous.id, previousVideoAssetVersionId } : undefined;
  } catch {
    return undefined;
  }
}

/** Advisory record, only when the previous shot still shows the video that was sampled. Never throws. */
function shotContinuityAdvice(
  frames: ShotCutFrames | undefined,
  episode: MotionComicEpisode | undefined,
  shotId: string,
  videoAssetVersionId: string,
): MotionComicShotContinuityAdvice | undefined {
  if (!frames || !episode) return undefined;
  try {
    const previous = motionComicPreviousShot(episode, shotId);
    if (previous?.id !== frames.previousShotId || previous.videoAssetVersionId !== frames.previousVideoAssetVersionId) return undefined;
    return buildMotionComicShotContinuityAdvice({ ...frames, videoAssetVersionId });
  } catch {
    return undefined;
  }
}
