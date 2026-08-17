import { describe, expect, it } from 'vitest';
import {
  createMotionComicDraft,
  createMotionComicStarterProject,
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
});
