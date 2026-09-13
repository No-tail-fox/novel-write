import { describe, expect, it } from 'vitest';
import {
  appendMotionComicEpisode,
  appendMotionComicScene,
  appendMotionComicShot,
  createMotionComicDraft,
  createMotionComicStarterProject,
  motionComicSaveInputSchema,
  parseMotionComicPipelineData,
  removeMotionComicShot,
  reorderMotionComicShot,
  updateMotionComicShotDuration,
  validateMotionComicPipeline,
} from '../src/shared/motion-comic';

describe('motion comic domain', () => {
  it('creates a series-owned starter project without provider jobs', () => {
    const draft = createMotionComicDraft({
      id: 'comic-1',
      title: '雨夜来信',
      premise: '女孩收到一封来自十年后的信。',
      now: '2026-08-17T00:00:00.000Z',
    });
    const project = createMotionComicStarterProject(draft, '第一集：雨夜来信');

    expect(project.series.id).toBe('series-comic-1');
    expect(project.episodes).toHaveLength(1);
    expect(project.episodes[0].scenes.length).toBeGreaterThan(1);
    expect(project.episodes[0].scenes.flatMap((scene) => scene.shots).length).toBeGreaterThan(2);
    expect(project.providerJobs).toEqual([]);
    expect(project.episodes[0].scenes[0].shots[0].characterLookIds[0]).toBe(project.characters[0].looks[0].id);
  });

  it('rejects dangling look, scene, prop and dialogue references', () => {
    const project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-2', title: '失重车站', premise: '列车驶入一座失重车站。', now: '2026-08-17T00:00:00.000Z',
    }), '第一集');
    const shot = project.episodes[0].scenes[0].shots[0];
    shot.characterLookIds = ['missing-look'];
    shot.sceneAssetId = 'missing-scene';
    shot.propAssetIds = ['missing-prop'];
    shot.dialogueCueIds = ['missing-cue'];

    const issues = validateMotionComicPipeline(project);
    expect(issues.some((issue) => issue.path.endsWith('characterLookIds'))).toBe(true);
    expect(issues.some((issue) => issue.path.endsWith('sceneAssetId'))).toBe(true);
    expect(issues.some((issue) => issue.path.endsWith('propAssetIds'))).toBe(true);
    expect(issues.some((issue) => issue.path.endsWith('dialogueCueIds'))).toBe(true);
    expect(() => parseMotionComicPipelineData(project)).toThrow(/MOTION_COMIC_INVALID_DATA/u);
  });

  it('keeps dramatic scenes, shots and dialogue segmentation independent', () => {
    const project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-3', title: '钟楼', premise: '守钟人发现城市每天少一分钟。', now: '2026-08-17T00:00:00.000Z',
    }), '消失的一分钟');
    const episode = project.episodes[0];
    const shotCount = episode.scenes.flatMap((scene) => scene.shots).length;
    expect(episode.scenes.length).not.toBe(shotCount);
    expect(episode.dialogueCues.length).not.toBe(episode.scenes.length);
    expect(episode.timeline.clips).toHaveLength(shotCount);
  });

  it('supports persisted episode, scene, and shot lifecycle without breaking references', () => {
    let project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-lifecycle', title: '回声档案', premise: '记者发现一卷会预告明天的录音。', now: '2026-08-18T00:00:00.000Z',
    }), '第一集');
    const concurrencyToken = project.updatedAt;

    project = appendMotionComicEpisode(project, { id: 'episode-comic-lifecycle-2', title: '第二集：录音来源' });
    expect(project.episodes).toHaveLength(2);
    expect(project.activeEpisodeId).toBe('episode-comic-lifecycle-2');
    project = appendMotionComicScene(project, project.activeEpisodeId, { id: 'episode-comic-lifecycle-2-scene-extra', title: '地下档案室' });
    const activeEpisode = project.episodes.find((episode) => episode.id === project.activeEpisodeId)!;
    expect(activeEpisode.scenes.at(-1)?.title).toBe('地下档案室');
    project = appendMotionComicShot(project, project.activeEpisodeId, activeEpisode.scenes.at(-1)!.id, { id: 'episode-comic-lifecycle-2-scene-extra-shot-2', title: '磁带开始倒转' });
    const completedEpisode = project.episodes.find((episode) => episode.id === project.activeEpisodeId)!;
    expect(completedEpisode.scenes.at(-1)?.shots.at(-1)?.title).toBe('磁带开始倒转');
    expect(completedEpisode.timeline.clips).toHaveLength(completedEpisode.scenes.flatMap((scene) => scene.shots).length);
    expect(validateMotionComicPipeline(project)).toEqual([]);
    expect(parseMotionComicPipelineData(project)).toEqual(project);
    expect(project.updatedAt).toBe(concurrencyToken);
  });

  it('keeps the shot tree, dialogue cues and timeline in one canonical order', () => {
    let project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-timeline-order', title: '时间线校验', premise: '镜头顺序必须和成片一致。', now: '2026-08-18T00:00:00.000Z',
    }), '第一集');
    const episodeId = project.activeEpisodeId;
    let episode = project.episodes.find((candidate) => candidate.id === episodeId)!;
    const firstSceneId = episode.scenes[0].id;
    const firstShotId = episode.scenes[0].shots[0].id;
    const secondSceneId = episode.scenes[1].id;
    const originalDuration = episode.timeline.durationMs;

    project = appendMotionComicShot(project, episodeId, firstSceneId, { id: 'inserted-first-scene-shot' });
    episode = project.episodes.find((candidate) => candidate.id === episodeId)!;
    const inserted = episode.scenes[0].shots.find((shot) => shot.id === 'inserted-first-scene-shot')!;
    const insertedClip = episode.timeline.clips.find((clip) => clip.shotId === inserted.id)!;
    const firstSceneOriginalDuration = episode.scenes[0].shots.filter((shot) => shot.id !== inserted.id).reduce((total, shot) => total + shot.durationMs, 0);
    const followingSceneFirstShotId = episode.scenes[1].shots[0].id;
    const followingClip = episode.timeline.clips.find((clip) => clip.shotId === followingSceneFirstShotId)!;
    expect(insertedClip.startMs).toBe(firstSceneOriginalDuration);
    expect(followingClip.startMs).toBe(firstSceneOriginalDuration + inserted.durationMs);
    expect(episode.timeline.durationMs).toBe(originalDuration + inserted.durationMs);
    const insertedCue = episode.dialogueCues.find((cue) => cue.shotId === inserted.id)!;
    expect(insertedCue.startMs).toBe(insertedClip.startMs);
    expect(insertedCue.endMs).toBe(insertedClip.startMs + inserted.durationMs);

    project.assets.push({ id: 'timeline-audio', assetId: 'timeline-audio', kind: 'audio', localPath: 'C:/managed/timeline.wav', createdAt: project.createdAt });
    episode.timeline.audioClips = [{ id: 'inserted-audio', assetVersionId: 'timeline-audio', shotId: inserted.id, trackType: 'sfx', startMs: insertedClip.startMs + 100, durationMs: inserted.durationMs - 100 }];

    project = updateMotionComicShotDuration(project, episodeId, inserted.id, 3_000);
    episode = project.episodes.find((candidate) => candidate.id === episodeId)!;
    const resizedClip = episode.timeline.clips.find((clip) => clip.shotId === inserted.id)!;
    const resizedFollowing = episode.timeline.clips.find((clip) => clip.shotId === followingSceneFirstShotId)!;
    expect(resizedClip.durationMs).toBe(3_000);
    expect(resizedFollowing.startMs).toBe(firstSceneOriginalDuration + 3_000);
    expect(episode.timeline.durationMs).toBe(originalDuration + 3_000);
    expect(episode.timeline.audioClips?.[0].startMs).toBe(resizedClip.startMs + 100);
    expect(episode.timeline.audioClips?.[0].durationMs).toBe(2_900);

    project = reorderMotionComicShot(project, episodeId, firstShotId, secondSceneId, 0);
    episode = project.episodes.find((candidate) => candidate.id === episodeId)!;
    const orderedIds = episode.scenes.flatMap((scene) => scene.shots).map((shot) => shot.id);
    expect(orderedIds.indexOf(firstShotId)).toBeGreaterThan(orderedIds.indexOf(inserted.id));
    const orderedStarts = episode.timeline.clips.map((clip) => clip.startMs);
    expect(orderedStarts).toEqual([...orderedStarts].sort((a, b) => a - b));

    project = removeMotionComicShot(project, episodeId, inserted.id);
    episode = project.episodes.find((candidate) => candidate.id === episodeId)!;
    expect(episode.scenes.flatMap((scene) => scene.shots).some((shot) => shot.id === inserted.id)).toBe(false);
    expect(episode.timeline.clips.some((clip) => clip.shotId === inserted.id)).toBe(false);
    expect(episode.dialogueCues.some((cue) => cue.shotId === inserted.id)).toBe(false);
    expect(validateMotionComicPipeline(project)).toEqual([]);
  });

  it('accepts persisted Director Desk settings on motion-comic shots', () => {
    const project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-director-settings', title: '雨夜来信', premise: '一封信改变了女孩的决定。', now: '2026-08-18T00:00:00.000Z',
    }), '第一集');
    const shot = project.episodes[0].scenes[0].shots[0];
    shot.layoutTemplate = '漫画分格 · 角色优先';
    shot.motionPreset = '轻微视差';
    shot.subtitleStyle = '简体中文 · 白色描边';
    shot.seed = '24681357';
    shot.seedLocked = true;

    expect(motionComicSaveInputSchema.safeParse({
      id: project.id,
      expectedUpdatedAt: project.updatedAt,
      document: project,
    }).success).toBe(true);
  });

  it('accepts image references owned by their look, scene, and prop targets', () => {
    const project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-valid-references', title: '雾中信号', premise: '三类固定素材共同指向一条线索。', now: '2026-08-18T00:00:00.000Z',
    }), '第一集');
    const look = project.characters[0].looks[0];
    const scene = project.sceneAssets[0];
    const prop = project.props[0];
    project.providerJobs.push({
      id: 'reference-job-look',
      workflowKind: 'motion-comic',
      nodeId: look.id,
      providerId: 'reference-provider',
      model: 'reference-model',
      capability: 'reference-image',
      status: 'completed',
      inputHash: 'reference-input',
      idempotencyKey: `${project.id}:${look.id}:reference-input`,
      estimatedCost: 0,
      attempt: 1,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
    project.assets.push(
      {
        id: 'reference-version-look',
        assetId: `motion-comic-reference-look-${look.id}`,
        kind: 'image',
        localPath: 'C:/managed/look.png',
        providerJobId: 'reference-job-look',
        createdAt: project.createdAt,
      },
      {
        id: 'reference-version-scene',
        assetId: `motion-comic-reference-scene-${scene.id}`,
        kind: 'image',
        localPath: 'C:/managed/scene.png',
        createdAt: project.createdAt,
      },
      {
        id: 'reference-version-prop',
        assetId: `motion-comic-reference-prop-${prop.id}`,
        kind: 'image',
        localPath: 'C:/managed/prop.png',
        createdAt: project.createdAt,
      },
    );
    look.referenceAssetVersionIds = ['reference-version-look'];
    scene.referenceAssetVersionIds = ['reference-version-scene'];
    prop.referenceAssetVersionIds = ['reference-version-prop'];

    expect(validateMotionComicPipeline(project)).toEqual([]);
    expect(parseMotionComicPipelineData(project)).toEqual(project);
  });

  it('rejects non-image, dangling-job, shot-keyframe, and cross-target series references', () => {
    const project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-invalid-references', title: '错位档案', premise: '错误引用必须在保存前被发现。', now: '2026-08-18T00:00:00.000Z',
    }), '第一集');
    const look = project.characters[0].looks[0];
    const scene = project.sceneAssets[0];
    const prop = project.props[0];
    const shot = project.episodes[0].scenes[0].shots[0];
    project.assets.push(
      {
        id: 'reference-audio',
        assetId: `motion-comic-reference-look-${look.id}`,
        kind: 'audio',
        localPath: 'C:/managed/not-an-image.wav',
        createdAt: project.createdAt,
      },
      {
        id: 'reference-dangling-job',
        assetId: `motion-comic-reference-scene-${scene.id}`,
        kind: 'image',
        localPath: 'C:/managed/scene.png',
        providerJobId: 'missing-reference-job',
        createdAt: project.createdAt,
      },
      {
        id: 'reference-shot-keyframe',
        assetId: `shot-keyframe-${shot.id}`,
        kind: 'image',
        localPath: 'C:/managed/keyframe.png',
        createdAt: project.createdAt,
      },
      {
        id: 'reference-wrong-target',
        assetId: `motion-comic-reference-prop-${prop.id}`,
        kind: 'image',
        localPath: 'C:/managed/wrong-target.png',
        createdAt: project.createdAt,
      },
    );
    look.referenceAssetVersionIds = ['reference-audio', 'reference-shot-keyframe', 'reference-wrong-target'];
    scene.referenceAssetVersionIds = ['reference-dangling-job'];

    const issues = validateMotionComicPipeline(project);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining('referenceAssetVersionIds'), message: expect.stringMatching(/image assets/u) }),
      expect.objectContaining({ path: expect.stringContaining('referenceAssetVersionIds'), message: expect.stringMatching(/provider job .* does not exist/u) }),
      expect.objectContaining({ path: expect.stringContaining('referenceAssetVersionIds'), message: expect.stringMatching(/shot keyframe/u) }),
      expect.objectContaining({ path: expect.stringContaining('referenceAssetVersionIds'), message: expect.stringMatching(/different look target/u) }),
    ]));
    expect(() => parseMotionComicPipelineData(project)).toThrow(/MOTION_COMIC_INVALID_DATA/u);
  });

  it('prevents a series reference version from becoming a shot frame', () => {
    const project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-reference-frame', title: '参考不是成片', premise: '系列参考图不能直接冒充镜头画面。', now: '2026-08-18T00:00:00.000Z',
    }), '第一集');
    const look = project.characters[0].looks[0];
    const shot = project.episodes[0].scenes[0].shots[0];
    project.assets.push({
      id: 'reference-frame-version',
      assetId: `motion-comic-reference-look-${look.id}`,
      kind: 'image',
      localPath: 'C:/managed/look.png',
      createdAt: project.createdAt,
    });
    look.referenceAssetVersionIds = ['reference-frame-version'];
    shot.firstFrameAssetVersionId = 'reference-frame-version';

    const issues = validateMotionComicPipeline(project);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining('referenceAssetVersionIds'), message: expect.stringMatching(/shot keyframe/u) }),
      expect.objectContaining({ path: expect.stringContaining('firstFrameAssetVersionId'), message: expect.stringMatching(/series consistency reference/u) }),
    ]));
  });

  it('keeps legacy image reference asset ids compatible when their target cannot be inferred', () => {
    const project = createMotionComicStarterProject(createMotionComicDraft({
      id: 'comic-legacy-reference', title: '旧版参考', premise: '旧项目仍能读取未命名空间化的图片引用。', now: '2026-08-18T00:00:00.000Z',
    }), '第一集');
    const look = project.characters[0].looks[0];
    project.assets.push({
      id: 'legacy-reference-version',
      assetId: 'legacy-character-portrait',
      kind: 'image',
      localPath: 'C:/legacy/portrait.png',
      createdAt: project.createdAt,
    });
    look.referenceAssetVersionIds = ['legacy-reference-version'];

    expect(validateMotionComicPipeline(project)).toEqual([]);
    expect(parseMotionComicPipelineData(project)).toEqual(project);
  });
});
