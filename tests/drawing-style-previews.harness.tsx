import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { NewTaskPage } from '../src/features/tasks/NewTaskPage';
import { PromptTemplatesPage } from '../src/features/templates/PromptTemplatesPage';
import { ImageLabPage } from '../src/features/labs/ImageLabPage';
import { HtmlVideoPage } from '../src/features/html-video/HtmlVideoPage';
import { MusicMvPage } from '../src/features/music-mv/MusicMvPage';
import { ViralAnalyzerPage } from '../src/features/viral/ViralAnalyzerPage';
import { defaultConfig, defaultCustomStyles, defaultCustomCoverTemplates } from '../src/shared/config';
import { defaultPromptTemplates } from '../src/shared/prompt-template-defaults';
import { draftTemplates } from '../src/shared/templates';
import { imageStylePreview } from '../src/shared/image-style-previews';
import { createHtmlVideoPipelineData } from '../src/shared/html-video-workflow';
import type { Task } from '../src/shared/types';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles.css';

const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
window.localStorage.clear();
const htmlTask = {
  id: 'qa-html-style', title: '画风预览本地验收', inputText: '从一间临河书屋开始。', taskType: 'html-video',
  status: 'paused', currentStep: 1, pipelineStep: 'rewrite', createdAt: '2026-09-17T00:00:00Z', errorMessage: '',
  pipelineData: JSON.stringify(createHtmlVideoPipelineData('从一间临河书屋开始。', { style: 'modern-film' })),
} as Task;
const htmlWorkspace = query.get('page') === 'html-workspace';
const customStyles = [
  ...structuredClone(defaultCustomStyles),
  { ...structuredClone(defaultCustomStyles[0]), id: 'my-cinematic-style', name: '我的电影画风', tag: '自定义', shortName: '我的画风' },
];
const state = {
  config: structuredClone(defaultConfig), customStyles,
  customCoverTemplates: structuredClone(defaultCustomCoverTemplates), promptTemplates: structuredClone(defaultPromptTemplates),
  draftTemplates: structuredClone(draftTemplates), minimaxCloneVoices: [], tasks: htmlWorkspace ? [htmlTask] : [], imageLabRecords: [],
  viralAnalyses: [], viralEvents: [],
} as unknown as RendererAppState;
const calls: string[] = [];
const readCalls: string[] = [];
const api = new Proxy({
  async listPersonAssets() { readCalls.push('listPersonAssets'); return []; },
  async listTasks() { readCalls.push('listTasks'); return { items: state.tasks, nextCursor: null }; },
  async getTaskDetail() { readCalls.push('getTaskDetail'); return htmlTask; },
  async getPromptTemplateDetail(id: string) { readCalls.push('getPromptTemplateDetail'); return state.promptTemplates.find(template => template.id === id) ?? null; },
}, { get(target, key) {
  if (key in target) return target[key as keyof typeof target];
  return async () => { calls.push(String(key)); throw new Error(`Unexpected API call: ${String(key)}`); };
} }) as unknown as StoryDreamApi;
Object.assign(window, { drawingPreviewQA: {
  calls, readCalls, styles: customStyles.map(style => ({ id: style.id, name: style.name, src: imageStylePreview(style)?.src })),
  draft: () => JSON.parse(localStorage.getItem('storydream.new-task-draft.v1') || 'null'),
} });
const noop = () => {};
const page = query.get('page');
const content = page === 'templates' ? <PromptTemplatesPage api={api} state={state} applyState={noop} />
  : page === 'image-lab' ? <ImageLabPage api={api} state={state} applyState={noop} />
  : page === 'music-mv' ? <MusicMvPage api={api} state={state} applyState={noop} openTaskDetail={noop} isBrowserPreview={false} />
  : page === 'viral' ? <ViralAnalyzerPage api={api} state={state} applyState={noop} refreshViralEvents={async () => {}} onActiveAnalysisChange={noop} openTaskDetail={noop} isBrowserPreview={false} />
  : page === 'html-video' || htmlWorkspace ? <HtmlVideoPage api={api} state={state} applyState={noop} refreshTaskDetail={async () => {}} requestedTaskId={htmlWorkspace ? htmlTask.id : ''} onRequestedTaskHandled={noop} onActiveTaskChange={noop} isBrowserPreview={false} />
  : <NewTaskPage api={api} state={state} applyState={noop} openTaskDetail={noop} isBrowserPreview={false} navigate={noop} />;
createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme={theme}><WorkspaceNavigationProvider><div style={{padding:24, minHeight:'100vh', boxSizing:'border-box'}}>{content}</div></WorkspaceNavigationProvider></StoryDreamProvider>);
