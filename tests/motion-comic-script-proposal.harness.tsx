// Offline component interaction fixture. No IPC, provider or real model is imported.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicScriptProposal } from '../src/features/motion-comic/MotionComicScriptProposal';
import type { MotionComicScriptProposal as Proposal } from '../src/shared/motion-comic-script-proposal';
import type { MotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import '../src/styles.css';
const initial: MotionComicScriptDraft = { title: '离线测试', logline: '离线测试', characters: [], sceneAssets: [], props: [], scenes: [{ key: 'scene', title: '房间', actIndex: 1, actTitle: '开端', actBoundaryReason: '测试', summary: '开门', locationKey: 'room', beats: [{ key: 'beat', kind: 'action', text: '开门', sourceUnitIds: ['S1'] }] }] };
const calls: string[] = [];
Object.assign(window, { proposalCalls: calls });
function Fixture() {
  const [script, setScript] = useState(initial);
  const [revision, setRevision] = useState(3);
  const [dirty, setDirty] = useState(false);
  const [fail, setFail] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [resolved, setResolved] = useState(false);
  return <StoryDreamProvider theme="dark"><main style={{ maxWidth: 900, margin: 'auto', padding: 16 }}>
    <button onClick={() => setDirty(!dirty)}>切换未保存状态</button><button onClick={() => setFail(!fail)}>切换失败模拟</button>
    <button onClick={() => setResolved(true)}>模拟服务器已确认失败</button>
    <MotionComicScriptProposal script={script} revision={revision} proposals={proposals} onRefresh={async () => resolved ? [...proposals, { ...proposals[0], id: calls[calls.length - 1], requestId: calls[calls.length - 1], status: 'failed', proposedText: undefined }] : proposals} disabledReason={dirty ? '当前有未保存改稿，请先保存修改并校验。' : ''} onPropose={async input => {
      calls.push(input.requestId);
      await new Promise(resolve => setTimeout(resolve, 350));
      if (fail) throw new Error('离线模拟网络结果未明');
      setProposals(current => [...current, { ...input, id: input.requestId, projectId: 'project', taskId: 'task', baseRevision: revision, inputFingerprint: 'test', originalText: script.scenes[0].beats[0].text, proposedText: '缓缓推开门', status: 'ready', requestFingerprint: 'test', baseProjectUpdatedAt: '2026-01-01T00:00:00Z', baseScriptHash: 'test', promptVersion: 'test', provider: 'offline', model: 'offline', createdAt: '2026-01-01T00:00:00Z' }]);
    }} onAdopt={async proposal => {
      calls.push('adopt'); await new Promise(resolve => setTimeout(resolve, 350));
      setScript({ ...script, scenes: [{ ...script.scenes[0], beats: [{ ...script.scenes[0].beats[0], text: proposal.proposedText! }] }] });
      setRevision(revision + 1); setProposals(current => current.map(item => item.id === proposal.id ? { ...item, status: 'applied', appliedRevision: revision + 1 } : { ...item, status: 'stale' }));
    }} />
  </main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
