import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleOff,
  Clock3,
  ExternalLink,
  Flame,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { InformationArchiveOrigin, ShellView, HotBoardCategory, HotBoardItem, HotBoardPlatform, HotBoardSnapshot } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { EmptyState } from '../../components/EmptyState';
import { AiHotSourceView } from './AiHotSourceView';
import { ArchiveDateControl, todayArchiveDate } from './ArchiveDateControl';
import '../../styles/features/hot-board.css';

type PlatformFilter = 'all' | HotBoardPlatform;
type CategoryFilter = 'all' | HotBoardCategory;
type HotBoardWorkspace = 'hotboard' | 'aihot';

const PLATFORM_OPTIONS: ReadonlyArray<{ id: PlatformFilter; label: string }> = [
  { id: 'all', label: '综合' },
  { id: 'weibo', label: '微博' },
  { id: 'douyin', label: '抖音' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'zhihu', label: '知乎' },
  { id: 'toutiao', label: '头条' },
  { id: 'bilibili', label: 'B 站' },
  { id: 'baidu', label: '百度' },
  { id: 'thepaper', label: '澎湃' },
  { id: 'techmeme', label: '科技 / AI' },
];

const CATEGORY_OPTIONS: ReadonlyArray<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: '全部领域' },
  { id: 'social', label: '社交热搜' },
  { id: 'video', label: '视频趋势' },
  { id: 'knowledge', label: '知识讨论' },
  { id: 'news', label: '新闻资讯' },
  { id: 'tech', label: '科技 AI' },
];

export function HotBoardPage({
  api,
  navigate,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  navigate: (view: ShellView) => void;
  isBrowserPreview: boolean;
}) {
  const [workspaceView, setWorkspaceView] = useState<HotBoardWorkspace>('hotboard');
  const [snapshot, setSnapshot] = useState<HotBoardSnapshot | null>(null);
  const [archiveDate, setArchiveDate] = useState(todayArchiveDate);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [archiveOrigin, setArchiveOrigin] = useState<InformationArchiveOrigin | null>(null);
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [openError, setOpenError] = useState('');
  const [openingUrl, setOpeningUrl] = useState('');
  const requestIdRef = useRef(0);

  const loadArchive = useCallback(async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    setErrorMessage('');
    try {
      const next = await api.fetchHotBoard({ date: archiveDate, forceRefresh });
      if (requestId !== requestIdRef.current) return;
      setArchiveOrigin(next.origin);
      setAvailableDates(next.availableDates);
      setSnapshot(next.snapshot);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setErrorMessage(formatAppErrorMessage(normalizeAppError(error)));
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }, [api, archiveDate]);

  useEffect(() => {
    if (workspaceView !== 'hotboard') return;
    setSnapshot(null);
    setArchiveOrigin(null);
    void loadArchive();
  }, [loadArchive, workspaceView]);

  const titleCounts = useMemo(() => {
    const counts = new Map<string, Set<HotBoardPlatform>>();
    for (const item of snapshot?.items ?? []) {
      const key = normalizeTitle(item.title);
      if (!key) continue;
      const platforms = counts.get(key) ?? new Set<HotBoardPlatform>();
      platforms.add(item.platform);
      counts.set(key, platforms);
    }
    return counts;
  }, [snapshot]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    return (snapshot?.items ?? []).filter((item) => {
      if (platform !== 'all' && item.platform !== platform) return false;
      if (category !== 'all' && item.category !== category) return false;
      if (!normalizedQuery) return true;
      return `${item.title} ${item.summary ?? ''} ${item.platformLabel}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery);
    }).slice(0, 120);
  }, [category, platform, query, snapshot]);

  const readyPlatformCount = snapshot?.platformStatuses.filter((status) => status.state === 'ready').length ?? 0;
  const failedPlatformCount = snapshot?.platformStatuses.filter((status) => status.state === 'failed').length ?? 0;
  const fetchedAtLabel = snapshot ? formatDateTime(snapshot.fetchedAt) : '尚未归档';
  const isToday = archiveDate === todayArchiveDate();
  const hasActiveFilters = platform !== 'all' || category !== 'all' || Boolean(query.trim());
  const warningMessage = errorMessage || openError || (snapshot?.warnings.length
    ? `${snapshot.warnings.slice(0, 2).join('；')}${snapshot.warnings.length > 2 ? `；另有 ${snapshot.warnings.length - 2} 个来源异常` : ''}`
    : '');
  const feedState = refreshing
    ? 'refreshing'
    : isBrowserPreview
      ? 'preview'
      : archiveOrigin === 'missing'
        ? 'idle'
        : readyPlatformCount === 0
        ? 'unavailable'
        : failedPlatformCount > 0
          ? 'partial'
          : 'ready';
  const feedStateLabel = feedState === 'refreshing'
    ? '正在检测'
    : feedState === 'preview'
      ? '预览受限'
      : feedState === 'idle'
        ? '该日无归档'
      : feedState === 'unavailable'
        ? '来源不可用'
        : feedState === 'partial'
          ? '部分来源可用'
          : archiveDate !== todayArchiveDate()
            ? '历史归档'
            : archiveOrigin === 'cache'
              ? '今日已保存'
              : '刚刚更新';

  async function openUrl(url: string): Promise<void> {
    setOpenError('');
    setOpeningUrl(url);
    try {
      await api.openHotBoardUrl(url);
    } catch (error) {
      setOpenError(formatAppErrorMessage(normalizeAppError(error)));
    } finally {
      setOpeningUrl('');
    }
  }

  function openItemSource(item: HotBoardItem): void {
    void openUrl(item.url);
  }

  function openAssessmentSource(url: string): void {
    void openUrl(url);
  }

  function createFromTopic(item: HotBoardItem): void {
    sessionStorage.setItem('hotboard_topic', JSON.stringify({
      title: item.title,
      url: item.url,
      platformLabel: item.platformLabel,
      hotValue: item.hotValue,
      summary: item.summary ?? '',
    }));
    navigate('new-task');
  }

  return (
    <div className="hot-board-workbench" data-hot-board-workbench data-browser-preview={isBrowserPreview ? 'true' : 'false'}>
      <nav className="hot-board-view-tabs" role="tablist" aria-label="热点工作台视图">
        <button type="button" role="tab" aria-selected={workspaceView === 'hotboard'} className={workspaceView === 'hotboard' ? 'active' : ''} onClick={() => setWorkspaceView('hotboard')}><TrendingUp size={15} />全网热榜</button>
        <button type="button" role="tab" aria-selected={workspaceView === 'aihot'} className={workspaceView === 'aihot' ? 'active' : ''} onClick={() => setWorkspaceView('aihot')}><Zap size={15} />AI 信息源</button>
      </nav>

      <section className="hot-board-overview" aria-label="全网实时热榜" hidden={workspaceView !== 'hotboard'}>
        <section className="hot-board-summary hot-board-signal-strip" aria-label="热榜刷新概况">
          <div><span>实时热点</span><strong>{snapshot?.items.length ?? 0}</strong></div>
          <div><span>来源在线</span><strong>{readyPlatformCount}<small>/9</small></strong></div>
          <div><span>来源异常</span><strong data-tone={failedPlatformCount ? 'warning' : 'normal'}>{failedPlatformCount}</strong></div>
          <div><span>更新于</span><strong className="time-value">{fetchedAtLabel}</strong></div>
          <div className="hot-board-refresh-controls">
            <ArchiveDateControl date={archiveDate} availableDates={availableDates} origin={archiveOrigin} onChange={setArchiveDate} />
            <button
              className="ghost-action compact-action"
              type="button"
              title={isToday ? '重新抓取并覆盖今天的已保存快照' : '历史归档只读，不能用实时数据覆盖'}
              disabled={refreshing || isBrowserPreview || !isToday}
              onClick={() => void loadArchive(true)}
            >
              <RefreshCw className={refreshing ? 'spin' : ''} size={15} />
              {refreshing ? '刷新中' : '立即刷新'}
            </button>
          </div>
        </section>

      <section className="hot-board-filters" aria-label="热榜筛选" data-active-filters={hasActiveFilters ? 'true' : 'false'}>
        <div className="hot-board-platform-tabs" role="group" aria-label="平台">
          {PLATFORM_OPTIONS.map((option) => (
            <button key={option.id} type="button" aria-pressed={platform === option.id} className={platform === option.id ? 'active' : ''} onClick={() => setPlatform(option.id)}>
              {option.label}
              {option.id !== 'all' ? <small>{snapshot?.platformStatuses.find((status) => status.platform === option.id)?.count ?? 0}</small> : null}
            </button>
          ))}
        </div>
        <label className="hot-board-search">
          <Search size={15} />
          <input aria-label="搜索热榜" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索热点标题" />
        </label>
        <select aria-label="内容领域" value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}>
          {CATEGORY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </section>

      {warningMessage ? (
        <div className="hot-board-warning" role={errorMessage || openError ? 'alert' : 'status'} aria-live={errorMessage || openError ? 'assertive' : 'polite'}>
          <TriangleAlert size={15} />
          <span>{warningMessage}</span>
        </div>
      ) : null}

      <div className="hot-board-body">
        <section className="hot-board-feed" aria-label="实时热点列表">
          <header className="hot-board-feed-head">
            <div>
              <h2>{platform === 'all' ? '全网热点' : PLATFORM_OPTIONS.find((option) => option.id === platform)?.label}</h2>
              <span>{filteredItems.length} 条结果 · 按各平台原始排名交叉排列</span>
            </div>
            <div className="hot-board-live-state" data-state={feedState}>
              <span />{feedStateLabel}
            </div>
          </header>

          <div className="hot-board-column-head" aria-hidden="true">
            <span>排名</span><span>热点 / 来源</span><span>热度信号</span><span>更新</span><span>操作</span>
          </div>

          {!snapshot && refreshing ? <HotBoardLoadingRows /> : null}
          {snapshot && snapshot.items.length === 0 && !refreshing ? (
            <EmptyState
              title="当前未取得实时热点"
              description={isBrowserPreview ? '浏览器预览不执行跨站抓取，Electron 桌面端会显示实时结果。' : '当前来源没有返回可用条目，请稍后重新刷新。'}
              tone={isBrowserPreview ? 'empty' : 'error'}
              action={isBrowserPreview || !isToday ? undefined : <button className="ghost-action slim" type="button" onClick={() => void loadArchive(true)}>重新刷新</button>}
            />
          ) : null}
          {snapshot && snapshot.items.length > 0 && filteredItems.length === 0 ? (
            <EmptyState
              title="没有符合条件的热点"
              description="调整平台、领域或搜索关键词后重试。"
              action={<button className="ghost-action slim" type="button" onClick={() => { setPlatform('all'); setCategory('all'); setQuery(''); }}>清除筛选</button>}
            />
          ) : null}
          {!snapshot && !refreshing && errorMessage ? (
            <EmptyState title="热榜暂时无法刷新" description={errorMessage} tone="error" action={isToday ? <button className="ghost-action slim" type="button" onClick={() => void loadArchive(true)}>重新刷新</button> : undefined} />
          ) : null}
          {!snapshot && !refreshing && archiveOrigin === 'missing' && !errorMessage ? (
            <EmptyState title="该日期没有已保存热榜" description="历史日期只显示当时已经归档的数据，不会使用今天的实时结果补齐。" />
          ) : null}

          <div className="hot-board-list">
            {filteredItems.map((item) => {
              const crossPlatformCount = titleCounts.get(normalizeTitle(item.title))?.size ?? 1;
              return (
                <article className="hot-board-row hot-board-network-row" data-platform={item.platform} key={item.id}>
                  <div className="hot-board-rank" data-top={item.rank <= 3 ? 'true' : 'false'}>{item.rank}</div>
                  <div className="hot-board-item-main">
                    <div className="hot-board-item-kicker">
                      <span className="hot-board-platform-badge">{item.platformLabel}</span>
                      <span>来源 {item.sourceLabel}</span>
                    </div>
                    <h3 className="hot-board-item-title">{item.title}</h3>
                    {item.summary ? <p>{item.summary}</p> : null}
                  </div>
                  <div className="hot-board-signal-cell">
                    {item.hotValue ? <span className="hot-board-heat"><Flame size={12} />{formatHotValue(item.hotValue)}</span> : <span className="hot-board-no-signal">--</span>}
                    {crossPlatformCount > 1 ? <span className="hot-board-cross-signal">{crossPlatformCount} 平台同榜</span> : null}
                  </div>
                  <div className="hot-board-time-cell"><Clock3 size={12} />{formatTime(item.updatedAt)}</div>
                  <div className="hot-board-row-actions">
                    <button className="icon-button" type="button" title="打开原文" aria-label={`打开原文：${item.title}`} disabled={openingUrl === item.url} onClick={() => openItemSource(item)}><ExternalLink size={15} /></button>
                    <button className="hot-board-create-action" type="button" onClick={() => createFromTopic(item)}><Sparkles size={14} />去创作</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="hot-board-source-rail" aria-label="来源接入评估">
          <header>
            <div><h2>来源监测</h2><span>平台状态与候选源评估</span></div>
            <strong>{readyPlatformCount}/9 在线</strong>
          </header>
          <div className="hot-board-platform-health" aria-label="平台数据状态">
            {snapshot?.platformStatuses.map((status) => (
              <div key={status.platform} data-state={status.state} title={status.message}>
                {status.state === 'ready' ? <CheckCircle2 size={13} /> : <CircleOff size={13} />}
                <span>{status.label}</span>
                <small>{status.state === 'ready' ? `${status.count} 条` : status.state === 'failed' ? '异常' : '无数据'}</small>
              </div>
            ))}
          </div>
          <details className="hot-board-source-catalog" open>
            <summary>
              <span>候选源评估</span>
              <small>{snapshot?.sourceAssessments.filter((source) => source.suitability === 'connected').length ?? 2} / 10 已接入</small>
            </summary>
            <div className="hot-board-source-list">
              {snapshot?.sourceAssessments.map((source, index) => (
                <article className="hot-board-source-row" data-suitability={source.suitability} key={source.id}>
                  <span className="hot-board-source-index">{index + 1}</span>
                  <div>
                    <div className="hot-board-source-title">
                      <strong>{source.label}</strong>
                      <span>{source.suitability === 'connected' ? '已接入' : source.suitability === 'reference' ? '备用核验' : '暂不接入'}</span>
                    </div>
                    <small>{source.coverage}</small>
                    <p>{source.reason}</p>
                  </div>
                  <button className="icon-button" type="button" title="打开来源" aria-label={`打开 ${source.label}`} disabled={openingUrl === source.url} onClick={() => openAssessmentSource(source.url)}><ArrowUpRight size={14} /></button>
                </article>
              ))}
            </div>
          </details>
        </aside>
      </div>
      </section>

      <AiHotSourceView
        api={api}
        navigate={navigate}
        isBrowserPreview={isBrowserPreview}
        active={workspaceView === 'aihot'}
        archiveDate={archiveDate}
        onArchiveDateChange={setArchiveDate}
      />
    </div>
  );
}

function HotBoardLoadingRows() {
  return (
    <div className="hot-board-loading" role="status" aria-live="polite" aria-label="正在加载实时热榜">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index}><span /><div><strong /><small /></div></div>
      ))}
    </div>
  );
}

function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatHotValue(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return trimmed;
  const number = Number(trimmed);
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(1)} 亿`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(number >= 1_000_000 ? 0 : 1)} 万`;
  return number.toLocaleString('zh-CN');
}
