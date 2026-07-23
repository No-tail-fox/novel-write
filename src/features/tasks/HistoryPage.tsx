import { useCallback, useMemo, useState } from 'react';
import { Archive, FolderOpen, RotateCcw, Trash2 } from 'lucide-react';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CursorPagination } from '../../components/CursorPagination';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { StatusBadge as StatusPill, taskStatusLabel as statusLabel } from '../../components/StatusBadge';
import { taskProgressLabel } from '../../shared/html-video-workflow';
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
import { formatDate } from './task-formatters';

type HistoryRecord = TaskSummary | ViralAnalysisSummary | ImageLabSummary | VoiceLabSummary;
type PendingHistoryDelete = { family: HistoryFamily; record: HistoryRecord };

const historyFamilies = ['task', 'viral-analysis', 'image-lab', 'voice-lab'] as const satisfies readonly HistoryFamily[];
const historyFamilyLabels = ['任务', '爆款拆解', '图片', '配音'] as const;
const historyArchiveFilters = ['active', 'archived'] as const satisfies readonly HistoryArchiveFilter[];
const historyArchiveFilterLabels = ['当前记录', '归档记录'] as const;

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

  async function openHistoryOutput(taskId: string) {
    await historyAction.run(() => api.openTaskOutputDirectory(taskId));
  }

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
    <section className="panel full-panel history-page">
      <div className="panel-title-row">
        <Segmented label="记录类型" value={family} options={historyFamilies} labels={historyFamilyLabels} onChange={setFamily} disabled={historyBusy || Boolean(pendingDelete)} />
        <Segmented label="记录范围" value={archiveFilter} options={historyArchiveFilters} labels={historyArchiveFilterLabels} onChange={setArchiveFilter} disabled={historyBusy || Boolean(pendingDelete)} />
      </div>
      <div className="panel-title-row">
        {family === 'task' ? (
          <div className="chip-row">
            {(['all', 'draft', 'completed', 'running', 'failed', 'cancelled'] as const).map((item) => (
              <button key={item} type="button" className={statusFilter === item ? 'chip active' : 'chip'} disabled={historyBusy || Boolean(pendingDelete)} onClick={() => setStatusFilter(item)}>
                {statusLabel(item)}
              </button>
            ))}
          </div>
        ) : <span className="subtle-copy">{historyFamilyLabels[historyFamilies.indexOf(family)]}历史记录</span>}
        <input className="search-input" value={query} placeholder={family === 'task' ? '搜索任务' : '搜索记录'} disabled={historyBusy || Boolean(pendingDelete)} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="panel-title-row">
        <span className="subtle-copy">
          {historyPage.page ? `${historyPage.page.totalCount} 条记录` : historyPage.loading ? '正在加载' : '暂无记录'}
        </span>
        <CursorPagination
          busy={historyBusy}
          hasPrevious={historyPage.hasPrevious}
          hasNext={Boolean(historyPage.page?.nextCursor)}
          onPrevious={historyPage.previous}
          onReload={historyPage.reload}
          onNext={historyPage.next}
        />
      </div>
      <DataTable
        label="历史任务"
        columns={family === 'task' ? ['任务', '状态', '进度', '创建时间', '输出'] : ['记录', '状态', '详情', '创建时间', '操作']}
        state={records.length === 0 ? (
          historyPage.loading ? <EmptyState title="正在加载历史记录" tone="loading" /> : <EmptyState title="暂无历史记录" />
        ) : null}
      >
        {records.map((record) => {
          const row = historyRecordRow(family, record);
          return (
            <div className={family === 'task' ? 'table-row clickable' : 'table-row'} key={record.id} role="row" onClick={() => family === 'task' && openTaskDetail(record.id)}>
              <span role="cell">
                {family === 'task' ? (
                  <button className="table-row-primary-action" type="button" aria-label={`打开任务 ${row.title}`} onClick={(event) => { event.stopPropagation(); openTaskDetail(record.id); }}>
                    {row.title}
                  </button>
                ) : row.title}
              </span>
              <span role="cell">{family === 'task' ? <StatusPill status={(record as TaskSummary).status} /> : row.status}</span>
              <span role="cell">{row.detail}</span>
              <span role="cell">{formatDate(record.createdAt)}</span>
              <span role="cell">
                <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                  {family === 'task' && archiveFilter === 'active' ? (
                    <button className="mini-button" type="button" aria-label="打开输出目录" disabled={historyBusy || !(record as TaskSummary).outputDir} onClick={() => void openHistoryOutput(record.id)}>
                      <FolderOpen size={14} />
                    </button>
                  ) : null}
                  {archiveFilter === 'active' ? (
                    <button className="mini-button" type="button" disabled={historyBusy} onClick={() => void archiveRecord(record)}><Archive size={14} />归档</button>
                  ) : (
                    <>
                      <button className="mini-button" type="button" disabled={historyBusy} onClick={() => void restoreRecord(record)}><RotateCcw size={14} />恢复</button>
                      <button className="mini-button danger-action" type="button" disabled={historyBusy} onClick={() => setPendingDelete({ family, record })}><Trash2 size={14} />永久删除</button>
                    </>
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </DataTable>
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
    return { title: task.title || '未命名任务', status: statusLabel(task.status), detail: taskProgressLabel(task) };
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
