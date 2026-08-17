import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  GitCompareArrows,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { benchmarkOpportunityTotal, benchmarkPlatformLabel } from '../../shared/benchmark-monitoring';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  BenchmarkOpportunityInputs,
  BenchmarkSelectionScore,
  BookDiscoveryResult,
  BookProductInfo,
  BookSelectionIdentity,
  BookSelectionRecord,
  ShellView,
} from '../../shared/types';
import {
  Button,
  CheckboxField,
  Dialog,
  IconButton,
  SegmentedControl,
  SelectField,
  SliderField,
  Tabs,
  TextAreaField,
  TextField,
  Tooltip,
} from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { emptyToUndefined } from '../tasks/task-formatters';
import '../../styles/features/local-labs.css';

type SelectionWorkspaceTab = 'ranking' | 'compare' | 'brief';
type SelectionInspectorTab = 'profile' | 'score' | 'evidence' | 'brief';
type SelectionStatusFilter = 'all' | NonNullable<BookProductInfo['selectionStatus']>;
type PotentialFilter = 'all' | 'high' | 'very-high';

const quickTracks = [
  { id: 'women', label: '人物传记·女性', query: '女性人物传记', track: '人物传记·女性' },
  { id: 'business', label: '人物传记·商业', query: '商业人物传记', track: '人物传记·商业' },
  { id: 'commerce', label: '商业人物', query: '商业人物', track: '商业人物' },
  { id: 'anti-aging', label: '健康·抗衰养生', query: '抗衰养生保健', track: '健康·抗衰养生' },
  { id: 'medicine', label: '健康·中医食疗', query: '中医食疗养生', track: '健康·中医食疗' },
  { id: 'culture', label: '传统文化·国学', query: '传统文化国学', track: '传统文化·国学' },
  { id: 'growth', label: '认知思维·成长', query: '认知思维成长', track: '认知思维·成长' },
  { id: 'finance', label: '财商·理财', query: '财商理财', track: '财商·理财' },
  { id: 'parenting', label: '育儿·亲子', query: '家庭教育亲子', track: '育儿·亲子' },
] as const;

const scoreFields: Array<[keyof BenchmarkOpportunityInputs, string]> = [
  ['demand', '需求热度'],
  ['gap', '内容缺口'],
  ['fit', '账号匹配'],
  ['conversion', '转化证据'],
  ['executionEase', '执行便利度'],
];

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'candidate', label: '候选' },
  { value: 'watching', label: '已收藏' },
  { value: 'planned', label: '计划创作' },
  { value: 'created', label: '已创作' },
  { value: 'rejected', label: '已淘汰' },
] as const;

export function BookSelectionPage({ api, navigate }: { api: StoryDreamApi; navigate: (view: ShellView) => void }) {
  const defaultTrack = quickTracks[3];
  const [records, setRecords] = useState<BookSelectionRecord[]>([]);
  const [discovery, setDiscovery] = useState<BookDiscoveryResult | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<BookSelectionIdentity | null>(null);
  const [draftBookId, setDraftBookId] = useState('');
  const [comparisonSelectionIds, setComparisonSelectionIds] = useState<string[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<SelectionWorkspaceTab>('ranking');
  const [inspectorTab, setInspectorTab] = useState<SelectionInspectorTab>('profile');
  const [detailOpen, setDetailOpen] = useState(false);
  const [query, setQuery] = useState<string>(defaultTrack.query);
  const [activeTrackId, setActiveTrackId] = useState<string>(defaultTrack.id);
  const [track, setTrack] = useState<string>(defaultTrack.track);
  const [listSearch, setListSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [potentialFilter, setPotentialFilter] = useState<PotentialFilter>('all');
  const [statusFilter, setStatusFilter] = useState<SelectionStatusFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [initialDiscoveryPending, setInitialDiscoveryPending] = useState(true);
  const [draft, setDraft] = useState<BookProductInfo>(() => emptyProductDraft());
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<'save' | `delete:${string}` | `favorite:${string}` | `create:${string}` | null>(null);
  const bookAction = useAsyncAction();
  const discoveryAction = useAsyncAction();

  const savedBySource = useMemo(() => new Map(records.map((record) => [record.data.sourceId || record.bookId, record])), [records]);
  const rankingRecords = useMemo(() => (discovery?.items ?? []).map<BookSelectionRecord>((item) => {
    const saved = savedBySource.get(item.sourceId);
    return saved ? {
      ...saved,
      data: {
        ...item,
        ...saved.data,
        source: item.source,
        sourceState: item.sourceState,
        sourceRank: item.sourceRank,
        rankingLabel: item.rankingLabel,
        coverUrl: item.coverUrl || saved.data.coverUrl,
        reviewCount: item.reviewCount ?? saved.data.reviewCount,
        price: item.price || saved.data.price,
      },
    } : { theme: track, bookId: item.sourceId, data: item, updatedAt: discovery?.fetchedAt ?? Date.now() };
  }), [discovery, savedBySource, track]);
  const baseRecords = favoritesOnly ? records.filter((record) => isFavorite(record.data)) : rankingRecords;
  const categoryOptions = useMemo(() => [
    { value: 'all', label: '全部分类' },
    ...[...new Set([...rankingRecords, ...records].map((record) => record.data.category).filter((value): value is string => Boolean(value)))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
      .map((value) => ({ value, label: value })),
  ], [rankingRecords, records]);
  const filteredRecords = useMemo(() => baseRecords
    .filter((record) => categoryFilter === 'all' || record.data.category === categoryFilter)
    .filter((record) => statusFilter === 'all' || (record.data.selectionStatus ?? 'candidate') === statusFilter)
    .filter((record) => {
      const score = record.data.opportunityScore?.total ?? 0;
      return potentialFilter === 'all' || (potentialFilter === 'very-high' ? score >= 85 : score >= 75);
    })
    .filter((record) => {
      const normalized = listSearch.trim().toLowerCase();
      if (!normalized) return true;
      return [record.data.name, record.data.author, record.data.publisher, record.data.category, record.data.keyword, record.data.sellPoint]
        .some((value) => value?.toLowerCase().includes(normalized));
    }), [baseRecords, categoryFilter, listSearch, potentialFilter, statusFilter]);
  const comparisonRecords = comparisonSelectionIds
    .map((id) => [...rankingRecords, ...records].find((record) => selectionKey(record) === id))
    .filter((record): record is BookSelectionRecord => Boolean(record))
    .filter((record, index, items) => items.findIndex((item) => selectionKey(item) === selectionKey(record)) === index);
  const selectedRecord = selectedIdentity
    ? records.find((record) => identitiesEqual(selectedIdentity, record)) ?? null
    : null;
  const draftScore = draft.opportunityScore ?? defaultOpportunityScore();
  const discoveryBusy = initialDiscoveryPending || discoveryAction.busy;

  useEffect(() => {
    let active = true;
    void Promise.all([api.listBookSelections(), api.discoverBooks({ query: defaultTrack.query, track: defaultTrack.track, limit: 24 })])
      .then(([saved, result]) => {
        if (!active) return;
        setRecords(saved);
        setDiscovery(result);
      })
      .catch((error) => {
        if (active) discoveryAction.reportError(error);
      })
      .finally(() => {
        if (active) setInitialDiscoveryPending(false);
      });
    return () => {
      active = false;
    };
  }, [api, discoveryAction.reportError]);

  async function reload(preferred?: BookSelectionIdentity | null) {
    const items = await api.listBookSelections();
    setRecords(items);
    const identity = preferred ?? selectedIdentity;
    const next = identity ? items.find((record) => identitiesEqual(identity, record)) : null;
    if (next) loadRecord(next, true);
  }

  async function generateRanking(nextQuery = query, nextTrack = track) {
    const normalizedQuery = nextQuery.trim();
    if (!normalizedQuery) {
      setMessage('请输入人群、主题方向或具体书名。');
      return;
    }
    await discoveryAction.run(async () => {
      const result = await api.discoverBooks({ query: normalizedQuery, track: nextTrack, limit: 24 });
      setDiscovery(result);
      setQuery(normalizedQuery);
      setTrack(nextTrack);
      setFavoritesOnly(false);
      setCategoryFilter('all');
      setWorkspaceTab('ranking');
      setMessage(result.message);
    }, { onError: (error) => setMessage(error.message) });
  }

  function activateQuickTrack(item: (typeof quickTracks)[number]) {
    setActiveTrackId(item.id);
    setQuery(item.query);
    setTrack(item.track);
    void generateRanking(item.query, item.track);
  }

  function loadRecord(record: BookSelectionRecord, saved = Boolean(findSavedRecord(record))) {
    const persisted = saved ? findSavedRecord(record) : null;
    if (persisted) setSelectedIdentity({ theme: persisted.theme, bookId: persisted.bookId });
    else setSelectedIdentity({ theme: record.theme, bookId: record.bookId });
    setDraftBookId(persisted?.bookId ?? record.bookId);
    setTrack(record.theme);
    setDraft(cloneProductInfo(record.data));
    setInspectorTab('profile');
    setDetailOpen(true);
    setMessage('');
  }

  function clearForm() {
    setSelectedIdentity(null);
    setDraftBookId('');
    setDraft(emptyProductDraft());
    setInspectorTab('profile');
    setDetailOpen(true);
    setMessage('');
  }

  function updateDraft(patch: Partial<BookProductInfo>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateScore(field: keyof BenchmarkOpportunityInputs, value: number) {
    setDraft((current) => {
      const previous = current.opportunityScore ?? defaultOpportunityScore();
      const inputs = { ...previous, [field]: clampScore(value) };
      return { ...current, opportunityScore: { ...inputs, total: benchmarkOpportunityTotal(inputs) } };
    });
  }

  async function saveSelection() {
    if (!draft.name.trim()) {
      setMessage('请先填写商品 / 书名。');
      return;
    }
    await bookAction.run(async () => {
      setPendingAction('save');
      try {
        const saved = await api.saveBookSelection({
          theme: track.trim() || draft.category || '图书带货',
          bookId: draftBookId || draft.sourceId,
          previousIdentity: selectedIdentity ?? undefined,
          data: normalizedProduct(draft),
        });
        setSelectedIdentity({ theme: saved.theme, bookId: saved.bookId });
        setDraftBookId(saved.bookId);
        await reload({ theme: saved.theme, bookId: saved.bookId });
        setMessage('选品资料、评分与证据已保存。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function deleteSelection(record: BookSelectionRecord) {
    const saved = findSavedRecord(record);
    if (!saved || !window.confirm(`删除选品「${saved.data.name}」？`)) return;
    await bookAction.run(async () => {
      setPendingAction(`delete:${saved.bookId}`);
      try {
        await api.deleteBookSelection(saved.theme, saved.bookId);
        setComparisonSelectionIds((items) => items.filter((item) => item !== selectionKey(saved)));
        setDetailOpen(false);
        setSelectedIdentity(null);
        await reload(null);
        setMessage('已删除选品。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function toggleFavorite(record: BookSelectionRecord) {
    const existing = findSavedRecord(record);
    const favorite = isFavorite(existing?.data ?? record.data);
    await bookAction.run(async () => {
      setPendingAction(`favorite:${record.bookId}`);
      try {
        await persistRecord(record, { selectionStatus: favorite ? 'candidate' : 'watching' });
        setRecords(await api.listBookSelections());
        setMessage(favorite ? '已取消收藏，书目仍保留在候选池。' : '已收藏到书单。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  function toggleComparison(record: BookSelectionRecord) {
    const key = selectionKey(record);
    setComparisonSelectionIds((items) => {
      if (items.includes(key)) return items.filter((item) => item !== key);
      if (items.length >= 4) {
        setMessage('对比台最多同时保留 4 本书，请先移除一项。');
        return items;
      }
      return [...items, key];
    });
  }

  async function createFromBook(record: BookSelectionRecord) {
    await bookAction.run(async () => {
      setPendingAction(`create:${record.bookId}`);
      try {
        const prepared = {
          ...record,
          data: {
            ...record.data,
            selectionStatus: 'planned' as const,
            creativeBrief: record.data.creativeBrief || composeCreativeBrief(record.theme, record.data),
          },
        };
        const saved = await persistRecord(prepared, prepared.data);
        handoffProduct(saved, 'new-task');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  function handoffProduct(record: BookSelectionRecord, view: ShellView) {
    if (view === 'new-task') {
      sessionStorage.setItem('book_product_info', JSON.stringify(record.data));
      sessionStorage.setItem('book_product_track', bookTrackFor(record.theme, record.data));
    }
    if (view === 'benchmark') sessionStorage.setItem('benchmark_search', record.data.keyword || record.data.name);
    navigate(view);
  }

  function focusEvidence(postId: string) {
    sessionStorage.setItem('benchmark_focus_post', postId);
    navigate('benchmark');
  }

  function generateCreativeBrief() {
    updateDraft({ creativeBrief: composeCreativeBrief(track, draft) });
    setInspectorTab('brief');
    setMessage('已根据当前书目、来源和风险边界生成可编辑简报草稿。');
  }

  async function persistRecord(record: BookSelectionRecord, patch: Partial<BookProductInfo>) {
    const existing = findSavedRecord(record);
    return api.saveBookSelection({
      theme: existing?.theme ?? record.theme,
      bookId: existing?.bookId ?? record.bookId,
      previousIdentity: existing ? { theme: existing.theme, bookId: existing.bookId } : undefined,
      data: normalizedProduct({ ...record.data, ...existing?.data, ...patch }),
    });
  }

  function findSavedRecord(record: BookSelectionRecord) {
    return records.find((item) => item.bookId === record.bookId || (record.data.sourceId && item.data.sourceId === record.data.sourceId)) ?? null;
  }

  const detailRecord: BookSelectionRecord = {
    theme: track,
    bookId: draftBookId,
    data: draft,
    updatedAt: selectedRecord?.updatedAt ?? Date.now(),
  };

  return (
    <div className="local-lab-workbench selection-grid" data-local-lab-workbench="book-selection">
      <header className="selection-discovery-header">
        <div className="selection-title-row">
          <div>
            <span className="selection-title-kicker">选品助手 · 图书带货</span>
            <strong>从公开书目中筛出值得创作的题材</strong>
          </div>
          <span className={`selection-source-badge ${discovery?.sourceState ?? 'loading'}`} data-source-state={discovery?.sourceState ?? 'loading'}>
            {discovery?.sourceState === 'live' ? '真实公开数据' : discovery?.sourceState === 'preview' ? '预览数据' : '正在连接当当'}
          </span>
        </div>
        <div className="selection-query-row">
          <TextField
            label="选书主题"
            fieldClassName="selection-query-field"
            contentBefore={<Search size={16} />}
            value={query}
            placeholder="输入人群、主题方向或具体书名"
            onChange={(_, data) => setQuery(data.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void generateRanking();
            }}
          />
          <Button variant="primary" density="spacious" icon={discoveryBusy ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />} disabled={discoveryBusy || !query.trim()} onClick={() => void generateRanking()}>
            生成榜单
          </Button>
        </div>
        <div className="selection-track-rail" aria-label="快捷赛道">
          <span>快捷赛道</span>
          <div>
            {quickTracks.map((item) => (
              <Button key={item.id} variant={activeTrackId === item.id ? 'primary' : 'secondary'} density="compact" onClick={() => activateQuickTrack(item)}>{item.label}</Button>
            ))}
          </div>
        </div>
        <p className="selection-source-note">数据来源：当当公开搜索页面。公开评论量不是销量；带货潜力、细分类和核心卖点均为智能建议，需要人工确认。</p>
      </header>

      <div className="selection-workspace-toolbar">
        <SegmentedControl
          label="选品视图"
          value={workspaceTab}
          onChange={setWorkspaceTab}
          options={[
            { value: 'ranking', label: '当当搜索榜', icon: <BookOpen size={14} /> },
            { value: 'compare', label: `对比台 ${comparisonSelectionIds.length}/4`, icon: <GitCompareArrows size={14} /> },
            { value: 'brief', label: '创作简报', icon: <FileText size={14} /> },
          ]}
        />
        <Button variant={favoritesOnly ? 'primary' : 'secondary'} density="compact" icon={<Star size={14} />} onClick={() => {
          setFavoritesOnly((value) => !value);
          setWorkspaceTab('ranking');
        }}>已存书单 ({records.length})</Button>
        <Tooltip content="重新读取当前主题的当当公开结果">
          <IconButton label="刷新榜单" icon={<RefreshCw size={15} />} variant="subtle" density="compact" disabled={discoveryBusy} onClick={() => void generateRanking()} />
        </Tooltip>
        <Button variant="secondary" density="compact" icon={<Plus size={14} />} onClick={clearForm}>手动添加</Button>
      </div>

      <main className="selection-main-panel">
        {workspaceTab === 'ranking' ? (
          <>
            <div className="selection-filter-row">
              <TextField label="书名 / 作者" fieldClassName="selection-list-search" value={listSearch} placeholder="搜索书名、作者、关键词" onChange={(_, data) => setListSearch(data.value)} />
              <SelectField label="分类" value={categoryFilter} options={categoryOptions} onChange={(event) => setCategoryFilter(event.target.value)} />
              <SelectField label="带货潜力" value={potentialFilter} options={[{ value: 'all', label: '全部潜力' }, { value: 'high', label: '高潜力 75+' }, { value: 'very-high', label: '极高潜力 85+' }]} onChange={(event) => setPotentialFilter(event.target.value as PotentialFilter)} />
              <SelectField label="创作状态" value={statusFilter} options={statusOptions} onChange={(event) => setStatusFilter(event.target.value as SelectionStatusFilter)} />
              <CheckboxField label="只看收藏" checked={favoritesOnly} onChange={(_, data) => setFavoritesOnly(Boolean(data.checked))} />
              <span className="selection-result-count">共 {filteredRecords.length} 本 · {favoritesOnly ? '已存书单' : discovery?.query || query}</span>
            </div>

            <div className="selection-ranking-table" role="table" aria-label="当当图书选品榜单">
              <div className="selection-ranking-head" role="row">
                <span role="columnheader">当当序</span>
                <span role="columnheader">书籍</span>
                <span className="selection-col-category" role="columnheader">细分类 <em>智能</em></span>
                <span className="selection-col-point" role="columnheader">核心卖点 <em>智能</em></span>
                <span className="selection-col-sales" role="columnheader">公开热度</span>
                <span role="columnheader">带货潜力 <em>智能</em></span>
                <span className="selection-col-video" role="columnheader">视频号</span>
                <span className="selection-col-keyword" role="columnheader">对标关键词</span>
                <span className="selection-col-status" role="columnheader">已创作</span>
                <span role="columnheader">操作</span>
              </div>
              <div className="selection-ranking-body">
                {discoveryBusy ? <div className="selection-loading-state"><Loader2 className="spin" size={22} /><span>正在读取当当公开书目并整理榜单</span></div> : null}
                {!discoveryBusy && filteredRecords.length === 0 ? <EmptyState title={favoritesOnly ? '还没有收藏书目' : '暂无匹配图书'} action={<Button density="compact" icon={<RefreshCw size={14} />} onClick={() => void generateRanking()}>重新生成</Button>} /> : null}
                {!discoveryBusy && filteredRecords.map((record, index) => {
                  const score = record.data.opportunityScore?.total ?? 0;
                  const favorite = isFavorite(findSavedRecord(record)?.data ?? record.data);
                  const comparing = comparisonSelectionIds.includes(selectionKey(record));
                  return (
                    <div key={selectionKey(record)} className="selection-ranking-row" role="row" data-source-state={record.data.sourceState ?? 'saved'}>
                      <span className="selection-rank-cell">{record.data.sourceRank ?? index + 1}</span>
                      <div className="selection-book-cell">
                        <BookCover data={record.data} />
                        <Button variant="subtle" density="compact" className="selection-book-title" onClick={() => loadRecord(record)}>
                          <strong>{record.data.name}</strong>
                          <span>{[record.data.author, record.data.publisher, record.data.price ? `¥${record.data.price}` : ''].filter(Boolean).join(' · ') || '待补充作者与价格'}</span>
                          <small>{record.data.rankingLabel || '已存书目'}</small>
                        </Button>
                      </div>
                      <span className="selection-category-cell selection-col-category">{record.data.category || record.theme}</span>
                      <span className="selection-point-cell selection-col-point">{record.data.sellPoint || '待补充核心卖点'}</span>
                      <span className="selection-sales-cell selection-col-sales"><strong>{formatReviewCount(record.data.reviewCount)}</strong><small>{record.data.reviewCount ? '公开评论' : '未提供'}</small></span>
                      <span className="selection-potential-cell"><PotentialStars score={score} /><small>{score} 分 · 智能建议</small></span>
                      <span className={`selection-video-cell selection-col-video ${videoPotential(score).tone}`}>{videoPotential(score).label}</span>
                      <span className="selection-keyword-cell selection-col-keyword">{record.data.keyword || record.data.name}</span>
                      <span className={`selection-status ${record.data.selectionStatus ?? 'candidate'} selection-col-status`}>{selectionStatusLabel(record.data.selectionStatus ?? 'candidate')}</span>
                      <span className="selection-row-actions">
                        <Tooltip content={favorite ? '取消收藏' : '收藏到书单'}>
                          <IconButton label={favorite ? `取消收藏 ${record.data.name}` : `收藏 ${record.data.name}`} icon={<Star size={15} fill={favorite ? 'currentColor' : 'none'} />} variant={favorite ? 'primary' : 'subtle'} density="compact" disabled={pendingAction !== null} onClick={() => void toggleFavorite(record)} />
                        </Tooltip>
                        <Tooltip content={comparing ? '移出对比台' : '加入对比台'}>
                          <IconButton label={comparing ? `移出对比 ${record.data.name}` : `加入对比 ${record.data.name}`} icon={comparing ? <Check size={15} /> : <GitCompareArrows size={15} />} variant="subtle" density="compact" onClick={() => toggleComparison(record)} />
                        </Tooltip>
                         <Button title="带入新建任务" variant="primary" density="compact" icon={<Sparkles size={14} />} disabled={pendingAction !== null} onClick={() => void createFromBook(record)}>去创作</Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {workspaceTab === 'compare' ? (
          comparisonRecords.length === 0 ? <EmptyState title="尚未选择对比书目" action={<Button density="compact" onClick={() => setWorkspaceTab('ranking')}>返回榜单</Button>} /> : (
            <div className="selection-comparison-scroll">
              <table className="selection-comparison-table">
                <thead><tr><th>指标</th>{comparisonRecords.map((record) => <th key={selectionKey(record)}>{record.data.name}</th>)}</tr></thead>
                <tbody>
                  <ComparisonRow label="机会总分" records={comparisonRecords} value={(record) => String(record.data.opportunityScore?.total ?? '—')} />
                  {scoreFields.map(([key, label]) => <ComparisonRow key={key} label={label} records={comparisonRecords} value={(record) => String(record.data.opportunityScore?.[key] ?? '—')} />)}
                  <ComparisonRow label="公开评论" records={comparisonRecords} value={(record) => formatReviewCount(record.data.reviewCount)} />
                  <ComparisonRow label="状态" records={comparisonRecords} value={(record) => selectionStatusLabel(record.data.selectionStatus ?? 'candidate')} />
                  <ComparisonRow label="核心卖点" records={comparisonRecords} value={(record) => record.data.sellPoint || '—'} />
                  <ComparisonRow label="风险" records={comparisonRecords} value={(record) => record.data.riskNote || '—'} />
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {workspaceTab === 'brief' ? (
          draft.name ? (
            <section className="selection-brief-preview">
              <div><span>当前选品</span><strong>{draft.name}</strong><small>{track} · 机会分 {draftScore.total}</small></div>
              <pre>{draft.creativeBrief || composeCreativeBrief(track, draft)}</pre>
              <Button variant="primary" density="compact" icon={<PencilLine size={15} />} onClick={() => setDetailOpen(true)}>编辑创作简报</Button>
            </section>
          ) : <EmptyState title="请先打开一本书的详情" action={<Button density="compact" onClick={() => setWorkspaceTab('ranking')}>返回榜单</Button>} />
        ) : null}
      </main>

      {message ? <span className="local-note selection-message">{message}</span> : null}
      <InlineActionFeedback feedback={discoveryAction.feedback ?? bookAction.feedback} />

      <Dialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title={draft.name ? `选品详情 · ${draft.name}` : '手动添加选品'}
        actions={(
          <>
            {selectedRecord ? <Button variant="danger" density="compact" icon={<Trash2 size={14} />} disabled={pendingAction !== null} onClick={() => void deleteSelection(selectedRecord)}>删除</Button> : null}
            <Button variant="secondary" density="compact" onClick={() => setDetailOpen(false)}>关闭</Button>
            <Button variant="primary" density="compact" icon={<Save size={14} />} disabled={pendingAction !== null || !draft.name.trim()} onClick={() => void saveSelection()}>保存选品</Button>
          </>
        )}
      >
        <div className="selection-detail-dialog">
          <Tabs
            label="选品详情"
            value={inspectorTab}
            onChange={(value) => setInspectorTab(value as SelectionInspectorTab)}
            items={[
              { value: 'profile', label: '资料' },
              { value: 'score', label: '评分' },
              { value: 'evidence', label: `证据 ${draft.evidence?.length ?? 0}` },
              { value: 'brief', label: '简报' },
            ]}
          />
          <div className="selection-detail-body">
            {inspectorTab === 'profile' ? (
              <div className="selection-profile-form">
                <div className="selection-detail-source"><BookCover data={draft} variant="detail" /><div><span>{draft.source === 'dangdang' ? '当当公开书目' : '手动选品'}</span><strong>{draft.rankingLabel || '本地保存'}</strong><small>{draft.sourceState === 'preview' ? '预览数据，不代表实时榜单' : '来源字段与智能建议已分开标注'}</small></div></div>
                <TextField label="主题" value={track} placeholder="故事带货 / 健康书单" onChange={(_, data) => setTrack(data.value)} />
                <TextField label="商品 / 书名" value={draft.name} onChange={(_, data) => updateDraft({ name: data.value })} />
                <SelectField label="状态" value={draft.selectionStatus ?? 'candidate'} options={statusOptions.slice(1)} onChange={(event) => updateDraft({ selectionStatus: event.target.value as NonNullable<BookProductInfo['selectionStatus']> })} />
                <TextField label="作者" value={draft.author ?? ''} onChange={(_, data) => updateDraft({ author: data.value })} />
                <TextField label="出版社" value={draft.publisher ?? ''} onChange={(_, data) => updateDraft({ publisher: data.value })} />
                <TextField label="分类" value={draft.category ?? ''} onChange={(_, data) => updateDraft({ category: data.value })} />
                <TextField label="关键词" value={draft.keyword ?? ''} onChange={(_, data) => updateDraft({ keyword: data.value })} />
                <TextField label="价格" value={draft.price ?? ''} onChange={(_, data) => updateDraft({ price: data.value })} />
                <TextField label="目标人群" value={draft.audience ?? ''} onChange={(_, data) => updateDraft({ audience: data.value })} />
                <TextField label="人物" value={draft.persons ?? ''} onChange={(_, data) => updateDraft({ persons: data.value })} />
                <TextField label="年代 / 场景" value={draft.era ?? ''} onChange={(_, data) => updateDraft({ era: data.value })} />
                <TextField label="链接" value={draft.url ?? ''} onChange={(_, data) => updateDraft({ url: data.value })} />
                <TextAreaField label="核心卖点" value={draft.sellPoint ?? ''} onChange={(_, data) => updateDraft({ sellPoint: data.value })} />
                <TextAreaField label="备注" value={draft.note ?? ''} onChange={(_, data) => updateDraft({ note: data.value })} />
              </div>
            ) : null}

            {inspectorTab === 'score' ? (
              <div className="selection-score-panel">
                <div className="selection-total-score"><span>机会总分</span><strong>{draftScore.total}</strong><small>置信度 {confidenceLabel(draftScore.confidence)} · {draftScore.confirmed ? '人工已确认' : '智能建议'}</small></div>
                {scoreFields.map(([key, label]) => <SliderField key={key} label={label} min={0} max={100} value={draftScore[key]} valueLabel={draftScore[key]} onChange={(_, data) => updateScore(key, data.value)} />)}
                <CheckboxField label="人工确认当前评分" checked={draftScore.confirmed} onChange={(_, data) => updateDraft({ opportunityScore: { ...draftScore, confirmed: Boolean(data.checked) } })} />
                <TextAreaField label="决策备注" value={draft.decisionNote ?? ''} onChange={(_, data) => updateDraft({ decisionNote: data.value })} />
                <TextAreaField label="风险提示" value={draft.riskNote ?? ''} onChange={(_, data) => updateDraft({ riskNote: data.value })} />
              </div>
            ) : null}

            {inspectorTab === 'evidence' ? (
              <div className="selection-evidence-list">
                {(draft.evidence?.length ?? 0) === 0 ? <EmptyState title="暂无对标证据" action={<Button density="compact" icon={<ArrowRight size={13} />} onClick={() => handoffProduct(detailRecord, 'benchmark')}>去对标监控</Button>} /> : null}
                {draft.evidence?.map((evidence) => (
                  <article key={evidence.postId} className="selection-evidence-item">
                    <span>{benchmarkPlatformLabel(evidence.platform)} · 爆发分 {evidence.burstScore ?? '—'}</span>
                    <strong>{evidence.title}</strong><p>{evidence.note || '暂无证据说明'}</p>
                    <Button density="compact" icon={<ArrowRight size={13} />} onClick={() => focusEvidence(evidence.postId)}>查看来源</Button>
                  </article>
                ))}
              </div>
            ) : null}

            {inspectorTab === 'brief' ? (
              <div className="selection-brief-editor">
                <TextAreaField label="创作简报" value={draft.creativeBrief ?? ''} onChange={(_, data) => updateDraft({ creativeBrief: data.value })} placeholder="受众、卖点、开头、结构、参考证据和风险" />
                <Button density="compact" icon={<FileText size={14} />} onClick={generateCreativeBrief}>生成简报草稿</Button>
                {draft.name ? <Button variant="primary" density="compact" icon={<Sparkles size={14} />} disabled={pendingAction !== null} onClick={() => void createFromBook(detailRecord)}>去创作</Button> : null}
              </div>
            ) : null}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ComparisonRow({ label, records, value }: { label: string; records: BookSelectionRecord[]; value: (record: BookSelectionRecord) => string }) {
  return <tr><th scope="row">{label}</th>{records.map((record) => <td key={selectionKey(record)}>{value(record)}</td>)}</tr>;
}

function BookCover({ data, variant = 'row' }: { data: BookProductInfo; variant?: 'row' | 'detail' }) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(data.coverUrl && !failed);
  return (
    <span className={`selection-book-cover ${variant}`} data-cover-state={hasImage ? 'ready' : 'fallback'}>
      {hasImage ? <img src={data.coverUrl} alt={`${data.name}封面`} loading="lazy" onError={() => setFailed(true)} /> : <BookOpen size={variant === 'detail' ? 28 : 20} aria-hidden="true" />}
    </span>
  );
}

function PotentialStars({ score }: { score: number }) {
  const filled = Math.max(1, Math.min(5, Math.round(score / 20)));
  return <span className="selection-stars" aria-label={`带货潜力 ${score} 分`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={12} fill={value <= filled ? 'currentColor' : 'none'} />)}</span>;
}

function emptyProductDraft(): BookProductInfo {
  return { name: '', source: 'manual', sourceState: 'saved', selectionStatus: 'candidate', opportunityScore: defaultOpportunityScore(), evidence: [] };
}

function cloneProductInfo(data: BookProductInfo): BookProductInfo {
  return {
    ...data,
    selectionStatus: data.selectionStatus ?? 'candidate',
    opportunityScore: data.opportunityScore ? { ...data.opportunityScore } : defaultOpportunityScore(),
    evidence: data.evidence?.map((item) => ({ ...item })) ?? [],
  };
}

function normalizedProduct(draft: BookProductInfo): BookProductInfo {
  const score = draft.opportunityScore ?? defaultOpportunityScore();
  return {
    ...draft,
    name: draft.name.trim(),
    author: emptyToUndefined(draft.author ?? ''),
    publisher: emptyToUndefined(draft.publisher ?? ''),
    publishDate: emptyToUndefined(draft.publishDate ?? ''),
    category: emptyToUndefined(draft.category ?? ''),
    keyword: emptyToUndefined(draft.keyword ?? ''),
    sellPoint: emptyToUndefined(draft.sellPoint ?? ''),
    audience: emptyToUndefined(draft.audience ?? ''),
    persons: emptyToUndefined(draft.persons ?? ''),
    era: emptyToUndefined(draft.era ?? ''),
    price: emptyToUndefined(draft.price ?? ''),
    originalPrice: emptyToUndefined(draft.originalPrice ?? ''),
    url: emptyToUndefined(draft.url ?? ''),
    note: emptyToUndefined(draft.note ?? ''),
    coverUrl: emptyToUndefined(draft.coverUrl ?? ''),
    selectionStatus: draft.selectionStatus ?? 'candidate',
    opportunityScore: { ...score, total: benchmarkOpportunityTotal(score) },
    evidence: draft.evidence ?? [],
  };
}

function defaultOpportunityScore(): BenchmarkSelectionScore {
  const input = { demand: 50, gap: 50, fit: 50, conversion: 50, executionEase: 50 };
  return { ...input, total: benchmarkOpportunityTotal(input), confidence: 'low', confirmed: false };
}

function composeCreativeBrief(theme: string, data: BookProductInfo): string {
  const evidence = data.evidence?.map((item) => `- [${benchmarkPlatformLabel(item.platform)}] ${item.title}：${item.note}`).join('\n') || '- 暂无对标证据，发布前需补充验证。';
  return [
    `选品：${data.name || '未命名'}`,
    `作者：${data.author || '待确认'}`,
    `来源：${data.source === 'dangdang' ? `${data.rankingLabel || '当当公开书目'}${data.url ? ` · ${data.url}` : ''}` : '手动录入'}`,
    `赛道：${theme || data.category || '待确认'}`,
    `机会分：${data.opportunityScore?.total ?? '待评分'}（${data.opportunityScore?.confirmed ? '人工已确认' : '智能建议'}）`,
    `目标人群：${data.audience || '待确认'}`,
    `核心卖点：${data.sellPoint || '待补充'}`,
    `关键词：${data.keyword || '待补充'}`,
    '',
    '参考证据：',
    evidence,
    '',
    `创作方向：以《${data.name || '这本书'}》的真实观点为核心，用一个具体生活场景制造认知缺口，再讲清 2-3 个可核验观点，最后自然说明适合谁阅读。`,
    `风险与限制：${data.riskNote || '不得编造书名、作者、销量、评论、案例、功效或权威背书。'}`,
  ].join('\n');
}

function bookTrackFor(theme: string, data: BookProductInfo): 'health-book' | 'ecommerce' {
  return /健康|养生|中医|抗衰|饮食|医学/u.test(`${theme} ${data.category ?? ''} ${data.keyword ?? ''}`) ? 'health-book' : 'ecommerce';
}

function identitiesEqual(identity: BookSelectionIdentity | null, record: BookSelectionRecord): boolean {
  return Boolean(identity && identity.theme === record.theme && identity.bookId === record.bookId);
}

function selectionKey(record: Pick<BookSelectionRecord, 'theme' | 'bookId'>): string {
  return `${record.theme}\u001f${record.bookId}`;
}

function isFavorite(data: BookProductInfo): boolean {
  return data.selectionStatus === 'watching' || data.selectionStatus === 'planned' || data.selectionStatus === 'created';
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function selectionStatusLabel(status: NonNullable<BookProductInfo['selectionStatus']>): string {
  return { candidate: '候选', watching: '已收藏', planned: '计划创作', created: '已创作', rejected: '淘汰' }[status];
}

function confidenceLabel(value: BenchmarkSelectionScore['confidence']): string {
  return { low: '低', medium: '中', high: '高' }[value];
}

function formatReviewCount(value?: number): string {
  if (value === undefined) return '—';
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
  return new Intl.NumberFormat('zh-CN').format(value);
}

function videoPotential(score: number): { label: string; tone: 'normal' | 'high' | 'very-high' } {
  if (score >= 85) return { label: '极高', tone: 'very-high' };
  if (score >= 75) return { label: '高', tone: 'high' };
  return { label: '观察', tone: 'normal' };
}
