import { useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { BookProductInfo, BookSelectionIdentity, BookSelectionRecord, ShellView } from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { emptyToUndefined } from '../tasks/task-formatters';
import '../../styles/features/local-labs.css';

export function BookSelectionPage({ api, navigate }: { api: StoryDreamApi; navigate: (view: ShellView) => void }) {
  const [records, setRecords] = useState<BookSelectionRecord[]>([]);
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedIdentity, setSelectedIdentity] = useState<BookSelectionIdentity | null>(null);
  const [theme, setTheme] = useState('故事带货');
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sellPoint, setSellPoint] = useState('');
  const [audience, setAudience] = useState('');
  const [persons, setPersons] = useState('');
  const [era, setEra] = useState('');
  const [price, setPrice] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<'save' | `delete:${string}` | null>(null);
  const bookAction = useAsyncAction();

  useEffect(() => {
    let active = true;
    api
      .listBookSelections()
      .then((items) => {
        if (active) setRecords(items);
      })
      .catch((error) => {
        if (active) bookAction.reportError(error);
      });
    return () => {
      active = false;
    };
  }, [api, bookAction.reportError]);

  function loadSelections() {
    return api.listBookSelections().then(setRecords);
  }

  async function refreshSelections() {
    await bookAction.run(loadSelections);
  }

  function loadRecord(record: BookSelectionRecord) {
    setSelectedBookId(record.bookId);
    setSelectedIdentity({ theme: record.theme, bookId: record.bookId });
    setTheme(record.theme);
    setName(record.data.name ?? '');
    setAuthor(record.data.author ?? '');
    setCategory(record.data.category ?? '');
    setKeyword(record.data.keyword ?? '');
    setSellPoint(record.data.sellPoint ?? '');
    setAudience(record.data.audience ?? '');
    setPersons(record.data.persons ?? '');
    setEra(record.data.era ?? '');
    setPrice(record.data.price ?? '');
    setUrl(record.data.url ?? '');
    setNote(record.data.note ?? '');
    setMessage('');
  }

  function clearForm() {
    setSelectedBookId('');
    setSelectedIdentity(null);
    setName('');
    setAuthor('');
    setCategory('');
    setKeyword('');
    setSellPoint('');
    setAudience('');
    setPersons('');
    setEra('');
    setPrice('');
    setUrl('');
    setNote('');
    setMessage('');
  }

  function productData(): BookProductInfo {
    return {
      name: name.trim(),
      author: emptyToUndefined(author),
      category: emptyToUndefined(category),
      keyword: emptyToUndefined(keyword),
      sellPoint: emptyToUndefined(sellPoint),
      audience: emptyToUndefined(audience),
      persons: emptyToUndefined(persons),
      era: emptyToUndefined(era),
      price: emptyToUndefined(price),
      url: emptyToUndefined(url),
      note: emptyToUndefined(note),
    };
  }

  async function saveSelection() {
    if (!name.trim()) {
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
        const saved = await api.saveBookSelection({
          theme: theme.trim(),
          bookId: selectedIdentity?.bookId,
          previousIdentity: selectedIdentity ?? undefined,
          data: productData(),
        });
        setSelectedBookId(saved.bookId);
        setSelectedIdentity({ theme: saved.theme, bookId: saved.bookId });
        await loadSelections();
        setMessage('已保存选品。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function deleteSelection(record: BookSelectionRecord) {
    await bookAction.run(async () => {
      setPendingAction(`delete:${record.bookId}`);
      try {
        await api.deleteBookSelection(record.theme, record.bookId);
        if (selectedIdentity?.theme === record.theme && selectedIdentity.bookId === record.bookId) clearForm();
        await loadSelections();
        setMessage('已删除选品。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  function handoffProduct(record: BookSelectionRecord, view: ShellView) {
    sessionStorage.setItem('book_product_info', JSON.stringify(record.data));
    if (view === 'benchmark') {
      sessionStorage.setItem('benchmark_search', record.data.keyword || record.data.name);
    }
    navigate(view);
  }

  return (
    <div className="local-lab-workbench selection-grid" data-local-lab-workbench="book-selection">
      <section className="local-lab-rail selection-list-panel">
        <div className="panel-title-row">
          <div>
            <h2>选品助手</h2>
            <span>本地维护商品卖点，直接带入新任务。</span>
          </div>
          <button className="ghost-action compact-action" type="button" onClick={clearForm}>
            <Plus size={15} />
            新选品
          </button>
        </div>
        <div className="selection-card-list">
          {records.length === 0 ? <EmptyState title="暂无选品" /> : null}
          {records.map((record) => (
            <article key={`${record.theme}-${record.bookId}`} className={selectedIdentity?.theme === record.theme && selectedIdentity.bookId === record.bookId ? 'selection-card active' : 'selection-card'}>
              <button type="button" className="selection-card-main" onClick={() => loadRecord(record)}>
                <strong>{record.data.name}</strong>
                <span>{record.theme} · {record.data.author || record.data.category || '未填分类'}</span>
                <p>{record.data.sellPoint || record.data.note || '未填写卖点'}</p>
              </button>
              <div className="selection-card-actions">
                <button className="mini-button" type="button" onClick={() => handoffProduct(record, 'new-task')}>带入新建任务</button>
                <button className="mini-button" type="button" onClick={() => handoffProduct(record, 'benchmark')}>去对标导入</button>
                <button className="mini-button" type="button" disabled={pendingAction === `delete:${record.bookId}` || pendingAction === 'save'} onClick={() => deleteSelection(record)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="local-lab-main selection-editor-panel">
        <div className="panel-title-row">
          <div>
            <h3>{selectedBookId ? '编辑选品' : '新增选品'}</h3>
            <span>商品信息只保存在本地，不调用远端 Storybound 接口。</span>
          </div>
          <button className="primary-action slim" type="button" disabled={pendingAction !== null} onClick={saveSelection}>
            <Save size={15} />
            保存选品
          </button>
        </div>
        <div className="selection-form-grid">
          <Field label="主题">
            <input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="例如：故事带货 / 健康书单" />
          </Field>
          <Field label="商品 / 书名">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：额尔古纳河右岸" />
          </Field>
          <Field label="作者">
            <input value={author} onChange={(event) => setAuthor(event.target.value)} />
          </Field>
          <Field label="分类">
            <input value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
          <Field label="关键词">
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </Field>
          <Field label="价格">
            <input value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <Field label="目标人群">
            <input value={audience} onChange={(event) => setAudience(event.target.value)} />
          </Field>
          <Field label="人物">
            <input value={persons} onChange={(event) => setPersons(event.target.value)} />
          </Field>
          <Field label="年代 / 场景">
            <input value={era} onChange={(event) => setEra(event.target.value)} />
          </Field>
          <Field label="链接">
            <input value={url} onChange={(event) => setUrl(event.target.value)} />
          </Field>
        </div>
        <Field label="核心卖点">
          <textarea className="small-textarea" value={sellPoint} onChange={(event) => setSellPoint(event.target.value)} />
        </Field>
        <Field label="备注">
          <textarea className="small-textarea" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={bookAction.feedback} />
      </section>
    </div>
  );
}
