// Isolated presentation fixture: real AppShell + real page, no application bootstrap,
// license overrides, IPC bridge, provider credentials, generated media or paid calls.
import { createRoot } from 'react-dom/client';
import { AppShell } from '../src/app/AppShell';
import { MotionComicPage } from '../src/features/motion-comic/MotionComicPage';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import { defaultConfig, defaultActivation, defaultAccount, defaultUiPreferences } from '../src/shared/config';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { Task } from '../src/shared/types';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';

const now = '2026-09-06T00:00:00.000Z';
const document = createMotionComicStarterProject(createMotionComicDraft({
  id: 'shell-fixture-project', title: 'AppShell 本地结构验证', premise: '仅用于导航与布局的手工空白项目，不包含 AI 生成结果。', now,
}), '本地空白分集', now);
document.sourceDocument = { kind: 'script', adaptationMode: 'faithful-script', originalText: 'QA 原文证据', importedAt: now, episodes: [{id:'qa-source', number:1, title:'QA 源分集', sourceText:'QA 原文证据'}] };
document.characters[0].name = 'QA人物';
document.characters[0].identityPrompt = '身份标记：黑发少年';
const baseLook = document.characters[0].looks[0];
baseLook.label = '日常'; baseLook.appearancePrompt = '外貌标记：蓝眼'; baseLook.wardrobe = '服装标记：白衣'; baseLook.continuityNotes = '连续性标记：银色胸针'; baseLook.referenceAssetVersionIds = [];
document.characters[0].looks.push({ ...baseLook, id: 'look-battle', label: '战斗', wardrobe: '服装标记：红甲', referenceAssetVersionIds: [] });
const canvas = window.document.createElement('canvas'); canvas.width = 80; canvas.height = 96; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#915b70'; ctx.fillRect(0, 0, 80, 96); const image = canvas.toDataURL();
const shot = document.episodes[0].scenes[0].shots[0];
document.providerJobs.push({id:'qa-video', nodeId:shot.id, episodeId:document.episodes[0].id, workflowKind:'motion-comic', providerId:'fixture', model:'local', capability:'image-to-video', status:'failed', inputHash:'hash', idempotencyKey:'qa', estimatedCost:0, attempt:1, createdAt:now, updatedAt:now});
const scripts = {projectId:document.id, paused:false, tasks:[{id:'qa-script', projectId:document.id, sourceEpisodeId:'qa-source', status:'queued', inputFingerprint:'hash', seriesBibleVersion:'1', previousStateVersion:'1', provider:'fixture', model:'local', promptVersion:'1', instructions:'', outputRevision:0, attempt:1, progress:0, createdAt:now, updatedAt:now}], candidates:[], approvals:[], storyboards:[]};
const batches: unknown[] = [];
const submissions: unknown[] = [];
const task = { id: document.id, title: document.title, taskType: 'motion-comic', pipelineData: JSON.stringify(document), createdAt: now, status: 'paused' } as Task;
const controls = { apiCalls: [] as string[], forbiddenCalls: [] as string[], shellNavigation: [] as string[] };
const reads: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  getTaskDetail: async () => task,
  getFinalFilmGate: async () => null,
  listDirectorBatches: async () => batches,
  getMotionComicScripts: async () => scripts,
  selectLocalReferenceImages: async () => [image],
  saveMotionComic: async (input) => { const saved = { ...(input as { document: object }).document, updatedAt: new Date().toISOString() }; task.pipelineData = JSON.stringify(saved); return {}; },
  submitMotionComicReferenceBatch: async (input) => { submissions.push(input); const batch = { id: 'submitted', projectId: document.id, status: 'running', createdAt: now, updatedAt: now, plan: { purpose: 'reference-generation' }, nodes: ['front', 'side', 'back'].map(role => ({ id: role, title: role, status: 'running', reference: { target: (input as {targets: unknown[]}).targets[0], role, applyState: 'pending', submissionState: 'submitted' } })) }; batches.push(batch); return batch; },
};
const api = new Proxy({}, {
  get(_target, key: string) {
    return (...args: unknown[]) => {
      controls.apiCalls.push(key);
      if (reads[key]) return reads[key](...args);
      controls.forbiddenCalls.push(key);
      return Promise.reject(new Error(`Shell fixture forbids API operation: ${key}`));
    };
  },
}) as StoryDreamApi;
const state: RendererAppState = {
  config: structuredClone(defaultConfig), secretStatus: {}, tasks: [task],
  events: [], viralAnalyses: [], viralEvents: [], promptTemplates: [], draftTemplates: [],
  imageLabRecords: [], voiceLabRecords: [], customStyles: [], customCoverTemplates: [],
  creditTransactions: [], minimaxCloneVoices: [], account: { ...defaultAccount },
  // Keep the genuine default INACTIVE display. This does not assert licensed access.
  activation: { ...defaultActivation }, ui: { ...defaultUiPreferences, activeView: 'motion-comic' },
};
const noop = () => {};
state.config.imageProfiles = [{ id: 'qa-image', name: 'QA Mock API', provider: 'gpt_image', gptImage: { ...state.config.gptImage, baseUrl: 'https://offline.invalid', model: 'gpt-image-1' } } as typeof state.config.imageProfiles[number]];
state.config.activeImageProfileId = 'qa-image';
state.secretStatus = { 'image/qa-image/gptImage/apiKey': true } as typeof state.secretStatus;
Object.assign(window, { comicShellQA: controls, submissions });
createRoot(window.document.getElementById('root')!).render(
  <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider>
    <AppShell activeView="motion-comic" returnView="history" state={state} saveTone="saved"
      isBrowserPreview={new URLSearchParams(location.search).get('runtime') === 'browser-fallback'} busy={false} feedback={null} navigate={(view) => controls.shellNavigation.push(view)}
      openTaskDetail={(id) => controls.shellNavigation.push(`task:${id}`)} minimizeWindow={noop}
      toggleMaximizeWindow={noop} closeWindow={noop} toggleTheme={noop} updateStatus={null}
      updateBusy={false} updateAction={null} openAnnouncements={noop} checkForUpdate={noop}
      downloadUpdate={noop} installUpdate={noop}>
      <MotionComicPage api={api} state={state} applyState={noop} requestedTaskId={document.id} onRequestedTaskHandled={noop} />
    </AppShell>
  </WorkspaceNavigationProvider></StoryDreamProvider>,
);
