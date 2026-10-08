import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDirectorRenderScenes } from '@shared/director-render';
import { createMotionComicDraft, createMotionComicStarterProject } from '@shared/motion-comic';
import { buildMotionComicShotVideoRequest, motionComicVideoInputFingerprintSource, motionComicVideoInputHash } from '@shared/motion-comic-video';

const now = '2026-09-18T00:00:00.000Z';

function fixture() {
  const document = createMotionComicStarterProject(createMotionComicDraft({
    id: 'comic-video', title: '连续镜头', premise: '两个人在雨夜交换一封信。', now,
  }), '第一集', now);
  const episode = document.episodes[0];
  const shots = episode.scenes.flatMap((scene) => scene.shots);
  const previous = shots[0];
  const shot = shots[1];
  previous.continuity = { startState: '主角站在门口', endState: '主角右手举起湿信封', screenDirection: '面向画面左侧', actionBeats: ['举起信封'] };
  shot.continuity = { startState: '主角右手举着湿信封', endState: '主角把信封交给对方', screenDirection: '保持面向画面左侧', actionBeats: ['向前一步', '递出信封'] };
  shot.renderStrategy = 'remote-video';
  shot.firstFrameAssetVersionId = 'first-frame';
  document.assets.push({
    id: 'first-frame', assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: 'C:/managed/first.png', sha256: 'first-hash', createdAt: now,
  });
  return { document, episode, shot };
}

describe('motion comic remote video', () => {
  it('packs stable entities and previous-shot exit state into the remote request fingerprint', () => {
    const { document, shot } = fixture();
    const request = buildMotionComicShotVideoRequest(document, shot);
    expect(request).toMatchObject({ firstFramePath: 'C:/managed/first.png', durationSec: 7, ratio: '9:16', generateAudio: false });
    expect(request.prompt).toContain('承接上一镜出镜状态：主角右手举起湿信封');
    expect(request.prompt).toContain('本镜入镜状态：主角右手举着湿信封');
    expect(request.prompt).toContain('角色连续性');
    expect(request.prompt).toContain('动作顺序：1. 向前一步；2. 递出信封');

    const first = motionComicVideoInputFingerprintSource(document, shot, 'remote-a', 'model-a');
    const changed = motionComicVideoInputFingerprintSource(document, { ...shot, motionPrompt: `${shot.motionPrompt}，最后停住` }, 'remote-a', 'model-a');
    expect(changed.prompt).not.toBe(first.prompt);
    expect(motionComicVideoInputHash(document, shot, 'remote-a', 'model-a')).toBe(
      createHash('sha256').update(JSON.stringify(first)).digest('hex'),
    );
  });

  it('fingerprints every editable continuity input and the fixed reference version', () => {
    const { document, shot } = fixture();
    shot.propAssetIds = [document.props[0].id];
    const hash = (candidate: typeof document) => {
      const currentShot = candidate.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)).find((item) => item.id === shot.id)!;
      return motionComicVideoInputHash(candidate, currentShot, 'remote-a', 'model-a');
    };
    const baseline = hash(document);
    const variants = [
      (candidate: typeof document) => { candidate.characters.find((character) => character.looks.some((look) => look.id === shot.characterLookIds[0]))!.looks.find((look) => look.id === shot.characterLookIds[0])!.appearancePrompt += ', silver hair clip'; },
      (candidate: typeof document) => { candidate.sceneAssets.find((scene) => scene.id === shot.sceneAssetId)!.prompt += ', wet pavement'; },
      (candidate: typeof document) => { candidate.props.find((prop) => prop.id === shot.propAssetIds[0])!.prompt += ', sealed red wax'; },
      (candidate: typeof document) => { candidate.series.visualRules = [...candidate.series.visualRules, '雨滴始终向下']; },
      (candidate: typeof document) => {
        const scene = candidate.sceneAssets.find((item) => item.id === shot.sceneAssetId)!;
        scene.referenceAssetVersionIds.push('scene-reference');
        candidate.assets.push({ id: 'scene-reference', assetId: `reference-${scene.id}`, kind: 'image', localPath: 'C:/managed/scene-reference.png', selected: true, pinned: true, createdAt: now });
      },
    ];
    for (const mutate of variants) {
      const changed = structuredClone(document);
      mutate(changed);
      expect(hash(changed)).not.toBe(baseline);
    }
  });

  it('renders the selected completed remote video and rejects an incomplete job', () => {
    const { document, episode, shot } = fixture();
    shot.dialogueCueIds = [];
    episode.timeline.clips.find((clip) => clip.shotId === shot.id)!.subtitleCueIds = [];
    shot.videoJobId = 'video-job';
    shot.videoAssetVersionId = 'video-asset';
    shot.voiceAssetVersionId = 'voice-asset';
    const inputHash = motionComicVideoInputHash(document, shot, 'remote-a', 'model-a');
    document.providerJobs.push({
      id: 'video-job', workflowKind: 'motion-comic', nodeId: shot.id, episodeId: episode.id,
      providerId: 'remote-a', model: 'model-a', capability: 'image-to-video', status: 'completed',
      inputHash, idempotencyKey: 'idempotency', estimatedCost: 1, actualCost: 1, attempt: 1, createdAt: now, updatedAt: now,
    });
    document.assets.push({
      id: 'video-asset', assetId: `shot-video-${shot.id}`, kind: 'video', localPath: 'C:/managed/shot.mp4',
      prompt: buildMotionComicShotVideoRequest(document, shot).prompt,
      providerJobId: 'video-job', durationMs: shot.durationMs, episodeId: episode.id, createdAt: now, selected: true,
    });
    document.assets.push({ id: 'voice-asset', assetId: `shot-voice-${shot.id}`, kind: 'audio', localPath: 'C:/managed/voice.wav', durationMs: shot.durationMs, episodeId: episode.id, createdAt: now });

    expect(buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] })[0]).toMatchObject({
      id: shot.id,
      renderStrategy: 'living-poster',
      videoPath: 'C:/managed/shot.mp4',
      videoAssetVersionId: 'video-asset',
      videoJobId: 'video-job',
    });

    const stale = structuredClone(document);
    stale.series.visualRules = [...stale.series.visualRules, '所有雨滴改为向上漂浮'];
    expect(() => buildDirectorRenderScenes(stale, episode.id, { shotIds: [shot.id] })).toThrow(/远程视频输入已变化/u);

    document.providerJobs[0].status = 'running';
    expect(() => buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] })).toThrow(/远程视频任务尚未成功完成/u);
  });

  it('treats a planned action-only shot as an intentional silent mix', () => {
    const { document, episode, shot } = fixture();
    shot.renderStrategy = 'image-motion';
    shot.dialogueCueIds = [];
    episode.timeline.clips.find((clip) => clip.shotId === shot.id)!.subtitleCueIds = [];

    const scene = buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] })[0];
    expect(scene).toMatchObject({ id: shot.id, caption: '', audioPath: '', audioClips: [] });
  });
});
