import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleOff,
  Clock3,
  ExternalLink,
  Flame,
  ImageOff,
  Loader2,
  Maximize2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { AiSourceSection, InformationArchiveOrigin, ShellView, HotBoardCategory, HotBoardItem, HotBoardPlatform, HotBoardSnapshot, HotBoardSourceContent, WebSearchBackendStatus } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { EmptyState } from '../../components/EmptyState';
import { Button, Dialog, IconButton } from '../../ui';
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
  const [readingItemId, setReadingItemId] = useState('');
  const [sourceContents, setSourceContents] = useState<Record<string, HotBoardSourceContent>>({});
  const [sourceReadErrors, setSourceReadErrors] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, AiSourceSection[]>>({});
  const [searchBackendStatuses, setSearchBackendStatuses] = useState<Record<string, WebSearchBackendStatus[]>>({});
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({});
  const [searchEmpty, setSearchEmpty] = useState<Record<string, boolean>>({});
  const [searchingItemId, setSearchingItemId] = useState('');
  const [readerItem, setReaderItem] = useState<HotBoardItem | null>(null);
  const sourceRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const searchedItemsRef = useRef(new Set<string>());
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
      ? '本地归档预览'
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

  async function searchItemContent(item: HotBoardItem, forceRefresh = false): Promise<void> {
    if (!forceRefresh && searchedItemsRef.current.has(item.id)) return;
    searchedItemsRef.current.add(item.id);
    const requestId = ++searchRequestRef.current;
    setSearchErrors((current) => ({ ...current, [item.id]: '' }));
    setSearchEmpty((current) => ({ ...current, [item.id]: false }));
    setSearchingItemId(item.id);
    try {
      const context = await api.searchWebSources({
        query: item.title,
        providers: ['bing', 'sogou', 'baidu'],
      });
      if (requestId !== searchRequestRef.current) return;
      setSearchResults((current) => ({ ...current, [item.id]: context.sections }));
      setSearchBackendStatuses((current) => ({ ...current, [item.id]: context.backendStatuses ?? [] }));
      if (context.sections.length === 0) {
        if (context.warnings.length > 0) setSearchErrors((current) => ({ ...current, [item.id]: context.warnings.join('；') }));
        else setSearchEmpty((current) => ({ ...current, [item.id]: true }));
      }
    } catch (error) {
      if (requestId === searchRequestRef.current) {
        setSearchErrors((current) => ({ ...current, [item.id]: formatAppErrorMessage(normalizeAppError(error)) }));
      }
    } finally {
      if (requestId === searchRequestRef.current) setSearchingItemId('');
    }
  }

  async function readItemContent(item: HotBoardItem, forceRefresh = false): Promise<HotBoardSourceContent | null> {
    const cached = sourceContents[item.id];
    if (!forceRefresh && cached) return cached;
    const requestId = ++sourceRequestRef.current;
    setSourceReadErrors((current) => ({ ...current, [item.id]: '' }));
    setReadingItemId(item.id);
    try {
      const source = await api.readHotBoardSource({ title: item.title, url: item.url, summary: item.summary, forceRefresh });
      if (requestId !== sourceRequestRef.current) return source;
      setSourceContents((current) => ({ ...current, [item.id]: source }));
      if (source.kind !== 'page') void searchItemContent(item);
      return source;
    } catch (error) {
      if (requestId === sourceRequestRef.current) {
        setSourceReadErrors((current) => ({ ...current, [item.id]: formatAppErrorMessage(normalizeAppError(error)) }));
        void searchItemContent(item);
      }
      return null;
    } finally {
      if (requestId === sourceRequestRef.current) setReadingItemId('');
    }
  }

  function openSourceDialog(item: HotBoardItem): void {
    setReaderItem(item);
    const cached = sourceContents[item.id];
    if (!cached) void readItemContent(item);
    else if (cached.kind !== 'page') void searchItemContent(item);
  }

  function retrySourceContent(): void {
    if (!readerItem) return;
    setSourceContents((current) => {
      const next = { ...current };
      delete next[readerItem.id];
      return next;
    });
    searchedItemsRef.current.delete(readerItem.id);
    setSearchResults((current) => {
      const next = { ...current };
      delete next[readerItem.id];
      return next;
    });
    setSearchBackendStatuses((current) => {
      const next = { ...current };
      delete next[readerItem.id];
      return next;
    });
    setSearchErrors((current) => ({ ...current, [readerItem.id]: '' }));
    setSearchEmpty((current) => ({ ...current, [readerItem.id]: false }));
    void readItemContent(readerItem, true);
  }

  function retrySearchContent(): void {
    if (!readerItem) return;
    void searchItemContent(readerItem, true);
  }

  async function createFromTopic(item: HotBoardItem): Promise<void> {
    const source = await readItemContent(item);
    if (!source || source.kind === 'unavailable' || !source.content.trim()) {
      setOpenError(sourceReadErrors[item.id] || source?.warning || '该来源没有可用于创作的页面正文或摘要。');
      return;
    }
    sessionStorage.setItem('hotboard_topic', JSON.stringify({
      title: item.title,
      url: source.url || item.url,
      platformLabel: item.platformLabel,
      hotValue: item.hotValue,
      summary: item.summary ?? '',
      sourceContent: source.content,
      sourceContentKind: source.kind,
      sourceWarning: source.warning ?? '',
    }));
    navigate('new-task');
  }

  return (
    <div className="hot-board-workbench" data-hot-board-workbench data-browser-preview={isBrowserPreview ? 'true' : 'false'}>
      <nav className="hot-board-view-tabs" role="tablist" aria-label="热点工作台视图">
        <button type="button" role="tab" aria-selected={workspaceView === 'hotboard'} className={workspaceView === 'hotboard' ? 'active' : ''} onClick={() => setWorkspaceView('hotboard')}><TrendingUp size={15} />全网热榜</button>
        <button type="button" role="tab" aria-selected={workspaceView === 'aihot'} className={workspaceView === 'aihot' ? 'active' : ''} onClick={() => setWorkspaceView('aihot')}><Zap size={15} />AI 信息源</button>
      </nav>

      <section className="hot-board-overview" aria-label={isBrowserPreview ? '全网热榜本地预览' : '全网实时热榜'} hidden={workspaceView !== 'hotboard'}>
        <section className="hot-board-summary hot-board-signal-strip" aria-label="热榜刷新概况">
          <div><span>{isBrowserPreview ? '预览条目' : '实时热点'}</span><strong>{snapshot?.items.length ?? 0}</strong></div>
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
        <section className="hot-board-feed" aria-label={isBrowserPreview ? '热榜本地预览列表' : '实时热点列表'}>
          <header className="hot-board-feed-head">
            <div>
              <h2>{platform === 'all' ? (isBrowserPreview ? '归档预览' : '全网热点') : PLATFORM_OPTIONS.find((option) => option.id === platform)?.label}</h2>
              <span>{isBrowserPreview ? `${filteredItems.length} 条摘要样例 · 真实热榜请使用 Electron 桌面端` : `${filteredItems.length} 条结果 · 按各平台原始排名交叉排列`}</span>
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
              const readingContent = readingItemId === item.id;
              return (
                <article className="hot-board-row hot-board-network-row" data-platform={item.platform} key={item.id}>
                  <div className="hot-board-rank" data-top={item.rank <= 3 ? 'true' : 'false'}>{item.rank}</div>
                  <div className="hot-board-item-main">
                    <div className="hot-board-item-line">
                      <div className="hot-board-item-kicker">
                        <span className="hot-board-platform-badge">{item.platformLabel}</span>
                        <span>来源 {item.sourceLabel}</span>
                      </div>
                      <h3 className="hot-board-item-title" title={item.title}>{item.title}</h3>
                    </div>
                  </div>
                  <div className="hot-board-signal-cell">
                    {item.hotValue ? <span className="hot-board-heat"><Flame size={12} />{formatHotValue(item.hotValue)}</span> : <span className="hot-board-no-signal">--</span>}
                    {crossPlatformCount > 1 ? <span className="hot-board-cross-signal">{crossPlatformCount} 平台同榜</span> : null}
                  </div>
                  <div className="hot-board-time-cell"><Clock3 size={12} />{formatTime(item.updatedAt)}</div>
                  <div className="hot-board-row-actions">
                    <IconButton label={`打开原文：${item.title}`} icon={<ExternalLink size={15} />} disabled={openingUrl === item.url} onClick={() => openItemSource(item)} />
                    <Button className="hot-board-read-action" density="compact" variant="secondary" type="button" disabled={readingContent} onClick={() => openSourceDialog(item)}>
                      {readingContent ? <><Loader2 className="spin" size={12} />读取中</> : '正文'}
                    </Button>
                    <button className="hot-board-create-action" type="button" disabled={readingContent} onClick={() => void createFromTopic(item)}><Sparkles size={14} />去创作</button>
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

      <Dialog
        open={Boolean(readerItem)}
        onOpenChange={(open) => { if (!open) setReaderItem(null); }}
        title={readerItem ? <span className="hot-board-reader-title">热点正文</span> : '热点正文'}
        actions={readerItem ? (
          <div className="hot-board-reader-actions">
            <Button density="compact" variant="subtle" type="button" onClick={() => setReaderItem(null)}>关闭</Button>
            <Button density="compact" variant="secondary" type="button" disabled={openingUrl === readerItem.url} onClick={() => openItemSource(readerItem)}>打开原文</Button>
            <Button density="compact" variant="primary" type="button" disabled={readingItemId === readerItem.id} onClick={retrySourceContent}>
              <RefreshCw className={readingItemId === readerItem.id ? 'spin' : undefined} size={13} />重新读取
            </Button>
          </div>
        ) : undefined}
      >
        {readerItem ? <HotBoardSourceReader
          item={readerItem}
          source={sourceContents[readerItem.id]}
          reading={readingItemId === readerItem.id}
          error={sourceReadErrors[readerItem.id]}
          searchResults={searchResults[readerItem.id] ?? []}
          searchBackendStatuses={searchBackendStatuses[readerItem.id] ?? []}
          searching={searchingItemId === readerItem.id}
          searchError={searchErrors[readerItem.id]}
          searchEmpty={searchEmpty[readerItem.id] === true}
          onRetrySearch={retrySearchContent}
          onOpenUrl={openUrl}
        /> : null}
      </Dialog>
    </div>
  );
}

function HotBoardSourceReader({
  item,
  source,
  reading,
  error,
  searchResults,
  searchBackendStatuses,
  searching,
  searchError,
  searchEmpty,
  onRetrySearch,
  onOpenUrl,
}: {
  item: HotBoardItem;
  source?: HotBoardSourceContent;
  reading: boolean;
  error?: string;
  searchResults: AiSourceSection[];
  searchBackendStatuses: WebSearchBackendStatus[];
  searching: boolean;
  searchError?: string;
  searchEmpty: boolean;
  onRetrySearch: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const contentLabel = source?.kind === 'page' ? '页面正文' : '来源摘要';
  const visualContentLabel = source?.kind === 'page' ? '图文正文' : '图文摘要';
  const mediaCount = source?.media?.length ?? 0;
  return (
    <div className="hot-board-source-reader" data-hot-board-source-reader>
      <div className="hot-board-reader-meta">
        <span className="hot-board-platform-badge">{item.platformLabel}</span>
        <span>{item.sourceLabel}</span>
        <span>{formatDateTime(item.updatedAt)} 更新</span>
      </div>
      <h3>{item.title}</h3>
      {reading ? <div className="hot-board-reader-state" role="status" aria-live="polite"><Loader2 className="spin" size={17} />正在读取页面正文…</div> : null}
      {!reading && error && !source ? <div className="hot-board-reader-state hot-board-reader-state--error" role="alert"><TriangleAlert size={17} /><div><strong>正文暂时无法读取</strong><p>{error}</p></div></div> : null}
      {!reading && source?.kind === 'unavailable' ? <div className="hot-board-reader-state"><TriangleAlert size={17} /><div><strong>暂无可读正文</strong><p>{source.warning || '来源没有提供页面正文或摘要，正在尝试联网搜索。'}</p></div></div> : null}
      {!reading && source && source.kind !== 'unavailable' && (source.content.trim() || mediaCount > 0) ? (
        <div className="hot-board-reader-content" data-content-kind={source.kind}>
          <div className="hot-board-reader-content-head">
            <span>{mediaCount > 0 ? visualContentLabel : contentLabel}</span>
            <small>{mediaCount > 0 ? `${mediaCount} 张 · ` : ''}{formatDateTime(source.fetchedAt)} 读取</small>
          </div>
          {source.warning ? <p className="hot-board-reader-warning">{source.warning}</p> : null}
          {mediaCount > 0 ? <HotBoardMediaGallery media={source.media!} title={item.title} /> : null}
          {source.content.trim() ? <div className="hot-board-reader-copy">{source.content}</div> : null}
        </div>
      ) : null}
      {searching ? <div className="hot-board-reader-search-state" role="status" aria-live="polite"><Loader2 className="spin" size={15} />正在联网搜索相关内容…</div> : null}
      {searchError ? <div className="hot-board-reader-state hot-board-reader-state--error" role="alert"><TriangleAlert size={17} /><div><strong>联网搜索失败</strong><p>{searchError}</p><Button density="compact" variant="secondary" type="button" disabled={searching} onClick={onRetrySearch}>重试联网搜索</Button></div></div> : null}
      {searchEmpty && !searchError ? <div className="hot-board-reader-state" role="status"><Search size={17} /><div><strong>没有找到可用的联网结果</strong><p>可以稍后重试，或直接打开原文查看。</p><Button density="compact" variant="secondary" type="button" disabled={searching} onClick={onRetrySearch}>再次联网搜索</Button></div></div> : null}
      {searchResults.length > 0 ? (
        <section className="hot-board-search-results" aria-label="联网搜索结果">
          <div className="hot-board-reader-content-head"><span><Search size={13} />联网搜索结果</span><small>{searchBackendStatuses.filter((status) => status.state === 'ready').map((status) => status.label).join(' · ') || '已搜索'} · {searchResults.length} 条</small></div>
          <div className="hot-board-search-result-list">
            {searchResults.map((result, index) => (
              <article className="hot-board-search-result" key={`${result.url || result.title}-${index}`}>
                <div className="hot-board-search-result-heading"><strong>{result.title}</strong><span>{result.source}</span></div>
                <p>{result.content || result.snippet || '该来源没有返回可读摘要。'}</p>
                {result.url ? <Button density="compact" variant="subtle" type="button" onClick={() => onOpenUrl(result.url!)}>打开来源 <ExternalLink size={12} /></Button> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HotBoardMediaGallery({ media, title }: { media: NonNullable<HotBoardSourceContent['media']>; title: string }) {
  const mediaKey = media.map((item) => item.url).join('\n');
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? undefined : media[selectedIndex];

  useEffect(() => {
    setFailedUrls(new Set());
    setSelectedIndex(null);
  }, [mediaKey]);

  function markFailed(url: string): void {
    setFailedUrls((current) => {
      if (current.has(url)) return current;
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }

  function moveSelection(offset: number): void {
    setSelectedIndex((current) => {
      if (current === null || media.length === 0) return current;
      return (current + offset + media.length) % media.length;
    });
  }

  if (selected) {
    return (
      <section className="hot-board-reader-gallery hot-board-reader-gallery--viewer" aria-label={`查看图片 ${(selectedIndex ?? 0) + 1}，共 ${media.length} 张`} data-hot-board-media-count={media.length}>
        <div className="hot-board-image-viewer-toolbar">
          <strong>查看图片 {(selectedIndex ?? 0) + 1} / {media.length}</strong>
          <div className="hot-board-image-viewer-actions">
            <IconButton label="上一张图片" icon={<ChevronLeft size={16} />} disabled={media.length <= 1} onClick={() => moveSelection(-1)} />
            <IconButton label="下一张图片" icon={<ChevronRight size={16} />} disabled={media.length <= 1} onClick={() => moveSelection(1)} />
            <IconButton label="返回图文" icon={<ArrowLeft size={16} />} onClick={() => setSelectedIndex(null)} />
          </div>
        </div>
        <div className="hot-board-image-viewer">
          {failedUrls.has(selected.url) ? (
            <div className="hot-board-image-viewer-fallback" role="status"><ImageOff size={24} /><strong>图片加载失败</strong><span>可打开原文查看该图片。</span></div>
          ) : (
            <img
              src={selected.url}
              alt={selected.alt || `${title} 图片 ${(selectedIndex ?? 0) + 1}`}
              loading="eager"
              referrerPolicy="no-referrer"
              onError={() => markFailed(selected.url)}
            />
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="hot-board-reader-gallery" aria-label={`页面图片，共 ${media.length} 张`} data-hot-board-media-count={media.length}>
      <div className="hot-board-reader-gallery-head"><strong>页面图片</strong><span>点击图片查看大图</span></div>
      <div className="hot-board-reader-gallery-grid" data-layout={media.length === 1 ? 'single' : 'grid'}>
        {media.map((item, index) => {
          const failed = failedUrls.has(item.url);
          const alt = item.alt || `${title} 图片 ${index + 1}`;
          return (
            <Button
              className="hot-board-reader-media"
              data-load-state={failed ? 'failed' : 'ready'}
              density="compact"
              variant="subtle"
              type="button"
              aria-label={`查看图片 ${index + 1}`}
              title={`查看图片 ${index + 1}`}
              key={item.url}
              onClick={() => setSelectedIndex(index)}
            >
              {failed ? (
                <span className="hot-board-reader-media-fallback"><ImageOff size={18} /><span>图片加载失败</span></span>
              ) : (
                <img src={item.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => markFailed(item.url)} />
              )}
              <span className="hot-board-reader-media-index"><Maximize2 size={12} />{index + 1}</span>
            </Button>
          );
        })}
      </div>
    </section>
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
