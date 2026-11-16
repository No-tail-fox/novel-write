// Offline real-component fixture. No production data, IPC, authorization or provider calls.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionComicAssetGallery, type MotionComicAssetGalleryProps } from '../src/features/motion-comic/MotionComicAssetGallery';
import { createMotionComicDraft } from '../src/shared/motion-comic';
import '../src/styles/tokens.css';

const doc = createMotionComicDraft({ id: 'gallery-fixture', title: '离线测试', premise: 'UI fixture' });
const sample = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#29424b"/><text x="300" y="210" fill="white" font-size="28" text-anchor="middle">OFFLINE IMAGE FIXTURE</text></svg>');
doc.characters = ['林晚', '顾言', '陈叔', '苏晴', '无参考角色'].map((name, i) => ({ id: `person-${i}`, name, role: '', identityPrompt: '', personality: '', voiceNotes: '', looks: [{ id: `look-${i}`, characterId: `person-${i}`, label: '日常', wardrobe: '', appearancePrompt: '', continuityNotes: '', pinned: true, referenceAssetVersionIds: i < 4 ? [`ref-${i}`] : [] }, ...(i === 0 ? [{ id: 'extra-look', characterId: 'person-0', label: '晚装', wardrobe: '', appearancePrompt: '', continuityNotes: '', pinned: false, referenceAssetVersionIds: [] }] : [])] }));
doc.assets = [0, 1, 2, 3].map(i => ({ id: `ref-${i}`, assetId: `look-${i}`, kind: 'image', localPath: i === 2 ? 'missing-fixture.png' : sample, pinned: true, selected: true, createdAt: '' }));
doc.sceneAssets = [{ id: 'street', label: '雨夜街道', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: [] }];
doc.props = [];
function Fixture() {
  const [category, setCategory] = useState<MotionComicAssetGalleryProps['category']>('characters');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<string[]>([]);
  return <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24, color: 'var(--shell-text)', fontFamily: 'sans-serif' }}>
    <h1>资产总览 · 离线组件验收</h1><p>测试数据及色块仅用于组件验收，不代表真实生成素材。</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
      <button onClick={() => setCategory('characters')}>人物</button><button onClick={() => setCategory('scenes')}>场景</button><button onClick={() => setCategory('props')}>道具</button>
      <input aria-label="搜索资产" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <MotionComicAssetGallery document={doc} category={category} query={query} onOpen={id => setOpened(current => [...current, id])} onAdd={() => setOpened(current => [...current, 'add'])} />
    <output aria-label="打开记录">{opened.join(',')}</output>
  </main>;
}
document.body.style.margin = '0';
document.body.style.background = 'var(--shell-bg)';
createRoot(document.getElementById('root')!).render(<Fixture />);
