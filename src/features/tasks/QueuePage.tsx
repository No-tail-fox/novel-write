import { FolderOpen, Plus } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { EventTimeline } from '../../components/EventTimeline';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { StatusBadge as StatusPill } from '../../components/StatusBadge';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { Task, TaskStatus } from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { formatDate } from './task-formatters';

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
  const latestTask = state.tasks[0];
  const events = latestTask ? state.events.filter((event) => event.taskId === latestTask.id || event.taskId === 'live') : state.events;
  const queueAction = useAsyncAction();
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
    <div className="queue-layout">
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>任务队列</h2>
            <span>{state.tasks.length} 个草稿 · 选中一批即可自动串行执行 · 单任务内 3 路并发生图</span>
          </div>
          <button className="primary-action slim" onClick={openNewTask}>
            <Plus size={15} />
            新建任务
          </button>
        </div>
        <div className="task-list">
          {state.tasks.length === 0 ? <EmptyState title="暂无任务" /> : null}
          {state.tasks.map((task) => (
            <article className="task-row clickable" key={task.id} role="button" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
              <div>
                <strong>{task.title || '未命名任务'}</strong>
                <span>{task.mode === 'ai' ? 'AI 创作' : '粘贴文案'} · {task.ratio} · {formatDate(task.createdAt)}</span>
                <ErrorSummaryButton fullMessage={task.errorMessage} title={task.title || '任务错误'} />
              </div>
              <StatusPill status={task.status} />
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                {task.status === 'running' ? <button className="mini-button" disabled={queueAction.busy || isBrowserPreview} onClick={() => setStatus(task, 'paused')}>暂停</button> : null}
                {task.status === 'running' || task.status === 'pending' ? <button className="mini-button" disabled={queueAction.busy || isBrowserPreview} onClick={() => setStatus(task, 'cancelled')}>取消</button> : null}
                {task.status === 'paused' ? <button className="mini-button" disabled={queueAction.busy || isBrowserPreview} onClick={() => continueTask(task)}>继续</button> : null}
                {task.status === 'failed' || task.status === 'cancelled' ? <button className="mini-button" disabled={queueAction.busy || isBrowserPreview} onClick={() => retryFailedTask(task)}>重试</button> : null}
                <button className="mini-button" title="打开任务输出目录" aria-label="打开任务输出目录" disabled={queueAction.busy || task.status !== 'completed' || !task.outputDir} onClick={() => task.outputDir && openQueueOutput(task.id)}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>步骤事件</h2>
          {latestTask?.status === 'completed' && latestTask.outputDir ? (
            <button className="ghost-action" disabled={queueAction.busy} onClick={() => openQueueOutput(latestTask.id)}>
              <FolderOpen size={15} />
              打开剪映草稿
            </button>
          ) : null}
        </div>
        <InlineActionFeedback feedback={queueAction.feedback} />
        <EventTimeline events={events.slice(-24)} />
      </section>
    </div>
  );
}
