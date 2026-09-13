import { describe, expect, it } from 'vitest';
import {
  applyEditorialImageRecord, applyEditorialVoiceRecord, applyMotionComicImageRecord,
  directorImageInput, directorImageInputMatches, editorialVoiceInput, editorialVoiceInputMatches,
} from '../src/features/director-desk/director-generation';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { attachMotionComicReference, setMotionComicFixedReference } from '../src/features/motion-comic/motion-comic-consistency';
import type { ImageLabRecord, VoiceLabRecord } from '../src/shared/types';

const now = '2026-09-06T00:00:00.000Z';
const defaults = { provider: 'minimax' as const, voiceId: 'voice-a', voiceLabel: 'Voice A', speed: 1 };
const vox = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox', title: 'VOX', ratio: '16:9', now }), 'A first sentence. A second sentence.', now);
const comic = () => createMotionComicStarterProject(createMotionComicDraft({ id: 'comic', title: 'Comic', premise: 'A letter arrives.', ratio: '9:16', now }), 'Episode A', now);
const imageRecord = (input: ReturnType<typeof directorImageInput>, id = 'image-a'): ImageLabRecord => ({
  id, prompt: input.prompt, ratio: input.ratio, style: 'cinematic', provider: 'gpt_image',
  imagePath: `E:/fixture/${id}.png`, status: 'generated', errorMessage: '', resolution: '2K', quality: 'medium',
  smartMode: 'reference-edit', referenceImagePaths: input.references.map((item) => item.path),
  referenceImagePath: input.references[0]?.path ?? '', upstreamTaskId: null, createdAt: now, finishedAt: now,
});
const voiceRecord = (input: ReturnType<typeof editorialVoiceInput>, id = 'voice-a'): VoiceLabRecord => ({
  id, text: input.text, provider: input.provider, voiceId: input.voiceId, voiceLabel: input.voiceLabel,
  speed: input.speed, audioPath: `E:/fixture/${id}.mp3`, status: 'generated', errorMessage: '', createdAt: now, finishedAt: now,
});

describe('director generation input ownership', () => {
  it('binds a matching image after unrelated edits and a persistence revision change', () => {
    const document = vox();
    const shotId = document.beats[0].shots[0].id;
    const input = directorImageInput(document, shotId);
    const edited = { ...document, title: 'Renamed', updatedAt: '2026-09-06T00:01:00.000Z' };
    edited.beats[1].shots[0].scenePrompt = 'Another shot changed';
    const next = applyEditorialImageRecord(edited, shotId, imageRecord(input), 'model', input);
    expect(next.assets.at(-1)?.selected).toBe(true);
    expect(next.beats[0].shots[0].layers.some((layer) => layer.assetVersionId === 'image-asset-image-a')).toBe(true);
    expect(next.title).toBe('Renamed');
  });

  it.each(['prompt', 'ratio', 'seed', 'selection'] as const)('retains a stale VOX image without overwriting a changed %s', (change) => {
    const document = vox();
    const shotId = document.beats[0].shots[0].id;
    const input = directorImageInput(document, shotId);
    const edited = structuredClone(document);
    if (change === 'prompt') edited.beats[0].shots[0].scenePrompt = 'New prompt';
    if (change === 'ratio') edited.ratio = '9:16';
    if (change === 'seed') Object.assign(edited.beats[0].shots[0], { seed: 'new-seed', seedLocked: true });
    if (change === 'selection') edited.beats[0].shots[0].layers[0].assetVersionId = 'manual-selection';
    const next = applyEditorialImageRecord(edited, shotId, imageRecord(input), 'model', input);
    expect(next.assets.at(-1)).toMatchObject({ id: 'image-asset-image-a', selected: false });
    expect(next.providerJobs.at(-1)).toMatchObject({ status: 'completed', nodeId: shotId });
    expect(next.beats).toEqual(edited.beats);
  });

  it('never promotes an older request even if its inputs are identical', () => {
    const document = vox();
    const shotId = document.beats[0].shots[0].id;
    const input = directorImageInput(document, shotId);
    const older = applyEditorialImageRecord(document, shotId, imageRecord(input, 'older'), 'model', input, false);
    const newer = applyEditorialImageRecord(older, shotId, imageRecord(input, 'newer'), 'model', input, true);
    expect(newer.assets.find((asset) => asset.id === 'image-asset-older')?.selected).toBe(false);
    expect(newer.assets.find((asset) => asset.id === 'image-asset-newer')?.selected).toBe(true);
    const newestThenOld = applyEditorialImageRecord(newer, shotId, imageRecord(input, 'late'), 'model', input, false);
    expect(newestThenOld.beats).toEqual(newer.beats);
    expect(newestThenOld.assets.find((asset) => asset.id === 'image-asset-newer')?.selected).toBe(true);
  });

  it('rejects a different project and a removed shot without throwing', () => {
    const document = vox();
    const shotId = document.beats[0].shots[0].id;
    const input = directorImageInput(document, shotId);
    expect(directorImageInputMatches({ ...document, id: 'another' }, input)).toBe(false);
    expect(directorImageInputMatches({ ...document, beats: [] }, input)).toBe(false);
  });

  it('keeps a comic image bound to its original episode when another episode is selected', () => {
    const document = comic();
    const shotId = document.episodes[0].scenes[0].shots[0].id;
    const input = directorImageInput(document, shotId);
    const edited = appendMotionComicEpisode(document, { id: 'episode-b', title: 'Episode B' });
    const next = applyMotionComicImageRecord(edited, shotId, imageRecord(input), 'model', input);
    expect(next.activeEpisodeId).toBe('episode-b');
    expect(next.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId).toBe('image-asset-image-a');
    expect(next.episodes[1].scenes[0].shots[0].firstFrameAssetVersionId).toBeUndefined();
  });

  it('rejects changed fixed reference versions even if they reuse the same local path', () => {
    const initial = comic();
    const shotId = initial.episodes[0].scenes[0].shots[0].id;
    const target = { kind: 'scene' as const, id: initial.episodes[0].scenes[0].shots[0].sceneAssetId };
    let document = attachMotionComicReference(initial, target, { id: 'ref-a', assetId: 'reference', kind: 'image', localPath: 'E:/fixture/ref.png', createdAt: now });
    const input = directorImageInput(document, shotId);
    document = attachMotionComicReference(document, target, { id: 'ref-b', assetId: 'reference', kind: 'image', localPath: 'E:/fixture/ref.png', createdAt: now });
    const next = applyMotionComicImageRecord(document, shotId, imageRecord(input), 'model', input);
    expect(next.assets.at(-1)?.selected).toBe(false);
    expect(next.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId).toBeUndefined();
    expect(directorImageInputMatches(setMotionComicFixedReference(document, target, 'ref-a'), input)).toBe(true);
  });

  it('rejects changed comic identity instructions without invalidating unrelated episodes', () => {
    const document = comic();
    const shotId = document.episodes[0].scenes[0].shots[0].id;
    const input = directorImageInput(document, shotId);
    document.series.visualRules.push('New wardrobe direction');
    const next = applyMotionComicImageRecord(document, shotId, imageRecord(input), 'model', input);
    expect(next.assets.at(-1)?.selected).toBe(false);
    expect(next.episodes).toEqual(document.episodes);
  });

  it.each(['text', 'voice', 'speed', 'selection'] as const)('preserves changed VOX %s when an older voice recording completes', (change) => {
    const document = vox();
    const shotId = document.beats[0].shots[0].id;
    const input = editorialVoiceInput(document, shotId, defaults);
    const edited = structuredClone(document);
    if (change === 'text') edited.beats[0].subtitleCues[0].text = 'A replacement narration.';
    if (change === 'voice') Object.assign(edited.beats[0].shots[0], { voiceId: 'voice-new', voiceLabel: 'New voice' });
    if (change === 'speed') edited.beats[0].shots[0].voiceSpeed = 1.5;
    if (change === 'selection') edited.beats[0].shots[0].voiceAssetVersionId = 'manual-audio';
    const next = applyEditorialVoiceRecord(edited, shotId, voiceRecord(input), 'tts-model', input);
    expect(next.assets.at(-1)).toMatchObject({ selected: false, id: 'voice-asset-voice-a' });
    expect(next.beats).toEqual(edited.beats);
    expect(editorialVoiceInputMatches(edited, input)).toBe(false);
  });

  it('binds matching VOX narration and retains failed or mismatching provider results without changing voice settings', () => {
    const document = vox();
    const shotId = document.beats[0].shots[0].id;
    const input = editorialVoiceInput(document, shotId, defaults);
    const next = applyEditorialVoiceRecord(document, shotId, voiceRecord(input), 'tts-model', input);
    expect(next.beats[0].shots[0]).toMatchObject({ voiceId: input.voiceId, voiceAssetVersionId: 'voice-asset-voice-a' });
    const wrongRecord = { ...voiceRecord(input), voiceId: 'other-voice' };
    const rejected = applyEditorialVoiceRecord(document, shotId, wrongRecord, 'tts-model', input);
    expect(rejected.assets.at(-1)?.selected).toBe(false);
    expect(rejected.beats).toEqual(document.beats);
    const failed = applyEditorialVoiceRecord(document, shotId, { ...wrongRecord, status: 'failed', audioPath: '' }, 'tts-model', input);
    expect(failed.assets).toEqual(document.assets);
    expect(failed.beats).toEqual(document.beats);
  });
});
