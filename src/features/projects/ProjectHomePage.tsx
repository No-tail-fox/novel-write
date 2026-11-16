import { ProjectModelsDialog } from './ProjectModelFields';
import { ProjectCostDialog } from './ProjectCostPanel';
import type { AppConfig } from '../../shared/types';
import { Coins, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  Grid2X2,
  Heart,
  ImagePlus,
  LayoutList,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CursorPagination } from '../../components/CursorPagination';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  AppMutationResult,
  HistoryArchiveFilter,
  HistoryFamily,
  HistoryListRequest,
  ProjectSort,
  TaskSummary,
} from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { Button, IconButton, SegmentedControl, SelectField, TextField, Toolbar, Tooltip } from '../../ui';
import { createHistoryPageRequestController, useHistoryPage } from '../history/use-history-page';
import { formatTaskOperationTime, projectCoverPaths, taskHistoryTypeLabel, toLocalImageUrl } from '../tasks/task-formatters';
import { taskStatusDetail } from './project-task-status';
import { ProjectCoverDialog } from './ProjectCoverDialog';
import type { ProjectHomeSession, ProjectLayout, ProjectTaskType } from './project-home-session';
import '../../styles/features/projects.css';

const archiveOptions = [
  { value: 'active' as const, label: '活跃项目' },
  { value: 'archived' as const, label: '已归档' },
];
const projectTypeOptions = [
  { value: 'all', label: '全部制作类型' },
  { value: 'story', label: '短片生成' },
  { value: 'music-mv', label: '音乐 MV' },
  { value: 'html-video', label: 'HTML 动画' },
  { value: 'editorial-collage', label: '创意动画' },
  { value: 'template-animation', label: '模板动画' },
  { value: 'motion-comic', label: 'AI 漫剧' },
] as const;

export interface ProjectFilterRequest {
  taskType: ProjectTaskType;
  revision: number;
}

export type ProjectFilterSession = ProjectHomeSession & { filterRevision?: number };

export function ProjectHomePage({
  session,
  projectFilterRequest,
  config,
  api,
  applyState,
  openTaskDetail,
  navigate,
  isTombstoned,
  familyEpochs,
}: {
  session: ProjectFilterSession;
  projectFilterRequest?: ProjectFilterRequest;
  config: AppConfig;
  api: StoryDreamApi;
  applyState: (result: AppMutationResult | null) => void;
  openTaskDetail: (taskId: string) => void;
  navigate: (view: 'new-task' | 'history') => void;
  isTombstoned: (family: HistoryFamily, id: string) => boolean;
  familyEpochs: Partial<Record<HistoryFamily, number>>;
}) {
  const [view, setView] = useState(session.view);
  const [filterRevision, setFilterRevision] = useState(session.filterRevision);
  // Adjust before commit: the history hook must never issue an intermediate all-types request.
  // Persist the consumed revision with the session so ordinary returns preserve manual filters.
  if (projectFilterRequest && projectFilterRequest.revision !== filterRevision) {
    setFilterRevision(projectFilterRequest.revision);
    setView((current) => ({ ...current, taskType: projectFilterRequest.taskType }));
  }
  const [controller] = useState(() => session.controller ??= createHistoryPageRequestController<'task', TaskSummary>('task', { keepPageOnRefresh: true }));
  const { archiveFilter, taskType, favoriteFilter, query, layout, sort = 'newest' } = view;
  const [searchQuery, setSearchQuery] = useState(query.trim());
  const [composing, setComposing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TaskSummary | null>(null);
  const [modelsTask, setModelsTask] = useState<TaskSummary | null>(null);
  const [costTask, setCostTask] = useState<TaskSummary | null>(null);
  const [coverTask, setCoverTask] = useState<TaskSummary | null>(null);
  const projectAction = useAsyncAction();
  useEffect(() => {
    session.view = view;
    session.filterRevision = filterRevision;
  }, [filterRevision, session, view]);
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setSearchQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [composing, query]);
  const request = useMemo<Extract<HistoryListRequest, { family: 'task' }>>(() => ({
    family: 'task',
    filter: archiveFilter,
    ...(searchQuery ? { query: searchQuery } : {}),
    ...(taskType !== 'all' ? { taskType } : {}),
    ...(favoriteFilter === 'favorites' ? { favorite: true } : {}),
    sort,
    limit: 50,
  }), [archiveFilter, favoriteFilter, searchQuery, sort, taskType]);
  const loadPage = useCallback(async (next: Extract<HistoryListRequest, { family: 'task' }>) => {
    const { family: _family, ...input } = next;
    return api.listTasks(input);
  }, [api]);
  const projectPage = useHistoryPage<'task', TaskSummary>({
    family: 'task',
    request,
    loadPage,
    isTombstoned,
    familyEpoch: familyEpochs.task ?? 0,
    controller,
  });
  const tasks = projectPage.page?.items ?? [];
  const controlsBusy = projectAction.busy || Boolean(pendingDelete);
  const busy = controlsBusy || projectPage.loading || composing || query.trim() !== searchQuery;
  const hasFilters = Boolean(query.trim()) || taskType !== 'all' || favoriteFilter !== 'all';

  function resetFilters() {
    setView((current) => ({ ...current, query: '', taskType: 'all', favoriteFilter: 'all' }));
    setSearchQuery('');
  }

  async function toggleFavorite(task: TaskSummary) {
    await projectAction.run(async () => {
      const result = await api.setTaskFavorite(task.id, !task.isFavorite);
      applyState(result);
      projectPage.reload();
    });
  }

  async function archiveProject(task: TaskSummary) {
    await projectAction.run(async () => {
      const result = await api.archiveTask(task.id);
      applyState(result);
      projectPage.reload();
    });
  }

  async function restoreProject(task: TaskSummary) {
    await projectAction.run(async () => {
      const result = await api.restoreTask(task.id);
      applyState(result);
      projectPage.reload();
    });
  }

  async function deleteProjectPermanently() {
    if (!pendingDelete) return;
    await projectAction.run(async () => {
      const result = await api.deleteTaskPermanently(pendingDelete.id);
      applyState(result);
      setPendingDelete(null);
      projectPage.reload();
    });
  }

  return (
    <section className="project-home" data-project-home data-project-count={tasks.length}>
      <header className="project-home-intro"><div><span>YOUR CREATIVE SPACE</span><h1>让故事，成为画面。</h1><p>从一段文字出发，继续你的下一部作品。</p></div><Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('new-task')}>新建项目</Button></header>
      <Toolbar className="project-home-toolbar" aria-label="项目筛选">
        <SegmentedControl
          label="项目范围"
          value={archiveFilter}
          options={archiveOptions}
          onChange={(value) => setView((current) => ({ ...current, archiveFilter: value as HistoryArchiveFilter }))}
          disabled={controlsBusy}
        />
        <div className="project-home-search">
          <TextField
            label="搜索项目"
            aria-label="搜索项目"
            value={query}
            placeholder="搜索项目标题或摘要"
            disabled={controlsBusy}
            onChange={(event) => setView((current) => ({ ...current, query: event.target.value }))}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
          />
          <Search size={15} aria-hidden="true" />
        </div>
        <SelectField
          label="制作类型"
          aria-label="制作类型"
          value={taskType}
          options={projectTypeOptions}
          disabled={controlsBusy}
          onChange={(event) => setView((current) => ({ ...current, taskType: event.target.value as ProjectTaskType }))}
        />
        <SegmentedControl
          label="收藏范围"
          value={favoriteFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'favorites', label: '收藏', icon: <Heart size={14} /> },
          ]}
          onChange={(value) => setView((current) => ({ ...current, favoriteFilter: value === 'favorites' ? 'favorites' : 'all' }))}
          disabled={controlsBusy}
        />
        <SelectField
          label="项目排序"
          aria-label="项目排序"
          value={sort}
          options={[
            { value: 'newest', label: archiveFilter === 'archived' ? '最新归档' : '最新创建' },
            { value: 'oldest', label: archiveFilter === 'archived' ? '最早归档' : '最早创建' },
            { value: 'title', label: '名称' },
          ]}
          disabled={controlsBusy}
          onChange={(event) => setView((current) => ({ ...current, sort: event.target.value as ProjectSort }))}
        />
        <SegmentedControl
          className="project-layout-toggle"
          iconOnly
          label="项目布局"
          value={layout}
          options={[
            { value: 'grid', label: '网格', icon: <Grid2X2 size={14} /> },
            { value: 'list', label: '列表', icon: <LayoutList size={14} /> },
          ]}
          onChange={(value) => setView((current) => ({ ...current, layout: value as ProjectLayout }))}
          disabled={false}
        />
      </Toolbar>

      <div className="project-home-summary" aria-live="polite">
        <span>
          {projectPage.page ? `${projectPage.page.totalCount} 个项目` : projectPage.loading ? '正在加载项目' : '暂无项目'}
          {hasFilters ? ' · 已筛选' : ''}
        </span>
        {hasFilters ? <Button variant="subtle" density="compact" type="button" disabled={controlsBusy} onClick={resetFilters}>清除筛选</Button> : null}
      </div>

      {projectPage.loading && !projectPage.page ? <EmptyState title="正在加载项目" tone="loading" /> : null}
      {!projectPage.loading && projectPage.error ? (
        <EmptyState
          title="项目加载失败"
          description={projectPage.error.message}
          tone="error"
          action={<Button variant="secondary" density="compact" type="button" onClick={projectPage.reload}>重新加载</Button>}
        />
      ) : null}
      {!projectPage.loading && !projectPage.error && tasks.length === 0 ? (
        <EmptyState
          title={hasFilters ? '没有符合条件的项目' : archiveFilter === 'archived' ? '还没有已归档项目' : '还没有项目'}
          description={hasFilters ? '调整搜索或筛选条件后再试。' : archiveFilter === 'archived' ? '归档后的项目会显示在这里。' : '创建第一个项目后，就能从这里继续编辑。'}
          action={archiveFilter === 'active' && !hasFilters ? <Button variant="primary" density="compact" icon={<Plus size={15} />} type="button" onClick={() => navigate('new-task')}>新建项目</Button> : undefined}
        />
      ) : null}

      {tasks.length > 0 ? (
        <div className={layout === 'grid' ? 'project-grid' : 'project-list'} data-project-layout={layout}>
          {tasks.map((task) => (
            <ProjectCard
              key={task.id}
              task={task}
              layout={layout}
              archived={archiveFilter === 'archived'}
              busy={busy}
              openBusy={controlsBusy}
              onOpen={() => openTaskDetail(task.id)}
              onToggleFavorite={() => void toggleFavorite(task)}
              onArchive={() => void archiveProject(task)}
              onRestore={() => void restoreProject(task)}
              onDelete={() => { projectAction.clearFeedback(); setPendingDelete(task); }}
              onCover={() => setCoverTask(task)}
              onModels={() => setModelsTask(task)}
              onCost={() => setCostTask(task)}
            />
          ))}
          {layout === 'grid' && archiveFilter === 'active' && !hasFilters ? <Button className="project-new-card" variant="subtle" onClick={() => navigate('new-task')}><Plus size={30} aria-hidden="true" /><strong>一个新故事</strong><span>导入小说、剧本，或从空白开始</span></Button> : null}
        </div>
      ) : null}

      {tasks.some(task => task.projectActivity) ? <section className="project-home-activity" aria-label="项目活动"><header><h2>项目活动</h2><span>当前页项目的最新状态</span></header>{tasks.filter(task => task.projectActivity).slice(0, 4).map(task => <div className="project-activity-row" key={task.id}><strong>{task.title || '未命名任务'}</strong><span>{task.projectActivity?.detail}</span><StatusBadge status={task.projectActivity!.status} label={task.projectActivity!.label} /><Button disabled={controlsBusy} onClick={() => openTaskDetail(task.id)}>继续制作 →</Button></div>)}</section> : null}

      {projectPage.page ? (
        <div className="project-home-pagination">
          <span>
            {projectPage.page.totalCount > 0
              ? `显示 ${tasks.length} / ${projectPage.page.totalCount} 个项目`
              : '暂无项目'}
          </span>
          <CursorPagination
            busy={busy}
            hasPrevious={projectPage.hasPrevious}
            hasNext={Boolean(projectPage.page.nextCursor)}
            onPrevious={projectPage.previous}
            onReload={projectPage.reload}
            onNext={projectPage.next}
            label="项目分页"
          />
        </div>
      ) : null}

      <InlineActionFeedback feedback={projectAction.feedback} />
      {modelsTask ? <ProjectModelsDialog task={tasks.find(task => task.id === modelsTask.id) ?? modelsTask} config={config} api={api} onClose={() => setModelsTask(null)} onUpdated={result => { applyState(result); projectPage.reload(); }} /> : null}
      {costTask ? <ProjectCostDialog key={costTask.id} task={costTask} api={api} onClose={() => setCostTask(null)} /> : null}
      {coverTask ? <ProjectCoverDialog task={tasks.find((task) => task.id === coverTask.id) ?? coverTask} api={api}
        onClose={() => setCoverTask(null)} onUpdated={(result) => { applyState(result); projectPage.reload(); }} /> : null}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="永久删除项目"
        description={projectAction.feedback?.tone === 'error'
          ? projectAction.feedback.message
          : `将永久删除“${pendingDelete?.title || '未命名任务'}”及其受管产物，此操作无法撤销。`}
        confirmLabel="永久删除"
        destructive
        busy={projectAction.busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={deleteProjectPermanently}
      />
    </section>
  );
}

function ProjectCard({
  task,
  layout,
  archived,
  busy,
  openBusy,
  onOpen,
  onToggleFavorite,
  onArchive,
  onRestore,
  onDelete,
  onCover,
  onModels,
  onCost,
}: {
  task: TaskSummary;
  layout: ProjectLayout;
  archived: boolean;
  busy: boolean;
  openBusy: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onCover: () => void;
  onModels: () => void;
  onCost: () => void;
}) {
  const generatedCoverPath = task.projectCover?.path?.trim();
  const ordinaryCoverPath = task.ordinaryCoverAsset?.path?.trim();
  const coverCandidates = projectCoverPaths(task).map((path) => {
    const url = toLocalImageUrl(path);
    const isProjectCover = path === generatedCoverPath;
    return {
      source: path === generatedCoverPath || path === ordinaryCoverPath ? 'cover' : 'reference',
      url: isProjectCover && task.projectCover?.revision
        ? `${url}?v=${encodeURIComponent(task.projectCover.revision)}`
        : url,
    } as const;
  });
  const hasProjectCover = coverCandidates.some((candidate) => candidate.source === 'cover');
  const [failedCovers, setFailedCovers] = useState<Set<string>>(() => new Set());
  const cover = coverCandidates.find((candidate) => !failedCovers.has(candidate.url));
  return (
    <article className={`project-card ${layout === 'list' ? 'project-card-list' : ''}`} data-project-id={task.id}>
      <Button
        className="project-card-open"
        variant="subtle"
        density="comfortable"
        type="button"
        aria-label={`打开项目：${task.title || '未命名任务'}`}
        disabled={openBusy}
        onClick={onOpen}
      >
        <span className="project-card-cover" data-cover-source={cover?.source ?? (hasProjectCover ? 'cover' : 'empty')}>
          {cover
            ? <img
                src={cover.url}
                alt={`${task.title || '项目'}封面`}
                loading="lazy"
                onError={() => setFailedCovers((current) => new Set(current).add(cover.url))}
              />
            : <span className="project-card-cover-empty" aria-label="暂无项目封面"><Play size={24} aria-hidden="true" /><span>暂无项目封面</span></span>}
        </span>
        <span className="project-card-body">
          <span className="project-card-meta"><span className="project-card-type">{taskHistoryTypeLabel(task)}</span><span>创建于 {formatTaskOperationTime(task.createdAt)}</span></span>
          <strong>{task.title || '未命名任务'}</strong>
          {task.inputPreview?.trim() ? <span className="project-card-description">{task.inputPreview}</span> : null}
          <span className="project-card-status">
            <StatusBadge status={task.projectActivity?.status ?? task.status} label={task.projectActivity?.label} />
            <small>{taskStatusDetail(task)}</small>
          </span>
        </span>
      </Button>
      <div className="project-card-actions">
        <Tooltip content="项目模型"><IconButton label="项目模型" variant="subtle" density="compact" icon={<Settings2 size={15} />} disabled={busy} onClick={onModels} /></Tooltip>
        <Tooltip content="项目成本"><IconButton label="项目成本" variant="subtle" density="compact" icon={<Coins size={15} />} onClick={onCost} /></Tooltip>
        {!archived ? <Tooltip content="设置项目封面">
          <IconButton label="设置项目封面" variant="subtle" density="compact" icon={<ImagePlus size={15} />}
            disabled={busy || task.status === 'running' || task.projectActivity?.status === 'running'} onClick={onCover} />
        </Tooltip> : null}
        <Tooltip content={task.isFavorite ? '取消收藏' : '收藏项目'}>
          <IconButton
            label={task.isFavorite ? '取消收藏' : '收藏项目'}
            variant="subtle"
            density="compact"
            icon={<Heart size={15} fill={task.isFavorite ? 'currentColor' : 'none'} />}
            disabled={busy}
            onClick={onToggleFavorite}
          />
        </Tooltip>
        {archived ? (
          <>
            <Tooltip content="恢复项目">
              <IconButton
                label="恢复项目"
                variant="subtle"
                density="compact"
                icon={<RotateCcw size={15} />}
                disabled={busy}
                onClick={onRestore}
              />
            </Tooltip>
            <Tooltip content="永久删除">
              <IconButton
                label="永久删除"
                variant="danger"
                density="compact"
                icon={<Trash2 size={15} />}
                disabled={busy}
                onClick={onDelete}
              />
            </Tooltip>
          </>
        ) : (
          <Tooltip content="归档项目">
            <IconButton
              label="归档项目"
              variant="subtle"
              density="compact"
              icon={<Archive size={15} />}
              disabled={busy}
              onClick={onArchive}
            />
          </Tooltip>
        )}
        <Toolbar aria-label={`${task.title || '未命名任务'} 打开操作`}>
          <Button
            variant="subtle"
            density="compact"
            icon={<ArrowUpRight size={15} />}
            type="button"
            disabled={openBusy}
            onClick={onOpen}
            aria-label={archived ? '查看项目' : '继续制作'}
          >
            {archived ? '查看项目' : '继续制作'}
          </Button>
        </Toolbar>
      </div>
    </article>
  );
}
