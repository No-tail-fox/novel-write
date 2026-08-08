import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  editorialQaCaptureRequirement,
  editorialQaCaptureIds,
  editorialQaCaptureIdsByRequirement,
  editorialQaExpectedCaptureCount,
  editorialQaScopes,
  resolveEditorialQaConfig,
  type EditorialQaEnvironment,
} from '../electron/editorial-qa';

describe('editorial Electron QA configuration', () => {
  it('requires the complete QA environment and rejects smoke mode', () => {
    expect(() => resolveEditorialQaConfig({
      STORYDREAM_QA_RUN_ROOT: 'C:\\temp\\root',
    }, tmpdir())).toThrow('all-or-none');
    expect(() => resolveEditorialQaConfig({
      STORYDREAM_QA_RUN_ROOT: 'C:\\temp\\root',
      STORYDREAM_QA_RUN_TOKEN: 'token',
      STORYDREAM_QA_SENTINEL: 'C:\\temp\\root\\sentinel',
      STORYDREAM_QA_USER_DATA: 'C:\\temp\\root\\user-data',
      STORYDREAM_QA_REPORT: 'C:\\temp\\root\\user-data\\report.json',
      STORYDREAM_QA_CAPTURES: 'C:\\temp\\root\\user-data\\captures',
      STORYDREAM_SMOKE_OUTPUT: 'C:\\temp\\root\\user-data\\smoke.json',
      STORYDREAM_SMOKE_USER_DATA: 'C:\\temp\\root\\user-data',
    }, tmpdir())).toThrow('mutually exclusive');
  });

  it('only accepts known capture scopes before Electron is launched', () => {
    expect(editorialQaScopes).toEqual(['all', 'theme-smoke', 'shell', 'new-task', 'task-operations', 'html-video', 'clone-voice', 'volcengine-tts', 'jianying', 'workflow', 'labs', 'system']);
    expect(() => resolveEditorialQaConfig({ STORYDREAM_QA_SCOPE: 'unknown' }, tmpdir())).toThrow('Unknown editorial QA scope');
  });

  it('defines the exact completed capture count for every QA scope', () => {
    expect(Object.fromEntries(editorialQaScopes.map((scope) => [scope, editorialQaExpectedCaptureCount(scope)]))).toEqual({
      all: 98,
      'theme-smoke': 4,
      shell: 4,
      'new-task': 4,
      'task-operations': 14,
      'html-video': 2,
      'clone-voice': 4,
      'volcengine-tts': 2,
      jianying: 2,
      workflow: 28,
      labs: 20,
      system: 20,
    });
    for (const scope of editorialQaScopes) {
      const ids = editorialQaCaptureIds(scope);
      expect(new Set(ids).size, `${scope} capture ids`).toBe(ids.length);
    }
  });

  it('runs Jianying auto detection through deterministic Electron IPC evidence', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    const runner = await (await import('node:fs/promises')).readFile(new URL('../scripts/editorial-qa-electron.ts', import.meta.url), 'utf8');

    expect(source).toContain('jianying-auto-detect-light-desktop');
    expect(source).toContain("state.jianyingDetection.detail.includes('2 个本地草稿')");
    expect(source).toContain("state.jianyingDetection.path.endsWith('configured-draft-root')");
    expect(source).toContain("button.textContent?.trim() === '自动检测'");
    expect(runner).toContain("join(draftRoot, 'QA draft one')");
    expect(runner).toContain('currentCustomDraftPath=');
    expect(runner).toContain("join(standardDraftRoot, 'Decoy standard draft')");
    expect(runner).toContain('qaEnvironment.LOCALAPPDATA = localAppData');
  });

  it('classifies the canonical 67 required captures separately from 31 supplemental states', () => {
    const required = editorialQaCaptureIdsByRequirement('required');
    const supplemental = editorialQaCaptureIdsByRequirement('supplemental');
    const all = editorialQaCaptureIds('all');

    expect(required).toHaveLength(67);
    expect(supplemental).toHaveLength(31);
    expect(new Set([...required, ...supplemental])).toEqual(new Set(all));
    expect(required.filter((id) => supplemental.includes(id))).toEqual([]);
    expect(required).toEqual(expect.arrayContaining([
      'workflow-new-task-dark-desktop',
      'workflow-task-detail-dark-desktop',
      'workflow-task-detail-light-desktop',
      'new-task-material-desktop',
      'new-task-creative-desktop',
      'new-task-output-desktop',
      'new-task-material-compact',
    ]));
    expect([...supplemental].sort()).toEqual([
      'history-operations-compact',
      'history-operations-desktop',
      'html-video-studio-light-compact',
      'html-video-studio-light-desktop',
      'minimax-clone-voice-create-light-desktop',
      'minimax-clone-voice-delete-light-compact',
      'minimax-clone-voice-edit-dark-desktop',
      'minimax-clone-voice-empty-dark-compact',
      'queue-operations-desktop',
      'shell-new-task-dark-compact',
      'shell-new-task-dark-desktop',
      'shell-new-task-light-compact',
      'shell-new-task-light-desktop',
      'task-detail-operations-desktop',
      'task-detail-borrowed-image-desktop',
      'task-detail-cover-page-light-desktop',
      'task-detail-draft-delivery-dark-desktop',
      'task-detail-draft-delivery-light-desktop',
      'task-detail-error-dialog-compact',
      'task-detail-error-summary-desktop',
      'task-detail-scene-video-light-compact',
      'task-detail-scene-video-light-desktop',
      'task-detail-subtitle-diagnostics-light-desktop',
      'task-detail-template-menu-dark-desktop',
      'volcengine-legacy-dark-compact',
      'volcengine-v3-light-desktop',
      'workflow-new-task-dark-compact',
      'workflow-new-task-light-compact',
      'workflow-new-task-light-desktop',
      'workflow-task-detail-dark-compact',
      'workflow-task-detail-light-compact',
    ].sort());
    expect(editorialQaCaptureRequirement('workflow-queue-light-desktop')).toBe('required');
    expect(editorialQaCaptureRequirement('queue-operations-desktop')).toBe('supplemental');
    expect(() => editorialQaCaptureRequirement('missing-capture')).toThrow('unknown capture id');
  });

  it('requires complete cross-cutting evidence for every canonical capture report', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    const runner = await (await import('node:fs/promises')).readFile(new URL('../scripts/editorial-qa-electron.ts', import.meta.url), 'utf8');

    expect(source).toContain('requirement: editorialQaCaptureRequirement(captureCase.id)');
    for (const evidenceSection of ['identity', 'runtime', 'content', 'accessibility', 'layout', 'interaction', 'media']) {
      expect(source, `${evidenceSection} evidence`).toContain(`${evidenceSection}: {`);
    }
    for (const failureField of [
      'frameworkOverlays',
      'consoleErrors',
      'pageErrors',
      'renderErrors',
      'unresolvedTokens',
      'iconOnlyAccessibleNameGaps',
      'iconOnlyTooltipGaps',
      'textContrastFailures',
      'focusContrastFailures',
      'interactiveOverlaps',
    ]) {
      expect(source, `${failureField} gate`).toContain(failureField);
    }
    expect(source).toContain('crossCuttingEvidenceFailures(state.evidence)');
    expect(source).toContain('evidence.identity.matched');
    expect(source).toContain('evidence.interaction.verified');
    expect(source).toContain('nav instanceof HTMLElement && interactiveElements.includes(nav)');
    expect(source).toContain('activeModal.contains(document.activeElement)');
    expect(source).toContain('let interactionVerified = interactionPerformed');
    expect(source).toContain("document.querySelectorAll('[role=\"listbox\"], [role=\"menu\"]')");
    expect(source).toContain('!activePopup.contains(element) && activePopup.contains(hit)');
    expect(source).toContain('Editorial QA cross-cutting evidence failed');
    expect(source).toContain('JSON.stringify(state.evidence.interaction)');
    expect(runner).toContain('validateCanonicalEvidence(qaReport)');
    expect(runner).toContain("capture.requirement === 'required'");
    expect(runner).toContain('capture.evidence?.identity.matched');
    expect(runner).toContain('capture.evidence.interaction.verified');
  });

  it('records native media bitmap hashes and compares matching regions across shell themes', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    const runner = await (await import('node:fs/promises')).readFile(new URL('../scripts/editorial-qa-electron.ts', import.meta.url), 'utf8');

    expect(source).toContain("createHash('sha256')");
    expect(source).toContain('collectMediaBitmapEvidence(image, state.evidence.media.regions)');
    expect(source).toContain('const roundedClipInset = (element) => {');
    expect(source).toContain('bitmapInset: roundedClipInset(element)');
    expect(source).toContain('x: region.x + inset');
    expect(source).toContain('const cropWidth = region.width - (inset * 2)');
    expect(source).toContain('width: cropWidth');
    expect(source).toContain("sha256: createHash('sha256').update(bitmap).digest('hex')");
    expect(source).toContain('pixelVariance: bitmapPixelVariance(bitmap)');
    expect(source).toContain('state.evidence.media.bitmaps = mediaBitmaps');
    expect(runner).toContain('validateMediaThemeInvariants(qaReport)');
    expect(runner).toContain('capture.evidence.media.bitmaps');
    expect(runner).toContain('darkBitmap.sha256 !== lightBitmap.sha256');
    expect(runner).toContain("darkCapture.view === 'draft-templates' && darkBitmap.kind === 'draft-canvas'");
    expect(runner).toContain('(!themeAwareEditorCanvas && darkBitmap.sha256 !== lightBitmap.sha256)');
    expect(runner).toContain('Editorial media bitmap changed across themes');
  });

  it('toggles every draft text underline off, persists it, and reloads without blanking Electron', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(source).toContain('draftUnderlineToggleReady');
    expect(source).toContain('draftRangeZeroReady');
    expect(source).toContain('draftAnimationPreviewReady');
    expect(source).toContain('draftImageTransformReady');
    expect(source).toContain('[data-layer="image-frame"]');
    expect(source).toContain('[data-layer="image-media"]');
    expect(source).toContain("querySelectorAll('.draft-transform-handle').length === 8");
    expect(source).toContain('persisted.image?.mediaScale === 1.4');
    expect(source).toContain('persisted.image?.focusX === 0.25');
    expect(source).toContain('persisted.image?.focusY === 0.75');
    expect(source).toContain('input[aria-label="下划线"]');
    expect(source).toContain("{ layer: 'title', textSelector: '.draft-title' }");
    expect(source).toContain("{ layer: 'subtitle', textSelector: '.draft-subtitle' }");
    expect(source).toContain("{ layer: 'caption', textSelector: '.draft-caption' }");
    expect(source).toContain("{ layer: 'disclaimer', textSelector: '.draft-disclaimer' }");
    expect(source).toContain("text.dataset.draftUnderline === 'off'");
    expect(source).toContain("api.getDraftTemplateDetail('qa-selected-draft-template')");
    expect(source).toContain("button.textContent?.trim() === '保存'");
    expect(source).toContain("button.textContent?.trim() === '返回模板列表'");
    expect(source).toContain("document.querySelector('.app-shell')");
    expect(source).toContain('underline toggle blanked or corrupted the renderer');
  });

  it('runs the native task image clipboard, paste, scroll, and reference-editor workflow', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(source).toContain('taskImageWorkflowReady');
    expect(source).toContain("button.textContent?.trim() === '暂停任务'");
    expect(source).toContain("button.textContent?.trim() === '复制图'");
    expect(source).toContain("textContent?.includes('系统剪贴板')");
    expect(source).toContain("button.textContent?.trim() === '粘贴图'");
    expect(source).toContain(".image-preview-card[data-scene-id=\"3\"]");
    expect(source).toContain('Math.abs(currentScrollTop - preservedScrollTop) <= 1');
    expect(source).toContain("document.querySelector('.image-gallery-reference-editor')");
    expect(source).toContain("img[alt=\"当前分镜参考图\"]");
    expect(source).toContain("button.textContent?.includes('添加参考图')");
  });

  it('waits for every HTML animation preview in dedicated studio scenarios', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(source).toContain("if (targetView === 'html-video' && scenarioId.startsWith('html-video-studio')) {");
    expect(source).toContain("document.querySelector('.hv-create-history select')");
    expect(source).toContain("option.textContent?.includes('武则天：权力之路 HTML 动画')");
    expect(source).toContain("Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set");
    expect(source).toContain('.filter((element) => visibleElement(element))');
    expect(source).toContain("document.querySelectorAll('.hv-reference-thumb')");
    expect(source).toContain("document.querySelectorAll('.hv-reference-thumb img')");
    expect(source).toContain("document.querySelector('.hv-reference-phone iframe')");
    expect(source).toContain("!document.querySelector('.hv-tab-content .hv-media-loading')");
    expect(source).toContain('previewImages.length === previewFrames.length');
    expect(source).toContain('previewImages.every((image) => image.complete && image.naturalWidth > 0)');
    expect(source).not.toContain("const previewImage = document.querySelector('img[alt*=\"动画预览\"]')");
  });

  it('excludes scroll-clipped descendants from interactive obstruction evidence', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(source).toContain('const visibleRect = (element) => {');
    expect(source).toContain("const clipsX = ['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowX);");
    expect(source).toContain("const clipsY = ['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowY);");
    expect(source).toContain('const rect = visibleRect(element);');
    expect(source).toContain('if (!rect) return null;');
  });

  it('excludes closed disclosure content while retaining its summary control', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(source).toContain("const closedDetails = element.closest('details:not([open])');");
    expect(source).toContain("const visibleSummary = closedDetails?.querySelector(':scope > summary');");
    expect(source).toContain('if (closedDetails && !visibleSummary?.contains(element)) return false;');
  });

  it('keeps icon-only window controls discoverable and accent fills readable in both themes', async () => {
    const shell = await (await import('node:fs/promises')).readFile(new URL('../src/app/AppShell.tsx', import.meta.url), 'utf8');
    const shellStyles = await (await import('node:fs/promises')).readFile(new URL('../src/styles/shell.css', import.meta.url), 'utf8');
    const newTaskStyles = await (await import('node:fs/promises')).readFile(new URL('../src/styles/features/new-task.css', import.meta.url), 'utf8');

    for (const label of ['最小化', '最大化', '关闭']) {
      expect(shell).toContain(`aria-label="${label}" title="${label}"`);
    }
    expect(shellStyles).toMatch(/\.app-shell\[data-editorial-shell\] \.new-task-button,[\s\S]*?\.primary-action \{[\s\S]*?color: var\(--shell-focus-contrast\);/u);
    expect(shellStyles).toMatch(/\.app-shell\[data-editorial-shell\] \.trial-activation-bar strong \{[\s\S]*?color: var\(--shell-text\);/u);
    expect(newTaskStyles).toMatch(/\.new-task-stage-tabs button\.active \{[\s\S]*?color: var\(--shell-focus-contrast\);/u);
    expect(newTaskStyles).toMatch(/\.new-task-stage-tabs button\.active span \{[\s\S]*?background: var\(--shell-focus-contrast\);/u);
    expect(newTaskStyles).toMatch(/\.new-task-source-actions button\.active \{[\s\S]*?color: var\(--shell-focus-contrast\);/u);
    expect(newTaskStyles).toMatch(/\.new-task-stage-panel \.option-pill\.active,[\s\S]*?\.video-form-option\.active \{[\s\S]*?color: var\(--shell-accent-strong\);/u);
    expect(newTaskStyles).toMatch(/\.new-task-stage-panel \.segmented button\.selected \{[\s\S]*?color: var\(--shell-accent-strong\);/u);
    expect(newTaskStyles).toMatch(/\.new-task-stage-panel \.chip\.active \{[\s\S]*?color: var\(--shell-accent-strong\);/u);
    expect(newTaskStyles).toMatch(/\.new-task-summary-title small \{[\s\S]*?color: var\(--shell-accent-strong\);/u);
  });

  it('verifies AI built-in knowledge can compose without the web-search controls', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(source).toContain('aiBuiltinComposeReady');
    expect(source).toContain("button[aria-label=\"生成文案\"]");
    expect(source).toContain("!document.querySelector('.web-search-provider-panel')");
    expect(source).toContain("composeButton.textContent?.includes('使用 AI 内置知识生成文案')");
  });

  it('keeps activation status and all three plan choices readable in the light shell', async () => {
    const shellStyles = await (await import('node:fs/promises')).readFile(new URL('../src/styles/shell.css', import.meta.url), 'utf8');

    expect(shellStyles).toMatch(/\.app-shell\[data-shell-view='activation'\] \.segmented button \{[\s\S]*?background: var\(--shell-surface-raised\);[\s\S]*?color: var\(--shell-text\);/u);
    expect(shellStyles).toMatch(/\.app-shell\[data-shell-view='activation'\] \.segmented button\.selected \{[\s\S]*?background: var\(--shell-focus\);[\s\S]*?color: var\(--shell-focus-contrast\);/u);
    expect(shellStyles).toMatch(/\.app-shell\[data-shell-view='activation'\] \.status-pill\.paused \{[\s\S]*?color: var\(--shell-text\);/u);
  });

  it('captures the four accepted new-task states without multiplying unrelated themes and viewports', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    for (const state of [
      "{ id: 'new-task-material-desktop', view: 'new-task', stage: 'material', theme: 'light', viewport: 'desktop' }",
      "{ id: 'new-task-creative-desktop', view: 'new-task', stage: 'creative', theme: 'light', viewport: 'desktop' }",
      "{ id: 'new-task-output-desktop', view: 'new-task', stage: 'output', theme: 'light', viewport: 'desktop' }",
      "{ id: 'new-task-material-compact', view: 'new-task', stage: 'material', theme: 'light', viewport: 'compact' }",
    ]) {
      expect(source).toContain(state);
    }
    expect(source).toContain("document.querySelector('[data-new-task-stage-tab=\"' + stage + '\"]')");
    expect(source).toContain('stageStatePreserved = reopenedTitle instanceof HTMLInputElement');
    expect(source).toContain('presetStatePreserved = saved && await waitFor');
    expect(source).toContain("input[aria-label=\"预设名称\"]");
    expect(source).toContain("option.textContent === 'QA 创建预设'");
    expect(source).toContain('!state.presetStatePreserved');
    expect(source).toContain("input[aria-label=\"启用封面页\"]");
    expect(source).toContain("button.textContent?.trim() === '本地导入'");
    expect(source).toContain("document.querySelector('[data-manual-cover-state=\"required\"]')");
    expect(source).toContain("state.manualCover.state !== 'required'");
    expect(source).toContain('!state.manualCover.importVisible');
    expect(source).toContain('!state.manualCover.createDisabled');
    expect(source).toContain('horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth)');
    expect(source).toContain("const expectedPlacement = viewport.name === 'compact' ? 'below' : 'right';");
    expect(source).toContain('editorialQaOperationTimeoutMs');
    expect(source).toContain('withEditorialQaTimeout(');
    expect(source).toContain('activeCapture: captureCase.id');
    expect(source).toContain('const initialShellReady = await waitFor');
    expect(source).toContain('theme preference timed out');
    expect(source).toContain('font readiness timed out');
    expect(source).toContain('qaCompositorSettlingScript()');
    expect(source).toContain('fallback = setTimeout(finish, 160)');
    expect(source).toContain('requestAnimationFrame(() => requestAnimationFrame(finish))');
    expect(source).toContain('captureEditorialQaPage(window, captureCase.id)');
    expect(source).toContain('capturePage failed after 3 attempts');
    expect(source).toContain('Editorial QA ${label} failed:');
  });

  it('binds queue operation evidence to the rendered latest task instead of fixture order', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    const queueScenario = source.slice(
      source.indexOf("if (scenarioId === 'queue-operations-desktop')"),
      source.indexOf("if (scenarioId === 'history-operations-desktop')"),
    );

    expect(queueScenario).toContain("document.querySelector('.task-queue-row strong')");
    expect(queueScenario).toContain("document.querySelector('.task-event-rail-head')");
    expect(queueScenario).toContain("railText.includes(latestQueueTitle)");
    expect(queueScenario).toContain("eventStateText.includes('暂无事件') || document.querySelector('.task-event-item')");
    expect(queueScenario).not.toContain('Step 4 批量生图');
  });

  it('renders and exercises the shared light-theme error summary in the real queue', async () => {
    const [source, main] = await Promise.all([
      (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8'),
      (await import('node:fs/promises')).readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    ]);
    const queueScenario = source.slice(
      source.indexOf("if (scenarioId === 'queue-operations-desktop')"),
      source.indexOf("if (scenarioId === 'history-operations-desktop')"),
    );

    expect(main).toContain("createFixture('QA 浅色错误提示')");
    expect(main).toContain("errorMessage: 'HTML video planning step failed'");
    expect(queueScenario).toContain("row.textContent?.includes('QA 浅色错误提示')");
    expect(queueScenario).toContain("querySelector('.error-summary-button')");
    expect(queueScenario).toContain("document.querySelector('.error-dialog')");
    expect(queueScenario).toContain("button.textContent?.trim() === '关闭'");
    expect(editorialQaCaptureIds('task-operations')).toContain('task-detail-error-dialog-compact');
    expect(source).toContain("scenarioId === 'task-detail-error-dialog-compact'");
    expect(source).toContain("document.querySelector('.task-detail-shell .error-summary-button')");
    expect(source).toContain('state.errorDialogOpen');
    expect(source).toContain('const evidenceRoot = activeModal ?? document');
    expect(source).toContain("evidenceRoot.querySelectorAll('h1, h2, h3, h4");
    expect(source).toContain('rect.left < window.innerWidth');
  });

  it('records and gates the rendered HTML animation type in every History capture', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    const main = await (await import('node:fs/promises')).readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const htmlFixture = main.slice(
      main.indexOf('async function seedHtmlVideoEditorialQa'),
      main.indexOf('async function createWindow'),
    );

    expect(source).toContain("row.textContent?.includes('武则天：权力之路 HTML 动画')");
    expect(source).toContain("querySelector('[role=\"cell\"]:nth-child(2)')");
    expect(source).toContain("historyHtmlTypeLabel !== 'HTML 动画'");
    expect(source).toContain('historyHtmlTypeLabel: state.historyHtmlTypeLabel');
    expect(source).toContain("htmlHistoryRow?.querySelector('.table-row-primary-action')");
    expect(source).toContain("document.querySelector('[data-shell-view=\"html-video\"]')");
    expect(source).toContain("document.querySelector('[data-html-video-studio=\"html-video\"]')");
    expect(source).toContain("taskTitle === '武则天：权力之路 HTML 动画'");
    expect(source).toContain("document.querySelector('[data-nav-view=\"history\"]')");
    expect(source).toContain('!state.historyHtmlRouteReady');
    expect(source).toContain('historyHtmlRouteReady: state.historyHtmlRouteReady');
    expect(source).toContain("scenarioId.startsWith('task-detail-scene-video-')");
    expect(source).toContain("button.textContent?.includes('qa-scene-source.mp4')");
    expect(source).toContain("video.source === 'local-random'");
    expect(source).toContain('!state.sceneVideoWorkflowReady');
    expect(source).toContain('sceneVideoWorkflowReady: state.sceneVideoWorkflowReady');
    expect(htmlFixture).toContain("editorialQaConfig?.scope !== 'task-operations'");
  });

  it('gates the failed-image borrowing control and borrowed task-detail evidence', async () => {
    const [source, main] = await Promise.all([
      (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8'),
      (await import('node:fs/promises')).readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    ]);

    expect(source).toContain("document.querySelector('.new-task-borrow-toggle input')");
    expect(source).toContain('state.autoBorrowImageStatePreserved');
    expect(source).toContain("state.borrowedImageLabel !== '借 #1'");
    expect(source).toContain("document.querySelectorAll('.image-card-status')");
    expect(source).toContain("document.querySelector('.image-preview-card.borrowed')");
    expect(source).toContain('scrollContainer.scrollTop = 0');
    expect(source).toContain('focusableAction.focus({ preventScroll: true })');
    expect(source).toContain("document.querySelectorAll('.image-preview-card')");
    expect(source).toContain('element.offsetParent !== null');
    expect(source).toContain("button.textContent?.trim() === '图片'");
    expect(source).toContain("imageTab.classList.contains('active')");
    expect(source).toContain('imagePreviewMeasuredRowCount < 1');
    expect(source).toContain('imagePreviewRowHeightSpread > 1');
    expect(source).toContain('Editorial QA found uneven or unmeasured image preview cards');
    expect(main).toContain("borrowedFrom = scene.id === 2 ? 1 : undefined");
    expect(main).toContain("imageErrors: [{ sceneId: 2");
  });

  it('captures the real subtitle over-limit diagnosis without duplicating its repair action', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(editorialQaCaptureIds('task-operations')).toContain('task-detail-subtitle-diagnostics-light-desktop');
    expect(source).toContain("scenarioId === 'task-detail-subtitle-diagnostics-light-desktop'");
    expect(source).toContain("button.textContent?.trim() === '暂停任务'");
    expect(source).toContain("button.textContent?.trim() === '继续任务'");
    expect(source).toContain("button.textContent?.trim() === '分镜'");
    expect(source).toContain(".storyboard-caption-numbers .issue.over-limit[data-line-status=\"over-limit\"]");
    expect(source).toContain("button.textContent?.trim() === '修复问题行'");
    expect(source).toContain('repairButtons.length === 1');
  });

  it('opens the accepted Prompt Template editor state for the light desktop concept capture', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(source).toContain("targetView === 'prompt-templates'");
    expect(source).toContain("document.documentElement.dataset.theme === 'light'");
    expect(source).toContain('window.innerWidth === 1440');
    expect(source).toContain("document.querySelectorAll('.prompt-template-row')");
    expect(source).toContain("row.textContent?.includes('人物故事')");
    expect(source).toContain("button.textContent?.trim() === '查看'");
    expect(source).toContain("document.querySelector('.prompt-template-detail')");
    expect(source).toContain('const unresolvedTextRoot = document.body.cloneNode(true);');
    expect(source).toContain("unresolvedTextRoot.querySelectorAll('.prompt-template-variable-chip, .prompt-variable-editor textarea')");
    expect(source).toContain('unresolvedTextRoot.textContent');
    expect(source).toContain("promptTemplateEditorOpen !== true");
    expect(source).toContain('promptTemplateEditorOpen: state.promptTemplateEditorOpen');
  });

  it('exercises MiniMax clone-voice CRUD across both themes and viewports', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    expect(editorialQaCaptureIds('clone-voice')).toEqual([
      'minimax-clone-voice-create-light-desktop',
      'minimax-clone-voice-edit-dark-desktop',
      'minimax-clone-voice-delete-light-compact',
      'minimax-clone-voice-empty-dark-compact',
    ]);
    expect(source).toContain("button.textContent?.includes('登记音色')");
    expect(source).toContain("sourceButton instanceof HTMLButtonElement");
    expect(source).toContain("inputs[2].value.endsWith('qa-minimax-source.wav')");
    expect(source).toContain("button.textContent?.includes('保存记录')");
    expect(source).toContain('button[title="编辑音色记录"]');
    expect(source).toContain('button[title="确认删除音色记录"]');
    expect(source).toContain('.minimax-clone-voice-manager button');
    expect(source).toContain("scrollIntoView({ block: 'center', inline: 'nearest' })");
    const styles = await (await import('node:fs/promises')).readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain(":root[data-theme='light'] .settings-content .provider-profile-card");
    expect(styles).toContain(":root[data-theme='light'] .settings-content .provider-config-note");
    expect(styles).toContain(":root[data-theme='light'] .settings-content .ghost-action");
    expect(styles).toContain(":root[data-theme='light'] .settings-content .segmented button.selected");
  });

  it('exercises Volcengine V3 and legacy switching without clearing either endpoint', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    expect(editorialQaCaptureIds('volcengine-tts')).toEqual([
      'volcengine-v3-light-desktop',
      'volcengine-legacy-dark-compact',
    ]);
    expect(source).toContain("'[role=\"group\"][aria-label=\"接口版本\"]'");
    expect(source).toContain('button.textContent?.trim() === label');
    expect(source).toContain("selectVersion('新版 V3', 'V3 接口地址')");
    expect(source).toContain("selectVersion('旧版接口', '旧版接口地址')");
    expect(source).toContain("findSettingsInput('V3 接口地址')");
    expect(source).toContain("findSettingsInput('旧版接口地址')");
    expect(source).toContain("setInputValue(v3Endpoint, 'https://qa-v3.example/api/v3/tts/unidirectional')");
    expect(source).toContain("setInputValue(legacyEndpoint, 'https://qa-legacy.example/api/v1/tts')");
    expect(source).toContain('state.volcengineVersion.v3ValuePreserved');
    expect(source).toContain('state.volcengineVersion.legacyValuePreserved');
  });

  it('keeps the real Electron capture contract on native capturePage and deterministic matrices', async () => {
    const harness = await (await import('node:fs/promises')).readFile(new URL('../scripts/editorial-qa-electron.ts', import.meta.url), 'utf8');
    const main = await (await import('node:fs/promises')).readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const shell = await (await import('node:fs/promises')).readFile(new URL('../src/app/AppShell.tsx', import.meta.url), 'utf8');
    expect(harness).toContain('mkdtemp(join(tmpdir(), \'storydream-editorial-qa-\'))');
    expect(harness).toContain('STORYDREAM_QA_RUN_TOKEN');
    expect(harness).toContain('runBoundedProcess');
    expect(harness).toContain('const timeoutMs = 420_000;');
    expect(harness).toContain('partialEditorialQaProgress');
    expect(harness).toContain('partial capture progress');
    expect(harness).toContain('Active capture:');
    expect(harness).toContain('editorialQaExpectedCaptureCount(scope)');
    expect(harness).toContain('qaReport.activeCapture !== null');
    expect(harness).toContain('incomplete capture report');
    expect(harness).not.toMatch(/taskkill\s+\/IM|playwright|puppeteer/u);
    expect(main).toContain('force-device-scale-factor');
    expect(main).toContain('useContentSize: true');
    expect(main).toContain('backgroundThrottling: !editorialQaConfig');
    expect(main).toContain('captureEditorialQa');
    expect(main).toContain("editorialQaConfig?.scope !== 'workflow'");
    expect(shell).toContain('data-nav-view={newTaskPrimaryAction.view}');
    expect(await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8')).toContain('await writeEditorialQaReport');
  });

  it('keeps editable form text readable in both shell themes', async () => {
    const styles = await (await import('node:fs/promises')).readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('background: var(--surface-ink);');
    expect(styles).toContain('color: var(--text);');
  });

  it('measures readable template operations without repainting preview canvases', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    const styles = await (await import('node:fs/promises')).readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(source).toContain('templateOperationalContrast');
    expect(source).toContain("'.prompt-template-row, .prompt-template-gallery .ghost-action, .prompt-template-gallery .chip'");
    expect(source).toContain("'.draft-template-toolbar .ghost-action, .draft-template-card .ghost-action, .draft-template-card .danger-action, .new-template-card'");
    expect(source).toContain('contrastRatio < 4.5');
    expect(source).toContain("value.startsWith('color(srgb')");
    expect(source).toContain('channels.slice(0, 3).map((channel) => channel * 255)');
    expect(source).toContain('state.templateOperationalContrast.failures.length > 0');
    expect(styles).toMatch(/\.chip,\s*\n\.ghost-action,[\s\S]*?\.mini-button \{[\s\S]*?background: var\(--panel-2\);/u);
    expect(styles).toContain('background: var(--surface-ink);\n  color: var(--text);');
    expect(styles).toContain('.draft-template-thumb {');
    expect(styles).toContain('background: #090d12;');
  });

  it('accepts a parent-created temp root and consumes its regular sentinel once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-editorial-qa-test-'));
    const sentinel = join(root, '.editorial-qa-sentinel');
    const userData = join(root, 'user-data');
    const report = join(userData, 'report.json');
    const captures = join(userData, 'captures');
    const token = 'a'.repeat(32);
    await mkdir(userData);
    await writeFile(sentinel, token, { flag: 'wx' });
    const env: EditorialQaEnvironment = {
      STORYDREAM_QA_RUN_ROOT: root,
      STORYDREAM_QA_RUN_TOKEN: token,
      STORYDREAM_QA_SENTINEL: sentinel,
      STORYDREAM_QA_USER_DATA: userData,
      STORYDREAM_QA_REPORT: report,
      STORYDREAM_QA_CAPTURES: captures,
      STORYDREAM_QA_SCOPE: 'shell',
    };

    try {
      const config = resolveEditorialQaConfig(env, tmpdir());
      expect(config).toMatchObject({ root, sentinel, userData, report, captures, scope: 'shell' });
      expect(() => resolveEditorialQaConfig(env, tmpdir())).toThrow('sentinel');
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(root, { recursive: true, force: true });
    }
  });
});
