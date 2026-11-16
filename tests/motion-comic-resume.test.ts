import { describe, expect, it } from 'vitest';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { resolveMotionComicResume } from '../src/features/motion-comic/motion-comic-resume';
const now = '2026-11-12T00:00:00.000Z';
function fixture() {
  const initial = createMotionComicStarterProject(createMotionComicDraft({ id: 'resume', title: '恢复', premise: '一封信', now }));
  const document = appendMotionComicEpisode(initial, { id: 'sibling', title: '第二集' });
  document.activeEpisodeId = initial.episodes[0].id;
  return document;
}
describe('resume the active episode', () => {
  it('does not redirect to a malformed sibling act structure', () => {
    const document = fixture();
    const before = resolveMotionComicResume(document);
    document.episodes[1].scenes[0].actIndex = 8;
    expect(resolveMotionComicResume(document)).toEqual(before);
    expect(before.shotId).toBe(document.episodes[0].scenes[0].shots[0].id);
  });
  it('selects the source evidence of the active episode', () => {
    const document = fixture();
    document.episodes[0].planningEvidence = { sourceEpisodeId: 'source-current', sourceText: '原文' } as NonNullable<typeof document.episodes[0]['planningEvidence']>;
    expect(resolveMotionComicResume(document).sourceEpisodeId).toBe('source-current');
  });
  it('continues completed frame-free native videos to export without demanding unused image inputs', () => {
    const document = fixture();
    const episode = document.episodes[0];
    episode.dialogueCues = [];
    for (const shot of episode.scenes.flatMap(scene => scene.shots)) {
      shot.renderStrategy = 'remote-video';
      shot.videoProduction = { version: 1, referenceMode: 'references', audioMode: 'native' };
      delete shot.firstFrameAssetVersionId;
      shot.videoAssetVersionId = `video-${shot.id}`;
      shot.videoJobId = `job-${shot.id}`;
      document.assets.push({ id: shot.videoAssetVersionId, assetId: shot.id, kind: 'video', localPath: 'C:/video.mp4', createdAt: now, providerJobId: shot.videoJobId });
      document.providerJobs.push({ id: shot.videoJobId, nodeId: shot.id, capability: 'image-to-video', status: 'completed', providerId: 'fixture', model: 'fixture', workflowKind: 'motion-comic', inputHash: 'fixture', idempotencyKey: shot.id, attempt: 1, estimatedCost: 0, createdAt: now, updatedAt: now });
    }
    expect(resolveMotionComicResume(document).stage).toBe('export');
    const pending = episode.scenes.flatMap(scene => scene.shots)[1];
    pending.videoProduction!.audioMode = 'post-mix';
    pending.dialogueCueIds = ['missing-dialogue'];
    delete pending.voiceAssetVersionId;
    episode.dialogueCues = [{ id: 'missing-dialogue', shotId: pending.id, startMs: 0, endMs: 1000, text: '待录制对白', emotion: 'neutral' }];
    expect(resolveMotionComicResume(document)).toMatchObject({ stage: 'audio', shotId: pending.id });
    delete pending.videoAssetVersionId;
    delete pending.videoJobId;
    expect(resolveMotionComicResume(document).shotId).toBe(pending.id);
  });
  it('restores legacy source-text association before selecting an unfinished sibling', () => {
    const document = fixture();
    document.sourceDocument = { originalText: '另一集\n当前源文', episodes: [
      { id: 'unfinished', number: 1, title: '待规划', sourceText: '另一集' },
      { id: 'legacy-current', number: 2, title: '当前集', sourceText: '当前源文' },
    ] } as typeof document.sourceDocument;
    document.episodes[0].planningEvidence = { sourceText: ' 当前源文 ' } as NonNullable<typeof document.episodes[0]['planningEvidence']>;
    expect(resolveMotionComicResume(document).sourceEpisodeId).toBe('legacy-current');
  });
  it('falls back to the first episode if the active id no longer exists', () => {
    const document = fixture();
    document.activeEpisodeId = 'removed';
    expect(resolveMotionComicResume(document).shotId).toBe(document.episodes[0].scenes[0].shots[0].id);
  });
});
