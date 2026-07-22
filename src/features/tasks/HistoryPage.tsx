import { useCallback, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { CursorPagination } from '../../components/CursorPagination';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { StatusBadge as StatusPill, taskStatusLabel as statusLabel } from '../../components/StatusBadge';
import { useHistoryPage } from '../history/use-history-page';
import { taskProgressLabel } from '../../shared/html-video-workflow';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { HistoryListRequest, TaskStatus, TaskSummary } from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { formatDate } from './task-formatters';

export function HistoryPage({
  api,
  openTaskDetail,
  isTombstoned,
  familyEpoch,
}: {
  api: StoryDreamApi;
  openTaskDetail: (taskId: string) => void;
  isTombstoned: (family: 'task', id: string) => boolean;
  familyEpoch: number;
}) {
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [query, setQuery] = useState('');
  const historyAction = useAsyncAction();
  const request = useMemo<Extract<HistoryListRequest, { family: 'task' }>>(() => ({
    family: 'task',
    filter: 'active',
    ...(filter === 'all' ? {} : { status: filter }),
    ...(query.trim() ? { query } : {}),
    limit: 50,
  }), [filter, query]);
  const loadPage = useCallback((next: Extract<HistoryListRequest, { family: 'task' }>) => {
    const { family: _family, ...input } = next;
    return api.listTasks(input);
  }, [api]);
  const historyPage = useHistoryPage<'task', TaskSummary>({
    family: 'task',
    request,
    loadPage,
    isTombstoned,
    familyEpoch,
  });
  const tasks = historyPage.page?.items ?? [];
  async function openHistoryOutput(taskId: string) {
    await historyAction.run(() => api.openTaskOutputDirectory(taskId));
  }
  return (
    <section className="panel full-panel">
      <div className="panel-title-row">
        <div className="chip-row">
          {(['all', 'draft', 'completed', 'running', 'failed', 'cancelled'] as const).map((item) => (
            <button key={item} className={filter === item ? 'chip active' : 'chip'} onClick={() => setFilter(item)}>
              {statusLabel(item)}
            </button>
          ))}
        </div>
        <input className="search-input" value={query} placeholder="搜索任务" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="panel-title-row">
        <span className="subtle-copy">
          {historyPage.page ? `${historyPage.page.totalCount} 条记录` : historyPage.loading ? '正在加载' : '暂无记录'}
        </span>
        <CursorPagination
          busy={historyPage.loading}
          hasPrevious={historyPage.hasPrevious}
          hasNext={Boolean(historyPage.page?.nextCursor)}
          onPrevious={historyPage.previous}
          onReload={historyPage.reload}
          onNext={historyPage.next}
        />
      </div>
      <DataTable
        label="历史任务"
        columns={['任务', '状态', '步骤', '创建时间', '输出']}
        state={tasks.length === 0 ? (
          historyPage.loading ? <EmptyState title="正在加载历史任务" tone="loading" /> : <EmptyState title="暂无历史任务" />
        ) : null}
      >
        {tasks.map((task) => (
          <div className="table-row clickable" key={task.id} role="row" onClick={() => openTaskDetail(task.id)}>
            <span role="cell">
              <button
                className="table-row-primary-action"
                type="button"
                aria-label={`打开任务 ${task.title || task.id}`}
                onClick={(event) => { event.stopPropagation(); openTaskDetail(task.id); }}
              >
                {task.title || '未命名任务'}
              </button>
            </span>
            <span role="cell"><StatusPill status={task.status} /></span>
            <span role="cell">{taskProgressLabel(task)}</span>
            <span role="cell">{formatDate(task.createdAt)}</span>
            <span role="cell">
              <button className="mini-button" type="button" aria-label="打开输出目录" disabled={historyAction.busy || !task.outputDir} onClick={(event) => { event.stopPropagation(); if (task.outputDir) void openHistoryOutput(task.id); }}>
                <FolderOpen size={14} />
              </button>
            </span>
          </div>
        ))}
      </DataTable>
      {historyPage.error ? <div className="inline-feedback error">{historyPage.error.message}</div> : null}
      <InlineActionFeedback feedback={historyAction.feedback} />
    </section>
  );
}
