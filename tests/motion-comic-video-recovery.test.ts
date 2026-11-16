import { describe, expect, it, vi } from 'vitest';
import { recoverMotionComicVideoSubmission } from '../electron/motion-comic-video-recovery';
import { motionComicVideoRecoveryInputSchema } from '../src/shared/motion-comic-video-recovery';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
const parseInvokePayload = (channel: 'motion-comic:recover-video-submission' | 'director:resume-shot-video', value: unknown) => ipcInputSchemas[channel].parse(value);
import type { Task } from '../src/shared/types';

const now = '2026-11-15T00:00:00.000Z';
function fixture() {
  let document = createMotionComicStarterProject(createMotionComicDraft({ id: 'recover-project', title: 'test', premise: 'test', now }));
  const shot = document.episodes[0].scenes[0].shots[0];
  document.providerJobs.push({ id: 'unknown-job', workflowKind: 'motion-comic', nodeId: shot.id, episodeId: shot.episodeId, providerId: 'provider', model: 'model', capability: 'image-to-video', status: 'running', phase: 'prepared', error: 'transport unknown', inputHash: 'hash', idempotencyKey: 'original-key', estimatedCost: 4, attempt: 1, createdAt: now, updatedAt: now });
  let archivedAt: string | null = null;
  const task = () => ({ id: document.id, taskType: 'motion-comic', archivedAt, pipelineData: JSON.stringify(document) }) as Task;
  const save = vi.fn(async (input) => {
    if (input.expectedUpdatedAt !== document.updatedAt) throw Error('MOTION_COMIC_STALE_WRITE');
    document = parseMotionComicPipelineData({ ...input.document, updatedAt: '2026-11-15T00:00:01.000Z' });
    return task();
  });
  const deps = { database: { getTaskDetail: vi.fn(async () => task()), saveMotionComicTask: save }, isActive: vi.fn(() => false), publishTaskUpsert: vi.fn(async () => null), now: () => '2026-11-15T00:00:01.000Z' };
  const input = { id: document.id, shotId: shot.id, jobId: 'unknown-job', expectedUpdatedAt: now };
  return { deps, input, save, current: () => document, archive: () => { archivedAt = now; } };
}

describe('motion comic manual unknown submission recovery', () => {
  it('strictly validates recoverMotionComicVideoSubmission and resumeDirectorShotVideo at the IPC security boundary', () => {
    const base = fixture().input;
    const attach = { ...base, action: 'attach-remote-task', remoteTaskId: 'task_123:abc-1' };
    expect(motionComicVideoRecoveryInputSchema.parse(attach)).toEqual(attach);
    expect(parseInvokePayload('motion-comic:recover-video-submission', attach)).toEqual(attach);
    expect(parseInvokePayload('director:resume-shot-video', { id: base.id, shotId: base.shotId, expectedUpdatedAt: now })).toBeTruthy();
    for (const bad of [
      { ...base, action: 'attach-remote-task' },
      ...['', ' ', 'https://provider/task', '../task', 'a/b', 'a\\b', 'a\nb', 'a b', 'a'.repeat(257)].map(remoteTaskId => ({ ...attach, remoteTaskId })),
      { ...base, action: 'confirm-not-submitted' }, { ...base, action: 'confirm-not-submitted', confirmedNotSubmitted: false },
      { ...attach, confirmedNotSubmitted: true }, { ...base, action: 'other' }, { ...attach, expectedUpdatedAt: 'invalid' }, { ...attach, providerId: 'attacker' },
    ]) expect(() => parseInvokePayload('motion-comic:recover-video-submission', bad)).toThrow();
  });
  it('attaches a remote task without changing intent or invoking a provider, and persists separate audit evidence', async () => {
    const f = fixture(); const before = structuredClone(f.current().episodes);
    const r = await recoverMotionComicVideoSubmission({ ...f.input, action: 'attach-remote-task', remoteTaskId: 'task_known' }, f.deps);
    expect(r.document.providerJobs[0]).toMatchObject({ status: 'running', remoteTaskId: 'task_known', phase: 'submitted', inputHash: 'hash', idempotencyKey: 'original-key', estimatedCost: 4 });
    expect(r.document.providerJobs[1]).toMatchObject({ capability: 'video-submission-recovery', status: 'completed', estimatedCost: 0 });
    expect(JSON.parse(r.document.providerJobs[1].error!)).toMatchObject({ action: 'attach-remote-task', jobId: 'unknown-job', remoteTaskId: 'task_known', previousError: 'transport unknown' });
    expect(r.document.episodes).toEqual(before); expect(f.save).toHaveBeenCalledTimes(1);
  });
  it('marks only the confirmed unsubmitted request failed without resending or changing other media', async () => {
    const f = fixture();
    const r = await recoverMotionComicVideoSubmission({ ...f.input, action: 'confirm-not-submitted', confirmedNotSubmitted: true }, f.deps);
    expect(r.document.providerJobs[0]).toMatchObject({ status: 'failed', phase: 'prepared' });
    expect(r.document.providerJobs[0].remoteTaskId).toBeUndefined();
    expect(JSON.parse(r.document.providerJobs[1].error!)).toMatchObject({ confirmedNotSubmitted: true });
    await expect(recoverMotionComicVideoSubmission({ ...f.input, expectedUpdatedAt: r.document.updatedAt, action: 'confirm-not-submitted', confirmedNotSubmitted: true }, f.deps)).rejects.toThrow('仅可人工核对');
  });
  it.each(['archived', 'stale', 'active', 'missing-error', 'has-id', 'wrong-shot', 'wrong-job', 'wrong-episode', 'wrong-workflow', 'completed', 'superseded'] as const)('rejects %s with no mutation', async kind => {
    const f = fixture(); const job = f.current().providerJobs[0]; const input = { ...f.input, action: 'attach-remote-task' as const, remoteTaskId: 'known' };
    if (kind === 'archived') f.archive();
    if (kind === 'stale') input.expectedUpdatedAt = '2026-11-14T00:00:00.000Z';
    if (kind === 'active') f.deps.isActive.mockReturnValue(true);
    if (kind === 'missing-error') job.error = '';
    if (kind === 'has-id') job.remoteTaskId = 'existing';
    if (kind === 'wrong-shot') input.shotId = 'foreign-shot';
    if (kind === 'wrong-job') input.jobId = 'foreign-job';
    if (kind === 'wrong-episode') job.episodeId = 'foreign-episode';
    if (kind === 'wrong-workflow') job.workflowKind = 'editorial-collage';
    if (kind === 'completed') job.status = 'completed';
    if (kind === 'superseded') f.current().providerJobs.push({ ...job, id: 'new-job', attempt: 2 });
    await expect(recoverMotionComicVideoSubmission(input, f.deps)).rejects.toThrow(); expect(f.save).not.toHaveBeenCalled();
  });
  it('checks activity again after asynchronous reads and propagates storage version races', async () => {
    const f = fixture(); f.deps.isActive.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(recoverMotionComicVideoSubmission({ ...f.input, action: 'attach-remote-task', remoteTaskId: 'known' }, f.deps)).rejects.toThrow('仍在执行'); expect(f.save).not.toHaveBeenCalled();
    f.deps.isActive.mockReturnValue(false); f.save.mockRejectedValueOnce(Error('MOTION_COMIC_STALE_WRITE'));
    await expect(recoverMotionComicVideoSubmission({ ...f.input, action: 'attach-remote-task', remoteTaskId: 'known' }, f.deps)).rejects.toThrow('STALE_WRITE'); expect(f.deps.publishTaskUpsert).not.toHaveBeenCalled();
  });
});
