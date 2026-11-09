import { createRoot } from 'react-dom/client';
import { SettingsPage } from '../src/features/settings/SettingsPage';
import { initialState } from '../src/app/app-state';
import { makeFallbackApi } from '../src/app/browser-fallback';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import type { ArtifactStorageLocation } from '../src/shared/artifact-storage';
import { AppError } from '../src/shared/app-error';
import '../src/styles.css';

const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
const mode = query.get('mode') ?? 'normal';
const current = ['C:', 'Users', '创作者', 'AppData', 'Roaming', 'StoryDream', 'storydream'].join(String.fromCharCode(92));
const target = ['D:', '创作产物', '跨项目素材与长文件夹名称'.repeat(8)].join(String.fromCharCode(92));
let storage: ArtifactStorageLocation = { directory: current, defaultDirectory: current, pendingDirectory: mode === 'pending' || mode === 'migration-error' ? target : null, migrationError: mode === 'migration-error' ? '目标目录已有不同内容，未覆盖文件：' + target + '/tasks/image.png' : null };
let releaseLoad: (() => void) | undefined;
let releaseChoose: (() => void) | undefined;
const controls = {
  failLoad: mode === 'load-error', failChoose: false, cancelChooser: false, delayChoose: false,
  releaseLoad: () => releaseLoad?.(), releaseChoose: () => releaseChoose?.(),
};
const api = {
  ...makeFallbackApi(() => {}),
  async getArtifactStorage() {
    if (mode === 'loading') await new Promise<void>(resolve => { releaseLoad = resolve; });
    if (controls.failLoad) throw new Error('目录暂不可用，请重试。');
    return mode === 'browser' ? null : structuredClone(storage);
  },
  async chooseArtifactStorage() {
    if (controls.delayChoose) await new Promise<void>(resolve => { releaseChoose = resolve; });
    if (controls.failChoose) throw new AppError('ARTIFACT_STORAGE_CHANGE_FAILED', '该文件夹没有写入权限，请选择其他位置。');
    if (!controls.cancelChooser) storage = { ...storage, pendingDirectory: target, migrationError: null };
    return structuredClone(storage);
  },
  async cancelArtifactStorageChange() {
    storage = { ...storage, pendingDirectory: null, migrationError: null };
    return structuredClone(storage);
  },
};
const state = structuredClone(initialState);
state.ui.theme = theme;
state.config.ui.theme = theme;
Object.assign(window, { artifactStorageQA: controls });
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.themeReady = 'true';
createRoot(document.getElementById('root')!).render(
  <StoryDreamProvider theme={theme}><WorkspaceNavigationProvider>
    <SettingsPage api={api} state={state} applyState={() => {}} synchronizeThemeState={() => true} navigate={() => {}} initialSection="storage" />
  </WorkspaceNavigationProvider></StoryDreamProvider>,
);
