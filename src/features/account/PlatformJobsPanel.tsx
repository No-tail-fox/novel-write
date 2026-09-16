import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { formatCredits, type PlatformJob } from '../../shared/commercial-contract';
import { Button, Dialog } from '../../ui';
import { CommercialNotice, formatCommercialDate } from './commercial-ui';
import { notifyCommercialChanged } from './useCommercialSnapshot';
import { useCommercialAction } from './useCommercialAction';
import { getCommercialStore } from './commercial-store';

const jobLabels: Record<PlatformJob['state'], string> = { reserved: '积分已预留', submitting: '正在提交', submission_unknown: '正在核对提交结果', running: '生成中', awaiting_delivery: '正在交付作品', succeeded_settled: '已完成并结算', failed_released: '失败 · 积分已释放', cancelled_released: '已取消 · 积分已释放' };
const activeJob = (job: PlatformJob) => !['succeeded_settled', 'failed_released', 'cancelled_released'].includes(job.state);

export function PlatformJobsPanel({ api, userId }: { api: StoryDreamApi; userId: string }) {
  const [jobs, setJobs] = useState<PlatformJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<PlatformJob | null>(null);
  const [downloadPath, setDownloadPath] = useState('');
  const action = useCommercialAction(api);
  const mounted = useRef(true);
  const revision = useRef(0);
  const current = () => mounted.current && getCommercialStore(api.commercial).getState().snapshot?.user?.id === userId;
  async function load() {
    const request = ++revision.current;
    setLoading(true);
    try { const next = await api.commercial.listJobs(); if (current() && request === revision.current) { setJobs(next); setError(''); } }
    catch (failure) { if (current() && request === revision.current) setError(failure instanceof Error ? failure.message : '任务读取失败。'); }
    finally { if (current() && request === revision.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; revision.current++; }; }, [api, userId]);
  useEffect(() => { if (!jobs.some(activeJob) || loading) return; const timer = setTimeout(() => void load(), 6000); return () => clearTimeout(timer); }, [jobs, loading]);
  return <section className="commercial-section"><div className="commercial-section-heading"><div><h3>平台生成任务</h3><p>仅显示当前账号的任务；下载已交付作品不重复扣积分。</p></div><Button disabled={loading} icon={<RefreshCw size={15} />} onClick={() => void load()}>刷新任务</Button></div>
    {error && <CommercialNotice error>{error}</CommercialNotice>}{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}{downloadPath && <CommercialNotice>作品已保存到：{downloadPath}</CommercialNotice>}
    {jobs.length ? <div>{jobs.map((job) => <article className="commercial-job" key={job.id}><div className="commercial-section-heading"><div><h3>{job.modelId}</h3><p>{formatCommercialDate(job.createdAt)} · {job.id}</p></div><span className={`commercial-status${job.state === 'succeeded_settled' ? ' commercial-status--active' : ''}`}>{jobLabels[job.state]}</span></div><p className="commercial-muted">预留 {formatCredits(job.reservedUnits)} 积分 · 已结算 {formatCredits(job.settledUnits)} 积分{job.message ? ` · ${job.message}` : ''}</p><div className="commercial-job-artifacts">{job.artifacts.map((artifact) => <Button key={artifact.id} density="compact" disabled={action.busy} icon={<Download size={14} />} onClick={() => void action.run(() => api.commercial.downloadArtifact(artifact.id), (result) => setDownloadPath(result.path))}>{artifact.name}</Button>)}{job.state === 'reserved' && <Button density="compact" disabled={action.busy} onClick={() => setCancelTarget(job)}>取消未提交任务</Button>}</div></article>)}</div> : <div className="commercial-empty"><Download size={24} /><strong>{loading ? '正在读取平台任务…' : '暂无平台生成记录'}</strong><p>使用平台模型提交任务后，可在这里查看生成进度、结算和下载结果。</p></div>}
    <Dialog open={Boolean(cancelTarget)} onOpenChange={(open) => { if (!action.busy && !open) setCancelTarget(null); }} title="取消尚未提交的任务？" actions={<><Button disabled={action.busy} onClick={() => setCancelTarget(null)}>保留任务</Button><Button variant="danger" disabled={action.busy || !cancelTarget} onClick={() => { if (cancelTarget) void action.run(() => api.commercial.cancelJob(cancelTarget.id), () => { setCancelTarget(null); notifyCommercialChanged(api); void load(); }); }}>确认取消</Button></>}><p>仅能取消尚未提交给模型服务的任务；取消成功后服务端会释放预留积分。</p>{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}</Dialog>
  </section>;
}
