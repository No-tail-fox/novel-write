import { useEffect, useState } from 'react';
import { Download, KeyRound, RefreshCw, Unplug, Upload } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { LicenseStatus, UpdateStatus } from '../../shared/licensing';
import { Button, Dialog, TextField } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { AsyncActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState } from '../../app/route-types';
import './activation.css';

const labels: Record<LicenseStatus['status'], string> = {
  unconfigured: '服务未配置', inactive: '未激活', active: '已激活', offline: '离线宽限', locked: '已锁定', expired: '已到期', error: '验证失败',
};
const date = (value: string | null) => value ? new Date(value).toLocaleString() : '--';
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;

export function ActivationPage({ api }: { api: StoryDreamApi; state: RendererAppState; applyState: ApplyMutationResult }) {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState<'release' | 'install' | null>(null);
  const action = useAsyncAction();
  const updateAction = useAsyncAction();
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const results = await Promise.allSettled([api.getLicenseStatus(), api.getUpdateStatus()]);
      if (!alive) return;
      if (results[0].status === 'fulfilled') setLicense(results[0].value);
      else action.reportError(results[0].reason);
      if (results[1].status === 'fulfilled') setUpdate(results[1].value);
      else updateAction.reportError(results[1].reason);
    };
    void load();
    const timer = setInterval(() => { void load(); }, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [api, action.reportError, updateAction.reportError]);
  async function activate() {
    await action.run(async () => { setLicense(await api.activateLicense(code.trim().toUpperCase())); setCode(''); });
  }
  async function confirmed() {
    const operation = confirm;
    setConfirm(null);
    if (operation === 'release') await action.run(async () => setLicense(await api.releaseLicense()));
    if (operation === 'install') await updateAction.run(async () => setUpdate(await api.installUpdate()));
  }
  const changing = action.busy || update?.phase === 'installing';
  const updateBusy = updateAction.busy || ['checking', 'downloading', 'installing'].includes(update?.phase ?? '');
  const active = license && ['active', 'offline'].includes(license.status);
  return (
    <div className="license-settings">
      <section aria-labelledby="license-heading">
        <div className="license-heading"><h2 id="license-heading">软件授权</h2><span role="status">{license ? labels[license.status] : '正在读取'}</span></div>
        <p className="license-message">{license?.message}</p>
        <form onSubmit={(event) => { event.preventDefault(); void activate(); }}>
          <TextField label="激活码" value={code} onChange={(_, data) => setCode(data.value)} autoComplete="off" spellCheck={false} disabled={changing || !license?.configured} />
          <div className="license-actions">
            <Button type="submit" variant="primary" icon={<KeyRound size={16} />} disabled={changing || !license?.configured || !/^SD-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/i.test(code.trim())}>激活本机</Button>
            <Button type="button" icon={<RefreshCw size={16} />} disabled={changing || !license?.configured} onClick={() => { void action.run(async () => setLicense(await api.refreshLicense())); }}>验证授权</Button>
            <Button type="button" icon={<Unplug size={16} />} disabled={changing || !active} onClick={() => setConfirm('release')}>解绑本机</Button>
          </div>
        </form>
        <AsyncActionFeedback feedback={action.feedback} />
        <dl className="license-details"><dt>设备名称</dt><dd>{license?.deviceLabel || '--'}</dd><dt>设备编号</dt><dd className="license-device-id">{license?.deviceId || '--'}</dd><dt>授权到期</dt><dd>{date(license?.expiresAt ?? null)}</dd><dt>联网凭证到期</dt><dd>{date(license?.validUntil ?? null)}</dd></dl>
        <h3>已绑定设备</h3>
        {license?.devices.length ? <ul className="license-devices">{license.devices.map((device) => <li key={device.deviceId}><strong>{device.label}{device.deviceId === license.deviceId ? '（本机）' : ''}</strong><span>{new Date(device.lastSeen * 1000).toLocaleString()}</span></li>)}</ul> : <p className="license-message">暂无设备记录</p>}
      </section>
      <section aria-labelledby="update-heading">
        <div className="license-heading"><h2 id="update-heading">软件更新</h2><span>当前版本 {update?.currentVersion ?? '--'}</span></div>
        <p role="status" className="license-message">{update?.message}</p>
        {update?.release && <><h3>{update.required ? '需要更新' : '新版本'} {update.release.version}</h3><p className="license-release-notes">{update.release.notes}</p><p className="license-message">{bytes(update.release.size)}</p></>}
        {update?.phase === 'downloading' && <div className="license-progress"><progress aria-label="安装包下载进度" max={update.release?.size || 1} value={update.downloaded} /><span>{bytes(update.downloaded)} / {bytes(update.release?.size || 0)}</span></div>}
        <div className="license-actions">
          <Button icon={<RefreshCw size={16} />} disabled={updateBusy || !license?.configured} onClick={() => { void updateAction.run(async () => setUpdate(await api.checkForUpdate())); }}>检查更新</Button>
          <Button icon={<Download size={16} />} disabled={updateBusy || !update?.release || update.phase === 'ready'} onClick={() => { void updateAction.run(async () => setUpdate(await api.downloadUpdate())); }}>下载更新</Button>
          <Button variant="primary" icon={<Upload size={16} />} disabled={updateBusy || update?.phase !== 'ready'} onClick={() => setConfirm('install')}>安装并退出</Button>
        </div>
        <AsyncActionFeedback feedback={updateAction.feedback} />
      </section>
      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }} title={confirm === 'release' ? '解绑本机' : '安装更新'} actions={<><Button onClick={() => setConfirm(null)}>取消</Button><Button variant={confirm === 'release' ? 'danger' : 'primary'} onClick={() => { void confirmed(); }}>确认{confirm === 'release' ? '解绑' : '安装'}</Button></>}>
        {confirm === 'release' ? '解绑后，本机将无法生成新内容，已有作品仍可查看和导出。' : '应用将退出并打开安装程序。请先保存编辑内容；运行中的任务结束后才能安装。'}
      </Dialog>
    </div>
  );
}
