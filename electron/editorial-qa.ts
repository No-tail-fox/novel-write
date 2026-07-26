import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BrowserWindow } from 'electron';

export const editorialQaScopes = ['all', 'theme-smoke', 'shell', 'new-task', 'task-operations', 'html-video', 'clone-voice', 'workflow', 'labs', 'system'] as const;
export type EditorialQaScope = (typeof editorialQaScopes)[number];
export type EditorialQaEnvironment = Partial<Record<
  | 'STORYDREAM_QA_RUN_ROOT'
  | 'STORYDREAM_QA_RUN_TOKEN'
  | 'STORYDREAM_QA_SENTINEL'
  | 'STORYDREAM_QA_USER_DATA'
  | 'STORYDREAM_QA_REPORT'
  | 'STORYDREAM_QA_CAPTURES'
  | 'STORYDREAM_QA_SCOPE'
  | 'STORYDREAM_SMOKE_OUTPUT'
  | 'STORYDREAM_SMOKE_USER_DATA',
  string | undefined
>>;

export interface EditorialQaConfig {
  root: string;
  token: string;
  sentinel: string;
  userData: string;
  report: string;
  captures: string;
  scope: EditorialQaScope;
}

export const editorialQaMatrix = {
  themes: ['dark', 'light'] as const,
  viewports: [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'compact', width: 1080, height: 720 },
  ],
  views: {
    shell: ['new-task'],
    workflow: ['new-task', 'queue', 'history', 'task-detail', 'html-video', 'music-mv', 'viral-analyzer'],
    labs: ['image-lab', 'voice-lab', 'book-selection', 'benchmark', 'person-assets'],
    system: ['prompt-templates', 'draft-templates', 'settings', 'account', 'activation'],
  },
  newTaskStates: [
    { id: 'new-task-material-desktop', view: 'new-task', stage: 'material', theme: 'light', viewport: 'desktop' },
    { id: 'new-task-creative-desktop', view: 'new-task', stage: 'creative', theme: 'light', viewport: 'desktop' },
    { id: 'new-task-output-desktop', view: 'new-task', stage: 'output', theme: 'light', viewport: 'desktop' },
    { id: 'new-task-material-compact', view: 'new-task', stage: 'material', theme: 'light', viewport: 'compact' },
  ],
  taskOperationStates: [
    { id: 'queue-operations-desktop', view: 'queue', theme: 'light', viewport: 'desktop' },
    { id: 'history-operations-desktop', view: 'history', theme: 'light', viewport: 'desktop' },
    { id: 'task-detail-operations-desktop', view: 'task-detail', theme: 'light', viewport: 'desktop' },
    { id: 'history-operations-compact', view: 'history', theme: 'light', viewport: 'compact' },
  ],
  htmlVideoStudioStates: [
    { id: 'html-video-studio-light-desktop', view: 'html-video', theme: 'light', viewport: 'desktop' },
    { id: 'html-video-studio-light-compact', view: 'html-video', theme: 'light', viewport: 'compact' },
  ],
  cloneVoiceStates: [
    { id: 'minimax-clone-voice-create-light-desktop', view: 'settings', theme: 'light', viewport: 'desktop' },
    { id: 'minimax-clone-voice-edit-dark-desktop', view: 'settings', theme: 'dark', viewport: 'desktop' },
    { id: 'minimax-clone-voice-delete-light-compact', view: 'settings', theme: 'light', viewport: 'compact' },
    { id: 'minimax-clone-voice-empty-dark-compact', view: 'settings', theme: 'dark', viewport: 'compact' },
  ],
} as const;

const qaComputedTokenNames = [
  '--shell-bg', '--shell-surface', '--shell-border', '--shell-text', '--shell-muted',
  '--shell-focus', '--shell-focus-contrast', '--media-bg', '--media-surface',
  '--media-border', '--media-text', '--media-muted',
] as const;
const editorialQaOperationTimeoutMs = 30_000;

export function resolveEditorialQaConfig(
  environment: EditorialQaEnvironment = process.env,
  osTempDirectory = tmpdir(),
): EditorialQaConfig | null {
  const names = [
    'STORYDREAM_QA_RUN_ROOT',
    'STORYDREAM_QA_RUN_TOKEN',
    'STORYDREAM_QA_SENTINEL',
    'STORYDREAM_QA_USER_DATA',
    'STORYDREAM_QA_REPORT',
    'STORYDREAM_QA_CAPTURES',
  ] as const;
  const values = Object.fromEntries(names.map((name) => [name, environment[name]?.trim() ?? ''])) as Record<(typeof names)[number], string>;
  const scope = (environment.STORYDREAM_QA_SCOPE?.trim() || 'all') as EditorialQaScope;
  if (!editorialQaScopes.includes(scope)) throw new Error(`Unknown editorial QA scope: ${scope}`);
  const supplied = names.filter((name) => values[name].length > 0);
  if (supplied.length === 0) {
    if ((environment.STORYDREAM_QA_SCOPE ?? '').trim()) throw new Error('Editorial QA scope requires the complete QA environment.');
    return null;
  }
  if (supplied.length !== names.length) throw new Error('Editorial QA environment must be all-or-none.');
  if ((environment.STORYDREAM_SMOKE_OUTPUT ?? '').trim() || (environment.STORYDREAM_SMOKE_USER_DATA ?? '').trim()) {
    throw new Error('Electron smoke and editorial QA modes are mutually exclusive.');
  }
  const pathValues = names.filter((name) => name !== 'STORYDREAM_QA_RUN_TOKEN').map((name) => values[name]);
  if (pathValues.some((value) => value.length > 4096 || value.includes('\0') || !isAbsolute(value))) {
    throw new Error('Editorial QA paths must be bounded absolute paths.');
  }
  if (values.STORYDREAM_QA_RUN_TOKEN.length < 24 || values.STORYDREAM_QA_RUN_TOKEN.length > 256) {
    throw new Error('Editorial QA run token is invalid.');
  }

  const tempRoot = realpathSync(osTempDirectory);
  const root = realpathSync(values.STORYDREAM_QA_RUN_ROOT);
  assertStrictDescendant(tempRoot, root, 'Editorial QA root');
  assertNonReparseDirectory(root, 'Editorial QA root');
  const sentinel = resolve(values.STORYDREAM_QA_SENTINEL);
  const userData = resolve(values.STORYDREAM_QA_USER_DATA);
  const report = resolve(values.STORYDREAM_QA_REPORT);
  const captures = resolve(values.STORYDREAM_QA_CAPTURES);
  for (const [value, label] of [[sentinel, 'sentinel'], [userData, 'userData'], [report, 'report'], [captures, 'captures']] as const) {
    assertStrictDescendant(root, value, `Editorial QA ${label}`);
  }
  if (dirname(sentinel) !== root || basename(sentinel) !== '.editorial-qa-sentinel') {
    throw new Error('Editorial QA sentinel must be the parent-created root sentinel.');
  }
  assertNonReparseRegularFile(sentinel, 'Editorial QA sentinel');
  const token = readFileSync(sentinel, 'utf8');
  if (token !== values.STORYDREAM_QA_RUN_TOKEN) throw new Error('Editorial QA sentinel token does not match.');
  unlinkSync(sentinel);
  if (existsSync(join(userData, 'storydream', 'data.db'))) {
    throw new Error('Editorial QA userData database must not preexist.');
  }
  return { root, token, sentinel, userData, report, captures, scope };
}

export async function captureEditorialQa(
  window: BrowserWindow,
  config: EditorialQaConfig,
  getMetrics: () => Array<{ pid: number }>,
): Promise<void> {
  await mkdir(config.captures, { recursive: true });
  const captures: EditorialQaCapture[] = [];
  const cases = captureCasesForScope(config.scope);
  await window.webContents.executeJavaScript(qaCssAndReadinessScript(), true);
  await writeEditorialQaReport(config, captures, getMetrics);
  for (const captureCase of cases) {
    const viewport = editorialQaMatrix.viewports.find((candidate) => candidate.name === captureCase.viewport);
    if (!viewport) throw new Error(`Editorial QA viewport is unknown: ${captureCase.viewport}`);
    await writeEditorialQaReport(config, captures, getMetrics, { activeCapture: captureCase.id });
    window.setContentSize(viewport.width, viewport.height);
    const state = await withEditorialQaTimeout(
      window.webContents.executeJavaScript(qaScenarioScript(captureCase.id, captureCase.view, captureCase.theme, captureCase.stage), true) as Promise<QaScenarioState>,
      editorialQaOperationTimeoutMs,
      `${captureCase.id} scenario`,
    );
    if (!state.ready || state.width !== viewport.width || state.height !== viewport.height || state.scale !== 1) {
      throw new Error(`Editorial QA scenario did not reach a stable ${captureCase.id} state: ${JSON.stringify(state)}`);
    }
    if (state.layout.horizontalOverflow > 1 || state.layout.clippedPrimaryControls.length > 0) {
      throw new Error(`Editorial QA found clipped controls in ${captureCase.id}: ${state.layout.clippedPrimaryControls.join(', ')}`);
    }
    const expectedPlacement = viewport.name === 'compact' ? 'below' : 'right';
    if (captureCase.stage && (!state.stageStatePreserved || state.layout.summaryPlacement !== expectedPlacement)) {
      throw new Error(`Editorial QA new-task interaction/layout failed in ${captureCase.id}.`);
    }
    if (captureCase.stage === 'output' && (
      state.manualCover.state !== 'required'
      || !state.manualCover.importVisible
      || !state.manualCover.createDisabled
    )) {
      throw new Error(`Editorial QA manual-cover state failed in ${captureCase.id}.`);
    }
    if (captureCase.id === 'history-operations-desktop' && (!state.deleteDialogFocusWrapped || !state.deleteDialogEscapeRestored)) {
      throw new Error('Editorial QA history delete-dialog keyboard lifecycle failed.');
    }
    if (captureCase.id.startsWith('html-video-studio') && state.layout.htmlVideoStudioPlacement !== (viewport.name === 'compact' ? 'stacked' : 'three-column')) {
      throw new Error(`Editorial QA HTML studio layout failed in ${captureCase.id}: ${state.layout.htmlVideoStudioPlacement}.`);
    }
    if (captureCase.id === 'html-video-studio-light-compact' && state.layout.htmlVideoCompactParameterOrder !== 'parameters-first') {
      throw new Error(`Editorial QA HTML studio compact parameter order failed: ${state.layout.htmlVideoCompactParameterOrder}.`);
    }
    if (captureCase.id === 'minimax-clone-voice-create-light-desktop' && (!state.cloneVoice.sourceAudioSelected || !state.cloneVoice.created)) {
      throw new Error(`Editorial QA MiniMax clone-voice create failed: ${JSON.stringify(state.cloneVoice)}.`);
    }
    if (captureCase.id === 'minimax-clone-voice-edit-dark-desktop' && !state.cloneVoice.edited) {
      throw new Error(`Editorial QA MiniMax clone-voice edit failed: ${JSON.stringify(state.cloneVoice)}.`);
    }
    if (captureCase.id === 'minimax-clone-voice-delete-light-compact' && !state.cloneVoice.deleted) {
      throw new Error(`Editorial QA MiniMax clone-voice delete failed: ${JSON.stringify(state.cloneVoice)}.`);
    }
    if (captureCase.id === 'minimax-clone-voice-empty-dark-compact' && !state.cloneVoice.empty) {
      throw new Error(`Editorial QA MiniMax clone-voice empty state failed: ${JSON.stringify(state.cloneVoice)}.`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    await withEditorialQaTimeout(
      window.webContents.executeJavaScript(qaCompositorSettlingScript(), true),
      editorialQaOperationTimeoutMs,
      `${captureCase.id} compositor settling`,
    );
    const image = await withEditorialQaTimeout(
      captureEditorialQaPage(window, captureCase.id),
      editorialQaOperationTimeoutMs,
      `${captureCase.id} capturePage`,
    );
    const png = image.toPNG();
    const capturePath = join(config.captures, `${captureCase.id}.png`);
    await writeFile(capturePath, png, { flag: 'wx' });
    await assertCapturePng(capturePath, png, image.toBitmap(), viewport.width, viewport.height);
    captures.push({ view: captureCase.view, stage: captureCase.stage, theme: captureCase.theme, viewport: viewport.name, path: basename(capturePath), visibleText: state.visibleText, tokens: state.tokens, manualCover: state.manualCover, cloneVoice: state.cloneVoice, deleteDialogFocusWrapped: state.deleteDialogFocusWrapped, deleteDialogEscapeRestored: state.deleteDialogEscapeRestored });
    await writeEditorialQaReport(config, captures, getMetrics);
  }
  await writeEditorialQaReport(config, captures, getMetrics);
}

async function writeEditorialQaReport(
  config: EditorialQaConfig,
  captures: readonly EditorialQaCapture[],
  getMetrics: () => Array<{ pid: number }>,
  options: { activeCapture: string | null } = { activeCapture: null },
): Promise<void> {
  const ownedProcessIds = [...new Set(getMetrics().map((metric) => metric.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  await writeFile(config.report, `${JSON.stringify({
    scope: config.scope,
    processId: process.pid,
    ownedProcessIds,
    remainingOwnedProcessIds: [],
    activeCapture: options.activeCapture,
    captures,
  }, null, 2)}\n`, 'utf8');
}

async function withEditorialQaTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Editorial QA ${label} timed out.`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Editorial QA ')) throw error;
    throw new Error(`Editorial QA ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function captureEditorialQaPage(window: BrowserWindow, captureId: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await window.webContents.capturePage();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));
        await window.webContents.executeJavaScript(qaCompositorSettlingScript(), true);
      }
    }
  }
  throw new Error(`Editorial QA ${captureId} capturePage failed after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

interface EditorialQaCapture {
  view: string;
  stage?: string;
  theme: string;
  viewport: string;
  path: string;
  visibleText: string;
  tokens: Record<string, string>;
  manualCover: QaScenarioState['manualCover'];
  cloneVoice: QaScenarioState['cloneVoice'];
  deleteDialogFocusWrapped: boolean;
  deleteDialogEscapeRestored: boolean;
}

interface EditorialQaCaptureCase {
  id: string;
  view: string;
  stage?: string;
  theme: string;
  viewport: string;
}

interface QaScenarioState {
  ready: boolean;
  width: number;
  height: number;
  scale: number;
  visibleText: string;
  tokens: Record<string, string>;
  stageStatePreserved: boolean;
  manualCover: {
    state: string;
    importVisible: boolean;
    createDisabled: boolean;
  };
  cloneVoice: {
    sourceAudioSelected: boolean;
    created: boolean;
    edited: boolean;
    deleted: boolean;
    empty: boolean;
  };
  deleteDialogFocusWrapped: boolean;
  deleteDialogEscapeRestored: boolean;
  layout: {
    horizontalOverflow: number;
    clippedPrimaryControls: string[];
    summaryPlacement: 'right' | 'below' | 'unknown';
    htmlVideoStudioPlacement: 'three-column' | 'stacked' | 'unknown';
    htmlVideoCompactParameterOrder: 'parameters-first' | 'invalid' | 'unknown';
  };
}

function captureCasesForScope(scope: EditorialQaScope): EditorialQaCaptureCase[] {
  if (scope === 'new-task') return [...editorialQaMatrix.newTaskStates];
  if (scope === 'task-operations') return [...editorialQaMatrix.taskOperationStates];
  if (scope === 'html-video') return [...editorialQaMatrix.htmlVideoStudioStates];
  if (scope === 'clone-voice') return [...editorialQaMatrix.cloneVoiceStates];
  if (scope === 'all') {
    const cases = Object.entries(editorialQaMatrix.views).flatMap(([group, groupViews]) => (
      editorialQaMatrix.themes.flatMap((theme) => editorialQaMatrix.viewports.flatMap((viewport) => (
        groupViews.map((view) => ({
          id: `${group}-${view}-${theme}-${viewport.name}`,
          view,
          theme,
          viewport: viewport.name,
        }))
      )))
    ));
    return [...cases, ...editorialQaMatrix.newTaskStates, ...editorialQaMatrix.taskOperationStates, ...editorialQaMatrix.htmlVideoStudioStates, ...editorialQaMatrix.cloneVoiceStates];
  }
  const views = scope === 'theme-smoke'
    ? ['new-task']
    : editorialQaMatrix.views[scope];
  const cases = editorialQaMatrix.themes.flatMap((theme) => editorialQaMatrix.viewports.flatMap((viewport) => (
    views.map((view) => ({
      id: `${view}-${theme}-${viewport.name}`,
      view,
      theme,
      viewport: viewport.name,
    }))
  )));
  return cases;
}

export function editorialQaExpectedCaptureCount(scope: EditorialQaScope): number {
  return captureCasesForScope(scope).length;
}

export function editorialQaCaptureIds(scope: EditorialQaScope): readonly string[] {
  return captureCasesForScope(scope).map((captureCase) => captureCase.id);
}

function assertStrictDescendant(parent: string, child: string, label: string): void {
  const relation = relative(parent, child);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new Error(`${label} must be a strict descendant of its trusted parent.`);
}

function assertNonReparseDirectory(path: string, label: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real non-reparse directory.`);
}

function assertNonReparseRegularFile(path: string, label: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-reparse file.`);
}

function qaCssAndReadinessScript(): string {
  return `(() => {
    const style = document.createElement('style');
    style.dataset.editorialQa = 'true';
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.append(style);
  })()`;
}

function qaCompositorSettlingScript(): string {
  return `new Promise((resolve) => {
    let settled = false;
    let fallback;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallback) clearTimeout(fallback);
      resolve();
    };
    fallback = setTimeout(finish, 160);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  })`;
}

function qaScenarioScript(id: string, view: string, theme: string, stage?: string): string {
  return `(async () => {
    const waitFor = async (check, timeout = 10000) => {
      const until = Date.now() + timeout;
      while (!check()) { if (Date.now() >= until) return false; await new Promise((resolve) => setTimeout(resolve, 25)); }
      return true;
    };
    const withTimeout = async (operation, timeout, message) => {
      let timer;
      try {
        return await Promise.race([
          operation,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const settleCompositor = () => new Promise((resolve) => {
      let settled = false;
      let fallback;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (fallback) clearTimeout(fallback);
        resolve();
      };
      fallback = setTimeout(finish, 160);
      requestAnimationFrame(() => requestAnimationFrame(finish));
    });
    const setInputValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const initialShellReady = await waitFor(() => document.querySelector('.app-shell')
      && document.documentElement.dataset.themeReady === 'true');
    const api = window.storydream;
    if (api && document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) {
      await withTimeout(api.saveUiPreferences({ theme: ${JSON.stringify(theme)} }), 10000, 'theme preference timed out');
    }
    const themeReady = await waitFor(() => document.documentElement.dataset.theme === ${JSON.stringify(theme)});
    const scenarioId = ${JSON.stringify(id)};
    const targetView = ${JSON.stringify(view)};
    const navView = targetView === 'task-detail' ? 'queue' : targetView;
    const nav = document.querySelector('[data-nav-view="' + navView + '"]');
    if (nav instanceof HTMLButtonElement) nav.click();
    if (targetView === 'task-detail') {
      await waitFor(() => document.querySelector('[data-task-operations="queue"]'));
      const detailRow = [...document.querySelectorAll('.task-queue-row')]
        .find((row) => row.textContent?.includes('武则天：从深宫才人到一代女皇'));
      if (detailRow instanceof HTMLElement) detailRow.click();
    }
    let ready = initialShellReady && themeReady && await waitFor(() => document.querySelector('.app-shell')
      && document.documentElement.dataset.themeReady === 'true'
      && document.querySelector('[data-shell-view="' + targetView + '"]'));
    let deleteDialogFocusWrapped = scenarioId !== 'history-operations-desktop';
    let deleteDialogEscapeRestored = scenarioId !== 'history-operations-desktop';
    if (scenarioId === 'queue-operations-desktop') {
      ready = ready && await waitFor(() => document.querySelector('.task-event-rail')?.textContent?.includes('Step 4 批量生图'));
    }
    if (scenarioId === 'history-operations-desktop') {
      const archiveGroup = document.querySelector('[role="group"][aria-label="记录范围"]');
      const archivedButton = [...(archiveGroup?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === '已归档');
      ready = ready && await waitFor(() => archivedButton instanceof HTMLButtonElement && !archivedButton.disabled);
      if (archivedButton instanceof HTMLButtonElement && !archivedButton.disabled) archivedButton.click();
      ready = ready && await waitFor(() => [...document.querySelectorAll('.history-page .table-row')]
        .some((row) => row.textContent?.includes('QA 永久删除验证记录')));
      const deleteButton = [...document.querySelectorAll('.history-page .row-actions button')]
        .find((button) => button.getAttribute('aria-label') === '永久删除记录');
      if (deleteButton instanceof HTMLButtonElement) {
        deleteButton.focus();
        deleteButton.click();
        ready = ready && await waitFor(() => document.querySelector('.confirm-dialog'));
        await new Promise((resolve) => queueMicrotask(resolve));
        const dialog = document.querySelector('.confirm-dialog');
        const focusable = [...(dialog?.querySelectorAll('[data-dialog-focus]:not([disabled])') ?? [])];
        const first = focusable[0];
        const last = focusable.at(-1);
        let forwardWrapped = false;
        let backwardWrapped = false;
        if (dialog instanceof HTMLElement && first instanceof HTMLElement && last instanceof HTMLElement) {
          last.focus();
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
          forwardWrapped = document.activeElement === first;
          first.focus();
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
          backwardWrapped = document.activeElement === last;
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          await waitFor(() => !document.querySelector('.confirm-dialog'));
          await new Promise((resolve) => queueMicrotask(resolve));
          deleteDialogFocusWrapped = forwardWrapped && backwardWrapped;
          deleteDialogEscapeRestored = document.activeElement === deleteButton;
        }
      }
      const activeButton = [...(archiveGroup?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === '活跃任务');
      ready = ready && await waitFor(() => activeButton instanceof HTMLButtonElement && !activeButton.disabled);
      if (activeButton instanceof HTMLButtonElement && !activeButton.disabled) activeButton.click();
      ready = ready && await waitFor(() => [...document.querySelectorAll('.history-page .table-row')]
        .some((row) => row.textContent?.includes('武则天：从深宫才人到一代女皇')));
    }
    if (scenarioId === 'task-detail-operations-desktop') {
      ready = ready && await waitFor(() => document.querySelector('.task-media-progress')?.textContent?.includes('8 / 12')
        && document.querySelector('.task-scene-rail')?.textContent?.includes('8 / 12 已生成'));
    }
    if (scenarioId.startsWith('html-video-studio')) {
      ready = ready && await waitFor(() => {
        const previewImage = document.querySelector('img[alt*="动画预览"]');
        return document.querySelector('[data-html-video-studio="html-video"]')
          && document.querySelector('[data-media-canvas="html-video"]')
          && document.querySelector('.hv-studio-run-rail')?.textContent?.includes('4/6')
          && previewImage instanceof HTMLImageElement
          && previewImage.complete
          && previewImage.naturalWidth > 0
          && document.querySelector('.hv-timeline-track span')
          && document.querySelector('.hv-timeline-audio i');
      });
    }
    const cloneVoice = { sourceAudioSelected: false, created: false, edited: false, deleted: false, empty: false };
    if (scenarioId.startsWith('minimax-clone-voice-')) {
      const ttsTab = [...document.querySelectorAll('.settings-tab')]
        .find((button) => button.textContent?.includes('TTS 配音'));
      if (ttsTab instanceof HTMLButtonElement) ttsTab.click();
      ready = ready && await waitFor(() => document.querySelector('.minimax-clone-voice-manager')
        && !document.querySelector('.minimax-clone-voice-empty .spin'));
      const findVoiceRow = () => [...document.querySelectorAll('.minimax-clone-voice-row')]
        .find((row) => row.textContent?.includes('qa-minimax-voice-001'));
      if (scenarioId === 'minimax-clone-voice-create-light-desktop') {
        const createButton = [...document.querySelectorAll('.minimax-clone-voice-manager button')]
          .find((button) => button.textContent?.includes('登记音色'));
        if (createButton instanceof HTMLButtonElement) createButton.click();
        ready = ready && await waitFor(() => document.querySelector('.minimax-clone-voice-editor'));
        const inputs = [...document.querySelectorAll('.minimax-clone-voice-editor input')];
        if (inputs[0] instanceof HTMLInputElement) setInputValue(inputs[0], 'qa-minimax-voice-001');
        if (inputs[1] instanceof HTMLInputElement) setInputValue(inputs[1], 'QA 克隆音色');
        const sourceButton = document.querySelector('.minimax-clone-voice-editor button[aria-label="选择来源音频"]');
        if (sourceButton instanceof HTMLButtonElement) sourceButton.click();
        ready = ready && await waitFor(() => inputs[2] instanceof HTMLInputElement && inputs[2].value.endsWith('qa-minimax-source.wav'));
        cloneVoice.sourceAudioSelected = inputs[2] instanceof HTMLInputElement && inputs[2].value.endsWith('qa-minimax-source.wav');
        const saveButton = [...document.querySelectorAll('.minimax-clone-voice-editor button')]
          .find((button) => button.textContent?.includes('保存记录'));
        if (saveButton instanceof HTMLButtonElement) saveButton.click();
        ready = ready && await waitFor(() => Boolean(findVoiceRow()));
        cloneVoice.created = Boolean(findVoiceRow()?.textContent?.includes('QA 克隆音色'));
      }
      if (scenarioId === 'minimax-clone-voice-edit-dark-desktop') {
        const row = findVoiceRow();
        const editButton = row?.querySelector('button[title="编辑音色记录"]');
        if (editButton instanceof HTMLButtonElement) editButton.click();
        ready = ready && await waitFor(() => document.querySelector('.minimax-clone-voice-editor'));
        const nameInput = document.querySelectorAll('.minimax-clone-voice-editor input')[1];
        if (nameInput instanceof HTMLInputElement) setInputValue(nameInput, 'QA 克隆音色已编辑');
        const saveButton = [...document.querySelectorAll('.minimax-clone-voice-editor button')]
          .find((button) => button.textContent?.includes('保存记录'));
        if (saveButton instanceof HTMLButtonElement) saveButton.click();
        ready = ready && await waitFor(() => Boolean(findVoiceRow()?.textContent?.includes('QA 克隆音色已编辑')));
        cloneVoice.edited = Boolean(findVoiceRow()?.textContent?.includes('QA 克隆音色已编辑'));
      }
      if (scenarioId === 'minimax-clone-voice-delete-light-compact') {
        const row = findVoiceRow();
        const deleteButton = row?.querySelector('button[title="删除音色记录"]');
        if (deleteButton instanceof HTMLButtonElement) deleteButton.click();
        ready = ready && await waitFor(() => findVoiceRow()?.querySelector('button[title="确认删除音色记录"]'));
        const confirmButton = findVoiceRow()?.querySelector('button[title="确认删除音色记录"]');
        if (confirmButton instanceof HTMLButtonElement) confirmButton.click();
        ready = ready && await waitFor(() => !findVoiceRow());
        cloneVoice.deleted = !findVoiceRow();
      }
      if (scenarioId === 'minimax-clone-voice-empty-dark-compact') {
        ready = ready && await waitFor(() => document.querySelector('.minimax-clone-voice-empty')?.textContent?.includes('尚未登记'));
        cloneVoice.empty = Boolean(document.querySelector('.minimax-clone-voice-empty')?.textContent?.includes('尚未登记'));
      }
      document.querySelector('.minimax-clone-voice-manager')?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    const stage = ${JSON.stringify(stage ?? '')};
    let stageStatePreserved = true;
    if (stage) {
      const materialTab = document.querySelector('[data-new-task-stage-tab="material"]');
      if (materialTab instanceof HTMLButtonElement) materialTab.click();
      await waitFor(() => document.querySelector('[data-new-task-stage="material"]'));
      const titleInput = document.querySelector('[data-new-task-stage="material"] input');
      if (titleInput instanceof HTMLInputElement) {
        const originalTitle = titleInput.value;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(titleInput, originalTitle + ' QA');
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        const creativeTab = document.querySelector('[data-new-task-stage-tab="creative"]');
        if (creativeTab instanceof HTMLButtonElement) creativeTab.click();
        await waitFor(() => document.querySelector('[data-new-task-stage="creative"]'));
        materialTab.click();
        await waitFor(() => document.querySelector('[data-new-task-stage="material"]'));
        const reopenedTitle = document.querySelector('[data-new-task-stage="material"] input');
        stageStatePreserved = reopenedTitle instanceof HTMLInputElement && reopenedTitle.value === originalTitle + ' QA';
        if (reopenedTitle instanceof HTMLInputElement) {
          setter?.call(reopenedTitle, originalTitle);
          reopenedTitle.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      const stageTab = document.querySelector('[data-new-task-stage-tab="' + stage + '"]');
      if (stageTab instanceof HTMLButtonElement) stageTab.click();
      ready = ready && await waitFor(() => document.querySelector('[data-new-task-stage="' + stage + '"]'));
      if (stage === 'output') {
        const coverModeGroup = document.querySelector('[role="group"][aria-label="封面生成"]');
        const manualButton = [...(coverModeGroup?.querySelectorAll('button') ?? [])]
          .find((button) => button.textContent?.trim() === '手动封面');
        if (manualButton instanceof HTMLButtonElement) manualButton.click();
        ready = ready && await waitFor(() => document.querySelector('[data-manual-cover-state="required"]'));
      }
    }
    await withTimeout(document.fonts.ready, 10000, 'font readiness timed out');
    await withTimeout(
      settleCompositor(),
      10000,
      'scenario compositor settling timed out',
    );
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
    const computed = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(${JSON.stringify(qaComputedTokenNames)}.map((name) => [name, computed.getPropertyValue(name).trim()]));
    const editor = document.querySelector('.new-task-editor')?.getBoundingClientRect();
    const summary = document.querySelector('.new-task-summary')?.getBoundingClientRect();
    const summaryPlacement = !editor || !summary
      ? 'unknown'
      : summary.left >= editor.right - 1
        ? 'right'
          : summary.top >= editor.bottom - 1
            ? 'below'
            : 'unknown';
    const studio = document.querySelector('[data-html-video-studio="html-video"]');
    const studioRegions = studio ? [...studio.querySelectorAll('.hv-studio-parameters, .hv-studio-canvas, .hv-studio-run-rail')].map((region) => region.getBoundingClientRect()) : [];
    const htmlVideoStudioPlacement = studioRegions.length !== 3
      ? 'unknown'
      : studioRegions[1].left >= studioRegions[0].right - 1 && studioRegions[2].left >= studioRegions[1].right - 1
        ? 'three-column'
        : studioRegions[1].top >= studioRegions[0].bottom - 1 && studioRegions[2].top >= studioRegions[1].bottom - 1
          ? 'stacked'
          : 'unknown';
    const htmlVideoParameterContent = studio?.querySelector('.hv-config-editor') ?? studio?.querySelector('.hv-create-details[open]');
    const htmlVideoParameterContentRect = htmlVideoParameterContent?.getBoundingClientRect();
    const htmlVideoCompactParameterOrder = studioRegions.length !== 3 || !htmlVideoParameterContentRect
      ? 'unknown'
      : htmlVideoParameterContentRect.height > 0
        && htmlVideoParameterContentRect.top >= studioRegions[0].top - 1
        && htmlVideoParameterContentRect.bottom <= studioRegions[0].bottom + 1
        && studioRegions[0].bottom <= studioRegions[1].top + 1
        ? 'parameters-first'
        : 'invalid';
    const clippedPrimaryControls = [...document.querySelectorAll('.new-task-workbench button, .new-task-workbench input, .new-task-workbench select, .new-task-workbench textarea, [data-task-operations] button, [data-task-operations] input, [data-task-operations] select, [data-html-video-studio] button, [data-html-video-studio] input, [data-html-video-studio] select, [data-html-video-studio] textarea, .minimax-clone-voice-manager button, .minimax-clone-voice-manager input, .minimax-clone-voice-manager select, .minimax-clone-voice-manager textarea')]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName);
    const manualCoverElement = document.querySelector('[data-manual-cover-state]');
    const manualImportButton = [...document.querySelectorAll('.manual-cover-import button')]
      .find((button) => button.textContent?.includes('导入手动封面'));
    const createButton = [...document.querySelectorAll('.new-task-summary-actions button')]
      .find((button) => button.textContent?.includes('创建并开始任务'));
    return {
      ready,
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio,
      visibleText: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 1000),
      tokens,
      stageStatePreserved,
      deleteDialogFocusWrapped,
      deleteDialogEscapeRestored,
      manualCover: {
        state: manualCoverElement?.getAttribute('data-manual-cover-state') ?? 'inactive',
        importVisible: manualImportButton instanceof HTMLButtonElement && getComputedStyle(manualImportButton).display !== 'none',
        createDisabled: createButton instanceof HTMLButtonElement && createButton.disabled,
      },
      cloneVoice,
      layout: {
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        clippedPrimaryControls,
        summaryPlacement,
        htmlVideoStudioPlacement,
        htmlVideoCompactParameterOrder,
      },
    };
  })()`;
}

async function assertCapturePng(path: string, png: Buffer, bitmap: Buffer, width: number, height: number): Promise<void> {
  const info = await stat(path);
  if (info.size !== png.byteLength || png.byteLength < 256) throw new Error('Editorial QA capture is empty.');
  if (png.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) throw new Error('Editorial QA capture is not PNG.');
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  if (pngWidth !== width || pngHeight !== height) throw new Error(`Editorial QA capture dimensions differ from ${width}x${height}.`);
  const sampledPixels = new Set<string>();
  const pixelCount = Math.floor(bitmap.byteLength / 4);
  const stride = Math.max(1, Math.floor(pixelCount / 2048));
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    sampledPixels.add(bitmap.subarray(offset, offset + 4).toString('hex'));
    if (sampledPixels.size >= 16) break;
  }
  if (sampledPixels.size < 4) throw new Error('Editorial QA capture has insufficient pixel variance.');
}
