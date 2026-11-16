import { describe, expect, it } from 'vitest';
import { findCharacterTimbreReference } from '@shared/character-timbre-reference';
import { createMotionComicDraft, createMotionComicStarterProject } from '@shared/motion-comic';
import { buildMotionComicShotVideoRequest, motionComicVideoInputFingerprintSource, motionComicVideoInputHash, motionComicVideoPrompt } from '@shared/motion-comic-video';

const characters = ['阿青', '阿青姐姐', 'Alice', 'A+B', '阿青'].map(name => ({ name }));
const now = '2026-09-18T00:00:00.000Z';
const unsupported = 'DIRECTOR_VIDEO_CHARACTER_TIMBRE_UNSUPPORTED: 当前服务尚未支持角色音色样本引用；请移除#角色名标记，角色样本仍可保存与试听';

function fixture() {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'timbre-test', title: '引用测试', premise: '雨夜对白', now }), '第一集', now);
  const episode = document.episodes[0];
  const shot = episode.scenes[0].shots[0];
  document.characters[0].name = '阿青';
  shot.renderStrategy = 'remote-video';
  shot.firstFrameAssetVersionId = 'frame';
  shot.prompt = '两人在雨夜相遇';
  shot.motionPrompt = '缓缓推近';
  document.assets.push({ id: 'frame', assetId: 'frame', kind: 'image', localPath: 'C:/managed/frame.png', createdAt: now });
  return { document, episode, shot };
}

const builders = {
  prompt: motionComicVideoPrompt,
  request: buildMotionComicShotVideoRequest,
  fingerprint: (document: ReturnType<typeof fixture>['document'], shot: ReturnType<typeof fixture>['shot']) => motionComicVideoInputFingerprintSource(document, shot, 'test', 'test'),
  hash: (document: ReturnType<typeof fixture>['document'], shot: ReturnType<typeof fixture>['shot']) => motionComicVideoInputHash(document, shot, 'test', 'test'),
};

describe('known character timbre reference syntax', () => {
  it.each([
    ['#阿青', '阿青'], ['#阿青音色：你好！', '阿青'], ['#阿青：你好！', '阿青'],
    ['使用 #阿青姐姐音色，轻声说话', '阿青姐姐'], ['#阿青姐姐', '阿青姐姐'],
    ['“#阿青：你好”', '阿青'], ['"#Alice"', 'Alice'], ['(#A+B)', 'A+B'],
  ])('recognizes %s', (text, name) => {
    expect(findCharacterTimbreReference(text, characters)).toBe(name);
  });

  it.each([
    '#01', '# 标题', '# 阿青', '## 阿青', '##阿青', '#hashtag', '#陌生人', '#阿青姐姐们',
    '#Alice2', '#Alice_name', '#Aliceé', '#Alice\u0301', '词#阿青', 'word#Alice', '#阿青音色描述',
    '`#阿青`', '``#阿青音色``', '```text\n#阿青\n```', '\\#阿青', '标牌写着“#hashtag”',
  ])('preserves literal or unrelated text %s', text => {
    expect(findCharacterTimbreReference(text, characters)).toBeUndefined();
  });

  it('still finds a reference after literal code', () => {
    expect(findCharacterTimbreReference('`#阿青` 使用 #阿青姐姐音色', characters)).toBe('阿青姐姐');
  });
});

describe('pure motion comic builders reject unsupported timbre references', () => {
  for (const [name, build] of Object.entries(builders)) {
    it.each(['prompt', 'motionPrompt'] as const)(`${name} rejects references in %s with or without a saved sample`, field => {
      const { document, shot } = fixture();
      shot[field] = '#阿青音色：你好';
      const before = structuredClone(document);
      expect(() => build(document, shot)).toThrow(unsupported);
      expect(document).toEqual(before);
      document.characters[0].voiceSampleAssetVersionId = 'sample';
      document.assets.push({ id: 'sample', assetId: 'character-voice-sample:test', kind: 'audio', localPath: 'C:/managed/sample.wav', createdAt: now });
      expect(() => build(document, shot)).toThrow(unsupported);
      expect(document.providerJobs).toHaveLength(0);
    });
  }

  it('does not scan scene metadata or dialogue text and never implicitly sends a saved sample', () => {
    const { document, episode, shot } = fixture();
    shot.videoProduction = { version: 1, referenceMode: 'frames', audioMode: 'native' };
    const scene = document.sceneAssets.find(scene => scene.id === shot.sceneAssetId)!;
    scene.prompt = '#阿青：墙上文字';
    const cue = episode.dialogueCues.find(cue => shot.dialogueCueIds.includes(cue.id))!;
    cue.text = '#阿青：对白中的文字';
    document.characters[0].voiceSampleAssetVersionId = 'sample';
    document.assets.push({ id: 'sample', assetId: 'character-voice-sample:test', kind: 'audio', localPath: 'C:/managed/sample.wav', createdAt: now });
    const request = buildMotionComicShotVideoRequest(document, shot);
    expect(request.prompt).toContain(scene.prompt);
    expect(request.prompt).toContain(cue.text);
    expect(request.referenceAudioPaths).toBeUndefined();
    const fingerprint = motionComicVideoInputFingerprintSource(document, shot, 'test', 'test');
    expect(fingerprint.referenceAudio).toEqual([]);
    expect(JSON.stringify(fingerprint)).not.toContain('sample.wav');
  });

  it.each(['character-voice-sample:test', 'imported-audio'])('rejects explicit sample selection by asset prefix or character link (%s)', assetId => {
    const { document, shot } = fixture();
    shot.videoProduction = { version: 1, referenceMode: 'references', audioMode: 'audio-driven', referenceAudioAssetVersionIds: ['sample'] };
    shot.characterLookIds = [];
    shot.sceneAssetId = '';
    shot.propAssetIds = [];
    if (assetId === 'imported-audio') document.characters[0].voiceSampleAssetVersionId = 'sample';
    document.assets.push({ id: 'sample', assetId, kind: 'audio', localPath: 'C:/managed/sample.wav', createdAt: now });
    expect(() => buildMotionComicShotVideoRequest(document, shot)).toThrow('DIRECTOR_VIDEO_VOICE_SAMPLE_UNSUPPORTED');
    expect(() => motionComicVideoInputFingerprintSource(document, shot, 'test', 'test')).toThrow('DIRECTOR_VIDEO_VOICE_SAMPLE_UNSUPPORTED');
    expect(document.providerJobs).toHaveLength(0);
  });

  it('retains ordinary hashes verbatim in requests and fingerprints', () => {
    const { document, shot } = fixture();
    shot.prompt = '#01 # 标题 # 阿青 #hashtag `#阿青` \\#阿青';
    const request = buildMotionComicShotVideoRequest(document, shot);
    expect(request.prompt).toContain(shot.prompt);
    expect(motionComicVideoInputFingerprintSource(document, shot, 'test', 'test').prompt).toBe(request.prompt);
  });
});
