// Isolated visual fixture for the script workspace hierarchy. Real AppShell + real Page;
// read-only fixture API, no bootstrap, license override, IPC, credentials or paid calls.
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
  id: 'script-hierarchy-fixture', title: '雨夜来信（本地版式验证）', now,
  // Imported-novel shape: separator rulers and a long run of prose (overview must clamp it).
  premise: `${'='.repeat(48)}\n本地版式验证，不含 AI 生成结果。\n${'='.repeat(48)}\n${Array.from({ length: 14 }, (_, i) => `第 ${i + 1} 句：雨夜里，林夏收到一封没有署名的信，信封上的火漆印让她想起多年前离开的那座城市。`).join('')}`,
}), '本地空白分集', now);
const paragraph = (n: number, i: number) => `第 ${n} 集第 ${i + 1} 段：雨水落在青石路面，路灯在积水里映出倒影。林夏握着那封没有署名的信，站在街角很久，直到钟楼敲过九下，她才终于决定拆开封口。`;
const episodes = Array.from({ length: 24 }, (_, index) => ({
  id: `src-${index + 1}`, number: index + 1, title: `第${index + 1}章 · 雨夜来信`,
  sourceText: `${index === 6 ? `${'='.repeat(40)}\n更多精校小说尽在示例站下载\n${'='.repeat(40)}\n` : ''}${Array.from({ length: 9 }, (_, i) => paragraph(index + 1, i)).join('\n')}`,
  splitReason: '按章节标题拆分，保持章节完整。', continuityHook: '结尾停在信封打开前，下一集从信的内容开始。',
}));
document.sourceDocument = { kind: 'novel', adaptationMode: 'faithful-script', originalText: episodes.map(e => e.sourceText).join('\n'), importedAt: now, episodes } as typeof document.sourceDocument;
const task = (id: string, status: string, progress = 0, error?: string) => ({ id: `task-${id}`, projectId: document.id, sourceEpisodeId: id, status, inputFingerprint: 'h', seriesBibleVersion: '1', previousStateVersion: '1', provider: 'fixture', model: 'deepseek-chat', promptVersion: '1', instructions: '', outputRevision: 0, attempt: 1, progress, ...(error ? { error } : {}), createdAt: now, updatedAt: now });
const scripts = { projectId: document.id, paused: false, tasks: episodes.map((e, i) => ({ ...task(e.id, i === 0 ? 'running' : i === 2 ? 'failed' : i === 3 || i === 4 ? 'approved' : 'queued', i === 0 ? 35 : 0, i === 2 ? '上游模型返回超时（本地示例错误）' : undefined), ...(i === 3 ? { storyboardStatus: 'running' } : i === 4 ? { storyboardStatus: 'ready' } : {}) })), candidates: [], approvals: [], storyboards: [] };
const projectTask = { id: document.id, title: document.title, taskType: 'motion-comic', pipelineData: JSON.stringify(document), createdAt: now, status: 'paused' } as Task;
const controls = { apiCalls: [] as string[], forbiddenCalls: [] as string[] };
const reads: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  getTaskDetail: async () => projectTask, getFinalFilmGate: async () => null,
  listDirectorBatches: async () => [], getMotionComicScripts: async () => scripts,
};
const api = new Proxy({}, { get(_t, key: string) { return (...args: unknown[]) => {
  controls.apiCalls.push(key);
  if (reads[key]) return reads[key](...args);
  controls.forbiddenCalls.push(key);
  return Promise.reject(new Error(`fixture forbids ${key}`));
}; } }) as StoryDreamApi;
const state: RendererAppState = {
  config: structuredClone(defaultConfig), secretStatus: {}, tasks: [projectTask], events: [], viralAnalyses: [], viralEvents: [], promptTemplates: [], draftTemplates: [],
  imageLabRecords: [], voiceLabRecords: [], customStyles: [], customCoverTemplates: [], creditTransactions: [], minimaxCloneVoices: [], account: { ...defaultAccount },
  activation: { ...defaultActivation }, ui: { ...defaultUiPreferences, activeView: 'motion-comic' },
};
const noop = () => {};
Object.assign(window, { scriptHierarchyQA: controls });
createRoot(window.document.getElementById('root')!).render(
  <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider>
    <AppShell activeView="motion-comic" returnView="history" state={state} saveTone="saved" isBrowserPreview={false} busy={false} feedback={null}
      navigate={noop} openTaskDetail={noop} minimizeWindow={noop} toggleMaximizeWindow={noop} closeWindow={noop} toggleTheme={noop} updateStatus={null}
      updateBusy={false} updateAction={null} openAnnouncements={noop} checkForUpdate={noop} downloadUpdate={noop} installUpdate={noop}>
      <MotionComicPage api={api} state={state} applyState={noop} requestedTaskId={document.id} onRequestedTaskHandled={noop} />
    </AppShell>
  </WorkspaceNavigationProvider></StoryDreamProvider>,
);
