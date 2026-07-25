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
    expect(page).toContain('contentTracks');
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
