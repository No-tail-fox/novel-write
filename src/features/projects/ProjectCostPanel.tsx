import { useEffect, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { TaskSummary } from '../../shared/types';
import { COST_KIND_LABELS, formatCostAmount, formatTokenCount, type ProjectCostKindSummary, type ProjectCostReport } from '../../shared/project-cost';
import { Button, Dialog } from '../../ui';
import '../../styles/features/project-cost.css';

/** U-5: compact per-project cost panel (counts, tokens, estimate, "可能已计费" warning, H-5 image estimate). */
export function ProjectCostDialog({ task, api, onClose }: {
  task: Pick<TaskSummary, 'id' | 'title'>; api: StoryDreamApi; onClose: () => void;
}) {
  const [report, setReport] = useState<ProjectCostReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function loadCost() {
    setError(''); setBusy(true);
    try { setReport(await api.getProjectCostSummary(task.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  // Read-only: the summary only reads saved receipts, so loading on open never spends money.
  useEffect(() => { void loadCost(); }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Dialog open title={`项目成本 · ${task.title || '未命名项目'}`} onOpenChange={open => { if (!open) onClose(); }}
    actions={<><Button disabled={busy} onClick={() => void loadCost()}>{busy ? '统计中…' : '重新统计'}</Button><Button variant="primary" onClick={onClose}>关闭</Button></>}>
    {report ? <ProjectCostPanel report={report} /> : !error ? <p role="status" className="project-cost-muted">正在读取本项目已保存的调用回执…</p> : null}
    {error ? <p role="alert" className="project-cost-error">{error}</p> : null}
  </Dialog>;
}

function usageText(kind: ProjectCostKindSummary): string {
  if (kind.kind === 'llm') {
    if (!kind.inputTokens && !kind.outputTokens) return '—';
    return `输入 ${formatTokenCount(kind.inputTokens)} · 输出 ${formatTokenCount(kind.outputTokens)}${kind.cachedTokens ? ` · 缓存 ${formatTokenCount(kind.cachedTokens)}` : ''}`;
  }
  if (kind.kind === 'image') return kind.images ? `${kind.images} 张` : '—';
  if (kind.kind === 'tts') return kind.characters ? `${kind.characters} 字` : '—';
  return kind.seconds ? `${Math.round(kind.seconds)} 秒` : '—';
}

export function ProjectCostPanel({ report }: { report: ProjectCostReport }) {
  const { summary } = report;
  const kinds = summary.kinds.filter(kind => kind.calls > 0 || kind.kind === 'llm' || kind.kind === 'image' || kind.kind === 'tts');
  return <section className="project-cost-panel" aria-label="成本">
    <div className="project-cost-headline">
      <strong>{formatCostAmount(summary.estimatedCost, summary.currency)}</strong>
      <span>估算费用（只计已收到结果的调用）</span>
      {summary.unpricedReceived ? <small>{summary.unpricedReceived} 次调用未定价，未计入估算</small> : null}
    </div>
    {summary.possiblyBilled > 0
      ? <p className="project-cost-warning" role="note">可能已计费 {summary.possiblyBilled} 次：这些请求结果未知，服务商可能已扣费，请到服务商后台核对。</p>
      : null}
    {report.expectedImages ? <p className="project-cost-estimate" data-basis={report.expectedImages.basis}>{report.expectedImages.label}</p> : null}
    <table className="project-cost-table">
      <thead><tr><th scope="col">类型</th><th scope="col">调用</th><th scope="col">成功</th><th scope="col">失败/未发送</th><th scope="col">结果未知</th><th scope="col">用量</th><th scope="col">估算费用</th></tr></thead>
      <tbody>{kinds.map(kind => <tr key={kind.kind}>
        <th scope="row">{COST_KIND_LABELS[kind.kind]}</th>
        <td>{kind.calls}</td><td>{kind.received}</td><td>{kind.rejected + kind.notSent}</td><td>{kind.unknown}</td>
        <td>{usageText(kind)}</td>
        <td>{kind.received ? formatCostAmount(kind.cost, summary.currency) : '—'}</td>
      </tr>)}</tbody>
    </table>
    {report.notes.length ? <ul className="project-cost-notes">{report.notes.map(note => <li key={note}>{note}</li>)}</ul> : null}
  </section>;
}
