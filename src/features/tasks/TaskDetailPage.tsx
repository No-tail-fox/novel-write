import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Clapperboard, Copy, FolderOpen, LayoutTemplate, Loader2, Music2, PackageCheck, Pause, Play, RotateCcw, Settings2, SlidersHorizontal, XCircle } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { StatusBadge as StatusPill } from '../../components/StatusBadge';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { taskProgressSnapshot, taskProgressStages } from '../../shared/task-progress';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { BgmItem, DraftTemplate, Task, TaskArtifactSnapshot } from '../../shared/types';
import { Button, IconButton, SelectField, Tabs } from '../../ui';
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
  const missing = !templates.some((template) => template.id === value);
  return (
    <SelectField
      label="草稿模板"
      aria-label="选择任务草稿模板"
      fieldClassName="task-template-select"
      disabled={disabled}
      value={value}
      options={[
        ...(missing ? [{ value, label: value ? '已应用模板不可用，请重新选择' : '选择模板', disabled: true }] : []),
        ...templates.map((template) => ({ value: template.id, label: `${template.name} · ${template.canvas.ratio}` })),
      ]}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function TaskDraftDelivery({
  task,
  snapshot,
  templates,
  bgmLibrary,
  templateSelection,
  selectedTemplateId,
  selectedBgmId,
  settingsOpen,
  settingsDisabled,
  templateBusy,
  bgmBusy,
  draftBusy,
  isBrowserPreview,
  onSettingsOpenChange,
  onTemplateChange,
  onBgmChange,
  onApplyTemplate,
  onApplyBgm,
  onManageTemplates,
  onRepack,
  onOpenDirectory,
  onLaunchJianying,
}: {
  task: Task;
  snapshot: TaskArtifactSnapshot | null;
  templates: DraftTemplate[];
  bgmLibrary: BgmItem[];
  templateSelection: ReturnType<typeof resolveTaskTemplateSelection>;
  selectedTemplateId: string;
  selectedBgmId: string;
  settingsOpen: boolean;
  settingsDisabled: boolean;
  templateBusy: boolean;
  bgmBusy: boolean;
  draftBusy: boolean;
  isBrowserPreview: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  onTemplateChange: (templateId: string) => void;
  onBgmChange: (bgmId: string) => void;
  onApplyTemplate: () => void;
  onApplyBgm: () => void;
  onManageTemplates: () => void;
  onRepack: () => void;
  onOpenDirectory: () => void;
  onLaunchJianying: () => void;
}) {
  const templateFieldRef = useRef<HTMLDivElement>(null);
  const bgmFieldRef = useRef<HTMLDivElement>(null);
  const draftStepStatus = snapshotStepStatus(snapshot, 6);
  const hasDraft = Boolean(snapshot?.draft);
  const packaging = draftStepStatus === 'running' || (task.status === 'running' && task.currentStep === 6);
  const settingsLocked = packaging;
  const pendingRepack = hasDraft && draftStepStatus === 'pending';
  const templateChanged = templateSelection.canApply;
  const bgmChanged = selectedBgmId !== task.bgmId;
  const unsavedSettings = templateChanged || bgmChanged;
  const appliedTemplate = templates.find((template) => template.id === task.templateId);
  const appliedBgm = bgmLibrary.find((item) => item.id === task.bgmId);
  const status = packaging
    ? { className: 'running', label: '正在打包', detail: '剪映草稿正在重新生成' }
    : unsavedSettings
      ? { className: 'editing', label: '调整未保存', detail: '保存模板或音乐后再重新打包' }
      : pendingRepack
        ? { className: 'pending', label: '待重新打包', detail: '已保存调整，旧草稿仍可打开' }
        : hasDraft
          ? { className: 'ready', label: '剪映草稿已生成', detail: '可继续调整或直接打开剪映' }
          : { className: 'empty', label: '草稿尚未生成', detail: '完成普通任务流水线后可在此交付' };
  const repackDisabled = settingsDisabled || draftBusy || isBrowserPreview || !task.artifactStatePath || unsavedSettings;

  function revealSettings(target: 'all' | 'template' | 'bgm') {
    onSettingsOpenChange(true);
    window.requestAnimationFrame(() => {
      if (target === 'template') templateFieldRef.current?.querySelector('select')?.focus();
      if (target === 'bgm') bgmFieldRef.current?.querySelector('select')?.focus();
    });
  }

  return (
    <section className="task-draft-delivery" data-draft-status={status.className}>
      <div className="task-draft-adjustments" hidden={!settingsOpen}>
        <div
          ref={templateFieldRef}
          className="task-template-switcher"
          data-template-location="delivery"
          data-applied-template-id={templateSelection.appliedTemplateId}
          data-candidate-template-id={selectedTemplateId}
          data-template-state={templateChanged ? 'pending' : templateSelection.appliedTemplateMissing ? 'missing' : 'applied'}
        >
            <TaskTemplateSelect
              templates={templates}
              value={selectedTemplateId}
              disabled={settingsLocked || templateBusy}
              onChange={onTemplateChange}
            />
          <Button
            type="button"
            className="task-template-apply"
            variant={templateChanged ? 'primary' : 'secondary'}
            icon={templateBusy ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
            disabled={!templateChanged || settingsLocked || templateBusy}
            onClick={onApplyTemplate}
          >
            {templateBusy ? '应用中' : templateChanged ? '应用模板' : templateSelection.appliedTemplateMissing ? '请选择模板' : '已应用'}
          </Button>
          <IconButton label="管理草稿模板" icon={<Settings2 size={14} />} disabled={templateBusy} onClick={onManageTemplates} />
        </div>
        <div ref={bgmFieldRef} className="task-bgm-switcher">
            <SelectField
              label="背景音乐"
              fieldClassName="task-bgm-select"
              aria-label="选择任务背景音乐"
              disabled={settingsLocked || bgmBusy}
              value={selectedBgmId}
              onChange={(event) => onBgmChange(event.target.value)}
              options={[{ value: '', label: '不使用背景音乐' }, ...bgmLibrary.map((item) => ({ value: item.id, label: item.title }))]}
            />
          <Button type="button" className="task-bgm-apply" variant={bgmChanged ? 'primary' : 'secondary'} icon={bgmBusy ? <Loader2 className="spin" size={14} /> : <Check size={14} />} disabled={!bgmChanged || settingsLocked || bgmBusy} onClick={onApplyBgm}>
            {bgmBusy ? '保存中' : bgmChanged ? '应用音乐' : '已应用'}
          </Button>
        </div>
      </div>

      <div className="task-draft-delivery-bar">
        <div className={`task-draft-status ${status.className}`}>
          <span>{status.className === 'ready' ? <CheckCircle2 size={18} /> : packaging ? <Loader2 className="spin" size={18} /> : <Clapperboard size={18} />}</span>
          <div><strong>{status.label}</strong><small>{status.detail}</small></div>
        </div>
        <div className="task-draft-current-settings">
          <span><LayoutTemplate size={13} />{appliedTemplate?.name ?? '模板不可用'}</span>
          <span><Music2 size={13} />{appliedBgm?.title ?? '无背景音乐'}</span>
        </div>
        <div className="task-draft-commands">
          <Button type="button" aria-expanded={settingsOpen} icon={<SlidersHorizontal size={14} />} onClick={() => onSettingsOpenChange(!settingsOpen)}>调整</Button>
          <Button type="button" icon={<LayoutTemplate size={14} />} onClick={() => revealSettings('template')}>模板</Button>
          <Button type="button" icon={<Music2 size={14} />} onClick={() => revealSettings('bgm')}>音乐</Button>
          <Button type="button" icon={<PackageCheck size={14} />} disabled={repackDisabled} title={unsavedSettings ? '请先应用模板或音乐调整' : '仅重新执行剪映草稿导出'} onClick={onRepack}>重新打包</Button>
          <Button type="button" icon={<FolderOpen size={14} />} disabled={!hasDraft || draftBusy || isBrowserPreview} onClick={onOpenDirectory}>草稿目录</Button>
          <Button type="button" variant="primary" icon={<Clapperboard size={14} />} disabled={!hasDraft || draftBusy || isBrowserPreview} onClick={onLaunchJianying}>打开剪映</Button>
        </div>
      </div>
    </section>
  );
}

export function TaskDetailPage({
  api,
  state,
  task,
  applyState,
  openTemplateManager,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  task: Task | null;
  applyState: ApplyMutationResult;
  openTemplateManager: () => void;
  isBrowserPreview: boolean;
}) {
  const [tab, setTab] = useState<TaskArtifactTab>('preview');
  const [liveNow, setLiveNow] = useState(Date.now());
  const [artifactSnapshot, setArtifactSnapshot] = useState<TaskArtifactSnapshot | null>(null);
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0);
  const [templateSelectionId, setTemplateSelectionId] = useState(task?.templateId ?? '');
  const [bgmSelectionId, setBgmSelectionId] = useState(task?.bgmId ?? '');
  const [draftSettingsOpen, setDraftSettingsOpen] = useState(true);
  const [resolvedDraftTemplate, setResolvedDraftTemplate] = useState<{ id: string; template: DraftTemplate } | null>(null);
  const taskDetailMainRef = useRef<HTMLElement>(null);
  const pendingSnapshotScrollTopRef = useRef<number | null>(null);
  const taskDetailAction = useAsyncAction();
  const taskTemplateAction = useAsyncAction();
  const taskBgmAction = useAsyncAction();
  const taskDraftAction = useAsyncAction();
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
        if (!cancelled) {
          pendingSnapshotScrollTopRef.current = tab === 'images' ? taskDetailMainRef.current?.scrollTop ?? null : null;
          setArtifactSnapshot(snapshot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const normalized = taskDetailAction.reportError(error);
          pendingSnapshotScrollTopRef.current = tab === 'images' ? taskDetailMainRef.current?.scrollTop ?? null : null;
          setArtifactSnapshot({
            available: false,
            message: normalized.message,
            taskId: artifactTask.id,
            statePath: artifactTask.artifactStatePath,
            outputDir: artifactTask.outputDir,
            updatedAt: null,
            steps: {},
            artifact: {},
            assets: { cover: [], images: [], videos: [], imageErrors: [], narration: [] },
            draft: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, artifactRefreshKey, tab, task, taskDetailAction.reportError]);
  useLayoutEffect(() => {
    const pendingScrollTop = pendingSnapshotScrollTopRef.current;
    const container = taskDetailMainRef.current;
    if (pendingScrollTop === null || !container) return;
    container.scrollTop = Math.min(pendingScrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
    pendingSnapshotScrollTopRef.current = null;
  }, [artifactSnapshot]);
  useEffect(() => {
    setTemplateSelectionId(task?.templateId ?? '');
  }, [task?.id, task?.templateId]);
  useEffect(() => {
    setBgmSelectionId(task?.bgmId ?? '');
  }, [task?.bgmId, task?.id]);
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
  const draftTemplateLocked = snapshotStepStatus(artifactSnapshot, 6) === 'running'
    || (activeTask.status === 'running' && activeTask.currentStep === 6);
  const draftBgmChanged = bgmSelectionId !== activeTask.bgmId;
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
    const result = await taskTemplateAction.run(async () => {
      applyState(await api.updateTaskTemplate(activeTask.id, selectedDraftTemplateId));
      templateSaved = true;
      setArtifactRefreshTick((tick) => tick + 1);
    }, {
      successMessage: '模板已保存，剪映草稿待重新打包',
    });
    if (!result.ok && !templateSaved) setTemplateSelectionId(previousTemplateId);
  }

  async function applyDraftBgm() {
    if (!draftBgmChanged) return;
    const previousBgmId = activeTask.bgmId;
    let bgmSaved = false;
    const result = await taskBgmAction.run(async () => {
      applyState(await api.updateTaskBgm(activeTask.id, bgmSelectionId));
      bgmSaved = true;
      setArtifactRefreshTick((tick) => tick + 1);
    }, { successMessage: '背景音乐已保存，剪映草稿待重新打包' });
    if (!result.ok && !bgmSaved) setBgmSelectionId(previousBgmId);
  }

  async function repackDraft() {
    await taskDraftAction.run(async () => {
      applyState(await api.repackTaskDraft(activeTask.id));
      setArtifactRefreshTick((tick) => tick + 1);
    }, { successMessage: '已开始重新打包剪映草稿' });
  }

  async function openDraftDirectory() {
    await taskDraftAction.run(() => api.openTaskOutputDirectory(activeTask.id));
  }

  async function launchJianying() {
    await taskDraftAction.run(() => api.launchJianying(activeTask.id));
  }

  return (
    <div className="task-detail-shell" data-task-operations="detail" data-task-id={activeTask.id}>
      <header className="task-detail-bar">
        <div className="task-detail-identity">
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
          <IconButton label="复制任务 ID" icon={<Copy size={14} />} onClick={() => navigator.clipboard?.writeText(activeTask.id)} />
          {activeTask.status === 'running' ? <Button className="task-detail-run-control" icon={<Pause size={14} />} disabled={taskDetailAction.busy || isBrowserPreview} onClick={() => setTaskStatus('paused')}>暂停任务</Button> : null}
          {activeTask.status === 'paused' ? <Button className="task-detail-run-control" icon={<Play size={14} />} disabled={taskDetailAction.busy || isBrowserPreview} onClick={() => setTaskStatus('running')}>继续任务</Button> : null}
          {activeTask.status === 'running' || activeTask.status === 'paused' || activeTask.status === 'failed' || activeTask.status === 'cancelled' ? <Button variant="primary" icon={<RotateCcw size={14} />} disabled={taskDetailAction.busy || isBrowserPreview} onClick={retryTask}>重试当前步骤</Button> : null}
          <Button variant="danger" icon={<XCircle size={14} />} disabled={taskDetailAction.busy || isBrowserPreview || activeTask.status === 'completed' || activeTask.status === 'cancelled'} onClick={() => setTaskStatus('cancelled')}>
            取消任务
          </Button>
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

      <section ref={taskDetailMainRef} className="task-detail-main" data-media-owner="task-artifact">
        <InlineActionFeedback feedback={taskDetailAction.feedback} />
        <div className="artifact-tabs">
          <Tabs className="artifact-tab-list" label="任务产物" value={tab} onChange={(value) => setTab(value as TaskArtifactTab)} items={[
            { value: 'preview', label: '结果' }, { value: 'storyboard', label: '分镜' },
            { value: 'images', label: '图片' }, { value: 'audio', label: '配音' }, { value: 'events', label: '事件' },
          ]} />
          <div
            className="task-template-switcher"
            data-template-location="toolbar"
            data-applied-template-id={templateSelection.appliedTemplateId}
            data-candidate-template-id={selectedDraftTemplateId}
            data-template-state={draftTemplateChanged ? 'pending' : templateSelection.appliedTemplateMissing ? 'missing' : 'applied'}
          >
              <TaskTemplateSelect
                templates={state.draftTemplates}
                value={selectedDraftTemplateId}
                disabled={draftTemplateLocked || taskTemplateAction.busy}
                onChange={(templateId) => {
                  taskTemplateAction.clearFeedback();
                  setTemplateSelectionId(templateId);
                }}
              />
            <Button
              type="button"
              className="task-template-apply"
              variant={draftTemplateChanged ? 'primary' : 'secondary'}
              icon={taskTemplateAction.busy ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
              disabled={!draftTemplateChanged || draftTemplateLocked || taskTemplateAction.busy}
              onClick={applyDraftTemplate}
            >
              {taskTemplateAction.busy
                ? '应用中'
                : draftTemplateChanged
                  ? '应用模板'
                  : templateSelection.appliedTemplateMissing ? '请选择模板' : '已应用'}
            </Button>
            <IconButton label="管理草稿模板" icon={<Settings2 size={14} />} disabled={taskTemplateAction.busy} onClick={openTemplateManager} />
          </div>
        </div>
        {activeDraftTemplate
          ? <ArtifactPreviewContent api={api} task={activeTask} config={state.config} draftTemplate={activeDraftTemplate} applyState={applyState} tab={tab} snapshot={artifactSnapshot} events={events} latestEvent={latestEvent} currentAgent={currentMeta?.agent ?? 'Runner'} isBrowserPreview={isBrowserPreview} onArtifactChanged={() => setArtifactRefreshTick((tick) => tick + 1)} />
          : <EmptyState title="暂无可用草稿模板" />}
        <TaskDraftDelivery
          task={activeTask}
          snapshot={artifactSnapshot}
          templates={state.draftTemplates}
          bgmLibrary={state.config.jianying.bgmLibrary}
          templateSelection={templateSelection}
          selectedTemplateId={selectedDraftTemplateId}
          selectedBgmId={bgmSelectionId}
          settingsOpen={draftSettingsOpen}
          settingsDisabled={activeTask.status === 'running' || activeTask.status === 'pending'}
          templateBusy={taskTemplateAction.busy}
          bgmBusy={taskBgmAction.busy}
          draftBusy={taskDraftAction.busy}
          isBrowserPreview={isBrowserPreview}
          onSettingsOpenChange={setDraftSettingsOpen}
          onTemplateChange={(templateId) => {
            taskTemplateAction.clearFeedback();
            setTemplateSelectionId(templateId);
          }}
          onBgmChange={(bgmId) => {
            taskBgmAction.clearFeedback();
            setBgmSelectionId(bgmId);
          }}
          onApplyTemplate={applyDraftTemplate}
          onApplyBgm={applyDraftBgm}
          onManageTemplates={openTemplateManager}
          onRepack={repackDraft}
          onOpenDirectory={openDraftDirectory}
          onLaunchJianying={launchJianying}
        />
        <InlineActionFeedback feedback={taskTemplateAction.feedback} />
        <InlineActionFeedback feedback={taskBgmAction.feedback} />
        <InlineActionFeedback feedback={taskDraftAction.feedback} />
      </section>
    </div>
  );
}
