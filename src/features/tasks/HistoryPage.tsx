import { useCallback, useMemo, useState } from 'react';
import { Archive, ArrowUpRight, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CursorPagination } from '../../components/CursorPagination';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { StatusBadge as StatusPill, taskStatusLabel as statusLabel } from '../../components/StatusBadge';
import { contentTracks } from '../../shared/editorial-options';
import { taskProgressSnapshot } from '../../shared/task-progress';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  AppMutationResult,
  HistoryArchiveFilter,
  HistoryFamily,
  HistoryListRequest,
  HistoryPage as HistoryPageResult,
  ImageLabSummary,
  TaskStatus,
  TaskSummary,
  ViralAnalysisSummary,
  VoiceLabSummary,
} from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { useHistoryPage } from '../history/use-history-page';
import { formatDate, formatTaskOperationTime } from './task-formatters';
import { taskOperationStatusLabel } from './task-pipeline';
import '../../styles/features/task-operations.css';

type HistoryRecord = TaskSummary | ViralAnalysisSummary | ImageLabSummary | VoiceLabSummary;
type PendingHistoryDelete = { family: HistoryFamily; record: HistoryRecord };

const historyFamilies = ['task', 'viral-analysis', 'image-lab', 'voice-lab'] as const satisfies readonly HistoryFamily[];
const historyFamilyLabels = ['任务', '爆款拆解', '图片', '配音'] as const;
const historyArchiveFilters = ['active', 'archived'] as const satisfies readonly HistoryArchiveFilter[];
const historyArchiveFilterLabels = ['活跃任务', '已归档'] as const;
const historyTaskStatuses = ['all', 'draft', 'completed', 'running', 'failed', 'cancelled'] as const;
const trackLabelById = new Map(contentTracks.map(([id, label]) => [id, label] as const));

export function HistoryPage({
  api,
  applyState,
  openTaskDetail,
  isTombstoned,
  familyEpochs,
}: {
  api: StoryDreamApi;
  applyState: (result: AppMutationResult | null) => void;
  openTaskDetail: (taskId: string) => void;
  isTombstoned: (family: HistoryFamily, id: string) => boolean;
  familyEpochs: Partial<Record<HistoryFamily, number>>;
}) {
  const [family, setFamily] = useState<HistoryFamily>('task');
  const [archiveFilter, setArchiveFilter] = useState<HistoryArchiveFilter>('active');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PendingHistoryDelete | null>(null);
  const historyAction = useAsyncAction();
  const request = useMemo<HistoryListRequest>(() => {
    const base = {
      filter: archiveFilter,
      ...(query.trim() ? { query } : {}),
      limit: 50,
    };
    if (family === 'task') return { ...base, family: 'task', ...(statusFilter === 'all' ? {} : { status: statusFilter }) };
    if (family === 'viral-analysis') return { ...base, family: 'viral-analysis' };
    if (family === 'image-lab') return { ...base, family: 'image-lab' };
    return { ...base, family: 'voice-lab' };
  }, [archiveFilter, family, query, statusFilter]);
  const loadPage = useCallback(async (next: HistoryListRequest): Promise<HistoryPageResult<HistoryFamily, HistoryRecord>> => {
    if (next.family === 'task') {
      const { family: _family, ...input } = next;
      return api.listTasks(input);
    }
    if (next.family === 'viral-analysis') {
      const { family: _family, ...input } = next;
      return api.listViralAnalyses(input);
    }
    if (next.family === 'image-lab') {
      const { family: _family, ...input } = next;
      return api.listImageLabRecords(input);
    }
    const { family: _family, ...input } = next;
    return api.listVoiceLabRecords(input);
  }, [api]);
  const historyPage = useHistoryPage<HistoryFamily, HistoryRecord>({
    family,
    request,
    loadPage,
    isTombstoned,
    familyEpoch: familyEpochs[family] ?? 0,
  });
  const historyBusy = historyAction.busy || historyPage.loading;
  const records = historyPage.page?.items ?? [];

  async function archiveRecord(record: HistoryRecord) {
    await historyAction.run(async () => {
      let result: AppMutationResult;
      if (family === 'task') result = await api.archiveTask(record.id);
      else if (family === 'viral-analysis') result = await api.archiveViralAnalysis(record.id);
      else if (family === 'image-lab') result = await api.archiveImageLabRecord(record.id);
      else result = await api.archiveVoiceLabRecord(record.id);
      applyState(result);
      historyPage.reload();
    });
  }

  async function restoreRecord(record: HistoryRecord) {
    await historyAction.run(async () => {
      let result: AppMutationResult;
      if (family === 'task') result = await api.restoreTask(record.id);
      else if (family === 'viral-analysis') result = await api.restoreViralAnalysis(record.id);
      else if (family === 'image-lab') result = await api.restoreImageLabRecord(record.id);
      else result = await api.restoreVoiceLabRecord(record.id);
      applyState(result);
      historyPage.reload();
    });
  }

  async function deleteRecordPermanently() {
    if (!pendingDelete) return;
    await historyAction.run(async () => {
      let result: AppMutationResult;
      if (pendingDelete.family === 'task') result = await api.deleteTaskPermanently(pendingDelete.record.id);
      else if (pendingDelete.family === 'viral-analysis') result = await api.deleteViralAnalysisPermanently(pendingDelete.record.id);
      else if (pendingDelete.family === 'image-lab') result = await api.deleteImageLabRecordPermanently(pendingDelete.record.id);
      else result = await api.deleteVoiceLabRecordPermanently(pendingDelete.record.id);
      applyState(result);
      setPendingDelete(null);
      historyPage.reload();
    });
  }

  return (
    <section className="task-operations-view history-page" data-task-operations="history" data-history-family={family}>
      <div className="task-history-toolbar">
        <div className="task-history-segments">
          <Segmented label="记录范围" value={archiveFilter} options={historyArchiveFilters} labels={historyArchiveFilterLabels} onChange={setArchiveFilter} disabled={historyBusy || Boolean(pendingDelete)} />
        </div>
        <input className="search-input" aria-label="搜索历史记录" value={query} placeholder={family === 'task' ? '搜索任务标题' : '搜索记录'} disabled={historyBusy || Boolean(pendingDelete)} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="task-history-filter-row">
        {family === 'task' ? (
          <label className="task-history-status-select">
            <span>状态</span>
            <select aria-label="状态" value={statusFilter} disabled={historyBusy || Boolean(pendingDelete)} onChange={(event) => setStatusFilter(event.target.value as 'all' | TaskStatus)}>
              {historyTaskStatuses.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
            </select>
          </label>
        ) : <span className="subtle-copy">{historyFamilyLabels[historyFamilies.indexOf(family)]}历史记录</span>}
        <details className="task-history-more-filters">
          <summary aria-label="筛选记录类型" title="筛选记录类型"><SlidersHorizontal size={15} /></summary>
          <label>
            <span>记录类型</span>
            <select aria-label="记录类型" value={family} disabled={historyBusy || Boolean(pendingDelete)} onChange={(event) => setFamily(event.target.value as HistoryFamily)}>
              {historyFamilies.map((item, index) => <option key={item} value={item}>{historyFamilyLabels[index]}</option>)}
            </select>
          </label>
        </details>
      </div>
      <DataTable
        label="历史任务"
        columns={family === 'task' ? ['任务', '类型', '当前状态', '进度', '更新时间', '操作'] : ['记录', '状态', '详情', '创建时间', '操作']}
        state={records.length === 0 ? (
          historyPage.loading ? <EmptyState title="正在加载历史记录" tone="loading" /> : <EmptyState title="暂无历史记录" />
        ) : null}
      >
        {records.map((record) => {
          const row = historyRecordRow(family, record);
          if (family === 'task') {
            const task = record as TaskSummary;
            const progress = taskProgressSnapshot(task);
            const displayProgress = task.status === 'running' ? progress.position : progress.completed;
            const percent = Math.round((displayProgress / Math.max(1, progress.total)) * 100);
            return (
              <div className="table-row clickable" key={record.id} role="row" onClick={() => openTaskDetail(record.id)}>
                <span className="task-history-title" role="cell">
                  <button className="table-row-primary-action" type="button" aria-label={`打开任务 ${row.title}`} onClick={(event) => { event.stopPropagation(); openTaskDetail(record.id); }}>
                    {row.title}
                  </button>
                  <small>{task.targetScenes || task.storyboardSceneCount || 0} 个场景 · {task.ratio}</small>
                </span>
                <span role="cell">{trackLabelById.get(task.track) || task.track}</span>
                <span role="cell"><StatusPill status={task.status} label={taskOperationStatusLabel(task)} /></span>
                <span className="task-history-progress" role="cell">
                  <span role="progressbar" aria-label={`${row.title}进度`} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={displayProgress}><i style={{ width: `${percent}%` }} /></span>
                  <small>{displayProgress} / {progress.total}{task.status === 'completed' ? ' 完成' : ''}</small>
                </span>
                <span role="cell">{formatTaskOperationTime(task.lastHeartbeatAt || task.completedAt || task.createdAt)}</span>
                <span role="cell">
                  <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                    {archiveFilter === 'active' ? (
                      <>
                        <button className="icon-button task-history-action" type="button" title="打开任务详情" aria-label="打开任务详情" disabled={historyBusy} onClick={() => openTaskDetail(record.id)}><ArrowUpRight size={14} /></button>
                        <button className="icon-button task-history-action" type="button" title="归档任务" aria-label="归档任务" disabled={historyBusy} onClick={() => void archiveRecord(record)}><Archive size={14} /></button>
                      </>
                    ) : (
                      <>
                        <button className="icon-button task-history-action" type="button" title="恢复任务" aria-label="恢复任务" disabled={historyBusy} onClick={() => void restoreRecord(record)}><RotateCcw size={14} /></button>
                        <button className="icon-button task-history-action danger-action" type="button" title="永久删除记录" aria-label="永久删除记录" disabled={historyBusy} onClick={() => setPendingDelete({ family, record })}><Trash2 size={14} /></button>
                      </>
                    )}
                  </span>
                </span>
              </div>
            );
          }
          return (
            <div className="table-row" key={record.id} role="row">
              <span role="cell">{row.title}</span>
              <span role="cell">{row.status}</span>
              <span role="cell">{row.detail}</span>
              <span role="cell">{formatDate(record.createdAt)}</span>
              <span role="cell">
                <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                  {archiveFilter === 'active' ? (
                    <button className="icon-button task-history-action" type="button" title="归档记录" aria-label="归档记录" disabled={historyBusy} onClick={() => void archiveRecord(record)}><Archive size={14} /></button>
                  ) : (
                    <>
                      <button className="icon-button task-history-action" type="button" title="恢复记录" aria-label="恢复记录" disabled={historyBusy} onClick={() => void restoreRecord(record)}><RotateCcw size={14} /></button>
                      <button className="icon-button task-history-action danger-action" type="button" title="永久删除记录" aria-label="永久删除记录" disabled={historyBusy} onClick={() => setPendingDelete({ family, record })}><Trash2 size={14} /></button>
                    </>
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </DataTable>
      <div className="task-history-pagination-row">
        <span className="subtle-copy">{historyPage.page ? `共 ${historyPage.page.totalCount} 条记录 · 每页最多 50 条` : historyPage.loading ? '正在加载' : '暂无记录'}</span>
        <CursorPagination
          busy={historyBusy}
          hasPrevious={historyPage.hasPrevious}
          hasNext={Boolean(historyPage.page?.nextCursor)}
          onPrevious={historyPage.previous}
          onReload={historyPage.reload}
          onNext={historyPage.next}
        />
      </div>
      {historyPage.error ? <div className="inline-feedback error">{historyPage.error.message}</div> : null}
      <InlineActionFeedback feedback={historyAction.feedback} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="永久删除记录"
        description={`将永久删除“${pendingDelete ? historyRecordRow(pendingDelete.family, pendingDelete.record).title : ''}”及其受管产物，此操作无法撤销。`}
        confirmLabel="永久删除"
        destructive
        busy={historyBusy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={deleteRecordPermanently}
      />
    </section>
  );
}

function historyRecordRow(family: HistoryFamily, record: HistoryRecord): { title: string; status: string; detail: string } {
  if (family === 'task') {
    const task = record as TaskSummary;
    const progress = taskProgressSnapshot(task);
    return { title: task.title || '未命名任务', status: statusLabel(task.status), detail: `${progress.completed} / ${progress.total}` };
  }
  if (family === 'viral-analysis') {
    const analysis = record as ViralAnalysisSummary;
    return {
      title: analysis.title || analysis.url,
      status: statusLabelText(analysis.status),
      detail: `${analysis.platform} · ${(analysis.progress * 100).toFixed(0)}%`,
    };
  }
  if (family === 'image-lab') {
    const image = record as ImageLabSummary;
    return {
      title: image.promptPreview || '未命名图片记录',
      status: statusLabelText(image.status),
      detail: `${image.provider} · ${image.ratio} · ${image.resolution}`,
    };
  }
  const voice = record as VoiceLabSummary;
  return {
    title: voice.textPreview || '未命名配音记录',
    status: statusLabelText(voice.status),
    detail: `${voice.provider} · ${voice.voiceLabel} · ${voice.speed}x`,
  };
}

function statusLabelText(status: string): string {
  return {
    pending: '等待', running: '运行中', paused: '暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
    mock: '模拟', generated: '已生成',
  }[status] ?? status;
}
