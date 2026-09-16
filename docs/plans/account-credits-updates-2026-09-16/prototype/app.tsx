import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronRight, CircleHelp, Cloud, Coins, CreditCard, Download, FileClock, Fingerprint, KeyRound, LayoutDashboard, Monitor, Moon, RefreshCw, Settings2, ShieldCheck, Sparkles, Sun, UserRound, Wallet } from 'lucide-react';
import { Button, IconButton, SelectField, StoryDreamProvider, Tabs, TextField } from '../../../../src/ui';
import '../../../../src/styles.css';
import './prototype.css';

type Page = 'account' | 'license' | 'wallet' | 'models' | 'updates' | 'admin';
type Job = 'running' | 'complete' | 'failed' | null;
type Entry = { id: number; title: string; detail: string; change: number; held: number; kind: string };
type Order = { id: string; amount: number; paid: boolean };
const pages = [{ id: 'account', label: '账号总览', icon: UserRound }, { id: 'license', label: '授权与设备', icon: ShieldCheck }, { id: 'wallet', label: '积分钱包', icon: Wallet }, { id: 'models', label: '平台模型', icon: Sparkles }, { id: 'updates', label: '远程更新', icon: Download }, { id: 'admin', label: '运营后台', icon: LayoutDashboard }] as const;
const models = [{ name: '文本创作', model: '平台文本 · 标准', price: '按输入 / 输出 token 报价' }, { name: '绘图', model: 'GPT Image 2', price: '120 积分 / 请求起' }, { name: '视频生成', model: 'MiniMax H3', price: '80 积分 / 秒起' }, { name: '音乐创作', model: 'Suno V6', price: '100 积分 / 请求' }, { name: '语音合成', model: '标准中文配音', price: '10 积分 / 千字符起' }, { name: '语音识别', model: 'Whisper', price: '5 积分 / 分钟起' }, { name: '视觉分析', model: '平台视觉 · 标准', price: '按输入 / 输出 token 报价' }];
const initialLedger: Entry[] = [{ id: 2, title: 'Suno V6 · 音乐生成', detail: 'JOB-DEMO-001 · 1 次请求 / 通常两首候选', change: 0, held: 100, kind: '预留' }, { id: 1, title: '历史充值与使用', detail: '原型初始余额 · 示例期初记录', change: 2700, held: 0, kind: '期初' }];
const format = (value: number) => value.toLocaleString('zh-CN');
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) { return <section className="proto-section"><div className="section-heading"><h2>{title}</h2>{note && <span>{note}</span>}</div>{children}</section>; }
function Status({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`status ${tone}`}>{children}</span>; }

function Prototype() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [page, setPage] = useState<Page>('account');
  const [showTools, setShowTools] = useState(false);
  const [notice, setNotice] = useState('');
  const [offline, setOffline] = useState(false);
  const [total, setTotal] = useState(2700);
  const [held, setHeld] = useState(100);
  const [job, setJob] = useState<Job>('running');
  const [jobId, setJobId] = useState(1);
  const [jobCharge, setJobCharge] = useState(100);
  const [ledger, setLedger] = useState<Entry[]>(initialLedger);
  const [filter, setFilter] = useState('all');
  const [plan, setPlan] = useState(30);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const [devices, setDevices] = useState(['创作工作站 · Windows 11', '随行笔记本 · macOS']);
  const [deviceConfirm, setDeviceConfirm] = useState(false);
  const [code, setCode] = useState('DEMO-YEAR-2026');
  const [redeemPreview, setRedeemPreview] = useState(false);
  const [redeemed, setRedeemed] = useState(false);
  const [nickname, setNickname] = useState('林间工作室');
  const [savedName, setSavedName] = useState(nickname);
  const [sources, setSources] = useState(models.map(() => 'platform'));
  const [draftSources, setDraftSources] = useState(models.map(() => 'platform'));
  const [update, setUpdate] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [backgroundTask, setBackgroundTask] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('0.9.6');
  const [channel, setChannel] = useState('stable');
  const [adminTab, setAdminTab] = useState('users');
  const [cloudPaused, setCloudPaused] = useState(false);
  const [pricePublished, setPricePublished] = useState(false);
  const [releasePublished, setReleasePublished] = useState(false);
  const available = total - held;
  const nextCharge = sources[3] === 'platform' ? 100 : 0;
  const activeTasks = Number(job === 'running') + Number(backgroundTask);
  const currentOrder = orders.find(order => order.id === pendingOrder);
  const notify = (text: string) => setNotice(text);
  const record = (entry: Omit<Entry, 'id'>) => setLedger(previous => [{ ...entry, id: Date.now() }, ...previous]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (update !== 'downloading' || offline) return;
    const timer = window.setInterval(() => setProgress(previous => Math.min(100, previous + 20)), 180);
    return () => window.clearInterval(timer);
  }, [update, offline]);
  useEffect(() => { if (progress === 100 && update === 'downloading') setUpdate('ready'); }, [progress, update]);
  useEffect(() => { if (update === 'waiting' && activeTasks === 0) { setUpdate('ready'); notify('所有任务已结束，可以确认演示安装。'); } }, [activeTasks, update]);
  function settle(success: boolean) {
    if (job !== 'running') return;
    setHeld(value => value - jobCharge); if (success) setTotal(value => value - jobCharge);
    setJob(success ? 'complete' : 'failed');
    record({ title: 'Suno V6 · 音乐生成', detail: `JOB-DEMO-${String(jobId).padStart(3, '0')} · ${jobCharge === 0 ? '自有 API，费用由你的服务商收取' : success ? '返回两首候选，仅结算一笔请求' : '供应商明确失败，全部释放'}`, change: success ? -jobCharge : 0, held: -jobCharge, kind: jobCharge === 0 ? '自有 API' : success ? '结算' : '释放' });
    notify(jobCharge === 0 ? '自有 API 演示任务已结束，平台积分未变化。' : success ? '演示生成完成：实扣 100 积分，预留已解除。' : '演示任务失败：100 预留积分已全部退回可用余额。');
  }
  function reserve() {
    if (offline || (cloudPaused && nextCharge > 0) || available < nextCharge || job === 'running') return;
    setHeld(value => value + nextCharge); setJobCharge(nextCharge); setJob('running'); setJobId(value => value + 1);
    record({ title: 'Suno V6 · 音乐生成', detail: `JOB-DEMO-${String(jobId + 1).padStart(3, '0')} · ${nextCharge ? '报价最多 100 积分' : '自有 API，不扣平台积分'}`, change: 0, held: nextCharge, kind: nextCharge ? '预留' : '自有 API' });
    notify(nextCharge ? '已预留 100 积分，演示任务处理中。' : '自有 API 演示任务已开始，平台积分未变化。');
  }
  function createOrder() {
    const id = `PAY-DEMO-${String(orders.length + 1).padStart(3, '0')}`;
    setOrders(previous => [...previous, { id, amount: plan, paid: false }]); setPendingOrder(id); notify('演示订单已创建，没有发起实际支付。');
  }
  function pay() {
    if (!currentOrder || currentOrder.paid || offline) return;
    setOrders(previous => previous.map(order => order.id === currentOrder.id ? { ...order, paid: true } : order));
    setTotal(value => value + currentOrder.amount * 100);
    record({ title: `充值 ¥${currentOrder.amount}`, detail: `${currentOrder.id} · 模拟服务端确认到账`, change: currentOrder.amount * 100, held: 0, kind: '充值' });
    notify(`演示到账 ${format(currentOrder.amount * 100)} 积分。原生成任务不会自动重试。`);
  }
  function adjustScenario() {
    const difference = 50 - available; setTotal(held + 50);
    record({ title: '余额不足情景', detail: '仅调整原型演示账户，不影响真实资产', change: difference, held: 0, kind: '情景调整' });
    notify('已切换至可用 50 积分；现有任务预留不受影响。');
  }
  function reset() { setTotal(2700); setHeld(100); setJob('running'); setJobId(1); setJobCharge(100); setLedger(initialLedger); setOrders([]); setPendingOrder(null); setOffline(false); setBackgroundTask(false); setCloudPaused(false); setUpdate('idle'); setProgress(0); setCurrentVersion('0.9.6'); setSources(models.map(() => 'platform')); setDraftSources(models.map(() => 'platform')); setDevices(['创作工作站 · Windows 11', '随行笔记本 · macOS']); setRedeemed(false); setRedeemPreview(false); setDeviceConfirm(false); setPricePublished(false); setReleasePublished(false); notify('演示数据已恢复。'); }

  return <StoryDreamProvider theme={theme}><div className="commercial-prototype">
    <header className="proto-top"><div className="brand-mark"><AudioLines size={20} /><strong>StoryDream</strong><span>账号与服务</span></div><div className="demo-label">交互原型 · 演示数据，不会扣费</div><Button className="tools-toggle" variant="subtle" icon={<Settings2 size={16} />} aria-expanded={showTools} onClick={() => setShowTools(!showTools)}>演示情景</Button><IconButton label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} /></header>
    <div className="proto-shell"><aside className="proto-nav"><div className="workspace-label">个人工作空间</div><nav aria-label="账号服务导航">{pages.map(({ id, label, icon: Icon }) => <Button key={id} variant="subtle" className={page === id ? 'proto-nav-item active' : 'proto-nav-item'} aria-current={page === id ? 'page' : undefined} icon={<Icon size={17} />} onClick={() => { setPage(id); setNotice(''); }}>{label}{page === id && <ChevronRight size={14} />}</Button>)}</nav><div className="nav-bottom"><ShieldCheck size={17} /><div><strong>个人正式版</strong><span>授权有效 · 2 台设备</span></div></div><div className="nav-person"><div className="avatar">林</div><div><strong>{savedName}</strong><span>138 **** 0628</span></div></div></aside>
    <main className="proto-main"><div className="page-heading"><div><div className="eyebrow">工作空间 / 账号与服务</div><h1>{pages.find(item => item.id === page)?.label}</h1><p>{({ account: '授权、资产与模型服务，统一归属于你的账号。', license: '在你的设备间继续创作，保留每一份本地作品。', wallet: '先展示报价，再预留积分；完成后按实际规则结算。', models: '七类模型统一管理，每次切换都由你确认。', updates: '后台下载，在所有创作任务结束后再安装。', admin: '运营工作台预览 · 独立管理员身份与权限。' })[page]}</p></div><Status tone={offline ? 'warn' : 'ok'}>{offline ? '离线演示 · 本地作品可用' : '服务正常'}</Status></div>
    {notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}
    {page === 'account' && <>
      <div className="account-hero"><div className="avatar large">林</div><div><h2>{savedName}</h2><p>创作者账号 <span className="mono">SD-DEMO-0628</span></p><Status tone="ok">手机已验证</Status></div><div className="hero-end"><span>加入 StoryDream</span><strong>2026 年 9 月 16 日</strong></div></div>
      <div className="summary-grid"><div><ShieldCheck /><span>软件授权</span><strong>个人正式版</strong><p>有效至 {redeemed ? '2028' : '2027'} 年 9 月 16 日</p><Button variant="subtle" onClick={() => setPage('license')}>查看授权 <ArrowRight size={14} /></Button></div><div><Coins /><span>可用积分</span><strong>{format(available)} <small>积分</small></strong><p>使用中预留 {format(held)} 积分</p><Button variant="subtle" onClick={() => setPage('wallet')}>充值与流水 <ArrowRight size={14} /></Button></div><div><Monitor /><span>已绑定设备</span><strong>{devices.length} <small>/ 2 台</small></strong><p>当前设备：创作工作站</p><Button variant="subtle" onClick={() => setPage('license')}>管理设备 <ArrowRight size={14} /></Button></div></div>
      <Section title="账号资料" note="账号与授权独立于本地作品"><div className="profile-form"><TextField label="显示名称" value={nickname} onChange={(_, data) => setNickname(data.value)} /><TextField label="登录手机号" value="138 **** 0628" readOnly /><Button disabled={!nickname.trim() || nickname === savedName} onClick={() => { setSavedName(nickname.trim()); notify('演示账号资料已保存。'); }}>保存资料</Button></div></Section>
      <Section title="使用方式"><div className="explain-grid"><div><Cloud /><h3>平台模型</h3><p>无需配置密钥。开始前明确展示报价，从账号积分钱包结算。</p></div><div><KeyRound /><h3>自有 API</h3><p>继续使用现有多套模型配置，费用由你的 API 服务商收取。</p></div><div><FileClock /><h3>本地作品始终保留</h3><p>离线或授权到期后，仍可查看、播放、备份和导出已有素材。</p></div></div></Section>
    </>}
    {page === 'license' && <>
      <div className="license-strip"><ShieldCheck size={32} /><div><h2>个人正式版</h2><p>到期日期 {redeemed ? '2028' : '2027'}-09-16 · 最多绑定 2 台设备</p></div><Status tone="ok">授权有效</Status></div>
      <Section title="兑换激活码" note="授权与积分分别列明"><div className="inline-form"><TextField label="激活码（演示码）" value={code} onChange={(_, data) => { setCode(data.value); setRedeemPreview(false); }} hint="原型可用：DEMO-YEAR-2026" /><Button disabled={offline || redeemed || !code.trim()} onClick={() => code.trim() === 'DEMO-YEAR-2026' ? setRedeemPreview(true) : notify('未找到该演示码，请使用 DEMO-YEAR-2026。')}>{redeemed ? '已兑换' : '预览权益'}</Button></div>{redeemPreview && !redeemed && <div className="confirm-box"><div><strong>正式授权延长 1 年</strong><p>到期 2028-09-16 · 2 台设备 · 不附赠积分 · 此码仅可兑换一次</p></div><Button variant="primary" disabled={offline} onClick={() => { setRedeemed(true); setRedeemPreview(false); notify('演示兑换成功：授权已延长一年，积分钱包未变化。'); }}>确认演示兑换</Button></div>}</Section>
      <Section title="已绑定设备" note={`${devices.length} / 2 台`}><div className="device-list">{devices.map((device, index) => <div className="device-row" key={device}><Monitor size={24} /><div><strong>{device}</strong><p>{index === 0 ? '当前设备 · 刚刚在线' : '最近在线：今天 09:42'}</p></div>{index === 0 ? <Status>当前设备</Status> : <Button disabled={offline} onClick={() => setDeviceConfirm(true)}>解绑设备</Button>}</div>)}</div>{deviceConfirm && <div className="confirm-box"><div><strong>解绑随行笔记本？</strong><p>撤销这台设备的新云请求权限，已提交任务继续结算。</p></div><Button onClick={() => setDeviceConfirm(false)}>取消</Button><Button variant="danger" disabled={offline} onClick={() => { setDevices(value => value.slice(0, 1)); setDeviceConfirm(false); notify('演示设备已解绑，本地作品保持可访问。'); }}>确认解绑</Button></div>}{devices.length < 2 && <Button disabled={offline} onClick={() => { setDevices(value => [...value, '随行笔记本 · macOS']); notify('已模拟重新验证并绑定第二台设备。'); }}>模拟绑定第二台设备</Button>}</Section>
      <div className="info-strip"><Fingerprint size={18} /><p>离线授权宽限示例为 72 小时。云模型需要联网核验；本地作品可继续编辑与导出。</p></div>
    </>}
    {page === 'wallet' && <>
      <div className="wallet-head"><div><span>可用积分</span><strong data-testid="available">{format(available)}</strong><small>积分</small></div><div><span>使用中预留</span><strong data-testid="held">{format(held)}</strong><small>积分</small></div><div className="wallet-description"><ShieldCheck size={20} /><p>余额与任务状态同步<br />预留不等于已扣费</p></div></div>
      <Section title="充值积分" note="示例换算：¥1 = 100 积分"><div className="packages">{[30, 100, 300].map(amount => <Button className={`package ${plan === amount ? 'selected' : ''}`} key={amount} aria-pressed={plan === amount} onClick={() => setPlan(amount)}><span>¥{amount}</span><strong>{format(amount * 100)} <small>积分</small></strong><span>{plan === amount ? '已选择' : '选择套餐'}</span></Button>)}</div><div className="recharge-actions"><p>到账 {format(plan * 100)} 积分 · 不改变软件授权期限</p><Button icon={<CreditCard size={16} />} variant="primary" disabled={offline || !!(currentOrder && !currentOrder.paid)} onClick={createOrder}>模拟创建支付订单</Button></div>{currentOrder && <div className="confirm-box"><div><strong>{currentOrder.paid ? '已模拟到账' : '等待演示支付'} · ¥{currentOrder.amount}</strong><p>{currentOrder.id} · 无真实收银台，不会实际付款</p></div><Button disabled={currentOrder.paid || offline} onClick={pay}>{currentOrder.paid ? '该订单已到账' : '模拟到账'}</Button></div>}</Section>
      <Section title="生成报价与结算演示" note="Suno V6 · 普通生成"><div className="job-box"><div><h3>1 次请求，通常两首候选</h3><p>{(job === 'running' ? jobCharge : nextCharge) ? <>本次预留 / 最多扣费 <strong>100 积分</strong> · 下载与选择候选不重复扣费</> : <>自有 API · 费用由你的 API 服务商收取，<strong>不扣平台积分</strong></>}</p><Status tone={job === 'running' ? 'warn' : job === 'failed' ? '' : 'ok'}>{job === 'running' ? (jobCharge ? '任务处理中 · 已预留 100' : '自有 API 任务处理中') : job === 'complete' ? ('已完成 · 实扣 ' + jobCharge) : job === 'failed' ? (jobCharge ? '明确失败 · 预留已释放' : '自有 API 任务失败') : '等待确认报价'}</Status></div><div className="job-actions">{job === 'running' ? <><Button variant="primary" onClick={() => settle(true)}>{jobCharge ? '模拟完成并扣费' : '模拟自有 API 完成'}</Button><Button onClick={() => settle(false)}>模拟明确失败</Button></> : <Button variant="primary" disabled={offline || (cloudPaused && nextCharge > 0) || available < nextCharge} onClick={reserve}>{nextCharge ? '确认并预留 100 积分' : '模拟使用自有 API'}</Button>}</div></div>{available < nextCharge && job !== 'running' && <p className="warning">还差 {100 - available} 积分。充值后需重新确认，不会自动生成。</p>}{offline && <p className="warning">当前离线，暂停新充值与新云调用；已经提交的任务仍可模拟服务端结算。</p>}{cloudPaused && nextCharge > 0 && <p className="warning">运营演示已暂停新云调用。</p>}</Section>
      <Section title="积分流水" note="历史记录只追加，不覆盖"><Tabs label="流水筛选" value={filter} onChange={setFilter} items={[{ value: 'all', label: '全部' }, { value: '充值', label: '充值' }, { value: 'generation', label: '生成与结算' }]} /><div className="table-wrap"><table><thead><tr><th>事项 / 关联记录</th><th>类型</th><th>余额变化</th><th>预留变化</th></tr></thead><tbody>{ledger.filter(entry => filter === 'all' || entry.kind === filter || (filter === 'generation' && ['预留', '结算', '释放'].includes(entry.kind))).map(entry => <tr key={entry.id}><td><strong>{entry.title}</strong><small>{entry.detail}</small></td><td><Status>{entry.kind}</Status></td><td className={entry.change > 0 ? 'positive' : ''}>{entry.change === 0 ? '—' : `${entry.change > 0 ? '+' : ''}${format(entry.change)}`}</td><td>{entry.held === 0 ? '—' : `${entry.held > 0 ? '+' : ''}${entry.held}`}</td></tr>)}</tbody></table>{ledger.filter(entry => filter === 'all' || entry.kind === filter || (filter === 'generation' && ['预留', '结算', '释放'].includes(entry.kind))).length === 0 && <p className="empty">还没有此类演示记录</p>}</div></Section>
    </>}
    {page === 'models' && <><div className="info-strip"><KeyRound size={18} /><p>平台积分与自有 API 明确分开。选择备用来源后，点击“启用”才生效；调用失败不会自动切换来源。</p></div><Section title="默认模型与计费来源" note="价格均为设计示例，正式价格以生成前报价为准"><div className="model-list">{models.map((model, index) => <div className="model-row" key={model.name}><div className="model-symbol"><Sparkles size={19} /></div><div className="model-title"><strong>{model.name}</strong><span>{model.model}</span><small>{model.price}</small></div><SelectField label={`${model.name}来源`} value={draftSources[index]} onChange={(_, data) => setDraftSources(value => value.map((source, at) => at === index ? data.value : source))} options={[{ value: 'platform', label: '平台模型 · 积分计费' }, { value: 'byok', label: '自有 API · 本机配置' }]} /><div className="model-state"><Status tone={sources[index] === 'platform' ? 'ok' : ''}>{sources[index] === 'platform' ? '平台已启用' : '自有 API 已启用'}</Status><Button disabled={draftSources[index] === sources[index]} onClick={() => { setSources(value => value.map((source, at) => at === index ? draftSources[index] : source)); notify(`${model.name}已切换：${draftSources[index] === 'platform' ? '新调用使用平台积分，提交前先报价。' : '新调用由你的 API 服务商收取费用，不扣平台积分。'}`); }}>启用此来源</Button></div></div>)}</div></Section><p className="muted">已有用户升级时保留原启用项。平台推荐更新不覆盖你固定的模型；服务商密钥仅由平台服务端保管。</p></>}
    {page === 'updates' && <><div className="version-hero"><div className="update-icon"><ArrowDownToLine size={35} /></div><div><h2>StoryDream {currentVersion}</h2><p>Windows · 便携版 · 完整包更新方案</p><Status tone="ok">当前演示版本</Status></div><Button icon={<RefreshCw size={16} />} disabled={offline || ['downloading', 'waiting'].includes(update)} onClick={() => { setUpdate(currentVersion === '0.9.7' ? 'current' : 'available'); notify(currentVersion === '0.9.7' ? '当前为最新演示版本。' : '发现演示版本 0.9.7。'); }}>检查更新</Button></div><Section title="发布通道"><SelectField label="更新通道" value={channel} onChange={(_, data) => { setChannel(data.value); setUpdate('idle'); setProgress(0); }} disabled={['downloading', 'waiting'].includes(update)} options={[{ value: 'stable', label: '稳定版 · 推荐' }, { value: 'beta', label: '测试版 · 提前体验' }]} /></Section>{!['idle', 'current'].includes(update) && <Section title="可用版本 0.9.7" note={channel === 'stable' ? '稳定版 · 2026-09-16' : '测试通道 · 演示候选'}><ul className="release-notes"><li>新增账号授权、积分钱包与平台模型目录</li><li>保存独立的自有 API 配置，明确选择计费来源</li><li>更新前检查任务，保留恢复备份与已有作品</li></ul><div className="update-status"><div><strong>{({ available: '完整安装包 · 218 MB（示例）', downloading: offline ? '下载已暂停 · 等待联网' : `正在模拟下载 · ${progress}%`, ready: '演示下载完成 · 等待你确认', waiting: `等待 ${activeTasks} 个创作任务完成`, installed: '演示安装完成 · 未修改实际软件' })[update]}</strong><p>当前尚未配置真实签名证书；生产版校验签名和安装包后才允许安装。</p></div>{update === 'available' && <Button variant="primary" disabled={offline} onClick={() => { setProgress(0); setUpdate('downloading'); }}>模拟下载更新</Button>}{update === 'ready' && <Button variant="primary" onClick={() => { if (activeTasks) setUpdate('waiting'); else { setCurrentVersion('0.9.7'); setUpdate('installed'); notify('演示安装流程完成。实际软件与本地数据未修改。'); } }}>{activeTasks ? '任务完成后安装' : '确认演示安装'}</Button>}{update === 'waiting' && <Button onClick={() => { setUpdate('ready'); notify('已取消等待安装，可稍后重新确认。'); }}>稍后安装</Button>}</div>{update === 'downloading' && <progress value={progress} max={100} aria-label="演示下载进度" />}</Section>}<Section title="安装前检查"><div className="check-row"><span>生成、素材写入、渲染与导出</span><Status tone={activeTasks ? 'warn' : 'ok'}>{activeTasks ? `${activeTasks} 个任务正在处理` : '没有进行中的任务'}</Status></div><div className="check-row"><span>本地数据库恢复备份</span><span>实际安装前创建</span></div><div className="check-row"><span>安装方案</span><span>首版完整包下载，后续接入安装版自动更新</span></div>{backgroundTask && <Button onClick={() => { setBackgroundTask(false); notify('后台渲染演示任务已完成。'); }}>模拟后台渲染完成</Button>}{job === 'running' && <Button variant="subtle" onClick={() => setPage('wallet')}>前往钱包结束演示生成 <ArrowRight size={14} /></Button>}</Section></>}
    {page === 'admin' && <><div className="admin-banner"><ShieldCheck size={20} /><div><strong>运营管理员 · 演示视角</strong><p>独立身份与 MFA；每次发布、调整和退款都需要审计。</p></div><Status>非真实后台</Status></div><div className="admin-stats"><div><span>演示账户</span><strong>1</strong></div><div><span>充值到账</span><strong>¥{orders.filter(order => order.paid).reduce((sum, order) => sum + order.amount, 0)}</strong></div><div><span>处理中作业</span><strong>{activeTasks}</strong></div><div><span>待对账订单</span><strong>{orders.filter(order => !order.paid).length}</strong></div></div><Tabs label="运营后台功能" value={adminTab} onChange={setAdminTab} items={[{ value: 'users', label: '用户设备' }, { value: 'orders', label: '充值订单' }, { value: 'ledger', label: '积分账本' }, { value: 'catalog', label: '模型价格' }, { value: 'releases', label: '版本发布' }, { value: 'audit', label: '运行对账' }]} />
      {adminTab === 'users' && <Section title="用户与授权"><div className="admin-record"><div><strong>{savedName} · SD-DEMO-0628</strong><p>个人正式版 · {devices.length} 台设备 · 可用 {format(available)} 积分</p><Status tone={cloudPaused ? 'warn' : 'ok'}>{cloudPaused ? '新云调用已暂停' : '账号正常'}</Status></div><Button onClick={() => { setCloudPaused(!cloudPaused); notify(cloudPaused ? '已恢复演示账号的新云调用。' : '已暂停演示账号的新云调用，已提交任务继续。'); }}>{cloudPaused ? '恢复云调用' : '暂停云调用'}</Button></div><p className="muted">授权商品、兑换批次与设备撤销各自记录审计。客服角色无直接修改余额权限。</p></Section>}
      {adminTab === 'orders' && <Section title="充值订单" note="客户端状态不能确认实际支付"><div className="table-wrap"><table><thead><tr><th>订单号</th><th>金额</th><th>积分</th><th>状态</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td>{order.id}</td><td>¥{order.amount}</td><td>{format(order.amount * 100)}</td><td><Status tone={order.paid ? 'ok' : 'warn'}>{order.paid ? '演示已到账' : '演示待支付'}</Status></td></tr>)}</tbody></table>{!orders.length && <p className="empty">暂无订单。在积分钱包创建一笔演示充值后，订单会同步出现在这里。</p>}</div><Button variant="subtle" onClick={() => setPage('wallet')}>打开用户钱包 <ArrowRight size={14} /></Button></Section>}
      {adminTab === 'ledger' && <Section title="账本核对"><div className="check-row"><span>总余额 = 可用 + 预留</span><strong>{format(total)} = {format(available)} + {format(held)}</strong></div><div className="check-row"><span>追加记录</span><strong>{ledger.length} 条</strong></div><div className="check-row"><span>借贷与预留一致性</span><Status tone="ok">演示状态一致</Status></div><Button onClick={() => { setPage('wallet'); setFilter('all'); }}>查看完整流水</Button></Section>}
      {adminTab === 'catalog' && <Section title="模型目录与价格版本" note="运营配置发布后生效"><div className="admin-record"><div><strong>目录 2026.09.16 · 七类能力</strong><p>Suno V6 普通生成：100 积分 / 请求；已有报价固定使用原版本。</p><Status>{pricePublished ? '演示价格版本 v2 已发布' : '价格版本 v2 草稿'}</Status></div><Button disabled={pricePublished} onClick={() => { setPricePublished(true); notify('演示发布价格版本 v2；本原型价目不变，已提交任务报价保留。'); }}>模拟审核发布</Button></div><p className="muted">生产流程：采购成本 → 目标毛利测算 → 草稿 → 复核 → 定时发布。供应商密钥不下发客户端。</p></Section>}
      {adminTab === 'releases' && <Section title="版本发布管理"><div className="admin-record"><div><strong>StoryDream 0.9.7 · Windows</strong><p>签名证书、哈希和兼容性报告待真实配置。</p><Status>{releasePublished ? '演示灰度：5%' : '演示发布草稿'}</Status></div><Button onClick={() => { setReleasePublished(!releasePublished); notify(releasePublished ? '已撤回演示发布，不降级运行中的客户端。' : '已模拟 5% 灰度发布，未上传或发布真实安装包。'); }}>{releasePublished ? '撤回演示发布' : '模拟灰度发布'}</Button></div></Section>}
      {adminTab === 'audit' && <Section title="运行与对账"><div className="check-row"><span>未结算预留</span><strong>{held} 积分</strong></div><div className="check-row"><span>未知受理请求</span><strong>0</strong></div><div className="check-row"><span>未确认充值订单</span><strong>{orders.filter(order => !order.paid).length}</strong></div><p className="muted">超时先查询原请求；补偿追加记录并关联原作业。客户端重试与支付重复回调均不重复扣款或入账。</p><Button onClick={() => notify(`演示对账完成：${orders.filter(order => order.paid).length} 笔到账订单，${held} 积分预留，未发现账目差异。`)}>运行演示对账</Button></Section>}
    </>}
    </main><aside className={`proto-inspector ${showTools ? 'open' : ''}`}><span className="eyebrow">设计验证</span><h2>体验完整流程</h2><p>这些控制仅用于演示。不会发起实际支付、生成或安装。</p><div className="scenario-controls"><Button aria-pressed={offline} icon={<Cloud size={16} />} onClick={() => { setOffline(!offline); notify(offline ? '已恢复联网演示。' : '已切换离线情景。'); }}>{offline ? '恢复联网' : '模拟离线'}</Button><Button icon={<Coins size={16} />} onClick={adjustScenario}>模拟余额不足</Button><Button aria-pressed={backgroundTask} icon={<FileClock size={16} />} onClick={() => setBackgroundTask(!backgroundTask)}>{backgroundTask ? '结束后台渲染' : '模拟后台渲染'}</Button><Button variant="subtle" icon={<RefreshCw size={16} />} onClick={reset}>重置演示数据</Button></div><div className="flow-caption"><h3>当前账户</h3><dl><dt>可用</dt><dd>{format(available)} 积分</dd><dt>预留</dt><dd>{format(held)} 积分</dd><dt>进行中</dt><dd>{activeTasks} 个任务</dd></dl></div><div className="flow-caption"><h3>费用边界</h3><p>充值只增加积分，激活只改变对应权益。</p><p>平台模型先报价；自有 API 由用户渠道结算。</p></div><div className="inspector-note"><CircleHelp size={16} /><span>示例价目待运营确认。浏览器刷新后重置所有演示数据。</span></div></aside></div>
    <footer className="proto-footer"><span><ShieldCheck size={13} /> 本地作品始终保留</span><span>设计原型 v1 · 2026.09.16</span><Button variant="subtle" density="compact" onClick={() => setPage('wallet')}>可用 {format(available)} · 预留 {format(held)} 积分 <ChevronRight size={13} /></Button></footer>
  </div></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Prototype />);
