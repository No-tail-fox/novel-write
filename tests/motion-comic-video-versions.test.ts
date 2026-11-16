import { describe, expect, it } from 'vitest';
import { directorDocumentRenderFingerprint, directorQualityReview, directorRenderOutputs } from '@shared/director-render';
import { currentMotionComicShotContinuityAdvice } from '@shared/motion-comic-continuity';
import { createMotionComicDraft, createMotionComicStarterProject } from '@shared/motion-comic';
import { motionComicVideoInputHash } from '@shared/motion-comic-video';
import { adoptMotionComicVideoVersion, motionComicVideoVersions } from '@shared/motion-comic-video-versions';

function fixture() {
  const now = '2026-09-18T00:00:00.000Z';
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'versions', title: '历史候选', premise: '雨夜交换信件', now }), '第一集', now);
  const episode = document.episodes[0], shot = episode.scenes[0].shots[0];
  shot.renderStrategy = 'remote-video'; shot.firstFrameAssetVersionId = 'frame';
  shot.videoProduction = { version: 1, referenceMode: 'frames', audioMode: 'post-mix' };
  document.assets.push({ id: 'frame', assetId: 'frame', kind: 'image', localPath: 'C:/frame.png', createdAt: now });
  for (const id of ['old', 'new']) {
    document.providerJobs.push({ id: `job-${id}`, workflowKind: 'motion-comic', nodeId: shot.id, episodeId: episode.id, providerId: 'test', model: 'test', capability: 'image-to-video', status: 'completed', inputHash: motionComicVideoInputHash(document, shot, 'test', 'test'), idempotencyKey: id, estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now });
    document.assets.push({ id, assetId: `shot-video-${shot.id}`, episodeId: episode.id, kind: 'video', localPath: `C:/${id}.mp4`, providerJobId: `job-${id}`, selected: id === 'new', createdAt: now });
  }
  shot.videoAssetVersionId = 'new'; shot.videoJobId = 'job-new';
  const clip = episode.timeline.clips.find(item => item.shotId === shot.id)!;
  clip.assetVersionIds = ['frame', 'new'];
  return { document, episode, shot, adopt: () => adoptMotionComicVideoVersion(document, episode.id, shot.id, 'old') };
}

describe('motion comic video history adoption', () => {
  it('atomically binds the old job, selected asset and timeline while preserving history and revision', () => {
    const { document, episode, shot, adopt } = fixture();
    const before = structuredClone(document), next = adopt();
    expect(document).toEqual(before);
    expect(next.updatedAt).toBe(document.updatedAt);
    expect(next.assets).toHaveLength(document.assets.length);
    expect(next.providerJobs).toEqual(document.providerJobs);
    expect(next.assets.find(a => a.id === 'new')?.selected).toBe(false);
    expect(next.assets.find(a => a.id === 'old')?.selected).toBe(true);
    const updated = next.episodes[0].scenes[0].shots[0];
    expect(updated).toMatchObject({ videoJobId: 'job-old', videoAssetVersionId: 'old' });
    expect(next.episodes[0].timeline.clips.find(c => c.shotId === shot.id)).toMatchObject({ assetVersionIds: ['frame', 'old'], source: 'ai-video' });
    expect(motionComicVideoVersions(next, updated).find(v => v.asset.id === 'old')?.current).toBe(true);
    expect(adoptMotionComicVideoVersion(next, episode.id, shot.id, 'old')).toEqual(next);
  });
  it('makes the old film and review stale through exact render fingerprints without deleting history', () => {
    const { document, episode, adopt } = fixture();
    const fingerprint = directorDocumentRenderFingerprint(document, episode.id);
    document.assets.push({ id: 'film', assetId: 'director-final-video', kind: 'video', episodeId: episode.id,
      selected: true, pinned: true, localPath: 'C:/film.mp4', renderFingerprint: fingerprint, createdAt: document.updatedAt });
    document.providerJobs.push({ ...document.providerJobs[0], id: 'render', capability: 'deterministic-render', renderFingerprint: fingerprint });
    document.qualityReports.push({ id: 'review', workflowKind: 'motion-comic', stage: 'export', status: 'passed',
      checks: [], episodeId: episode.id, providerJobId: 'render', renderFingerprint: fingerprint, createdAt: document.updatedAt });
    expect(directorRenderOutputs(document, episode.id).current?.id).toBe('film');
    expect(directorQualityReview(document, episode.id).freshness).toBe('current');
    const next = adopt();
    expect(directorDocumentRenderFingerprint(next, episode.id)).not.toBe(fingerprint);
    expect(directorRenderOutputs(next, episode.id).current).toBeUndefined();
    expect(directorRenderOutputs(next, episode.id).history).toEqual(directorRenderOutputs(document, episode.id).history);
    expect(directorQualityReview(next, episode.id)).toMatchObject({ freshness: 'stale', report: document.qualityReports[0] });
    expect(next.qualityReports).toEqual(document.qualityReports);
  });
  it('invalidates next-shot continuity advice by its previous-video binding without invalidating its generated video', () => {
    const { document, episode, shot, adopt } = fixture();
    const following = episode.scenes.flatMap(scene => scene.shots)[1];
    following.videoAssetVersionId = 'following-video';
    following.continuityAdvice = { version: 1, advisory: true, method: 'perceptual-hash', videoAssetVersionId: 'following-video',
      previousShotId: shot.id, previousVideoAssetVersionId: 'new', score: 1, level: 'good', ahashDistance: 0, dhashDistance: 0,
      meanLumaDelta: 0, computedAt: document.updatedAt };
    expect(currentMotionComicShotContinuityAdvice(episode, following)).toEqual(following.continuityAdvice);
    const next = adopt(), nextEpisode = next.episodes[0];
    const nextShot = nextEpisode.scenes.flatMap(scene => scene.shots)[1];
    expect(currentMotionComicShotContinuityAdvice(nextEpisode, nextShot)).toBeUndefined();
    expect(nextShot.videoAssetVersionId).toBe('following-video');
    expect(nextShot.continuityAdvice).toEqual(following.continuityAdvice);
  });
  it('isolates episodes in listing, adoption and selected state', () => {
    const { document, shot, adopt } = fixture();
    const foreign = { ...document.assets.find(a => a.id === 'old')!, id: 'foreign', episodeId: 'other', selected: true };
    document.assets.push(foreign);
    expect(motionComicVideoVersions(document, shot).map(v => v.asset.id)).not.toContain('foreign');
    expect(adopt().assets.find(a => a.id === 'foreign')).toEqual(foreign);
    expect(() => adoptMotionComicVideoVersion(document, shot.episodeId, shot.id, 'foreign')).toThrow('不属于');
    expect(() => adoptMotionComicVideoVersion(document, 'other', shot.id, 'old')).toThrow('不存在');
  });
  it.each(['nodeId', 'episodeId', 'capability', 'workflowKind'] as const)('rejects a mismatched job %s', field => {
    const { document, adopt } = fixture();
    Object.assign(document.providerJobs[0], { [field]: 'wrong' });
    expect(adopt).toThrow('来源不明');
  });
  it.each(['running', 'queued', 'failed', 'cancelled', 'unknown'] as const)('never adopts %s jobs', status => {
    const { document, adopt } = fixture();
    Object.assign(document.providerJobs[0], { status });
    expect(adopt).toThrow('尚未确认完成');
  });
  it('rejects unknown job, wrong logical asset and missing local path', () => {
    for (const patch of [{ providerJobId: 'missing' }, { assetId: 'wrong' }, { localPath: '' }]) {
      const { document, adopt } = fixture();
      Object.assign(document.assets.find(a => a.id === 'old')!, patch);
      expect(adopt).toThrow();
    }
  });
  it('keeps stale candidates read-only and never rewrites the input hash', () => {
    const { document, shot, adopt } = fixture();
    shot.motionPrompt += ' changed';
    const jobs = structuredClone(document.providerJobs);
    expect(motionComicVideoVersions(document, shot)).toHaveLength(2);
    expect(motionComicVideoVersions(document, shot)[0].unavailableReason).toContain('过期');
    expect(adopt).toThrow('过期');
    expect(document.providerJobs).toEqual(jobs);
  });
  it('derives current binding from the shot and job, not a stray selected flag', () => {
    const { document, shot } = fixture();
    document.assets.find(a => a.id === 'old')!.selected = true;
    expect(motionComicVideoVersions(document, shot).find(v => v.asset.id === 'old')?.current).toBe(false);
    shot.videoJobId = 'wrong';
    expect(motionComicVideoVersions(document, shot).every(v => !v.current)).toBe(true);
  });
});
