import { useId, useRef, useState } from 'react';
import type { MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import type { MotionComicScriptProposal as Proposal } from '../../shared/motion-comic-script-proposal';
import { Button, SelectField, TextAreaField } from '../../ui';
import './motion-comic-script-proposal.css';

export interface ScriptProposalRequest { sceneKey: string; beatKey: string; instruction: string; requestId: string }
interface Props {
  scopeId?: string;
  script: MotionComicScriptDraft;
  revision: number;
  proposals: Proposal[];
  disabledReason: string;
  onPropose: (input: ScriptProposalRequest) => Promise<void>;
  onAdopt: (proposal: Proposal) => Promise<void>;
  onRevert?: (proposal: Proposal) => Promise<void>;
  onRefresh?: () => Promise<Proposal[]>;
}
const labels: Record<Proposal['status'], string> = { running: '生成中', ready: '待采用', failed: '生成失败', stale: '已过期', applied: '已采用', reverted: '已撤销采用', dismissed: '已放弃' };

export function scriptProposalAdoptionReason(proposal: Proposal, script: MotionComicScriptDraft, revision: number, disabledReason: string): string {
  if (disabledReason) return disabledReason;
  if (proposal.status !== 'ready') return `此候选${labels[proposal.status]}，不能采用。`;
  if (proposal.baseRevision !== revision) return '基准版本已变化，候选已过期；请核对当前稿后重新发起。';
  const scenes = script.scenes.filter(scene => scene.key === proposal.sceneKey);
  const beats = scenes.flatMap(scene => scene.beats.filter(beat => beat.key === proposal.beatKey));
  if (scenes.length !== 1 || beats.length !== 1 || beats[0].text !== proposal.originalText) return '目标段落已变化或不可用，不能采用。';
  if (!proposal.proposedText?.trim()) return '候选内容不可用，不能采用。';
  return '';
}

export function scriptProposalRevertReason(proposal: Proposal, revision: number, disabledReason: string): string {
  if (disabledReason) return disabledReason;
  if (proposal.status !== 'applied') return '仅已采用的提案可以撤销。';
  if (revision !== proposal.appliedRevision) return '采用后已有后续版本，不能撤销此次采用。';
  if (!proposal.appliedScriptHash) return '此旧记录缺少采用时的校验信息，不能安全撤销。';
  return '';
}

/** Explicit, single-beat requests only. Never retries a failed or ambiguous operation. */
type PendingRequest = { kind: string; requestId?: string; proposalId?: string };
const uncertainRequests = new Map<string, PendingRequest>();
const storageKey = (scopeId: string) => `comic-script-proposal-pending:${scopeId}`;
function restorePending(scopeId: string): PendingRequest | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(scopeId));
    if (!raw) return uncertainRequests.get(scopeId) ?? null;
    const value = JSON.parse(raw) as PendingRequest;
    if (!value || typeof value.kind !== 'string' || (value.requestId !== undefined && typeof value.requestId !== 'string') || (value.proposalId !== undefined && typeof value.proposalId !== 'string')) throw new Error('Invalid pending request');
    return value;
  } catch { return { kind: 'storage-unavailable' }; }
}

export function MotionComicScriptProposal({ scopeId = 'standalone', script, revision, proposals, disabledReason, onPropose, onAdopt, onRevert, onRefresh }: Props) {
  const id = useId();
  const [sceneKey, setSceneKey] = useState(script.scenes[0]?.key ?? '');
  const scene = script.scenes.find(item => item.key === sceneKey) ?? script.scenes[0];
  const [beatKey, setBeatKey] = useState('');
  const beat = scene?.beats.find(item => item.key === beatKey) ?? scene?.beats[0];
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState('');
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState<PendingRequest | null>(() => restorePending(scopeId));
  const [storageBlocked, setStorageBlocked] = useState(false);
  function recheckStorage() {
    if (!storageBlocked || uncertain || inFlight.current) return;
    try {
      const probe = `${storageKey(scopeId)}:probe`;
      sessionStorage.setItem(probe, '1'); sessionStorage.removeItem(probe);
      setStorageBlocked(false); setError(''); setNotice('本地存储已恢复。上次请求未提交，可重新提交。');
    } catch { setError('本地存储仍不可用；请求尚未提交，请恢复存储后再检查。'); }
  }
  const running = proposals.some(item => item.status === 'running');
  const blocked = disabledReason || (storageBlocked ? '请求未提交：本地存储不可用，请先重新检查本地存储。' : '') || (uncertain ? '上次请求结果未明，已锁定生成、采用和撤销；请读取服务器状态核对。' : '') || (pending ? '操作进行中，请等待结果。' : running ? '已有候选正在生成；请等待状态更新，不要重复提交。' : '');
  const submitReason = blocked || (!beat ? '当前场次没有可修改的段落。' : !instruction.trim() ? '请填写这一个段落的修改要求。' : '');
  async function refreshUncertain() {
    if (!uncertain || !onRefresh || inFlight.current) return;
    inFlight.current = true; setPending('refresh');
    try {
      const records = await onRefresh();
      const record = records.find(item => uncertain.kind === 'propose' ? item.requestId === uncertain.requestId : item.id === (uncertain.proposalId ?? uncertain.kind));
      // Old receipts stored the adoption's proposal id in kind. Unknown intents never unlock.
      const isAdopt = uncertain.kind === 'adopt' || (!uncertain.proposalId && record?.id === uncertain.kind);
      const confirmed = record && (uncertain.kind === 'propose' ? record.status !== 'running' : uncertain.kind === 'revert' ? record.status === 'reverted' : isAdopt && ['applied', 'reverted'].includes(record.status));
      if (confirmed) { sessionStorage.removeItem(storageKey(scopeId)); uncertainRequests.delete(scopeId); setUncertain(null); setError(''); setNotice(`已读取服务器：${labels[record.status]}。请核对候选与当前版本后继续。`); }
      else setError('服务器尚无可确认的完成记录；保持锁定，不会重发生成、采用或撤销。请稍后再次读取状态。');
    } catch { setError('读取服务器状态失败；保持锁定，不会重发原操作。'); }
    finally { inFlight.current = false; setPending(''); }
  }
  async function perform(kind: string, operation: () => Promise<void>, requestId?: string, proposalId?: string) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(kind); setError(''); setNotice('');
    try {
      // Persist the receipt BEFORE any write, so reloads cannot lose an in-flight operation.
      try { sessionStorage.setItem(storageKey(scopeId), JSON.stringify({ kind, requestId, proposalId })); }
      catch { setStorageBlocked(true); setError('无法保存请求防重复凭据，已阻止提交；请求尚未发送，请重新检查本地存储。'); return; }
      await operation();
      sessionStorage.removeItem(storageKey(scopeId)); uncertainRequests.delete(scopeId);
      setNotice(kind === 'propose' ? '请求已提交；请核对候选状态与前后文本，生成不会自动采用。' : kind === 'revert' ? '已撤销此次采用并保存为新版本，请重新审阅；服务器版本号不会回退。' : '候选已采用，当前服务器稿已更新。'); }
    catch (cause) { uncertainRequests.set(scopeId, { kind, requestId, proposalId }); setUncertain({ kind, requestId, proposalId }); setError(`${cause instanceof Error ? cause.message : '请求未完成'}。结果可能未明；请等待状态刷新并核对服务器稿，不会自动重发。`); }
    finally { inFlight.current = false; setPending(''); }
  }
  return <section className="comic-script-proposal" aria-label="单段落 AI 修改提案" aria-busy={Boolean(pending)}>
    <header><strong>单段落 AI 提案</strong><span>当前基准 r{revision}</span></header>
    <p id={`${id}-scope`}>仅修改所选段落的正文；不改人物、类型、原文证据、场次结构或其他段落。生成后需单独采用。</p>
    <form onSubmit={event => { event.preventDefault(); if (!submitReason && scene && beat) { const requestId = crypto.randomUUID(); void perform('propose', () => onPropose({ sceneKey: scene.key, beatKey: beat.key, instruction: instruction.trim(), requestId }), requestId); } }}>
      <div className="comic-script-proposal__selection">
        <SelectField label="提案场次" value={scene?.key ?? ''} options={script.scenes.map(item => ({ value: item.key, label: `第 ${item.actIndex} 幕 · ${item.title}` }))} disabled={Boolean(pending)} onChange={event => { setSceneKey(event.target.value); setBeatKey(''); }} />
        <SelectField label="提案段落" value={beat?.key ?? ''} options={(scene?.beats ?? []).map((item, index) => ({ value: item.key, label: `第 ${index + 1} 条 · ${item.kind === 'dialogue' ? '对白' : item.kind === 'narration' ? '旁白' : '动作'}` }))} disabled={Boolean(pending)} onChange={event => setBeatKey(event.target.value)} />
      </div>
      {beat ? <details><summary>所选段落 · 当前服务器稿</summary><p className="comic-script-proposal__text">{beat.text}</p></details> : null}
      <TextAreaField label="这个段落的修改要求" value={instruction} rows={3} maxLength={4000} resize="vertical" disabled={Boolean(pending)} onChange={(_, data) => setInstruction(data.value)} aria-describedby={`${id}-scope ${id}-reason`} />
      <p id={`${id}-reason`} role="status">{submitReason || '将以当前已保存版本生成一个候选，不会直接修改剧本。'}</p>
      <Button type="submit" disabled={Boolean(submitReason)}>{pending === 'propose' ? '正在提交提案…' : '生成单段候选'}</Button>
    </form>
    {error ? <p role="alert" className="motion-comic-plan-error">{error}</p> : null}
    {storageBlocked ? <Button disabled={Boolean(pending)} onClick={recheckStorage}>重新检查本地存储</Button> : null}
    {uncertain ? <Button disabled={Boolean(pending) || !onRefresh} onClick={() => void refreshUncertain()}>读取服务器状态并核对</Button> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="comic-script-proposal__list" aria-label="AI 候选记录">
      {!proposals.length ? <p>尚无局部候选。先保存当前改稿，再提交修改要求。</p> : [...proposals].reverse().map(proposal => {
        const revertReason = scriptProposalRevertReason(proposal, revision, blocked) || (!onRevert ? '撤销接口不可用。' : '');
        const reason = scriptProposalAdoptionReason(proposal, script, revision, blocked);
        const targetScene = script.scenes.find(item => item.key === proposal.sceneKey);
        const beatIndex = targetScene?.beats.findIndex(item => item.key === proposal.beatKey) ?? -1;
        return <article key={proposal.id}>
          <header><strong>{labels[proposal.status]} · 基准 r{proposal.baseRevision}{proposal.appliedRevision ? ` → r${proposal.appliedRevision}` : ''}{proposal.revertedRevision ? ` → 撤销 r${proposal.revertedRevision}` : ''}</strong><span>{targetScene?.title ?? proposal.sceneKey} · {beatIndex >= 0 ? `第 ${beatIndex + 1} 条` : proposal.beatKey}</span></header>
          <p>要求：{proposal.instruction}</p>
          <div className="comic-script-proposal__comparison"><div><strong>修改前</strong><p className="comic-script-proposal__text">{proposal.originalText}</p></div><div><strong>候选修改后</strong><p className="comic-script-proposal__text">{proposal.proposedText ?? (proposal.status === 'running' ? '正在生成，尚无候选文本。' : '暂无可用候选。')}</p></div></div>
          {proposal.error ? <p className="motion-comic-plan-error">{proposal.error}</p> : null}
          <p>{reason || '采用时服务器会再次核对版本；采用后需重新审阅。'}</p>
          <Button disabled={Boolean(reason)} onClick={() => { if (!reason) void perform('adopt', () => onAdopt(proposal), undefined, proposal.id); }}>{pending === 'adopt' ? '正在采用…' : '采用此段候选'}</Button>
          {proposal.status === 'applied' ? <>
            <p>{revertReason || '撤销将恢复此次采用前的段落，保存为新版本并需要重新审阅；不会直接回退版本号。'}</p>
            <Button disabled={Boolean(revertReason)} onClick={() => { if (!revertReason && onRevert) void perform('revert', () => onRevert(proposal), undefined, proposal.id); }}>{pending === 'revert' ? '正在撤销采用…' : '撤销此次采用'}</Button>
          </> : null}
        </article>;
      })}
    </div>
  </section>;
}
