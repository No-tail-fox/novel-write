// Isolated presentation fixture: real AppShell + real page, no application bootstrap,
// license overrides, IPC bridge, provider credentials, generated media or paid calls.
import { createRoot } from 'react-dom/client';
import { AppShell } from '../src/app/AppShell';
import { MotionComicPage } from '../src/features/motion-comic/MotionComicPage';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import { defaultConfig, defaultActivation, defaultAccount, defaultUiPreferences } from '../src/shared/config';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
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
if (new URLSearchParams(location.search).get('fixture') === 'empty') {
  document.episodes = [];
  document.activeEpisodeId = 'episode-not-created-yet';
  document.sourceDocument = {
    kind: 'script', adaptationMode: 'faithful-script', originalText: '雨夜，小林收到一封信。', importedAt: now,
    episodes: [{ id: 'source-empty-1', number: 1, title: '尚未规划的源分集', sourceText: '雨夜，小林收到一封信。' }],
  };
  // Exercise a schema-valid project through the actual page loader.
  parseMotionComicPipelineData(JSON.stringify(document));
}
const task = { id: document.id, title: document.title, taskType: 'motion-comic', pipelineData: JSON.stringify(document), createdAt: now, status: 'draft' } as Task;
const controls = { apiCalls: [] as string[], forbiddenCalls: [] as string[], shellNavigation: [] as string[] };
const reads: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  getTaskDetail: async () => task,
  getFinalFilmGate: async () => null,
  listDirectorBatches: async () => [],
  getMotionComicScripts: async () => { throw new Error('No generated script batch in this local fixture'); },
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
Object.assign(window, { comicShellQA: controls });
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
