import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MotionComicAssetGallery, type MotionComicAssetGalleryProps } from '../src/features/motion-comic/MotionComicAssetGallery';
import { createMotionComicDraft, type MotionComicPipelineData } from '../src/shared/motion-comic';

function project(): MotionComicPipelineData {
  const document = createMotionComicDraft({ id: 'gallery', title: '测试', premise: '资产总览' });
  document.characters = [{ id: 'person', name: '林晚', aliases: ['小林'], role: '', identityPrompt: '', personality: '', voiceNotes: '', looks: [
    { id: 'day', characterId: 'person', label: '日常', appearancePrompt: '', wardrobe: '', continuityNotes: '', pinned: false, referenceAssetVersionIds: ['old', 'candidate', 'old', 'missing', 'audio'] },
    { id: 'night', characterId: 'person', label: '晚装', appearancePrompt: '', wardrobe: '', continuityNotes: '', pinned: true, referenceAssetVersionIds: ['night-fixed'] },
    { id: 'rain', characterId: 'person', label: '雨衣', appearancePrompt: '', wardrobe: '', continuityNotes: '', pinned: false, referenceAssetVersionIds: [] },
  ] }];
  document.sceneAssets = [{ id: 'street', label: '雨夜街道', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: ['scene-candidate'] }];
  document.props = [{ id: 'umbrella', label: '黑伞', description: '', prompt: '', referenceAssetVersionIds: [] }];
  document.assets = [
    { id: 'old', assetId: 'day', kind: 'image', localPath: 'I:/refs/old.png', pinned: true, selected: true, createdAt: '' },
    { id: 'candidate', assetId: 'day', kind: 'image', localPath: 'I:/refs/candidate.png', pinned: false, selected: false, createdAt: '' },
    { id: 'night-fixed', assetId: 'night', kind: 'image', localPath: 'I:/refs/晚 装.png', pinned: true, selected: true, createdAt: '' },
    { id: 'audio', assetId: 'day', kind: 'audio', localPath: 'I:/refs/voice.wav', createdAt: '' },
    { id: 'scene-candidate', assetId: 'street', kind: 'image', localPath: 'I:/refs/street.png', createdAt: '' },
  ];
  return document;
}

function render(overrides: Partial<MotionComicAssetGalleryProps> = {}) {
  return renderToStaticMarkup(createElement(MotionComicAssetGallery, { document: project(), category: 'characters', query: '', onOpen: vi.fn(), ...overrides }));
}

describe('motion comic asset gallery rendering', () => {
  it('renders actual category assets as keyboard-operable native buttons', () => {
    const html = render();
    expect(html).toContain('aria-label="人物资产"');
    expect(html).toMatch(/<button type="button"[^>]*aria-label="打开林晚详情"/);
    expect(html).not.toContain('雨夜街道');
    expect(html).not.toContain('黑伞');
    expect(render({ category: 'scenes' })).toContain('打开雨夜街道详情');
    expect(render({ category: 'scenes' })).not.toContain('林晚');
    expect(render({ category: 'props' })).toContain('打开黑伞详情');
  });

  it('uses the fixed image of the preferred look, preserves look counts, and counts only real unique image references', () => {
    const html = render();
    expect(html).toContain('3 个造型');
    expect(html).toContain('· 晚装');
    expect(html).toContain('1 个造型缺固定图');
    expect(html).toContain('3 张参考');
    expect(html).toContain('file:///I:/refs/%E6%99%9A%20%E8%A3%85.png');
    expect(html).not.toContain('src="file:///I:/refs/candidate.png"');
  });

  it('never promotes an unfixed candidate to a cover or invents a missing image', () => {
    const html = render({ category: 'scenes' });
    expect(html).toContain('待添加参考');
    expect(html).toContain('1 张参考');
    expect(html).toContain('打开详情添加参考');
    expect(html).not.toContain('<img');
  });

  it('searches names, aliases and every look without altering the document', () => {
    const document = project();
    const before = JSON.stringify(document);
    for (const query of [' 林晚 ', '小林', '雨衣']) expect(render({ document, query })).toContain('打开林晚详情');
    expect(JSON.stringify(document)).toBe(before);
    expect(render({ query: '不存在' })).toContain('没有匹配的人物');
    expect(render({ query: '<script>' })).toContain('&lt;script&gt;');
    expect(render({ query: '不存在', onAdd: vi.fn() })).not.toContain('新增人物');
  });

  it('distinguishes empty categories and offers add only when supplied', () => {
    const document = project();
    document.props = [];
    expect(render({ document, category: 'props' })).toContain('暂无道具资产');
    expect(render({ document, category: 'props' })).not.toContain('<button');
    expect(render({ document, category: 'props', onAdd: vi.fn() })).toContain('新增道具');
  });

  it('handles characters without looks and fixed records without local files honestly', () => {
    const document = project();
    document.characters[0].looks = [];
    expect(render({ document })).toContain('0 个造型');
    expect(render({ document })).toContain('待添加参考');
    document.props[0].referenceAssetVersionIds = ['unavailable'];
    document.assets.push({ id: 'unavailable', assetId: 'umbrella', kind: 'image', pinned: true, selected: true, createdAt: '' });
    const html = render({ document, category: 'props' });
    expect(html).toContain('1 张参考');
    expect(html).toContain('待添加参考');
    expect(html).not.toContain('<img');
  });
});
