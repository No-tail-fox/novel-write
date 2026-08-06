import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('HTML video editorial studio', () => {
  it('exposes Storybound voice, foreground, preset, and rerender controls', async () => {
    const [panels, tabs, templates, main, styles] = await Promise.all([
      source('../src/features/html-video/HtmlVideoStoryboundPanels.tsx'),
      source('../src/features/html-video/HtmlVideoTabPanel.tsx'),
      source('../src/shared/html-video-scene-templates.ts'),
      source('../electron/main.ts'),
      source('../src/styles/features/html-video.css'),
    ]);
    expect(panels).toContain('onClick={applyVoiceSettings}');
    expect(panels).toContain('应用并重配全部');
    expect(panels).toContain('手动添加前景');
    expect(panels).toContain('api.addHtmlVideoAsset(task.id, scene.index, prompt.trim())');
    expect(panels).not.toContain("api.updateHtmlVideoScene(task.id, scene.index, [{ field: 'addElement'");
    expect(panels).toContain('HTML_VIDEO_SCENE_TEMPLATES.map');
    expect(tabs).toContain('api.regenerateHtmlVideoCover(task.id)');
    expect(tabs).toContain('data-html-video-edit-field="coverPrompt"');
    expect(tabs).toContain('重画封面');
    expect(tabs).toContain('api.rerenderHtmlVideo(task.id)');
    expect(tabs).toContain('onClick={rerender}');
    expect(tabs).toContain('重新出片');
    expect(templates.match(/id: '/gu)).toHaveLength(24);
    expect(panels).toContain('template.choreography');
    expect(panels).toContain('data-motion={cue.preset}');
    expect(styles).toContain('.hv-template-grid > button:hover:not(:disabled) .hv-template-swatch [data-motion]');
    expect(styles).toContain('.hv-template-grid > button:focus-visible .hv-template-swatch [data-motion]');
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hv-template-swatch \[data-motion\]/u);
    expect(styles).toContain('.hv-cover-workspace {\n  container-type: inline-size;');
    expect(styles).toContain('@container (max-width: 650px)');
    expect(styles).toContain('.hv-cover-editor-grid {\n  display: grid;\n  grid-template-columns: 1fr;');

    const addAssetHandler = main.slice(
      main.indexOf("trustedHandle('html-video:add-asset'"),
      main.indexOf("trustedHandle('html-video:replace-asset'"),
    );
    expect(addAssetHandler.indexOf('dialog.showOpenDialog')).toBeLessThan(addAssetHandler.indexOf('applyHtmlVideoSceneChanges'));
    expect(addAssetHandler).toContain('replaceHtmlVideoEditorialAsset');
    expect(addAssetHandler).toContain('persistHtmlVideoEditorialMutation');
  });

  it('exposes scene motion and a real-thumbnail transition demonstration in preview', async () => {
    const [page, panels, styles, qa] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/features/html-video/HtmlVideoStoryboundPanels.tsx'),
      source('../src/styles/features/html-video.css'),
      source('../scripts/qa-html-video-ui.mjs'),
    ]);

    expect(page).toContain('data-html-video-create-field="sceneMotion"');
    expect(page).toContain('data-html-video-edit-field="sceneMotion"');
    expect(panels).toContain('data-html-video-preview-effects="true"');
    expect(panels).toContain('<span>镜头动效</span>');
    expect(panels).toContain('<span>场景转场</span>');
    expect(panels).toContain("field: 'sceneMotion'");
    expect(panels).toContain("field: 'transitionType'");
    expect(panels).toContain('保存动效');
    expect(panels).toContain('重播转场示意');
    expect(panels).toContain('data-transition={transitionType}');
    expect(panels).toContain('transitionThumbnails.map');
    expect(styles).toContain('.hv-preview-effects {');
    expect(styles).toContain('.hv-transition-demo {');
    expect(styles).toContain('@keyframes hv-transition-demo-in');
    expect(styles).toContain('.hv-cover-workspace:has(> .hv-reference-preview),');
    expect(styles).toContain('@container hv-reference-preview (max-width: 760px)');
    expect(qa).toContain('STORYDREAM_QA_EFFECTS_ONLY');
    expect(qa).toContain('STORYDREAM_QA_TEMPLATE_PREVIEW_ONLY');
    expect(qa).toContain('exerciseTemplatePreview');
    expect(qa).toContain("scope: 'template-preview'");
    expect(qa).toContain("'template-preview-desktop.png'");
    expect(qa).toContain("'template-preview-compact.png'");
    expect(qa).toContain('pixelChanged');
    expect(qa).toContain('exercisePreviewEffects');
    expect(qa).toContain("scope: 'preview-effects'");
    expect(qa).toContain("'effects-desktop.png'");
    expect(qa).toContain("'effects-compact.png'");
    expect(qa).toContain("demoAnimationName === 'hv-transition-demo-wipe-left'");
    expect(qa).toContain('workspaceHorizontalOverflow');
    expect(qa).toContain('createQaSceneImage');
  });

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
    expect(page).toContain('aria-label="文案来源"');
    expect(page).toContain('AI 创作');
    expect(page).toContain('粘贴文案');
    expect(page).toContain('searchHtmlVideoResearchSources');
    expect(page).toContain('composeHtmlVideoResearchCopy');
    expect(page).toContain('onClick={searchHtmlVideoSources}');
    expect(page).toContain('onClick={composeHtmlVideoCopy}');
    expect(page).toContain('HTML_VIDEO_SEARCH_PROVIDER_OPTIONS.map');
    expect(page).toContain('data-html-video-research-results="true"');
    expect(page).toContain('searchContext.providerStatuses.map');
    expect(page).toContain('selectedSearchSourceIds.includes(id)');
    expect(page).toContain('生成文案（可编辑）');
    expect(page).toContain("aiSources: copyMode === 'ai' ? ['web'] : []");
    expect(page).toContain("selectedSources: copyMode === 'ai' ? selectedSources : []");
    expect(page).toContain('正在搜索网页资料');
    expect(page).toContain('正在创作文案');
    expect(page).not.toContain('searchEnabled: false');
    expect(page).not.toContain('直接生成');
    expect(page).toContain('listAllHtmlVideoTaskOptions');
    expect(page).toContain('taskType: \'html-video\'');
    expect(page).toContain('value={taskSelectValue}');
    expect(page).toContain('<h2>画面</h2>');
    expect(page).toContain('<h2>封面海报</h2>');
    expect(page).toContain('<h2>配音</h2>');
    expect(page).toContain('<h2>画面预设</h2>');
    expect(page).toContain('<Field label="画面样式">');
    expect(page).toContain('<option value="">不套用画面预设</option>');
    expect(page).toContain('aria-label="打开已有 HTML 动画视频任务"');
    expect(page).toContain('setPageMode(\'workspace\')');
    expect(page).toContain('onClick={openHtmlVideoCreation}');
    expect(page).not.toContain('className="hv-create-details"');
    expect(styles).toContain('.hv-create-page {');
    expect(styles).toContain('.hv-create-sheet {');
    expect(qa).toContain('surfaceHorizontalOverflow');
    expect(styles).toContain('.hv-create-section {');
    expect(styles).toContain('.hv-copy-mode {');
    expect(styles).toContain('.hv-research-provider-grid {');
    expect(styles).toContain('.hv-research-source-list {');
    expect(styles).not.toContain('.hv-create-details');
    expect(qa).toContain('inspectCreationPage');
    expect(qa).toContain('exerciseLocalizedOptionControls');
    expect(qa).toContain('STORYDREAM_QA_LOCALIZATION_ONLY');
    expect(qa).toContain('scrollLocalizedOptionsIntoView');
    expect(qa).toContain("'option-labels-desktop.png'");
    expect(qa).toContain("'option-labels-compact.png'");
    expect(qa).toContain("['fade', '淡入淡出']");
    expect(qa).toContain("['volcengine', '火山引擎']");
    expect(qa).toContain("targetTransition: 'wipeleft'");
    expect(qa).toContain("targetProvider: 'minimax'");
    expect(qa).toContain('break qaRun');
    expect(qa).toContain('exerciseResearchProviderControl');
    expect(qa).toContain('.hv-research-provider input');
    expect(qa).toContain("'Input.dispatchKeyEvent'");
    expect(qa).toContain('creationCompact.researchProviders?.checked !== 4');
    expect(qa).toContain("'creation-desktop.png'");
    expect(qa).toContain("'creation-compact.png'");
    expect(qa).toContain("item.textContent?.trim() === 'AI 创作'");
    expect(qa).toContain("document.querySelector('.hv-ai-copy-fields input')");
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
    expect(styles).toContain('.hv-studio[data-has-task="true"] .hv-studio-panel-heading > div {');
    expect(styles).toContain('min-width: 60px;');
    expect(styles).toContain('max-width: 100%;');
  });

  it('keeps the production workspace visually unified across full and compact layouts', async () => {
    const styles = await source('../src/styles/features/html-video.css');
    const refinement = styles.slice(styles.indexOf('/* Production workspace visual refinement */'));

    expect(refinement).toContain('--shell-accent');
    expect(refinement).toContain('border-bottom: 0;');
    expect(refinement).toContain('box-shadow: inset 0 -2px 0 var(--shell-accent);');
    expect(refinement).toContain('grid-template-columns: minmax(0, 1fr) clamp(248px, 28%, 292px);');
    expect(refinement).toMatch(/@media \(max-width: 1080px\)[\s\S]*?\.hv-studio\[data-has-task="true"\] \.hv-run-steps \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u);
    expect(refinement).not.toContain('#22c7a0');
  });

  it('projects all governed controls and the real six-stage lifecycle into the studio', async () => {
    const [page, tabPanel, storyboundPanels, manifest] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/features/html-video/HtmlVideoTabPanel.tsx'),
      source('../src/features/html-video/HtmlVideoStoryboundPanels.tsx'),
      source('../src/shared/html-video-control-manifest.ts'),
    ]);
    expect(manifest).toContain('HTML_VIDEO_CONTROL_MANIFEST_V1');
    expect((manifest.match(/availability: 'editable'/g) ?? []).length).toBe(19);
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
    expect(htmlVideoQa).toContain('newTaskButtonClipped');
    expect(htmlVideoQa).toContain("document.querySelector('.hv-studio-canvas-heading strong')");
    expect(htmlVideoQa).toContain("const failedLightScreenshot = join(qaTempDir, 'failed-light.png')");
    expect(htmlVideoQa).toContain('inspectFailedTaskLightWorkspace');
    expect(htmlVideoQa).toContain("sample.label.startsWith('error-mark')");
    expect(htmlVideoQa).toContain("rawLegacyErrorVisible: Boolean(studio?.innerText.includes('HTML video planning step failed'))");
    expect(htmlVideoQa).toContain("retryText !== '从场景规划重试'");
    expect(qa).toContain("? 'two-column'");
    expect(htmlVideoQa).not.toContain("document.querySelector('.hv-config h2')");
    expect(htmlVideoQa).not.toContain("document.querySelector('.hv-workspace h3')");
  });
});
