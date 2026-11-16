import { useEffect, useRef, useState } from 'react';
import { Wand2 } from 'lucide-react';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import type { MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';
import type { MotionComicAssetCategory, MotionComicAssetExtractInput, MotionComicAssetExtractionApplyInput, MotionComicAssetExtractionCandidate } from '../../shared/motion-comic-asset-extraction';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, Dialog, SelectField, Toolbar } from '../../ui';
import './MotionComicAssetExtraction.css';

export interface MotionComicAssetExtractionProps {
  document: MotionComicPipelineData;
  category: 'characters' | 'scenes' | 'props';
  api: StoryDreamApi;
  disabled?: boolean;
  onPrepare: () => Promise<MotionComicPipelineData>;
  onRefresh: () => Promise<void>;
  onPropose: (saved: MotionComicPipelineData, input: Omit<MotionComicAssetExtractInput, 'id' | 'expectedUpdatedAt'>) => Promise<MotionComicScriptSnapshot>;
  onApply: (saved: MotionComicPipelineData, input: Omit<MotionComicAssetExtractionApplyInput, 'id' | 'expectedUpdatedAt'>) => Promise<MotionComicScriptSnapshot>;
}
type Receipt = { requestId: string; candidateId?: string };
type Choice = { selected: boolean; mode: '' | 'existing' | 'new'; existingId: string };
const statusLabels = { running: '生成中', ready: '待确认', failed: '生成失败', unknown: '结果未知', stale: '已过期', applied: '已入库' };
const memoryReceipts = new Map<string, Receipt>();
function restore(key: string): Receipt | null {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as Receipt : memoryReceipts.get(key) ?? null; }
  catch { return memoryReceipts.get(key) ?? null; }
}
export function MotionComicAssetExtraction(props: MotionComicAssetExtractionProps) {
  return <ExtractionSession key={`${props.document.id}:${props.category}`} {...props} />;
}
function ExtractionSession({ document, category, api, disabled, onPrepare, onRefresh, onPropose, onApply }: MotionComicAssetExtractionProps) {
  const backendCategory: MotionComicAssetCategory = category === 'scenes' ? 'sceneAssets' : category;
  const label = category === 'characters' ? '人物' : category === 'scenes' ? '地点' : '道具';
  const receiptKey = `motion-comic-asset-extraction:${document.id}:${backendCategory}`;
  const [open, setOpen] = useState(false);
  const [sourceEpisodeId, setSourceEpisodeId] = useState('');
  const [records, setRecords] = useState<MotionComicAssetExtractionCandidate[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(() => restore(receiptKey));
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  const reading = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const episodes = document.sourceDocument?.episodes ?? [];
  const source = episodes.find(item => item.id === sourceEpisodeId);
  const existing = category === 'characters' ? document.characters.map(item => ({ id: item.id, name: item.name, aliases: item.aliases ?? [] })) : (category === 'scenes' ? document.sceneAssets : document.props).map(item => ({ id: item.id, name: item.label, aliases: [] as string[] }));
  function accept(snapshot: MotionComicScriptSnapshot) {
    if (!alive.current || snapshot.projectId !== document.id) return;
    const next = (snapshot.assetExtractions ?? []).filter(item => item.projectId === document.id && item.category === backendCategory);
    setRecords(next);
    const pending = restore(receiptKey);
    const found = pending && next.find(item => pending.candidateId ? item.id === pending.candidateId : item.requestId === pending.requestId);
    if (found && (pending?.candidateId ? ['applied', 'stale', 'failed'].includes(found.status) : ['ready', 'failed', 'stale', 'applied'].includes(found.status))) {
      try { sessionStorage.removeItem(receiptKey); } catch { /* Memory still guards this session. */ }
      memoryReceipts.delete(receiptKey); setReceipt(null);
    }
  }
  async function readSnapshot() {
    if (reading.current || lock.current) return;
    reading.current = true;
    try { const snapshot = await api.getMotionComicScripts(document.id); accept(snapshot); }
    catch { if (alive.current) setError('读取服务器候选失败；未重发任何生成或入库请求。'); }
    finally { reading.current = false; }
  }
  function persist(value: Receipt) {
    sessionStorage.setItem(receiptKey, JSON.stringify(value));
    memoryReceipts.set(receiptKey, value); setReceipt(value);
  }
  async function perform(candidate?: MotionComicAssetExtractionCandidate) {
    if (lock.current || disabled || receipt || records.some(item => item.status === 'running' || item.status === 'unknown')) return;
    const selections: MotionComicAssetExtractionApplyInput['selections'] = [];
    if (candidate) {
      if (candidate.status !== 'ready') return;
      for (const item of itemsFor(candidate)) {
        const choice = choices[`${candidate.id}:${item.key}`];
        if (!choice?.selected) continue;
        if (!choice.mode || (choice.mode === 'existing' && !existing.some(entry => entry.id === choice.existingId))) return;
        selections.push(choice.mode === 'new' ? { key: item.key, mode: 'new' } : { key: item.key, mode: 'existing', existingId: choice.existingId });
      }
      if (!selections.length) return;
    } else if (!source?.sourceText.trim()) return;
    lock.current = true; setBusy('保存中…'); setError(''); setNotice('');
    let dispatched = false;
    try {
      const saved = await onPrepare();
      if (!alive.current) return;
      if (saved.id !== document.id) throw new Error('保存返回的项目与当前项目不一致');
      if (!candidate && !saved.sourceDocument?.episodes.some(item => item.id === sourceEpisodeId && item.sourceText.trim())) throw new Error('保存后所选来源已不可用');
      const intent = { requestId: crypto.randomUUID(), ...(candidate ? { candidateId: candidate.id } : {}) };
      persist(intent); // Persist before dispatch; an ambiguous await must never create another request.
      dispatched = true; setBusy(candidate ? '入库中…' : '生成中…');
      const snapshot = candidate
        ? await onApply(saved, { candidateId: candidate.id, revision: candidate.revision, inputFingerprint: candidate.inputFingerprint, selections })
        : await onPropose(saved, { sourceEpisodeId, category: backendCategory, requestId: intent.requestId });
      if (!alive.current) return;
      accept(snapshot);
      if (candidate) {
        const result = snapshot.projectId === document.id ? snapshot.assetExtractions?.find(item => item.id === candidate.id && item.projectId === document.id && item.category === backendCategory) : undefined;
        if (result?.status === 'applied') {
          setNotice('所选资产已入库。未选条目不会入库，此候选不能再次采用。');
          try { await onRefresh(); } catch { if (alive.current) setError('入库已完成，但资产页刷新失败；请重新打开资产页核对，不要重复入库。'); }
        } else if (result?.status === 'stale') setError('来源或资产定义已变化，候选已过期，请重新提取。');
        else if (result?.status === 'failed') setError('候选处理失败，未确认入库；请核对失败原因后重新提取。');
        else setError('入库结果尚未确认；保留请求凭据，请读取服务器候选核对，不会自动重发。');
      } else setNotice('请求已提交，请预览候选后逐项确认。');
    } catch (cause) {
      // Only explicit server rejections establish that no write was accepted.
      // A transport exception (or a ready snapshot alone) is never such evidence.
      const explicitCode = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : cause instanceof Error ? /^(MOTION_COMIC_STALE_WRITE|ASSET_EXTRACTION_(?:PROJECT_BUSY|SOURCE_REQUIRED|REVISION|NOT_READY))(?::|$)/u.exec(cause.message)?.[1] : undefined;
      const rejected = Boolean(explicitCode && ['MOTION_COMIC_STALE_WRITE', 'ASSET_EXTRACTION_PROJECT_BUSY', 'ASSET_EXTRACTION_SOURCE_REQUIRED', 'ASSET_EXTRACTION_REVISION', 'ASSET_EXTRACTION_NOT_READY'].includes(explicitCode));
      if (alive.current && dispatched && rejected) {
        try { sessionStorage.removeItem(receiptKey); memoryReceipts.delete(receiptKey); setReceipt(null); }
        catch { /* Keep the receipt if persistent storage cannot be cleared. */ }
      }
      if (alive.current) setError(`${cause instanceof Error ? cause.message : '操作未完成'}。${dispatched ? rejected ? '服务器明确未接受本次操作；请读取最新候选，核对来源、保存版本及项目状态后再次确认。' : '结果未知：保留请求凭据，不会自动重发。请读取服务器候选核对。' : '请求尚未发送，请检查保存状态。'}`);
    } finally { lock.current = false; if (alive.current) setBusy(''); }
  }
  const blocked = Boolean(disabled || busy || receipt || records.some(item => item.status === 'running' || item.status === 'unknown'));
  function updateChoice(key: string, patch: Partial<Choice>) { setChoices(previous => ({ ...previous, [key]: { ...(previous[key] ?? { selected: false, mode: '', existingId: '' }), ...patch } })); }
  return <>
    <Button density="compact" variant="subtle" icon={<Wand2 size={13} />} onClick={() => { setOpen(true); void readSnapshot(); }}>从剧本提取{label}</Button>
    <Dialog open={open} onOpenChange={setOpen} title={`独立${label}提取`} surfaceClassName="mc-extraction-dialog" actions={<Button onClick={() => setOpen(false)}>关闭</Button>}>
      <div className="mc-extraction" aria-busy={Boolean(busy)}>
        <p>从已导入的单集原文提取{label}候选。生成可能产生模型调用费用；先保存当前项目，再发送一次生成请求。</p>
        {!episodes.length ? <p className="mc-extraction__notice">暂无来源分集。请先导入原文并划分分集，再返回提取。</p> : <>
          <SelectField label="来源分集" value={sourceEpisodeId} disabled={blocked} options={[{ value: '', label: '请选择来源分集' }, ...episodes.map(item => ({ value: item.id, label: `第 ${item.number} 集 · ${item.title}` }))]} onChange={event => setSourceEpisodeId(event.target.value)} />
          {source ? <details><summary>查看来源原文 · {source.title}</summary><p className="mc-extraction__source">{source.sourceText || '此分集原文为空，不能生成。'}</p></details> : null}
        </>}
        <Toolbar aria-label="提取操作" className="mc-extraction__toolbar">
          <Button variant="primary" disabled={blocked || !source?.sourceText.trim()} onClick={() => void perform()}>{busy || `保存并生成${label}候选`}</Button>
          <Button disabled={Boolean(busy)} onClick={() => void readSnapshot()}>读取服务器候选</Button>
        </Toolbar>
        {receipt ? <p className="mc-extraction__notice" role="status">请求处理中或结果未知，已锁定生成与入库。读取仅核对服务器已保存记录，不会查询供应商或重发请求。请求编号：{receipt.requestId}</p> : null}
        {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
        <section aria-label={`${label}提取候选`} className="mc-extraction__list">
          {!records.length ? <p>尚无{label}候选。来源选择与生成都由你明确确认。</p> : [...records].reverse().map(candidate => {
            const items = itemsFor(candidate);
            const selected = items.filter(item => choices[`${candidate.id}:${item.key}`]?.selected);
            const incomplete = selected.some(item => { const choice = choices[`${candidate.id}:${item.key}`]; return !choice.mode || (choice.mode === 'existing' && !existing.some(entry => entry.id === choice.existingId)); });
            return <article className="mc-extraction__candidate" key={candidate.id}>
              <header><strong>{statusLabels[candidate.status]} · {label}候选</strong><span>{episodes.find(item => item.id === candidate.sourceEpisodeId)?.title ?? candidate.sourceEpisodeId} · r{candidate.revision}</span></header>
              <p className="mc-extraction__meta">{candidate.provider} / {candidate.model} · {candidate.createdAt}</p>
              {candidate.error ? <p role="alert">{candidate.error}</p> : null}
              {candidate.status === 'unknown' ? <p>结果未知；不提供重试。可读取服务器记录核对，读取不会触发生成。</p> : null}
              {candidate.status === 'stale' ? <p>来源或项目资产已变化，此候选不可入库。</p> : null}
              {candidate.status === 'ready' && !items.length ? <p>此来源未发现{label}，没有可入库条目。</p> : null}
              {items.map(item => {
                const key = `${candidate.id}:${item.key}`; const choice = choices[key] ?? { selected: false, mode: '', existingId: '' };
                const name = 'name' in item ? item.name : item.label;
                const names = [name, ...('aliases' in item ? item.aliases : [])].map(value => value.trim().toLocaleLowerCase());
                const matches = existing.filter(entry => [entry.name, ...entry.aliases].some(value => names.includes(value.trim().toLocaleLowerCase())));
                return <div className="mc-extraction__item" key={key}>
                  <label className="mc-extraction__check"><input type="checkbox" checked={choice.selected} disabled={blocked || candidate.status !== 'ready'} onChange={event => updateChoice(key, { selected: event.target.checked })} />选入库：{name}</label>
                  {'name' in item ? <><p><b>定义：</b>{item.identityPrompt}</p><p>别名：{item.aliases.join('、') || '无'} · {item.role}</p><p>性格：{item.personality} · 声音描述：{item.voiceNotes}</p><div className="mc-extraction__looks">{item.looks.map(look => <div key={look.key}><strong>造型 · {look.label}</strong><p>{look.appearancePrompt}</p><p>服装：{look.wardrobe}</p><p>连续性：{look.continuityNotes}</p></div>)}</div></> : <><p><b>定义：</b>{item.description}</p><p>视觉：{item.prompt}</p>{'continuityNotes' in item ? <p>连续性：{item.continuityNotes}</p> : null}</>}
                  <p>名称 / 别名匹配提示：{matches.length ? matches.map(entry => entry.name).join('、') : '暂无匹配'}。同名不代表同一资产，必须自行确认。</p>
                  <div className="mc-extraction__choices"><SelectField label={`${name}入库方式`} value={choice.mode} disabled={blocked || candidate.status !== 'ready' || !choice.selected} options={[{ value: '', label: '请选择复用或新建' }, { value: 'existing', label: '复用已有资产' }, { value: 'new', label: '新建资产' }]} onChange={event => updateChoice(key, { mode: event.target.value as Choice['mode'], existingId: '' })} />
                    {choice.mode === 'existing' ? <SelectField label={`${name}复用目标`} value={choice.existingId} disabled={blocked || !choice.selected || candidate.status !== 'ready'} options={[{ value: '', label: '请选择并确认已有资产' }, ...existing.map(entry => ({ value: entry.id, label: `${entry.name}${entry.aliases.length ? `（${entry.aliases.join('、')}）` : ''} · ${entry.id}` }))]} onChange={event => updateChoice(key, { existingId: event.target.value })} /> : null}</div>
                  {choice.mode ? <p>{choice.mode === 'existing' ? '只复用已有资产；不修改定义、字段、声音或样音，人物不新增候选造型。' : '新建所选资产；新人物会携带上述候选造型。'}</p> : null}
                </div>;
              })}
              <p>仅所选条目入库；采用一次后此候选结束，未选条目不会再入库。</p>
              <Button variant="primary" disabled={blocked || candidate.status !== 'ready' || !selected.length || incomplete} onClick={() => void perform(candidate)}>保存并入库 {selected.length} 项</Button>
            </article>;
          })}
        </section>
      </div>
    </Dialog>
  </>;
}
function itemsFor(candidate: MotionComicAssetExtractionCandidate) {
  const output = candidate.output;
  if (!output) return [];
  if (candidate.category === 'characters' && 'characters' in output) return output.characters;
  if (candidate.category === 'sceneAssets' && 'sceneAssets' in output) return output.sceneAssets;
  if (candidate.category === 'props' && 'props' in output) return output.props;
  return [];
}
