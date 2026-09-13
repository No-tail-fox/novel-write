import { describe, expect, it, vi } from 'vitest';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData, type MotionComicPipelineData } from '../src/shared/motion-comic';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint as fingerprint, directorRenderOutputs, evaluateDirectorQuality, mergeDirectorRenderCompletion, persistDirectorRenderCompletion, type DirectorRenderCompletion, type DirectorRenderDocument } from '../src/shared/director-render';

const now = '2026-09-06T00:00:00.000Z';
function fixture() {
  const first = createMotionComicStarterProject(createMotionComicDraft({ id: 'comic', title: 'Series', premise: 'Test', now }), 'First', now);
  const document = appendMotionComicEpisode(first, { id: 'second', title: 'Second', now });
  document.activeEpisodeId = document.episodes[0].id;
  return document;
}
function completion(document: DirectorRenderDocument, id = 'render-1', createdAt = now, failed = false): DirectorRenderCompletion {
  const episodeId = document.workflowKind === 'motion-comic' ? document.activeEpisodeId : undefined;
  const renderFingerprint = fingerprint(document, episodeId);
  return {
    ...(!failed ? { asset: { id, assetId: 'director-final-video', kind: 'video' as const, episodeId, renderFingerprint, providerJobId: `job-${id}`, createdAt, localPath: `E:/fixture/${id}.mp4` } } : {}),
    job: { id: `job-${id}`, nodeId: episodeId ?? document.id, episodeId, renderFingerprint, workflowKind: document.workflowKind, providerId: 'local', model: 'ffmpeg', capability: 'deterministic-render', status: failed ? 'failed' : 'completed', inputHash: renderFingerprint, idempotencyKey: id, estimatedCost: 0, attempt: 1, createdAt, updatedAt: createdAt },
    report: { id: `report-${id}`, workflowKind: document.workflowKind, stage: 'export', status: failed ? 'failed' : 'passed', checks: [], createdAt },
  };
}

describe('director render input ownership', () => {
  it('invalidates output fingerprints from the older subtitle layout', () => {
    const document = fixture(); const current = completion(document);
    current.asset!.selected = true;
    document.assets.push(current.asset!);
    expect(directorRenderOutputs(document).current?.id).toBe(current.asset!.id);
    current.asset!.renderFingerprint = current.asset!.renderFingerprint!.replace('director-v3-', 'director-v2-');
    expect(fingerprint(document)).toMatch(/^director-v3-/);
    expect(directorRenderOutputs(document).current).toBeUndefined();
  });
  it('checks continuity against the requested episode without a document-level timeline', () => {
    const document = fixture();
    document.assets.push(
      { id: 'image', assetId: 'image', kind: 'image', localPath: 'I:/qa/image.png', createdAt: now },
      { id: 'voice', assetId: 'voice', kind: 'audio', localPath: 'I:/qa/voice.wav', createdAt: now },
    );
    const episode = document.episodes[0];
    for (const shot of episode.scenes.flatMap((scene) => scene.shots)) {
      shot.firstFrameAssetVersionId = 'image'; shot.voiceAssetVersionId = 'voice';
    }
    const scenes = buildDirectorRenderScenes(document, episode.id);
    document.activeEpisodeId = 'second';
    document.episodes[1].timeline.clips[0].startMs = 500;
    const result = { outputPath: 'I:/qa/director-renders/r1/exports/final.mp4', durationMs: episode.timeline.durationMs, width: 1920, height: 1080, sizeBytes: 128, hasAudio: true as const, hasVideo: true as const, hasNonBlackVideo: true as const };
    const check = (episodeId?: string) => evaluateDirectorQuality(document, scenes, result, fingerprint(document, episodeId), episodeId).find((item) => item.id === 'timeline-continuity');
    expect(document).not.toHaveProperty('timeline');
    expect(check(episode.id)?.status).toBe('passed');
    expect(check()?.status).toBe('failed');
    expect(check('deleted')?.status).toBe('failed');
    episode.timeline.clips[0].startMs = 300;
    expect(check(episode.id)?.status).toBe('failed');
  });
  it('holds the requested episode stable across navigation and unrelated assets/jobs', () => {
    const document = fixture();
    const before = fingerprint(document);
    const changed = structuredClone(document);
    changed.activeEpisodeId = 'second';
    changed.episodes[1].scenes[0].shots[0].prompt = 'Second episode edit';
    changed.assets.push({ id: 'other', assetId: 'other', kind: 'image', localPath: 'E:/other.png', createdAt: now });
    changed.providerJobs.push(completion(changed).job);
    expect(fingerprint(changed, document.activeEpisodeId)).toBe(before);
    expect(fingerprint(changed)).not.toBe(before);
  });

  it('ignores rendering status, final assets, source asset metadata and source array order', () => {
    const document = fixture();
    document.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId = 'image';
    document.assets.push({ id: 'image', assetId: 'image', kind: 'image', localPath: 'E:/image.png', createdAt: now });
    const before = fingerprint(document);
    const changed = structuredClone(document);
    changed.stage = 'completed'; changed.episodes[0].status = 'completed';
    changed.updatedAt = '2026-09-06T00:01:00.000Z';
    changed.assets[0] = { ...changed.assets[0], license: 'Updated', selected: false, provider: 'metadata' };
    changed.assets.push(completion(document).asset!);
    changed.assets.reverse();
    expect(fingerprint(changed)).toBe(before);
  });

  it.each(['ratio', 'image', 'caption', 'mix', 'voice'] as const)('invalidates owned %s edits', (field) => {
    const document = fixture();
    const before = fingerprint(document);
    if (field === 'ratio') document.ratio = '1:1';
    if (field === 'image') document.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId = 'new-image';
    if (field === 'caption') document.episodes[0].dialogueCues[0].text += ' Changed';
    if (field === 'mix') document.episodes[0].timeline.audioClips = [{ id: 'sound', assetVersionId: 'audio', shotId: document.episodes[0].scenes[0].shots[0].id, trackType: 'music', startMs: 0, gainDb: -12 }];
    if (field === 'voice') document.characters[0].voiceId = 'new-voice';
    expect(fingerprint(document)).not.toBe(before);
  });

  it('tracks fixed reference selection but ignores unselected history', () => {
    const document = fixture();
    const look = document.characters[0].looks[0];
    look.referenceAssetVersionIds = ['reference-a', 'reference-b'];
    document.assets.push(...['a', 'b'].map((suffix) => ({ id: `reference-${suffix}`, assetId: 'reference', kind: 'image' as const, localPath: `E:/${suffix}.png`, selected: suffix === 'a', pinned: suffix === 'a', createdAt: now })));
    const before = fingerprint(document);
    document.assets.push({ id: 'reference-c', assetId: 'reference', kind: 'image', localPath: 'E:/c.png', createdAt: now });
    look.referenceAssetVersionIds.push('reference-c');
    expect(fingerprint(document)).toBe(before);
    document.assets = document.assets.map((asset) => ({ ...asset, selected: asset.id === 'reference-b', pinned: asset.id === 'reference-b' }));
    expect(fingerprint(document)).not.toBe(before);
  });

  it('never resolves a deleted explicit episode to another episode', () => {
    const document = fixture();
    expect(fingerprint(document, 'deleted')).not.toBe(fingerprint(document));
    expect(() => buildDirectorRenderScenes(document, 'deleted')).toThrow(/EPISODE_MISSING/);
  });

  it('does not include unused assets in VOX render inputs', () => {
    const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox', title: 'VOX', now }), 'A short story.', now);
    const before = fingerprint(document);
    document.assets.push({ id: 'unused', assetId: 'unused', kind: 'image', localPath: 'E:/unused.png', createdAt: now });
    expect(fingerprint(document)).toBe(before);
  });
});

describe('director completion merge and CAS retry', () => {
  it('clears stale output selection on a current failed render without changing another episode', () => {
    let document = fixture();
    document = mergeDirectorRenderCompletion(document, completion(document, 'old-first')) as MotionComicPipelineData;
    document.activeEpisodeId = 'second';
    document = mergeDirectorRenderCompletion(document, completion(document, 'other-episode')) as MotionComicPipelineData;
    document.activeEpisodeId = document.episodes[0].id;
    document.episodes[0].dialogueCues[0].text += 'changed';
    const merged = mergeDirectorRenderCompletion(document, completion(document, 'failed-current', now, true));
    expect(merged.assets.find((asset) => asset.id === 'old-first')).toMatchObject({ selected: false, pinned: false, localPath: 'E:/fixture/old-first.mp4' });
    expect(merged.assets.find((asset) => asset.id === 'other-episode')).toMatchObject({ selected: true, pinned: true });
    expect(merged.stage).toBe('failed');
    expect(merged.providerJobs.at(-1)?.status).toBe('failed');
  });

  it('keeps a valid previous output when a retry with identical inputs fails', () => {
    const source = fixture();
    const saved = mergeDirectorRenderCompletion(source, completion(source, 'valid'));
    const merged = mergeDirectorRenderCompletion(saved, completion(saved, 'retry', '2026-09-06T00:03:00.000Z', true));
    expect(directorRenderOutputs(merged).current?.id).toBe('valid');
  });
  it('selects episode one after switching to episode two without changing navigation or edits', () => {
    const document = fixture();
    const finished = completion(document);
    document.activeEpisodeId = 'second';
    document.episodes[1].title = 'Edited second';
    const merged = mergeDirectorRenderCompletion(document, finished) as MotionComicPipelineData;
    expect(merged.activeEpisodeId).toBe('second');
    expect(merged.stage).toBe(document.stage);
    expect(merged.episodes[1].title).toBe('Edited second');
    expect(directorRenderOutputs(merged).current).toBeUndefined();
    expect(directorRenderOutputs(merged, merged.episodes[0].id).current?.id).toBe(finished.asset!.id);
    expect(parseMotionComicPipelineData(merged).assets.at(-1)?.episodeId).toBe(merged.episodes[0].id);
  });

  it('retains a stale completion without deselecting a newer current render', () => {
    const document = fixture();
    const old = completion(document, 'old');
    document.ratio = '1:1';
    const current = completion(document, 'new', '2026-09-06T00:02:00.000Z');
    const saved = mergeDirectorRenderCompletion(document, current);
    const merged = mergeDirectorRenderCompletion(saved, old);
    expect(directorRenderOutputs(merged).current?.id).toBe('new');
    expect(merged.assets.at(-1)).toMatchObject({ id: 'old', selected: false, pinned: false });
  });

  it('does not let an older request displace a newer request with the same inputs', () => {
    const document = fixture();
    const newer = completion(document, 'new', '2026-09-06T00:02:00.000Z');
    const merged = mergeDirectorRenderCompletion(mergeDirectorRenderCompletion(document, newer), completion(document, 'old'));
    expect(directorRenderOutputs(merged).current?.id).toBe('new');
  });

  it.each([false, true])('reloads and merges after a CAS conflict for failed=%s', async (failed) => {
    let live: DirectorRenderDocument = fixture();
    const finished = completion(live, 'render', now, failed);
    const save = vi.fn(async (next: DirectorRenderDocument) => {
      if (save.mock.calls.length === 1) {
        live = { ...live, title: 'Concurrent edit', updatedAt: '2026-09-06T00:01:00.000Z' };
        throw new Error('MOTION_COMIC_STALE_WRITE: conflicting save');
      }
      expect(next.updatedAt).toBe(live.updatedAt);
      live = next;
    });
    await persistDirectorRenderCompletion(finished, { load: async () => live, save });
    expect(save).toHaveBeenCalledTimes(2);
    expect(live.title).toBe('Concurrent edit');
    expect(live.providerJobs.at(-1)?.status).toBe(failed ? 'failed' : 'completed');
    if (!failed) expect(live.assets.at(-1)?.selected).toBe(false);
    expect(live.stage).not.toBe('failed');
    await persistDirectorRenderCompletion(finished, { load: async () => live, save });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not retry validation or disk errors', async () => {
    const document = fixture();
    const save = vi.fn(async () => { throw new Error('ENOSPC'); });
    await expect(persistDirectorRenderCompletion(completion(document), { load: async () => document, save })).rejects.toThrow('ENOSPC');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
