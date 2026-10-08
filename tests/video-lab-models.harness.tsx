import { createRoot } from 'react-dom/client';
import { initialState } from '../src/app/app-state';
import type { RendererAppState } from '../src/app/route-types';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { VideoLabPage } from '../src/features/labs/VideoLabPage';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { StoryDreamProvider } from '../src/ui';
import '../src/styles.css';

const personPreview = new URL('../src/assets/drawing-style-previews/cinematic.webp', import.meta.url).href;
const endingPreview = new URL('../src/assets/drawing-style-previews/ink.webp', import.meta.url).href;
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
window.localStorage.clear();

const state = structuredClone(initialState) as RendererAppState;
const source = state.config.video.providers[0];
state.config.video.providers = [
  { ...source, id: 'qa-h3', name: 'MiniMax 官方', enabled: true, baseUrl: 'https://video.invalid', model: 'MiniMax-H3', modelPreset: 'h3', maxDurationSec: 15, maxResolution: '2K', capabilities: ['t2v', 'i2v', 'first-last-frame', 'reference-image', 'reference-video', 'reference-audio', 'synchronized-audio'] },
  { ...source, id: 'qa-seedance-25', name: '火山方舟', enabled: false, baseUrl: 'https://video.invalid', model: 'ep-seedance-production', modelPreset: 'seedance-2.5', maxDurationSec: 30, maxResolution: '1080P', capabilities: ['t2v', 'i2v', 'first-last-frame', 'reference-image', 'reference-video', 'reference-audio', 'synchronized-audio'] },
];
state.config.video.activeProviderId = 'qa-h3';
state.secretStatus['video/qa-h3/apiKey'] = true;
state.secretStatus['video/qa-seedance-25/apiKey'] = true;

const images = [
  { name: '正面.png', path: 'C:\\qa-people\\阿宁\\正面.png', updatedAt: 1 },
  { name: '侧面.png', path: 'C:\\qa-people\\阿宁\\侧面.png', updatedAt: 2 },
];
const referenceImages = [personPreview, endingPreview];
let imageIndex = 0;
const calls: string[] = [];
const api = new Proxy({
  async listVideoLabRecords() { return []; },
  async listPersonAssets() { return [{ name: '阿宁', count: 2, dir: 'C:\\qa-people\\阿宁', updatedAt: 2 }]; },
  async listPersonAssetImages() { return images; },
  async readAssetDataUrl(path: string) { calls.push(`preview:${path}`); return path.endsWith('侧面.png') ? endingPreview : personPreview; },
  async selectLocalImage() { return referenceImages[Math.min(imageIndex++, referenceImages.length - 1)]; },
}, { get(target, key) {
  if (key in target) return target[key as keyof typeof target];
  return async () => { calls.push(String(key)); throw new Error(`Unexpected API call: ${String(key)}`); };
} }) as unknown as StoryDreamApi;

Object.assign(window, { videoModelsQA: { calls } });

createRoot(document.getElementById('root')!).render(
  <StoryDreamProvider theme={theme}>
    <WorkspaceNavigationProvider>
      <VideoLabPage api={api} state={state} openSettings={(preset) => calls.push(`openSettings:${preset ?? ''}`)} />
    </WorkspaceNavigationProvider>
  </StoryDreamProvider>,
);
