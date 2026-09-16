import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Download, RefreshCw } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { MusicGenerateInput } from '../../shared/music-lab';
import { formatCredits, type PlatformJob, type PlatformQuote } from '../../shared/commercial-contract';
import { Button, Dialog } from '../../ui';
import { useCommercialSnapshot, notifyCommercialChanged } from '../account/useCommercialSnapshot';
import { toLocalAssetUrl } from '../tasks/task-formatters';
import './platform-music.css';

export function PlatformMusicControls({ api, input, invalid, onUseInMv, onSubmitted, outputHost }: {
  api: StoryDreamApi; input: MusicGenerateInput | null; invalid: boolean;
  onUseInMv: (song: { title: string; lyrics: string; audioPath: string }) => void;
  onSubmitted?: () => void; outputHost?: HTMLElement | null;
}) {
  const { snapshot } = useCommercialSnapshot(api);
  const profile = snapshot?.profiles.profiles.find(item => item.id === snapshot.profiles.active.music);
  const model = snapshot?.catalog.find(item => item.id === profile?.modelId);
  const [pending, setPending] = useState<{ quote: PlatformQuote; operationId: string; userId: string; inputKey: string; modelId: string; attempted: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [jobs, setJobs] = useState<PlatformJob[]>([]);
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const lock = useRef(false); const mounted = useRef(true); const revision = useRef(0);
  const currentUser = useRef(snapshot?.user?.id); currentUser.current = snapshot?.user?.id;
  const inputKey = JSON.stringify(input);
  const currentInputKey = useRef(inputKey); currentInputKey.current = inputKey;
  const currentModelId = useRef(model?.id); currentModelId.current = model?.id;
  const owner = snapshot?.user?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++; }; }, []);
  useEffect(() => { setPending(null); setJobs([]); setDownloads({}); setError(''); revision.current++; }, [owner]);
  useEffect(() => { if (pending && !pending.attempted && (pending.inputKey !== inputKey || pending.modelId !== model?.id)) setPending(null); }, [inputKey, model?.id, pending]);
  async function load() {
    if (!owner) return;
    const n = ++revision.current;
    try { const values = await api.commercial.listJobs(); if (mounted.current && currentUser.current === owner && n === revision.current) setJobs(values.filter(job => snapshot?.catalog.some(item => item.id === job.modelId && item.capability === 'music'))); }
    catch (cause) { if (mounted.current && currentUser.current === owner && n === revision.current) setError(cause instanceof Error ? cause.message : '任务读取失败。'); }
  }
  useEffect(() => { void load(); }, [owner]);
  useEffect(() => { if (!jobs.some(job => !['succeeded_settled', 'failed_released', 'cancelled_released'].includes(job.state))) return; const timer = setTimeout(() => { void load(); notifyCommercialChanged(api); }, 6000); return () => clearTimeout(timer); }, [jobs]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (cause) { if (mounted.current && currentUser.current === owner) setError(cause instanceof Error ? cause.message : '请求失败。'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function prepare() {
    if (!input || !model || !owner) return;
    const { model: _upstreamModel, ...params } = input;
    await run(async () => {
      const quote = await api.commercial.quote({ modelId: model.id, operation: model.operation, params });
      if (currentUser.current === owner) setPending({ quote, userId: owner, modelId: model.id, operationId: crypto.randomUUID(), inputKey, attempted: false });
    });
  }
  async function submit() {
    if (!pending || pending.userId !== owner) return;
    // Preserve the same operation key after a lost response; never create an automatic paid retry.
    const request = pending; setPending({ ...pending, attempted: true });
    await run(async () => {
      await api.commercial.submit({ quoteId: request.quote.id, operationId: request.operationId });
      if (currentUser.current !== owner) return;
      if (request.inputKey === currentInputKey.current && request.modelId === currentModelId.current) onSubmitted?.();
      setPending(null); await load(); notifyCommercialChanged(api);
    });
  }
  const labels: Record<PlatformJob['state'], string> = { reserved: '积分已预留', submitting: '正在提交', submission_unknown: '正在核对原请求', running: '生成中', awaiting_delivery: '正在保存作品', succeeded_settled: '已完成', failed_released: '失败 · 已释放积分', cancelled_released: '已取消 · 已释放积分' };
  const results = <div className="platform-music-jobs">{jobs.length === 0 && <p className="commercial-muted">还没有平台音乐作品。填写创作内容并确认报价后，任务和候选音频会显示在这里。</p>}{jobs.map(job => <article key={job.id}><strong>{labels[job.state]}</strong><small>预留 {formatCredits(job.reservedUnits)} · 已结算 {formatCredits(job.settledUnits)} 积分</small>{job.artifacts.filter(a => a.mime.startsWith('audio/')).map(artifact => <div key={artifact.id}><span>{artifact.name}</span><Button density="compact" disabled={busy} icon={<Download size={14} />} onClick={() => void run(async () => { const result = await api.commercial.downloadArtifact(artifact.id); if (currentUser.current === owner) setDownloads(previous => ({ ...previous, [artifact.id]: result.path })); })}>{downloads[artifact.id] ? '重新下载' : '下载音频'}</Button>{downloads[artifact.id] && <><audio controls preload="metadata" src={toLocalAssetUrl(downloads[artifact.id])} /><Button density="compact" onClick={() => onUseInMv({ title: artifact.name, lyrics: '', audioPath: downloads[artifact.id] })}>用于音乐 MV</Button></>}</div>)}</article>)}</div>;
  return <section className="platform-music" aria-label="平台音乐创作">
    <div className="platform-music-heading"><div><strong>{model?.name || '平台音乐模型'}</strong><p>由账号积分计费 · 先确认报价再提交</p></div><Button density="compact" icon={<RefreshCw size={14} />} disabled={busy || !owner} onClick={() => void load()}>刷新</Button></div>
    <Button variant="primary" icon={<AudioLines size={16} />} disabled={busy || invalid || !owner || model?.status !== 'available' || snapshot?.license?.status !== 'active'} onClick={() => void prepare()}>{busy ? '正在处理…' : '获取平台生成报价'}</Button>
    <p>{!owner ? '请先登录账号。' : snapshot?.license?.status !== 'active' ? '请先在授权页面激活软件。' : model?.status !== 'available' ? '该平台模型尚未配置或已停用。' : '候选数量按服务结果返回；下载同一作品不会再次扣积分。'}</p>
    {error && <p role="alert" className="platform-music-error">{error}</p>}
    {outputHost ? createPortal(results, outputHost) : results}
    <Dialog open={Boolean(pending)} title="确认平台音乐费用" onOpenChange={open => { if (!open && !busy) setPending(null); }} actions={<><Button disabled={busy} onClick={() => setPending(null)}>关闭</Button><Button variant="primary" disabled={busy || !pending || !snapshot?.wallet || BigInt(snapshot.wallet.availableUnits) < BigInt(pending.quote.reservedUnits) && !pending.attempted} onClick={() => void submit()}>{pending?.attempted ? '核对并重试同一提交' : '确认生成并预留积分'}</Button></>}>
      <p>{pending?.quote.description}</p><p>最多扣费：{pending ? formatCredits(pending.quote.reservedUnits) : '—'} 积分。当前可用：{snapshot?.wallet ? formatCredits(snapshot.wallet.availableUnits) : '—'} 积分。</p><p>明确失败会释放预留；提交结果未知时查询原请求。充值后请重新确认。</p>{pending?.attempted && <p>如果刚才的提交已经受理，重复确认将返回原任务，不会创建另一笔收费任务。</p>}{error && <p role="alert">{error}</p>}
    </Dialog>
  </section>;
}
