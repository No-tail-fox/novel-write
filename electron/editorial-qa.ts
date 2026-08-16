import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BrowserWindow, NativeImage } from 'electron';

export const editorialQaScopes = ['all', 'theme-smoke', 'shell', 'new-task', 'task-operations', 'html-video', 'clone-voice', 'volcengine-tts', 'jianying', 'workflow', 'labs', 'system'] as const;
export type EditorialQaScope = (typeof editorialQaScopes)[number];
export type EditorialQaCaptureRequirement = 'required' | 'supplemental';
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
    { id: 'task-detail-cover-page-light-desktop', view: 'task-detail', theme: 'light', viewport: 'desktop' },
    { id: 'task-detail-draft-delivery-light-desktop', view: 'task-detail', theme: 'light', viewport: 'desktop' },
    { id: 'task-detail-draft-delivery-dark-desktop', view: 'task-detail', theme: 'dark', viewport: 'desktop' },
    { id: 'task-detail-error-summary-desktop', view: 'task-detail', theme: 'light', viewport: 'desktop' },
    { id: 'task-detail-template-menu-dark-desktop', view: 'task-detail', theme: 'dark', viewport: 'desktop' },
    { id: 'task-detail-subtitle-diagnostics-light-desktop', view: 'task-detail', theme: 'light', viewport: 'desktop' },
    { id: 'task-detail-borrowed-image-desktop', view: 'task-detail', theme: 'light', viewport: 'desktop' },
    { id: 'task-detail-scene-video-light-desktop', view: 'task-detail', theme: 'light', viewport: 'desktop' },
    { id: 'task-detail-scene-video-light-compact', view: 'task-detail', theme: 'light', viewport: 'compact' },
    { id: 'task-detail-error-dialog-compact', view: 'task-detail', theme: 'light', viewport: 'compact' },
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
  volcengineTtsStates: [
    { id: 'volcengine-v3-light-desktop', view: 'settings', theme: 'light', viewport: 'desktop' },
    { id: 'volcengine-legacy-dark-compact', view: 'settings', theme: 'dark', viewport: 'compact' },
  ],
  jianyingDetectionStates: [
    { id: 'jianying-auto-detect-light-desktop', view: 'settings', theme: 'light', viewport: 'desktop' },
    { id: 'jianying-auto-detect-dark-compact', view: 'settings', theme: 'dark', viewport: 'compact' },
  ],
} as const;

const qaComputedTokenNames = [
  '--shell-bg', '--shell-surface', '--shell-border', '--shell-text', '--shell-muted',
  '--shell-focus', '--shell-focus-contrast', '--media-bg', '--media-surface',
  '--media-border', '--media-text', '--media-muted', '--media-accent', '--media-accent-contrast',
  '--media-timeline-blue', '--media-reel-amber', '--media-ok',
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
    if (captureCase.id === 'task-detail-borrowed-image-desktop' && (
      state.layout.imagePreviewMeasuredRowCount < 1
      || state.layout.imagePreviewRowHeightSpread > 1
    )) {
      throw new Error(`Editorial QA found uneven or unmeasured image preview cards: ${state.layout.imagePreviewRowHeightSpread}px across ${state.layout.imagePreviewMeasuredRowCount} rows.`);
    }
    if (captureCase.id === 'task-detail-borrowed-image-desktop' && !state.taskImageWorkflowReady) {
      throw new Error('Editorial QA task image copy, paste, scroll preservation, or reference editor workflow failed.');
    }
    if (captureCase.id.startsWith('task-detail-scene-video-') && !state.sceneVideoWorkflowReady) {
      throw new Error(`Editorial QA scene video replace, trim, restore, random, or compact library workflow failed in ${captureCase.id}.`);
    }
    const expectedPlacement = viewport.name === 'compact' ? 'below' : 'right';
    if (captureCase.stage && (!state.stageStatePreserved || !state.presetStatePreserved || state.layout.summaryPlacement !== expectedPlacement)) {
      throw new Error(`Editorial QA new-task interaction/layout failed in ${captureCase.id}.`);
    }
    if (captureCase.stage === 'output' && !state.autoBorrowImageStatePreserved) {
      throw new Error(`Editorial QA image-borrow toggle failed in ${captureCase.id}.`);
    }
    if (captureCase.stage === 'material' && !state.aiBuiltinComposeReady) {
      throw new Error(`Editorial QA AI built-in knowledge compose state failed in ${captureCase.id}.`);
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
    if (captureCase.id === 'history-operations-desktop' && !state.historyHtmlRouteReady) {
      throw new Error('Editorial QA history HTML task did not open its HTML animation workspace.');
    }
    if (captureCase.id === 'task-detail-error-dialog-compact' && !state.errorDialogOpen) {
      throw new Error('Editorial QA failed-task error dialog did not remain open and fully visible.');
    }
    if ((captureCase.id === 'task-detail-operations-desktop' || captureCase.id === 'task-detail-template-menu-dark-desktop') && !state.taskTemplateControlsReady) {
      throw new Error('Editorial QA task draft-template controls are incomplete.');
    }
    if (captureCase.id === 'task-detail-cover-page-light-desktop' && !state.coverPagePreviewReady) {
      throw new Error('Editorial QA ordinary cover-page preview failed.');
    }
    if (captureCase.view === 'draft-templates' && !state.draftLayerPanelReady) {
      throw new Error(`Editorial QA draft-template layer panel did not follow the canvas selection in ${captureCase.id}.`);
    }
    if (captureCase.view === 'draft-templates' && !state.draftUnderlineToggleReady) {
      throw new Error(`Editorial QA draft-template underline toggle blanked or corrupted the renderer in ${captureCase.id}.`);
    }
    if (captureCase.view === 'draft-templates' && !state.draftRangeZeroReady) {
      throw new Error(`Editorial QA draft-template zero range values did not stay synchronized in ${captureCase.id}: ${JSON.stringify(state.draftRangeDiagnostics)}.`);
    }
    if (captureCase.view === 'draft-templates' && !state.draftAnimationPreviewReady) {
      throw new Error(`Editorial QA draft-template compound animation preview did not match its preset in ${captureCase.id}.`);
    }
    if (captureCase.view === 'draft-templates' && !state.draftFontSelectionReady) {
      throw new Error(`Editorial QA draft-template font selection did not update or persist in ${captureCase.id}.`);
    }
    if (captureCase.view === 'draft-templates' && !state.draftImageFitReady) {
      throw new Error(`Editorial QA draft-template image display mode did not update or persist in ${captureCase.id}.`);
    }
    if (captureCase.view === 'draft-templates' && !state.draftImageTransformReady) {
      throw new Error(`Editorial QA draft-template image frame/media transforms did not update or persist in ${captureCase.id}.`);
    }
    if (captureCase.view === 'history' && state.historyHtmlTypeLabel !== 'HTML 动画') {
      throw new Error(`Editorial QA History HTML type label failed in ${captureCase.id}: ${state.historyHtmlTypeLabel}.`);
    }
    if (
      captureCase.view === 'task-detail'
      && !['task-detail-error-summary-desktop', 'task-detail-error-dialog-compact'].includes(captureCase.id)
      && !captureCase.id.startsWith('task-detail-draft-delivery-')
      && !['task-detail-cover-page-light-desktop', 'task-detail-subtitle-diagnostics-light-desktop'].includes(captureCase.id)
      && state.borrowedImageLabel !== '借 #1'
    ) {
      throw new Error(`Editorial QA borrowed-image label failed in ${captureCase.id}: ${state.borrowedImageLabel}.`);
    }
    if (captureCase.view === 'prompt-templates' && captureCase.theme === 'light' && viewport.name === 'desktop' && state.promptTemplateEditorOpen !== true) {
      throw new Error('Editorial QA Prompt Template editor state failed.');
    }
    if (captureCase.id.startsWith('html-video-studio') && state.layout.htmlVideoStudioPlacement !== 'two-column') {
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
    if (captureCase.id.startsWith('volcengine-') && (
      !state.volcengineVersion.v3ValuePreserved
      || !state.volcengineVersion.legacyValuePreserved
      || state.volcengineVersion.selected !== (captureCase.id.includes('-legacy-') ? '旧版接口' : '新版 V3')
      || state.volcengineVersion.v3FieldsVisible === captureCase.id.includes('-legacy-')
      || state.volcengineVersion.legacyFieldsVisible !== captureCase.id.includes('-legacy-')
    )) {
      throw new Error(`Editorial QA Volcengine version switch failed: ${JSON.stringify(state.volcengineVersion)}.`);
    }
    if (captureCase.id.startsWith('jianying-auto-detect-') && (
      state.jianyingDetection.status !== 'pass'
      || !state.jianyingDetection.path.endsWith('configured-draft-root')
      || !state.jianyingDetection.detail.includes('2 个本地草稿')
      || !state.jianyingDetection.inputMatches
      || !state.jianyingDetection.fullPathVisible
      || state.jianyingDetection.checks.length < 3
    )) {
      throw new Error(`Editorial QA Jianying auto detection failed: ${JSON.stringify(state.jianyingDetection)}.`);
    }
    if (state.templateOperationalContrast.failures.length > 0) {
      throw new Error(`Editorial QA template contrast failed in ${captureCase.id}: ${state.templateOperationalContrast.failures.join(', ')}.`);
    }
    const evidenceFailures = crossCuttingEvidenceFailures(state.evidence);
    if (evidenceFailures.length > 0) {
      throw new Error(`Editorial QA cross-cutting evidence failed in ${captureCase.id}: ${evidenceFailures.join(', ')}. Interaction: ${JSON.stringify(state.evidence.interaction)}.`);
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
    const mediaBitmaps = collectMediaBitmapEvidence(image, state.evidence.media.regions);
    state.evidence.media.bitmaps = mediaBitmaps;
    const png = image.toPNG();
    const capturePath = join(config.captures, `${captureCase.id}.png`);
    await writeFile(capturePath, png, { flag: 'wx' });
    await assertCapturePng(capturePath, png, image.toBitmap(), viewport.width, viewport.height);
    captures.push({
      id: captureCase.id,
      requirement: editorialQaCaptureRequirement(captureCase.id),
      view: captureCase.view,
      stage: captureCase.stage,
      theme: captureCase.theme,
      viewport: viewport.name,
      path: basename(capturePath),
      visibleText: state.visibleText,
      tokens: state.tokens,
      themeTransition: state.themeTransition,
      evidence: state.evidence,
      templateOperationalContrast: state.templateOperationalContrast,
      manualCover: state.manualCover,
      cloneVoice: state.cloneVoice,
      volcengineVersion: state.volcengineVersion,
      jianyingDetection: state.jianyingDetection,
      historyHtmlTypeLabel: state.historyHtmlTypeLabel,
      historyHtmlRouteReady: state.historyHtmlRouteReady,
      promptTemplateEditorOpen: state.promptTemplateEditorOpen,
      presetStatePreserved: state.presetStatePreserved,
      autoBorrowImageStatePreserved: state.autoBorrowImageStatePreserved,
      aiBuiltinComposeReady: state.aiBuiltinComposeReady,
      borrowedImageLabel: state.borrowedImageLabel,
      errorDialogOpen: state.errorDialogOpen,
      deleteDialogFocusWrapped: state.deleteDialogFocusWrapped,
      deleteDialogEscapeRestored: state.deleteDialogEscapeRestored,
      taskTemplateControlsReady: state.taskTemplateControlsReady,
      coverPagePreviewReady: state.coverPagePreviewReady,
      draftLayerPanelReady: state.draftLayerPanelReady,
      draftUnderlineToggleReady: state.draftUnderlineToggleReady,
      draftRangeZeroReady: state.draftRangeZeroReady,
      draftAnimationPreviewReady: state.draftAnimationPreviewReady,
      draftFontSelectionReady: state.draftFontSelectionReady,
      draftImageFitReady: state.draftImageFitReady,
      draftImageTransformReady: state.draftImageTransformReady,
      taskImageWorkflowReady: state.taskImageWorkflowReady,
      sceneVideoWorkflowReady: state.sceneVideoWorkflowReady,
    });
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
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    throw new Error(`Editorial QA ${label} failed: ${detail}`);
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

export interface EditorialQaCaptureEvidence {
  identity: {
    expectedView: string;
    actualView: string;
    title: string;
    url: string;
    meaningfulTextLength: number;
    rootChildCount: number;
    matched: boolean;
  };
  runtime: {
    frameworkOverlays: string[];
    consoleErrors: string[];
    pageErrors: string[];
    renderErrors: string[];
  };
  content: {
    unresolvedTokens: string[];
  };
  accessibility: {
    iconOnlyAccessibleNameGaps: string[];
    iconOnlyTooltipGaps: string[];
    textContrastSamples: Array<{ label: string; contrastRatio: number; threshold: number }>;
    textContrastFailures: string[];
    focusContrastSamples: Array<{ label: string; contrastRatio: number }>;
    focusContrastFailures: string[];
  };
  layout: {
    interactiveOverlaps: string[];
  };
  interaction: {
    kind: string;
    target: string;
    performed: boolean;
    verified: boolean;
  };
  media: {
    regions: Array<{
      key: string;
      kind: string;
      x: number;
      y: number;
      width: number;
      height: number;
      pixelWidth: number;
      pixelHeight: number;
      bitmapInset: number;
    }>;
    bitmaps: Array<{
      key: string;
      kind: string;
      x: number;
      y: number;
      width: number;
      height: number;
      sha256: string;
      pixelVariance: number;
    }>;
    failures: string[];
  };
}

export interface EditorialQaCapture {
  id: string;
  requirement: EditorialQaCaptureRequirement;
  view: string;
  stage?: string;
  theme: string;
  viewport: string;
  path: string;
  visibleText: string;
  tokens: Record<string, string>;
  themeTransition: QaScenarioState['themeTransition'];
  evidence: EditorialQaCaptureEvidence;
  templateOperationalContrast: QaScenarioState['templateOperationalContrast'];
  manualCover: QaScenarioState['manualCover'];
  cloneVoice: QaScenarioState['cloneVoice'];
  volcengineVersion: QaScenarioState['volcengineVersion'];
  jianyingDetection: QaScenarioState['jianyingDetection'];
  historyHtmlTypeLabel: string;
  historyHtmlRouteReady: boolean;
  promptTemplateEditorOpen: boolean;
  presetStatePreserved: boolean;
  autoBorrowImageStatePreserved: boolean;
  aiBuiltinComposeReady: boolean;
  borrowedImageLabel: string;
  errorDialogOpen: boolean;
  deleteDialogFocusWrapped: boolean;
  deleteDialogEscapeRestored: boolean;
  taskTemplateControlsReady: boolean;
  coverPagePreviewReady: boolean;
  draftLayerPanelReady: boolean;
  draftUnderlineToggleReady: boolean;
  draftRangeZeroReady: boolean;
  draftAnimationPreviewReady: boolean;
  draftFontSelectionReady: boolean;
  draftImageFitReady: boolean;
  draftImageTransformReady: boolean;
  taskImageWorkflowReady: boolean;
  sceneVideoWorkflowReady: boolean;
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
  themeTransition: {
    performed: boolean;
    forwardStable: boolean;
    backwardStable: boolean;
    mismatchCount: number;
    reversalCount: number;
  };
  evidence: EditorialQaCaptureEvidence;
  templateOperationalContrast: {
    samples: Array<{
      label: string;
      color: string;
      backgroundColor: string;
      contrastRatio: number;
    }>;
    failures: string[];
  };
  stageStatePreserved: boolean;
  presetStatePreserved: boolean;
  autoBorrowImageStatePreserved: boolean;
  aiBuiltinComposeReady: boolean;
  borrowedImageLabel: string;
  errorDialogOpen: boolean;
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
  volcengineVersion: {
    selected: string;
    v3FieldsVisible: boolean;
    legacyFieldsVisible: boolean;
    v3ValuePreserved: boolean;
    legacyValuePreserved: boolean;
  };
  jianyingDetection: {
    status: string;
    path: string;
    detail: string;
    checks: string[];
    inputMatches: boolean;
    fullPathVisible: boolean;
  };
  historyHtmlTypeLabel: string;
  historyHtmlRouteReady: boolean;
  promptTemplateEditorOpen: boolean;
  deleteDialogFocusWrapped: boolean;
  deleteDialogEscapeRestored: boolean;
  taskTemplateControlsReady: boolean;
  coverPagePreviewReady: boolean;
  draftLayerPanelReady: boolean;
  draftUnderlineToggleReady: boolean;
  draftRangeZeroReady: boolean;
  draftRangeDiagnostics: Array<Record<string, unknown>>;
  draftAnimationPreviewReady: boolean;
  draftFontSelectionReady: boolean;
  draftImageFitReady: boolean;
  draftImageTransformReady: boolean;
  taskImageWorkflowReady: boolean;
  sceneVideoWorkflowReady: boolean;
  layout: {
    horizontalOverflow: number;
    clippedPrimaryControls: string[];
    imagePreviewMeasuredRowCount: number;
    imagePreviewRowHeightSpread: number;
    summaryPlacement: 'right' | 'below' | 'unknown';
    htmlVideoStudioPlacement: 'three-column' | 'two-column' | 'stacked' | 'unknown';
    htmlVideoCompactParameterOrder: 'parameters-first' | 'invalid' | 'unknown';
  };
  readiness: {
    taskDetail: {
      currentScene: string;
      imageProgress: string;
      videoReplacements: string;
      templateFrameFound: boolean;
      templateId: string;
      previewSceneId: string;
      previewImageFound: boolean;
      previewImageComplete: boolean;
      previewImageNaturalWidth: number;
      imageTop: string;
      imageHeight: string;
      titleText: string;
      titleFontSize: string;
      titleColor: string;
      titleFontFamily: string;
      subtitleText: string;
      assetState: string;
    } | null;
  };
}

function captureCasesForScope(scope: EditorialQaScope): EditorialQaCaptureCase[] {
  if (scope === 'new-task') return [...editorialQaMatrix.newTaskStates];
  if (scope === 'task-operations') return [...editorialQaMatrix.taskOperationStates];
  if (scope === 'html-video') return [...editorialQaMatrix.htmlVideoStudioStates];
  if (scope === 'clone-voice') return [...editorialQaMatrix.cloneVoiceStates];
  if (scope === 'volcengine-tts') return [...editorialQaMatrix.volcengineTtsStates];
  if (scope === 'jianying') return [...editorialQaMatrix.jianyingDetectionStates];
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
    return [...cases, ...editorialQaMatrix.newTaskStates, ...editorialQaMatrix.taskOperationStates, ...editorialQaMatrix.htmlVideoStudioStates, ...editorialQaMatrix.cloneVoiceStates, ...editorialQaMatrix.volcengineTtsStates];
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

export function editorialQaCaptureIdsByRequirement(requirement: EditorialQaCaptureRequirement): readonly string[] {
  const allIds = editorialQaCaptureIds('all');
  const requiredIds = new Set<string>();
  for (const [group, views] of Object.entries(editorialQaMatrix.views)) {
    if (group === 'shell') continue;
    for (const view of views) {
      if (view === 'new-task' || view === 'task-detail') continue;
      for (const theme of editorialQaMatrix.themes) {
        for (const viewport of editorialQaMatrix.viewports) {
          requiredIds.add(`${group}-${view}-${theme}-${viewport.name}`);
        }
      }
    }
  }
  requiredIds.add('workflow-new-task-dark-desktop');
  requiredIds.add('workflow-task-detail-dark-desktop');
  requiredIds.add('workflow-task-detail-light-desktop');
  for (const captureCase of editorialQaMatrix.newTaskStates) requiredIds.add(captureCase.id);

  const classified = allIds.filter((id) => requirement === 'required' ? requiredIds.has(id) : !requiredIds.has(id));
  if (requiredIds.size !== 67 || allIds.length - requiredIds.size !== 31) {
    throw new Error(`Editorial QA canonical classification drifted: ${requiredIds.size} required of ${allIds.length}.`);
  }
  return classified;
}

export function editorialQaCaptureRequirement(captureId: string): EditorialQaCaptureRequirement {
  if (editorialQaCaptureIdsByRequirement('required').includes(captureId)) return 'required';
  if (editorialQaCaptureIdsByRequirement('supplemental').includes(captureId)) return 'supplemental';
  const scopedIds = editorialQaScopes
    .filter((scope) => scope !== 'all')
    .flatMap((scope) => editorialQaCaptureIds(scope));
  if (scopedIds.includes(captureId)) return 'required';
  throw new Error(`Editorial QA unknown capture id: ${captureId}.`);
}

function crossCuttingEvidenceFailures(evidence: EditorialQaCaptureEvidence): string[] {
  const failures: string[] = [];
  if (!evidence.identity.matched || evidence.identity.meaningfulTextLength < 20 || evidence.identity.rootChildCount < 1) failures.push('identity/nonblank DOM');
  for (const [label, values] of Object.entries({
    frameworkOverlays: evidence.runtime.frameworkOverlays,
    consoleErrors: evidence.runtime.consoleErrors,
    pageErrors: evidence.runtime.pageErrors,
    renderErrors: evidence.runtime.renderErrors,
    unresolvedTokens: evidence.content.unresolvedTokens,
    iconOnlyAccessibleNameGaps: evidence.accessibility.iconOnlyAccessibleNameGaps,
    iconOnlyTooltipGaps: evidence.accessibility.iconOnlyTooltipGaps,
    textContrastFailures: evidence.accessibility.textContrastFailures,
    focusContrastFailures: evidence.accessibility.focusContrastFailures,
    interactiveOverlaps: evidence.layout.interactiveOverlaps,
    mediaFailures: evidence.media.failures,
  })) {
    if (values.length > 0) failures.push(`${label}: ${values.slice(0, 5).join(' | ')}`);
  }
  if (!evidence.interaction.performed || !evidence.interaction.verified) failures.push('non-destructive interaction');
  return failures;
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
    if (!window.__storydreamEditorialQaRuntime) {
      const runtime = { consoleErrors: [], pageErrors: [], cursor: { consoleErrors: 0, pageErrors: 0 } };
      const describe = (value) => {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return String(value); }
      };
      const remember = (target, value) => {
        target.push(String(value).replace(/\\s+/g, ' ').trim().slice(0, 500));
        if (target.length > 100) target.splice(0, target.length - 100);
      };
      const originalConsoleError = console.error.bind(console);
      console.error = (...values) => {
        remember(runtime.consoleErrors, values.map(describe).join(' '));
        originalConsoleError(...values);
      };
      window.addEventListener('error', (event) => remember(runtime.pageErrors, event.error?.stack || event.message || 'window error'));
      window.addEventListener('unhandledrejection', (event) => remember(runtime.pageErrors, 'Unhandled rejection: ' + describe(event.reason)));
      window.__storydreamEditorialQaRuntime = runtime;
    }
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
    const runtimeEvidence = window.__storydreamEditorialQaRuntime || { consoleErrors: [], pageErrors: [], cursor: { consoleErrors: 0, pageErrors: 0 } };
    const runtimeCursor = { ...runtimeEvidence.cursor };
    const waitFor = async (check, timeout = 10000) => {
      const until = Date.now() + timeout;
      while (!check()) { if (Date.now() >= until) return false; await new Promise((resolve) => setTimeout(resolve, 25)); }
      return true;
    };
    const waitForAsync = async (check, timeout = 10000) => {
      const until = Date.now() + timeout;
      while (!await check()) { if (Date.now() >= until) return false; await new Promise((resolve) => setTimeout(resolve, 25)); }
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
    const setRangeInputValue = (input, value) => {
      setInputValue(input, value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
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
    const themeTransition = {
      performed: false,
      forwardStable: true,
      backwardStable: true,
      mismatchCount: 0,
      reversalCount: 0,
    };
    const sampleThemeChange = async (expectedTheme) => {
      const button = document.querySelector('.theme-toggle');
      if (!(button instanceof HTMLButtonElement)) return { stable: false, mismatches: 0, reversals: 0 };
      button.click();
      let targetSeen = false;
      let mismatches = 0;
      let reversals = 0;
      const until = performance.now() + 900;
      while (performance.now() < until) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const rootTheme = document.documentElement.dataset.theme ?? '';
        const providerTheme = document.querySelector('.storydream-provider')?.getAttribute('data-storydream-theme') ?? '';
        if (rootTheme && providerTheme && rootTheme !== providerTheme) mismatches += 1;
        if (rootTheme === expectedTheme && providerTheme === expectedTheme) targetSeen = true;
        else if (targetSeen) reversals += 1;
      }
      const settled = await waitFor(() => {
        const currentButton = document.querySelector('.theme-toggle');
        return document.documentElement.dataset.theme === expectedTheme
          && document.querySelector('.storydream-provider')?.getAttribute('data-storydream-theme') === expectedTheme
          && currentButton instanceof HTMLButtonElement
          && !currentButton.disabled;
      });
      return { stable: targetSeen && settled && mismatches === 0 && reversals === 0, mismatches, reversals };
    };
    if (/^new-task-(?:dark|light)-(?:desktop|compact)$/u.test(scenarioId)) {
      themeTransition.performed = true;
      const oppositeTheme = ${JSON.stringify(theme)} === 'light' ? 'dark' : 'light';
      const forward = await sampleThemeChange(oppositeTheme);
      const backward = await sampleThemeChange(${JSON.stringify(theme)});
      themeTransition.forwardStable = forward.stable;
      themeTransition.backwardStable = backward.stable;
      themeTransition.mismatchCount = forward.mismatches + backward.mismatches;
      themeTransition.reversalCount = forward.reversals + backward.reversals;
    }
    const failedTaskDetailScenario = scenarioId === 'task-detail-error-summary-desktop'
      || scenarioId === 'task-detail-error-dialog-compact';
    const draftDeliveryScenario = scenarioId.startsWith('task-detail-draft-delivery-');
    const coverPageScenario = scenarioId === 'task-detail-cover-page-light-desktop';
    const subtitleDiagnosticsScenario = scenarioId === 'task-detail-subtitle-diagnostics-light-desktop';
    const sceneVideoScenario = scenarioId.startsWith('task-detail-scene-video-');
    const navView = targetView === 'task-detail' ? 'queue' : targetView;
    let nav = document.querySelector('[data-nav-view="' + navView + '"]');
    if (!(nav instanceof HTMLElement)) {
      const contextualToolsTrigger = document.querySelector('[data-contextual-tools-trigger]');
      if (contextualToolsTrigger instanceof HTMLButtonElement) contextualToolsTrigger.click();
      await waitFor(() => document.querySelector('[data-nav-view="' + navView + '"]'));
      nav = document.querySelector('[data-nav-view="' + navView + '"]');
    }
    if (nav instanceof HTMLElement) nav.click();
    if (targetView === 'html-video' && scenarioId.startsWith('html-video-studio')) {
      await waitFor(() => document.querySelector('.hv-create-history select') || document.querySelector('[data-html-video-studio="html-video"]'));
      const taskSelect = document.querySelector('.hv-create-history select');
      if (taskSelect instanceof HTMLSelectElement) {
        const fixtureOption = [...taskSelect.options]
          .find((option) => option.textContent?.includes('武则天：权力之路 HTML 动画'));
        if (fixtureOption) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          setter?.call(taskSelect, fixtureOption.value);
          taskSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
    if (targetView === 'task-detail') {
      await waitFor(() => document.querySelector('[data-task-operations="queue"]'));
      const detailTitle = failedTaskDetailScenario
        ? 'QA 浅色错误提示'
        : draftDeliveryScenario || coverPageScenario
          ? '丝绸之路文化科普'
          : '武则天：从深宫才人到一代女皇';
      const detailRow = [...document.querySelectorAll('.task-queue-row')]
        .find((row) => row.textContent?.includes(detailTitle));
      if (detailRow instanceof HTMLElement) detailRow.click();
    }
    let ready = initialShellReady && themeReady && await waitFor(() => document.querySelector('.app-shell')
      && document.documentElement.dataset.themeReady === 'true'
      && document.querySelector('[data-shell-view="' + targetView + '"]'));
    ready = ready
      && themeTransition.forwardStable
      && themeTransition.backwardStable
      && themeTransition.mismatchCount === 0
      && themeTransition.reversalCount === 0;
    if (targetView === 'task-detail' && !failedTaskDetailScenario && !draftDeliveryScenario && !coverPageScenario) {
      ready = ready && await waitFor(() => [...document.querySelectorAll('.image-card-status')]
        .some((element) => element.textContent?.trim() === '借 #1'));
    }
    let deleteDialogFocusWrapped = scenarioId !== 'history-operations-desktop';
    let deleteDialogEscapeRestored = scenarioId !== 'history-operations-desktop';
    let historyHtmlRouteReady = scenarioId !== 'history-operations-desktop';
    let errorDialogOpen = false;
    if (scenarioId === 'queue-operations-desktop') {
      const latestQueueTitle = document.querySelector('.task-queue-row strong')?.textContent?.trim() ?? '';
      ready = ready && await waitFor(() => {
        const railText = document.querySelector('.task-event-rail-head')?.textContent ?? '';
        const eventStateText = document.querySelector('.task-event-rail')?.textContent ?? '';
        return latestQueueTitle.length > 0
          && railText.includes(latestQueueTitle)
          && (eventStateText.includes('暂无事件') || document.querySelector('.task-event-item'));
      });
      const failedRow = [...document.querySelectorAll('.task-queue-row')]
        .find((row) => row.textContent?.includes('QA 浅色错误提示'));
      const errorSummary = failedRow?.querySelector('.error-summary-button');
      ready = ready
        && errorSummary instanceof HTMLButtonElement
        && errorSummary.textContent?.includes('HTML video planning step failed') === true;
      if (errorSummary instanceof HTMLButtonElement) {
        errorSummary.click();
        ready = ready && await waitFor(() => document.querySelector('.error-dialog')?.textContent?.includes('HTML video planning step failed'));
        const closeButton = [...(document.querySelector('.error-dialog')?.querySelectorAll('button') ?? [])]
          .find((button) => button.textContent?.trim() === '关闭');
        if (closeButton instanceof HTMLButtonElement) closeButton.click();
        ready = ready && await waitFor(() => !document.querySelector('.error-dialog'));
      }
    }
    if (scenarioId === 'task-detail-error-summary-desktop') {
      ready = ready && await waitFor(() => {
        const step = document.querySelector('.task-stage-track .pipeline-step.failed');
        const errorSummary = step?.querySelector('.error-summary-button.compact');
        const errorMark = errorSummary?.querySelector('.error-mark');
        const errorLabel = errorSummary?.querySelector('span:last-child');
        if (!(step instanceof HTMLElement) || !(errorSummary instanceof HTMLButtonElement) || !(errorMark instanceof HTMLElement) || !(errorLabel instanceof HTMLElement)) return false;
        const stepRect = step.getBoundingClientRect();
        const summaryRect = errorSummary.getBoundingClientRect();
        const markRect = errorMark.getBoundingClientRect();
        const markStyle = getComputedStyle(errorMark);
        const labelStyle = getComputedStyle(errorLabel);
        return errorSummary.textContent?.trim().length > 0
          && summaryRect.left >= stepRect.left
          && summaryRect.right <= stepRect.right + 0.5
          && summaryRect.width <= stepRect.width
          && Math.abs((markRect.top + markRect.height / 2) - (summaryRect.top + summaryRect.height / 2)) <= 0.5
          && markStyle.display === 'grid'
          && markStyle.marginTop === '0px'
          && labelStyle.display === 'block'
          && labelStyle.overflow === 'hidden'
          && labelStyle.textOverflow === 'ellipsis'
          && labelStyle.whiteSpace === 'nowrap';
      });
    }
    if (scenarioId === 'task-detail-error-dialog-compact') {
      let errorSummary = null;
      const errorSummaryReady = await waitFor(() => {
        const candidate = document.querySelector('.task-detail-shell .error-summary-button');
        if (!(candidate instanceof HTMLButtonElement)) return false;
        errorSummary = candidate;
        return true;
      });
      ready = ready && errorSummaryReady;
      if (errorSummary instanceof HTMLButtonElement) errorSummary.click();
      const errorDialogReady = await waitFor(() => {
        const dialog = document.querySelector('.error-dialog');
        const title = dialog?.querySelector('.error-dialog-head strong');
        const closeButton = dialog?.querySelector('.error-dialog-head .mini-button');
        if (!(dialog instanceof HTMLElement) || !(title instanceof HTMLElement) || !(closeButton instanceof HTMLButtonElement)) return false;
        const rect = dialog.getBoundingClientRect();
        return dialog.textContent?.includes('HTML video planning step failed') === true
          && title.textContent?.trim().length > 0
          && rect.left >= 0
          && rect.top >= 0
          && rect.right <= window.innerWidth
          && rect.bottom <= window.innerHeight;
      });
      ready = ready && errorDialogReady;
      errorDialogOpen = errorDialogReady && Boolean(document.querySelector('.error-dialog'));
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
      const htmlHistoryRow = [...document.querySelectorAll('.history-page .table-row')]
        .find((row) => row.textContent?.includes('武则天：权力之路 HTML 动画'));
      const htmlHistoryButton = htmlHistoryRow?.querySelector('.table-row-primary-action');
      if (htmlHistoryButton instanceof HTMLButtonElement) htmlHistoryButton.click();
      historyHtmlRouteReady = htmlHistoryButton instanceof HTMLButtonElement && await waitFor(() => {
        const shell = document.querySelector('[data-shell-view="html-video"]');
        const studio = document.querySelector('[data-html-video-studio="html-video"]');
        const taskTitle = studio?.querySelector('.hv-studio-parameters h2')?.textContent?.trim() ?? '';
        return shell instanceof HTMLElement
          && studio instanceof HTMLElement
          && taskTitle === '武则天：权力之路 HTML 动画';
      });
      ready = ready && historyHtmlRouteReady;
      const historyNav = document.querySelector('[data-nav-view="history"]');
      if (historyNav instanceof HTMLButtonElement) historyNav.click();
      ready = ready && await waitFor(() => document.querySelector('[data-shell-view="history"]')
        && [...document.querySelectorAll('.history-page .table-row')]
          .some((row) => row.textContent?.includes('武则天：权力之路 HTML 动画')));
    }
    if (targetView === 'voice-lab') {
      const providerGroup = document.querySelector('[role="group"][aria-label="配音模型"]');
      const minimaxButton = [...(providerGroup?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === 'MiniMax');
      ready = ready && minimaxButton instanceof HTMLButtonElement;
      if (minimaxButton instanceof HTMLButtonElement) minimaxButton.click();
      ready = ready && await waitFor(() => document.querySelectorAll('.voice-lab-voice-list .chip').length === 18);
      const searchInput = document.querySelector('input[aria-label="搜索音色"]');
      if (searchInput instanceof HTMLInputElement) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        valueSetter?.call(searchInput, '有声书');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        ready = ready && await waitFor(() => document.querySelectorAll('.voice-lab-voice-list .chip').length === 4);
        valueSetter?.call(searchInput, '');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        ready = ready && await waitFor(() => document.querySelectorAll('.voice-lab-voice-list .chip').length === 18);
      } else {
        ready = false;
      }
    }
    let historyHtmlTypeLabel = '';
    if (targetView === 'history') {
      const findHtmlHistoryRow = () => [...document.querySelectorAll('.history-page .table-row')]
        .find((row) => row.textContent?.includes('武则天：权力之路 HTML 动画'));
      ready = ready && await waitFor(() => Boolean(findHtmlHistoryRow()));
      historyHtmlTypeLabel = findHtmlHistoryRow()
        ?.querySelector('[role="cell"]:nth-child(2)')
        ?.textContent
        ?.trim() ?? '';
    }
    let draftLayerPanelReady = targetView !== 'draft-templates';
    let draftUnderlineToggleReady = targetView !== 'draft-templates';
    let draftRangeZeroReady = targetView !== 'draft-templates';
    const draftRangeDiagnostics = [];
    let draftAnimationPreviewReady = targetView !== 'draft-templates';
    let draftFontSelectionReady = targetView !== 'draft-templates';
    let draftImageFitReady = targetView !== 'draft-templates';
    let draftImageTransformReady = targetView !== 'draft-templates';
    let taskImageWorkflowReady = scenarioId !== 'task-detail-borrowed-image-desktop';
    let sceneVideoWorkflowReady = !sceneVideoScenario;
    if (targetView === 'draft-templates') {
      const templateActionsReady = await waitFor(() => {
        const actionRow = document.querySelector('.draft-template-actions.has-delete');
        const buttons = [...(actionRow?.querySelectorAll(':scope > button') ?? [])];
        if (!(actionRow instanceof HTMLElement) || buttons.length !== 3 || buttons.some((button) => !(button instanceof HTMLButtonElement))) return false;
        const labels = buttons.map((button) => button.textContent?.trim() ?? '');
        const rects = buttons.map((button) => button.getBoundingClientRect());
        const topSpread = Math.max(...rects.map((rect) => rect.top)) - Math.min(...rects.map((rect) => rect.top));
        const bottomSpread = Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.bottom));
        const widthSpread = Math.max(...rects.map((rect) => rect.width)) - Math.min(...rects.map((rect) => rect.width));
        return labels.join('|') === '编辑|复制|删除'
          && rects.every((rect) => rect.width >= 56 && rect.height >= 34)
          && topSpread <= 1
          && bottomSpread <= 1
          && widthSpread <= 1;
      });
      ready = ready && templateActionsReady;
      const editButton = [...document.querySelectorAll('.draft-template-actions.has-delete button')]
        .find((button) => button.textContent?.trim() === '编辑');
      if (editButton instanceof HTMLButtonElement) editButton.click();
      const editorOpened = await waitFor(() => document.querySelector('.draft-editor-shell.focused .editable-draft-canvas'));
      ready = ready && editorOpened;
      if (editorOpened) {
        const controls = document.querySelector('.draft-controls');
        const stage = document.querySelector('.draft-stage');
        const page = document.querySelector('.draft-template-page');
        const subtitleLayer = document.querySelector('.editable-draft-canvas .draft-layer[data-layer="subtitle"]');
        if (controls instanceof HTMLElement && stage instanceof HTMLElement && page instanceof HTMLElement && subtitleLayer instanceof HTMLElement) {
          const zeroRangeLabels = ['图片边框宽度', '运镜强度'];
          const motionAccordionButton = [...controls.querySelectorAll('.accordion > button')]
            .find((button) => button.textContent?.includes('运镜'));
          if (motionAccordionButton instanceof HTMLButtonElement && motionAccordionButton.getAttribute('aria-expanded') !== 'true') {
            motionAccordionButton.click();
            await waitFor(() => controls.querySelector('input[aria-label="运镜强度滑块"]'));
          }
          const frameAccordionButton = [...controls.querySelectorAll('.accordion > button')]
            .find((button) => button.textContent?.includes('分栏画框'));
          if (frameAccordionButton instanceof HTMLButtonElement && frameAccordionButton.getAttribute('aria-expanded') !== 'true') {
            frameAccordionButton.click();
            await waitFor(() => controls.querySelector('input[aria-label="图片边框宽度滑块"]'));
          }
          const rangeSnapshots = zeroRangeLabels.map((label) => {
            const range = controls.querySelector('input[aria-label="' + label + '滑块"]');
            return range instanceof HTMLInputElement ? { label, value: range.value } : null;
          });
          if (rangeSnapshots.every((snapshot) => snapshot !== null)) {
            draftRangeZeroReady = true;
            for (const snapshot of rangeSnapshots) {
              const range = controls.querySelector('input[aria-label="' + snapshot.label + '滑块"]');
              if (range instanceof HTMLInputElement) setRangeInputValue(range, '0');
              const synchronized = await waitFor(() => {
                const currentRange = controls.querySelector('input[aria-label="' + snapshot.label + '滑块"]');
                const number = controls.querySelector('input[aria-label="' + snapshot.label + '数值"]');
                const progress = currentRange instanceof HTMLInputElement
                  ? Number.parseFloat(getComputedStyle(currentRange).getPropertyValue('--range-progress'))
                  : Number.NaN;
                return currentRange instanceof HTMLInputElement
                  && number instanceof HTMLInputElement
                  && currentRange.valueAsNumber === 0
                  && number.valueAsNumber === 0
                  && progress === 0;
              });
              draftRangeZeroReady = draftRangeZeroReady && synchronized;
              const currentRange = controls.querySelector('input[aria-label="' + snapshot.label + '滑块"]');
              const number = controls.querySelector('input[aria-label="' + snapshot.label + '数值"]');
              draftRangeDiagnostics.push({
                phase: 'zero',
                label: snapshot.label,
                synchronized,
                min: currentRange instanceof HTMLInputElement ? currentRange.min : '',
                range: currentRange instanceof HTMLInputElement ? currentRange.value : '',
                number: number instanceof HTMLInputElement ? number.value : '',
                progress: currentRange instanceof HTMLInputElement
                  ? getComputedStyle(currentRange).getPropertyValue('--range-progress').trim()
                  : '',
              });
            }
            for (const snapshot of rangeSnapshots) {
              const range = controls.querySelector('input[aria-label="' + snapshot.label + '滑块"]');
              if (range instanceof HTMLInputElement) setRangeInputValue(range, snapshot.value);
              const restored = await waitFor(() => {
                const currentRange = controls.querySelector('input[aria-label="' + snapshot.label + '滑块"]');
                return currentRange instanceof HTMLInputElement && currentRange.value === snapshot.value;
              });
              draftRangeZeroReady = draftRangeZeroReady && restored;
              draftRangeDiagnostics.push({ phase: 'restore', label: snapshot.label, restored, expected: snapshot.value });
            }
          }

          const animationCases = [
            ['向左缩小', 'slide-shrink-left'],
            ['旋转上升', 'spin-rise'],
            ['波动滑出', 'wave'],
          ];
          let animationCasesReady = true;
          for (const [label, previewKind] of animationCases) {
            const button = [...controls.querySelectorAll('.draft-animation-picker button')]
              .find((candidate) => candidate.textContent?.trim() === label);
            if (!(button instanceof HTMLButtonElement)) {
              animationCasesReady = false;
              continue;
            }
            button.focus();
            const previewed = await waitFor(() => document.querySelector('.editable-draft-canvas .image-layer')?.getAttribute('data-animation-preview') === previewKind);
            button.blur();
            const restored = await waitFor(() => document.querySelector('.editable-draft-canvas .image-layer')?.getAttribute('data-animation-preview') === 'none');
            animationCasesReady = animationCasesReady && previewed && restored;
          }
          draftAnimationPreviewReady = animationCasesReady;

          const pageScrollBefore = page.scrollTop;
          const stageScrollBefore = stage.scrollTop;
          const layerRect = subtitleLayer.getBoundingClientRect();
          Object.defineProperty(subtitleLayer, 'setPointerCapture', { configurable: true, value: () => undefined });
          subtitleLayer.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 71,
            pointerType: 'mouse',
            clientX: layerRect.left + layerRect.width / 2,
            clientY: layerRect.top + layerRect.height / 2,
            button: 0,
            buttons: 1,
          }));
          delete subtitleLayer.setPointerCapture;
          document.querySelector('.editable-draft-canvas')?.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 71,
            pointerType: 'mouse',
            button: 0,
          }));
          draftLayerPanelReady = await waitFor(() => {
            const selectedLayer = document.querySelector('.editable-draft-canvas .draft-layer[data-layer="subtitle"].selected');
            const panel = controls.querySelector('[data-draft-layer-panel="subtitle"]');
            const button = panel?.querySelector(':scope .accordion > button');
            if (!(selectedLayer instanceof HTMLElement) || !(panel instanceof HTMLElement) || button?.getAttribute('aria-expanded') !== 'true') return false;
            const controlsRect = controls.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            return panelRect.top >= controlsRect.top + 3
              && panelRect.top <= controlsRect.top + 24
              && controls.scrollTop > 0
              && page.scrollTop === pageScrollBefore
              && stage.scrollTop === stageScrollBefore;
          });

          const underlineLayers = [
            { layer: 'title', textSelector: '.draft-title' },
            { layer: 'subtitle', textSelector: '.draft-subtitle' },
            { layer: 'caption', textSelector: '.draft-caption' },
            { layer: 'disclaimer', textSelector: '.draft-disclaimer' },
          ];
          let layerTogglesReady = true;
          for (const definition of underlineLayers) {
            const panel = controls.querySelector('[data-draft-layer-panel="' + definition.layer + '"]');
            const panelButton = panel?.querySelector(':scope .accordion > button');
            if (panelButton instanceof HTMLButtonElement && panelButton.getAttribute('aria-expanded') !== 'true') panelButton.click();
            const panelOpened = await waitFor(() => panelButton?.getAttribute('aria-expanded') === 'true');
            const underlineToggle = panel?.querySelector('input[aria-label="下划线"]');
            if (!panelOpened || !(underlineToggle instanceof HTMLInputElement)) {
              layerTogglesReady = false;
              continue;
            }
            if (!underlineToggle.checked) underlineToggle.click();
            const enabledReady = await waitFor(() => {
              const text = document.querySelector('.editable-draft-canvas .draft-layer[data-layer="' + definition.layer + '"] ' + definition.textSelector);
              const content = text?.querySelector('.draft-text-content');
              return underlineToggle.checked
                && text instanceof HTMLElement
                && text.dataset.draftUnderline === 'on'
                && content instanceof HTMLElement
                && content.classList.contains('underlined')
                && getComputedStyle(text).textDecorationLine === 'none';
            });
            underlineToggle.click();
            const disabledReady = await waitFor(() => {
              const text = document.querySelector('.editable-draft-canvas .draft-layer[data-layer="' + definition.layer + '"] ' + definition.textSelector);
              const content = text?.querySelector('.draft-text-content');
              return !underlineToggle.checked
                && text instanceof HTMLElement
                && text.dataset.draftUnderline === 'off'
                && content instanceof HTMLElement
                && !content.classList.contains('underlined')
                && getComputedStyle(text).textDecorationLine === 'none';
            });
            layerTogglesReady = layerTogglesReady && enabledReady && disabledReady;
          }

          const fontSelections = [
            { label: '主标题字体', value: '得意黑', textSelector: '.draft-title', cssFamily: 'SimHei' },
            { label: '字幕字体', value: '宋体', textSelector: '.draft-caption', cssFamily: 'SimSun' },
          ];
          const fontCatalogReady = [...controls.querySelectorAll('select[aria-label$="字体"]')]
            .every((select) => select instanceof HTMLSelectElement
              && select.options.length === 28
              && select.querySelectorAll('optgroup').length === 6
              && [...select.options].some((option) => option.value === 'SourceHanSansCN_Regular')
              && [...select.options].some((option) => option.value === 'ResourceHanRoundedCN_Bold')
              && [...select.options].some((option) => option.value === '江湖体'));
          let fontSelectionsLiveReady = fontCatalogReady;
          for (const definition of fontSelections) {
            const select = controls.querySelector('select[aria-label="' + definition.label + '"]');
            if (!(select instanceof HTMLSelectElement)) {
              fontSelectionsLiveReady = false;
              continue;
            }
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            valueSetter?.call(select, definition.value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            const applied = await waitFor(() => {
              const text = document.querySelector('.editable-draft-canvas ' + definition.textSelector);
              return select.value === definition.value
                && text instanceof HTMLElement
                && getComputedStyle(text).fontFamily.includes(definition.cssFamily);
            });
            fontSelectionsLiveReady = fontSelectionsLiveReady && applied;
          }

          const imageFitGroup = controls.querySelector('[role="group"][aria-label="图片显示"]');
          const imageFitButtons = [...(imageFitGroup?.querySelectorAll('button') ?? [])];
          const cropFillButton = imageFitButtons.find((button) => button.textContent?.trim() === '裁切填满');
          const fullImageButton = imageFitButtons.find((button) => button.textContent?.trim() === '完整缩放');
          let imageFitLiveReady = imageFitButtons.map((button) => button.textContent?.trim()).join('|') === '裁切填满|完整缩放';
          if (cropFillButton instanceof HTMLButtonElement) cropFillButton.click();
          const objectButtonsReady = await waitFor(() => {
            const group = controls.querySelector('[role="group"][aria-label="编辑对象"]');
            return [...(group?.querySelectorAll('button') ?? [])].map((button) => button.textContent?.trim()).join('|') === '展示框|实际图片';
          });
          const findObjectButton = (label) => [...controls.querySelectorAll('[role="group"][aria-label="编辑对象"] button')]
            .find((button) => button.textContent?.trim() === label);
          const findRange = (label) => controls.querySelector('input[aria-label="' + label + '滑块"]');
          const frameObjectButton = findObjectButton('展示框');
          if (frameObjectButton instanceof HTMLButtonElement) frameObjectButton.click();
          let imageTransformLiveReady = objectButtonsReady && await waitFor(() => {
            const frameBox = document.querySelector('.editable-draft-canvas [data-layer="image-frame"]');
            return frameBox instanceof HTMLElement
              && frameBox.dataset.selected === 'true'
              && frameBox.querySelectorAll('.draft-transform-handle').length === 8;
          });
          for (const [label, value] of [['展示框宽度', 0.72], ['展示框高度', 0.62], ['水平位置', 0.12], ['垂直位置', 0.18]]) {
            const range = findRange(label);
            if (range instanceof HTMLInputElement) setRangeInputValue(range, value);
            else imageTransformLiveReady = false;
          }
          const mediaObjectButton = findObjectButton('实际图片');
          if (mediaObjectButton instanceof HTMLButtonElement) mediaObjectButton.click();
          imageTransformLiveReady = imageTransformLiveReady && await waitFor(() => {
            const mediaBox = document.querySelector('.editable-draft-canvas [data-layer="image-media"]');
            return mediaBox instanceof HTMLElement
              && mediaBox.dataset.selected === 'true'
              && mediaBox.querySelectorAll('.draft-transform-handle').length === 8;
          });
          for (const [label, value] of [['图片缩放', 1.4], ['水平取景', 0.25], ['垂直取景', 0.75]]) {
            const range = findRange(label);
            if (range instanceof HTMLInputElement) setRangeInputValue(range, value);
            else imageTransformLiveReady = false;
          }
          const mediaBox = document.querySelector('.editable-draft-canvas [data-layer="image-media"]');
          let pointerMoved = false;
          if (mediaBox instanceof HTMLElement) {
            const canvas = document.querySelector('.editable-draft-canvas');
            const mediaRect = mediaBox.getBoundingClientRect();
            const beforeLeft = mediaBox.style.left;
            Object.defineProperty(mediaBox, 'setPointerCapture', { configurable: true, value: () => undefined });
            mediaBox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 83, pointerType: 'mouse', clientX: mediaRect.left + mediaRect.width / 2, clientY: mediaRect.top + mediaRect.height / 2, button: 0, buttons: 1 }));
            canvas?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 83, pointerType: 'mouse', clientX: mediaRect.left + mediaRect.width / 2 + 14, clientY: mediaRect.top + mediaRect.height / 2 - 10, button: 0, buttons: 1 }));
            canvas?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 83, pointerType: 'mouse', button: 0 }));
            delete mediaBox.setPointerCapture;
            pointerMoved = await waitFor(() => document.querySelector('.editable-draft-canvas [data-layer="image-media"]')?.style.left !== beforeLeft);
          }
          imageTransformLiveReady = imageTransformLiveReady && pointerMoved;
          for (const [label, value] of [['水平取景', 0.25], ['垂直取景', 0.75]]) {
            const range = findRange(label);
            if (range instanceof HTMLInputElement) setRangeInputValue(range, value);
          }
          if (fullImageButton instanceof HTMLButtonElement) fullImageButton.click();
          imageFitLiveReady = imageFitLiveReady && await waitFor(() => {
            const media = document.querySelector('.editable-draft-canvas .draft-image-media');
            return fullImageButton instanceof HTMLButtonElement
              && fullImageButton.getAttribute('aria-pressed') === 'true'
              && !document.querySelector('.editable-draft-canvas [data-layer="image-media"]')
              && media instanceof HTMLElement
              && media.style.objectFit === 'contain';
          });
          if (cropFillButton instanceof HTMLButtonElement) cropFillButton.click();
          imageFitLiveReady = imageFitLiveReady && await waitFor(() => Boolean(document.querySelector('.editable-draft-canvas [data-layer="image-media"]')));

          const shellStayedVisible = await waitFor(() => {
            const shell = document.querySelector('.app-shell');
            const canvas = document.querySelector('.editable-draft-canvas');
            const image = canvas?.querySelector('.draft-image-transform-box[data-layer="image-frame"]');
            return shell instanceof HTMLElement
              && canvas instanceof HTMLElement
              && image instanceof HTMLElement
              && getComputedStyle(shell).visibility === 'visible'
              && document.documentElement.dataset.themeReady === 'true';
          });
          const saveButton = [...document.querySelectorAll('.editor-topbar button')]
            .find((button) => button.textContent?.trim() === '保存');
          if (saveButton instanceof HTMLButtonElement) saveButton.click();
          const persistenceReady = api && saveButton instanceof HTMLButtonElement
            ? await withTimeout((async () => {
                const until = Date.now() + 10000;
                while (Date.now() < until) {
                  const persisted = await api.getDraftTemplateDetail('qa-selected-draft-template');
                  if (
                    persisted
                    && underlineLayers.every(({ layer }) => persisted[layer]?.underline === false)
                    && persisted.title?.fontFamily === '得意黑'
                    && persisted.caption?.fontFamily === '宋体'
                    && persisted.image?.fit === 'cover'
                    && persisted.image?.left === 0.12
                    && persisted.image?.top === 0.18
                    && persisted.image?.width === 0.72
                    && persisted.image?.height === 0.62
                    && persisted.image?.mediaScale === 1.4
                    && persisted.image?.focusX === 0.25
                    && persisted.image?.focusY === 0.75
                  ) return true;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                return false;
              })(), 12000, 'draft underline persistence timed out')
            : false;
          const returnButton = [...document.querySelectorAll('.editor-topbar button')]
            .find((button) => button.textContent?.trim() === '返回模板列表');
          if (returnButton instanceof HTMLButtonElement) returnButton.click();
          const returnedToGallery = await waitFor(() => document.querySelector('.draft-template-actions.has-delete'));
          const savedCard = [...document.querySelectorAll('.draft-template-card')]
            .find((card) => card.textContent?.includes('QA 已选草稿模板'));
          const galleryImageFitReady = savedCard?.textContent?.includes('裁切填满') === true;
          const reopenButton = [...(savedCard?.querySelectorAll('.draft-template-actions button') ?? [])]
            .find((button) => button.textContent?.trim() === '编辑');
          if (reopenButton instanceof HTMLButtonElement) reopenButton.click();
          const reopened = returnedToGallery && await waitFor(() => {
            const canvas = document.querySelector('.editable-draft-canvas');
            const title = canvas?.querySelector('.draft-title');
            const caption = canvas?.querySelector('.draft-caption');
            const imageFitButton = [...document.querySelectorAll('[role="group"][aria-label="图片显示"] button')]
              .find((button) => button.textContent?.trim() === '裁切填满');
            const frameBox = canvas?.querySelector('[data-layer="image-frame"]');
            const mediaBox = canvas?.querySelector('[data-layer="image-media"]');
            return canvas instanceof HTMLElement
              && title instanceof HTMLElement
              && caption instanceof HTMLElement
              && getComputedStyle(title).fontFamily.includes('SimHei')
              && getComputedStyle(caption).fontFamily.includes('SimSun')
              && imageFitButton instanceof HTMLButtonElement
              && imageFitButton.getAttribute('aria-pressed') === 'true'
              && frameBox instanceof HTMLElement
              && mediaBox instanceof HTMLElement
              && frameBox.style.left === '12%'
              && frameBox.style.top === '18%'
              && frameBox.style.width === '72%'
              && frameBox.style.height === '62%'
              && underlineLayers.every((definition) => {
              const text = canvas.querySelector('.draft-layer[data-layer="' + definition.layer + '"] ' + definition.textSelector);
              return text instanceof HTMLElement
                && text.dataset.draftUnderline === 'off'
                && !text.querySelector('.draft-text-content')?.classList.contains('underlined');
            });
          });
          draftUnderlineToggleReady = layerTogglesReady && shellStayedVisible && persistenceReady && reopened;
          draftFontSelectionReady = fontSelectionsLiveReady && shellStayedVisible && persistenceReady && reopened;
          draftImageFitReady = imageFitLiveReady && shellStayedVisible && persistenceReady && galleryImageFitReady && reopened;
          draftImageTransformReady = imageTransformLiveReady && shellStayedVisible && persistenceReady && reopened;
        }
      }
    }
    const taskTemplateScenario = scenarioId === 'task-detail-operations-desktop' || scenarioId === 'task-detail-template-menu-dark-desktop';
    let taskTemplateControlsReady = !taskTemplateScenario;
    const collectTaskDetailReadiness = () => {
      const templateFrame = document.querySelector('.task-media-frame[data-draft-template-id][data-preview-scene-id="1"]');
      const previewImage = templateFrame?.querySelector('.draft-image-asset');
      const imageFrame = templateFrame?.querySelector('.draft-image');
      const title = templateFrame?.querySelector('.draft-title');
      const subtitle = templateFrame?.querySelector('.draft-subtitle');
      const titleStyle = title instanceof HTMLElement ? getComputedStyle(title) : null;
      const imageProgressRow = [...document.querySelectorAll('.preview-meta-grid > div')]
        .find((row) => row.querySelector('small')?.textContent?.trim() === '图片进度');
      return {
        currentScene: document.querySelector('.task-media-scene-count')?.textContent?.trim() ?? '',
        imageProgress: imageProgressRow?.querySelector('strong')?.textContent?.trim() ?? '',
        videoReplacements: document.querySelector('.task-scene-rail > div:first-child > span')?.textContent?.trim() ?? '',
        templateFrameFound: templateFrame instanceof HTMLElement,
        templateId: templateFrame?.getAttribute('data-draft-template-id') ?? '',
        previewSceneId: templateFrame?.getAttribute('data-preview-scene-id') ?? '',
        previewImageFound: previewImage instanceof HTMLImageElement,
        previewImageComplete: previewImage instanceof HTMLImageElement && previewImage.complete,
        previewImageNaturalWidth: previewImage instanceof HTMLImageElement ? previewImage.naturalWidth : 0,
        imageTop: imageFrame instanceof HTMLElement ? imageFrame.style.top : '',
        imageHeight: imageFrame instanceof HTMLElement ? imageFrame.style.height : '',
        titleText: title?.textContent?.trim() ?? '',
        titleFontSize: titleStyle?.fontSize ?? '',
        titleColor: titleStyle?.color ?? '',
        titleFontFamily: titleStyle?.fontFamily ?? '',
        subtitleText: subtitle?.textContent?.trim() ?? '',
        assetState: templateFrame?.querySelector('.task-media-asset-state')?.textContent?.trim() ?? '',
      };
    };
    let taskDetailReadiness = targetView === 'task-detail' ? collectTaskDetailReadiness() : null;
    if (taskTemplateScenario) {
      ready = ready && await waitFor(() => {
        const state = collectTaskDetailReadiness();
        const templateFrame = document.querySelector('.task-media-frame[data-draft-template-id][data-preview-scene-id="1"]');
        const previewImage = templateFrame?.querySelector('.draft-image-asset');
        return state.currentScene === '01 / 12'
          && state.imageProgress === '8/12 张 · 生成中'
          && state.videoReplacements === '0 个视频替换'
          && state.templateId === 'qa-selected-draft-template'
          && state.imageTop === '22%'
          && state.imageHeight === '44%'
          && state.titleText === '深宫沉默十二年'
            && Number.parseFloat(state.titleFontSize) >= 36
            && Number.parseFloat(state.titleFontSize) <= 64
          && state.titleColor === 'rgb(56, 242, 176)'
          && state.titleFontFamily.includes('Microsoft YaHei')
          && state.subtitleText === '最后走成唯一女皇'
          && previewImage instanceof HTMLImageElement
          && previewImage.complete
          && previewImage.naturalWidth > 0
          && !state.assetState;
      });
      const templateSelect = document.querySelector('button.task-template-select-trigger[aria-label="选择任务草稿模板"]');
      const templateApply = document.querySelector('.task-template-apply');
      const templateManager = document.querySelector('button[aria-label="管理草稿模板"]');
      const templateSwitcher = document.querySelector('.task-template-switcher');
      taskTemplateControlsReady = templateSelect instanceof HTMLButtonElement
        && templateSelect.textContent?.includes('QA 已选草稿模板') === true
        && templateSelect.getAttribute('aria-haspopup') === 'listbox'
        && templateApply instanceof HTMLButtonElement
        && templateApply.disabled
        && templateApply.textContent?.trim() === '已应用'
        && templateSwitcher instanceof HTMLElement
        && templateSwitcher.dataset.appliedTemplateId === 'qa-selected-draft-template'
        && templateSwitcher.dataset.candidateTemplateId === 'qa-selected-draft-template'
        && templateSwitcher.dataset.templateState === 'applied'
        && templateManager instanceof HTMLButtonElement
        && !templateManager.disabled;
      if (scenarioId === 'task-detail-template-menu-dark-desktop' && templateSelect instanceof HTMLButtonElement) {
        templateSelect.scrollIntoView({ block: 'center' });
        await waitFor(() => {
          const triggerRect = templateSelect.getBoundingClientRect();
          return triggerRect.top >= 0 && triggerRect.bottom <= window.innerHeight;
        });
        templateSelect.click();
        const menuReady = await waitFor(() => {
          const menu = document.querySelector('.task-template-select-menu[role="listbox"]');
          const field = document.querySelector('.task-template-field');
          const options = [...(menu?.querySelectorAll('[role="option"]') ?? [])];
          if (!(menu instanceof HTMLElement) || !(field instanceof HTMLElement) || options.length < 2) return false;
          const menuRect = menu.getBoundingClientRect();
          const menuBackground = getComputedStyle(menu).backgroundColor;
          const fieldBackground = getComputedStyle(field).backgroundColor;
          return templateSelect.getAttribute('aria-expanded') === 'true'
            && options.some((option) => option.getAttribute('aria-selected') === 'true' && option.textContent?.includes('QA 已选草稿模板'))
            && menuBackground === fieldBackground
            && menuBackground !== 'rgb(255, 255, 255)'
            && menuRect.left >= 0
            && menuRect.right <= window.innerWidth
            && menuRect.bottom <= window.innerHeight;
        });
        const alternativeOption = document.querySelector('[role="option"][data-template-id="builtin-portrait-4-3"]');
        if (alternativeOption instanceof HTMLElement) alternativeOption.click();
        const pendingReady = await waitFor(() => templateApply instanceof HTMLButtonElement
          && templateSwitcher instanceof HTMLElement
          && templateSelect.textContent?.includes('竖屏4:3') === true
          && !templateApply.disabled
          && templateApply.textContent?.trim() === '应用模板'
          && getComputedStyle(templateApply).color === 'rgb(16, 18, 20)'
          && templateSwitcher.dataset.appliedTemplateId === 'qa-selected-draft-template'
          && templateSwitcher.dataset.candidateTemplateId === 'builtin-portrait-4-3'
          && templateSwitcher.dataset.templateState === 'pending');
        const taskShell = document.querySelector('.task-detail-shell[data-task-id]');
        const taskId = taskShell instanceof HTMLElement ? taskShell.dataset.taskId ?? '' : '';
        const persistedTask = api && taskId
          ? await withTimeout(api.getTaskDetail(taskId), 10000, 'task template persistence read timed out')
          : null;
        const appliedStayedFixed = persistedTask?.templateId === 'qa-selected-draft-template';
        if (pendingReady) templateSelect.click();
        const pendingMenuReady = await waitFor(() => {
          const menu = document.querySelector('.task-template-select-menu[role="listbox"]');
          const selectedOption = menu?.querySelector('[role="option"][aria-selected="true"]');
          return templateSelect.getAttribute('aria-expanded') === 'true'
            && selectedOption?.getAttribute('data-template-id') === 'builtin-portrait-4-3';
        });
        taskTemplateControlsReady = taskTemplateControlsReady
          && menuReady
          && pendingReady
          && appliedStayedFixed
          && pendingMenuReady;
      }
      ready = ready && taskTemplateControlsReady;
      taskDetailReadiness = collectTaskDetailReadiness();
    }
    if (scenarioId === 'task-detail-borrowed-image-desktop') {
      const pauseButton = [...document.querySelectorAll('.task-detail-run-control')]
        .find((button) => button.textContent?.trim() === '暂停任务');
      if (pauseButton instanceof HTMLButtonElement) pauseButton.click();
      const pausedReady = await waitFor(() => [...document.querySelectorAll('.task-detail-run-control')]
        .some((button) => button.textContent?.trim() === '继续任务'));
      const imageTab = [...document.querySelectorAll('.artifact-tab-list button')]
        .find((button) => button.textContent?.trim() === '图片');
      if (imageTab instanceof HTMLButtonElement) imageTab.click();
      const galleryReady = await waitFor(() => {
        const borrowedCard = document.querySelector('.image-preview-card.borrowed');
        const borrowedImage = borrowedCard?.querySelector('img');
        return imageTab instanceof HTMLButtonElement
          && imageTab.classList.contains('active')
          && borrowedCard instanceof HTMLElement
          && borrowedCard.offsetParent !== null
          && borrowedImage instanceof HTMLImageElement
          && borrowedImage.complete
          && borrowedImage.naturalWidth > 0
          && borrowedCard.textContent?.includes('借 #1') === true
          && borrowedCard.textContent?.includes('原始生成失败：') === true;
      });
      let clipboardCopyReady = false;
      const sourceCard = document.querySelector('.image-preview-card[data-scene-id="1"]');
      if (sourceCard instanceof HTMLElement) {
        sourceCard.dataset.qaActionsOpen = 'true';
        const copyButton = [...sourceCard.querySelectorAll('.image-card-action-panel button')]
          .find((button) => button.textContent?.trim() === '复制图');
        if (copyButton instanceof HTMLButtonElement && !copyButton.disabled) copyButton.click();
        clipboardCopyReady = await waitFor(() => document.querySelector('.image-gallery-notice')
          ?.textContent?.includes('系统剪贴板') === true);
      }

      const scrollContainer = document.querySelector('.task-detail-main');
      let preservedScrollTop = 0;
      let scrollPositionPrepared = false;
      if (scrollContainer instanceof HTMLElement) {
        const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
        const targetScrollTop = Math.min(maxScrollTop, Math.max(80, Math.round(maxScrollTop * 0.45)));
        scrollContainer.scrollTop = targetScrollTop;
        scrollPositionPrepared = maxScrollTop > 1 && await waitFor(() => Math.abs(scrollContainer.scrollTop - targetScrollTop) <= 1);
        preservedScrollTop = scrollContainer.scrollTop;
      }

      let pastedImageReady = false;
      const pasteButtonReady = await waitFor(() => {
        const targetCard = document.querySelector('.image-preview-card[data-scene-id="3"]');
        if (!(targetCard instanceof HTMLElement)) return false;
        targetCard.dataset.qaActionsOpen = 'true';
        const pasteButton = [...targetCard.querySelectorAll('.image-card-action-panel button')]
          .find((button) => button.textContent?.trim() === '粘贴图');
        return pasteButton instanceof HTMLButtonElement && !pasteButton.disabled;
      });
      if (pasteButtonReady) {
        const targetCard = document.querySelector('.image-preview-card[data-scene-id="3"]');
        const pasteButton = [...(targetCard?.querySelectorAll('.image-card-action-panel button') ?? [])]
          .find((button) => button.textContent?.trim() === '粘贴图');
        if (pasteButton instanceof HTMLButtonElement) pasteButton.click();
        pastedImageReady = await waitFor(() => {
          const refreshedCard = document.querySelector('.image-preview-card[data-scene-id="3"]');
          const currentScrollTop = scrollContainer instanceof HTMLElement ? scrollContainer.scrollTop : Number.NaN;
          return refreshedCard?.querySelector('.image-card-status')?.textContent?.trim() === '借 #1'
            && Math.abs(currentScrollTop - preservedScrollTop) <= 1;
        });
      }

      let referenceEditorReady = false;
      const refreshedSourceCard = document.querySelector('.image-preview-card[data-scene-id="1"]');
      if (refreshedSourceCard instanceof HTMLElement) {
        refreshedSourceCard.dataset.qaActionsOpen = 'true';
        const referenceEditButton = [...refreshedSourceCard.querySelectorAll('.image-card-action-panel button')]
          .find((button) => button.textContent?.trim() === '参考图编辑');
        if (referenceEditButton instanceof HTMLButtonElement && !referenceEditButton.disabled) referenceEditButton.click();
        referenceEditorReady = await waitFor(() => {
          const editor = document.querySelector('.image-gallery-reference-editor');
          const currentImage = editor?.querySelector('img[alt="当前分镜参考图"]');
          const addButton = [...(editor?.querySelectorAll('button') ?? [])]
            .find((button) => button.textContent?.includes('添加参考图'));
          return editor instanceof HTMLElement
            && currentImage instanceof HTMLImageElement
            && currentImage.complete
            && currentImage.naturalWidth > 0
            && addButton instanceof HTMLButtonElement
            && !addButton.disabled;
        });
      }
      const closeEditorButton = document.querySelector('.image-gallery-editor-dialog button[aria-label="关闭"]');
      if (closeEditorButton instanceof HTMLButtonElement) closeEditorButton.click();
      const referenceEditorClosed = await waitFor(() => !document.querySelector('.image-gallery-editor-dialog'));

      taskImageWorkflowReady = pausedReady
        && galleryReady
        && clipboardCopyReady
        && scrollPositionPrepared
        && pasteButtonReady
        && pastedImageReady
        && referenceEditorReady
        && referenceEditorClosed;
      ready = ready && taskImageWorkflowReady;
      const borrowedCard = document.querySelector('.image-preview-card.borrowed');
      if (borrowedCard instanceof HTMLElement) {
        if (scrollContainer instanceof HTMLElement) {
          scrollContainer.scrollTop = 0;
          await waitFor(() => scrollContainer.scrollTop <= 1);
        }
        borrowedCard.dataset.qaActionsOpen = 'true';
        const focusableAction = borrowedCard.querySelector('.image-card-action-panel button:not(:disabled)');
        if (focusableAction instanceof HTMLButtonElement) focusableAction.focus({ preventScroll: true });
        ready = ready && await waitFor(() => {
          const panel = borrowedCard.querySelector('.image-card-action-panel');
          return panel instanceof HTMLElement
            && getComputedStyle(panel).opacity === '1'
            && panel.textContent?.includes('替换画面') === true
            && panel.textContent?.includes('参考图编辑') === true;
        });
        await settleCompositor();
      }
    }
    if (sceneVideoScenario) {
      const pauseButton = [...document.querySelectorAll('.task-detail-run-control')]
        .find((button) => button.textContent?.trim() === '暂停任务');
      if (pauseButton instanceof HTMLButtonElement) pauseButton.click();
      const pausedReady = await waitFor(() => [...document.querySelectorAll('.task-detail-run-control')]
        .some((button) => button.textContent?.trim() === '继续任务'));
      const imageTab = [...document.querySelectorAll('.artifact-tab-list button')]
        .find((button) => button.textContent?.trim() === '图片');
      if (imageTab instanceof HTMLButtonElement) imageTab.click();
      const galleryReady = await waitFor(() => imageTab instanceof HTMLButtonElement
        && imageTab.classList.contains('active')
        && document.querySelector('.image-preview-card[data-scene-id="1"]'));
      const taskShell = document.querySelector('.task-detail-shell[data-task-id]');
      const taskId = taskShell instanceof HTMLElement ? taskShell.dataset.taskId ?? '' : '';

      if (scenarioId === 'task-detail-scene-video-light-desktop') {
        const existingCard = document.querySelector('.image-preview-card.video[data-scene-id="1"]');
        if (existingCard instanceof HTMLElement) {
          existingCard.dataset.qaActionsOpen = 'true';
          const restore = [...existingCard.querySelectorAll('.image-card-action-panel button')]
            .find((button) => button.textContent?.trim() === '恢复图片');
          if (restore instanceof HTMLButtonElement) restore.click();
          await waitFor(() => !document.querySelector('.image-preview-card.video[data-scene-id="1"]'));
        }

        const openSceneMenu = async () => {
          const card = document.querySelector('.image-preview-card[data-scene-id="1"]');
          if (!(card instanceof HTMLElement)) return null;
          card.scrollIntoView({ block: 'center' });
          card.dataset.qaActionsOpen = 'true';
          const replace = [...card.querySelectorAll('.image-card-action-panel button')]
            .find((button) => ['替换画面', '更换画面'].includes(button.textContent?.trim() ?? ''));
          if (replace instanceof HTMLButtonElement) replace.click();
          const opened = await waitFor(() => card.querySelector('.scene-media-menu[role="menu"]'));
          return opened ? card.querySelector('.scene-media-menu[role="menu"]') : null;
        };

        const firstMenu = await openSceneMenu();
        const requiredMenuActions = ['本地图片', '图片素材库', '本地视频', '视频素材库', '随机匹配视频', 'AI 生成视频'];
        const menuReady = firstMenu instanceof HTMLElement
          && requiredMenuActions.every((label) => [...firstMenu.querySelectorAll('[role="menuitem"]')]
            .some((button) => button.textContent?.includes(label)));
        const aiVideoButton = [...(firstMenu?.querySelectorAll('[role="menuitem"]') ?? [])]
          .find((button) => button.textContent?.includes('AI 生成视频'));
        const aiVideoConfigGuardReady = aiVideoButton instanceof HTMLButtonElement
          && aiVideoButton.disabled
          && aiVideoButton.textContent?.includes('请先配置云端视频 API') === true;
        const closeAiMenu = firstMenu?.querySelector('[aria-label="关闭替换画面菜单"]');
        if (closeAiMenu instanceof HTMLButtonElement) closeAiMenu.click();
        await waitFor(() => !document.querySelector('.scene-media-menu[role="menu"]'));

        const libraryMenu = await openSceneMenu();
        const libraryButton = [...(libraryMenu?.querySelectorAll('[role="menuitem"]') ?? [])]
          .find((button) => button.textContent?.includes('视频素材库'));
        if (libraryButton instanceof HTMLButtonElement) libraryButton.click();
        const libraryReady = await waitFor(() => {
          const dialog = document.querySelector('.video-library-dialog[aria-modal="true"]');
          const item = [...(dialog?.querySelectorAll('.video-library-item') ?? [])]
            .find((button) => button.textContent?.includes('qa-scene-source.mp4'));
          return dialog instanceof HTMLElement && item instanceof HTMLButtonElement && !item.disabled;
        });
        const libraryItem = [...document.querySelectorAll('.video-library-dialog .video-library-item')]
          .find((button) => button.textContent?.includes('qa-scene-source.mp4'));
        if (libraryItem instanceof HTMLButtonElement) libraryItem.click();
        const adoptedReady = await waitFor(() => {
          const card = document.querySelector('.image-preview-card.video[data-scene-id="1"]');
          const video = card?.querySelector('video[aria-label="分镜 1 视频画面"]');
          const range = card?.querySelector('.scene-video-details input[type="range"]');
          return card instanceof HTMLElement
            && video instanceof HTMLVideoElement
            && video.readyState >= 1
            && video.videoWidth === 360
            && video.videoHeight === 640
            && range instanceof HTMLInputElement
            && Number(range.max) >= 1700
            && card.textContent?.includes('原图已保留') === true;
        }, 15000);

        const adoptedCard = document.querySelector('.image-preview-card.video[data-scene-id="1"]');
        const trimRange = adoptedCard?.querySelector('.scene-video-details input[type="range"]');
        if (trimRange instanceof HTMLInputElement) setRangeInputValue(trimRange, '900');
        const applyTrim = [...(adoptedCard?.querySelectorAll('.scene-video-details button') ?? [])]
          .find((button) => button.textContent?.trim() === '应用');
        const trimControlReady = await waitFor(() => applyTrim instanceof HTMLButtonElement && !applyTrim.disabled);
        if (applyTrim instanceof HTMLButtonElement) applyTrim.click();
        const trimPersisted = trimControlReady && taskId && api
          ? await waitForAsync(async () => {
              const snapshot = await api.getTaskArtifacts(taskId);
              return snapshot.assets.videos.find((video) => video.sceneId === 1)?.trimStartMs === 900;
            })
          : false;

        const restoredCard = document.querySelector('.image-preview-card.video[data-scene-id="1"]');
        if (restoredCard instanceof HTMLElement) {
          restoredCard.dataset.qaActionsOpen = 'true';
          const restore = [...restoredCard.querySelectorAll('.image-card-action-panel button')]
            .find((button) => button.textContent?.trim() === '恢复图片');
          if (restore instanceof HTMLButtonElement) restore.click();
        }
        const restoredReady = await waitFor(() => {
          const card = document.querySelector('.image-preview-card[data-scene-id="1"]');
          const image = card?.querySelector('img');
          return card instanceof HTMLElement
            && !card.classList.contains('video')
            && image instanceof HTMLImageElement
            && image.complete
            && image.naturalWidth > 0
            && document.querySelector('.image-gallery-notice')?.textContent?.includes('已恢复为原图片') === true;
        });

        const randomMenu = await openSceneMenu();
        const randomButton = [...(randomMenu?.querySelectorAll('[role="menuitem"]') ?? [])]
          .find((button) => button.textContent?.includes('随机匹配视频'));
        if (randomButton instanceof HTMLButtonElement) randomButton.click();
        const randomReady = await waitFor(() => document.querySelector('.image-preview-card.video[data-scene-id="1"] video')
          && document.querySelector('.image-gallery-notice')?.textContent?.includes('随机匹配视频') === true, 15000);
        const randomPersisted = randomReady && taskId && api
          ? (await api.getTaskArtifacts(taskId)).assets.videos
              .some((video) => video.sceneId === 1 && video.source === 'local-random' && video.trimStartMs === 0)
          : false;
        const finalMenu = await openSceneMenu();
        const taskMain = document.querySelector('.task-detail-main');
        const finalCard = document.querySelector('.image-preview-card.video[data-scene-id="1"]');
        const stickyTabs = document.querySelector('.artifact-tabs');
        if (taskMain instanceof HTMLElement && finalCard instanceof HTMLElement && stickyTabs instanceof HTMLElement) {
          const desiredCardTop = stickyTabs.getBoundingClientRect().bottom + 10;
          taskMain.scrollTop = Math.max(0, taskMain.scrollTop + finalCard.getBoundingClientRect().top - desiredCardTop);
          await waitFor(() => {
            const cardRect = finalCard.getBoundingClientRect();
            const tabsRect = stickyTabs.getBoundingClientRect();
            const menuRect = finalMenu?.getBoundingClientRect();
            return cardRect.top >= tabsRect.bottom - 1
              && Boolean(menuRect && menuRect.top >= tabsRect.bottom && menuRect.bottom <= window.innerHeight);
          });
        }
        const finalMenuVisible = finalMenu instanceof HTMLElement
          && getComputedStyle(finalMenu).visibility !== 'hidden'
          && requiredMenuActions.every((label) => finalMenu.textContent?.includes(label));
        sceneVideoWorkflowReady = pausedReady
          && galleryReady
          && menuReady
          && aiVideoConfigGuardReady
          && libraryReady
          && adoptedReady
          && trimPersisted
          && restoredReady
          && randomPersisted
          && finalMenuVisible;
      } else {
        const card = document.querySelector('.image-preview-card.video[data-scene-id="1"]');
        if (card instanceof HTMLElement) {
          card.scrollIntoView({ block: 'center' });
          card.dataset.qaActionsOpen = 'true';
          const replace = [...card.querySelectorAll('.image-card-action-panel button')]
            .find((button) => button.textContent?.trim() === '更换画面');
          if (replace instanceof HTMLButtonElement) replace.click();
        }
        const menuReady = await waitFor(() => document.querySelector('.scene-media-menu[role="menu"]'));
        const libraryButton = [...document.querySelectorAll('.scene-media-menu [role="menuitem"]')]
          .find((button) => button.textContent?.includes('视频素材库'));
        if (libraryButton instanceof HTMLButtonElement) libraryButton.click();
        const compactLibraryReady = await waitFor(() => {
          const dialog = document.querySelector('.video-library-dialog[aria-modal="true"]');
          const item = [...(dialog?.querySelectorAll('.video-library-item') ?? [])]
            .find((button) => button.textContent?.includes('qa-scene-source.mp4'));
          if (!(dialog instanceof HTMLElement) || !(item instanceof HTMLButtonElement) || item.disabled) return false;
          const rect = dialog.getBoundingClientRect();
          return rect.left >= 0
            && rect.top >= 0
            && rect.right <= window.innerWidth
            && rect.bottom <= window.innerHeight
            && dialog.textContent?.includes('需要 00:04') === true
            && dialog.textContent?.includes('自动静音') === true;
        });
        sceneVideoWorkflowReady = pausedReady && galleryReady && menuReady && compactLibraryReady;
      }
      ready = ready && sceneVideoWorkflowReady;
      await settleCompositor();
    }
    if (subtitleDiagnosticsScenario) {
      const pauseButton = [...document.querySelectorAll('.task-detail-run-control')]
        .find((button) => button.textContent?.trim() === '暂停任务');
      if (pauseButton instanceof HTMLButtonElement) pauseButton.click();
      ready = ready && await waitFor(() => [...document.querySelectorAll('.task-detail-run-control')]
        .some((button) => button.textContent?.trim() === '继续任务'));
      const storyboardTab = [...document.querySelectorAll('.artifact-tab-list button')]
        .find((button) => button.textContent?.trim() === '分镜');
      if (storyboardTab instanceof HTMLButtonElement) storyboardTab.click();
      let firstCaption = null;
      ready = ready && await waitFor(() => {
        const candidate = document.querySelector('.storyboard-caption-field textarea');
        if (!(candidate instanceof HTMLTextAreaElement) || candidate.disabled) return false;
        firstCaption = candidate;
        return document.querySelector('.storyboard-subtitle-editor') instanceof HTMLElement;
      });
      if (firstCaption instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(firstCaption, '这是一行用于验证字幕超长诊断与行号标红状态的测试文案');
        firstCaption.dispatchEvent(new Event('input', { bubbles: true }));
      }
      ready = ready && await waitFor(() => {
        const editor = document.querySelector('.storyboard-subtitle-editor');
        const warning = editor?.querySelector('.storyboard-editor-warning');
        const issueIndex = editor?.querySelector('.storyboard-caption-numbers .issue.over-limit[data-line-status="over-limit"]');
        const repairButtons = [...(editor?.querySelectorAll('button') ?? [])]
          .filter((button) => button.textContent?.trim() === '修复问题行');
        if (!(editor instanceof HTMLElement) || !(warning instanceof HTMLElement) || !(issueIndex instanceof HTMLElement)) return false;
        const editorRect = editor.getBoundingClientRect();
        const warningRect = warning.getBoundingClientRect();
        return storyboardTab instanceof HTMLButtonElement
          && storyboardTab.classList.contains('active')
          && warning.textContent?.includes('行超过模板上限') === true
          && warning.textContent?.includes('行号已标红') === true
          && repairButtons.length === 1
          && repairButtons[0] instanceof HTMLButtonElement
          && !repairButtons[0].disabled
          && warningRect.left >= editorRect.left
          && warningRect.right <= editorRect.right + 0.5;
      });
      const warning = document.querySelector('.storyboard-editor-warning');
      if (warning instanceof HTMLElement) {
        warning.scrollIntoView({ block: 'center' });
        await settleCompositor();
      }
    }
    if (draftDeliveryScenario) {
      let delivery = null;
      ready = ready && await waitFor(() => {
        const candidate = document.querySelector('.task-draft-delivery[data-draft-status="ready"]');
        if (!(candidate instanceof HTMLElement)) return false;
        delivery = candidate;
        const style = getComputedStyle(candidate);
        const gradientLayers = style.backgroundImage.match(/linear-gradient/g) ?? [];
        return gradientLayers.length === 2
          && candidate.textContent?.includes('剪映草稿已生成') === true
          && candidate.textContent?.includes('重新打包') === true
          && candidate.textContent?.includes('打开剪映') === true;
      });
      if (delivery instanceof HTMLElement) {
        delivery.scrollIntoView({ block: 'center' });
        ready = ready && await waitFor(() => {
          const rect = delivery.getBoundingClientRect();
          return rect.left >= 0
            && rect.top >= 0
            && rect.right <= window.innerWidth
            && rect.bottom <= window.innerHeight;
        });
        await settleCompositor();
      }
    }
    let coverPagePreviewReady = !coverPageScenario;
    if (coverPageScenario) {
      ready = ready && await waitFor(() => {
        const frame = document.querySelector('[data-preview-kind="cover"]');
        const railItem = document.querySelector('[data-scene-kind="cover"]');
        const image = frame?.querySelector('.draft-image-asset');
        const canvas = frame?.querySelector('[data-media-canvas="draft-canvas"]');
        const title = frame?.querySelector('.draft-title');
        const canvasRect = canvas?.getBoundingClientRect();
        const titleRect = title?.getBoundingClientRect();
        coverPagePreviewReady = frame instanceof HTMLElement
          && railItem instanceof HTMLButtonElement
          && railItem.classList.contains('selected')
          && railItem.textContent?.includes('00') === true
          && railItem.textContent?.includes('封面页') === true
          && frame.textContent?.includes('丝路文明，从长安启程') === true
          && !frame.querySelector('.draft-subtitle, .draft-caption, .draft-disclaimer')
          && image instanceof HTMLImageElement
          && image.complete
          && image.naturalWidth > 0
          && canvasRect instanceof DOMRect
          && titleRect instanceof DOMRect
          && titleRect.left >= canvasRect.left
          && titleRect.right <= canvasRect.right
          && titleRect.top >= canvasRect.top
          && titleRect.bottom <= canvasRect.bottom;
        return coverPagePreviewReady;
      });
      const frame = document.querySelector('[data-preview-kind="cover"]');
      if (frame instanceof HTMLElement) {
        frame.scrollIntoView({ block: 'center' });
        await settleCompositor();
      }
    }
    if (targetView === 'html-video' && scenarioId.startsWith('html-video-studio')) {
      ready = ready && await waitFor(() => {
        const previewFrames = [...document.querySelectorAll('.hv-reference-thumb')];
        const previewImages = [...document.querySelectorAll('.hv-reference-thumb img')];
        const previewIframe = document.querySelector('.hv-reference-phone iframe');
        return document.querySelector('[data-html-video-studio="html-video"]')
          && document.querySelector('[data-media-canvas="html-video"]')
          && document.querySelector('.hv-studio-run-rail')?.textContent?.includes('4/6')
          && previewFrames.length > 0
          && !document.querySelector('.hv-tab-content .hv-media-loading')
          && previewImages.length === previewFrames.length
          && previewImages.every((image) => image.complete && image.naturalWidth > 0)
          && previewIframe instanceof HTMLIFrameElement
          && previewIframe.contentDocument?.readyState === 'complete'
          && document.querySelector('.hv-timeline-track span')
          && document.querySelector('.hv-timeline-audio i');
      });
    }
    let promptTemplateEditorOpen = false;
    if (targetView === 'prompt-templates'
      && document.documentElement.dataset.theme === 'light'
      && window.innerWidth === 1440) {
      const templateRow = [...document.querySelectorAll('.prompt-template-row')]
        .find((row) => row.textContent?.includes('人物故事'));
      const viewButton = [...(templateRow?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === '查看');
      if (viewButton instanceof HTMLButtonElement) viewButton.click();
      ready = ready && await waitFor(() => document.querySelector('.prompt-template-detail')?.textContent?.includes('人物故事')
        && document.querySelector('.prompt-template-variable-chip'));
      promptTemplateEditorOpen = Boolean(document.querySelector('.prompt-template-detail')?.textContent?.includes('人物故事')
        && document.querySelector('.prompt-template-variable-chip'));
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
    const volcengineVersion = { selected: '', v3FieldsVisible: false, legacyFieldsVisible: false, v3ValuePreserved: false, legacyValuePreserved: false };
    if (scenarioId.startsWith('volcengine-')) {
      const ttsTab = [...document.querySelectorAll('.settings-tab')]
        .find((button) => button.textContent?.includes('TTS 配音'));
      if (ttsTab instanceof HTMLButtonElement) ttsTab.click();
      const versionGroupSelector = '[role="group"][aria-label="接口版本"]';
      ready = ready && await waitFor(() => document.querySelector(versionGroupSelector));
      const versionButton = (label) => [...(document.querySelector(versionGroupSelector)?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === label);
      const findSettingsInput = (label) => [...document.querySelectorAll('.profile-editor-grid label.config-input')]
        .find((field) => field.querySelector(':scope > span')?.textContent?.trim() === label)
        ?.querySelector('input');
      const selectVersion = async (label, expectedField) => {
        const button = versionButton(label);
        if (button instanceof HTMLButtonElement) button.click();
        return waitFor(() => findSettingsInput(expectedField) instanceof HTMLInputElement);
      };
      ready = ready && await selectVersion('新版 V3', 'V3 接口地址');
      const v3Endpoint = findSettingsInput('V3 接口地址');
      if (v3Endpoint instanceof HTMLInputElement) setInputValue(v3Endpoint, 'https://qa-v3.example/api/v3/tts/unidirectional');
      ready = ready && await waitFor(() => findSettingsInput('V3 接口地址')?.value === 'https://qa-v3.example/api/v3/tts/unidirectional');
      ready = ready && await selectVersion('旧版接口', '旧版接口地址');
      const legacyEndpoint = findSettingsInput('旧版接口地址');
      if (legacyEndpoint instanceof HTMLInputElement) setInputValue(legacyEndpoint, 'https://qa-legacy.example/api/v1/tts');
      ready = ready && await waitFor(() => findSettingsInput('旧版接口地址')?.value === 'https://qa-legacy.example/api/v1/tts');
      ready = ready && await selectVersion('新版 V3', 'V3 接口地址');
      volcengineVersion.v3ValuePreserved = findSettingsInput('V3 接口地址')?.value === 'https://qa-v3.example/api/v3/tts/unidirectional';
      ready = ready && await selectVersion('旧版接口', '旧版接口地址');
      volcengineVersion.legacyValuePreserved = findSettingsInput('旧版接口地址')?.value === 'https://qa-legacy.example/api/v1/tts';
      const finalLabel = scenarioId.includes('-legacy-') ? '旧版接口' : '新版 V3';
      const finalField = scenarioId.includes('-legacy-') ? '旧版接口地址' : 'V3 接口地址';
      ready = ready && await selectVersion(finalLabel, finalField);
      volcengineVersion.selected = document.querySelector(versionGroupSelector + ' button[aria-pressed="true"]')?.textContent?.trim() ?? '';
      volcengineVersion.v3FieldsVisible = findSettingsInput('V3 接口地址') instanceof HTMLInputElement;
      volcengineVersion.legacyFieldsVisible = findSettingsInput('旧版接口地址') instanceof HTMLInputElement;
      findSettingsInput(finalField)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    const jianyingDetection = { status: '', path: '', detail: '', checks: [], inputMatches: false, fullPathVisible: false };
    if (scenarioId.startsWith('jianying-auto-detect-')) {
      const jianyingTab = [...document.querySelectorAll('.settings-tab')]
        .find((button) => button.textContent?.includes('剪映'));
      if (jianyingTab instanceof HTMLButtonElement) jianyingTab.click();
      ready = ready && await waitFor(() => document.querySelector('.config-card')?.textContent?.includes('剪映草稿与 BGM'));
      const detectButton = [...document.querySelectorAll('.config-card button')]
        .find((button) => button.textContent?.trim() === '自动检测');
      if (detectButton instanceof HTMLButtonElement) detectButton.click();
      ready = ready && await waitFor(() => document.querySelector('.jianying-detection-result')?.getAttribute('data-status') === 'pass');
      const result = document.querySelector('.jianying-detection-result');
      const code = result?.querySelector('code');
      const pathInput = [...document.querySelectorAll('label.config-input')]
        .find((field) => field.querySelector(':scope > span')?.textContent?.trim() === '草稿目录')
        ?.querySelector('input');
      const resultRect = result?.getBoundingClientRect();
      jianyingDetection.status = result?.getAttribute('data-status') ?? '';
      jianyingDetection.path = code?.textContent?.trim() ?? '';
      jianyingDetection.detail = result?.querySelector('p')?.textContent?.trim() ?? '';
      jianyingDetection.checks = [...(result?.querySelectorAll('.jianying-detection-checks span') ?? [])]
        .map((item) => item.textContent?.trim() ?? '');
      jianyingDetection.inputMatches = pathInput instanceof HTMLInputElement && pathInput.value === jianyingDetection.path;
      jianyingDetection.fullPathVisible = code instanceof HTMLElement
        && code.title === jianyingDetection.path
        && code.scrollWidth <= code.clientWidth + 1
        && resultRect instanceof DOMRect
        && resultRect.left >= 0
        && resultRect.right <= window.innerWidth;
      result?.scrollIntoView({ block: 'center', inline: 'nearest' });
      await settleCompositor();
    }
    const stage = ${JSON.stringify(stage ?? '')};
    let stageStatePreserved = true;
    let presetStatePreserved = true;
    let autoBorrowImageStatePreserved = true;
    let aiBuiltinComposeReady = true;
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
        const coverPageToggle = document.querySelector('input[aria-label="启用封面页"]');
        if (coverPageToggle instanceof HTMLInputElement && !coverPageToggle.checked) coverPageToggle.click();
        ready = ready && await waitFor(() => document.querySelector('[data-cover-page-enabled="true"] .ordinary-cover-page-body'));
        const coverTextArea = document.querySelector('.ordinary-cover-page-text');
        ready = ready
          && coverTextArea instanceof HTMLTextAreaElement
          && coverTextArea.placeholder === '留空则不叠加文字'
          && [...document.querySelectorAll('.new-task-summary dd')]
            .some((element) => element.textContent?.trim() === 'AI 单独生成 · 不叠加文字');
        const coverModeGroup = document.querySelector('[role="group"][aria-label="封面图片"]');
        const manualButton = [...(coverModeGroup?.querySelectorAll('button') ?? [])]
          .find((button) => button.textContent?.trim() === '本地导入');
        if (manualButton instanceof HTMLButtonElement) manualButton.click();
        ready = ready && await waitFor(() => document.querySelector('[data-manual-cover-state="required"]'));
        ready = ready && await waitFor(() => (
          coverTextArea instanceof HTMLTextAreaElement
          && coverTextArea.placeholder === '留空则自动使用 AI 创作标题'
          && [...document.querySelectorAll('.new-task-summary dd')]
            .some((element) => element.textContent?.trim() === '待导入 · AI 标题')
        ));
        const borrowToggle = document.querySelector('.new-task-borrow-toggle input');
        if (borrowToggle instanceof HTMLInputElement && !borrowToggle.checked) borrowToggle.click();
        autoBorrowImageStatePreserved = borrowToggle instanceof HTMLInputElement
          && await waitFor(() => borrowToggle.checked);
        ready = ready && autoBorrowImageStatePreserved;
      }
      if (stage === 'material') {
        const presetNameInput = document.querySelector('input[aria-label="预设名称"]');
        const presetSelect = document.querySelector('select[aria-label="选择创建预设"]');
        const savePresetButton = [...document.querySelectorAll('.new-task-preset-save-row button')]
          .find((button) => button.textContent?.includes('保存为预设'));
        const applyPresetButton = [...document.querySelectorAll('.new-task-preset-apply-row button')]
          .find((button) => button.textContent?.includes('应用预设'));
        const presetTitleInput = document.querySelector('[data-new-task-stage="material"] input');
        if (!(presetNameInput instanceof HTMLInputElement)
          || !(presetSelect instanceof HTMLSelectElement)
          || !(savePresetButton instanceof HTMLButtonElement)
          || !(applyPresetButton instanceof HTMLButtonElement)
          || !(presetTitleInput instanceof HTMLInputElement)) {
          presetStatePreserved = false;
        } else {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          const originalPresetTitle = presetTitleInput.value;
          const expectedPresetTitle = originalPresetTitle + ' QA 预设';
          setter?.call(presetTitleInput, expectedPresetTitle);
          presetTitleInput.dispatchEvent(new Event('input', { bubbles: true }));
          setter?.call(presetNameInput, 'QA 创建预设');
          presetNameInput.dispatchEvent(new Event('input', { bubbles: true }));
          savePresetButton.click();
          const saved = await waitFor(() => [...presetSelect.options].some((option) => option.textContent === 'QA 创建预设'));
          setter?.call(presetTitleInput, expectedPresetTitle + ' 已修改');
          presetTitleInput.dispatchEvent(new Event('input', { bubbles: true }));
          applyPresetButton.click();
          presetStatePreserved = saved && await waitFor(() => presetTitleInput.value === expectedPresetTitle);
          ready = ready && presetStatePreserved;
          if (presetStatePreserved) {
            setter?.call(presetTitleInput, originalPresetTitle);
            presetTitleInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        const aiCreateButton = [...document.querySelectorAll('.new-task-source-actions button')]
          .find((button) => button.textContent?.trim() === 'AI 创作');
        if (aiCreateButton instanceof HTMLButtonElement) aiCreateButton.click();
        ready = ready && await waitFor(() => document.querySelector('.ai-create-panel'));
        const sourceRows = [...document.querySelectorAll('.ai-create-panel .check-row')];
        const webToggle = sourceRows.find((row) => row.textContent?.includes('全网搜索'))?.querySelector('input');
        const builtinToggle = sourceRows.find((row) => row.textContent?.includes('AI 内置知识补全'))?.querySelector('input');
        if (webToggle instanceof HTMLInputElement && webToggle.checked) webToggle.click();
        if (builtinToggle instanceof HTMLInputElement && !builtinToggle.checked) builtinToggle.click();
        const sourceStateSettled = await waitFor(() => !document.querySelector('.web-search-provider-panel'));
        const composeButton = document.querySelector('button[aria-label="生成文案"]');
        aiBuiltinComposeReady = sourceStateSettled
          && webToggle instanceof HTMLInputElement
          && !webToggle.checked
          && builtinToggle instanceof HTMLInputElement
          && builtinToggle.checked
          && composeButton instanceof HTMLButtonElement
          && !composeButton.disabled
          && composeButton.textContent?.includes('使用 AI 内置知识生成文案') === true;
        ready = ready && aiBuiltinComposeReady;
        composeButton?.scrollIntoView({ block: 'center', inline: 'nearest' });
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
    const promptTemplateOperationalSelector = '.prompt-template-row, .prompt-template-gallery .ghost-action, .prompt-template-gallery .chip';
    const draftTemplateOperationalSelector = '.draft-template-toolbar .ghost-action, .draft-template-card .ghost-action, .draft-template-card .danger-action, .new-template-card';
    const templateOperationalSelector = targetView === 'prompt-templates'
      ? promptTemplateOperationalSelector
      : targetView === 'draft-templates'
        ? draftTemplateOperationalSelector
        : '';
    const parseCssColor = (value) => {
      if (!value || value === 'transparent') return [0, 0, 0, 0];
      if (value.startsWith('#')) {
        const hex = value.slice(1);
        const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex;
        return [Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16), 1];
      }
      const channels = (value.match(/[0-9.]+/g) ?? []).map(Number);
      const rgb = value.startsWith('color(srgb')
        ? channels.slice(0, 3).map((channel) => channel * 255)
        : channels.slice(0, 3);
      return [...rgb, channels[3] ?? 1];
    };
    const parseRgb = (value) => parseCssColor(value).slice(0, 3);
    const relativeLuminance = (channels) => {
      const linear = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
    };
    const colorContrast = (first, second) => {
      const firstLuminance = relativeLuminance(first);
      const secondLuminance = relativeLuminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
    };
    const compositeColor = (foreground, background) => {
      const alpha = Math.max(0, Math.min(1, foreground[3] ?? 1));
      return foreground.slice(0, 3).map((channel, index) => (channel * alpha) + (background[index] * (1 - alpha)));
    };
    const templateOperationalSamples = templateOperationalSelector
      ? [...document.querySelectorAll(templateOperationalSelector)]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        })
        .map((element, index) => {
          const style = getComputedStyle(element);
          const foreground = relativeLuminance(parseRgb(style.color));
          const background = relativeLuminance(parseRgb(style.backgroundColor));
          const contrastRatio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          return {
            label: element.getAttribute('aria-label') || element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 48) || targetView + '-' + (index + 1),
            color: style.color,
            backgroundColor: style.backgroundColor,
            contrastRatio: Number(contrastRatio.toFixed(2)),
          };
        })
      : [];
    const templateOperationalContrast = {
      samples: templateOperationalSamples,
      failures: templateOperationalSamples.filter(({ contrastRatio }) => contrastRatio < 4.5).map(({ label, contrastRatio }) => label + ' (' + contrastRatio + ':1)'),
    };
    const visibleRect = (element) => {
      const rect = element.getBoundingClientRect();
      let left = Math.max(0, rect.left);
      let top = Math.max(0, rect.top);
      let right = Math.min(window.innerWidth, rect.right);
      let bottom = Math.min(window.innerHeight, rect.bottom);
      let ancestor = element.parentElement;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        const clipsX = ['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowX);
        const clipsY = ['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowY);
        if (clipsX || clipsY) {
          const ancestorRect = ancestor.getBoundingClientRect();
          if (clipsX) {
            left = Math.max(left, ancestorRect.left);
            right = Math.min(right, ancestorRect.right);
          }
          if (clipsY) {
            top = Math.max(top, ancestorRect.top);
            bottom = Math.min(bottom, ancestorRect.bottom);
          }
        }
        ancestor = ancestor.parentElement;
      }
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const visibleElement = (element) => {
      const closedDetails = element.closest('details:not([open])');
      const visibleSummary = closedDetails?.querySelector(':scope > summary');
      if (closedDetails && !visibleSummary?.contains(element)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && Boolean(visibleRect(element));
    };
    const evidenceLabel = (element, fallback) => element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 48)
      || element.getAttribute('name')
      || fallback;
    const resolveBackgroundColor = (element) => {
      const layers = [];
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.backgroundImage && style.backgroundImage !== 'none') return null;
        const layer = parseCssColor(style.backgroundColor);
        if ((layer[3] ?? 0) > 0) {
          layers.push(layer);
          if ((layer[3] ?? 0) >= 0.99) break;
        }
        current = current.parentElement;
      }
      let result = [255, 255, 255];
      for (const layer of layers.reverse()) result = compositeColor(layer, result);
      return result;
    };
    const activeModal = [...document.querySelectorAll('[aria-modal="true"]')].find((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight;
    });
    const evidenceRoot = activeModal ?? document;
    const textContrastSamples = [...evidenceRoot.querySelectorAll('h1, h2, h3, h4, p, span, small, strong, label, button, a, input, select, textarea, summary, td, th, li')]
      .filter((element) => {
        if (!visibleElement(element) || element.matches(':disabled, [aria-disabled="true"]')) return false;
        const directText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        const textualFormControl = element.matches([
          'input:not([type])',
          'input[type="text"]',
          'input[type="search"]',
          'input[type="email"]',
          'input[type="url"]',
          'input[type="tel"]',
          'input[type="password"]',
          'input[type="number"]',
          'select',
          'textarea',
        ].join(', '));
        return directText || textualFormControl;
      })
      .map((element, index) => {
        const style = getComputedStyle(element);
        const background = resolveBackgroundColor(element);
        if (!background) return null;
        const foreground = compositeColor(parseCssColor(style.color), background);
        const contrastRatio = colorContrast(foreground, background);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
        const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        return {
          label: evidenceLabel(element, element.tagName + '-' + (index + 1)),
          contrastRatio: Number(contrastRatio.toFixed(2)),
          threshold,
        };
      })
      .filter(Boolean);
    const textContrastFailures = textContrastSamples
      .filter(({ contrastRatio, threshold }) => contrastRatio < threshold)
      .map(({ label, contrastRatio, threshold }) => label + ' (' + contrastRatio + ':1 < ' + threshold + ':1)')
      .slice(0, 20);
    const focusColor = parseRgb(tokens['--shell-focus']);
    const focusContrastSamples = ['--shell-bg', '--shell-surface', '--shell-surface-raised'].map((token) => ({
      label: '--shell-focus on ' + token,
      contrastRatio: Number(colorContrast(focusColor, parseRgb(computed.getPropertyValue(token).trim())).toFixed(2)),
    }));
    const focusContrastFailures = focusContrastSamples
      .filter(({ contrastRatio }) => contrastRatio < 3)
      .map(({ label, contrastRatio }) => label + ' (' + contrastRatio + ':1)');
    const interactiveElements = [...evidenceRoot.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => visibleElement(element)
        && !element.matches(':disabled, [aria-disabled="true"], [data-tabster-dummy]'));
    const iconOnlyElements = interactiveElements.filter((element) => {
      const text = element.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
      return text.length === 0 && Boolean(element.querySelector('svg, img, i') || element.matches('input[type="button"], input[type="image"]'));
    });
    const labelledByText = (element) => (element.getAttribute('aria-labelledby') ?? '')
      .split(/\\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    const iconOnlyAccessibleNameGaps = iconOnlyElements
      .filter((element) => !element.getAttribute('aria-label') && !element.getAttribute('title') && !labelledByText(element) && !element.querySelector('svg title, img[alt]:not([alt=""])'))
      .map((element, index) => evidenceLabel(element, element.tagName + '-icon-' + (index + 1)));
    const iconOnlyTooltipGaps = iconOnlyElements
      .filter((element) => !element.getAttribute('title') && !element.getAttribute('aria-describedby') && !element.getAttribute('data-tooltip'))
      .map((element, index) => evidenceLabel(element, element.tagName + '-tooltip-' + (index + 1)));
    const activePopup = [...document.querySelectorAll('[role="listbox"], [role="menu"]')]
      .find((element) => visibleElement(element));
    const interactiveOverlaps = interactiveElements
      .map((element, index) => {
        const rect = visibleRect(element);
        if (!rect) return null;
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + (rect.width / 2)));
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + (rect.height / 2)));
        const hit = document.elementFromPoint(x, y);
        if (!hit || element === hit || element.contains(hit) || hit.contains(element) || getComputedStyle(hit).pointerEvents === 'none') return null;
        if (activePopup instanceof Element && !activePopup.contains(element) && activePopup.contains(hit)) return null;
        return evidenceLabel(element, element.tagName + '-' + (index + 1)) + ' blocked by ' + evidenceLabel(hit, hit.tagName);
      })
      .filter(Boolean)
      .slice(0, 20);
    const activeModalFocus = activeModal instanceof HTMLElement
      && document.activeElement instanceof HTMLElement
      && activeModal.contains(document.activeElement)
      ? document.activeElement
      : null;
    const interactionTarget = activeModalFocus
      ?? (nav instanceof HTMLElement && interactiveElements.includes(nav)
        ? nav
        : interactiveElements.find((element) => element instanceof HTMLElement));
    let interactionPerformed = activeModalFocus instanceof HTMLElement;
    let interactionVerified = interactionPerformed;
    if (interactionTarget instanceof HTMLElement && !interactionVerified) {
      interactionPerformed = true;
      interactionTarget.focus({ preventScroll: true });
      interactionVerified = document.activeElement === interactionTarget;
      interactionTarget.blur();
    }
    const roundedClipInset = (element) => {
      let inset = 0;
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        const clips = current === element
          || ['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowX)
          || ['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowY);
        if (clips) {
          inset = Math.max(inset, ...[
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ].map((value) => Number.parseFloat(value) || 0));
        }
        current = current.parentElement;
      }
      return Math.min(12, Math.ceil(inset));
    };
    const mediaRegions = [...document.querySelectorAll('[data-media-canvas]')]
      .filter(visibleElement)
      .map((element, index) => {
        const rect = visibleRect(element);
        if (!rect) return null;
        const x = Math.max(0, Math.floor(rect.left));
        const y = Math.max(0, Math.floor(rect.top));
        const right = Math.min(window.innerWidth, Math.ceil(rect.right));
        const bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom));
        return {
          key: (element.getAttribute('data-media-canvas') || 'media') + '-' + (index + 1),
          kind: element.getAttribute('data-media-canvas') || '',
          x,
          y,
          width: Math.max(0, right - x),
          height: Math.max(0, bottom - y),
          pixelWidth: Math.max(0, Math.round(rect.width * window.devicePixelRatio)),
          pixelHeight: Math.max(0, Math.round(rect.height * window.devicePixelRatio)),
          bitmapInset: roundedClipInset(element),
        };
      })
      .filter(Boolean);
    const mediaFailures = mediaRegions
      .filter((region) => !region.kind || region.width < 16 || region.height < 16 || region.pixelWidth < 16 || region.pixelHeight < 16)
      .map((region) => region.key + ' invalid bounds');
    const meaningfulText = document.body.innerText.replace(/\\s+/g, ' ').trim();
    const unresolvedTextRoot = document.body.cloneNode(true);
    unresolvedTextRoot.querySelectorAll('.prompt-template-variable-chip, .prompt-variable-editor textarea')
      .forEach((element) => element.remove());
    const unresolvedText = (unresolvedTextRoot.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const unresolvedTokens = [...new Set(unresolvedText.match(/\\{\\{[^{}]{1,80}\\}\\}|\\[object Object\\]|\\bundefined\\b|translation\\.missing/giu) ?? [])].slice(0, 20);
    const frameworkOverlays = [
      'vite-error-overlay',
      'nextjs-portal',
      '#webpack-dev-server-client-overlay',
      '[data-nextjs-dialog-overlay]',
      '[data-vite-dev-id]',
    ].filter((selector) => document.querySelector(selector));
    const renderErrors = [...document.querySelectorAll('.route-error-state')]
      .filter(visibleElement)
      .map((element) => element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 200) || 'route error');
    const consoleErrors = runtimeEvidence.consoleErrors.slice(runtimeCursor.consoleErrors);
    const pageErrors = runtimeEvidence.pageErrors.slice(runtimeCursor.pageErrors);
    runtimeEvidence.cursor = { consoleErrors: runtimeEvidence.consoleErrors.length, pageErrors: runtimeEvidence.pageErrors.length };
    const shellElement = document.querySelector('[data-editorial-shell]');
    const actualView = shellElement?.getAttribute('data-shell-view') ?? '';
    const rootChildCount = document.querySelector('#root')?.childElementCount ?? 0;
    const evidence = {
      identity: {
        expectedView: targetView,
        actualView,
        title: document.title,
        url: location.href,
        meaningfulTextLength: meaningfulText.length,
        rootChildCount,
        matched: actualView === targetView && meaningfulText.length >= 20 && rootChildCount > 0,
      },
      runtime: {
        frameworkOverlays,
        consoleErrors,
        pageErrors,
        renderErrors,
      },
      content: {
        unresolvedTokens,
      },
      accessibility: {
        iconOnlyAccessibleNameGaps,
        iconOnlyTooltipGaps,
        textContrastSamples: textContrastSamples.slice(0, 300),
        textContrastFailures,
        focusContrastSamples,
        focusContrastFailures,
      },
      layout: {
        interactiveOverlaps,
      },
      interaction: {
        kind: 'focus-control',
        target: interactionTarget instanceof Element ? evidenceLabel(interactionTarget, interactionTarget.tagName) : '',
        performed: interactionPerformed,
        verified: interactionVerified,
      },
      media: {
        regions: mediaRegions,
        bitmaps: [],
        failures: mediaFailures,
      },
    };
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
      : studioRegions[1].left >= studioRegions[0].right - 1
          && studioRegions[1].left >= studioRegions[2].right - 1
          && studioRegions[2].top >= studioRegions[0].bottom - 1
        ? 'two-column'
        : studioRegions[1].left >= studioRegions[0].right - 1 && studioRegions[2].left >= studioRegions[1].right - 1
          ? 'three-column'
          : studioRegions[1].top >= studioRegions[0].bottom - 1 && studioRegions[2].top >= studioRegions[1].bottom - 1
            ? 'stacked'
            : 'unknown';
    const htmlVideoCompactParameterOrder = studioRegions.length !== 3
      ? 'unknown'
      : studioRegions[0].top <= studioRegions[2].top
        && studioRegions[0].bottom <= studioRegions[2].top + 1
        ? 'parameters-first'
        : 'invalid';
    const clippedPrimaryControls = [...document.querySelectorAll('.new-task-workbench button, .new-task-workbench input, .new-task-workbench select, .new-task-workbench textarea, [data-task-operations] button, [data-task-operations] input, [data-task-operations] select, [data-html-video-studio] button, [data-html-video-studio] input, [data-html-video-studio] select, [data-html-video-studio] textarea, .minimax-clone-voice-manager button, .minimax-clone-voice-manager input, .minimax-clone-voice-manager select, .minimax-clone-voice-manager textarea, .settings-content .profile-editor-grid button, .settings-content .profile-editor-grid input, .settings-content .profile-editor-grid select')]
      .filter((element) => visibleElement(element))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName);
    const imagePreviewRows = new Map();
    [...document.querySelectorAll('.image-preview-card')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .forEach((element) => {
        const rowTop = element.offsetTop;
        const heights = imagePreviewRows.get(rowTop) ?? [];
        heights.push(element.offsetHeight);
        imagePreviewRows.set(rowTop, heights);
      });
    const imagePreviewRowHeightSpread = Math.max(0, ...[...imagePreviewRows.values()]
      .filter((heights) => heights.length > 1)
      .map((heights) => Math.max(...heights) - Math.min(...heights)));
    const imagePreviewMeasuredRowCount = [...imagePreviewRows.values()]
      .filter((heights) => heights.length > 1).length;
    const manualCoverElement = document.querySelector('[data-manual-cover-state]');
    const manualImportButton = [...document.querySelectorAll('.manual-cover-import button')]
      .find((button) => button.textContent?.includes('导入手动封面'));
    const createButton = [...document.querySelectorAll('.new-task-summary-actions button')]
      .find((button) => button.textContent?.includes('创建并开始任务'));
    const borrowedImageLabel = [...document.querySelectorAll('.image-card-status')]
      .find((element) => element.textContent?.trim().startsWith('借 #'))?.textContent?.trim() ?? '';
    return {
      ready,
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio,
      visibleText: meaningfulText.slice(0, 1000),
      tokens,
      themeTransition,
      evidence,
      templateOperationalContrast,
      stageStatePreserved,
      presetStatePreserved,
      autoBorrowImageStatePreserved,
      aiBuiltinComposeReady,
      borrowedImageLabel,
      errorDialogOpen,
      deleteDialogFocusWrapped,
      deleteDialogEscapeRestored,
      taskTemplateControlsReady,
      coverPagePreviewReady,
      draftLayerPanelReady,
      draftUnderlineToggleReady,
      draftRangeZeroReady,
      draftRangeDiagnostics,
      draftAnimationPreviewReady,
      draftFontSelectionReady,
      draftImageFitReady,
      draftImageTransformReady,
      taskImageWorkflowReady,
      sceneVideoWorkflowReady,
      manualCover: {
        state: manualCoverElement?.getAttribute('data-manual-cover-state') ?? 'inactive',
        importVisible: manualImportButton instanceof HTMLButtonElement && getComputedStyle(manualImportButton).display !== 'none',
        createDisabled: createButton instanceof HTMLButtonElement && createButton.disabled,
      },
      cloneVoice,
      volcengineVersion,
      jianyingDetection,
      historyHtmlTypeLabel,
      historyHtmlRouteReady,
      promptTemplateEditorOpen,
      layout: {
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        clippedPrimaryControls,
        imagePreviewMeasuredRowCount,
        imagePreviewRowHeightSpread,
        summaryPlacement,
        htmlVideoStudioPlacement,
        htmlVideoCompactParameterOrder,
      },
      readiness: {
        taskDetail: taskDetailReadiness,
      },
    };
  })().catch((error) => ({
    ready: false,
    width: window.innerWidth,
    height: window.innerHeight,
    scale: window.devicePixelRatio,
    qaError: error && error.stack ? error.stack : String(error),
  }))`;
}

function collectMediaBitmapEvidence(
  image: NativeImage,
  regions: EditorialQaCaptureEvidence['media']['regions'],
): EditorialQaCaptureEvidence['media']['bitmaps'] {
  const imageSize = image.getSize();
  return regions.map((region) => {
    if (
      region.x < 0
      || region.y < 0
      || region.width < 1
      || region.height < 1
      || region.x + region.width > imageSize.width
      || region.y + region.height > imageSize.height
    ) {
      throw new Error(`Editorial QA media region is outside the native capture: ${region.key}.`);
    }
    const inset = Math.min(
      Math.max(0, Math.ceil(region.bitmapInset)),
      Math.floor((region.width - 16) / 2),
      Math.floor((region.height - 16) / 2),
    );
    const cropWidth = region.width - (inset * 2);
    const cropHeight = region.height - (inset * 2);
    const cropped = image.crop({
      x: region.x + inset,
      y: region.y + inset,
      width: cropWidth,
      height: cropHeight,
    });
    const croppedSize = cropped.getSize();
    const bitmap = cropped.toBitmap();
    if (
      croppedSize.width !== cropWidth
      || croppedSize.height !== cropHeight
      || bitmap.byteLength !== cropWidth * cropHeight * 4
    ) {
      throw new Error(`Editorial QA media crop dimensions are invalid: ${region.key}.`);
    }
    return {
      key: region.key,
      kind: region.kind,
      x: region.x + inset,
      y: region.y + inset,
      width: croppedSize.width,
      height: croppedSize.height,
      sha256: createHash('sha256').update(bitmap).digest('hex'),
      pixelVariance: bitmapPixelVariance(bitmap),
    };
  });
}

function bitmapPixelVariance(bitmap: Buffer): number {
  const pixelCount = Math.floor(bitmap.byteLength / 4);
  const stride = Math.max(1, Math.floor(pixelCount / 4096));
  let samples = 0;
  let mean = 0;
  let squaredDifference = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    const luminance = (0.0722 * bitmap[offset]) + (0.7152 * bitmap[offset + 1]) + (0.2126 * bitmap[offset + 2]);
    samples += 1;
    const delta = luminance - mean;
    mean += delta / samples;
    squaredDifference += delta * (luminance - mean);
  }
  return Number((samples > 1 ? squaredDifference / samples : 0).toFixed(4));
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
