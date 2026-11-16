import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider, Button, TextAreaField } from '../src/ui';
import { MotionComicReferenceBoard } from '../src/features/motion-comic/MotionComicReferenceBoard';
import { MotionComicGenerationReferences } from '../src/features/motion-comic/MotionComicGenerationReferences';
import type { ProductionAssetVersion } from '../src/shared/production-workflow';
import '../src/styles/tokens.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';
import '../src/features/motion-comic/MotionComicReferenceEditor.css';
const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320;
const context = canvas.getContext('2d')!; context.fillStyle = '#51455f'; context.fillRect(0, 0, 240, 320); context.fillStyle = '#ead6c4'; context.fillRect(80, 55, 80, 220);
const image = canvas.toDataURL();
function Fixture() {
  const [versions, setVersions] = useState<ProductionAssetVersion[]>([]);
  const [paths, setPaths] = useState([image]);
  const [job, setJob] = useState(false);
  const [look, setLook] = useState('日常');
  return <StoryDreamProvider theme="dark"><main className="motion-comic-page" style={{ padding: 24, maxWidth: 1100, margin: 'auto' }}>
    <div className="comic-look-tabs" role="tablist" aria-label="角色造型">{['日常', '战斗'].map(name => <Button key={name} role="tab" aria-selected={look === name} className={`comic-look-tab${look === name ? ' is-active' : ''}`} onClick={() => setLook(name)}>{name}{look === name ? <small>当前造型</small> : null}</Button>)}</div>
    <h2>{look}造型</h2>
    <MotionComicReferenceBoard label="角色" versions={versions} slots={versions.filter(v => v.pinned).map(v => ({ versionId: v.id, role: v.referenceRole! }))} pending={[]} importing={0} busy={false} active job={job ? { label: '正在生成三视图', progress: .3 } : null} feedback={null} maxImages={6} composeMultiple={false} suggestedRoles={['front', 'side', 'back']} hideImport onImport={() => undefined} onComposeChange={() => undefined} onSetRole={(id, role) => setVersions(vs => vs.map(v => v.id === id ? { ...v, pinned: true, referenceRole: role } : v))} onUnpin={id => setVersions(vs => vs.map(v => v.id === id ? { ...v, pinned: false } : v))} onRemove={id => setVersions(vs => vs.filter(v => v.id !== id))} onDiscard={() => undefined} onImageStatus={() => undefined} />
    <TextAreaField label="生图提示词" defaultValue="少年，红色外衣，完整全身三视图" />
    <MotionComicGenerationReferences paths={paths} maxImages={6} onImport={async () => setPaths([image])} onRemove={path => setPaths(ps => ps.filter(p => p !== path))} onLibrary={() => undefined} />
    <Button onClick={() => setJob(v => !v)}>模拟生成状态</Button>
    <Button onClick={() => setVersions(['front', 'side', 'back'].map((role, i) => ({ id: role, assetId: 'look', kind: 'image', referenceRole: role as 'front' | 'side' | 'back', localPath: image, createdAt: '2026-11-13T10:00:00Z' })))}>显示候选</Button>
  </main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
