import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorialCollagePage } from '../src/features/editorial-collage/EditorialCollagePage';
import { MotionComicPage } from '../src/features/motion-comic/MotionComicPage';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import { defaultConfig } from '../src/shared/config';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { ResearchCopyComposeInput } from '../src/shared/types';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/editorial-collage.css';
import '../src/styles/features/motion-comic.css';

const controls = {
  requests: [] as ResearchCopyComposeInput[],
  pending: [] as Array<(result: { copy: string }) => void>,
  release(copy: string) { this.pending.shift()?.({ copy }); },
  remount: () => {},
};
const api = {
  async composeResearchCopy(input: ResearchCopyComposeInput) {
    controls.requests.push(input);
    return await new Promise<{ copy: string }>((resolve) => controls.pending.push(resolve));
  },
} as unknown as StoryDreamApi;
const state = { config: defaultConfig, secretStatus: {}, tasks: [] } as unknown as RendererAppState;
const mode = new URLSearchParams(location.search).get('mode');

function Host() {
  const [revision, setRevision] = useState(0);
  controls.remount = () => setRevision((current) => current + 1);
  const props = { api, state, applyState: () => {}, requestedTaskId: '', onRequestedTaskHandled: () => {} };
  return mode === 'comic' ? <MotionComicPage key={revision} {...props} /> : <EditorialCollagePage key={revision} {...props} />;
}

Object.assign(window, { directorCopyQA: controls });
createRoot(document.getElementById('root')!).render(
  <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider><Host /></WorkspaceNavigationProvider></StoryDreamProvider>,
);
