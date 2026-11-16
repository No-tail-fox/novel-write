import { describe, expect, it, vi } from 'vitest';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { defaultConfig } from '../src/shared/config';
import { compileMotionComicReferenceMentions, motionComicReferenceToken } from '../src/shared/motion-comic-reference-compiler';
import { buildMotionComicShotVideoRequest, motionComicVideoInputHash, motionComicVideoReferences, selectMotionComicVideoRoute } from '../src/shared/motion-comic-video';

function fixture() {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'mentions', title: '引用', premise: '雨夜', now: '2026-10-21T00:00:00Z' }));
  const shot = document.episodes[0].scenes[0].shots[0];
  const character = document.characters[0]; character.name = '林小雨';
  const look = character.looks[0];
  const scene = document.sceneAssets[0]; scene.label = '车站';
  const prop = document.props[0]; prop.label = '信封';
  shot.characterLookIds = [look.id]; shot.sceneAssetId = scene.id; shot.propAssetIds = [prop.id];
  shot.renderStrategy = 'remote-video'; shot.videoProduction = { version: 1, referenceMode: 'references', audioMode: 'post-mix' };
  shot.prompt = '@林小雨在@车站拿起@信封。'; shot.motionPrompt = '@林小雨轻声说';
  shot.firstFrameAssetVersionId = 'opening'; shot.lastFrameAssetVersionId = 'ending';
  for (const id of ['opening', 'ending']) document.assets.push({ id, assetId: id, kind: 'image', localPath: `C:/${id}.png`, createdAt: document.updatedAt });
  for (const owner of [look, scene, prop]) {
    const id = `fixed-${owner.id}`; owner.referenceAssetVersionIds = [id];
    document.assets.push({ id, assetId: id, kind: 'image', localPath: `C:/${id}.png`, selected: true, pinned: true, createdAt: document.updatedAt });
  }
  const compile = (prompt = shot.prompt, references = motionComicVideoReferences(document, shot)) => compileMotionComicReferenceMentions({ document, shot, references, prompt, motionPrompt: shot.motionPrompt });
  return { document, shot, character, look, scene, prop, compile };
}

describe('authored reference mention compiler', () => {
  it('uses submitted order including opening and ending without mutating stored prose or binding', () => {
    const { document, shot, compile } = fixture(); const before = JSON.stringify(document);
    const result = compile();
    expect(result.prompt).toMatch(/林小雨.*参考图2.*车站（参考图3）.*信封（参考图4）/u);
    expect(result.motionPrompt).toMatch(/参考图2）轻声说/u);
    expect(result.resolved.map(r => r.referenceNumber)).toEqual([2, 3, 4]);
    expect(buildMotionComicShotVideoRequest(document, shot).prompt).toContain(result.prompt);
    expect(JSON.stringify(document)).toBe(before);
    expect(result.prompt).not.toMatch(/C:\/|fixed-|@\{/u);
  });
  it('uses the exact passed image order and deduplicates repeated mentions only', () => {
    const { compile, document, shot } = fixture();
    const refs = motionComicVideoReferences(document, shot).reverse();
    const result = compile('@林小雨、@林小雨', refs);
    expect(result.prompt.match(/参考图4/gu)).toHaveLength(2);
    expect(result.resolved).toHaveLength(1);
  });
  it.each(['character', 'scene', 'prop'] as const)('rejects known unbound %s', kind => {
    const f = fixture(); f.shot.motionPrompt = '';
    if (kind === 'character') f.shot.characterLookIds = [];
    if (kind === 'scene') f.shot.sceneAssetId = '';
    if (kind === 'prop') f.shot.propAssetIds = [];
    expect(() => f.compile(kind === 'character' ? '@林小雨' : kind === 'scene' ? '@车站' : '@信封')).toThrow('UNBOUND');
  });
  it('rejects global duplicate names even if only one is bound, and typed token disambiguates', () => {
    const f = fixture(); f.document.characters.push({ ...structuredClone(f.character), id: 'other', looks: [], name: '林小雨' });
    expect(() => f.compile()).toThrow('AMBIGUOUS');
    f.shot.motionPrompt = '';
    expect(f.compile(motionComicReferenceToken('look', f.look.id)).prompt).toContain('参考图2');
    f.scene.label = '信封'; expect(() => f.compile('@信封')).toThrow('AMBIGUOUS');
  });
  it('requires an explicit look when a character has several bound looks', () => {
    const f = fixture(); const second = { ...structuredClone(f.look), id: 'look-two', label: '晚装' };
    f.character.looks.push(second); f.shot.characterLookIds.push(second.id);
    expect(() => f.compile()).toThrow('AMBIGUOUS');
    f.shot.motionPrompt = '';
    expect(f.compile(motionComicReferenceToken('look', second.id)).prompt).toContain('晚装（参考图3）');
  });
  it('rejects missing fixed images both in the real builder and supplied reference set', () => {
    const f = fixture(); const refs = motionComicVideoReferences(f.document, f.shot).filter(r => r.ownerId !== f.look.id);
    expect(() => f.compile('@林小雨', refs)).toThrow('REFERENCE_MISSING');
    f.document.assets.find(a => a.id === f.look.referenceAssetVersionIds[0])!.pinned = false;
    expect(() => buildMotionComicShotVideoRequest(f.document, f.shot)).toThrow('固定参考');
  });
  it('rejects references in frames mode, while ordinary prose remains valid', () => {
    const f = fixture(); f.shot.videoProduction!.referenceMode = 'frames';
    expect(() => buildMotionComicShotVideoRequest(f.document, f.shot)).toThrow('多参考模式');
    f.shot.prompt = '普通动作'; f.shot.motionPrompt = '@unknown';
    expect(buildMotionComicShotVideoRequest(f.document, f.shot).referenceImages).toBeUndefined();
  });
  it('matches longest names, punctuation and adjacent Chinese action without replacing unknown markers', () => {
    const f = fixture(); f.document.characters.push({ ...structuredClone(f.character), id: 'short', name: '林', looks: [] });
    const result = f.compile('（@林小雨），@车站。@信封！ @不存在 @unknown');
    expect(result.prompt).toContain('参考图2）），车站（参考图3）。信封（参考图4）！ @不存在 @unknown');
    f.character.name = 'Ann'; f.shot.motionPrompt = '';
    expect(f.compile('@Anna @Ann').prompt).toMatch(/^@Anna Ann.*参考图2/u);
  });
  it.each([
    'mail@林小雨.com user@车站.cn @unknown',
    '`@林小雨 @{bad:id}`', '``@林小雨 ` @{bad:id}``',
    '```ts\n@林小雨 @{bad:id}\n```', '~~~\n@林小雨 @{bad:id}\n~~~',
    '\\@林小雨 \\@{bad:id}', '```\n@林小雨 @{bad:id}', '    @林小雨 @{bad:id}', '```ts\nline one\n@{bad:id}\n@林小雨\n```',
  ])('preserves emails, unknown marks, code and escapes: %s', prompt => {
    const f = fixture(); f.shot.motionPrompt = ''; f.shot.videoProduction!.referenceMode = 'frames';
    expect(f.compile(prompt, []).prompt).toBe(prompt);
  });
  it.each(['@{bad:id}', '@{look:missing}', '@{scene:missing}', '@{prop:missing}', '@{look:%ZZ}', '@{look:}', '@{look:missing'])('rejects explicit unknown or malformed tokens: %s', token => {
    const f = fixture(); expect(() => f.compile(token)).toThrow('DIRECTOR_VIDEO_MENTION_');
  });
  it('round trips encoded IDs and does not expose IDs in generated text', () => {
    const f = fixture(); const oldId = f.prop.id; f.prop.id = 'prop:with } 空格/@'; f.shot.propAssetIds = [f.prop.id];
    f.shot.motionPrompt = ''; const token = motionComicReferenceToken('prop', f.prop.id);
    expect(token).toContain('%7D'); expect(f.compile(token).prompt).toBe('信封（参考图4）');
    expect(f.compile(token).resolved[0].ownerId).not.toBe(oldId);
  });
  it('does not scan generated scene or dialogue fields', () => {
    const f = fixture(); f.shot.prompt = '普通动作'; f.shot.motionPrompt = '平移'; f.scene.prompt = '@{bad:id}';
    const cue = f.document.episodes[0].dialogueCues.find(c => f.shot.dialogueCueIds.includes(c.id));
    if (cue) cue.text = '@{bad:id}'; f.shot.videoProduction!.audioMode = 'native';
    expect(buildMotionComicShotVideoRequest(f.document, f.shot).prompt).toContain('@{bad:id}');
  });
  it('fingerprints resolved binding identity, reference order and fixed asset version', () => {
    const f = fixture(); const hash = () => motionComicVideoInputHash(f.document, f.shot, 'p', 'm'); const baseline = hash();
    const second = { ...structuredClone(f.look), id: 'replacement-look' }; f.character.looks.push(second); f.shot.characterLookIds = [second.id];
    expect(hash()).not.toBe(baseline); const bound = hash();
    delete f.shot.firstFrameAssetVersionId; expect(hash()).not.toBe(bound); const reordered = hash();
    const asset = { ...f.document.assets.find(a => a.id === second.referenceAssetVersionIds[0])!, id: 'replacement-version' };
    f.document.assets.push(asset); second.referenceAssetVersionIds = [asset.id]; expect(hash()).not.toBe(reordered);
  });
  it('runs real model routing and request builder entirely offline', () => {
    const f = fixture(); const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Network forbidden'); });
    try {
      const config = structuredClone(defaultConfig); const provider = { ...config.video.providers[0], enabled: true, apiKey: 'offline', baseUrl: 'https://video.invalid', model: 'seedance-2.0', modelPreset: 'seedance-2.0' as const, capabilities: ['reference-image' as const], maxDurationSec: 15 };
      config.video.providers = [provider]; config.video.activeProviderId = provider.id; config.video.automation.providerWhitelist = [provider.id];
      const result = selectMotionComicVideoRoute(config, f.document, f.shot, 100);
      expect(result.route.kind).toBe('provider'); expect(result.request.prompt).toContain('参考图2'); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
