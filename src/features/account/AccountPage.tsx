import { useEffect, useState } from 'react';
import { Download, LogOut, RefreshCw, Save, ShieldCheck, Wallet } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { formatCredits, type AuthChallenge, type CommercialSnapshot } from '../../shared/commercial-contract';
import { Button, Dialog, Tabs, TextField } from '../../ui';
import { CommercialBoundary, CommercialNotice, formatCommercialDate } from './commercial-ui';
import { notifyCommercialChanged, useCommercialSnapshot } from './useCommercialSnapshot';
import { useCommercialAction } from './useCommercialAction';
import { getCommercialStore } from './commercial-store';
import { WalletPanel } from './WalletPanel';
import { PlatformJobsPanel } from './PlatformJobsPanel';

export function AccountPage({ api }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const view = useCommercialSnapshot(api);
  return <section className="commercial-page" aria-label="账号中心">
    <header className="commercial-heading"><div><h2>账号中心</h2><p>同步账号、积分钱包和平台生成记录。</p></div><Button density="compact" disabled={view.loading} icon={<RefreshCw size={15} />} onClick={() => void view.refresh()}>刷新状态</Button></header>
    <CommercialBoundary {...view} requireLogin={false} onRetry={() => void view.refresh()}>
      {view.snapshot?.authenticated && view.snapshot.user ? <SignedInAccount key={view.snapshot.user.id} api={api} snapshot={view.snapshot} /> : view.snapshot?.configured ? <PhoneLogin api={api} /> : null}
    </CommercialBoundary>
  </section>;
}

function PhoneLogin({ api }: { api: StoryDreamApi }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const action = useCommercialAction(api);
  const countdown = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);
  function send() {
    void action.run(() => api.commercial.sendCode(phone.trim()), (result) => { setChallenge(result); setCode(''); setRetryAt(Date.now() + result.retryAfter * 1000); setNow(Date.now()); }, '验证码已发送，请查看手机。');
  }
  return <div className="commercial-split"><form className="commercial-form commercial-section" onSubmit={(event) => { event.preventDefault(); if (challenge) void action.run(() => api.commercial.login({ challengeId: challenge.challengeId, code: code.trim() }), (snapshot) => notifyCommercialChanged(api, snapshot)); }}>
    <h3>手机号登录</h3><p className="commercial-muted">首次登录会创建账号，并绑定当前设备。验证码以服务端验证结果为准。</p>
    <TextField label="手机号" type="tel" autoComplete="tel" value={phone} disabled={action.busy} onChange={(_, data) => { setPhone(data.value); setChallenge(null); setCode(''); }} />
    <div className="commercial-actions"><Button type="button" disabled={action.busy || countdown > 0 || !/^\+?[0-9]{8,15}$/.test(phone.trim())} onClick={send}>{countdown > 0 ? `${countdown} 秒后重新发送` : '发送验证码'}</Button></div>
    <TextField label="验证码" autoComplete="one-time-code" inputMode="numeric" value={code} disabled={!challenge || action.busy} onChange={(_, data) => setCode(data.value)} hint={challenge ? `有效期至 ${formatCommercialDate(challenge.expiresAt)}` : '先发送验证码'} />
    {challenge?.developmentCode && <CommercialNotice>仅供本地开发测试的验证码：<strong>{challenge.developmentCode}</strong>。生产服务不会返回此字段。</CommercialNotice>}
    <div><Button variant="primary" type="submit" disabled={action.busy || !challenge || !code.trim()}>登录并绑定设备</Button></div>
    {action.error && <CommercialNotice error>{action.error}</CommercialNotice>}{action.message && <p role="status" className="commercial-muted">{action.message}</p>}
  </form><section className="commercial-section"><h3>账号、授权与积分</h3><dl className="commercial-details"><div><dt>账号</dt><dd>识别本人和已绑定设备</dd></div><div><dt>软件授权</dt><dd>决定可用功能与有效期限</dd></div><div><dt>积分钱包</dt><dd>用于平台模型生成</dd></div></dl><p className="commercial-muted">充值积分与兑换软件授权分别管理。本机自有 API 的费用由对应服务商收取。</p></section></div>;
}

function SignedInAccount({ api, snapshot }: { api: StoryDreamApi; snapshot: CommercialSnapshot }) {
  const [tab, setTab] = useState('profile');
  const [name, setName] = useState(snapshot.user?.displayName || '');
  const [logoutOpen, setLogoutOpen] = useState(false);
  const action = useCommercialAction(api);
  useEffect(() => setName(snapshot.user?.displayName || ''), [snapshot.user?.displayName]);
  async function logout() {
    const store = getCommercialStore(api.commercial);
    store.clear();
    try { notifyCommercialChanged(api, await api.commercial.logout()); }
    catch { await store.refresh(true); }
  }
  return <>
    <Tabs className="commercial-tabs" label="账号中心内容" value={tab} onChange={setTab} items={[{ value: 'profile', label: '账号资料', icon: <ShieldCheck size={16} /> }, { value: 'wallet', label: '积分钱包', icon: <Wallet size={16} /> }, { value: 'jobs', label: '平台任务', icon: <Download size={16} /> }]} />
    {tab === 'profile' && <div className="commercial-split"><form className="commercial-form commercial-section" onSubmit={(event) => { event.preventDefault(); void action.run(() => api.commercial.updateProfile(name.trim()), (next) => notifyCommercialChanged(api, next), '账号资料已保存。'); }}><h3>个人资料</h3><TextField label="显示名称" value={name} maxLength={100} onChange={(_, data) => setName(data.value)} disabled={action.busy} /><dl className="commercial-details"><div><dt>手机号</dt><dd>{snapshot.user?.phone}</dd></div><div><dt>账号 ID</dt><dd>{snapshot.user?.id}</dd></div></dl><div className="commercial-actions"><Button type="submit" variant="primary" icon={<Save size={15} />} disabled={action.busy || !name.trim() || name === snapshot.user?.displayName}>保存资料</Button><Button type="button" icon={<LogOut size={15} />} disabled={action.busy} onClick={() => setLogoutOpen(true)}>退出登录</Button></div>{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}{action.message && <p role="status" className="commercial-muted">{action.message}</p>}</form><section className="commercial-section"><h3>当前权益</h3><dl className="commercial-details"><div><dt>授权计划</dt><dd>{snapshot.license?.plan || '尚未激活'}</dd></div><div><dt>到期时间</dt><dd>{snapshot.license?.status === 'active' && !snapshot.license.expiresAt ? '长期有效' : formatCommercialDate(snapshot.license?.expiresAt)}</dd></div><div><dt>可用积分</dt><dd>{snapshot.wallet ? formatCredits(snapshot.wallet.availableUnits) : '—'}</dd></div><div><dt>绑定设备</dt><dd>{snapshot.devices.length} / {snapshot.license?.deviceLimit ?? '—'}</dd></div></dl><p className="commercial-muted">前往“软件激活”兑换授权、查看权益和管理设备。余额及授权由服务端同步。</p></section></div>}
    {tab === 'wallet' && <WalletPanel api={api} snapshot={snapshot} />}
    {tab === 'jobs' && <PlatformJobsPanel api={api} userId={snapshot.user!.id} />}
    <Dialog open={logoutOpen} onOpenChange={setLogoutOpen} title="退出当前账号？" actions={<><Button onClick={() => setLogoutOpen(false)}>保留登录</Button><Button variant="danger" onClick={() => void logout()}>退出登录</Button></>}><p>已提交的平台任务继续归当前账号处理和结算，重新登录此账号后可查看。退出会清除本机登录会话；已保存的作品和自有 API 配置保留。</p></Dialog>
  </>;
}
