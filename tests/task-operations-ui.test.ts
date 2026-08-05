import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('editorial task operations surfaces', () => {
  it('renders the queue as a dense progress table with a fixed event rail', async () => {
    const [page, css] = await Promise.all([
      source('../src/features/tasks/QueuePage.tsx'),
      source('../src/styles/features/task-operations.css'),
    ]);
    expect(page).toContain("import '../../styles/features/task-operations.css';");
    expect(page).toContain('taskProgressSnapshot(task)');
    expect(page).toContain('data-task-operations="queue"');
    expect(page).toContain('collectTaskEventPages');
    expect(page).toContain('api.listTaskEvents(taskId, { limit: 100 })');
    expect(page).toContain('className="task-queue-table"');
    expect(page).toContain('className="task-event-rail"');
    expect(page).toContain('className="task-event-time"');
    expect(page).toContain('sortTimelineEvents(events.slice(-24)).reverse()');
    expect(page).toContain('aria-label="刷新任务事件"');
    expect(page).toContain('role="progressbar"');
    expect(page).toContain('activeImageConcurrency(state.config)');
    expect(page).toContain("task.status === 'running' ? progress.position : progress.completed");
    expect(page).toContain("task.status === 'paused' || task.status === 'failed' || task.status === 'cancelled'");
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 280px;');
    expect(css).toContain('grid-template-columns: minmax(260px, 1fr) 120px 170px 160px 86px;');
    expect(css).toContain('.task-operations-view .status-pill::before');
  });

  it('keeps task-operation status and solid accent controls readable in both themes', async () => {
    const css = await source('../src/styles/features/task-operations.css');

    expect(css).toMatch(/\.task-operations-view \.status-pill\.running,[\s\S]*?color: var\(--shell-accent-strong\);/u);
    for (const selector of [
      '.task-queue-filters button.active',
      '.history-page[data-task-operations="history"] .chip.active',
      '.task-detail-shell[data-task-operations="detail"] .task-detail-run-control.accent',
      '.task-stage-track .pipeline-step.completed .pipeline-node',
      '.task-detail-shell[data-task-operations="detail"] .artifact-tabs button.active',
    ]) {
      const block = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)) + 1);
      expect(block, selector).toContain('color: var(--shell-focus-contrast);');
    }
    expect(css).not.toMatch(/background: var\(--(?:shell-accent|ok)\);\s*color: #fff;/u);
    expect(css).toMatch(/\.task-detail-shell\[data-task-operations="detail"\] \.preview-meta-grid div \{[\s\S]*?background: var\(--shell-surface\);/u);
    expect(css).toMatch(/\.task-detail-shell\[data-task-operations="detail"\] \.preview-meta-grid small \{[\s\S]*?color: var\(--shell-muted\);/u);
    expect(css).toMatch(/\.task-detail-shell\[data-task-operations="detail"\] \.preview-meta-grid strong \{[\s\S]*?color: var\(--shell-text\);/u);
    const workspaceStart = css.indexOf('.task-media-workspace {');
    const workspaceRule = css.slice(workspaceStart, css.indexOf('}', workspaceStart) + 1);
    expect(workspaceRule).toContain('background: var(--media-bg);');
    expect(css).toMatch(/\.task-media-frame \.draft-preview-large \{[\s\S]*?border-color: var\(--media-border\);/u);
    expect(css).toMatch(/\.task-media-progress i \{[\s\S]*?background: var\(--media-accent\);/u);
    const artifactSurfaceStart = css.indexOf('.task-detail-shell[data-task-operations="detail"] .artifact-section {');
    const artifactSurfaceRule = css.slice(artifactSurfaceStart, css.indexOf('}', artifactSurfaceStart) + 1);
    expect(artifactSurfaceStart).toBeGreaterThan(-1);
    expect(artifactSurfaceRule).toContain('background: var(--shell-surface-raised);');
    expect(artifactSurfaceRule).toContain('color: var(--shell-text);');

    const artifactOperationStart = css.indexOf('.task-detail-shell[data-task-operations="detail"] .artifact-text-block,');
    const artifactOperationRule = css.slice(artifactOperationStart, css.indexOf('}', artifactOperationStart) + 1);
    expect(artifactOperationStart).toBeGreaterThan(-1);
    for (const selector of ['.artifact-source-list div', '.artifact-scene-list div', '.artifact-cover-grid div', '.artifact-path-list span', '.artifact-empty']) {
      expect(artifactOperationRule, selector).toContain(selector);
    }
    expect(artifactOperationRule).toContain('background: var(--shell-surface);');
    expect(artifactOperationRule).toContain('color: var(--shell-text);');
    expect(css).toMatch(/\.task-detail-shell\[data-task-operations="detail"\] \.artifact-empty,[\s\S]*?color: var\(--shell-muted\);/u);

    const artifactMediaStart = css.indexOf('.task-detail-shell[data-task-operations="detail"] .image-preview-card,');
    const artifactMediaRule = css.slice(artifactMediaStart, css.indexOf('}', artifactMediaStart) + 1);
    expect(artifactMediaStart).toBeGreaterThan(-1);
    expect(artifactMediaRule).toContain('.artifact-image-card');
    expect(artifactMediaRule).toContain('--text: var(--media-text);');
    expect(artifactMediaRule).toContain('--muted: var(--media-muted);');
    expect(artifactMediaRule).toContain('--panel-2: var(--media-surface);');
    expect(artifactMediaRule).toContain('--line: var(--media-border);');
    expect(artifactMediaRule).toContain('color: var(--media-text);');
    expect(artifactMediaRule).not.toContain('.artifact-source-list');
    expect(artifactMediaRule).not.toContain('.artifact-scene-list');
  });

  it('keeps history governance in a flat responsive table', async () => {
    const [page, css] = await Promise.all([
      source('../src/features/tasks/HistoryPage.tsx'),
      source('../src/styles/features/task-operations.css'),
    ]);
    expect(page).toContain("import '../../styles/features/task-operations.css';");
    expect(page).toContain('data-task-operations="history"');
    expect(page).toContain('className="task-history-toolbar"');
    expect(page).toContain('<details className="task-history-more-filters">');
    expect(page).toContain('aria-label="状态"');
    expect(page).toContain("historyArchiveFilterLabels = ['活跃任务', '已归档']");
    expect(page).toContain("['任务', '类型', '当前状态', '进度', '更新时间', '操作']");
    expect(page).toContain('taskHistoryTypeLabel(task)');
    expect(page).toContain('aria-label="归档任务"');
    expect(page).toContain('aria-label="归档记录"');
    expect(page).toContain('aria-label="恢复任务"');
    expect(page).toContain('aria-label="恢复记录"');
    expect(page).toContain('aria-label="永久删除记录"');
    expect(page).toContain('<DataTable');
    expect(page).toContain('<CursorPagination');
    expect(page).toContain('<ConfirmDialog');
    expect(css).toContain('.history-page[data-task-operations="history"] .table-row');
    expect(css).not.toMatch(/history-page[^}]+display:\s*grid[^}]+card/isu);
  });

  it('uses the real seven-stage progress and a fixed media workspace in task detail', async () => {
    const [detail, artifact, css] = await Promise.all([
      source('../src/features/tasks/TaskDetailPage.tsx'),
      source('../src/features/tasks/TaskArtifactPreview.tsx'),
      source('../src/styles/features/task-operations.css'),
    ]);
    expect(detail).toContain("import '../../styles/features/task-operations.css';");
    expect(detail).toContain('data-task-operations="detail"');
    expect(detail).toContain('className="task-stage-track"');
    expect(detail).toContain('api.getDraftTemplateDetail(templateId)');
    expect(detail).toContain('resolveTaskTemplateSelection(');
    expect(detail).toContain('resolvedDraftTemplate?.id === previewDraftTemplateId');
    expect(detail).toContain('setResolvedDraftTemplate({ id: templateId, template })');
    expect(detail).toContain('progressStages.map((step)');
    expect(detail).toContain("setTab('images')");
    expect(detail).toContain("setTab('events')");
    expect(detail).toContain('暂停任务');
    expect(detail).toContain('重试当前步骤');
    expect(detail).toContain('label={taskOperationStatusLabel(activeTask)}');
    expect(detail).not.toContain('label={`${taskOperationStatusLabel(activeTask)} · ${progress.position} / ${progress.total}`}');
    expect(detail).toContain('taskOperationStageTitle(step.title)');
    expect(artifact).toContain('className="task-media-workspace"');
    expect(artifact).toContain('className="task-media-canvas"');
    expect(artifact).toContain('className="task-scene-rail"');
    expect(artifact).toContain('data-preview-kind={coverSelected ? \'cover\' : \'scene\'}');
    expect(artifact).toContain('data-scene-kind="cover"');
    expect(artifact).toContain('<span>00</span>');
    expect(artifact).toContain("task.coverImageMode === 'auto' ? undefined : artifact.cover?.title");
    expect(artifact).toContain('titleText={coverSelected ? coverPageTitle : previewContent.title}');
    expect(artifact).toContain('<DraftTemplatePreview');
    expect(artifact).toContain('api.readAssetDataUrl(selectedImagePath)');
    expect(artifact).toContain('imageBySceneId.has(scene.id)');
    expect(detail).toContain('activeDraftTemplate');
    expect(detail).toContain('aria-label="选择任务草稿模板"');
    expect(detail).toContain('data-template-location="toolbar"');
    expect(detail).toContain('data-template-location="delivery"');
    expect(detail.match(/data-template-location=/gu)).toHaveLength(2);
    expect(detail).toContain('className="task-template-select-menu"');
    expect(detail).toContain('role="listbox"');
    expect(detail).toContain('role="option"');
    expect(detail).not.toContain('<select\n                aria-label="选择任务草稿模板"');
    expect(detail).toContain('onApplyTemplate={applyDraftTemplate}');
    expect(detail).toContain('api.updateTaskTemplate(activeTask.id, selectedDraftTemplateId)');
    expect(detail).toContain('disabled={settingsLocked || templateBusy}');
    expect(detail).toContain('const repackDisabled = settingsDisabled || draftBusy');
    expect(detail).toContain("data-applied-template-id={templateSelection.appliedTemplateId}");
    expect(detail).toContain("data-template-state={templateChanged ? 'pending'");
    expect(artifact).toContain('打开草稿目录');
    expect(detail).toContain("templateSelection.appliedTemplateMissing ? '请选择模板' : '已应用'");
    expect(detail).not.toContain(': state.draftTemplates[0].id;');
    expect(detail).toContain('api.repackTaskDraft(activeTask.id)');
    expect(detail).toContain('api.updateTaskBgm(activeTask.id, bgmSelectionId)');
    expect(detail).toContain('api.launchJianying(activeTask.id)');
    expect(detail).toContain('剪映草稿已生成');
    expect(detail).toContain('重新打包');
    expect(artifact).toContain('StoryboardSubtitleEditor');
    expect(artifact).toContain('api.updateTaskSubtitleLines(task.id, input)');
    expect(artifact).toContain('subtitleLineIssues(linesBySceneId[scene.id] ?? [], maxCharsPerLine)');
    expect(artifact).toContain('repairSubtitleProblemLines(lines, scene.cap, maxCharsPerLine)');
    expect(artifact).toContain('修复问题行');
    expect(artifact).toContain('行号已标红');
    expect(detail).toContain('openTemplateManager');
    expect(artifact).toContain('setSelectedSceneId');
    expect(artifact).toContain('taskPreviewCuesForScene');
    expect(artifact).toContain('className="task-media-cue-control"');
    expect(artifact).toContain('aria-label="上一条字幕"');
    expect(artifact).toContain('aria-label="下一条字幕"');
    expect(artifact).toContain("tab === 'events'");
    expect(artifact).not.toContain('.slice(0, 6)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 260px;');
    expect(css).toMatch(/\.task-scene-item\.cover\s*\{[\s\S]*border:/u);
    expect(css).toContain('background: var(--media-bg);');
    expect(css).toContain('@media (max-width: 1180px)');
    expect(css).toMatch(/\.task-detail-shell\[data-task-operations="detail"\] \.task-detail-bar \{[\s\S]*?flex-wrap: nowrap;/u);
    expect(css).toMatch(/\.task-detail-actions \{[\s\S]*?flex: 0 1 auto;[\s\S]*?flex-wrap: nowrap;/u);
    expect(css).toContain('.task-template-switcher');
    expect(css).toContain('.task-template-apply.active');
    expect(css).toMatch(/\.task-template-apply\.active\s*\{[^}]*color:\s*var\(--shell-accent-contrast\);/u);
    expect(css).toContain('.task-draft-delivery[data-draft-status="ready"]');
    expect(css).toContain('.storyboard-caption-numbers span.over-limit');
    expect(css).toMatch(/linear-gradient\(\s*135deg,/u);
    expect(css).toMatch(/linear-gradient\(\s*110deg,/u);
    expect(css).toMatch(/\.task-draft-delivery\[data-draft-status="ready"\][\s\S]*?border-color:\s*transparent;/u);
    expect(css).toMatch(/\.task-draft-delivery\[data-draft-status="ready"\] \.task-draft-delivery-bar\s*\{[\s\S]*?min-height:\s*64px;/u);
    expect(css).toMatch(/\.task-draft-delivery\[data-draft-status="ready"\] \.task-draft-status\.ready > span\s*\{[\s\S]*?width:\s*34px;[\s\S]*?background:\s*var\(--ok\);/u);
    expect(css).toMatch(/\.task-draft-commands \.launch-jianying\s*\{[^}]*color:\s*var\(--shell-focus-contrast\);/u);
    expect(css).toMatch(/\.task-stage-track \.pipeline-step \.error-summary-button\.compact\s*\{[\s\S]*?width:\s*100%;[\s\S]*?overflow:\s*hidden;/u);
    expect(css).toMatch(/\.task-stage-track \.pipeline-step \.error-summary-button\.compact \.error-mark\s*\{[\s\S]*?display:\s*grid;[\s\S]*?place-items:\s*center;[\s\S]*?margin-top:\s*0;/u);
    expect(css).toMatch(/\.task-stage-track \.pipeline-step \.error-summary-button\.compact > span:last-child\s*\{[\s\S]*?display:\s*block;[\s\S]*?text-overflow:\s*ellipsis;/u);
    expect(css).toMatch(/\.task-detail-shell\[data-task-operations="detail"\] \.artifact-tabs\s*\{[\s\S]*?width:\s*100%;[\s\S]*?display:\s*flex;/u);
    expect(css).toMatch(/\.task-detail-shell\[data-task-operations="detail"\] \.artifact-section \.panel-title-row\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?margin-bottom:\s*0;/u);
    expect(css).toContain('background: var(--shell-surface);');
    expect(css).toContain('.task-template-select-option[aria-selected="true"]');
    expect(css).toMatch(/\.task-bgm-field select\s*\{[^}]*color-scheme:\s*dark;/u);
    expect(css).toMatch(/\.task-bgm-field select option\s*\{[^}]*background:\s*var\(--shell-surface-raised\);[^}]*color:\s*var\(--shell-text\);/u);
    expect(css).toMatch(/:root\[data-theme='light'\] \.task-bgm-field select\s*\{[^}]*color-scheme:\s*light;/u);
    const runner = await source('../src/shared/runner.ts');
    expect(runner).toContain("const latestTask = state.tasks.find((item) => item.id === task.id)");
    expect(runner).toContain("state.draftTemplates.find((item) => item.id === draftTask.templateId)");
    const shell = await source('../src/styles/shell.css');
    expect(shell).toContain('grid-template-rows: 73px minmax(0, 1fr);');
  });

  it('adds deterministic real Electron task-operation scenarios', async () => {
    const [qa, main, css] = await Promise.all([
      source('../electron/editorial-qa.ts'),
      source('../electron/main.ts'),
      source('../src/styles.css'),
    ]);
    expect(qa).toContain("'task-operations'");
    expect(qa).toContain("{ id: 'queue-operations-desktop'");
    expect(qa).toContain("{ id: 'history-operations-desktop'");
    expect(qa).toContain("{ id: 'task-detail-operations-desktop'");
    expect(qa).toContain("{ id: 'task-detail-draft-delivery-light-desktop'");
    expect(qa).toContain("{ id: 'task-detail-draft-delivery-dark-desktop'");
    expect(qa).toContain("{ id: 'task-detail-error-summary-desktop'");
    expect(qa).toContain("{ id: 'task-detail-template-menu-dark-desktop'");
    expect(qa).toContain("{ id: 'history-operations-compact'");
    expect(qa).toContain('deleteDialogFocusWrapped');
    expect(qa).toContain('deleteDialogEscapeRestored');
    expect(main).toContain("const draftTemplateGalleryScope = editorialQaConfig?.scope === 'system'");
    expect(main).toContain('if (!taskOperationsScope && !draftTemplateGalleryScope) return;');
    expect(qa).toContain("scenarioId === 'queue-operations-desktop'");
    expect(qa).toContain("scenarioId === 'task-detail-operations-desktop'");
    expect(qa).toContain("scenarioId.startsWith('task-detail-draft-delivery-')");
    expect(qa).toContain(".task-draft-delivery[data-draft-status=\"ready\"]");
    expect(qa).toContain('gradientLayers.length === 2');
    expect(main).toContain('artifactStatePath: completedStatePath');
    expect(main).toContain('draftContentPath: completedDraftContentPath');
    expect(qa).toContain("scenarioId === 'task-detail-error-summary-desktop'");
    expect(qa).toContain("document.querySelector('.task-stage-track .pipeline-step.failed')");
    expect(qa).toContain("markStyle.display === 'grid'");
    expect(qa).toContain("markStyle.marginTop === '0px'");
    expect(qa).toContain("labelStyle.textOverflow === 'ellipsis'");
    expect(qa).toContain('taskTemplateControlsReady');
    expect(qa).toContain('button.task-template-select-trigger[aria-label="选择任务草稿模板"]');
    expect(qa).toContain("menuBackground !== 'rgb(255, 255, 255)'");
    expect(qa).toContain("document.querySelector('.task-template-apply')");
    expect(qa).toContain("templateApply.textContent?.trim() === '已应用'");
    expect(qa).toContain("getComputedStyle(templateApply).color === 'rgb(16, 18, 20)'");
    expect(qa).toContain("persistedTask?.templateId === 'qa-selected-draft-template'");
    expect(qa).toContain("templateSwitcher.dataset.templateState === 'pending'");
    expect(qa).toContain("state.currentScene === '01 / 12'");
    expect(qa).toContain("state.generatedScenes === '8 / 12 已生成'");
    expect(qa).toContain("previewImage instanceof HTMLImageElement");
    expect(qa).toContain('previewImage.naturalWidth > 0');
    expect(qa).toContain("state.templateId === 'qa-selected-draft-template'");
    expect(qa).toContain("state.imageTop === '22%'");
    expect(qa).toContain('Number.parseFloat(state.titleFontSize) >= 36');
    expect(qa).toContain('Number.parseFloat(state.titleFontSize) <= 64');
    expect(qa).toContain("state.titleFontFamily.includes('Microsoft YaHei')");
    expect(main).toContain("templateId: selectedTemplateId");
    expect(css).toContain('font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;');
    expect(qa).toContain("button.getAttribute('aria-label') === '永久删除记录'");
  });
});
