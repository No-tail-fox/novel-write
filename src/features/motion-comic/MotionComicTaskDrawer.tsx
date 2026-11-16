import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Clapperboard, FileText, Film, Image, ImagePlus, ListTodo, Maximize2, Minimize2, Music2, PackageCheck, X } from 'lucide-react';
import { Button, Dialog, IconButton } from '../../ui';
import { countMotionComicTasks, motionComicTaskStatusLabels, motionComicTaskTypeLabels, safeMotionComicTaskMediaUrl, type MotionComicTaskItem, type MotionComicTaskNavigation, type MotionComicTaskType } from './motion-comic-task-view-model';
import './MotionComicTaskDrawer.css';

export interface MotionComicTaskDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly MotionComicTaskItem[];
  loading?: boolean;
  error?: string | null;
  projectTitle?: string;
  onNavigate?: (destination: MotionComicTaskNavigation, item: MotionComicTaskItem) => void;
  /** Resolve managed paths through the host media API; no filesystem URI fallback. */
  resolveUrl?: (thumbnailPath: string) => string | Promise<string>;
}
const icons: Record<MotionComicTaskType, typeof Image> = { script: FileText, storyboard: Clapperboard, reference: ImagePlus, image: Image, video: Film, audio: Music2, render: PackageCheck, other: ListTodo };
const typeOrder: MotionComicTaskType[] = ['script', 'storyboard', 'reference', 'image', 'video', 'audio', 'render', 'other'];
const statusTone = (status: MotionComicTaskItem['status']) => ['failed', 'unknown', 'stale'].includes(status) ? 'danger' : ['review', 'candidate', 'paused', 'cancelling'].includes(status) ? 'warn' : status === 'running' ? 'active' : status === 'completed' ? 'ok' : 'neutral';
/** The task type is shown as its own chip, so the title keeps only the episode or target. */
const displayTitle = (item: MotionComicTaskItem) => item.title.replace(/ · (剧本|分镜)$/u, '');
const formatTime = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
function TaskThumbnail({ item, resolveUrl }: Pick<MotionComicTaskDrawerProps, 'resolveUrl'> & { item: MotionComicTaskItem }) {
  const [media, setMedia] = useState<{ path: string; url?: string }>();
  const path = item.kind === 'script' ? undefined : item.thumbnailPath;
  useEffect(() => {
    if (!path || !resolveUrl) return;
    let active = true;
    Promise.resolve().then(() => resolveUrl(path)).then(value => {
      if (active) setMedia({ path, url: safeMotionComicTaskMediaUrl(value) });
    }, () => { if (active) setMedia({ path }); });
    return () => { active = false; };
  }, [path, resolveUrl]);
  const Icon = icons[item.taskType];
  const url = media?.path === path ? media?.url : undefined;
  return <span className={`comic-task-drawer__thumbnail comic-task-drawer__thumbnail--${item.kind}`} data-type={item.taskType}>
    {url ? <img src={url} alt="" width={44} height={44} loading="lazy" onError={() => setMedia({ path: path! })} /> : <Icon size={20} aria-hidden="true" />}
  </span>;
}
export function MotionComicTaskDrawer({ open, onOpenChange, items, loading = false, error, projectTitle, onNavigate, resolveUrl }: MotionComicTaskDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [typeFilter, setTypeFilter] = useState<MotionComicTaskType | 'all'>('all');
  const counts = useMemo(() => countMotionComicTasks(items), [items]);
  const typeCounts = useMemo(() => { const result = new Map<MotionComicTaskType, number>(); for (const item of items) result.set(item.taskType, (result.get(item.taskType) ?? 0) + 1); return result; }, [items]);
  const activeFilter = typeFilter !== 'all' && typeCounts.has(typeFilter) ? typeFilter : 'all';
  const filtered = useMemo(() => activeFilter === 'all' ? items : items.filter(item => item.taskType === activeFilter), [items, activeFilter]);
  const remaining = Math.max(0, filtered.length - visibleCount);
  return <Dialog open={open} onOpenChange={onOpenChange} surfaceClassName={`comic-task-drawer${expanded ? ' comic-task-drawer--expanded' : ''}`}
    title={<span className="comic-task-drawer__heading"><span>后台任务</span><IconButton label="关闭后台任务" icon={<X size={18} aria-hidden="true" />} onClick={() => onOpenChange(false)} /></span>}>
    <div className="comic-task-drawer__intro"><span>{projectTitle ?? '当前项目'} · {counts.total} 条记录</span><Button variant="subtle" aria-pressed={expanded} icon={expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />} onClick={() => setExpanded(value => !value)}>{expanded ? '收起视图' : '展开视图'}</Button></div>
    <div className="comic-task-drawer__counts" role="status" aria-live="polite" aria-atomic="true">
      {([['运行中', counts.running, 'active'], ['排队', counts.queued, 'neutral'], ['需核对', counts.attention, 'danger'], ['待审核 / 选用', counts.review + counts.candidate, 'warn']] as const).map(([label, count, tone]) => <div key={label} data-tone={tone} data-zero={count === 0 || undefined}><span>{label}</span><strong>{count}</strong></div>)}
    </div>
    {typeCounts.size > 1 ? <div className="comic-task-drawer__filters" role="group" aria-label="按任务类型筛选">
      <button type="button" aria-pressed={activeFilter === 'all'} onClick={() => { setTypeFilter('all'); setVisibleCount(50); }}>全部<span>{items.length}</span></button>
      {typeOrder.filter(type => typeCounts.has(type)).map(type => { const Icon = icons[type]; return <button type="button" key={type} data-type={type} aria-pressed={activeFilter === type} onClick={() => { setTypeFilter(type); setVisibleCount(50); }}><Icon size={13} aria-hidden="true" />{motionComicTaskTypeLabels[type]}<span>{typeCounts.get(type)}</span></button>; })}
    </div> : null}
    {error && <div role="alert" className="comic-task-drawer__error"><strong>任务记录读取失败</strong><p>{error}</p>{items.length > 0 && <p>以下保留上次读取的记录。</p>}</div>}
    {loading && <p role="status" className="comic-task-drawer__muted">正在读取任务记录…</p>}
    {!loading && !error && items.length === 0 && <div className="comic-task-drawer__empty"><ListTodo size={32} aria-hidden="true" /><h3>暂无后台任务</h3><p>剧本、参考图和镜头生成的任务记录会显示在这里。</p></div>}
    <ul className="comic-task-drawer__list" aria-label="后台任务记录" aria-busy={loading}>
      {filtered.slice(0, visibleCount).map(item => <li key={item.id} className="comic-task-drawer__card" data-type={item.taskType} data-tone={statusTone(item.status)}>
        <div className="comic-task-drawer__card-top">
          <TaskThumbnail item={item} resolveUrl={resolveUrl} />
          <div className="comic-task-drawer__copy">
            <div className="comic-task-drawer__meta"><span className="comic-task-drawer__type" data-type={item.taskType}>{motionComicTaskTypeLabels[item.taskType]}</span><p>{item.subtitle}</p></div>
            <h3 title={item.title}>{displayTitle(item)}</h3>
          </div>
          <span className={`comic-task-drawer__status comic-task-drawer__status--${item.status}`} data-tone={statusTone(item.status)}>{item.status === 'running' ? <i aria-hidden="true" /> : null}{motionComicTaskStatusLabels[item.status]}</span>
        </div>
        {item.excerpt && <p className="comic-task-drawer__excerpt" title={item.excerpt}>{item.excerpt}</p>}
        {(item.error || item.detail) && <details className="comic-task-drawer__details"><summary>{item.error ? '查看诊断信息' : '任务详情'}</summary>{item.detail && <p>{item.detail}</p>}{item.error && <pre>{item.error}</pre>}<p>记录状态：{item.rawStatus}</p></details>}
        <div className="comic-task-drawer__card-foot">
          <time dateTime={item.updatedAt}>{formatTime(item.updatedAt)}</time>
          {onNavigate && item.navigation && <Button density="compact" variant="subtle" icon={<ArrowUpRight size={14} aria-hidden="true" />} iconPosition="after" onClick={() => onNavigate(item.navigation!, item)}>{item.navigation.kind === 'script' ? (item.taskType === 'storyboard' ? '查看分集分镜' : '查看分集剧本') : item.navigation.kind === 'asset' ? '核对资产' : '查看对应分集'}</Button>}
        </div>
      </li>)}
    </ul>
    {remaining > 0 && <Button className="comic-task-drawer__more" onClick={() => setVisibleCount(count => count + 50)}>再显示 {Math.min(50, remaining)} 条 · 剩余 {remaining} 条</Button>}
    {items.length > 0 && <details className="comic-task-drawer__all-counts"><summary>全部状态 · {counts.total} 条</summary><dl>{Object.entries(motionComicTaskStatusLabels).map(([status, label]) => <div key={status}><dt>{label}</dt><dd>{counts[status as MotionComicTaskItem['status']]}</dd></div>)}</dl></details>}
    <p className="comic-task-drawer__footnote">结果未知时，请先到对应分集或资产核对。任务进度以实际记录为准。</p>
  </Dialog>;
}
