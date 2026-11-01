import { describe, expect, it } from 'vitest';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { prepareMotionComicDialogueForRender, fitMotionComicDialogueTiming, motionComicDialogueInput, motionComicDialogueInputMatches, updateMotionComicCharacterVoice } from '../src/shared/motion-comic-dialogue';
import { applyMotionComicVoiceRecord } from '../src/features/director-desk/director-generation';
import { updateDirectorSubtitleCue } from '../src/shared/director-subtitles';
import type { VoiceLabRecord } from '../src/shared/types';

const defaults = { provider: 'minimax' as const, voiceId: 'narrator', speed: 1 };
function fixture() {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'comic-dialogue', title: '对白', premise: '雨夜', now: '2026-09-06T00:00:00.000Z' }), '第一集', '2026-09-06T00:00:00.000Z');
  const shot = document.episodes[0].scenes[0].shots[0];
  const cues = document.episodes[0].dialogueCues.filter((cue) => cue.shotId === shot.id);
  return { document, shot, cues };
}
function record(input: ReturnType<typeof motionComicDialogueInput>, id = input.cueId): VoiceLabRecord {
  return { id, text: input.text, provider: input.provider, voiceId: input.voiceId, voiceLabel: input.voiceId, speed: input.speed, audioPath: `I:/fixture/${id}.wav`, status: 'generated', errorMessage: '', createdAt: '2026-09-06T00:00:00.000Z', finishedAt: '2026-09-06T00:00:01.000Z' };
}

describe('independent motion comic dialogue', () => {
  it('resolves character voices independently and persists their assignments', () => {
    let { document, shot, cues } = fixture();
    document = updateMotionComicCharacterVoice(document, cues[0].characterId!, { voiceProvider: 'minimax', voiceId: 'hero', voiceSpeed: 0.8 });
    document = updateMotionComicCharacterVoice(document, cues[1].characterId!, { voiceProvider: 'minimax', voiceId: 'partner', voiceSpeed: 1.2 });
    expect(motionComicDialogueInput(document, shot.id, cues[0].id, defaults)).toMatchObject({ voiceId: 'hero', speed: 0.8 });
    expect(motionComicDialogueInput(document, shot.id, cues[1].id, defaults)).toMatchObject({ voiceId: 'partner', speed: 1.2 });
    expect(parseMotionComicPipelineData(JSON.stringify(document)).characters).toEqual(document.characters);
    expect(() => motionComicDialogueInput(document, shot.id, cues[0].id, { ...defaults, provider: 'volcengine' })).toThrow('另一配音服务');
  });

  it('keeps each selected asset and global clip, without passing off one cue as aggregate speech', () => {
    let { document, shot, cues } = fixture();
    for (const cue of cues) {
      const input = motionComicDialogueInput(document, shot.id, cue.id, defaults);
      document = applyMotionComicVoiceRecord(document, shot.id, record(input), 'test-model', cue.id, input);
    }
    expect(document.episodes[0].scenes[0].shots[0].voiceAssetVersionId).toBeUndefined();
    expect(document.assets.filter((asset) => asset.kind === 'audio' && asset.selected)).toHaveLength(cues.length);
    expect(document.episodes[0].timeline.audioClips).toEqual(cues.map((cue) => ({ id: `dialogue-clip-${cue.id}`, assetVersionId: `voice-asset-${cue.id}`, shotId: shot.id, trackType: 'dialogue', startMs: cue.startMs, sourceStartMs: 0, durationMs: cue.endMs - cue.startMs, gainDb: 0 })));
    expect(parseMotionComicPipelineData(JSON.stringify(document))).toEqual(document);
  });

  it('retains stale result history but never binds it after text or speaker changes', () => {
    const { document, shot, cues } = fixture();
    const input = motionComicDialogueInput(document, shot.id, cues[0].id, defaults);
    const edited = updateDirectorSubtitleCue(document, shot.id, cues[0].id, { text: '新的对白' });
    expect(motionComicDialogueInputMatches(edited, input)).toBe(false);
    const next = applyMotionComicVoiceRecord(edited, shot.id, record(input), 'test-model', cues[0].id, input);
    expect(next.assets.at(-1)).toMatchObject({ kind: 'audio', selected: false });
    expect(next.providerJobs.at(-1)?.status).toBe('completed');
    expect(next.episodes[0].dialogueCues.find((cue) => cue.id === cues[0].id)?.voiceAssetVersionId).toBeUndefined();
    expect(next.episodes[0].timeline.audioClips).toBeUndefined();
    expect(motionComicDialogueInputMatches(updateDirectorSubtitleCue(document, shot.id, cues[0].id, { characterId: '' }), input)).toBe(false);
  });

  it('invalidates only the changed dialogue and updates clip placement when timing changes', () => {
    let { document, shot, cues } = fixture();
    for (const cue of cues) document = applyMotionComicVoiceRecord(document, shot.id, record(motionComicDialogueInput(document, shot.id, cue.id, defaults)), 'test-model', cue.id);
    const timed = updateDirectorSubtitleCue(document, shot.id, cues[0].id, { startMs: cues[0].startMs + 100 });
    expect(timed.episodes[0].timeline.audioClips?.[0]).toMatchObject({ startMs: cues[0].startMs + 100, durationMs: cues[0].endMs - cues[0].startMs - 100 });
    const edited = updateDirectorSubtitleCue(document, shot.id, cues[0].id, { text: '变更' });
    expect(edited.episodes[0].timeline.audioClips?.map((clip) => clip.id)).toEqual([`dialogue-clip-${cues[1].id}`]);
    expect(edited.assets).toEqual(document.assets);
    const voiced = updateMotionComicCharacterVoice(document, cues[0].characterId!, { voiceProvider: 'minimax', voiceId: 'changed' });
    expect(voiced.episodes[0].timeline.audioClips?.map((clip) => clip.id)).toEqual([`dialogue-clip-${cues[1].id}`]);
    expect(parseMotionComicPipelineData(JSON.stringify(voiced))).toEqual(voiced);
  });

  it('does not copy old recordings into a newly appended episode', () => {
    const { document, shot, cues } = fixture();
    const input = motionComicDialogueInput(document, shot.id, cues[0].id, defaults);
    const voiced = applyMotionComicVoiceRecord(document, shot.id, record(input), 'test-model', cues[0].id);
    const next = appendMotionComicEpisode(voiced);
    expect(next.episodes[1].dialogueCues.every((cue) => !cue.voiceAssetVersionId && !cue.audioAssetVersionId && !cue.tokens)).toBe(true);
    expect(parseMotionComicPipelineData(JSON.stringify(next))).toEqual(next);
  });
  it('fits real recording lengths and shifts the next cue without cutting speech or video', () => {
    const { document, shot, cues } = fixture();
    const owner = document.episodes[0].timeline.clips.find(clip => clip.shotId === shot.id)!;
    shot.durationMs = 7000; owner.durationMs = 7000;
    document.episodes[0].timeline.durationMs = Math.max(7000, document.episodes[0].timeline.durationMs);
    Object.assign(cues[0], { startMs: 629, endMs: 3518 });
    Object.assign(cues[1], { startMs: 4148, endMs: 6371 });
    let next = applyMotionComicVoiceRecord(document, shot.id, record(motionComicDialogueInput(document, shot.id, cues[1].id, defaults)), 'm', cues[1].id, undefined, 2040);
    next = applyMotionComicVoiceRecord(next, shot.id, record(motionComicDialogueInput(next, shot.id, cues[0].id, defaults)), 'm', cues[0].id, undefined, 3624);
    expect(next.episodes[0].dialogueCues.find(cue => cue.id === cues[0].id)).toMatchObject({ startMs: 629, endMs: 4253 });
    expect(next.episodes[0].dialogueCues.find(cue => cue.id === cues[1].id)).toMatchObject({ startMs: 4373, endMs: 6413 });
    expect(next.episodes[0].timeline.audioClips?.find(clip => clip.id === `dialogue-clip-${cues[0].id}`)).toMatchObject({ durationMs: 3624, sourceDurationMs: 3624 });
    expect(next.episodes[0].scenes[0].shots[0].durationMs).toBe(7000);
    expect(fitMotionComicDialogueTiming(next, shot.id)).toEqual(next);
  });

  it('keeps the original timing when complete recordings cannot fit the shot', () => {
    const { document, shot, cues } = fixture();
    for (const cue of cues) {
      cue.voiceAssetVersionId = `long-${cue.id}`;
      document.assets.push({ id: cue.voiceAssetVersionId, assetId: cue.voiceAssetVersionId, kind: 'audio', localPath: 'I:/fixture/long.wav', durationMs: shot.durationMs, createdAt: document.createdAt });
    }
    const before = structuredClone(document);
    expect(fitMotionComicDialogueTiming(document, shot.id)).toEqual(before);
  });

  it('moves complete recordings earlier when the last sentence reaches the shot boundary', () => {
    const { document, shot, cues } = fixture();
    const owner = document.episodes[0].timeline.clips.find(clip => clip.shotId === shot.id)!;
    shot.durationMs = 7000; owner.durationMs = 7000;
    cues[0].startMs = owner.startMs + 4000;
    cues[0].endMs = owner.startMs + 4500;
    cues[1].startMs = owner.startMs + 6000;
    cues[1].endMs = owner.startMs + 6500;
    for (const cue of cues) {
      cue.voiceAssetVersionId = `voice-${cue.id}`;
      document.assets.push({ id: cue.voiceAssetVersionId, assetId: cue.voiceAssetVersionId, kind: 'audio', localPath: 'I:/fixture/voice.wav', durationMs: 2000, createdAt: document.createdAt });
    }
    const next = fitMotionComicDialogueTiming(document, shot.id);
    const fitted = next.episodes[0].dialogueCues.filter(cue => cue.shotId === shot.id);
    expect(fitted.map(cue => [cue.startMs - owner.startMs, cue.endMs - owner.startMs])).toEqual([[2880, 4880], [5000, 7000]]);
    expect(next.episodes[0].scenes[0].shots[0].durationMs).toBe(7000);
  });
});


describe('motion comic export audio preparation', () => {
  function voicedFixture() {
    let { document, shot, cues } = fixture();
    for (const cue of cues) document = applyMotionComicVoiceRecord(document, shot.id, record(motionComicDialogueInput(document, shot.id, cue.id, defaults)), 'm', cue.id);
    return { document, shot: document.episodes[0].scenes.flatMap(scene => scene.shots).find(item => item.id === shot.id)!, cues };
  }

  it('measures legacy recordings and persists complete speech timing without changing the content or video', async () => {
    const { document, shot, cues } = voicedFixture();
    const owner = document.episodes[0].timeline.clips.find(clip => clip.shotId === shot.id)!;
    shot.durationMs = 7000; owner.durationMs = 7000;
    const episode = document.episodes[0];
    Object.assign(episode.dialogueCues.find(cue => cue.id === cues[0].id)!, { startMs: owner.startMs + 629, endMs: owner.startMs + 3518 });
    Object.assign(episode.dialogueCues.find(cue => cue.id === cues[1].id)!, { startMs: owner.startMs + 4148, endMs: owner.startMs + 6371 });
    const before = structuredClone(document);
    const prepared = await prepareMotionComicDialogueForRender(document, async path => path.includes(cues[0].id) ? 3624 : 2040);
    expect(document).toEqual(before);
    expect(prepared.episodes[0].dialogueCues.filter(cue => cue.shotId === shot.id).map(cue => [cue.startMs - owner.startMs, cue.endMs - owner.startMs])).toEqual([[629, 4253], [4373, 6413]]);
    expect(prepared.episodes[0].scenes).toEqual(document.episodes[0].scenes);
    expect(prepared.episodes[0].dialogueCues.map(cue => cue.text)).toEqual(document.episodes[0].dialogueCues.map(cue => cue.text));
    expect(prepared.episodes[0].timeline.audioClips?.find(clip => clip.id === `dialogue-clip-${cues[0].id}`)).toMatchObject({ durationMs: 3624, sourceDurationMs: 3624, sourceMediaDurationMs: 3624 });
    expect(await prepareMotionComicDialogueForRender(prepared, async path => path.includes(cues[0].id) ? 3624 : 2040)).toBe(prepared);
  });

  it('rejects unusable audio and speech that cannot fit instead of cutting it', async () => {
    const { document } = voicedFixture();
    await expect(prepareMotionComicDialogueForRender(document, async () => NaN)).rejects.toThrow('DURATION_INVALID');
    await expect(prepareMotionComicDialogueForRender(document, async () => 60000)).rejects.toThrow('DOES_NOT_FIT');
  });

  it('does not probe native video speech or recordings from another episode', async () => {
    let { document, shot } = voicedFixture();
    document = appendMotionComicEpisode(document);
    const selected = document.episodes[0].scenes.flatMap(scene => scene.shots).find(item => item.id === shot.id)!;
    selected.renderStrategy = 'remote-video';
    selected.videoProduction = { version: 1, referenceMode: 'frames', audioMode: 'native' };
    let calls = 0;
    expect(await prepareMotionComicDialogueForRender(document, async () => { calls++; return 1000; }, document.episodes[0].id)).toBe(document);
    expect(calls).toBe(0);
  });
});
