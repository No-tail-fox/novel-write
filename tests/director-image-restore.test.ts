import { describe, expect, it } from 'vitest';
import { restoreEditorialImageVersion, restoreMotionComicImageVersion } from '../src/features/director-desk/director-generation';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import type { ProductionAssetVersion } from '../src/shared/production-workflow';

const now = '2026-09-08T00:00:00.000Z';
const assets = (): ProductionAssetVersion[] => [
  { id: 'old', assetId: 'image-family', kind: 'image', localPath: 'I:/media/old.png', selected: false, pinned: true, createdAt: now },
  { id: 'new', assetId: 'image-family', kind: 'image', localPath: 'I:/media/new.png', selected: true, pinned: false, createdAt: now },
  { id: 'other', assetId: 'other-family', kind: 'image', localPath: 'I:/media/other.png', selected: true, pinned: true, createdAt: now },
  { id: 'voice', assetId: 'voice-family', kind: 'audio', localPath: 'I:/media/voice.wav', selected: true, pinned: false, createdAt: now },
];
function editorial() {
  const doc = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox', title: 'Restore', ratio: '16:9', now }), 'Keep image history.', now);
  doc.assets = assets();
  doc.beats[0].shots[0].layers[0].source = 'generated-image';
  doc.beats[0].shots[0].layers[0].assetVersionId = 'new';
  return rebuildEditorialTimeline(doc);
}
function comic() {
  const doc = createMotionComicStarterProject(createMotionComicDraft({ id: 'comic', title: 'Restore', premise: 'Keep image history.', ratio: '9:16', now }), 'Episode 1', now);
  doc.assets = assets();
  doc.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId = 'new';
  doc.episodes[0].timeline.clips[0].assetVersionIds = ['new', 'voice'];
  return doc;
}

describe('restoring director image history', () => {
  it.each(['editorial-collage', 'motion-comic'] as const)('synchronizes references and selection without changing history or pins in %s', (kind) => {
    const doc = kind === 'editorial-collage' ? editorial() : comic();
    const before = structuredClone(doc);
    const next = doc.workflowKind === 'editorial-collage'
      ? restoreEditorialImageVersion(doc, doc.beats[0].shots[0].id, 'old')
      : restoreMotionComicImageVersion(doc, doc.episodes[0].scenes[0].shots[0].id, 'old');
    expect(next.assets.map((asset) => [asset.id, asset.selected, asset.pinned])).toEqual([
      ['old', true, true], ['new', false, false], ['other', true, true], ['voice', true, false],
    ]);
    expect(next.assets.map(({ selected: _, ...asset }) => asset)).toEqual(doc.assets.map(({ selected: _, ...asset }) => asset));
    expect(next.providerJobs).toEqual(doc.providerJobs);
    const timeline = next.workflowKind === 'editorial-collage' ? next.timeline : next.episodes[0].timeline;
    expect(timeline!.clips[0].assetVersionIds).toContain('old');
    expect(timeline!.clips[0].assetVersionIds).not.toContain('new');
    if (next.workflowKind === 'motion-comic') expect(timeline!.clips[0].assetVersionIds).toContain('voice');
    expect(doc).toEqual(before);
  });

  it('restores the generated layer and retains another layer using the newer version', () => {
    const doc = editorial();
    const shot = doc.beats[0].shots[0];
    shot.layers.unshift({ ...shot.layers[0], id: 'fixed-background', source: 'local-file', assetVersionId: 'other' });
    shot.layers.push({ ...shot.layers[1], id: 'shared-new', source: 'local-file' });
    shot.videoAssetVersionId = 'derived-video';
    shot.videoJobId = 'derived-job';
    const next = restoreEditorialImageVersion(doc, shot.id, 'old');
    const restored = next.beats[0].shots[0];
    expect(restored.layers.map((layer) => layer.assetVersionId)).toEqual(shot.layers.map((layer, index) => index === 1 ? 'old' : layer.assetVersionId));
    expect(next.assets.find((asset) => asset.id === 'new')?.selected).toBe(true);
    expect(restored.videoAssetVersionId).toBeUndefined();
    expect(restored.videoJobId).toBeUndefined();
  });

  it('repairs selection for the same image without invalidating its derived video', () => {
    const doc = editorial();
    const shot = doc.beats[0].shots[0];
    doc.assets.find((asset) => asset.id === 'new')!.selected = false;
    shot.videoAssetVersionId = 'derived-video';
    shot.videoJobId = 'derived-job';
    const next = restoreEditorialImageVersion(doc, shot.id, 'new');
    expect(next.beats[0].shots[0].videoAssetVersionId).toBe('derived-video');
    expect(next.assets.find((asset) => asset.id === 'new')?.selected).toBe(true);
  });

  it('retains the newer image used by another episode and only edits the active episode', () => {
    const doc = comic();
    const other = structuredClone(doc.episodes[0]);
    other.id = 'other-episode';
    other.number = 2;
    other.scenes.forEach((scene) => {
      scene.episodeId = other.id;
      scene.shots.forEach((shot) => { shot.id += '-other'; shot.episodeId = other.id; shot.dialogueCueIds = shot.dialogueCueIds.map((id) => id + '-other'); });
    });
    other.dialogueCues.forEach((cue) => { cue.id += '-other'; cue.shotId += '-other'; });
    other.timeline.clips.forEach((clip) => { clip.id += '-other'; clip.shotId += '-other'; clip.subtitleCueIds = clip.subtitleCueIds.map((id) => id + '-other'); });
    doc.episodes.push(other);
    const next = restoreMotionComicImageVersion(doc, doc.episodes[0].scenes[0].shots[0].id, 'old');
    expect(next.episodes[1]).toEqual(other);
    expect(next.assets.find((asset) => asset.id === 'new')?.selected).toBe(true);
    expect(next.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId).toBe('old');
  });

  it('preserves the currently fixed consistency reference and last frame', () => {
    const doc = comic();
    const shot = doc.episodes[0].scenes[0].shots[0];
    shot.lastFrameAssetVersionId = 'new';
    doc.characters[0].looks[0].referenceAssetVersionIds = ['new'];
    doc.assets.find((asset) => asset.id === 'new')!.pinned = true;
    const next = restoreMotionComicImageVersion(doc, shot.id, 'old');
    expect(next.assets.find((asset) => asset.id === 'new')).toMatchObject({ selected: true, pinned: true });
    expect(next.characters).toEqual(doc.characters);
    expect(next.episodes[0].scenes[0].shots[0].lastFrameAssetVersionId).toBe('new');
    expect(next.episodes[0].timeline.clips[0].assetVersionIds).toEqual(['new', 'voice', 'old']);
  });

  it('ignores unknown shots and missing or non-image versions', () => {
    const vox = editorial();
    const manga = comic();
    for (const version of ['missing', 'voice']) {
      expect(restoreEditorialImageVersion(vox, vox.beats[0].shots[0].id, version)).toBe(vox);
      expect(restoreMotionComicImageVersion(manga, manga.episodes[0].scenes[0].shots[0].id, version)).toBe(manga);
    }
    expect(restoreEditorialImageVersion(vox, 'missing', 'old')).toBe(vox);
    expect(restoreMotionComicImageVersion(manga, 'missing', 'old')).toBe(manga);
  });
});
