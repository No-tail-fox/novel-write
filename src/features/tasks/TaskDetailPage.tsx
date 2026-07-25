import { useEffect, useState } from 'react';
import { Copy, Loader2, Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { StatusBadge as StatusPill } from '../../components/StatusBadge';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { taskProgressSnapshot, taskProgressStages } from '../../shared/task-progress';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { Task, TaskArtifactSnapshot } from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { ArtifactPreviewContent, type TaskArtifactTab } from './TaskArtifactPreview';
import { formatDate, formatDuration } from './task-formatters';
import { pipelineStepStatus, snapshotStepStatus, statusLabelForStep, taskOperationStageTitle, taskOperationStatusLabel } from './task-pipeline';
import '../../styles/features/task-operations.css';

export function TaskDetailPage({
  api,
  state,
  task,
  applyState,
  close,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  task: Task | null;
  applyState: ApplyMutationResult;
  close: () => void;
  isBrowserPreview: boolean;
}) {
  const [tab, setTab] = useState<TaskArtifactTab>('preview');
  const [liveNow, setLiveNow] = useState(Date.now());
  const [artifactSnapshot, setArtifactSnapshot] = useState<TaskArtifactSnapshot | null>(null);
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0);
  const taskDetailAction = useAsyncAction();
  const events = task ? state.events.filter((event) => event.taskId === task.id) : [];
  const latestEvent = [...events].reverse()[0] ?? null;
  const snapshotImageCount = artifactSnapshot?.assets.images.length ?? 0;
  const artifactRefreshKey = [
    task?.id ?? '',
    task?.artifactStatePath ?? '',
    task?.outputDir ?? '',
    task?.currentStep ?? '',
    task?.status ?? '',
    latestEvent?.id ?? latestEvent?.seq ?? latestEvent?.ts ?? '',
    snapshotImageCount,
    snapshotStepStatus(artifactSnapshot, 4),
    artifactRefreshTick,
  ].join('|');
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setArtifactRefreshTick((tick) => tick + 1), 1500);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    let cancelled = false;
    if (!task) {
      setArtifactSnapshot(null);
      return undefined;
    }
    const artifactTask = task;
    api.getTaskArtifacts(artifactTask.id)
      .then((snapshot) => {
        if (!cancelled) setArtifactSnapshot(snapshot);
      })
      .catch((error) => {
        if (!cancelled) {
          const normalized = taskDetailAction.reportError(error);
          setArtifactSnapshot({
            available: false,
            message: normalized.message,
            taskId: artifactTask.id,
            statePath: artifactTask.artifactStatePath,
            outputDir: artifactTask.outputDir,
            updatedAt: null,
            steps: {},
            artifact: {},
            assets: { cover: [], images: [], imageErrors: [], narration: [] },
            draft: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, artifactRefreshKey, task, taskDetailAction.reportError]);
  if (!task) {
    return (
      <section className="panel full-panel">
        <EmptyState title="暂无任务详情" />
      </section>
    );
  }

  const activeTask = task;
  const progress = taskProgressSnapshot(activeTask);
  const progressStages = taskProgressStages(activeTask);
  const currentStep = Math.min(Math.max(progress.position - 1, 0), progress.total - 1);
  const currentMeta = progressStages[currentStep] ?? progressStages[0];
  async function setTaskStatus(status: 'paused' | 'running' | 'cancelled') {
    await taskDetailAction.run(async () => {
      applyState(await api.updateTaskStatus(activeTask.id, status));
    });
  }

  async function retryTask() {
    await taskDetailAction.run(async () => {
      applyState(await api.retryTask(activeTask.id));
    });
  }

  return (
    <div className="task-detail-shell" data-task-operations="detail">
      <header className="task-detail-bar">
        <div className="task-detail-identity">
          <button className="task-detail-back" onClick={close}>← 返回历史任务</button>
          <div>
            <h2>{activeTask.title || '未命名任务'}</h2>
            <span>{activeTask.mode === 'ai' ? 'AI 创作' : '粘贴文案'} · {activeTask.ratio} · 创建于 {formatDate(activeTask.createdAt)}</span>
          </div>
          <StatusPill status={activeTask.status} label={`${taskOperationStatusLabel(activeTask)} · ${progress.position} / ${progress.total}`} />
        </div>
        <div className="task-detail-actions">
          <div className="task-detail-metrics">
            <span><strong>{formatDuration(activeTask.createdAt, activeTask.completedAt, liveNow)}</strong> 总耗时</span>
            <span><strong>{progress.position}/{progress.total}</strong> 当前步骤</span>
            <span><strong>{events.length || '-'}</strong> 事件</span>
          </div>
          <button className="icon-button" title="复制任务 ID" aria-label="复制任务 ID" onClick={() => navigator.clipboard?.writeText(activeTask.id)}><Copy size={14} /></button>
          {activeTask.status === 'running' ? <button className="task-detail-run-control" disabled={taskDetailAction.busy || isBrowserPreview} onClick={() => setTaskStatus('paused')}><Pause size={14} />暂停任务</button> : null}
          {activeTask.status === 'paused' ? <button className="task-detail-run-control" disabled={taskDetailAction.busy || isBrowserPreview} onClick={() => setTaskStatus('running')}><Play size={14} />继续任务</button> : null}
          {activeTask.status === 'running' || activeTask.status === 'paused' || activeTask.status === 'failed' || activeTask.status === 'cancelled' ? <button className="task-detail-run-control accent" disabled={taskDetailAction.busy || isBrowserPreview} onClick={retryTask}><RotateCcw size={14} />重试当前步骤</button> : null}
          <button className="cancel-task-button" disabled={taskDetailAction.busy || isBrowserPreview || activeTask.status === 'completed' || activeTask.status === 'cancelled'} onClick={() => setTaskStatus('cancelled')}>
            <XCircle size={14} />
            取消任务
          </button>
        </div>
      </header>

      <div className="task-stage-track" aria-label={`${progress.total} 步流水线`}>
        {progressStages.map((step) => {
          const status = pipelineStepStatus(activeTask, step.index);
          const stepEvent = [...events].reverse().find((event) => event.step === step.index);
          const sceneCount = artifactSnapshot?.artifact.scenes?.length ?? snapshotImageCount;
          const stepLabel = step.index === 4 && status === 'running' && sceneCount
            ? `${snapshotImageCount} / ${sceneCount}`
            : status === 'completed'
              ? '完成'
              : statusLabelForStep(status).replace('等待中', '等待');
          return (
            <div className={`pipeline-step ${status}`} key={step.index}>
              <div className="pipeline-node">{status === 'running' ? <Loader2 className="spin" size={14} /> : step.index}</div>
              <div><strong>{taskOperationStageTitle(step.title)}</strong>{stepEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={stepEvent.detail} title={step.title} compact /> : <small>{stepLabel}</small>}</div>
            </div>
          );
        })}
      </div>

      <section className="task-detail-main" data-media-owner="task-artifact">
        <InlineActionFeedback feedback={taskDetailAction.feedback} />
        <div className="artifact-tabs">
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>结果</button>
          <button className={tab === 'storyboard' ? 'active' : ''} onClick={() => setTab('storyboard')}>分镜</button>
          <button className={tab === 'images' ? 'active' : ''} onClick={() => setTab('images')}>图片</button>
          <button className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}>配音</button>
          <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>事件</button>
        </div>
        <ArtifactPreviewContent api={api} task={activeTask} config={state.config} applyState={applyState} tab={tab} snapshot={artifactSnapshot} events={events} latestEvent={latestEvent} currentAgent={currentMeta?.agent ?? 'Runner'} isBrowserPreview={isBrowserPreview} />
      </section>
    </div>
  );
}
