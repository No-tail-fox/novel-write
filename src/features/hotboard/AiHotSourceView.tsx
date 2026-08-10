import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type {
  AiHotCategory,
  AiHotDailyItem,
  AiHotDailyReport,
  AiHotItem,
  AiHotQueryRequest,
  AiHotQueryResult,
  AiHotWindow,
  InformationArchiveOrigin,
  ShellView,
} from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { EmptyState } from '../../components/EmptyState';
import { ArchiveDateControl, todayArchiveDate } from './ArchiveDateControl';
import '../../styles/features/aihot-source.css';

type AiHotMode = AiHotQueryRequest['mode'];

const AIHOT_TERMS_URL = 'https://aihot.virxact.com/terms';
const AIHOT_HOME_URL = 'https://aihot.virxact.com';
const MODE_OPTIONS: ReadonlyArray<{ id: AiHotMode; label: string; icon: typeof FileText }> = [
  { id: 'daily', label: '日报', icon: FileText },
  { id: 'selected', label: '精选', icon: Sparkles },
  { id: 'all', label: '全部', icon: Layers3 },
  { id: 'category', label: '分类', icon: Filter },
  { id: 'recent', label: '最近', icon: CalendarDays },
  { id: 'search', label: '搜索', icon: Search },
];
const CATEGORY_OPTIONS: ReadonlyArray<{ id: AiHotCategory; label: string }> = [
  { id: 'ai-models', label: '模型' },
  { id: 'ai-products', label: '产品' },
  { id: 'industry', label: '行业' },
  { id: 'paper', label: '论文' },
  { id: 'tip', label: '技巧' },
];
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((option) => [option.id, option.label]),
);

export function AiHotSourceView({
  api,
  navigate,
  isBrowserPreview,
  active,
  archiveDate,
  onArchiveDateChange,
}: {
  api: StoryDreamApi;
  navigate: (view: ShellView) => void;
  isBrowserPreview: boolean;
  active: boolean;
  archiveDate: string;
  onArchiveDateChange: (date: string) => void;
}) {
  const [mode, setMode] = useState<AiHotMode>('selected');
  const [windowValue, setWindowValue] = useState<AiHotWindow>('24h');
  const [category, setCategory] = useState<AiHotCategory>('ai-models');
  const [days, setDays] = useState(3);
  const [searchQuery, setSearchQuery] = useState('');
  const [result, setResult] = useState<AiHotQueryResult | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [archiveOrigin, setArchiveOrigin] = useState<InformationArchiveOrigin | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [openError, setOpenError] = useState('');
  const [openingUrl, setOpeningUrl] = useState('');
  const requestIdRef = useRef(0);
  const lastRequestRef = useRef<AiHotQueryRequest | null>(null);

  const runQuery = useCallback(async (request: AiHotQueryRequest, forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    lastRequestRef.current = request;
    setRefreshing(true);
    setErrorMessage('');
    try {
      const next = await api.queryAiHot({ query: request, date: archiveDate, forceRefresh });
      if (requestId !== requestIdRef.current) return;
      setArchiveOrigin(next.origin);
      setAvailableDates(next.availableDates);
      setResult(next.result);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setErrorMessage(formatAppErrorMessage(normalizeAppError(error)));
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }, [api, archiveDate]);

  useEffect(() => {
    if (!active) return;
    setResult(null);
    setArchiveOrigin(null);
    void runQuery(lastRequestRef.current ?? { mode: 'selected', window: '24h' });
  }, [active, runQuery]);

  const itemCount = useMemo(() => resultItemCount(result), [result]);
  const fetchedAtLabel = result ? formatDateTime(result.receivedAt) : '尚未归档';
  const isToday = archiveDate === todayArchiveDate();
  const runtimeState = refreshing
    ? 'refreshing'
    : isBrowserPreview
      ? 'preview'
      : errorMessage && !result
        ? 'unavailable'
        : errorMessage
          ? 'partial'
          : result
            ? 'ready'
            : 'idle';
  const runtimeLabel = runtimeState === 'refreshing'
    ? '正在查询'
    : runtimeState === 'preview'
      ? '预览受限'
      : runtimeState === 'partial'
        ? '保留旧结果'
        : runtimeState === 'unavailable'
          ? '查询异常'
          : runtimeState === 'idle'
            ? archiveOrigin === 'missing' ? '该日无归档' : '等待查询'
            : result?.unchanged
              ? '内容未变化'
              : !isToday
                ? '历史归档'
                : archiveOrigin === 'cache'
                  ? '今日已保存'
                  : 'AIHOT 数据';
  const sourceHeaderLabel = runtimeState === 'preview'
    ? '接口已配置'
    : runtimeState === 'refreshing'
      ? '连接中'
      : runtimeState === 'unavailable'
        ? '连接异常'
        : runtimeState === 'partial'
          ? '服务波动'
          : runtimeState === 'idle'
            ? archiveOrigin === 'missing' ? '无归档' : '待查询'
            : '已接入';
  const sourceConnectionLabel = runtimeState === 'ready' ? '可用' : runtimeLabel;

  function requestForMode(nextMode: AiHotMode): AiHotQueryRequest | null {
    switch (nextMode) {
      case 'daily': return { mode: 'daily' };
      case 'selected': return { mode: 'selected', window: windowValue };
      case 'all': return { mode: 'all', window: windowValue };
      case 'category': return { mode: 'category', category, window: windowValue };
      case 'recent': return { mode: 'recent', days };
      case 'search': {
        const query = searchQuery.trim();
        return query.length >= 2 ? { mode: 'search', query, window: windowValue } : null;
      }
    }
  }

  function activateMode(nextMode: AiHotMode): void {
    if (nextMode !== mode) {
      ++requestIdRef.current;
      setRefreshing(false);
      setResult(null);
      setArchiveOrigin(null);
      lastRequestRef.current = null;
    }
    setMode(nextMode);
    setErrorMessage('');
    const request = requestForMode(nextMode);
    if (request) void runQuery(request);
    else {
      setResult(null);
      lastRequestRef.current = null;
    }
  }

  function handleSearchQueryChange(nextValue: string): void {
    setSearchQuery(nextValue);
    if (nextValue.trim().length >= 2) return;
    ++requestIdRef.current;
    lastRequestRef.current = null;
    setResult(null);
    setRefreshing(false);
    setErrorMessage('');
  }

  function submitQuery(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const request = requestForMode(mode);
    if (!request) {
      ++requestIdRef.current;
      lastRequestRef.current = null;
      setResult(null);
      setRefreshing(false);
      setErrorMessage('请输入至少 2 个字的搜索关键词。');
      return;
    }
    void runQuery(request);
  }

  function refresh(): void {
    const request = requestForMode(mode);
    if (request) void runQuery(request, true);
  }

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

  function createFromItem(item: AiHotItem): void {
    storeTopic({
      title: item.title,
      url: item.aihotUrl,
      summary: item.summary ?? '',
      sourceName: item.sourceName,
      publishedAt: item.displayedAt,
      queryContext: result?.queryLabel ?? '',
      hotValue: item.score === null ? '' : `AIHOT 评分 ${item.score}`,
    });
  }

  function createFromDailyItem(item: AiHotDailyItem, sectionLabel: string): void {
    storeTopic({
      title: item.title,
      url: item.aihotUrl || item.originalUrl,
      summary: item.summary ?? '',
      sourceName: item.sourceName,
      publishedAt: item.publishedAt ?? result?.receivedAt ?? '',
      queryContext: `${result?.queryLabel ?? 'AIHOT 日报'} · ${sectionLabel}`,
      hotValue: '',
    });
  }

  function storeTopic(input: {
    title: string;
    url: string;
    summary: string;
    sourceName: string;
    publishedAt: string;
    queryContext: string;
    hotValue: string;
  }): void {
    sessionStorage.setItem('hotboard_topic', JSON.stringify({
      ...input,
      platformLabel: 'AIHOT',
    }));
    navigate('new-task');
  }

  return (
    <section className="aihot-source-view" data-aihot-source-view aria-label="AI 信息源" hidden={!active}>
      <section className="hot-board-summary aihot-summary" aria-label="AI 信息源查询概况">
        <div><span>当前视图</span><strong>{MODE_OPTIONS.find((option) => option.id === mode)?.label}</strong></div>
        <div><span>返回条目</span><strong>{itemCount}</strong></div>
        <div><span>查询范围</span><strong className="scope-value">{result?.queryLabel ?? modeLabel(mode)}</strong></div>
        <div><span>本次同步</span><strong className="time-value">{fetchedAtLabel}</strong></div>
        <div className="hot-board-refresh-controls">
          <ArchiveDateControl date={archiveDate} availableDates={availableDates} origin={archiveOrigin} onChange={onArchiveDateChange} />
          <button
            className="ghost-action compact-action"
            type="button"
            title={isToday ? '重新查询并覆盖今天的已保存结果' : '历史归档只读，不能用实时结果覆盖'}
            disabled={refreshing || isBrowserPreview || !isToday || !requestForMode(mode)}
            onClick={refresh}
          >
            <RefreshCw className={refreshing ? 'spin' : ''} size={15} />
            {refreshing ? '查询中' : '立即刷新'}
          </button>
        </div>
      </section>

      <div className="aihot-query-bar">
        <div className="aihot-mode-tabs" role="tablist" aria-label="AI 信息源模式">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={mode === option.id}
                className={mode === option.id ? 'active' : ''}
                onClick={() => activateMode(option.id)}
              >
                <Icon size={14} />{option.label}
              </button>
            );
          })}
        </div>
        <form className="aihot-query-controls" aria-label="AI 信息源查询条件" onSubmit={submitQuery}>
          {mode === 'category' ? (
            <label className="aihot-control-field"><span>分类</span><select aria-label="AI 分类" value={category} onChange={(event) => setCategory(event.target.value as AiHotCategory)}>{CATEGORY_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
          ) : null}
          {mode === 'recent' ? (
            <label className="aihot-control-field"><span>最近天数</span><input aria-label="最近天数" type="number" min="1" max="7" step="1" value={days} onChange={(event) => setDays(clampDays(event.target.value))} /></label>
          ) : null}
          {mode === 'search' ? (
            <label className="aihot-search-field"><Search size={14} /><input aria-label="搜索 AI 信息源" value={searchQuery} maxLength={200} onChange={(event) => handleSearchQueryChange(event.target.value)} placeholder="公司、产品或主题" /></label>
          ) : null}
          {mode !== 'daily' && mode !== 'recent' ? (
            <label className="aihot-control-field"><span>时间窗</span><select aria-label="AI 信息源时间窗" value={windowValue} onChange={(event) => setWindowValue(event.target.value as AiHotWindow)}><option value="24h">过去 24 小时</option><option value="7d">最近 7 天</option></select></label>
          ) : null}
          <button className="primary-action slim" type="submit" disabled={refreshing || (mode === 'search' && searchQuery.trim().length < 2)}>
            {refreshing ? <Loader2 className="spin" size={14} /> : <Search size={14} />}{isToday ? '查询' : '查看归档'}
          </button>
        </form>
      </div>

      {errorMessage || openError || result?.warnings.length ? (
        <div className="hot-board-warning" role={errorMessage || openError ? 'alert' : 'status'} aria-live={errorMessage || openError ? 'assertive' : 'polite'}>
          <TriangleAlert size={15} />
          <span>{errorMessage || openError || result?.warnings.join('；')}</span>
        </div>
      ) : null}

      <div className="hot-board-body aihot-body">
        <section className="hot-board-feed aihot-feed" aria-label="AI 信息源结果" aria-busy={refreshing}>
          <header className="hot-board-feed-head">
            <div><h2>{result?.queryLabel ?? 'AIHOT 信息流'}</h2><span>{result ? resultStatus(result) : '匿名只读 · 服务端实时查询'}</span></div>
            <div className="hot-board-live-state" data-state={runtimeState}>
              <span />{runtimeLabel}
            </div>
          </header>

          {!result && refreshing ? <AiHotLoadingRows /> : null}
          {!result && !refreshing && mode === 'search' && !errorMessage && archiveOrigin !== 'missing' ? (
            <EmptyState title="等待搜索" description="输入至少 2 个字的公司、产品或主题。" />
          ) : null}
          {!result && !refreshing && errorMessage ? (
            <EmptyState title="AI 信息源暂时不可用" description={errorMessage} tone="error" action={<button className="ghost-action slim" type="button" onClick={refresh}>重新查询</button>} />
          ) : null}
          {!result && !refreshing && archiveOrigin === 'missing' && !errorMessage ? (
            <EmptyState title="该日期没有已保存的 AI 信息" description="历史日期只显示此前实际查询并保存的结果，不会使用今天的数据补齐。" />
          ) : null}
          {result?.kind === 'items' && result.items.length === 0 ? (
            <EmptyState title="没有找到相关 AI 动态" description="当前范围内没有可展示的公开条目。" />
          ) : null}
          {result?.kind === 'items' ? (
            <div className="hot-board-list">
              {result.items.map((item, index) => (
                <AiHotItemRow
                  item={item}
                  index={index}
                  key={item.id}
                  openingUrl={openingUrl}
                  openUrl={openUrl}
                  createFromItem={createFromItem}
                />
              ))}
            </div>
          ) : null}
          {result?.kind === 'daily' && !result.report ? <EmptyState title="暂无可用日报" description={result.warnings[0] ?? 'AIHOT 当前没有可用日报。'} /> : null}
          {result?.kind === 'daily' && result.report ? (
            <AiHotDailyFeed report={result.report} openingUrl={openingUrl} openUrl={openUrl} createFromItem={createFromDailyItem} />
          ) : null}
        </section>

        <aside className="hot-board-source-rail aihot-source-rail" aria-label="AIHOT 来源状态">
          <header><div><h2>AIHOT</h2><span>中文 AI 资讯 · v1 匿名接口</span></div><strong data-state={runtimeState}>{sourceHeaderLabel}</strong></header>
          <div className="aihot-source-status">
            <div data-state={runtimeState}><CheckCircle2 size={14} /><span>连接状态</span><strong>{sourceConnectionLabel}</strong></div>
            <div><Clock3 size={14} /><span>刷新策略</span><strong>每日首次</strong></div>
            <div><ShieldCheck size={14} /><span>访问方式</span><strong>无需 Key</strong></div>
          </div>
          <section className="aihot-license-note">
            <ShieldCheck size={16} />
            <div><strong>使用范围</strong><p>个人非商业、公益非商业和组织内部使用可免费访问；对外商业产品、客户交付、白标或批量再分发需取得 AIHOT 书面授权。</p></div>
          </section>
          <div className="aihot-source-links">
            <button type="button" disabled={openingUrl === AIHOT_HOME_URL} onClick={() => void openUrl(AIHOT_HOME_URL)}><BookOpen size={14} /><span><strong>AIHOT 站点</strong><small>查看站内日报与资讯</small></span><ExternalLink size={13} /></button>
            <button type="button" disabled={openingUrl === AIHOT_TERMS_URL} onClick={() => void openUrl(AIHOT_TERMS_URL)}><ShieldCheck size={14} /><span><strong>用途与授权条款</strong><small>wzglyay@virxact.com</small></span><ExternalLink size={13} /></button>
          </div>
          <div className="aihot-source-footnote">条目按 AIHOT 返回顺序展示；评分不用于本地重排。第三方数字、政策和原话请回原文核对。</div>
        </aside>
      </div>
    </section>
  );
}

function AiHotItemRow({
  item,
  index,
  openingUrl,
  openUrl,
  createFromItem,
}: {
  item: AiHotItem;
  index: number;
  openingUrl: string;
  openUrl: (url: string) => Promise<void>;
  createFromItem: (item: AiHotItem) => void;
}) {
  return (
    <article className="hot-board-row aihot-item-row" data-selected={item.selected ? 'true' : 'false'}>
      <div className="hot-board-rank">{index + 1}</div>
      <div className="hot-board-item-main">
        <div className="hot-board-item-kicker">
          <span className="hot-board-platform-badge">{item.category ? CATEGORY_LABELS[item.category] ?? item.category : 'AI 动态'}</span>
          <span className="aihot-selection-state">{item.selected ? '精选' : '全量池'}</span>
          {item.score !== null ? <span className="aihot-score">评分 {item.score}</span> : null}
        </div>
        <h3 className="hot-board-item-title">{item.title}</h3>
        {item.summary ? <p>{item.summary}</p> : null}
        <div className="hot-board-item-meta">
          <span><Clock3 size={12} />{item.displayedAtKind === 'published' ? '发布' : 'AIHOT 收录'} {formatDateTime(item.displayedAt)}</span>
          <span>来源 {item.sourceName}</span>
        </div>
      </div>
      <div className="hot-board-row-actions">
        <button className="icon-button" type="button" title="打开 AIHOT" aria-label={`打开 AIHOT：${item.title}`} disabled={openingUrl === item.aihotUrl} onClick={() => void openUrl(item.aihotUrl)}><ExternalLink size={15} /></button>
        <button className="hot-board-create-action" type="button" onClick={() => createFromItem(item)}><Sparkles size={14} />去创作</button>
      </div>
    </article>
  );
}

function AiHotDailyFeed({
  report,
  openingUrl,
  openUrl,
  createFromItem,
}: {
  report: AiHotDailyReport;
  openingUrl: string;
  openUrl: (url: string) => Promise<void>;
  createFromItem: (item: AiHotDailyItem, sectionLabel: string) => void;
}) {
  return (
    <div className="aihot-daily">
      {report.lead ? <section className="aihot-daily-lead"><span>今日导语</span><h3>{report.lead.title}</h3><p>{report.lead.paragraph}</p></section> : null}
      {report.sections.map((section) => (
        <section className="aihot-daily-section" key={section.label}>
          <header><h3>{section.label}</h3><span>{section.items.length} 条</span></header>
          {section.items.map((item) => (
            <AiHotDailyRow item={item} sectionLabel={section.label} openingUrl={openingUrl} openUrl={openUrl} createFromItem={createFromItem} key={item.id} />
          ))}
        </section>
      ))}
      {report.flashes.length ? (
        <section className="aihot-daily-section">
          <header><h3>快讯</h3><span>{report.flashes.length} 条</span></header>
          {report.flashes.map((item) => (
            <AiHotDailyRow item={item} sectionLabel="快讯" openingUrl={openingUrl} openUrl={openUrl} createFromItem={createFromItem} key={item.id} />
          ))}
        </section>
      ) : null}
      <button className="aihot-daily-link" type="button" disabled={openingUrl === report.aihotUrl} onClick={() => void openUrl(report.aihotUrl)}><BookOpen size={14} />打开完整日报<ExternalLink size={13} /></button>
    </div>
  );
}

function AiHotDailyRow({
  item,
  sectionLabel,
  openingUrl,
  openUrl,
  createFromItem,
}: {
  item: AiHotDailyItem;
  sectionLabel: string;
  openingUrl: string;
  openUrl: (url: string) => Promise<void>;
  createFromItem: (item: AiHotDailyItem, sectionLabel: string) => void;
}) {
  const target = item.aihotUrl || item.originalUrl;
  return (
    <article className="aihot-daily-row">
      <div><h4>{item.title}</h4>{item.summary ? <p>{item.summary}</p> : null}<small>{item.sourceName}{item.publishedAt ? ` · ${formatDateTime(item.publishedAt)}` : ''}</small></div>
      <div className="hot-board-row-actions">
        <button className="icon-button" type="button" title="打开来源" aria-label={`打开来源：${item.title}`} disabled={openingUrl === target} onClick={() => void openUrl(target)}><ExternalLink size={15} /></button>
        <button className="hot-board-create-action" type="button" onClick={() => createFromItem(item, sectionLabel)}><Sparkles size={14} />去创作</button>
      </div>
    </article>
  );
}

function AiHotLoadingRows() {
  return <div className="hot-board-loading" role="status" aria-live="polite" aria-label="正在查询 AI 信息源">{Array.from({ length: 7 }, (_, index) => <div key={index}><span /><div><strong /><small /></div></div>)}</div>;
}

function resultItemCount(result: AiHotQueryResult | null): number {
  if (!result) return 0;
  if (result.kind === 'items') return result.items.length;
  if (!result.report) return 0;
  return result.report.sections.reduce((total, section) => total + section.items.length, 0) + result.report.flashes.length;
}

function resultStatus(result: AiHotQueryResult): string {
  if (result.kind === 'daily') return result.report ? `${result.report.sections.length} 个主题 · 固定日切成品` : '当前没有可用日报';
  const continuation = result.hasMore ? ' · 仍有更多' : '';
  return `${result.count} 条 · 保持 AIHOT 原始顺序${continuation}`;
}

function modeLabel(mode: AiHotMode): string {
  switch (mode) {
    case 'daily': return '最新 AI 日报';
    case 'selected': return '过去 24 小时精选';
    case 'all': return '过去 24 小时全部动态';
    case 'category': return '模型分类';
    case 'recent': return '最近 3 天精选';
    case 'search': return '关键词搜索';
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function clampDays(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(7, Math.round(parsed)));
}
