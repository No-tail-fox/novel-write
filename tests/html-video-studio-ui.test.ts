import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('HTML video editorial studio', () => {
  it('opens on the dedicated creation page before entering a task workspace', async () => {
    const [page, styles, qa] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/styles/features/html-video.css'),
      source('../scripts/qa-html-video-ui.mjs'),
    ]);
    expect(page).toContain("type HtmlVideoPageMode = 'create' | 'workspace';");
    expect(page).toContain("useState<HtmlVideoPageMode>('create')");
    expect(page).toContain('data-html-video-create-page="true"');
    expect(page).toContain('输入文案，AI 自动规划分镜 → 出素材 → 配音 → 生成动画分镜');
    expect(page).toContain('<h2>文案</h2>');
    expect(page).toContain('<h2>画面</h2>');
    expect(page).toContain('<h2>封面海报</h2>');
    expect(page).toContain('<h2>配音</h2>');
    expect(page).toContain('<h2>输出</h2>');
    expect(page).toContain('aria-label="打开已有 HTML 动画视频任务"');
    expect(page).toContain('setPageMode(\'workspace\')');
    expect(page).toContain('onClick={openHtmlVideoCreation}');
    expect(page).not.toContain('className="hv-create-details"');
    expect(styles).toContain('.hv-create-page {');
    expect(styles).toContain('.hv-create-sheet {');
    expect(styles).toContain('.hv-create-section {');
    expect(styles).not.toContain('.hv-create-details');
    expect(qa).toContain('inspectCreationPage');
    expect(qa).toContain("'creation-desktop.png'");
    expect(qa).toContain("'creation-compact.png'");
    expect(qa).toContain('workspace rendered before a task was selected');
  });

  it('owns the approved three-region workspace without dropping task creation or editing controls', async () => {
    const [page, styles] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/styles/features/html-video.css'),
    ]);
    expect(page).toContain("import '../../styles/features/html-video.css';");
    expect(page).toContain('data-html-video-studio="html-video"');
    expect(page).toContain('className="hv-studio-parameters"');
    expect(page).toContain('className="hv-studio-canvas"');
    expect(page).toContain('className="hv-studio-run-rail"');
    expect(page).toContain('aria-label="切换 HTML 动画视频任务"');
    expect(page).toContain('createHtmlVideoTask');
    expect(page).toContain('<HtmlVideoConfigEditor');
    expect(page).toContain('data-media-canvas="html-video"');
    expect(page).toContain('className="hv-timeline"');
    expect(styles).toContain('grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(220px, 250px);');
    expect(styles).toContain('background: var(--media-bg);');
    expect(styles).toContain('@media (max-width: 1080px)');
    expect(styles).toMatch(/\.hv-studio-run-rail \.hv-step \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/u);
  });

  it('projects all governed controls and the real six-stage lifecycle into the studio', async () => {
    const [page, tabPanel, storyboundPanels, manifest] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/features/html-video/HtmlVideoTabPanel.tsx'),
      source('../src/features/html-video/HtmlVideoStoryboundPanels.tsx'),
      source('../src/shared/html-video-control-manifest.ts'),
    ]);
    expect(manifest).toContain('HTML_VIDEO_CONTROL_MANIFEST_V1');
    expect((manifest.match(/availability: 'editable'/g) ?? []).length).toBe(17);
    expect(page).toContain('htmlVideoSteps.map');
    expect(page).toContain('taskProgressLabel');
    expect(page).toContain("setTaskStatus('paused')");
    expect(page).toContain("setTaskStatus('running')");
    expect(page).toContain("setTaskStatus('cancelled')");
    expect(page).toContain('retryTask');
    expect(page).toContain('openOutputDirectory');
    expect(tabPanel).toContain('HtmlVideoCaptionEditor');
    expect(tabPanel).toContain('HtmlVideoCoverEditor');
    expect(tabPanel).toContain("if (!data.compositions.length) {");
    expect(tabPanel).toContain('{blocked()}');
    expect(tabPanel).toContain('controls');
    expect(tabPanel).toContain('onError');
    expect(tabPanel).toContain('onCanPlay');
    expect(storyboundPanels).toContain('htmlVideoMediaStatus(asset.src, mediaUrls, failedMediaPaths, isBrowserPreview)');
    expect(storyboundPanels).toContain('htmlVideoMediaStatus(voice.src, mediaUrls, failedMediaPaths, isBrowserPreview)');
    expect(storyboundPanels).toContain("toggle(item.index, 'foregroundHidden'");
    expect(storyboundPanels).toContain("toggle(item.index, 'titleHidden'");
    expect(storyboundPanels).toContain('api.updateHtmlVideoScene');
    expect(storyboundPanels).toContain('api.regenerateHtmlVideoAsset');
    expect(storyboundPanels).toContain('api.replaceHtmlVideoAsset');
    expect(storyboundPanels).toContain('api.regenerateHtmlVideoVoice');
    expect(storyboundPanels).toContain('InlineActionFeedback');
    expect(storyboundPanels).toContain('重画素材');
    expect(storyboundPanels).toContain('本地替换');
    expect(storyboundPanels).toContain('重配');
    expect(storyboundPanels).toContain("document.querySelectorAll<HTMLElement>('[src]')");
    expect(storyboundPanels).toContain('resolveCompositionReference(mediaUrl, current)');
  });

  it('uses theme-aware contrast ink on solid studio controls and lifecycle states', async () => {
    const styles = await source('../src/styles/features/html-video.css');
    const solidForegroundRules = [
      '.hv-studio-panel-heading .primary-action',
      '.hv-studio-parameters .segmented button.selected',
      '.hv-studio-run-rail .hv-step.done > span',
      '.hv-studio-run-rail .hv-step.running > span',
      '.hv-studio-run-rail .hv-step.failed > span',
    ];

    for (const selector of solidForegroundRules) {
      const rule = styles.slice(styles.indexOf(`${selector} {`));
      expect(rule, selector).toMatch(/^.*?\{[\s\S]*?color: var\(--shell-focus-contrast\);/u);
    }
    for (const selector of [
      '.hv-studio .hv-tab.active',
      '.hv-studio .hv-tab-content .segmented button.selected',
    ]) {
      const rule = styles.slice(styles.indexOf(`${selector} {`));
      expect(rule, selector).toMatch(/^.*?\{[\s\S]*?background: var\(--media-accent\);[\s\S]*?color: var\(--media-accent-contrast\);/u);
    }
    const taskActiveTab = styles.slice(styles.indexOf('.hv-studio[data-has-task="true"] .hv-tab.active {'));
    expect(taskActiveTab).toMatch(
      /^.*?\{[\s\S]*?background: var\(--shell-surface-raised\);[\s\S]*?color: var\(--shell-text\);/u,
    );
    expect(styles).toContain('var(--media-timeline-blue) 55%');
    expect(styles).toContain('var(--media-reel-amber) 52%');
    expect(styles).toContain('var(--media-ok) 52%');
    expect(styles).toMatch(/\.hv-studio \.hv-caption-color-item,[\s\S]*?\.hv-studio \.hv-media-loading \{[\s\S]*?color: var\(--media-muted\);/u);
    expect(styles).toMatch(/\.hv-studio \.hv-tab-content \.field > \.form-field-label \{[\s\S]*?color: var\(--media-text\);/u);
    expect(styles).toMatch(/\.hv-studio \.hv-caption-color-reset \{[\s\S]*?border-color: var\(--media-border\);[\s\S]*?background: #101316;[\s\S]*?color: var\(--media-muted\);/u);

    const taskCanvas = styles.slice(styles.indexOf('.hv-studio[data-has-task="true"] .hv-studio-media-canvas {'));
    expect(taskCanvas).toMatch(
      /^.*?\{[\s\S]*?background: var\(--shell-surface\);[\s\S]*?color: var\(--shell-text\);/u,
    );
    const outputFooter = styles.slice(styles.indexOf('.hv-studio[data-has-task="true"] .hv-video-output {'));
    expect(outputFooter).toMatch(
      /^.*?\{[\s\S]*?background: var\(--shell-surface-raised\);[\s\S]*?color: var\(--shell-text\);/u,
    );
    expect(styles).toMatch(/\.hv-studio\[data-has-task="true"\] \.hv-output-meta strong,[\s\S]*?\.hv-studio\[data-has-task="true"\] \.hv-output-path code \{[\s\S]*?color: var\(--shell-text\);/u);
    expect(styles).toMatch(/\.hv-studio\[data-has-task="true"\] \.hv-output-meta small,[\s\S]*?\.hv-studio\[data-has-task="true"\] \.hv-output-path small \{[\s\S]*?color: var\(--shell-muted\);/u);
    expect(styles).toMatch(/\.hv-studio\[data-has-task="true"\] \.hv-tab-content small,[\s\S]*?\.hv-studio\[data-has-task="true"\] \.hv-tab-content figcaption \{[\s\S]*?color: var\(--shell-muted\);/u);
    expect(styles).toMatch(/\.hv-authoring-statusbar \{[\s\S]*?min-height: 28px;[\s\S]*?color: var\(--media-text\);[\s\S]*?font-size: 10px;/u);

    const activeWorkspace = styles.slice(styles.lastIndexOf('.hv-studio[data-has-task="true"] {'));
    for (const token of [
      '--shell-surface',
      '--shell-surface-raised',
      '--shell-border',
      '--shell-text',
      '--shell-muted',
      '--shell-focus',
      '--shell-focus-contrast',
      '--text',
      '--muted',
      '--line',
    ]) {
      expect(activeWorkspace, token).toContain(`${token}:`);
    }
    expect(activeWorkspace).toContain('color-scheme: dark;');
    expect(activeWorkspace).toContain('.hv-studio[data-has-task="true"] .hv-studio-run-rail .hv-step strong');
    expect(activeWorkspace).not.toContain('.hv-studio[data-has-task="true"] .hv-run-rail .hv-step strong');
  });

  it('localizes legacy failed-step messages at every HTML workflow display surface', async () => {
    const [page, tabPanel, workflow] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/features/html-video/HtmlVideoTabPanel.tsx'),
      source('../src/shared/html-video-workflow.ts'),
    ]);
    expect(workflow).toContain('export function htmlVideoUserFacingError');
    expect(page).toContain('const taskDisplayMessage = activeTask ? htmlVideoUserFacingError(activeTask.errorMessage)');
    expect(page).toContain('fullMessage={htmlVideoUserFacingError(stepState.error)}');
    expect(tabPanel).toContain('htmlVideoUserFacingError(data.steps[failedStep].error || task.errorMessage');
  });

  it('adds a dedicated real-Electron capture scope for desktop and compact HTML studio states', async () => {
    const [qa, electronMain, htmlVideoQa] = await Promise.all([
      source('../electron/editorial-qa.ts'),
      source('../electron/main.ts'),
      source('../scripts/qa-html-video-ui.mjs'),
    ]);
    expect(qa).toContain("'html-video'");
    expect(qa).toContain('htmlVideoStudioStates');
    expect(qa).toContain("{ id: 'html-video-studio-light-desktop'");
    expect(qa).toContain("{ id: 'html-video-studio-light-compact'");
    expect(qa).toContain('data-html-video-studio');
    expect(qa).toContain('htmlVideoCompactParameterOrder');
    expect(qa).toContain("textContent?.includes('4/6')");
    expect(qa).toContain('naturalWidth > 0');
    expect(qa).toContain("document.querySelectorAll('.hv-reference-thumb')");
    expect(qa).toContain("document.querySelector('.hv-reference-phone iframe')");
    expect(qa).toContain("document.querySelector('.hv-timeline-track span')");
    expect(electronMain).toContain('seedHtmlVideoEditorialQa');
    expect(electronMain).toContain('createHtmlVideoTaskInput');
    expect(electronMain).toContain('ensureHtmlVideoTaskWorkDir');
    expect(htmlVideoQa).toContain("document.querySelector('.hv-studio-panel-heading h2')");
    expect(htmlVideoQa).toContain("document.querySelector('.hv-studio-canvas-heading strong')");
    expect(htmlVideoQa).toContain("const failedLightScreenshot = join(qaTempDir, 'failed-light.png')");
    expect(htmlVideoQa).toContain('inspectFailedTaskLightWorkspace');
    expect(htmlVideoQa).toContain("rawLegacyErrorVisible: Boolean(studio?.innerText.includes('HTML video planning step failed'))");
    expect(htmlVideoQa).toContain("retryText !== '从场景规划重试'");
    expect(qa).toContain("? 'two-column'");
    expect(htmlVideoQa).not.toContain("document.querySelector('.hv-config h2')");
    expect(htmlVideoQa).not.toContain("document.querySelector('.hv-workspace h3')");
  });
});
