import { useEffect, useState } from 'react';
import { Copy, FileJson, Image as ImageIcon, Loader2, Mic2, XCircle } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { taskProgressSnapshot, taskProgressStages } from '../../shared/task-progress';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { Task, TaskArtifactSnapshot } from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { ArtifactPreviewContent } from './TaskArtifactPreview';
import { formatDuration } from './task-formatters';
import { pipelineStepStatus, snapshotStepStatus, statusLabelForStep } from './task-pipeline';

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
  const [tab, setTab] = useState<'preview' | 'storyboard' | 'audio'>('preview');
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
  const completedSteps = progress.completed;

  async function cancelTask() {
    await taskDetailAction.run(async () => {
      applyState(await api.updateTaskStatus(activeTask.id, 'cancelled'));
    });
  }

  return (
    <div className="task-detail-shell">
      <div className="task-detail-bar">
        <div className="breadcrumb">
          <button onClick={close}>历史任务</button>
          <span>/</span>
          <strong>任务详情</strong>
        </div>
        <button className="mini-button" onClick={close}>
          <XCircle size={14} />
          关闭
        </button>
      </div>

      <aside className="task-detail-sidebar">
        <section className="task-summary-card">
          <div className="task-id-line">
            <span>{activeTask.id}</span>
            <button className="icon-button" title="复制任务 ID" onClick={() => navigator.clipboard?.writeText(activeTask.id)}>
              <Copy size={14} />
            </button>
          </div>
          <div className="task-metrics">
            <div><strong>{formatDuration(activeTask.createdAt, activeTask.completedAt, liveNow)}</strong><span>总耗时</span></div>
            <div><strong>{completedSteps}<small>/{progress.total}</small></strong><span>当前步骤</span></div>
            <div><strong>{events.length || '-'}</strong><span>事件数</span></div>
          </div>
          <button className="cancel-task-button" disabled={activeTask.status === 'completed' || activeTask.status === 'cancelled'} onClick={cancelTask}>
            <XCircle size={14} />
            取消任务
          </button>
        </section>

        <section className="pipeline-card">
          <div className="pipeline-title">
            <strong>{progress.total} 步流水线</strong>
            <span className="auto-badge">全自动</span>
            <small>· 全部 {progress.total} 步执行</small>
          </div>
          <div className="pipeline-list">
            {progressStages.map((step) => {
              const status = pipelineStepStatus(activeTask, step.index);
              const stepEvent = [...events].reverse().find((event) => event.step === step.index);
              const stepLabel = stepEvent?.detail || statusLabelForStep(status);
              return (
                <div className={`pipeline-step ${status}`} key={step.index}>
                  <div className="pipeline-node">{status === 'running' ? <Loader2 className="spin" size={14} /> : step.index + 1}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.hint}</span>
                    {status === 'running' ? <small>进行中</small> : stepEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={stepEvent.detail} title={step.title} compact /> : <small>{stepLabel}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="task-detail-main" data-media-canvas="task-artifact">
        <InlineActionFeedback feedback={taskDetailAction.feedback} />
        <div className="artifact-tabs">
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}><FileJson size={14} />产物预览</button>
          <button className={tab === 'storyboard' ? 'active' : ''} onClick={() => setTab('storyboard')}><ImageIcon size={14} />分镜画廊</button>
          <button className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}><Mic2 size={14} />配音试听</button>
        </div>
        <ArtifactPreviewContent api={api} task={activeTask} config={state.config} applyState={applyState} tab={tab} snapshot={artifactSnapshot} latestEvent={latestEvent} currentAgent={currentMeta?.agent ?? 'Runner'} isBrowserPreview={isBrowserPreview} />
      </section>
    </div>
  );
}
