import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { addDirectorSoundClip, directorEditableAudioClips, removeDirectorSoundClip, updateDirectorAudioClip, type DirectorAudioDocument } from '../src/shared/director-audio-edit';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { readDirectorSoundDuration } from '../src/features/director-desk/director-sound';

function fixture(mode: 'vox' | 'comic') {
  const document = mode === 'vox'
    ? createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'sound-vox', title: '声音编辑' }), '第一句话。第二句话。')
    : createMotionComicStarterProject(createMotionComicDraft({ id: 'sound-comic', title: '声音编辑', premise: '雨夜来信。' }), '第一集');
  document.assets.push({ id: 'old-final', assetId: 'director-final-video', kind: 'video', localPath: 'I:/old.mp4', createdAt: document.createdAt, selected: true, pinned: true });
  return document;
}
function view(document: DirectorAudioDocument) {
  return document.workflowKind === 'editorial-collage'
    ? { shot: document.beats[0].shots[0], timeline: document.timeline! }
    : { shot: document.episodes[0].scenes[0].shots[0], timeline: document.episodes[0].timeline };
}
function reopen(document: DirectorAudioDocument) {
  return document.workflowKind === 'editorial-collage' ? parseEditorialCollagePipelineData(JSON.stringify(document)) : parseMotionComicPipelineData(JSON.stringify(document));
}
function imported(document: DirectorAudioDocument, id = 'sound') {
  return addDirectorSoundClip(document, view(document).shot.id, { id, title: '雨声', path: 'I:/rain.wav', trackType: 'music', durationMs: 8000, createdAt: document.createdAt });
}

describe.each(['vox', 'comic'] as const)('%s sound design', (mode) => {
  it('imports, edits and reopens the same non-destructive mix while invalidating the previous final video', () => {
    const original = fixture(mode);
    const before = structuredClone(original);
    const document = imported(original);
    const { shot, timeline } = view(document);
    const clip = timeline.audioClips![0];
    expect(clip).toMatchObject({ gainDb: -18, sourceMediaDurationMs: 8000, durationMs: Math.min(shot.durationMs, 8000) });
    const edited = updateDirectorAudioClip(document, shot.id, clip.id, { startMs: clip.startMs + 500, durationMs: 1000, sourceStartMs: 250, sourceDurationMs: 1000, gainDb: -6, fadeInMs: 100, fadeOutMs: 200, trackType: 'ambience', muted: true });
    expect(view(edited).timeline.audioClips![0]).toMatchObject({ startMs: 500, durationMs: 1000, sourceStartMs: 250, gainDb: -6, muted: true, trackType: 'ambience' });
    expect(edited.stage).toBe(mode === 'vox' ? 'assets' : 'audio');
    expect(edited.assets.find(asset => asset.id === 'old-final')).toMatchObject({ selected: false, pinned: false });
    expect(reopen(edited)).toEqual(edited);
    expect(original).toEqual(before);
    const removed = removeDirectorSoundClip(edited, shot.id, clip.id);
    expect(view(removed).timeline.audioClips).toEqual([]);
    expect(view(removed).timeline.audioAssetVersionIds).not.toContain('sound');
    expect(removed.assets.some(asset => asset.id === 'sound')).toBe(true);
  });
  it('keeps old narration audible on import and editable without losing the recording', () => {
    const original = fixture(mode);
    const { shot } = view(original);
    shot.voiceAssetVersionId = 'old-voice';
    original.assets.push({ id: 'old-voice', assetId: 'voice', kind: 'audio', localPath: 'I:/speech.wav', createdAt: original.createdAt });
    const document = imported(original);
    const clips = directorEditableAudioClips(document, shot.id);
    expect(clips.map(clip => clip.trackType)).toEqual(['narration', 'music']);
    const muted = updateDirectorAudioClip(document, shot.id, clips[0].id, { muted: true, gainDb: -3 });
    expect(view(muted).shot.voiceAssetVersionId).toBe('old-voice');
    expect(directorEditableAudioClips(reopen(muted), shot.id)[0]).toMatchObject({ muted: true, gainDb: -3 });
    expect(() => updateDirectorAudioClip(document, shot.id, clips[0].id, { startMs: 100 })).toThrow('字幕');
    expect(() => removeDirectorSoundClip(document, shot.id, clips[0].id)).toThrow('字幕');
  });
  it('rejects bad ranges, invalid gain, source overflow and forged fields before mutating state', () => {
    const document = imported(fixture(mode));
    const before = structuredClone(document);
    const { shot, timeline } = view(document);
    const clip = timeline.audioClips![0];
    for (const patch of [{ startMs: -1 }, { startMs: .5 }, { durationMs: 0 }, { gainDb: 25 }, { sourceStartMs: 8000 }, { fadeInMs: shot.durationMs + 1 }, { trackType: 'dialogue' as const }]) {
      expect(() => updateDirectorAudioClip(document, shot.id, clip.id, patch)).toThrow();
    }
    expect(() => updateDirectorAudioClip(document, shot.id, clip.id, { assetVersionId: 'forged' } as never)).toThrow('不支持');
    expect(() => imported(document)).toThrow('重复');
    expect(() => updateDirectorAudioClip(document, 'missing', clip.id, { muted: true })).toThrow('时间线');
    expect(document).toEqual(before);
  });
});

describe('sound source duration probe', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('reads actual metadata then releases the media element', async () => {
    const media = { duration: 2.75, src: '', onloadedmetadata: null as null | (() => void), onerror: null, removeAttribute: vi.fn(), load: vi.fn() };
    vi.stubGlobal('Audio', class { constructor() { return media; } });
    const result = readDirectorSoundDuration('I:/sound.wav');
    media.onloadedmetadata!();
    expect(await result).toBe(2750);
    expect(media.load).toHaveBeenCalled();
    expect(media.onloadedmetadata).toBeNull();
  });
  it('rejects corrupt files and cleans up the timeout', async () => {
    vi.useFakeTimers();
    const media = { duration: NaN, src: '', onloadedmetadata: null, onerror: null as null | (() => void), removeAttribute: vi.fn(), load: vi.fn() };
    vi.stubGlobal('Audio', class { constructor() { return media; } });
    const result = readDirectorSoundDuration('I:/bad.wav');
    media.onerror!();
    await expect(result).rejects.toThrow('无法解码');
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('connects 导入本地音频 to importBgmAudio and editable sound state in both workspaces', async () => {
  for (const path of ['editorial-collage/EditorialCollagePage.tsx', 'motion-comic/MotionComicPage.tsx']) {
    const source = await readFile(new URL(`../src/features/${path}`, import.meta.url), 'utf8');
    expect(source).toContain('await api.importBgmAudio()');
    expect(source).toContain('onImportSound={importSound}');
    expect(source).toContain('await readDirectorSoundDuration(imported.path)');
    expect(source).toContain('request !== projectOpenRequestRef.current');
    expect(source).toContain('soundClips:');
  }
  const source = await readFile(new URL('../src/features/director-desk/DirectorSoundInspector.tsx', import.meta.url), 'utf8');
  expect(source).toContain('导入本地音频');
  expect(source).toContain('onClick={() => void importSound()}');
  expect(source).not.toMatch(/<(?:button|input|select|textarea)\b/);
});
