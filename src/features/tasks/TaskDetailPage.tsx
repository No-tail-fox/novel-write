import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, LayoutTemplate, Loader2, Pause, Play, RotateCcw, Settings2, XCircle } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { StatusBadge as StatusPill } from '../../components/StatusBadge';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { taskProgressSnapshot, taskProgressStages } from '../../shared/task-progress';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { DraftTemplate, Task, TaskArtifactSnapshot } from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { ArtifactPreviewContent, type TaskArtifactTab } from './TaskArtifactPreview';
import { formatDate, formatDuration } from './task-formatters';
import { pipelineStepStatus, snapshotStepStatus, statusLabelForStep, taskOperationStageTitle, taskOperationStatusLabel } from './task-pipeline';
import { resolveTaskTemplateSelection } from './task-template-selection';
import '../../styles/features/task-operations.css';

function TaskTemplateSelect({
  templates,
  value,
  disabled,
  onChange,
}: {
  templates: DraftTemplate[];
  value: string;
  disabled: boolean;
  onChange: (templateId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selectedIndex = templates.findIndex((template) => template.id === value);
  const defaultActiveIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedTemplate = selectedIndex >= 0 ? templates[selectedIndex] : null;

  useEffect(() => {
    if (!open) return undefined;
    setActiveIndex(defaultActiveIndex);
    const frame = window.requestAnimationFrame(() => menuRef.current?.focus());
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [defaultActiveIndex, open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function chooseTemplate(index: number) {
    const template = templates[index];
    if (!template) return;
    onChange(template.id);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveActive(delta: number) {
    if (templates.length === 0) return;
    setActiveIndex((current) => (current + delta + templates.length) % templates.length);
  }

  return (
    <div ref={rootRef} className={open ? 'task-template-select open' : 'task-template-select'}>
      <button
        ref={triggerRef}
        type="button"
        className="task-template-select-trigger"
        aria-label="选择任务草稿模板"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(event.key === 'ArrowDown'
              ? defaultActiveIndex
              : selectedIndex >= 0 ? selectedIndex : Math.max(0, templates.length - 1));
            setOpen(true);
          }
        }}
      >
        <span>{selectedTemplate
          ? `${selectedTemplate.name} · ${selectedTemplate.canvas.ratio}`
          : value ? '已应用模板不可用，请重新选择' : '选择模板'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={listboxId}
          className="task-template-select-menu"
          role="listbox"
          tabIndex={-1}
          aria-label="草稿模板"
          aria-activedescendant={`${listboxId}-option-${activeIndex}`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveActive(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, templates.length - 1));
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              chooseTemplate(activeIndex);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === 'Tab') {
              setOpen(false);
            }
          }}
        >
          {templates.map((template, index) => (
            <div
              id={`${listboxId}-option-${index}`}
              key={template.id}
              className={index === activeIndex ? 'task-template-select-option active' : 'task-template-select-option'}
              role="option"
              aria-selected={template.id === value}
              data-template-id={template.id}
              onPointerMove={() => setActiveIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => chooseTemplate(index)}
            >
              <span>{template.name}</span>
              <small>{template.canvas.ratio}</small>
              {template.id === value ? <Check size={14} aria-hidden="true" /> : <i aria-hidden="true" />}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TaskDetailPage({
  api,
  state,
  task,
  applyState,
  close,
  openTemplateManager,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  task: Task | null;
  applyState: ApplyMutationResult;
  close: () => void;
  openTemplateManager: () => void;
  isBrowserPreview: boolean;
}) {
  const [tab, setTab] = useState<TaskArtifactTab>('preview');
  const [liveNow, setLiveNow] = useState(Date.now());
  const [artifactSnapshot, setArtifactSnapshot] = useState<TaskArtifactSnapshot | null>(null);
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0);
  const [templateSelectionId, setTemplateSelectionId] = useState(task?.templateId ?? '');
  const [resolvedDraftTemplate, setResolvedDraftTemplate] = useState<{ id: string; template: DraftTemplate } | null>(null);
  const taskDetailAction = useAsyncAction();
  const taskTemplateAction = useAsyncAction();
  const events = task ? state.events.filter((event) => event.taskId === task.id) : [];
  const latestEvent = [...events].reverse()[0] ?? null;
  const snapshotImageCount = artifactSnapshot?.assets.images.length ?? 0;
  const templateSelection = resolveTaskTemplateSelection(
    state.draftTemplates,
    task?.templateId ?? '',
    templateSelectionId,
  );
  const selectedDraftTemplateId = templateSelection.candidateTemplateId;
  const previewDraftTemplateId = templateSelection.candidateTemplate?.id
    ?? templateSelection.appliedTemplate?.id
    ?? state.draftTemplates[0]?.id
    ?? '';
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
  useEffect(() => {
    setTemplateSelectionId(task?.templateId ?? '');
  }, [task?.id, task?.templateId]);
  useEffect(() => {
    let cancelled = false;
    const templateId = previewDraftTemplateId;
    if (!templateId) {
      setResolvedDraftTemplate(null);
      return undefined;
    }
    setResolvedDraftTemplate((current) => current?.id === templateId ? current : null);
    api.getDraftTemplateDetail(templateId)
      .then((template) => {
        if (!cancelled && template) setResolvedDraftTemplate({ id: templateId, template });
      })
      .catch(() => {
        if (!cancelled) setResolvedDraftTemplate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, previewDraftTemplateId]);
  if (!task) {
    return (
      <section className="panel full-panel">
        <EmptyState title="暂无任务详情" />
      </section>
    );
  }

  const activeTask = task;
  const activeDraftTemplate = resolvedDraftTemplate?.id === previewDraftTemplateId
    ? resolvedDraftTemplate.template
    : state.draftTemplates.find((template) => template.id === previewDraftTemplateId) ?? null;
  const draftTemplateChanged = templateSelection.canApply;
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

  async function applyDraftTemplate() {
    if (!draftTemplateChanged) return;
    const previousTemplateId = activeTask.templateId;
    let templateSaved = false;
    const rerunDraft = activeTask.status === 'completed' && Boolean(artifactSnapshot?.draft) && !isBrowserPreview;
    const result = await taskTemplateAction.run(async () => {
      applyState(await api.updateTaskTemplate(activeTask.id, selectedDraftTemplateId));
      templateSaved = true;
      if (rerunDraft) {
        applyState(await api.rerunTaskStep(activeTask.id, 6, 'regenerate'));
        setArtifactRefreshTick((tick) => tick + 1);
      }
    }, {
      successMessage: rerunDraft ? '模板已应用，正在重新导出剪映草稿' : '模板已应用，预览与后续草稿已更新',
    });
    if (!result.ok && !templateSaved) setTemplateSelectionId(previousTemplateId);
  }

  return (
    <div className="task-detail-shell" data-task-operations="detail" data-task-id={activeTask.id}>
      <header className="task-detail-bar">
        <div className="task-detail-identity">
          <button className="task-detail-back" onClick={close}>← 返回历史任务</button>
          <div>
            <h2>{activeTask.title || '未命名任务'}</h2>
            <span>{activeTask.mode === 'ai' ? 'AI 创作' : '粘贴文案'} · {activeTask.ratio} · 创建于 {formatDate(activeTask.createdAt)}</span>
          </div>
          <StatusPill status={activeTask.status} label={taskOperationStatusLabel(activeTask)} />
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
          <div className="artifact-tab-list">
            <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>结果</button>
            <button className={tab === 'storyboard' ? 'active' : ''} onClick={() => setTab('storyboard')}>分镜</button>
            <button className={tab === 'images' ? 'active' : ''} onClick={() => setTab('images')}>图片</button>
            <button className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}>配音</button>
            <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>事件</button>
          </div>
          <div
            className="task-template-switcher"
            data-applied-template-id={templateSelection.appliedTemplateId}
            data-candidate-template-id={selectedDraftTemplateId}
            data-template-state={draftTemplateChanged ? 'pending' : templateSelection.appliedTemplateMissing ? 'missing' : 'applied'}
          >
            <div className="task-template-field">
              <LayoutTemplate size={14} />
              <span>草稿模板</span>
              <TaskTemplateSelect
                templates={state.draftTemplates}
                value={selectedDraftTemplateId}
                disabled={taskTemplateAction.busy}
                onChange={(templateId) => {
                  taskTemplateAction.clearFeedback();
                  setTemplateSelectionId(templateId);
                }}
              />
            </div>
            <button
              type="button"
              className={draftTemplateChanged ? 'task-template-apply active' : 'task-template-apply'}
              disabled={!draftTemplateChanged || taskTemplateAction.busy}
              onClick={applyDraftTemplate}
            >
              {taskTemplateAction.busy ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
              {taskTemplateAction.busy
                ? '应用中'
                : draftTemplateChanged
                  ? '应用模板'
                  : templateSelection.appliedTemplateMissing ? '请选择模板' : '已应用'}
            </button>
            <button className="icon-button" type="button" title="管理草稿模板" aria-label="管理草稿模板" disabled={taskTemplateAction.busy} onClick={openTemplateManager}><Settings2 size={14} /></button>
          </div>
        </div>
        <InlineActionFeedback feedback={taskTemplateAction.feedback} />
        {activeDraftTemplate
          ? <ArtifactPreviewContent api={api} task={activeTask} config={state.config} draftTemplate={activeDraftTemplate} applyState={applyState} tab={tab} snapshot={artifactSnapshot} events={events} latestEvent={latestEvent} currentAgent={currentMeta?.agent ?? 'Runner'} isBrowserPreview={isBrowserPreview} />
          : <EmptyState title="暂无可用草稿模板" />}
      </section>
    </div>
  );
}
