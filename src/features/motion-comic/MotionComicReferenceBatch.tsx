import { useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks, Loader2 } from 'lucide-react';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { DirectorBatchNodeSnapshot, DirectorBatchRecord } from '../../shared/director-batch-persistence';
import type { ReferenceBatchControlInput, ReferenceBatchTarget } from '../../shared/reference-batch';
import { describeErrorCause, formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { referenceBatchRequestCount } from '../../shared/reference-batch';
import { Button, Dialog, Toolbar } from '../../ui';
import './MotionComicReferenceBatch.css';

export type ReferenceBatchCategory = 'characters' | 'scenes' | 'props' | 'episode';
export interface MotionComicReferenceBatchProps {
  api: StoryDreamApi;
  document: MotionComicPipelineData;
  category: ReferenceBatchCategory;
  targetIds?: readonly string[];
  targetKeys?: readonly string[];
  scopeLabel?: string;
  emptyHint?: string;
  disabled?: boolean;
  leadingAction?: import('react').ReactNode;
  onPrepare: () => Promise<MotionComicPipelineData>;
  onRefresh: () => Promise<void>;
  onSubmit: (saved: MotionComicPipelineData, targets: ReferenceBatchTarget[]) => Promise<DirectorBatchRecord>;
  onControl: (id: string, action: ReferenceBatchControlInput['action']) => Promise<DirectorBatchRecord>;
  onList?: () => Promise<DirectorBatchRecord[]>;
  onGet?: (id: string) => Promise<DirectorBatchRecord | null>;
}
export interface ReferenceBatchChoice {
  target: ReferenceBatchTarget;
  group: string;
  label: string;
  candidateCount: number;
  fixed: boolean;
  defaultSelected: boolean;
}
const keyOf = (target: ReferenceBatchTarget) => `${target.kind}:${target.id}`;
const categoryNames = { characters: '人物造型', scenes: '场景', props: '道具', episode: '本集缺失资产' };

function filterReferenceBatchChoices(choices: ReferenceBatchChoice[], targetIds?: readonly string[], targetKeys?: readonly string[]): ReferenceBatchChoice[] {
  if (targetKeys) return choices.filter((item) => targetKeys.includes(keyOf(item.target)));
  return targetIds ? choices.filter((item) => targetIds.includes(item.target.id)) : choices;
}

export function referenceBatchChoices(document: MotionComicPipelineData, category: ReferenceBatchCategory): ReferenceBatchChoice[] {
  const choice = (target: ReferenceBatchTarget, group: string, label: string, ids: string[]): ReferenceBatchChoice => {
    const assets = document.assets.filter((asset) => ids.includes(asset.id) && asset.kind === 'image');
    const fixed = assets.some((asset) => asset.pinned || asset.selected);
    // Even an unavailable reference must not silently become a paid regeneration.
    const candidateCount = new Set(ids).size;
    return { target, group, label, candidateCount, fixed, defaultSelected: !fixed && candidateCount === 0 };
  };
  const characters = document.characters.flatMap((character) => character.looks.map((look) => choice({ kind: 'look', id: look.id }, character.name, look.label, look.referenceAssetVersionIds)));
  const scenes = document.sceneAssets.map((asset) => choice({ kind: 'scene', id: asset.id }, categoryNames.scenes, asset.label, asset.referenceAssetVersionIds));
  const props = document.props.map((asset) => choice({ kind: 'prop', id: asset.id }, categoryNames.props, asset.label, asset.referenceAssetVersionIds));
  if (category === 'episode') return [...characters, ...scenes, ...props];
  if (category === 'characters') return characters;
  return category === 'scenes' ? scenes : props;
}

export function canResumeReferenceBatch(batch: DirectorBatchRecord): boolean {
  return batch.status === 'paused' && !batch.cancelRequested && !batch.recoveryRequired
    && !batch.nodes.some((node) => node.reference?.submissionState === 'unknown' || node.reference?.submissionState === 'submitted')
    && batch.nodes.some((node) => node.reference?.submissionState === 'not-submitted' && node.status === 'pending');
}

/** Persisted plain failures need an explicit fallback; safe bridge payloads still take precedence. */
export function referenceBatchErrorMessage(reason: unknown): string {
  return formatAppErrorMessage(normalizeAppError(reason, { message: describeErrorCause(reason) }));
}

export function referenceBatchNodeLabel(node: DirectorBatchNodeSnapshot): string {
  if (node.reference?.submissionState === 'unknown') return '结果未知 · 请恢复查询';
  if (node.reference?.applyState === 'stale') return '输入过期 · 未挂接';
  if (node.reference?.submissionState === 'resolved' && node.reference.applyState === 'pending') return '待挂接';
  if (node.reference?.applyState === 'applied') return '候选已挂接 · 待采用';
  return ({ pending: '未提交', running: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消', skipped: '已跳过' })[node.status];
}

/** One server batch request, after awaiting the Page's persisted document. */
export async function submitPreparedReferenceBatch(
  props: Pick<MotionComicReferenceBatchProps, 'document' | 'category' | 'onPrepare' | 'onSubmit' | 'targetIds' | 'targetKeys'>,
  targets: ReferenceBatchTarget[],
): Promise<DirectorBatchRecord> {
  if (!targets.length) throw new Error('请至少选择一个目标。');
  const saved = await props.onPrepare();
  if (saved.id !== props.document.id) throw new Error('项目已切换，请重新打开批量生成。');
  const choices = filterReferenceBatchChoices(referenceBatchChoices(saved, props.category), props.targetIds, props.targetKeys);
  const before = filterReferenceBatchChoices(referenceBatchChoices(props.document, props.category), props.targetIds, props.targetKeys);
  for (const target of targets) {
    const current = choices.find((item) => keyOf(item.target) === keyOf(target));
    const previous = before.find((item) => keyOf(item.target) === keyOf(target));
    if (!current || !previous) throw new Error('所选目标已不存在，请关闭窗口后重新选择。');
    if (current.candidateCount !== previous.candidateCount || current.fixed !== previous.fixed) throw new Error('所选目标的参考图已变化，请关闭窗口后重新确认重绘范围。');
  }
  return props.onSubmit(saved, [...new Map(targets.map((target) => [keyOf(target), target])).values()]);
}

export function MotionComicReferenceBatch(props: MotionComicReferenceBatchProps) {
  const { document, category, disabled } = props;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batches, setBatches] = useState<DirectorBatchRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{ batch: DirectorBatchRecord; action: 'resume' | 'cancel' } | null>(null);
  const commandBusy = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const choices = useMemo(() => filterReferenceBatchChoices(referenceBatchChoices(document, category), props.targetIds, props.targetKeys), [category, document, props.targetIds]);
  const targets: ReferenceBatchTarget[] = selected.map((key) => ({ kind: key.slice(0, key.indexOf(':')) as ReferenceBatchTarget['kind'], id: key.slice(key.indexOf(':') + 1) }));
  const groups = [...new Set(choices.map((item) => item.group))];
  const allowedKinds = category === 'episode' ? new Set(['look', 'scene', 'prop']) : new Set([category === 'characters' ? 'look' : category === 'scenes' ? 'scene' : 'prop']);
  const visibleBatches = batches.filter((batch) => batch.projectId === document.id && batch.plan.purpose === 'reference-generation'
    && batch.nodes.some((node) => node.reference && allowedKinds.has(node.reference.target.kind)));
  // Live totals drive the inline progress line, so an async batch is observable without opening the history.
  const runningNodes = visibleBatches.filter((batch) => ['queued', 'running', 'cancelling'].includes(batch.status)).flatMap((batch) => batch.nodes.filter((node) => node.reference));
  const finishedNodes = visibleBatches.flatMap((batch) => batch.nodes.filter((node) => node.reference && node.status === 'completed'));
  const activeNodes = runningNodes.length;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let appliedSignature = '';
    const read = async () => {
      const current = latest.current;
      try {
        const records = await (current.onList ? current.onList() : current.api.listDirectorBatches({ projectId: document.id }));
        if (!stopped) {
          setBatches(records);
          const signature = records.filter((record) => record.projectId === document.id && record.plan.purpose === 'reference-generation')
            .flatMap((record) => record.nodes.filter((node) => node.reference?.applyState === 'applied')
              .map((node) => `${record.id}:${node.id}:${node.reference?.resultAssetVersionId ?? ''}`)).sort().join('|');
          if (signature && signature !== appliedSignature) {
            appliedSignature = signature;
            try { await latest.current.onRefresh(); }
            catch { if (!stopped) setNotice('候选已生成，但项目刷新失败。请点击刷新项目结果。'); }
          }
        }
      } catch (reason) {
        if (!stopped) setError(`任务列表读取失败：${referenceBatchErrorMessage(reason)}`);
      } finally {
        if (!stopped) timer = setTimeout(() => void read(), 5000);
      }
    };
    void read();
    return () => { stopped = true; clearTimeout(timer); };
  }, [document.id]);

  const remember = (batch: DirectorBatchRecord) => setBatches((items) => [batch, ...items.filter((item) => item.id !== batch.id)]);
  const run = async (operation: () => Promise<void>, requiresEnabled = false) => {
    if (commandBusy.current || (requiresEnabled && disabled)) return;
    commandBusy.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (reason) { setError(referenceBatchErrorMessage(reason)); }
    finally { commandBusy.current = false; setBusy(false); }
  };
  const refreshDocument = async () => {
    try { await latest.current.onRefresh(); }
    catch { setNotice('任务已记录，但项目刷新失败。请刷新项目查看候选；不要重复提交。'); }
  };
  const submit = () => run(async () => {
    const batch = await submitPreparedReferenceBatch(latest.current, targets);
    remember(batch); setOpen(false); setSelected([]);
    setNotice('批量任务已提交，生成结果仅加入候选，请完成后手动采用。');
    await refreshDocument();
  }, true);
  const control = (batch: DirectorBatchRecord, action: ReferenceBatchControlInput['action']) => run(async () => {
    if (action === 'resume') {
      const current = await (latest.current.onGet ? latest.current.onGet(batch.id) : latest.current.api.getDirectorBatch(batch.id));
      if (!current || !canResumeReferenceBatch(current)) throw new Error('当前任务不能继续提交。结果未知时请先恢复查询。');
    }
    remember(await latest.current.onControl(batch.id, action));
    setConfirmation(null);
    await refreshDocument();
  });

  return <section className={`comic-reference-batch${category === 'episode' ? ' comic-reference-batch--episode' : ''}`} aria-label={props.scopeLabel ? `${props.scopeLabel} · ${categoryNames[category]}批量参考图` : `${categoryNames[category]}批量参考图`}>
    <div className="comic-reference-batch__bar">
      {props.leadingAction}
      <span className="comic-reference-batch__spacer" />
      {activeNodes > 0 ? <span className="comic-reference-batch__live" role="status" aria-live="polite">
        <Loader2 className="director-spin" size={12} aria-hidden="true" />
        <span>后台生成中 · 剩 {activeNodes} 项</span>
        <small>{visibleBatches.filter((batch) => ['queued', 'running', 'cancelling'].includes(batch.status)).length} 个批次 · 完成后只追加候选</small>
      </span> : null}
      <Button density="compact" variant="secondary" icon={<ListChecks size={13} />} disabled={disabled || busy || !choices.length} onClick={() => { setSelected(choices.filter((item) => item.defaultSelected).map((item) => keyOf(item.target))); setError(''); setOpen(true); }}>{props.scopeLabel ? `${props.scopeLabel} · 选择并批量生成…` : '选择并批量生成…'}</Button>
    </div>
    {!open && error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {visibleBatches.length > 0 && <details className="comic-reference-batch__history" open={activeNodes > 0}>
      <summary>后台参考图任务 · {activeNodes > 0 ? `${activeNodes} 项生成中` : visibleBatches.length > 1 ? `${visibleBatches.length} 个批次` : '最近一次批次'}{finishedNodes.length > 0 ? ` · 已追加 ${finishedNodes.length} 个候选` : ''}</summary>
      {visibleBatches.map((batch) => <article key={batch.id} className="comic-reference-batch__record">
        <strong>参考图任务 · {({ draft: '草稿', queued: '排队中', running: '运行中', paused: '已暂停', cancelling: '取消中', completed: '已完成', failed: '失败', cancelled: '已取消' })[batch.status]}</strong>
        <small>{batch.id}</small>
        {batch.recoveryReason && <p>{referenceBatchErrorMessage(batch.recoveryReason)}</p>}
        <ul>{batch.nodes.filter((node) => node.reference).map((node) => <li key={node.id}><span>{node.title}</span><span>{referenceBatchNodeLabel(node)}</span>{node.error && <small>{referenceBatchErrorMessage(node.error)}</small>}</li>)}</ul>
        <Toolbar aria-label="批量任务控制">
          <Button disabled={busy} onClick={() => void control(batch, 'reconcile')}>恢复查询</Button>
          <Button disabled={busy} onClick={() => void run(refreshDocument)}>刷新项目结果</Button>
          <Button disabled={disabled || busy || !canResumeReferenceBatch(batch)} onClick={() => setConfirmation({ batch, action: 'resume' })}>继续未提交</Button>
          {['queued', 'running'].includes(batch.status) && <Button disabled={busy || batch.pauseRequested} onClick={() => void control(batch, 'pause')}>{batch.pauseRequested ? '暂停请求中' : '暂停'}</Button>}
          {!['completed', 'cancelled', 'failed'].includes(batch.status) && <Button disabled={busy || batch.cancelRequested} onClick={() => setConfirmation({ batch, action: 'cancel' })}>取消任务</Button>}
        </Toolbar>
        <p className="comic-reference-batch__hint">恢复查询仅核对已有请求；继续未提交可能产生费用。暂停或取消不会撤回服务商已接收的请求。</p>
      </article>)}
    </details>}
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }} title={`批量生成${categoryNames[category]}参考图`} surfaceClassName="comic-reference-batch__dialog"
      actions={<><Button disabled={busy} onClick={() => setOpen(false)}>返回</Button><Button variant="primary" disabled={disabled || busy || !targets.length} onClick={() => void submit()}>{busy ? '保存并提交中…' : `保存并提交 ${referenceBatchRequestCount(targets)} 次生成`}</Button></>}>
      <p>仅提交下方勾选的目标。默认选择没有参考候选且未固定的目标；已有候选请先采用，也可显式勾选重绘。</p>
      <p className="comic-reference-batch__hint">提交前保存当前修改；生成可能产生费用，以模型服务商实际计费为准。生成只增加候选，不自动固定，也不覆盖已采用参考图。每个人物造型调用 3 次；首次无参考时先生成正面，再以正面图生成侧面和背面。</p>
      {choices.length === 0 && <p>{props.emptyHint ?? `暂无可生成的${categoryNames[category]}。请先添加资产${category === 'characters' ? '及人物造型' : ''}。`}</p>}
      <div className="comic-reference-batch__choices">{groups.map((group) => <fieldset key={group} disabled={busy || disabled}><legend>{group}</legend>{choices.filter((item) => item.group === group).map((item) => <label key={keyOf(item.target)}>
        <input type="checkbox" checked={selected.includes(keyOf(item.target))} onChange={(event) => setSelected((items) => event.target.checked ? [...items, keyOf(item.target)] : items.filter((key) => key !== keyOf(item.target)))} />
        <span>{item.label}<small>{item.fixed ? '已固定 · 勾选将重绘候选' : item.candidateCount ? `${item.candidateCount} 个候选待采用 · 勾选将重绘` : '缺少参考图'}</small></span>
      </label>)}</fieldset>)}</div>
      <p role="status">已选 {targets.length} 项 · {referenceBatchRequestCount(targets)} 次图片生成 · {categoryNames[category]}</p>
      {error && <p role="alert">{error}</p>}
    </Dialog>
    <Dialog open={Boolean(confirmation)} onOpenChange={(value) => { if (!value && !busy) setConfirmation(null); }} title={confirmation?.action === 'resume' ? '确认继续未提交目标' : '确认取消任务'}
      actions={<><Button disabled={busy} onClick={() => setConfirmation(null)}>返回</Button><Button disabled={busy || (disabled && confirmation?.action === 'resume')} variant={confirmation?.action === 'cancel' ? 'danger' : 'primary'} onClick={() => { if (confirmation) void control(confirmation.batch, confirmation.action); }}>确认{confirmation?.action === 'resume' ? '继续' : '取消'}</Button></>}>
      <p>{confirmation?.action === 'resume' ? '仅继续这个批次中尚未提交的目标，可能产生费用。已有请求不会自动重发，输入以原批次快照为准。' : '停止继续提交剩余目标；已被服务商接收的请求可能仍会完成并计费，可通过恢复查询核对结果。'}</p>
      {confirmation?.action === 'resume' && <ul>{confirmation.batch.nodes.filter((node) => node.reference?.submissionState === 'not-submitted' && node.status === 'pending').map((node) => <li key={node.id}>{node.title}</li>)}</ul>}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  </section>;
}
