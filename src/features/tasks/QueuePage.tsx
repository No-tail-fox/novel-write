import { useEffect, useState } from 'react';
import { FolderOpen, Pause, Play, Plus, RotateCcw, X } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { sortTimelineEvents } from '../../components/EventTimeline';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { StatusBadge as StatusPill } from '../../components/StatusBadge';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { collectTaskEventPages } from '../../shared/state-reconciliation';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { SequencedTaskEvent, Task, TaskStatus } from '../../shared/types';
import { taskProgressSnapshot } from '../../shared/task-progress';
import { useAsyncAction } from '../../ui/async-action';
import { activeImageConcurrency, formatTaskOperationTime } from './task-formatters';
import { taskOperationStatusLabel } from './task-pipeline';
import '../../styles/features/task-operations.css';

export function QueuePage({
  api,
  state,
  applyState,
  openNewTask,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  openNewTask: () => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [queueFilter, setQueueFilter] = useState<'all' | 'running' | 'pending'>('all');
  const [loadedEvents, setLoadedEvents] = useState<SequencedTaskEvent[]>([]);
  const [eventRefreshTick, setEventRefreshTick] = useState(0);
  const latestTask = state.tasks[0];
  const visibleTasks = state.tasks.filter((task) => queueFilter === 'all'
    || (queueFilter === 'running' ? task.status === 'running' : ['draft', 'pending', 'paused'].includes(task.status)));
  const fallbackEvents = latestTask ? state.events.filter((event) => event.taskId === latestTask.id || event.taskId === 'live') : state.events;
  const events = loadedEvents.length ? loadedEvents : fallbackEvents;
  const queueAction = useAsyncAction();

  useEffect(() => {
    let current = true;
    if (!latestTask) {
      setLoadedEvents([]);
      return () => { current = false; };
    }
    const taskId = latestTask.id;
    void (async () => {
      try {
        const first = await api.listTaskEvents(taskId, { limit: 100 });
        const pages = await collectTaskEventPages(first, (cursor) => api.listTaskEvents(taskId, { cursor, limit: 100 }));
        if (current) setLoadedEvents(pages);
      } catch {
        if (current) setLoadedEvents([]);
      }
    })();
    return () => { current = false; };
  }, [api, eventRefreshTick, latestTask?.id]);

  async function setStatus(task: Task, status: Extract<TaskStatus, 'paused' | 'cancelled'>) {
    await queueAction.run(async () => {
      applyState(await api.updateTaskStatus(task.id, status));
    });
  }
  async function continueTask(task: Task) {
    await queueAction.run(async () => {
      applyState(await api.updateTaskStatus(task.id, 'running'));
    });
  }
  async function retryFailedTask(task: Task) {
    await queueAction.run(async () => {
      applyState(await api.retryTask(task.id));
    });
  }
  async function openQueueOutput(taskId: string) {
    await queueAction.run(() => api.openTaskOutputDirectory(taskId));
  }
  return (
    <div className="task-operations-view task-queue-view" data-task-operations="queue">
      <section className="task-queue-main">
        <div className="task-queue-filters" role="group" aria-label="任务队列筛选">
          <div className="task-queue-filter-options">
            {([['all', '全部任务'], ['running', '运行中'], ['pending', '等待处理']] as const).map(([value, label]) => (
              <button key={value} type="button" className={queueFilter === value ? 'active' : ''} onClick={() => setQueueFilter(value)}>{label}</button>
            ))}
          </div>
          <span className="task-queue-concurrency">当前图片并发 {activeImageConcurrency(state.config)}</span>
          <button className="task-queue-create" type="button" title="新建任务" aria-label="新建任务" onClick={openNewTask}><Plus size={15} /></button>
        </div>
        <div className="task-queue-table" role="table" aria-label="任务队列">
          <div className="task-queue-head" role="row"><span>任务</span><span>状态</span><span>进度</span><span>创建时间</span><span aria-label="操作" /></div>
          {visibleTasks.length === 0 ? <EmptyState title={state.tasks.length ? '当前筛选暂无任务' : '暂无任务'} /> : null}
          {visibleTasks.map((task) => {
            const progress = taskProgressSnapshot(task);
            const displayProgress = task.status === 'running' ? progress.position : progress.completed;
            const percent = Math.round((displayProgress / Math.max(1, progress.total)) * 100);
            return (
              <article className="task-queue-row" key={task.id} role="row" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
                <div role="cell"><strong>{task.title || '未命名任务'}</strong><span>{task.mode === 'ai' ? 'AI 创作' : '粘贴文案'} · {task.ratio}</span>{task.status === 'failed' || task.status === 'cancelled' ? <ErrorSummaryButton fullMessage={task.errorMessage} title={task.title || '任务错误'} /> : null}</div>
                <span role="cell"><StatusPill status={task.status} label={taskOperationStatusLabel(task)} /></span>
                <div className="task-queue-progress" role="cell"><span role="progressbar" aria-label={`${task.title || '未命名任务'}进度`} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={displayProgress}><i style={{ width: `${percent}%` }} /></span><small>{displayProgress} / {progress.total}</small></div>
                <time role="cell">{formatTaskOperationTime(task.createdAt)}</time>
                <div className="row-actions" role="cell" onClick={(event) => event.stopPropagation()}>
                  {task.status === 'running' ? <button className="icon-button" title="暂停任务" aria-label="暂停任务" disabled={queueAction.busy || isBrowserPreview} onClick={() => setStatus(task, 'paused')}><Pause size={14} /></button> : null}
                  {task.status === 'running' || task.status === 'pending' ? <button className="icon-button" title="取消任务" aria-label="取消任务" disabled={queueAction.busy || isBrowserPreview} onClick={() => setStatus(task, 'cancelled')}><X size={14} /></button> : null}
                  {task.status === 'paused' ? <button className="icon-button" title="继续任务" aria-label="继续任务" disabled={queueAction.busy || isBrowserPreview} onClick={() => continueTask(task)}><Play size={14} /></button> : null}
                  {task.status === 'paused' || task.status === 'failed' || task.status === 'cancelled' ? <button className="icon-button" title="重试任务" aria-label="重试任务" disabled={queueAction.busy || isBrowserPreview} onClick={() => retryFailedTask(task)}><RotateCcw size={14} /></button> : null}
                  {task.status === 'completed' && task.outputDir ? <button className="icon-button" title="打开任务输出目录" aria-label="打开任务输出目录" disabled={queueAction.busy} onClick={() => openQueueOutput(task.id)}><FolderOpen size={14} /></button> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <aside className="task-event-rail">
        <div className="task-event-rail-head">
          <div><h2>任务事件</h2><span>{latestTask ? `${latestTask.title || '未命名任务'} · 最近 ${Math.min(24, events.length)} 条` : '等待任务'}</span></div>
          <button className="icon-button task-event-refresh" type="button" title="刷新任务事件" aria-label="刷新任务事件" disabled={queueAction.busy || !latestTask} onClick={() => setEventRefreshTick((tick) => tick + 1)}>
            <RotateCcw size={14} />
          </button>
        </div>
        <InlineActionFeedback feedback={queueAction.feedback} />
        {events.length === 0 ? <EmptyState title="暂无事件" /> : (
          <div className="task-event-list">
            {sortTimelineEvents(events.slice(-24)).reverse().map((event, index) => {
              const [headline, ...detailParts] = event.detail.split(' · ');
              return (
                <div className="task-event-item" key={`${event.seq ?? index}-${event.ts}`}>
                  <time className="task-event-time">{formatTaskEventTime(event.ts)}</time>
                  <div>
                    {event.type === 'step_error' ? <ErrorSummaryButton fullMessage={event.detail} title={`步骤 ${event.step ?? '-'} 错误`} compact /> : <strong>{headline}</strong>}
                    <span>{detailParts.join(' · ') || event.agent || `Step ${event.step ?? '-'}`}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}

function formatTaskEventTime(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
