import { createRoot } from 'react-dom/client';
import { initialState } from '../src/app/app-state';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import type { RendererAppState } from '../src/app/route-types';
import { VideoLabPage } from '../src/features/labs/VideoLabPage';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { StoryDreamProvider } from '../src/ui';
import '../src/styles.css';

const firstFrame = new URL('../src/assets/drawing-style-previews/cinematic.webp', import.meta.url).href;
const lastFrame = new URL('../src/assets/drawing-style-previews/ink.webp', import.meta.url).href;
const referenceOne = new URL('../src/assets/drawing-style-previews/magazine.webp', import.meta.url).href;
const referenceTwo = new URL('../src/assets/drawing-style-previews/folk.webp', import.meta.url).href;

const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
window.localStorage.clear();

const state = structuredClone(initialState) as RendererAppState;
const provider = state.config.video.providers[0];
provider.enabled = true;
provider.baseUrl = 'https://video.invalid/v1';
provider.model = 'legacy-text-model';
provider.capabilities = ['t2v'];
state.config.video.activeProviderId = provider.id;
state.secretStatus[`video/${encodeURIComponent(provider.id)}/apiKey`] = true;

const imagePaths = [firstFrame, lastFrame, referenceOne, referenceTwo];
const calls: string[] = [];
let imageIndex = 0;
const api = new Proxy({
  async listVideoLabRecords() { return []; },
  async selectLocalImage(purpose?: 'video-reference') {
    calls.push(`selectLocalImage:${purpose ?? ''}`);
    return imagePaths[Math.min(imageIndex++, imagePaths.length - 1)];
  },
  async selectLocalVideo() { calls.push('selectLocalVideo'); return 'C:\\qa-media\\reference-motion.mp4'; },
  async selectLocalAudio(purpose?: 'managed-bgm' | 'video-reference') { calls.push(`selectLocalAudio:${purpose ?? ''}`); return 'C:\\qa-media\\reference-rhythm.mp3'; },
}, { get(target, key) {
  if (key in target) return target[key as keyof typeof target];
  return async () => { calls.push(String(key)); throw new Error(`Unexpected API call: ${String(key)}`); };
} }) as unknown as StoryDreamApi;

Object.assign(window, { videoUploadQA: { calls } });

createRoot(document.getElementById('root')!).render(
  <StoryDreamProvider theme={theme}>
    <WorkspaceNavigationProvider>
      <VideoLabPage api={api} state={state} openSettings={() => calls.push('openSettings')} />
    </WorkspaceNavigationProvider>
  </StoryDreamProvider>,
);
