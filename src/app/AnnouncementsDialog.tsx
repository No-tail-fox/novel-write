import { useEffect, useMemo, useState } from 'react';
import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import type { AnnouncementManifest, UpdateStatus } from '../shared/licensing';
import { Button, Dialog, SegmentedControl } from '../ui';

type AnnouncementCategory = AnnouncementManifest['category'];

const readStorageKey = 'storydream-announcement-read-v1';
const categoryOptions: { value: AnnouncementCategory; label: string }[] = [
  { value: 'update', label: '更新公告' },
  { value: 'problem', label: '问题公告' },
];

function loadReadIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(readStorageKey) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-500) : [];
  } catch {
    return [];
  }
}

function formatCreatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp * 1000));
}

export function AnnouncementDialog({
  open,
  onOpenChange,
  updateStatus,
  busy,
  updateAction,
  isBrowserPreview,
  onUnreadCountChange,
  onCheckForUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateStatus: UpdateStatus | null;
  busy: boolean;
  updateAction: 'checking' | 'downloading' | 'installing' | null;
  isBrowserPreview: boolean;
  onUnreadCountChange: (count: number) => void;
  onCheckForUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const [category, setCategory] = useState<AnnouncementCategory>('update');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState(loadReadIds);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const allAnnouncements = updateStatus?.announcements ?? [];
  const announcements = useMemo(
    () => allAnnouncements.filter((item) => item.category === category),
    [allAnnouncements, category],
  );
  const selected = announcements.find((item) => item.id === selectedId) ?? null;
  const unreadCount = allAnnouncements.filter((item) => !readIds.includes(item.id)).length;
  const release = updateStatus?.release ?? null;
  const updateInProgress = updateAction !== null || updateStatus?.phase === 'checking' || updateStatus?.phase === 'downloading' || updateStatus?.phase === 'installing';

  useEffect(() => {
    if (announcements.some((item) => item.id === selectedId)) return;
    setSelectedId(announcements[0]?.id ?? null);
    setConfirmInstall(false);
  }, [announcements, selectedId]);

  useEffect(() => onUnreadCountChange(unreadCount), [onUnreadCountChange, unreadCount]);

  useEffect(() => {
    if (!open || !selected || readIds.includes(selected.id)) return;
    const next = [...readIds, selected.id].slice(-500);
    setReadIds(next);
    try { localStorage.setItem(readStorageKey, JSON.stringify(next)); } catch { /* unread state remains available for this session */ }
  }, [open, readIds, selected]);

  const updateOptions = categoryOptions.map((option) => ({
    ...option,
    label: `${option.label} ${allAnnouncements.filter((item) => item.category === option.value && !readIds.includes(item.id)).length || ''}`.trim(),
  }));

  return (
    <Dialog
      open={open}
      title="公告通知"
      surfaceClassName="announcement-dialog-surface"
      onOpenChange={onOpenChange}
      actions={<Button onClick={() => onOpenChange(false)}>关闭</Button>}
    >
      <div className="announcement-dialog">
        <SegmentedControl label="公告分类" options={updateOptions} value={category} onChange={setCategory} />
        <div className="announcement-layout">
          <nav className="announcement-list" aria-label={category === 'update' ? '更新公告列表' : '问题公告列表'}>
            {announcements.length === 0 ? <p className="announcement-empty">暂无{category === 'update' ? '更新' : '问题'}公告</p> : null}
            {announcements.map((item) => (
              <Button
                key={item.id}
                className={`announcement-list-item${selected?.id === item.id ? ' active' : ''}`}
                variant="subtle"
                density="compact"
                aria-current={selected?.id === item.id ? 'true' : undefined}
                onClick={() => { setSelectedId(item.id); setConfirmInstall(false); }}
              >
                <span className="announcement-list-item-heading">
                  <strong>{item.title}</strong>
                  {!readIds.includes(item.id) ? <span className="announcement-item-unread" aria-label="未读" /> : null}
                </span>
                <small>{formatCreatedAt(item.createdAt)}</small>
              </Button>
            ))}
          </nav>

          <section className="announcement-detail" aria-live="polite">
            {selected ? <>
              <div className="announcement-detail-heading">
                <div>
                  <h2>{selected.title}</h2>
                  <p>{formatCreatedAt(selected.createdAt)}{selected.version ? ` · 版本 ${selected.version}` : ''}</p>
                </div>
              </div>
              <div className="announcement-detail-body">{selected.body}</div>
            </> : <p className="announcement-empty">选择一条公告查看详情</p>}

            {category === 'update' ? <div className="announcement-update-action">
              {updateStatus?.required ? <p className="announcement-update-status" role="status">此版本需要更新后才能继续使用。</p> : null}
              {release ? <p className="announcement-update-status">可更新至 V{release.version} · 当前 V{updateStatus?.currentVersion}</p> : null}
              {!selected && release?.notes ? <div className="announcement-detail-body announcement-release-notes">{release.notes}</div> : null}
              {isBrowserPreview ? <p className="announcement-update-status">请在 StoryDream 桌面版中执行更新。</p> : null}
              {!isBrowserPreview && updateInProgress ? <Button disabled icon={<LoaderCircle size={15} className="spin" />}>
                {updateAction === 'downloading' || updateStatus?.phase === 'downloading' ? `下载中 ${Math.round(((updateStatus?.downloaded ?? 0) / (release?.size || 1)) * 100)}%` : updateAction === 'installing' || updateStatus?.phase === 'installing' ? '正在启动安装' : '正在检查更新'}
              </Button> : null}
              {!isBrowserPreview && !busy && !updateInProgress && release && updateStatus?.phase === 'available' ? <Button variant="primary" icon={<Download size={15} />} disabled={busy || updateInProgress || isBrowserPreview} onClick={onDownloadUpdate}>下载更新</Button> : null}
              {!isBrowserPreview && !busy && !updateInProgress && release && updateStatus?.phase === 'ready' && !confirmInstall ? <Button variant="primary" onClick={() => setConfirmInstall(true)}>安装更新</Button> : null}
              {!isBrowserPreview && !busy && !updateInProgress && release && updateStatus?.phase === 'ready' && confirmInstall ? <div className="announcement-install-confirm" role="group" aria-label="确认安装更新">
                <p>安装将关闭 StoryDream 并启动安装程序。</p>
                <Button variant="primary" disabled={busy || updateInProgress || isBrowserPreview} onClick={() => { setConfirmInstall(false); onInstallUpdate(); }}>确认安装</Button>
                <Button onClick={() => setConfirmInstall(false)}>取消</Button>
              </div> : null}
              {!isBrowserPreview && !busy && !updateInProgress && (updateStatus?.phase === 'error' || !release || updateStatus?.phase === 'idle') ? <Button icon={<RefreshCw size={15} />} disabled={busy || updateInProgress || isBrowserPreview} onClick={onCheckForUpdate}>检查更新</Button> : null}
              {updateStatus?.phase === 'error' ? <p className="announcement-update-status" role="alert">{updateStatus.message}</p> : null}
            </div> : null}
          </section>
        </div>
      </div>
    </Dialog>
  );
}
