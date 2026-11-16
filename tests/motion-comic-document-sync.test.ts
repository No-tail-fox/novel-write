import { describe, expect, it } from 'vitest';
import { createMotionComicDraft, type MotionComicPipelineData } from '../src/shared/motion-comic';
import { mergeMotionComicSavedDocument } from '../src/shared/motion-comic-document-sync';

function fixture() {
  const document = createMotionComicDraft({ id: 'project', title: 'Original', premise: 'A letter', now: '2026-09-06T00:00:00.000Z' });
  document.characters = [{ id: 'character', name: 'Original name', role: '', identityPrompt: '', personality: '', voiceNotes: '', voiceSampleAssetVersionId: 'old-sample', looks: [
    { id: 'look', characterId: 'character', label: 'Original look', appearancePrompt: '', wardrobe: 'Original coat', continuityNotes: '', pinned: true, referenceAssetVersionIds: ['old-look'] },
  ] }];
  document.sceneAssets = [{ id: 'scene', label: 'Original scene', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: ['old-scene'] }];
  document.props = [{ id: 'prop', label: 'Original prop', description: '', prompt: '', referenceAssetVersionIds: ['old-prop'] }];
  return document;
}

function remote(submitted: MotionComicPipelineData) {
  const saved = structuredClone(submitted);
  saved.updatedAt = '2026-09-06T00:01:00.000Z';
  saved.characters[0].looks[0].referenceAssetVersionIds.push('new-look');
  saved.sceneAssets[0].referenceAssetVersionIds.push('new-scene');
  saved.props[0].referenceAssetVersionIds.push('new-prop');
  saved.characters[0].voiceSampleAssetVersionId = 'new-sample';
  for (const id of ['new-look', 'new-scene', 'new-prop', 'new-sample']) {
    saved.assets.push({ id, assetId: id, kind: id === 'new-sample' ? 'audio' : 'image', selected: true, createdAt: saved.updatedAt });
  }
  return saved;
}

describe('MotionComic saved document reconciliation', () => {
  it('merges background references and sample while keeping dirty names and wardrobe', () => {
    const submitted = fixture(), saved = remote(submitted), live = structuredClone(submitted);
    live.title = 'Typed title';
    live.characters[0].name = 'Typed name';
    live.characters[0].looks[0].wardrobe = 'Typed coat';
    live.sceneAssets[0].label = 'Typed scene';
    live.props[0].label = 'Typed prop';
    const before = structuredClone({ live, submitted, saved });
    const merged = mergeMotionComicSavedDocument(live, submitted, saved);
    expect(merged.title).toBe('Typed title');
    expect(merged.characters[0]).toMatchObject({ name: 'Typed name', voiceSampleAssetVersionId: 'new-sample' });
    expect(merged.characters[0].looks[0]).toMatchObject({ wardrobe: 'Typed coat', referenceAssetVersionIds: ['old-look', 'new-look'] });
    expect(merged.sceneAssets[0]).toMatchObject({ label: 'Typed scene', referenceAssetVersionIds: ['old-scene', 'new-scene'] });
    expect(merged.props[0]).toMatchObject({ label: 'Typed prop', referenceAssetVersionIds: ['old-prop', 'new-prop'] });
    expect(merged.assets.map(({ id, selected }) => [id, selected])).toEqual(['new-look', 'new-scene', 'new-prop', 'new-sample'].map(id => [id, false]));
    expect(merged.updatedAt).toBe(saved.updatedAt);
    expect({ live, submitted, saved }).toEqual(before);
  });

  it.each(['chosen-sample', undefined])('preserves explicit sample change/removal (%s) and local reference adoption/removal', (sample) => {
    const submitted = fixture(), saved = remote(submitted), live = structuredClone(submitted);
    live.characters[0].voiceSampleAssetVersionId = sample;
    live.characters[0].looks[0].referenceAssetVersionIds = ['chosen-look'];
    live.sceneAssets[0].referenceAssetVersionIds = [];
    live.props[0].referenceAssetVersionIds = ['new-prop', 'chosen-prop'];
    saved.props[0].referenceAssetVersionIds.push('new-prop');
    const merged = mergeMotionComicSavedDocument(live, submitted, saved);
    expect(merged.characters[0].voiceSampleAssetVersionId).toBe(sample);
    expect(merged.characters[0].looks[0].referenceAssetVersionIds).toEqual(['chosen-look', 'new-look']);
    expect(merged.sceneAssets[0].referenceAssetVersionIds).toEqual(['new-scene']);
    expect(merged.props[0].referenceAssetVersionIds).toEqual(['new-prop', 'chosen-prop']);
  });

  it('matches by ID despite reordering and never resurrects locally deleted targets', () => {
    const submitted = fixture();
    submitted.characters.push({ ...structuredClone(submitted.characters[0]), id: 'deleted-character' });
    submitted.characters[0].looks.push({ ...submitted.characters[0].looks[0], id: 'deleted-look' });
    submitted.sceneAssets.push({ ...submitted.sceneAssets[0], id: 'deleted-scene' });
    submitted.props.push({ ...submitted.props[0], id: 'deleted-prop' });
    const saved = remote(submitted), live = structuredClone(submitted);
    live.characters.pop(); live.characters[0].looks.pop(); live.sceneAssets.pop(); live.props.pop();
    saved.characters.reverse(); saved.sceneAssets.reverse(); saved.props.reverse();
    const merged = mergeMotionComicSavedDocument(live, submitted, saved);
    expect(merged.characters.map(item => item.id)).toEqual(['character']);
    expect(merged.characters[0].looks.map(item => item.id)).toEqual(['look']);
    expect(merged.characters[0].looks[0].referenceAssetVersionIds).toEqual(['old-look', 'new-look']);
    expect(merged.sceneAssets.map(item => item.id)).toEqual(['scene']);
    expect(merged.sceneAssets[0].referenceAssetVersionIds).toEqual(['old-scene', 'new-scene']);
    expect(merged.props.map(item => item.id)).toEqual(['prop']);
    expect(merged.props[0].referenceAssetVersionIds).toEqual(['old-prop', 'new-prop']);
  });

  it('appends newly extracted characters, looks, scenes and props with series IDs alongside dirty metadata', () => {
    const submitted = fixture(), live = structuredClone(submitted), saved = structuredClone(submitted);
    live.title = 'Typed title';
    live.series.title = 'Typed series';
    live.characters[0].name = 'Typed name';
    saved.characters.push({ ...structuredClone(submitted.characters[0]), id: 'new-character', looks: [] });
    saved.characters[0].looks.push({ ...submitted.characters[0].looks[0], id: 'new-look-target' });
    saved.sceneAssets.push({ ...submitted.sceneAssets[0], id: 'new-scene-target' });
    saved.props.push({ ...submitted.props[0], id: 'new-prop-target' });
    saved.series.characterIds = ['new-character', 'new-character'];
    saved.series.sceneAssetIds = ['new-scene-target'];
    saved.series.propAssetIds = ['new-prop-target', 'missing'];
    const merged = mergeMotionComicSavedDocument(live, submitted, saved);
    expect(merged.title).toBe('Typed title');
    expect(merged.series.title).toBe('Typed series');
    expect(merged.characters[0].name).toBe('Typed name');
    expect(merged.characters.map(item => item.id)).toEqual(['character', 'new-character']);
    expect(merged.characters[0].looks.map(item => item.id)).toEqual(['look', 'new-look-target']);
    expect(merged.sceneAssets.map(item => item.id)).toEqual(['scene', 'new-scene-target']);
    expect(merged.props.map(item => item.id)).toEqual(['prop', 'new-prop-target']);
    expect(merged.series).toMatchObject({ characterIds: ['new-character'], sceneAssetIds: ['new-scene-target'], propAssetIds: ['new-prop-target'] });
  });

  it('preserves local entity and series membership deletions while adding only remote increments', () => {
    const submitted = fixture();
    submitted.series.characterIds = ['character'];
    submitted.series.sceneAssetIds = ['scene'];
    submitted.series.propAssetIds = ['prop'];
    const live = structuredClone(submitted), saved = structuredClone(submitted);
    live.characters = []; live.props = [];
    live.series.characterIds = []; live.series.sceneAssetIds = []; live.series.propAssetIds = [];
    saved.characters.push({ ...structuredClone(submitted.characters[0]), id: 'new-character', looks: [] });
    saved.sceneAssets.push({ ...submitted.sceneAssets[0], id: 'new-scene-target' });
    saved.props.push({ ...submitted.props[0], id: 'new-prop-target' });
    saved.series.characterIds.push('new-character');
    saved.series.sceneAssetIds.push('new-scene-target');
    saved.series.propAssetIds.push('new-prop-target');
    const merged = mergeMotionComicSavedDocument(live, submitted, saved);
    expect(merged.characters.map(item => item.id)).toEqual(['new-character']);
    expect(merged.sceneAssets.map(item => item.id)).toEqual(['scene', 'new-scene-target']);
    expect(merged.props.map(item => item.id)).toEqual(['new-prop-target']);
    expect(merged.series).toMatchObject({ characterIds: ['new-character'], sceneAssetIds: ['new-scene-target'], propAssetIds: ['new-prop-target'] });
  });

  it('accepts saved by identity when no dirty edit exists, including known persisted refresh', () => {
    const submitted = fixture(), saved = remote(submitted), refreshed = structuredClone(submitted);
    expect(mergeMotionComicSavedDocument(submitted, submitted, saved)).toBe(saved);
    expect(mergeMotionComicSavedDocument(refreshed, submitted, saved, refreshed)).toBe(saved);
    const live = { ...refreshed, title: 'After polling' };
    expect(mergeMotionComicSavedDocument(live, submitted, saved, refreshed).characters[0].voiceSampleAssetVersionId).toBe('new-sample');
  });

  it('ignores responses from a different project in either direction', () => {
    const submitted = fixture(), saved = remote(submitted), live = { ...submitted, title: 'Dirty' };
    const otherLive = { ...live, id: 'other' };
    expect(mergeMotionComicSavedDocument(otherLive, submitted, saved)).toBe(otherLive);
    expect(mergeMotionComicSavedDocument(live, submitted, { ...saved, id: 'other' })).toBe(live);
  });

  it('does not adopt remote references to assets explicitly deleted locally', () => {
    const submitted = fixture();
    submitted.assets.push(
      { id: 'deleted-image', assetId: 'deleted-image', kind: 'image', createdAt: submitted.updatedAt },
      { id: 'deleted-audio', assetId: 'deleted-audio', kind: 'audio', createdAt: submitted.updatedAt },
    );
    const saved = remote(submitted), live = { ...submitted, assets: [] };
    saved.characters[0].voiceSampleAssetVersionId = 'deleted-audio';
    saved.characters[0].looks[0].referenceAssetVersionIds.push('deleted-image');
    saved.sceneAssets[0].referenceAssetVersionIds.push('deleted-image');
    saved.props[0].referenceAssetVersionIds.push('deleted-image');
    const merged = mergeMotionComicSavedDocument(live, submitted, saved);
    expect(merged.characters[0].voiceSampleAssetVersionId).toBe('old-sample');
    expect(merged.characters[0].looks[0].referenceAssetVersionIds).toEqual(['old-look', 'new-look']);
    expect(merged.sceneAssets[0].referenceAssetVersionIds).toEqual(['old-scene', 'new-scene']);
    expect(merged.props[0].referenceAssetVersionIds).toEqual(['old-prop', 'new-prop']);
    expect(merged.assets.some(asset => asset.id.startsWith('deleted-'))).toBe(false);
  });

  it('supports old documents without a current sample and empty asset catalogs', () => {
    const submitted = fixture();
    delete submitted.characters[0].voiceSampleAssetVersionId;
    const saved = remote(submitted), live = { ...submitted, title: 'Dirty' };
    expect(mergeMotionComicSavedDocument(live, submitted, saved).characters[0].voiceSampleAssetVersionId).toBe('new-sample');
    const empty = createMotionComicDraft({ id: 'old', title: 'Old', premise: '' });
    expect(mergeMotionComicSavedDocument({ ...empty, title: 'Dirty' }, empty, { ...empty }).characters).toEqual(empty.characters);
  });
});
