// Offline browser fixture: real component, mock callbacks only.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicAssetExtraction } from '../src/features/motion-comic/MotionComicAssetExtraction';
import { createMotionComicDraft } from '../src/shared/motion-comic';
import type { MotionComicScriptSnapshot } from '../src/shared/motion-comic-script-batch';
import type { MotionComicAssetExtractionCandidate } from '../src/shared/motion-comic-asset-extraction';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles/tokens.css';
const doc = createMotionComicDraft({ id: 'extraction-offline', title: '离线候选验收', premise: '' });
doc.sourceDocument = { kind: 'novel', adaptationMode: 'novel-adaptation', originalText: '原文', importedAt: '', episodes: [{ id: 'ep1', number: 1, title: '城门初见', sourceText: '阿青身穿蓝衣，在城门拾起铜钥匙。' }, { id: 'ep2', number: 2, title: '夜访书院', sourceText: '阿青换上夜行衣进入书院。' }] };
doc.characters = [{ id: 'existing-a', name: '阿青', aliases: ['青衣'], role: '主角', identityPrompt: '已有定义不可覆盖', personality: '谨慎', voiceNotes: '低声', looks: [] }];
const character = { key: 'a', name: '阿青', aliases: ['青衣'], role: '主角', identityPrompt: '身形清瘦的年轻旅人', personality: '敏锐', voiceNotes: '轻柔', looks: [{ key: 'blue', label: '蓝衣造型', appearancePrompt: '长发束起，蓝色短衫', wardrobe: '蓝色短衫、布靴', continuityNotes: '袖口磨损' }] };
const base = { projectId: doc.id, sourceEpisodeId: 'ep2', requestFingerprint: 'request-fp', inputFingerprint: 'input-fp', sourceFingerprint: 'source-fp', projectFingerprint: 'project-fp', revision: 1, status: 'ready', dispatchState: 'settled', provider: 'mock', model: 'offline', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as const;
let records: MotionComicAssetExtractionCandidate[] = [{ ...base, id: 'prop-only', requestId: 'prop-request', category: 'props', output: { props: [{ key: 'p', label: '不应出现在人物列表的铜钥匙', description: '铜制', prompt: '古铜色' }] } }];
function snapshot(): MotionComicScriptSnapshot { return { projectId: doc.id, paused: false, tasks: [], candidates: [], approvals: [], storyboards: [], assetExtractions: records }; }
const calls: Array<{ method: string; input?: unknown }> = [];
let finish: (() => void) | undefined; let fail: (() => void) | undefined; let unknown = false; let rejectApply = true; let applyStatus: 'applied' | 'stale' = 'applied';
Object.assign(window, { extractionQA: { calls, finishSave: () => finish?.(), failSave: () => fail?.(), unknown: () => { unknown = true; }, staleApply: () => { rejectApply = false; applyStatus = 'stale'; } } });
const api = { getMotionComicScripts: async () => { calls.push({ method: 'read' }); return snapshot(); } } as unknown as StoryDreamApi;
function Fixture() {
  const [category, setCategory] = useState<'characters' | 'scenes' | 'props'>('characters');
  const [other, setOther] = useState(false);
  return <StoryDreamProvider theme="dark"><main style={{ padding: 24, color: 'var(--shell-text)' }}>
    <h1>资产工作区 · OFFLINE MOCK ONLY</h1><p>真实 React 组件，模拟来源与回调，不调用模型。</p>
    <button onClick={() => setOther(!other)}>切换项目</button><button onClick={() => setCategory('characters')}>人物分类</button><button onClick={() => setCategory('props')}>道具分类</button>
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 240px', gap: 24, marginTop: 24 }}><aside>项目导航<br />原文 / 分集 / 场次 / 资产 / 分镜</aside><section><header style={{ display: 'flex', justifyContent: 'space-between' }}><h2>资产</h2>
      <MotionComicAssetExtraction document={other ? { ...doc, id: 'other-project' } : doc} category={category} api={api}
        onPrepare={() => { calls.push({ method: 'prepare' }); return new Promise((resolve, reject) => { finish = () => resolve({ ...doc, updatedAt: '2026-01-02T00:00:00Z' }); fail = () => reject(new Error('模拟保存失败')); }); }}
        onRefresh={async () => { calls.push({ method: 'refresh' }); }}
        onPropose={async (saved, input) => { calls.push({ method: 'propose', input: { ...input, updatedAt: saved.updatedAt } }); if (unknown) throw new Error('模拟响应丢失'); records = [...records, { ...base, id: `candidate-${input.requestId}`, requestId: input.requestId, category: input.category, sourceEpisodeId: input.sourceEpisodeId, output: { characters: [character, { ...character, key: 'b', name: '掌柜', aliases: [] }] } }]; return snapshot(); }}
        onApply={async (saved, input) => { calls.push({ method: 'apply', input: { ...input, updatedAt: saved.updatedAt } }); if (rejectApply) { rejectApply = false; throw Object.assign(new Error('项目忙碌'), { code: 'ASSET_EXTRACTION_PROJECT_BUSY' }); } records = records.map(record => record.id === input.candidateId ? { ...record, status: applyStatus } : record); return snapshot(); }} />
    </header><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>{['阿青', '掌柜', '城门'].map(name => <article key={name} style={{ background: 'var(--shell-panel)', padding: 24, minHeight: 240 }}>{name}<p>已有资产网格</p></article>)}</div></section><aside>资产检查器</aside></div><footer style={{ marginTop: 80 }}>项目状态 · 本地模拟</footer>
  </main></StoryDreamProvider>;
}
document.body.style.margin = '0'; document.body.style.background = 'var(--shell-bg)';
createRoot(document.getElementById('root')!).render(<Fixture />);
