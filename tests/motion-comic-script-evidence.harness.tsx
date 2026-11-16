import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicScriptReview } from '../src/features/motion-comic/MotionComicScriptReview';
import { createMotionComicDraft } from '../src/shared/motion-comic';
import { motionComicScriptDraftSchema, type MotionComicPlanRecovery } from '../src/shared/motion-comic-planning';
import '../src/styles.css';
const mode = new URLSearchParams(location.search).get('state');
const project = createMotionComicDraft({ id: 'offline-evidence', title: '离线证据验收', premise: '来信', now: '2026-11-12T00:00:00Z' });
project.sceneAssets = [{ id: 'room', label: '门厅', description: '门厅', prompt: '木门', continuityNotes: '左光', referenceAssetVersionIds: mode === 'image' || mode === 'unsafe' ? ['reference'] : [] }];
project.assets = [{ id: 'reference', kind: 'image', localPath: 'private-fixture-image', createdAt: '2026-11-12T00:00:00Z' }] as typeof project.assets;
const original = motionComicScriptDraftSchema.parse({ title: '雨夜来信', logline: '她收到来信', characters: [], sceneAssets: [{ key: 'room', existingSceneAssetId: mode === 'ambiguous' ? 'deleted-room' : 'room', label: '门厅', description: '门厅', prompt: '木门', continuityNotes: '左光' }], props: [], scenes: [{ key: 'scene', title: '来信', actIndex: 1, actTitle: '来信', actBoundaryReason: '收到信', summary: '她收到来信', locationKey: 'room', beats: [{ key: 'beat-private-uuid', kind: 'action', text: '她打开了信。', sourceUnitIds: ['S2'] }, { key: 'beat-2', kind: 'narration', text: '雨还在下。', sourceUnitIds: [mode === 'missing' ? 'unknown-private-id' : 'S1'] }] }] });
const resolveReferenceUrl = async () => mode === 'unsafe' ? 'file:///private-fixture-image' : URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#435c62"/></svg>'], { type: 'image/svg+xml' }));
function Fixture() {
 const [script, setScript] = useState(original), [reviewed, setReviewed] = useState(false), [assetsOpen, setAssetsOpen] = useState(false);
 const recovery: MotionComicPlanRecovery = { token: '00000000-0000-4000-8000-000000000000', projectId: project.id, sourceText: '雨落在屋檐。\n她打开了信。\n最后一段全文核对。', instructions: '', title: script.title, scenes: 1, createdAt: '2026-11-12T00:00:00Z', script, needsValidation: mode === 'validation' || script !== original, adjustments: [] };
 return <StoryDreamProvider theme="dark"><main style={{ padding: 24, height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}><MotionComicScriptReview recovery={recovery} episodeNumber={1} locked={mode === 'locked'} reviewed={reviewed} onReviewed={setReviewed} onChange={setScript} savedScript={original} originalScript={original} savedRevision={2} originalRevision={1} project={project} resolveReferenceUrl={resolveReferenceUrl} onOpenProjectAssets={() => setAssetsOpen(true)} proposalPanel={<div>保留提案区域</div>} />{assetsOpen ? <p>已打开项目资产入口</p> : null}</main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
