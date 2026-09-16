import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { PlatformUpdateState } from '../../shared/commercial-contract';
import { Button, SelectField } from '../../ui';
import { CommercialNotice, formatCommercialDate } from '../account/commercial-ui';

export function PlatformUpdatesPanel({ api }: { api: StoryDreamApi }) {
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable');
  const [state, setState] = useState<PlatformUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const request = useRef(0);
  const locked = useRef(false);
  async function run(operation: () => Promise<PlatformUpdateState>) {
    if (locked.current) return;
    locked.current = true;
    const revision = ++request.current;
    setBusy(true); setError('');
    try { const next = await operation(); if (mounted.current && revision === request.current) setState(next); }
    catch (failure) { if (mounted.current && revision === request.current) { setState(null); setError(failure instanceof Error ? failure.message : '更新服务暂时不可用。'); } }
    finally { locked.current = false; if (mounted.current && revision === request.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void run(() => api.commercial.checkUpdate('stable')); return () => { mounted.current = false; }; }, [api]);
  return <section className="commercial-page" aria-label="远程更新"><header className="commercial-heading"><div><h2>软件更新</h2><p>从发布渠道获取经过签名和完整性验证的更新包。</p></div><ShieldCheck size={22} /></header>
    <div className="commercial-form"><SelectField label="更新渠道" value={channel} disabled={busy} options={[{ value: 'stable', label: '稳定版 · 推荐' }, { value: 'beta', label: '测试版 · 提前体验' }]} onChange={(_, data) => { setChannel(data.value as 'stable' | 'beta'); setState(null); setError(''); }} /><div className="commercial-actions"><Button disabled={busy} icon={<RefreshCw size={15} />} onClick={() => void run(() => api.commercial.checkUpdate(channel))}>{busy ? '正在处理…' : '检查更新'}</Button></div></div>
    {error && <CommercialNotice error>{error}</CommercialNotice>}
    {state && <><CommercialNotice error={state.status === 'error'}>{state.message}</CommercialNotice><section className="commercial-section"><h3>版本与任务状态</h3><dl className="commercial-details"><div><dt>当前版本</dt><dd>{state.currentVersion}</dd></div><div><dt>正在运行的任务</dt><dd>{state.activeTasks}</dd></div><div><dt>更新状态</dt><dd>{{ unconfigured: '发布服务尚未配置', current: '已是最新版本', available: '发现可用更新', downloaded: '更新包已验证', blocked: '等待当前任务结束', error: '验证或下载失败' }[state.status]}</dd></div>{state.manifest && <><div><dt>可用版本</dt><dd>{state.manifest.version} · {state.manifest.channel === 'stable' ? '稳定版' : '测试版'}</dd></div><div><dt>发布时间</dt><dd>{formatCommercialDate(state.manifest.publishedAt)}</dd></div><div><dt>下载大小</dt><dd>{(state.manifest.size / 1024 / 1024).toFixed(1)} MB</dd></div></>}</dl></section>
      {state.manifest && <section className="commercial-section"><h3>更新说明</h3><pre className="commercial-update-notes">{state.manifest.releaseNotes}</pre><div className="commercial-actions"><Button variant="primary" disabled={busy || !['available', 'blocked'].includes(state.status) || state.activeTasks > 0} icon={<Download size={15} />} onClick={() => void run(() => api.commercial.downloadUpdate())}>下载并验证更新包</Button><Button disabled={busy || state.status !== 'downloaded' || state.activeTasks > 0} icon={<FolderOpen size={15} />} onClick={() => void run(() => api.commercial.openUpdateFolder())}>打开更新包文件夹</Button></div>{state.activeTasks > 0 && <CommercialNotice>生成、渲染或导出任务结束后，请重新检查更新再进行升级。</CommercialNotice>}{state.downloadedPath && <p className="commercial-muted">已验证文件：{state.downloadedPath}</p>}</section>}
    </>}
    <p className="commercial-muted">当前提供完整安装包升级。下载验证完成后，保存作品并关闭软件，再按发布说明安装。缺少有效发布签名或下载地址不受信任时，软件会停止更新。</p>
  </section>;
}
