import { useState } from 'react';
import { KeyRound, Laptop, RefreshCw, ShieldCheck } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { CommercialSnapshot, PlatformDevice } from '../../shared/commercial-contract';
import { Button, Dialog, TextField } from '../../ui';
import { CommercialBoundary, CommercialNotice, formatCommercialDate } from './commercial-ui';
import { notifyCommercialChanged, useCommercialSnapshot } from './useCommercialSnapshot';
import { useCommercialAction } from './useCommercialAction';

export function ActivationPage({ api }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const view = useCommercialSnapshot(api);
  return <section className="commercial-page" aria-label="软件授权与设备"><header className="commercial-heading"><div><h2>软件授权与设备</h2><p>兑换授权并管理绑定设备；平台积分单独计费。</p></div><Button density="compact" disabled={view.loading} icon={<RefreshCw size={15} />} onClick={() => void view.refresh()}>同步授权</Button></header><CommercialBoundary {...view} onRetry={() => void view.refresh()}>{view.snapshot?.authenticated && <LicenseDetails key={view.snapshot.user?.id} api={api} snapshot={view.snapshot} />}</CommercialBoundary></section>;
}

function LicenseDetails({ api, snapshot }: { api: StoryDreamApi; snapshot: CommercialSnapshot }) {
  const [code, setCode] = useState('');
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [device, setDevice] = useState<PlatformDevice | null>(null);
  const action = useCommercialAction(api);
  const license = snapshot.license;
  return <>
    <div className="commercial-split"><section className="commercial-section"><div className="commercial-section-heading"><h3><ShieldCheck size={17} /> 当前软件授权</h3><span className={`commercial-status${license?.status === 'active' ? ' commercial-status--active' : ' commercial-status--warning'}`}>{license?.status === 'active' ? '已激活' : license?.status === 'expired' ? '已到期' : '未激活'}</span></div><dl className="commercial-details"><div><dt>授权计划</dt><dd>{license?.plan || '尚未兑换授权'}</dd></div><div><dt>有效期至</dt><dd>{license?.status === 'active' && !license.expiresAt ? '长期有效' : formatCommercialDate(license?.expiresAt)}</dd></div><div><dt>可绑定设备</dt><dd>{license?.deviceLimit ?? '—'}</dd></div><div><dt>可用权益</dt><dd>{license?.features.length ? license.features.join('、') : '暂无软件权益'}</dd></div></dl><p className="commercial-muted">授权到期后已有本地作品仍可查看和导出。平台模型生成需要在线验证账号、权限和积分。</p></section>
    <form className="commercial-form commercial-section" onSubmit={(event) => { event.preventDefault(); setRedeemOpen(true); }}><h3>兑换激活码</h3><TextField label="激活码" value={code} autoComplete="off" maxLength={256} disabled={action.busy} onChange={(_, data) => setCode(data.value)} /><p className="commercial-muted">激活码将兑换到当前账号。计划、期限和可用设备数由该激活码对应商品决定。</p><div><Button type="submit" variant="primary" icon={<KeyRound size={15} />} disabled={action.busy || !code.trim()}>兑换软件授权</Button></div></form></div>
    {action.error && <CommercialNotice error>{action.error}</CommercialNotice>}{action.message && <p role="status" className="commercial-muted">{action.message}</p>}
    <section className="commercial-section"><div className="commercial-section-heading"><div><h3>绑定设备</h3><p>已绑定 {snapshot.devices.length} 台，可绑定上限 {license?.deviceLimit ?? '—'} 台。</p></div><Laptop size={20} /></div><div className="commercial-list">{snapshot.devices.length ? snapshot.devices.map((item) => <div className="commercial-list-row" key={item.id}><div><strong>{item.name} {item.current && <span className="commercial-status commercial-status--active">当前设备</span>}</strong><p>最近在线：{formatCommercialDate(item.lastSeenAt)}</p><p>{item.id}</p></div><Button disabled={action.busy} density="compact" onClick={() => setDevice(item)}>解绑设备</Button></div>) : <p className="commercial-muted">当前账号暂无已绑定设备。</p>}</div></section>
    <Dialog open={redeemOpen} onOpenChange={(open) => { if (!action.busy) setRedeemOpen(open); }} title="确认兑换到当前账号" actions={<><Button disabled={action.busy} onClick={() => setRedeemOpen(false)}>取消</Button><Button variant="primary" disabled={action.busy || !code.trim()} onClick={() => void action.run(() => api.commercial.redeem(code.trim()), (next) => { setCode(''); setRedeemOpen(false); notifyCommercialChanged(api, next); }, '授权兑换成功，权益已同步。')}>确认兑换</Button></>}><p>此激活码将绑定账号 {snapshot.user?.phone}。兑换完成后请核对授权计划、到期时间和可用设备数。</p>{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}</Dialog>
    <Dialog open={Boolean(device)} onOpenChange={(open) => { if (!action.busy && !open) setDevice(null); }} title={device?.current ? '解绑当前设备？' : '解绑此设备？'} actions={<><Button disabled={action.busy} onClick={() => setDevice(null)}>保留设备</Button><Button variant="danger" disabled={action.busy || !device} onClick={() => { if (device) void action.run(() => api.commercial.unbindDevice(device.id), (next) => { setDevice(null); notifyCommercialChanged(api, next); }, '设备已解绑。'); }}>确认解绑</Button></>}><p>解绑 {device?.name} 后，该设备登录会话和新的云请求权限将被撤销。已提交的任务继续由原账号结算。本地作品保留。{device?.current ? '本机会退出登录，需要重新验证手机号。' : ''}</p>{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}</Dialog>
  </>;
}
