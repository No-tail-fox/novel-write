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
    expect(css).toMatch(/\.task-media-frame-accent \{[\s\S]*?background: var\(--media-accent\);/u);
    expect(css).toMatch(/\.task-media-progress i \{[\s\S]*?background: var\(--media-accent\);/u);
    const artifactMediaStart = css.indexOf('.task-detail-shell[data-task-operations="detail"] .artifact-scene-list div,');
    const artifactMediaRule = css.slice(artifactMediaStart, css.indexOf('}', artifactMediaStart) + 1);
    expect(artifactMediaStart).toBeGreaterThan(-1);
    expect(artifactMediaRule).toContain('--text: var(--media-text);');
    expect(artifactMediaRule).toContain('--muted: var(--media-muted);');
    expect(artifactMediaRule).toContain('--panel-2: var(--media-surface);');
    expect(artifactMediaRule).toContain('--line: var(--media-border);');
    expect(artifactMediaRule).toContain('color: var(--media-text);');
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
    expect(detail).toContain('progressStages.map((step)');
    expect(detail).toContain("setTab('images')");
    expect(detail).toContain("setTab('events')");
    expect(detail).toContain('暂停任务');
    expect(detail).toContain('重试当前步骤');
    expect(detail).toContain('taskOperationStageTitle(step.title)');
    expect(artifact).toContain('className="task-media-workspace"');
    expect(artifact).toContain('className="task-media-canvas"');
    expect(artifact).toContain('className="task-scene-rail"');
    expect(artifact).toContain('task-media-frame-accent');
    expect(artifact).toContain('setSelectedSceneId');
    expect(artifact).toContain("tab === 'events'");
    expect(artifact).not.toContain('.slice(0, 6)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 260px;');
    expect(css).toContain('background: var(--media-bg);');
    expect(css).toContain('@media (max-width: 1180px)');
    const shell = await source('../src/styles/shell.css');
    expect(shell).toContain('grid-template-rows: 73px minmax(0, 1fr);');
  });

  it('adds deterministic real Electron task-operation scenarios', async () => {
    const [qa, main] = await Promise.all([
      source('../electron/editorial-qa.ts'),
      source('../electron/main.ts'),
    ]);
    expect(qa).toContain("'task-operations'");
    expect(qa).toContain("{ id: 'queue-operations-desktop'");
    expect(qa).toContain("{ id: 'history-operations-desktop'");
    expect(qa).toContain("{ id: 'task-detail-operations-desktop'");
    expect(qa).toContain("{ id: 'history-operations-compact'");
    expect(qa).toContain('deleteDialogFocusWrapped');
    expect(qa).toContain('deleteDialogEscapeRestored');
    expect(main).toContain("scope !== 'task-operations' && editorialQaConfig?.scope !== 'workflow' && editorialQaConfig?.scope !== 'all'");
    expect(qa).toContain("scenarioId === 'queue-operations-desktop'");
    expect(qa).toContain("scenarioId === 'task-detail-operations-desktop'");
    expect(qa).toContain("button.getAttribute('aria-label') === '永久删除记录'");
  });
});
