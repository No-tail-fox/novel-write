import { describe, expect, it } from 'vitest';
import { addDirectorSubtitleCue, removeDirectorSubtitleCue, invalidateDirectorShotSpeech, setDirectorShotNarration } from '../src/shared/director-subtitle-structure';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { DirectorSubtitleDocument } from '../src/shared/director-subtitles';
import { productionAudioClipsForShot } from '../src/shared/production-audio';

function fixture(mode: 'vox' | 'comic') {
  return mode === 'vox'
    ? createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'structure-vox', title: '字幕编辑' }), '第一句。第二句。')
    : createMotionComicStarterProject(createMotionComicDraft({ id: 'structure-comic', title: '字幕编辑', premise: '两个人在雨夜相逢。' }), '第一集');
}
function view(document: DirectorSubtitleDocument) {
  if (document.workflowKind === 'editorial-collage') {
    const shot = document.beats[0].shots[0];
    return { shot, ids: shot.subtitleCueIds, cues: document.beats[0].subtitleCues, timeline: document.timeline! };
  }
  const shot = document.episodes[0].scenes[0].shots[0];
  return { shot, ids: shot.dialogueCueIds, cues: document.episodes[0].dialogueCues.filter((cue) => cue.shotId === shot.id), timeline: document.episodes[0].timeline };
}
function reopen(document: DirectorSubtitleDocument) {
  return document.workflowKind === 'editorial-collage' ? parseEditorialCollagePipelineData(JSON.stringify(document)) : parseMotionComicPipelineData(JSON.stringify(document));
}

describe('VOX explicit speech structure edits', () => {
  it('preserves existing speech when inline narration has not changed', () => {
    const document = fixture('vox');
    const target = view(document);
    target.shot.voiceAssetVersionId = 'retained-voice';
    const text = target.cues.filter(cue => target.ids.includes(cue.id)).sort((a, b) => a.startMs - b.startMs).map(cue => cue.text).join('\n');
    expect(setDirectorShotNarration(document, target.shot.id, text)).toBe(document);
    expect(target.shot.voiceAssetVersionId).toBe('retained-voice');
  });
  it('persists inline narration, retains cue IDs/timing and invalidates obsolete speech', () => {
    const document = fixture('vox');
    if (document.workflowKind !== 'editorial-collage') throw new Error('Expected VOX fixture.');
    const shot = document.beats[0].shots[0];
    const old = document.beats[0].subtitleCues.filter(cue => shot.subtitleCueIds.includes(cue.id));
    shot.voiceAssetVersionId = 'old-voice';
    old[0].audioAssetVersionId = 'old-voice';
    const next = setDirectorShotNarration(document, shot.id, old.map((_, i) => `修改后的旁白 ${i}`).join('\n'));
    const cues = next.beats[0].subtitleCues.filter(cue => shot.subtitleCueIds.includes(cue.id));
    expect(cues.map(({ id, startMs, endMs }) => ({ id, startMs, endMs }))).toEqual(old.map(({ id, startMs, endMs }) => ({ id, startMs, endMs })));
    expect(cues.map(cue => cue.text)).toEqual(old.map((_, i) => `修改后的旁白 ${i}`));
    expect(cues.every(cue => !cue.audioAssetVersionId && !cue.tokens?.length)).toBe(true);
    expect(next.beats[0].shots[0].voiceAssetVersionId).toBeUndefined();
    expect(next.beats[1]).toEqual(document.beats[1]);
    expect(reopen(next)).toEqual(next);
  });
  it('reconciles line insertion/removal within the shot and preserves blank editing lines', () => {
    const document = fixture('vox');
    const target = view(document);
    const next = setDirectorShotNarration(document, target.shot.id, '第一行\n\n第三行');
    expect(view(next).cues.map(cue => cue.text)).toEqual(['第一行', '', '第三行']);
    expect(view(next).cues[0].startMs).toBe(0);
    expect(view(next).cues.at(-1)?.endMs).toBe(target.shot.durationMs);
    expect(new Set(view(next).ids).size).toBe(3);
    expect(reopen(next)).toEqual(next);
    const removed = setDirectorShotNarration(next, target.shot.id, '合为一句');
    expect(view(removed).cues).toHaveLength(1);
    expect(view(removed).timeline.clips[0].subtitleCueIds).toEqual(view(removed).ids);
    expect(reopen(removed)).toEqual(removed);
  });
  it.each(['add', 'remove', 'voice'] as const)('%s invalidates all shot speech while preserving other shots and authored music/effects', (operation) => {
    const initial = fixture('vox');
    if (initial.workflowKind !== 'editorial-collage') throw new Error('Expected VOX fixture.');
    const shot = initial.beats[0].shots[0];
    const other = initial.beats[1].shots[0];
    shot.voiceAssetVersionId = 'old-voice';
    initial.beats[0].subtitleCues[0].audioAssetVersionId = 'old-voice';
    initial.assets.push(...['old-voice', 'old-dialogue', 'music-source', 'effect-source'].map((id) => ({ id, assetId: id, kind: 'audio' as const, createdAt: initial.createdAt })));
    initial.timeline!.audioClips = [
      { id: 'stale-narration', assetVersionId: 'old-voice', shotId: shot.id, trackType: 'narration', startMs: 0, durationMs: shot.durationMs },
      { id: 'stale-dialogue', assetVersionId: 'old-dialogue', shotId: shot.id, trackType: 'dialogue', startMs: 0, durationMs: shot.durationMs, muted: true },
      { id: 'music', assetVersionId: 'music-source', shotId: shot.id, trackType: 'music', startMs: 0, durationMs: shot.durationMs, gainDb: -9, fadeOutMs: 300 },
      { id: 'effect', assetVersionId: 'effect-source', shotId: shot.id, trackType: 'sfx', startMs: 50, durationMs: 500, sourceStartMs: 100 },
      { id: 'retained-narration', assetVersionId: 'old-voice', shotId: other.id, trackType: 'narration', startMs: shot.durationMs, durationMs: other.durationMs },
    ];
    const document = rebuildEditorialTimeline(initial);
    const before = structuredClone(document);
    const retainedClips = document.timeline!.audioClips!.slice(2);
    const next = operation === 'add' ? addDirectorSubtitleCue(document, shot.id, 'new-explicit-cue')
      : operation === 'remove' ? removeDirectorSubtitleCue(document, shot.id, shot.subtitleCueIds[0])
        : invalidateDirectorShotSpeech(document, shot.id);
    expect(next.beats[0].shots[0].voiceAssetVersionId).toBeUndefined();
    expect(next.beats[0].subtitleCues.every((cue) => !cue.audioAssetVersionId)).toBe(true);
    expect(next.timeline!.audioClips).toEqual(retainedClips);
    expect(next.timeline!.audioAssetVersionIds).not.toContain('old-dialogue');
    expect(next.timeline!.audioAssetVersionIds).toEqual(['music-source', 'effect-source', 'old-voice']);
    expect(productionAudioClipsForShot(next.timeline, next.beats[0].shots[0])?.map((clip) => clip.trackType)).toEqual(['music', 'sfx']);
    expect(next.assets).toBe(document.assets);
    expect(next.providerJobs).toBe(document.providerJobs);
    expect(document).toEqual(before);
    expect(reopen(next)).toEqual(next);
  });
});

describe.each(['vox', 'comic'] as const)('%s subtitle structure', (mode) => {
  it('adds a separate timed cue without losing authored text or adding shots', () => {
    const document = fixture(mode);
    const before = structuredClone(document);
    const old = view(document);
    const next = addDirectorSubtitleCue(document, old.shot.id, 'new-cue');
    const updated = view(next);
    expect(updated.cues).toHaveLength(old.cues.length + 1);
    expect(updated.cues.find((cue) => cue.id === 'new-cue')?.text).toBe('');
    expect(updated.cues.filter((cue) => cue.id !== 'new-cue').map((cue) => cue.text)).toEqual(old.cues.map((cue) => cue.text));
    expect(updated.ids).toContain('new-cue');
    expect(updated.timeline.clips[0].subtitleCueIds).toEqual(updated.ids);
    expect(updated.timeline.clips.length).toBe(old.timeline.clips.length);
    expect(document).toEqual(before);
    expect(reopen(next)).toEqual(next);
  });

  it('removes only the selected cue and keeps references valid when the last cue is removed', () => {
    let document = fixture(mode);
    const shotId = view(document).shot.id;
    for (const id of view(document).ids) document = removeDirectorSubtitleCue(document, shotId, id);
    expect(view(document).cues).toEqual([]);
    expect(view(document).timeline.clips[0].subtitleCueIds).toEqual([]);
    const restored = addDirectorSubtitleCue(document, shotId, 'replacement');
    expect(view(restored).cues[0]).toMatchObject({ startMs: 0, endMs: view(document).shot.durationMs, text: '' });
    expect(reopen(restored)).toEqual(restored);
  });

  it('rejects duplicate IDs and deleting another shot cue', () => {
    const document = fixture(mode);
    const target = view(document);
    expect(() => addDirectorSubtitleCue(document, target.shot.id, target.ids[0])).toThrow('重复');
    expect(() => removeDirectorSubtitleCue(document, target.shot.id, 'foreign-cue')).toThrow('不属于');
    expect(() => addDirectorSubtitleCue(document, 'missing-shot', 'new')).toThrow('当前镜头');
  });

  it('invalidates old speech but retains historical assets and provider records', () => {
    const document = fixture(mode);
    const target = view(document);
    target.shot.voiceAssetVersionId = 'old-voice';
    target.cues[0].voiceId = 'old-speaker';
    target.cues[0].voiceSpeed = 1.05;
    document.assets.push({ id: 'old-voice', assetId: 'old-voice', kind: 'audio', createdAt: document.createdAt });
    target.timeline.audioAssetVersionIds.push('old-voice');
    const next = invalidateDirectorShotSpeech(document, target.shot.id);
    expect(view(next).shot.voiceAssetVersionId).toBeUndefined();
    expect(view(next).cues[0].voiceId).toBeUndefined();
    expect(view(next).cues[0].voiceSpeed).toBeUndefined();
    expect(view(next).timeline.audioAssetVersionIds).not.toContain('old-voice');
    expect(next.assets).toBe(document.assets);
    expect(next.providerJobs).toBe(document.providerJobs);
    expect(reopen(next)).toEqual(next);
  });
});
