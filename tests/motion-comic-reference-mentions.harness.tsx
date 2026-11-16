// OFFLINE: real Readiness + shared references/token/request compiler. No IPC or provider.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider, TextAreaField, Button } from '../src/ui';
import { MotionComicVideoReadiness } from '../src/features/motion-comic/MotionComicVideoReadiness';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { motionComicVideoReferences, buildMotionComicShotVideoRequest } from '../src/shared/motion-comic-video';
import { motionComicReferenceToken } from '../src/shared/motion-comic-reference-compiler';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';
const now = '2026-10-21T00:00:00.000Z';
function fixture() {
  const doc = createMotionComicStarterProject(createMotionComicDraft({ id: 'reference-mentions-ui', title: '引用测试', premise: '雨夜', now }));
  const shot = doc.episodes[0].scenes[0].shots[0];
  doc.characters = ['a', 'b'].map(id => ({ id: `character-${id}`, name: '同名人物', role: '', identityPrompt: '', personality: '', voiceNotes: '', looks: [{ id: `look-${id}`, characterId: `character-${id}`, label: '雨衣', appearancePrompt: '', wardrobe: '', continuityNotes: '', referenceAssetVersionIds: [`look-${id}-v1`], pinned: true }] }));
  doc.sceneAssets = [{ id: 'scene-station', label: '雨夜车站', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: ['scene-v1'] }];
  doc.props = [{ id: 'prop-letter', label: '旧信封', description: '', prompt: '', referenceAssetVersionIds: ['prop-v1'] }];
  doc.assets = ['opening-v1', 'look-a-v1', 'look-b-v1', 'scene-v1', 'prop-v1', 'ending-v1'].map(id => ({ id, assetId: id, kind: 'image' as const, localPath: `fixture/${id}.png`, selected: true, pinned: true, createdAt: now }));
  Object.assign(shot, { renderStrategy: 'remote-video', firstFrameAssetVersionId: 'opening-v1', lastFrameAssetVersionId: 'ending-v1', characterLookIds: ['look-a', 'look-b'], sceneAssetId: 'scene-station', propAssetIds: ['prop-letter'], prompt: '雨中相遇。', motionPrompt: '缓慢推进。', dialogueCueIds: [], videoProduction: { version: 1, referenceMode: 'references', audioMode: 'post-mix' } });
  return doc;
}
const counts = { insert: 0 };
function Fixture() {
  const [doc, setDoc] = useState(fixture);
  const [busy, setBusy] = useState(false);
  const shot = doc.episodes[0].scenes[0].shots[0];
  const references = shot.videoProduction?.referenceMode === 'references' ? motionComicVideoReferences(doc, shot).map(reference => {
    const kind = reference.kind === 'character' ? 'look' : reference.kind === 'scene' ? 'scene' : reference.kind === 'object' ? 'prop' : undefined;
    return { ...reference, ...(kind ? { token: motionComicReferenceToken(kind, reference.ownerId) } : {}) };
  }) : [];
  let compiled = '', error = '';
  try { compiled = buildMotionComicShotVideoRequest(doc, shot).prompt; } catch (e) { error = String(e); }
  Object.assign(window, { referenceFixture: { doc, references, counts, compiled, error } });
  function update(patch: Partial<typeof shot>) { setDoc(current => { const next = structuredClone(current); Object.assign(next.episodes[0].scenes[0].shots[0], patch); return next; }); }
  return <StoryDreamProvider theme="dark"><main style={{ maxWidth: 900, padding: 24, margin: 'auto' }}>
    <h1>参考图引用 · 离线验收</h1><p>真实 Readiness 与请求编译；仅本地测试数据，不调用生成服务。</p>
    <Button onClick={() => setBusy(!busy)}>切换忙碌状态</Button>
    <TextAreaField label="运动提示词" value={shot.motionPrompt} onChange={(_, data) => update({ motionPrompt: data.value })} />
    <MotionComicVideoReadiness shot={{ id: shot.id, index: 1, title: '雨夜相遇', scene: '车站', durationMs: shot.durationMs, framing: '', characterLabel: '同名人物', prompt: shot.prompt, motionPrompt: shot.motionPrompt, subtitle: '', renderStrategy: 'living-poster', videoInputReady: true }} connected={false} providerLabel="本地 fixture" providerModel="无模型" providerOptions={[]} busy={busy} onStrategyChange={() => {}} providerCapabilities={['reference-image']} production={shot.videoProduction} submittedReferences={references}
      onInsertReference={token => { counts.insert++; update({ motionPrompt: `${shot.motionPrompt.trimEnd()}${shot.motionPrompt.trim() ? ' ' : ''}${token} ` }); }}
      onProductionChange={patch => update({ videoProduction: { ...shot.videoProduction!, ...patch } })} />
    <details><summary>本地编译结果</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} aria-label="编译结果">{error || compiled}</pre></details>
  </main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
