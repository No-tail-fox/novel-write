import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, FileText, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { benchmarkOpportunityTotal, benchmarkPlatformLabel } from '../../shared/benchmark-monitoring';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  BenchmarkOpportunityInputs,
  BenchmarkSelectionScore,
  BookProductInfo,
  BookSelectionIdentity,
  BookSelectionRecord,
  ShellView,
} from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { emptyToUndefined } from '../tasks/task-formatters';
import '../../styles/features/local-labs.css';

type SelectionWorkspaceTab = 'candidates' | 'compare' | 'brief';
type SelectionInspectorTab = 'profile' | 'score' | 'evidence' | 'brief';
type SelectionStatusFilter = 'all' | NonNullable<BookProductInfo['selectionStatus']>;

const scoreFields: Array<[keyof BenchmarkOpportunityInputs, string]> = [
  ['demand', '需求热度'],
  ['gap', '内容缺口'],
  ['fit', '账号匹配'],
  ['conversion', '转化证据'],
  ['executionEase', '执行便利度'],
];

export function BookSelectionPage({ api, navigate }: { api: StoryDreamApi; navigate: (view: ShellView) => void }) {
  const [records, setRecords] = useState<BookSelectionRecord[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<BookSelectionIdentity | null>(null);
  const [comparisonSelectionIds, setComparisonSelectionIds] = useState<string[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<SelectionWorkspaceTab>('candidates');
  const [inspectorTab, setInspectorTab] = useState<SelectionInspectorTab>('profile');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SelectionStatusFilter>('all');
  const [theme, setTheme] = useState('故事带货');
  const [draft, setDraft] = useState<BookProductInfo>(() => emptyProductDraft());
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<'save' | `delete:${string}` | null>(null);
  const bookAction = useAsyncAction();

  const selectedRecord = records.find((record) => identitiesEqual(selectedIdentity, record)) ?? null;
  const filteredRecords = useMemo(() => records
    .filter((record) => statusFilter === 'all' || (record.data.selectionStatus ?? 'candidate') === statusFilter)
    .filter((record) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return [record.data.name, record.theme, record.data.author, record.data.category, record.data.keyword, record.data.sellPoint]
        .some((value) => value?.toLowerCase().includes(query));
    })
    .sort((left, right) => (right.data.opportunityScore?.total ?? -1) - (left.data.opportunityScore?.total ?? -1) || right.updatedAt - left.updatedAt),
  [records, search, statusFilter]);
  const comparisonRecords = comparisonSelectionIds
    .map((id) => records.find((record) => selectionKey(record) === id))
    .filter((record): record is BookSelectionRecord => Boolean(record));
  const draftScore = draft.opportunityScore ?? defaultOpportunityScore();

  useEffect(() => {
    let active = true;
    api.listBookSelections()
      .then((items) => {
        if (!active) return;
        setRecords(items);
        if (items[0]) loadRecord(items[0]);
      })
      .catch((error) => {
        if (active) bookAction.reportError(error);
      });
    return () => {
      active = false;
    };
  }, [api, bookAction.reportError]);

  async function reload(preferred?: BookSelectionIdentity | null) {
    const items = await api.listBookSelections();
    setRecords(items);
    const next = preferred
      ? items.find((record) => identitiesEqual(preferred, record))
      : items.find((record) => identitiesEqual(selectedIdentity, record));
    if (next) loadRecord(next);
    else if (items[0]) loadRecord(items[0]);
    else clearForm();
  }

  function loadRecord(record: BookSelectionRecord) {
    setSelectedIdentity({ theme: record.theme, bookId: record.bookId });
    setTheme(record.theme);
    setDraft(cloneProductInfo(record.data));
    setMessage('');
  }

  function clearForm() {
    setSelectedIdentity(null);
    setTheme('故事带货');
    setDraft(emptyProductDraft());
    setInspectorTab('profile');
    setMessage('');
  }

  function updateDraft(patch: Partial<BookProductInfo>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateScore(field: keyof BenchmarkOpportunityInputs, rawValue: string) {
    const value = clampScore(Number(rawValue));
    setDraft((current) => {
      const previous = current.opportunityScore ?? defaultOpportunityScore();
      const inputs = { ...previous, [field]: value };
      return {
        ...current,
        opportunityScore: {
          ...inputs,
          total: benchmarkOpportunityTotal(inputs),
        },
      };
    });
  }

  async function saveSelection() {
    if (!draft.name.trim()) {
      setMessage('请先填写商品 / 书名。');
      return;
    }
    if (!theme.trim()) {
      setMessage('请先填写主题。');
      return;
    }
    await bookAction.run(async () => {
      setPendingAction('save');
      try {
        const score = draft.opportunityScore ?? defaultOpportunityScore();
        const data: BookProductInfo = {
          ...draft,
          name: draft.name.trim(),
          author: emptyToUndefined(draft.author ?? ''),
          category: emptyToUndefined(draft.category ?? ''),
          keyword: emptyToUndefined(draft.keyword ?? ''),
          sellPoint: emptyToUndefined(draft.sellPoint ?? ''),
          audience: emptyToUndefined(draft.audience ?? ''),
          persons: emptyToUndefined(draft.persons ?? ''),
          era: emptyToUndefined(draft.era ?? ''),
          price: emptyToUndefined(draft.price ?? ''),
          url: emptyToUndefined(draft.url ?? ''),
          note: emptyToUndefined(draft.note ?? ''),
          selectionStatus: draft.selectionStatus ?? 'candidate',
          opportunityScore: { ...score, total: benchmarkOpportunityTotal(score) },
          evidence: draft.evidence ?? [],
        };
        const saved = await api.saveBookSelection({
          theme: theme.trim(),
          bookId: selectedIdentity?.bookId,
          previousIdentity: selectedIdentity ?? undefined,
          data,
        });
        setSelectedIdentity({ theme: saved.theme, bookId: saved.bookId });
        await reload({ theme: saved.theme, bookId: saved.bookId });
        setMessage('选品资料、评分与证据已保存。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function deleteSelection(record: BookSelectionRecord) {
    if (!window.confirm(`删除选品「${record.data.name}」？`)) return;
    await bookAction.run(async () => {
      setPendingAction(`delete:${record.bookId}`);
      try {
        await api.deleteBookSelection(record.theme, record.bookId);
        setComparisonSelectionIds((items) => items.filter((item) => item !== selectionKey(record)));
        await reload(null);
        setMessage('已删除选品。');
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
        setMessage('对比台最多同时保留 4 个选品，请先移除一项。');
        return items;
      }
      return [...items, key];
    });
  }

  function handoffProduct(record: BookSelectionRecord, view: ShellView) {
    if (view === 'new-task') sessionStorage.setItem('book_product_info', JSON.stringify(record.data));
    if (view === 'benchmark') sessionStorage.setItem('benchmark_search', record.data.keyword || record.data.name);
    navigate(view);
  }

  function focusEvidence(postId: string) {
    sessionStorage.setItem('benchmark_focus_post', postId);
    navigate('benchmark');
  }

  function generateCreativeBrief() {
    const creativeBrief = composeCreativeBrief(theme, draft);
    updateDraft({ creativeBrief });
    setWorkspaceTab('brief');
    setInspectorTab('brief');
    setMessage('已根据当前资料和证据生成可编辑简报草稿，保存后可带入新建任务。');
  }

  return (
    <div className="local-lab-workbench selection-grid" data-local-lab-workbench="book-selection">
      <header className="selection-workspace-toolbar">
        <div className="selection-workspace-tabs" role="tablist" aria-label="选品视图">
          {([
            ['candidates', '候选池'],
            ['compare', `对比台${comparisonSelectionIds.length ? ` ${comparisonSelectionIds.length}/4` : ''}`],
            ['brief', '创作简报'],
          ] as Array<[SelectionWorkspaceTab, string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={workspaceTab === id} className={workspaceTab === id ? 'active' : ''} onClick={() => setWorkspaceTab(id)}>{label}</button>
          ))}
        </div>
        <button className="ghost-action compact-action" type="button" onClick={() => reload(selectedIdentity)}><RefreshCw size={14} />刷新</button>
        <button className="primary-action slim" type="button" onClick={clearForm}><Plus size={15} />新选品</button>
      </header>

      <main className="selection-main-panel">
        {workspaceTab === 'candidates' ? (
          <>
            <div className="selection-filter-row">
              <label className="selection-search-field"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、分类、关键词或卖点" /></label>
              <select aria-label="选品状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SelectionStatusFilter)}>
                <option value="all">全部状态</option>
                {(['candidate', 'watching', 'planned', 'created', 'rejected'] as const).map((status) => <option key={status} value={status}>{selectionStatusLabel(status)}</option>)}
              </select>
              <span>{filteredRecords.length} 个候选 · 按机会分排序</span>
            </div>
            <div className="selection-candidate-table" role="table" aria-label="选品候选池">
              <div className="selection-table-head" role="row">
                <span role="columnheader">对比</span><span role="columnheader">选品</span><span role="columnheader">机会分</span><span role="columnheader">状态</span><span role="columnheader">证据</span><span role="columnheader">最后更新</span>
              </div>
              <div className="selection-table-body">
                {filteredRecords.length === 0 ? <EmptyState title="暂无匹配选品" action={<button className="mini-button" type="button" onClick={clearForm}><Plus size={14} />新建选品</button>} /> : null}
                {filteredRecords.map((record) => {
                  const active = identitiesEqual(selectedIdentity, record);
                  return (
                    <div key={selectionKey(record)} className={active ? 'selection-table-row active' : 'selection-table-row'} role="row">
                      <input type="checkbox" aria-label={`加入对比 ${record.data.name}`} checked={comparisonSelectionIds.includes(selectionKey(record))} onChange={() => toggleComparison(record)} />
                      <button type="button" className="selection-row-main" onClick={() => loadRecord(record)}>
                        <strong>{record.data.name}</strong><span>{record.theme} · {record.data.category || record.data.author || '未填分类'}</span><small>{record.data.sellPoint || record.data.note || '暂无卖点摘要'}</small>
                      </button>
                      <span className="selection-opportunity-cell"><strong>{record.data.opportunityScore?.total ?? '—'}</strong><small>{record.data.opportunityScore?.confidence ? confidenceLabel(record.data.opportunityScore.confidence) : '待评分'}</small></span>
                      <span className={`selection-status ${record.data.selectionStatus ?? 'candidate'}`}>{selectionStatusLabel(record.data.selectionStatus ?? 'candidate')}</span>
                      <span className="selection-evidence-cell">{record.data.evidence?.length ?? 0} 条</span>
                      <span className="selection-updated-cell">{formatDate(record.updatedAt)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {workspaceTab === 'compare' ? (
          comparisonRecords.length === 0 ? <EmptyState title="尚未选择对比项" action={<button className="mini-button" type="button" onClick={() => setWorkspaceTab('candidates')}>返回候选池</button>} /> : (
            <div className="selection-comparison-scroll">
              <table className="selection-comparison-table">
                <thead><tr><th>指标</th>{comparisonRecords.map((record) => <th key={selectionKey(record)}>{record.data.name}</th>)}</tr></thead>
                <tbody>
                  <ComparisonRow label="机会总分" records={comparisonRecords} value={(record) => String(record.data.opportunityScore?.total ?? '—')} />
                  {scoreFields.map(([key, label]) => <ComparisonRow key={key} label={label} records={comparisonRecords} value={(record) => String(record.data.opportunityScore?.[key] ?? '—')} />)}
                  <ComparisonRow label="状态" records={comparisonRecords} value={(record) => selectionStatusLabel(record.data.selectionStatus ?? 'candidate')} />
                  <ComparisonRow label="证据" records={comparisonRecords} value={(record) => `${record.data.evidence?.length ?? 0} 条`} />
                  <ComparisonRow label="核心卖点" records={comparisonRecords} value={(record) => record.data.sellPoint || '—'} />
                  <ComparisonRow label="风险" records={comparisonRecords} value={(record) => record.data.riskNote || '—'} />
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {workspaceTab === 'brief' ? (
          selectedRecord || draft.name ? (
            <section className="selection-brief-preview">
              <div><span>当前选品</span><strong>{draft.name || '未命名选品'}</strong><small>{theme} · 机会分 {draftScore.total}</small></div>
              <pre>{draft.creativeBrief || '尚未生成创作简报。请在右侧“简报”页生成或编辑。'}</pre>
              <button className="primary-action slim" type="button" onClick={generateCreativeBrief}><FileText size={15} />{draft.creativeBrief ? '重新生成简报草稿' : '生成创作简报'}</button>
            </section>
          ) : <EmptyState title="请先选择或新建一个选品" action={<button className="mini-button" type="button" onClick={() => setWorkspaceTab('candidates')}>返回候选池</button>} />
        ) : null}
      </main>

      <aside className="selection-inspector">
        <div className="selection-inspector-head">
          <div><span>{selectedRecord ? '选品详情' : '新建选品'}</span><strong>{draft.name || '未命名选品'}</strong></div>
          {selectedRecord ? <button className="icon-button danger" type="button" aria-label="删除选品" title="删除选品" disabled={pendingAction !== null} onClick={() => deleteSelection(selectedRecord)}><Trash2 size={15} /></button> : null}
        </div>
        <div className="selection-inspector-tabs" role="tablist" aria-label="选品详情">
          {([
            ['profile', '资料'], ['score', '评分'], ['evidence', `证据 ${draft.evidence?.length ?? 0}`], ['brief', '简报'],
          ] as Array<[SelectionInspectorTab, string]>).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={inspectorTab === id} className={inspectorTab === id ? 'active' : ''} onClick={() => setInspectorTab(id)}>{label}</button>)}
        </div>

        <div className="selection-inspector-body">
          {inspectorTab === 'profile' ? (
            <div className="selection-profile-form">
              <Field label="主题"><input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="故事带货 / 健康书单" /></Field>
              <Field label="商品 / 书名"><input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} /></Field>
              <Field label="状态"><select value={draft.selectionStatus ?? 'candidate'} onChange={(event) => updateDraft({ selectionStatus: event.target.value as NonNullable<BookProductInfo['selectionStatus']> })}>{(['candidate', 'watching', 'planned', 'created', 'rejected'] as const).map((status) => <option key={status} value={status}>{selectionStatusLabel(status)}</option>)}</select></Field>
              <Field label="作者"><input value={draft.author ?? ''} onChange={(event) => updateDraft({ author: event.target.value })} /></Field>
              <Field label="分类"><input value={draft.category ?? ''} onChange={(event) => updateDraft({ category: event.target.value })} /></Field>
              <Field label="关键词"><input value={draft.keyword ?? ''} onChange={(event) => updateDraft({ keyword: event.target.value })} /></Field>
              <Field label="价格"><input value={draft.price ?? ''} onChange={(event) => updateDraft({ price: event.target.value })} /></Field>
              <Field label="目标人群"><input value={draft.audience ?? ''} onChange={(event) => updateDraft({ audience: event.target.value })} /></Field>
              <Field label="人物"><input value={draft.persons ?? ''} onChange={(event) => updateDraft({ persons: event.target.value })} /></Field>
              <Field label="年代 / 场景"><input value={draft.era ?? ''} onChange={(event) => updateDraft({ era: event.target.value })} /></Field>
              <Field label="链接"><input value={draft.url ?? ''} onChange={(event) => updateDraft({ url: event.target.value })} /></Field>
              <Field label="核心卖点"><textarea className="small-textarea" value={draft.sellPoint ?? ''} onChange={(event) => updateDraft({ sellPoint: event.target.value })} /></Field>
              <Field label="备注"><textarea className="small-textarea" value={draft.note ?? ''} onChange={(event) => updateDraft({ note: event.target.value })} /></Field>
            </div>
          ) : null}

          {inspectorTab === 'score' ? (
            <div className="selection-score-panel">
              <div className="selection-total-score"><span>机会总分</span><strong>{draftScore.total}</strong><small>置信度 {confidenceLabel(draftScore.confidence)} · {draftScore.confirmed ? '人工已确认' : '自动建议'}</small></div>
              {scoreFields.map(([key, label]) => (
                <label key={key} className="selection-score-row">
                  <span>{label}</span><div><i style={{ width: `${draftScore[key]}%` }} /></div><input type="number" min="0" max="100" value={draftScore[key]} onChange={(event) => updateScore(key, event.target.value)} />
                </label>
              ))}
              <label className="selection-confirm-score"><input type="checkbox" checked={draftScore.confirmed} onChange={(event) => updateDraft({ opportunityScore: { ...draftScore, confirmed: event.target.checked } })} /><span>人工确认当前评分</span></label>
              <Field label="决策备注"><textarea className="small-textarea" value={draft.decisionNote ?? ''} onChange={(event) => updateDraft({ decisionNote: event.target.value })} /></Field>
              <Field label="风险提示"><textarea className="small-textarea" value={draft.riskNote ?? ''} onChange={(event) => updateDraft({ riskNote: event.target.value })} /></Field>
            </div>
          ) : null}

          {inspectorTab === 'evidence' ? (
            <div className="selection-evidence-list">
              {(draft.evidence?.length ?? 0) === 0 ? <EmptyState title="暂无对标证据" action={<button className="mini-button" type="button" onClick={() => handoffProduct({ theme, bookId: selectedIdentity?.bookId ?? '', data: draft, updatedAt: Date.now() }, 'benchmark')}>去对标监控<ArrowRight size={13} /></button>} /> : null}
              {draft.evidence?.map((evidence) => (
                <article key={evidence.postId} className="selection-evidence-item">
                  <span>{benchmarkPlatformLabel(evidence.platform)} · 爆发分 {evidence.burstScore ?? '—'}</span>
                  <strong>{evidence.title}</strong><p>{evidence.note || '暂无证据说明'}</p>
                  <button className="mini-button" type="button" onClick={() => focusEvidence(evidence.postId)}>查看来源<ArrowRight size={13} /></button>
                </article>
              ))}
            </div>
          ) : null}

          {inspectorTab === 'brief' ? (
            <div className="selection-brief-editor">
              <Field label="创作简报"><textarea value={draft.creativeBrief ?? ''} onChange={(event) => updateDraft({ creativeBrief: event.target.value })} placeholder="受众、卖点、开头、结构、参考证据和风险" /></Field>
              <button className="mini-button" type="button" onClick={generateCreativeBrief}><FileText size={14} />生成简报草稿</button>
              {selectedRecord ? <button className="primary-action slim" type="button" onClick={() => handoffProduct({ ...selectedRecord, data: draft }, 'new-task')}><ArrowRight size={14} />带入新建任务</button> : null}
            </div>
          ) : null}
        </div>

        <footer className="selection-inspector-footer">
          {selectedRecord ? <button className="mini-button" type="button" onClick={() => toggleComparison(selectedRecord)}>{comparisonSelectionIds.includes(selectionKey(selectedRecord)) ? <Check size={14} /> : <Plus size={14} />}{comparisonSelectionIds.includes(selectionKey(selectedRecord)) ? '已在对比台' : '加入对比台'}</button> : <span />}
          <button className="primary-action slim" type="button" disabled={pendingAction !== null || !draft.name.trim()} onClick={saveSelection}><Save size={15} />保存选品</button>
        </footer>
        {message ? <span className="local-note selection-message">{message}</span> : null}
        <InlineActionFeedback feedback={bookAction.feedback} />
      </aside>
    </div>
  );
}

function ComparisonRow({ label, records, value }: { label: string; records: BookSelectionRecord[]; value: (record: BookSelectionRecord) => string }) {
  return <tr><th scope="row">{label}</th>{records.map((record) => <td key={selectionKey(record)}>{value(record)}</td>)}</tr>;
}

function emptyProductDraft(): BookProductInfo {
  return { name: '', selectionStatus: 'candidate', opportunityScore: defaultOpportunityScore(), evidence: [] };
}

function cloneProductInfo(data: BookProductInfo): BookProductInfo {
  return {
    ...data,
    selectionStatus: data.selectionStatus ?? 'candidate',
    opportunityScore: data.opportunityScore ? { ...data.opportunityScore } : defaultOpportunityScore(),
    evidence: data.evidence?.map((item) => ({ ...item })) ?? [],
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
    `赛道：${theme || data.category || '待确认'}`,
    `机会分：${data.opportunityScore?.total ?? '待评分'}（${data.opportunityScore?.confirmed ? '人工已确认' : '自动建议' }）`,
    `目标人群：${data.audience || '待确认'}`,
    `核心卖点：${data.sellPoint || '待补充'}`,
    `关键词：${data.keyword || '待补充'}`,
    '',
    '参考证据：',
    evidence,
    '',
    `创作方向：围绕“${data.sellPoint || data.name || '核心价值'}”设计前三秒开头，正文用证据支撑卖点，结尾给出明确行动建议。`,
    `风险与限制：${data.riskNote || '暂无已记录风险，发布前需进行事实与合规检查。'}`,
  ].join('\n');
}

function identitiesEqual(identity: BookSelectionIdentity | null, record: BookSelectionRecord): boolean {
  return Boolean(identity && identity.theme === record.theme && identity.bookId === record.bookId);
}

function selectionKey(record: Pick<BookSelectionRecord, 'theme' | 'bookId'>): string {
  return `${record.theme}\u001f${record.bookId}`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function selectionStatusLabel(status: NonNullable<BookProductInfo['selectionStatus']>): string {
  return { candidate: '候选', watching: '观察', planned: '计划创作', created: '已创作', rejected: '淘汰' }[status];
}

function confidenceLabel(value: BenchmarkSelectionScore['confidence']): string {
  return { low: '低', medium: '中', high: '高' }[value];
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value);
}
