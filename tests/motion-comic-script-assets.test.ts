import { describe, expect, it } from 'vitest';
import { createMotionComicDraft, createMotionComicImportedProject } from '../src/shared/motion-comic';
import type { MotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import { assertMotionComicScriptAssets, confirmMotionComicScriptAssets, motionComicScriptAssetSummary } from '../src/shared/motion-comic-script-assets';

function script(): MotionComicScriptDraft {
  return {
    title: '来信', logline: '阿青收到来信。',
    characters: [{ key: 'person', name: '阿青', aliases: ['青姐'], role: '主角', identityPrompt: '短发女性', personality: '谨慎', voiceNotes: '低声',
      looks: [{ key: 'look', label: '常服', appearancePrompt: '短发', wardrobe: '灰色外套', continuityNotes: '左袖有补丁' }] }],
    sceneAssets: [{ key: 'room', label: '门厅', description: '雨夜门厅', prompt: '木门', continuityNotes: '左侧光' }],
    props: [{ key: 'letter', label: '信纸', description: '一封旧信', prompt: '折角信纸' }],
    scenes: [{ key: 'scene', actIndex: 1, actTitle: '来信', actBoundaryReason: '来信打破日常', title: '收到信件', summary: '阿青收到信。', locationKey: 'room',
      beats: [{ key: 'beat', kind: 'action', sourceUnitIds: ['S1'], text: '阿青收到来信。' }] }],
  };
}
function project() {
  return createMotionComicImportedProject(
    createMotionComicDraft({ id: 'asset-project', title: '来信', premise: '雨夜来信', now: '2026-10-22T00:00:00.000Z' }),
    { kind: 'novel', adaptationMode: 'novel-adaptation', originalText: '阿青收到来信。', episodes: [{ title: '来信', sourceText: '阿青收到来信。' }] },
  );
}
function ids() { let index = 0; return () => String(++index); }

describe('confirmed project identities before storyboarding', () => {
  it('creates stable project definitions without creating scenes, shots or media, preserving candidate keys', () => {
    const document = project(); const candidate = script();
    const result = confirmMotionComicScriptAssets(document, candidate, ids());
    expect(result.script.characters[0]).toMatchObject({ key: 'person', existingCharacterId: 'character-1', looks: [{ key: 'look', existingLookId: 'look-2' }] });
    expect(result.script.sceneAssets[0].existingSceneAssetId).toBe('location-3');
    expect(result.script.props[0].existingPropId).toBe('prop-4');
    expect(result.document.series).toMatchObject({ characterIds: ['character-1'], sceneAssetIds: ['location-3'], propAssetIds: ['prop-4'] });
    expect(result.document.episodes).toEqual(document.episodes);
    expect(result.document.assets).toEqual([]); expect(result.document.providerJobs).toEqual([]);
    expect(document.characters).toEqual([]); expect(candidate).toEqual(script());
    expect(() => assertMotionComicScriptAssets(result.document, result.script)).not.toThrow();
  });
  it('reuses aliases across episodes and preserves canonical definitions, references and voice settings', () => {
    const first = confirmMotionComicScriptAssets(project(), script(), ids());
    const character = first.document.characters[0];
    character.voiceProvider = 'minimax'; character.voiceId = 'saved-voice'; character.voiceSpeed = 0.8;
    character.looks[0].referenceAssetVersionIds = ['fixed-look'];
    first.document.sceneAssets[0].referenceAssetVersionIds = ['fixed-location'];
    first.document.props[0].referenceAssetVersionIds = ['fixed-prop'];
    for (const id of ['fixed-look', 'fixed-location', 'fixed-prop']) first.document.assets.push({ id, assetId: id, kind: 'image', localPath: `${id}.png`, createdAt: first.document.updatedAt });
    const second = script(); second.characters[0].name = '青姐'; second.characters[0].identityPrompt = '模型提出的不同外观';
    expect(motionComicScriptAssetSummary(first.document, second)).toEqual({ reused: 4, created: 0, unresolved: 0 });
    const result = confirmMotionComicScriptAssets(first.document, second, () => { throw new Error('must reuse'); });
    expect(result.document.characters).toEqual(first.document.characters);
    expect(result.document.sceneAssets).toEqual(first.document.sceneAssets); expect(result.document.props).toEqual(first.document.props);
    expect(result.script.characters[0]).toMatchObject({ name: '阿青', identityPrompt: '短发女性', existingCharacterId: character.id });
  });
  it('requires an explicit choice for ambiguous aliases and allows an independent new identity', () => {
    const first = confirmMotionComicScriptAssets(project(), script(), ids());
    const another = structuredClone(first.document.characters[0]); another.id = 'other'; another.name = '青岚'; another.looks = [];
    first.document.characters.push(another); first.document.series.characterIds.push(another.id);
    const candidate = script(); candidate.characters[0].name = '青姐';
    expect(motionComicScriptAssetSummary(first.document, candidate).unresolved).toBe(1);
    expect(() => confirmMotionComicScriptAssets(first.document, candidate)).toThrow('AMBIGUOUS');
    candidate.characters[0].existingCharacterId = another.id;
    expect(confirmMotionComicScriptAssets(first.document, candidate).script.characters[0].existingCharacterId).toBe('other');
    candidate.characters[0].existingCharacterId = undefined; candidate.characters[0].createNew = true;
    const independent = confirmMotionComicScriptAssets(first.document, candidate);
    expect(independent.document.characters).toHaveLength(3);
    expect(independent.script.characters[0].existingCharacterId).not.toBe(first.document.characters[0].id);
  });
  it('rejects deleted IDs, conflicting choices, and looks owned by another character', () => {
    const first = confirmMotionComicScriptAssets(project(), script(), ids());
    const invalid = structuredClone(first.script);
    invalid.characters[0].existingCharacterId = 'deleted';
    expect(() => confirmMotionComicScriptAssets(first.document, invalid)).toThrow('BINDING');
    invalid.characters[0].existingCharacterId = first.document.characters[0].id; invalid.characters[0].createNew = true;
    expect(() => confirmMotionComicScriptAssets(first.document, invalid)).toThrow('BINDING');
    first.document.characters[0].looks[0].characterId = 'someone-else';
    expect(() => assertMotionComicScriptAssets(first.document, first.script)).toThrow('ASSETS_REQUIRED');
    expect(() => confirmMotionComicScriptAssets(first.document, first.script)).toThrow('ASSETS_REQUIRED');
  });
});
