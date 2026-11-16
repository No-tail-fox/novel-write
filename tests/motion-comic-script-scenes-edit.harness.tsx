import { createRoot } from 'react-dom/client';
import { MotionComicPage } from '../src/features/motion-comic/MotionComicPage';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import { defaultConfig } from '../src/shared/config';
import { createMotionComicDraft, createMotionComicStarterProject, type MotionComicPipelineData } from '../src/shared/motion-comic';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';

const now = '2026-09-06T00:00:00.000Z';
let document = createMotionComicStarterProject(createMotionComicDraft({ id: 'scenes-edit-project', title: 'Scenes edit fixture', premise: 'A local scene edit fixture.', now }), 'Episode A', now);
document.activeEpisodeId = document.episodes[0].id;
const controls = {
  saved: [] as MotionComicPipelineData[],
  calls: [] as string[],
  getDocument: () => structuredClone(document),
};
const task = () => ({ id: document.id, title: document.title, taskType: 'motion-comic', pipelineData: JSON.stringify(document), createdAt: now, status: 'draft' });
const api = {
  async getTaskDetail() { controls.calls.push('getTaskDetail'); return task(); },
  async getFinalFilmGate() { return null; },
  async listDirectorBatches() { return []; },
  async getMotionComicScripts() { controls.calls.push('getMotionComicScripts'); throw new Error('No script candidate in scenes edit fixture'); },
  async saveMotionComic(input: { document: MotionComicPipelineData }) {
    controls.calls.push('saveMotionComic');
    document = structuredClone({ ...input.document, updatedAt: new Date(Date.parse(document.updatedAt) + 1).toISOString() });
    controls.saved.push(structuredClone(document));
    return { kind: 'task-upsert', task: task() };
  },
} as unknown as StoryDreamApi;
const state = { config: defaultConfig, secretStatus: {}, tasks: [task()] } as unknown as RendererAppState;
Object.assign(window, { comicScenesEditQA: controls });
createRoot(window.document.getElementById('root')!).render(
  <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider><MotionComicPage api={api} state={state} applyState={() => {}} requestedTaskId={document.id} onRequestedTaskHandled={() => {}} /></WorkspaceNavigationProvider></StoryDreamProvider>,
);
