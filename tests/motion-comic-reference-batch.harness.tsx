// Offline synthetic fixture: no production IPC, credentials, or provider requests.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicReferenceBatch } from '../src/features/motion-comic/MotionComicReferenceBatch';
import { createMotionComicDraft } from '../src/shared/motion-comic';
import type { DirectorBatchRecord } from '../src/shared/director-batch-persistence';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles/tokens.css';

const doc = createMotionComicDraft({ id: 'offline-batch', title: '离线模拟项目', premise: '' });
doc.characters = [{ id: 'person', name: '模拟人物', role: '', identityPrompt: '测试', personality: '', voiceNotes: '', looks: ['缺图造型', '已有候选造型'].map((label, index) => ({ id: `look-${index}`, characterId: 'person', label, appearancePrompt: '测试', wardrobe: '', continuityNotes: '', pinned: index === 0, referenceAssetVersionIds: index ? ['candidate'] : [] })) }];
const batch = { id: 'offline-unknown', workflowKind: 'director', projectId: doc.id, episodeId: null, status: 'paused', concurrency: 1, pauseRequested: false, cancelRequested: false, recoveryRequired: true, recoveryReason: '离线模拟：结果未知', plan: { purpose: 'reference-generation', shots: [], scope: 'missing', capabilities: { image: true, video: false, voice: false, render: false }, outputReady: false, renderFailed: false }, nodes: [{ id: 'unknown-node', title: '模拟未知请求', capability: 'image', status: 'failed', estimatedCost: 0, dependencies: [], reference: { target: { kind: 'look', id: 'look-0' }, submissionState: 'unknown', applyState: 'pending', inputSnapshot: { id: 'offline-request', prompt: 'offline', ratio: '16:9', style: 'cinematic', referenceImagePaths: [] }, inputFingerprint: 'offline-input', configurationFingerprint: 'offline-config', referenceFiles: [], requestId: 'offline-request', attempt: 1, provider: { profileId: 'offline', connected: false, provider: 'mock', supportsReferenceImages: false, maxReferenceImages: 0, label: '离线测试', model: 'offline', resolution: '1K', quality: 'medium' } } }], createdAt: '', updatedAt: '' } as DirectorBatchRecord;
const calls: Array<{ method: string; value?: unknown }> = [];
let finishSave: (() => void) | undefined;
let failSubmit = false;
Object.assign(window, { batchQA: { calls, finishSave: () => finishSave?.(), failSubmit: () => { failSubmit = true; } } });
const api = { listDirectorBatches: async () => { calls.push({ method: 'list' }); return [batch]; }, getDirectorBatch: async () => batch } as unknown as StoryDreamApi;
function Fixture() {
  const [disabled, setDisabled] = useState(false);
  return <StoryDreamProvider theme="dark"><main style={{ padding: 24, maxWidth: 1000, margin: 'auto', color: 'var(--shell-text)' }}>
    <h1>参考图批量 · OFFLINE FAKE DATA</h1><p>真实组件、模拟数据与回调；无真实生成、无付费 API。</p>
    <label><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />模拟模型离线</label>
    <MotionComicReferenceBatch api={api} document={doc} category="characters" disabled={disabled}
      onPrepare={() => { calls.push({ method: 'prepare' }); return new Promise((resolve) => { finishSave = () => resolve({ ...doc, updatedAt: 'saved-offline' }); }); }}
      onRefresh={async () => { calls.push({ method: 'refresh' }); }}
      onSubmit={async (saved, targets) => { if (failSubmit) throw new Error('__STORYDREAM_SAFE_APP_ERROR_V1__:' + encodeURIComponent(JSON.stringify({ code: 'IPC_HANDLER_FAILED', message: '参考图任务提交失败，请重试。', retryable: true, diagnosticId: 'offline-diagnostic' }))); calls.push({ method: 'submit', value: { updatedAt: saved.updatedAt, targets } }); return { ...batch, id: 'offline-submitted' }; }}
      onControl={async (id, action) => { calls.push({ method: 'control', value: { id, action } }); return batch; }} />
  </main></StoryDreamProvider>;
}
document.body.style.margin = '0';
document.body.style.background = 'var(--shell-bg)';
createRoot(document.getElementById('root')!).render(<Fixture />);
