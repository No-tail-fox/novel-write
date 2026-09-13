import { describe, expect, it } from 'vitest';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { motionComicDialogueInput, motionComicDialogueInputMatches, updateMotionComicCharacterVoice } from '../src/shared/motion-comic-dialogue';
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
});
