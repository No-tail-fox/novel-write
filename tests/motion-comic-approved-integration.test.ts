import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { attachMotionComicReference, fixedMotionComicReferenceAsset } from '../src/features/motion-comic/motion-comic-consistency';

// Pure in-memory evidence: no DB, providers, file import, or generation.
describe('approved Page candidate import contract', () => {
  it.each(['look', 'scene', 'prop'] as const)('%s import preserves adopted reference and existing video', kind => {
    const initial = createMotionComicStarterProject(createMotionComicDraft({ id: 'qa-import', title: 'QA', premise: 'fixture' }));
    const id = kind === 'look' ? initial.characters[0].looks[0].id : kind === 'scene' ? initial.sceneAssets[0].id : initial.props[0].id;
    const target = { kind, id };
    const asset = { id: 'old', assetId: id, kind: 'image' as const, localPath: 'fixture-only/old.png', createdAt: '2026-01-01T00:00:00Z' };
    const adopted = attachMotionComicReference(initial, target, asset);
    adopted.episodes[0].scenes[0].shots[0].videoAssetVersionId = 'existing-video';
    const before = JSON.stringify(adopted);
    const imported = attachMotionComicReference(adopted, target, { ...asset, id: 'new', localPath: 'fixture-only/new.png' }, { setFixed: false });
    expect(JSON.stringify(adopted)).toBe(before);
    expect(imported.assets.find(item => item.id === 'new')).toMatchObject({ selected: false, pinned: false });
    expect(fixedMotionComicReferenceAsset(imported, ['old', 'new'])?.id).toBe('old');
    expect(imported.assets.find(item => item.id === 'old')).toEqual(adopted.assets.find(item => item.id === 'old'));
    expect(imported.episodes).toEqual(adopted.episodes);
    expect(imported.providerJobs).toEqual(adopted.providerJobs);
  });
  it('Page explicitly requests candidate import and new video while resume preserves job policy', () => {
    const source = readFileSync(new URL('../src/features/motion-comic/MotionComicPage.tsx', import.meta.url), 'utf8');
    const importer = source.slice(source.indexOf('async function importReference('), source.indexOf('async function generateReference('));
    expect(importer).toContain('attachMotionComicReference(latest, target, asset, { setFixed: false })');
    expect(importer).not.toContain('setMotionComicFixedReference');
    expect(source).toContain("adoption: 'candidate' | 'automatic' = 'candidate'");
    expect(source).toContain("const effectiveAdoption = resumeOnly ? latestVideoJob?.videoAdoption ?? 'automatic' : adoption");
  });
});
