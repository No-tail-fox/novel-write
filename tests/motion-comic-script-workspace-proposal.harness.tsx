// Real Workspace + Review + Proposal; only the local StoryDreamApi boundary is mocked.
// No Electron IPC, authorization, provider, network backend or paid generation.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { StoryDreamProvider } from '../src/ui';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { MotionComicScriptWorkspace } from '../src/features/motion-comic/MotionComicScriptWorkspace';
import { createMotionComicDraft, createMotionComicImportedProject } from '../src/shared/motion-comic';
import { motionComicScriptDraftSchema } from '../src/shared/motion-comic-planning';
import { motionComicScriptTaskSchema, motionComicScriptCandidateSchema, motionComicScriptApprovalSchema, motionComicScriptStoryboardCandidateSchema, motionComicScriptEditSchema } from '../src/shared/motion-comic-script-batch';
import { motionComicScriptProposalSchema, motionComicScriptOriginalSchema, motionComicScriptProposeSchema, motionComicScriptAdoptSchema, motionComicScriptRevertSchema, applyMotionComicScriptProposal } from '../src/shared/motion-comic-script-proposal';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles.css';

const now = '2026-11-12T00:00:00.000Z';
const project = createMotionComicImportedProject(createMotionComicDraft({ id: 'offline-workspace', title: '离线集成', premise: '门外来信', now }), {
  kind: 'novel', adaptationMode: 'novel-adaptation', originalText: '开门。查看来信。', episodes: [
    { title: '门外来信', sourceText: '开门。' }, { title: '第二集', sourceText: '查看来信。' },
  ],
}, now);
const script = (index: number) => motionComicScriptDraftSchema.parse({ title: `离线剧本${index}`, logline: '门外来信', characters: [], sceneAssets: [{ key: 'room', label: '门厅', description: '雨夜门厅', prompt: '木门', continuityNotes: '左侧光' }], props: [], scenes: [{ key: 'scene', title: '门厅', actIndex: 1, actTitle: '开端', actBoundaryReason: '来信', summary: '收到信', locationKey: 'room', beats: [{ key: 'beat', kind: 'action', text: index === 0 ? '开门' : '查看来信', sourceUnitIds: ['S1'] }] }] });
// Snapshot is an interface in production: compose its actual member schemas, not a permissive fake.
const snapshotSchema = z.object({ projectId: z.string(), paused: z.boolean(), tasks: z.array(motionComicScriptTaskSchema), candidates: z.array(motionComicScriptCandidateSchema), approvals: z.array(motionComicScriptApprovalSchema), storyboards: z.array(motionComicScriptStoryboardCandidateSchema), originals: z.array(motionComicScriptOriginalSchema), proposals: z.array(motionComicScriptProposalSchema) }).strict();
let snapshot = snapshotSchema.parse({ projectId: project.id, paused: false, tasks: project.sourceDocument!.episodes.map((episode, index) => ({ id: `task-${index}`, projectId: project.id, sourceEpisodeId: episode.id, status: 'script-ready', inputFingerprint: 'offline-input', seriesBibleVersion: '1', previousStateVersion: '1', provider: 'offline', model: 'offline', promptVersion: 'offline', instructions: '', outputRevision: 3, attempt: 1, progress: 100, createdAt: now, updatedAt: now })), candidates: [0, 1].map(index => ({ taskId: `task-${index}`, outputRevision: 3, script: script(index), adjustments: [], issues: [], origin: 'model', createdAt: now })), approvals: [], storyboards: [], originals: [0, 1].map(index => ({ taskId: `task-${index}`, outputRevision: 1, script: script(index), createdAt: now, provenance: 'first-model-finish' })), proposals: [] });
const calls: Array<{ method: string; input?: unknown }> = [];
let settle: (() => void) | undefined;
let rejectNext = false;
let staleNext = false;
const copySnapshot = () => snapshotSchema.parse(structuredClone(snapshot));
async function gate() { await new Promise<void>(resolve => { settle = resolve; }); settle = undefined; if (rejectNext) { rejectNext = false; throw new Error('OFFLINE_REJECTED: 模拟拒绝，未写入'); } }
const methods: Pick<StoryDreamApi, 'getMotionComicScripts' | 'proposeMotionComicScriptChange' | 'adoptMotionComicScriptChange' | 'revertMotionComicScriptChange' | 'editMotionComicScript'> = {
  async getMotionComicScripts(id) { calls.push({ method: 'get', input: id }); return copySnapshot(); },
  async proposeMotionComicScriptChange(raw) {
    const input = motionComicScriptProposeSchema.parse(raw); calls.push({ method: 'propose', input }); await gate();
    const candidate = snapshot.candidates.find(item => item.taskId === input.taskId)!;
    snapshot.proposals.push(motionComicScriptProposalSchema.parse({ id: input.requestId, requestId: input.requestId, projectId: input.id, taskId: input.taskId, baseRevision: staleNext ? input.outputRevision - 1 : input.outputRevision, inputFingerprint: 'offline-input', sceneKey: input.sceneKey, beatKey: input.beatKey, instruction: input.instruction, originalText: candidate.script.scenes[0].beats[0].text, proposedText: '缓缓推开门', status: 'ready', requestFingerprint: 'offline', baseProjectUpdatedAt: input.expectedUpdatedAt, baseScriptHash: 'offline', promptVersion: 'offline', provider: 'offline', model: 'offline', createdAt: now }));
    staleNext = false; return copySnapshot();
  },
  async adoptMotionComicScriptChange(raw) {
    const input = motionComicScriptAdoptSchema.parse(raw); calls.push({ method: 'adopt', input }); await gate();
    const candidate = snapshot.candidates.find(item => item.taskId === input.taskId)!;
    const proposal = snapshot.proposals.find(item => item.id === input.proposalId)!;
    if (input.expectedUpdatedAt !== project.updatedAt || input.outputRevision !== candidate.outputRevision) throw new Error('OFFLINE_CAS_REJECTED');
    candidate.script = applyMotionComicScriptProposal(candidate.script, proposal, { projectId: project.id, taskId: input.taskId, revision: candidate.outputRevision, inputFingerprint: 'offline-input' });
    candidate.outputRevision += 1;
    snapshot.tasks.find(item => item.id === input.taskId)!.outputRevision = candidate.outputRevision;
    proposal.status = 'applied'; proposal.appliedRevision = candidate.outputRevision; proposal.appliedScriptHash = 'offline-applied-hash';
    return copySnapshot();
  },
  async revertMotionComicScriptChange(raw) {
    const input = motionComicScriptRevertSchema.parse(raw); calls.push({ method: 'revert', input }); await gate();
    const candidate = snapshot.candidates.find(item => item.taskId === input.taskId)!;
    const proposal = snapshot.proposals.find(item => item.id === input.proposalId)!;
    if (proposal.status !== 'applied' || !proposal.appliedScriptHash || proposal.appliedRevision !== candidate.outputRevision || input.outputRevision !== candidate.outputRevision || input.expectedUpdatedAt !== project.updatedAt) throw new Error('OFFLINE_REVERT_REJECTED');
    candidate.script.scenes[0].beats[0].text = proposal.originalText;
    candidate.outputRevision += 1;
    snapshot.tasks.find(item => item.id === input.taskId)!.outputRevision = candidate.outputRevision;
    proposal.status = 'reverted'; proposal.revertedRevision = candidate.outputRevision;
    return copySnapshot();
  },
  async editMotionComicScript(raw) {
    const input = motionComicScriptEditSchema.parse(raw); calls.push({ method: 'edit', input }); await gate();
    throw new Error('OFFLINE_EDIT_REJECTED');
  },
};
// Fail closed for accidental UI calls outside the expressly mocked surface.
const api = new Proxy(methods, { get(target, key) { if (key in target) return target[key as keyof typeof target]; return () => { throw new Error(`Unexpected offline API: ${String(key)}`); }; } }) as StoryDreamApi;
Object.assign(window, { workspaceFixture: { calls, state: copySnapshot, release: () => settle?.(), reject: () => { rejectNext = true; settle?.(); }, stale: () => { staleNext = true; }, markStale: () => { snapshot.proposals.forEach(item => { item.status = 'stale'; }); }, advance: () => { snapshot.candidates[0].outputRevision += 1; snapshot.tasks[0].outputRevision += 1; }, loseHash: () => { delete snapshot.proposals[0].appliedScriptHash; }, confirmRevert: () => { snapshot.proposals[0].status = 'reverted'; snapshot.proposals[0].revertedRevision = 5; snapshot.candidates[0].script.scenes[0].beats[0].text = snapshot.proposals[0].originalText; snapshot.candidates[0].outputRevision = 5; snapshot.tasks[0].outputRevision = 5; }, pending: () => Boolean(settle) } });
const noop = () => {};
function Fixture() {
  const [selected, setSelected] = useState(project.sourceDocument!.episodes[1].id);
  return <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider><main style={{ padding: 16, height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}><MotionComicScriptWorkspace api={api} document={project} model="offline" selectedSourceEpisodeId={selected} plannedSourceEpisodeIds={new Set()} onSelectSourceEpisode={setSelected} onOpenEpisode={noop} onDraftGuardChange={noop} withSavedProject={async operation => { calls.push({ method: 'withSavedProject', input: project.updatedAt }); return operation(structuredClone(project)); }} onApplyStoryboard={async () => { throw new Error('Unexpected storyboard'); }} onApproveScripts={async () => { throw new Error('Unexpected approval'); }} onOpenProjectAssets={noop} /></main></WorkspaceNavigationProvider></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
