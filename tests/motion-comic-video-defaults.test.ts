import { describe, expect, it } from 'vitest';
import { appendMotionComicScene, appendMotionComicShot, createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { buildMotionComicShotVideoRequest } from '../src/shared/motion-comic-video';

function fixture() {
  return createMotionComicStarterProject(createMotionComicDraft({ id: 'video-defaults', title: 'Defaults', premise: 'A letter arrives.' }));
}
const defaultProduction = { version: 1, referenceMode: 'references', audioMode: 'post-mix' };

describe('motion comic creation video defaults', () => {
  it('creates starter and added-scene shots for direct reference video', () => {
    const document = fixture();
    const next = appendMotionComicScene(document, document.activeEpisodeId);
    for (const shot of next.episodes[0].scenes.flatMap(scene => scene.shots)) {
      expect(shot.renderStrategy).toBe('remote-video');
      expect(shot.videoProduction).toEqual(defaultProduction);
      expect(shot.firstFrameAssetVersionId).toBeUndefined();
    }
  });

  it('defaults a new shot from an unconfigured legacy template without migrating existing shots or frames', () => {
    const document = fixture();
    const episode = document.episodes[0], scene = episode.scenes[0], template = scene.shots[0];
    delete template.videoProduction;
    template.renderStrategy = 'image-motion';
    template.firstFrameAssetVersionId = 'first';
    template.lastFrameAssetVersionId = 'last';
    document.assets.push(...['first', 'last'].map(id => ({ id, assetId: `shot-keyframe-${id}`, kind: 'image' as const, localPath: `C:/${id}.png`, createdAt: document.createdAt })));
    const original = structuredClone(template);
    const next = appendMotionComicShot(document, episode.id, scene.id);
    expect(next.episodes[0].scenes[0].shots[0]).toEqual(original);
    expect(next.episodes[0].scenes[0].shots.at(-1)).toMatchObject({ renderStrategy: 'remote-video', videoProduction: defaultProduction });
    expect(next.episodes[0].scenes[0].shots.at(-1)?.firstFrameAssetVersionId).toBeUndefined();
    expect(next.episodes[0].scenes[0].shots.at(-1)?.lastFrameAssetVersionId).toBeUndefined();
    expect(parseMotionComicPipelineData(document).episodes[0].scenes[0].shots[0]).toEqual(original);
  });

  it('preserves explicit frames mode when adding a shot and still requires a first frame', () => {
    const document = fixture();
    const episode = document.episodes[0], scene = episode.scenes[0];
    scene.shots[0].videoProduction = { version: 1, referenceMode: 'frames', audioMode: 'native' };
    const next = appendMotionComicShot(document, episode.id, scene.id);
    const shot = next.episodes[0].scenes[0].shots.at(-1)!;
    expect(shot.videoProduction).toEqual({ version: 1, referenceMode: 'frames', audioMode: 'native' });
    expect(() => buildMotionComicShotVideoRequest(next, shot)).toThrow('FIRST_FRAME_REQUIRED');
  });
});
