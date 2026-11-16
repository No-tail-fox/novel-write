import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDirectorRenderScenes, directorNarrationAlignment, evaluateDirectorQuality, type DirectorRenderResult } from '@shared/director-render';
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
  shot.videoProduction = { version: 1, referenceMode: 'frames', audioMode: 'post-mix' };
  shot.firstFrameAssetVersionId = 'first-frame';
  document.assets.push({
    id: 'first-frame', assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: 'C:/managed/first.png', sha256: 'first-hash', createdAt: now,
  });
  return { document, episode, shot };
}

describe('motion comic remote video', () => {
  it.each([['9:16', '竖向'], ['16:9', '横向'], ['1:1', '正方形']] as const)('keeps the %s frame contract consistent with its prompt', (ratio, orientation) => {
    const { document, shot } = fixture(); document.ratio = ratio;
    const request = buildMotionComicShotVideoRequest(document, shot);
    expect(request.ratio).toBe(ratio); expect(request.prompt).toContain(`输出画幅 ${ratio}，整幅${orientation}画面`);
    if (ratio !== '16:9') expect(request.prompt).not.toContain('整幅横向画面');
  });
  it('packs stable entities and previous-shot exit state into the remote request fingerprint', () => {
    const { document, shot } = fixture();
    const request = buildMotionComicShotVideoRequest(document, shot);
    expect(request).toMatchObject({ firstFramePath: 'C:/managed/first.png', durationSec: 7, ratio: '9:16', generateAudio: false });
    expect(request.prompt).toContain('承接上一镜出镜状态：主角右手举起湿信封');
    expect(request.prompt).toContain('本镜入镜状态：主角右手举着湿信封');
    expect(request.prompt).toContain('角色连续性');
    expect(request.prompt).toContain('动作顺序：1. 向前一步；2. 递出信封');
    expect(request.prompt).toContain('主体人物从头到尾清晰完整地处于安全构图内');
    expect(request.prompt).toContain('平滑连续的物理摄像机运动');
    expect(request.prompt).toContain('不要冻结画面');

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

  it.each(['frames', 'references'] as const)('uses native video audio once while retaining authored ambience in %s mode', (referenceMode) => {
    const {document,episode,shot}=fixture();shot.videoProduction={version:1,referenceMode,audioMode:'native'};
    if (referenceMode === 'references') {
      delete shot.firstFrameAssetVersionId;
      const owners = [
        ...document.characters.flatMap(character => character.looks).filter(look => shot.characterLookIds.includes(look.id)),
        ...document.sceneAssets.filter(scene => scene.id === shot.sceneAssetId),
        ...document.props.filter(prop => shot.propAssetIds.includes(prop.id)),
      ];
      for (const owner of owners) {
        const id = `reference-${owner.id}`; owner.referenceAssetVersionIds = [id];
        document.assets.push({ id, assetId: id, kind: 'image', localPath: `C:/managed/${id}.png`, selected: true, pinned: true, createdAt: now });
      }
    }
    shot.videoJobId='native-job';shot.videoAssetVersionId='native-video';
    const hash=motionComicVideoInputHash(document,shot,'local','native-test');
    document.providerJobs.push({id:'native-job',workflowKind:'motion-comic',nodeId:shot.id,episodeId:episode.id,providerId:'local',model:'native-test',capability:'image-to-video',status:'completed',inputHash:hash,idempotencyKey:'native',estimatedCost:0,attempt:1,createdAt:now,updatedAt:now});
    document.assets.push({id:'native-video',assetId:`shot-video-${shot.id}`,kind:'video',localPath:'C:/native.mp4',providerJobId:'native-job',durationMs:shot.durationMs,createdAt:now,selected:true},{id:'ambience',assetId:'ambience',kind:'audio',localPath:'C:/ambient.wav',durationMs:shot.durationMs,createdAt:now});
    const start=episode.timeline.clips.find(c=>c.shotId===shot.id)!.startMs;
    episode.timeline.audioClips=[{id:'ambient',shotId:shot.id,assetVersionId:'ambience',trackType:'ambience',startMs:start,durationMs:shot.durationMs}];
    const scene=buildDirectorRenderScenes(document,episode.id,{shotIds:[shot.id]})[0];
    expect(scene.audioClips?.filter(c=>c.trackType==='dialogue')).toEqual([expect.objectContaining({path:'C:/native.mp4'})]);
    expect(scene.audioClips?.filter(c=>c.trackType==='ambience')).toHaveLength(1);
  });

  it.each(['native', 'audio-driven'] as const)('keeps %s dialogue timing manual and allows a native action shot without text', (audioMode) => {
    const { document, episode, shot } = fixture();
    shot.videoProduction = { version: 1, referenceMode: 'frames', audioMode };
    shot.durationMs = 9_000;
    const clip = episode.timeline.clips.find(item => item.shotId === shot.id)!;
    clip.durationMs = 9_000;
    const cue = episode.dialogueCues.find(item => shot.dialogueCueIds.includes(item.id))!;
    cue.startMs = clip.startMs + 3278; cue.endMs = clip.startMs + 5723;
    shot.videoJobId = 'native-job'; shot.videoAssetVersionId = 'native-video';
    // A previously generated TTS track must not be evidence for native output.
    shot.voiceAssetVersionId = 'unused-voice';
    document.assets.push({ id: 'unused-voice', assetId: 'unused', kind: 'audio', localPath: 'C:/unused.wav', durationMs: 20_000, createdAt: now });
    if (audioMode === 'audio-driven') {
      shot.videoProduction.referenceMode = 'references';
      shot.videoProduction.referenceAudioAssetVersionIds = ['unused-voice'];
      const owners = [...document.characters.flatMap(character => character.looks).filter(look => shot.characterLookIds.includes(look.id)), ...document.sceneAssets.filter(scene => scene.id === shot.sceneAssetId), ...document.props.filter(prop => shot.propAssetIds.includes(prop.id))];
      for (const owner of owners) {
        const id = `reference-${owner.id}`; owner.referenceAssetVersionIds = [id];
        document.assets.push({ id, assetId: id, kind: 'image', localPath: `C:/managed/${id}.png`, selected: true, pinned: true, createdAt: now });
      }
    }
    episode.timeline.audioClips = [{ id: 'unused-speech', shotId: shot.id, assetVersionId: 'unused-voice', trackType: 'dialogue', startMs: clip.startMs, durationMs: 9_000 }];
    document.providerJobs.push({ id: 'native-job', workflowKind: 'motion-comic', nodeId: shot.id, episodeId: episode.id, providerId: 'local', model: 'native-test', capability: 'image-to-video', status: 'completed', inputHash: motionComicVideoInputHash(document, shot, 'local', 'native-test'), idempotencyKey: 'native', estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now });
    document.assets.push({ id: 'native-video', assetId: `shot-video-${shot.id}`, kind: 'video', localPath: 'C:/native.mp4', providerJobId: 'native-job', durationMs: 9_420, createdAt: now, selected: true });
    const scenes = buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] });
    const evidence = directorNarrationAlignment(document, scenes, episode.id);
    expect(evidence).toMatchObject({ status: 'pending', samples: [{ plannedDurationMs: 2445, status: 'unavailable', audioAssetVersionIds: ['native-video'] }] });
    expect(evidence.samples[0].actualDurationMs).toBeUndefined();
    const result = { outputPath: 'C:/director-renders/test/export.mp4', width: 1080, height: 1920, durationMs: 9_000, sizeBytes: 100, hasVideo: true, hasAudio: true, hasNonBlackVideo: true } as DirectorRenderResult;
    expect(evaluateDirectorQuality(document, scenes, result, 'test', episode.id).find(check => check.id === 'narration-alignment')).toMatchObject({ severity: 'manual', status: 'pending', detail: expect.stringContaining('语音时间戳') });

    shot.dialogueCueIds = []; episode.timeline.audioClips = [];
    document.providerJobs.find(job => job.id === 'native-job')!.inputHash = motionComicVideoInputHash(document, shot, 'local', 'native-test');
    const actionScenes = buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] });
    expect(actionScenes[0].audioClips).toEqual([expect.objectContaining({ trackType: 'ambience', path: 'C:/native.mp4' })]);
    expect(directorNarrationAlignment(document, actionScenes, episode.id).samples[0].status).toBe('not-applicable');
    expect(evaluateDirectorQuality(document, actionScenes, result, 'test', episode.id).find(check => check.id === 'dialogue-coverage')).toMatchObject({ status: 'passed' });

    shot.dialogueCueIds = [cue.id]; shot.videoProduction.audioMode = 'post-mix';
    document.providerJobs.find(job => job.id === 'native-job')!.inputHash = motionComicVideoInputHash(document, shot, 'local', 'native-test');
    const postMixScenes = buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] });
    expect(directorNarrationAlignment(document, postMixScenes, episode.id)).toMatchObject({ status: 'failed', samples: [{ actualDurationMs: 20_000, status: 'mismatch', audioAssetVersionIds: ['unused-voice'] }] });
    expect(evaluateDirectorQuality(document, postMixScenes, result, 'test', episode.id).find(check => check.id === 'narration-alignment')).toMatchObject({ severity: 'blocking', status: 'failed' });
  });

  it('ignores stale reference-audio selections outside audio-driven mode', () => {
    const {document,shot}=fixture();
    shot.videoProduction={version:1,referenceMode:'frames',audioMode:'native',referenceAudioAssetVersionIds:['deleted-audio']};

    const fingerprint=motionComicVideoInputFingerprintSource(document,shot,'remote-a','model-a');
    expect(fingerprint.production?.referenceAudioAssetVersionIds).toEqual([]);
    expect(fingerprint.referenceAudio).toEqual([]);
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

  it('blocks an export that would cut off a measured dialogue recording', () => {
    const { document, episode, shot } = fixture();
    shot.renderStrategy = 'image-motion';
    const cues = episode.dialogueCues.filter(cue => cue.shotId === shot.id);
    episode.timeline.audioClips = cues.map(cue => {
      const id = `voice-${cue.id}`;
      cue.voiceAssetVersionId = id;
      document.assets.push({ id, assetId: id, kind: 'audio', localPath: 'C:/managed/voice.wav', durationMs: cue.endMs - cue.startMs + 500, createdAt: now });
      return { id: `dialogue-clip-${cue.id}`, assetVersionId: id, shotId: shot.id, trackType: 'dialogue' as const, startMs: cue.startMs, durationMs: cue.endMs - cue.startMs, sourceStartMs: 0, gainDb: 0 };
    });
    expect(cues.length).toBeGreaterThan(0);
    expect(() => buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] })).toThrow(/被时间槽截断/u);
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
