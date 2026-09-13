import { createRoot } from 'react-dom/client';
import { MotionComicPage } from '../src/features/motion-comic/MotionComicPage';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import { defaultConfig } from '../src/shared/config';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject, type MotionComicPipelineData } from '../src/shared/motion-comic';
import { directorDocumentRenderFingerprint } from '../src/shared/director-render';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';

const now = '2026-09-06T00:00:00.000Z';
let document = createMotionComicStarterProject(createMotionComicDraft({ id: 'structure-project', title: 'Structure fixture', premise: 'Fixture story.', now }), 'Episode A', now);
document = appendMotionComicEpisode(document, { id: 'episode-b', title: 'Episode B' });
document.activeEpisodeId = document.episodes[0].id;
document.episodes.forEach((episode, episodeIndex) => episode.scenes.forEach((scene) => scene.shots.forEach((shot, index) => { shot.title = `${episodeIndex === 0 ? 'A' : 'B'}${scene.index}${index + 1}`; })));
document.assets.push({ id: 'output-a', assetId: 'director-final-video', kind: 'video', localPath: '/fixture.mp4', createdAt: now, selected: true, episodeId: document.activeEpisodeId, renderFingerprint: directorDocumentRenderFingerprint(document) });
const controls = {
  saved: [] as MotionComicPipelineData[],
  renderRequests: [] as unknown[],
  renderPending: false,
  endRender: () => {},
};
const task = () => ({ id: document.id, title: document.title, taskType: 'motion-comic', pipelineData: JSON.stringify(document), createdAt: now, status: 'draft' });
const api = {
  async getTaskDetail() { return task(); },
  async saveMotionComic(input: { document: MotionComicPipelineData }) {
    document = structuredClone({ ...input.document, updatedAt: new Date(Date.parse(document.updatedAt) + 1).toISOString() });
    controls.saved.push(structuredClone(document));
    return { kind: 'task-upsert', task: task() };
  },
  async renderDirectorProject(input: unknown) {
    controls.renderRequests.push(input);
    controls.renderPending = true;
    await new Promise<void>((resolve) => { controls.endRender = resolve; });
    controls.renderPending = false;
    throw new Error('Fixture render cancelled');
  },
} as unknown as StoryDreamApi;
const state = { config: defaultConfig, secretStatus: {}, tasks: [task()] } as unknown as RendererAppState;
Object.assign(window, { comicStructureQA: controls });
createRoot(window.document.getElementById('root')!).render(
  <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider><MotionComicPage api={api} state={state} applyState={() => {}} requestedTaskId={document.id} onRequestedTaskHandled={() => {}} /></WorkspaceNavigationProvider></StoryDreamProvider>,
);
