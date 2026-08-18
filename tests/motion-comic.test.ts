import { describe, expect, it } from 'vitest';
import {
  appendMotionComicEpisode,
  appendMotionComicScene,
  appendMotionComicShot,
  createMotionComicDraft,
  createMotionComicStarterProject,
  motionComicSaveInputSchema,
  parseMotionComicPipelineData,
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
});
