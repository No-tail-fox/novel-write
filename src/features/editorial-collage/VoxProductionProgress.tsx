import type { EditorialCollageShot } from '../../shared/editorial-collage';
import { creativeStyleStatus } from '../../shared/creative-animation/status';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, CheckboxField, Dialog, TextAreaField } from '../../ui';
import { isLemoImageUnknownNode, voxProductionNodeStatus, type VoxProductionControl, type VoxProductionNode, type VoxProductionRun } from '../../shared/vox-production';
import { lemoAgentMaxTurns, lemoAgentProgressText, type LemoUpstreamFilm } from '../../shared/creative-animation/upstream-agent';
import { lemoAgentToolLabel, voxProductionStepCount, voxProductionStepTotalLabel, type LemoAgentActivity } from '../../shared/lemo-agent-activity';
import { summarizeErrorMessage } from '../../components/ErrorDetails';
import type { PiFilmState } from '../../shared/creative-animation/pi-film';
import type { PiLiveActivity } from '../../shared/creative-animation/pi-activity';

export const voxProductionNodeLabels: Record<VoxProductionNode['kind'], string> = { 'agent-segment': '创作影片片段', 'audio-master': '合成全片音频', 'film-plan-materials': '规划影片素材清单', 'film-plan-scene': '分段导演规划', 'film-plan-finalize': '校验并汇总导演方案', 'film-edit': '分批创作影片画面', 'film-materials': '检查素材与出处', 'film-material': '准备影片素材', 'film-scene': '创作连续场景', 'film-director': '编排整片调度', 'film-sample': '样片浏览器检查', 'film-sample-repair': '按文件修复样片', 'film-sample-finalize': '复查样片', 'film-code': '创作原生全片代码', 'film-review': '原生全片抽帧检查', 'film-repair': '按需修复影片代码', 'film-finalize': '原生复查，失败则停止', plan: '完整导演与画面规划', image: '素材生成或导入', cutout: '主体去底', voice: '生成配音', timing: '旁白校准与自动拆镜', animation: '装配动画', code: '按风格创作代码', 'code-review': '编译与抽帧检查', 'code-repair': '按需修复一次', 'code-finalize': '复查或回退模板', compile: '编译检查', render: '渲染成片', verify: '媒体检查' };
const statuses = { pending: '等待', running: '执行中', completed: '已完成', failed: '失败', unknown: '云端结果待核对' };
export type VoxProductionPiEvidence = Pick<PiFilmState['evidence'] & object, 'technicalPassed' | 'readingPassed' | 'audioPassed' | 'creditsPassed' | 'contactSheetPasses' | 'visuallyReviewed' | 'humanReviewed'>;
export function VoxProductionProgress({ run, shots = [], upstreamFilm, agentActivity, piActivity, piEvidence, busy, onClose, onControl, resumeBudget }: {
  shots?: readonly EditorialCollageShot[];
  /** Lemo v4 host evidence for this run only; callers must not pass another run's evidence. */
  piEvidence?: VoxProductionPiEvidence;
  /** Lemo v3 film state (turn and provider-reported usage) for the "第 N / M 轮" budget line. */
  upstreamFilm?: Pick<LemoUpstreamFilm, 'runId' | 'turn' | 'status' | 'usage'> & Partial<Pick<LemoUpstreamFilm, 'cost'>>;
  /** Lemo v3 per-turn summaries (read-only journal view) shown on each Agent turn row. */
  agentActivity?: LemoAgentActivity | null;
  /** V4 process-local counters and current tool, scoped to this project/run. */
  piActivity?: PiLiveActivity | null;
  run: VoxProductionRun; busy: boolean; onClose(): void;
  onControl(action: VoxProductionControl['action'], extra?: Pick<VoxProductionControl, 'nodeId' | 'evidence' | 'budget'>): Promise<void>;
  resumeBudget?: VoxProductionControl['budget'];
}) {
  const [evidence, setEvidence] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [watched, setWatched] = useState(false);
  const [selected, setSelected] = useState('');
  const unknown = run.nodes.filter(n => voxProductionNodeStatus(n) === 'unknown');
  const target = unknown.find(n => n.id === selected) ?? unknown[0];
  const imageUnknown = !!target && isLemoImageUnknownNode(run, target);
  const piUnknown = run.authoringVersion === 4 && target?.kind === 'agent-segment';
  const agentBudget = run.authoringVersion === 3 ? lemoAgentProgressText(upstreamFilm?.runId === run.id ? upstreamFilm : undefined, run.settings) : '';
  const steps = voxProductionStepCount(run, upstreamFilm);
  const turnSummaries = new Map((agentActivity?.runId === run.id ? agentActivity.turns : []).map(turn => [String(turn.index), turn]));
  const piSegments = run.authoringVersion === 4 ? run.nodes.filter(node => node.id.startsWith('pi-segment:')) : [];
  const activePiSegment = piSegments.find(node => node.status === 'running' || node.status === 'unknown' || node.status === 'failed')
    ?? piSegments.find(node => node.status === 'pending') ?? [...piSegments].reverse().find(node => node.status === 'completed');
  const nodeList = useRef<HTMLOListElement>(null);
  const focusNode = run.nodes.find(n => n.status === 'running') ?? unknown[0] ?? run.nodes.find(n => n.status === 'failed');
  useEffect(() => {
    if (!focusNode) return;
    const frame = requestAnimationFrame(() => nodeList.current?.querySelector('[data-node-id="' + CSS.escape(focusNode.id) + '"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [focusNode?.id, focusNode?.status]);
  const resumable = ['failed', 'paused'].includes(run.status) && !unknown.length;
  return <Dialog open title="自动制作进度" onOpenChange={open => { if (!open) onClose(); }} actions={<>
    <Button onClick={onClose}>关闭</Button>
    {target && !piUnknown && ['failed', 'paused'].includes(run.status) ? <Button variant="primary" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void onControl('retry-unknown', { nodeId: target.id })}>直接重试此步骤</Button> : null}
    {target && imageUnknown && ['failed', 'paused'].includes(run.status) ? <Button disabled={busy} onClick={() => void onControl('skip-unknown-image', { nodeId: target.id })}>跳过这张插画</Button> : null}
    {resumable ? <Button variant="primary" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void onControl('resume', { budget: resumeBudget })}>{run.status === 'failed' ? '重试失败步骤' : '继续自动制作'}</Button> : null}
  </>}>
    <div className="vox-production-progress">
      <p role="status">{steps.completed}/{voxProductionStepTotalLabel(steps)} 步完成 · {run.message ? run.status === 'failed' ? summarizeErrorMessage(run.message) : run.message : run.status === 'running' ? '可离开页面，应用保持打开时会继续执行。' : '运行记录和已完成素材已保存。'}</p>
      {run.authoringVersion === 3 ? <p>原生多文件 Agent：逐轮读库、编写工程、实帧检查；字幕和配音由本机合成。技术检查通过不等于审美验收。{steps.max ? ` Agent 每完成一轮、尚未提交审片时会追加下一轮，所以总步数会增长，最多 ${steps.max} 步（轮数上限 ${lemoAgentMaxTurns(run.settings.agentMaxTurns)}）。` : ''}</p> : null}
      {agentBudget ? <p role="status" data-agent-budget>{agentBudget}</p> : null}
      {run.authoringVersion === 4 ? <>
        <p role="status" data-pi-segment-progress>运行段 {activePiSegment ? activePiSegment.id.slice('pi-segment:'.length) : piSegments.length || 1} / {piSegments.length || 1} · 按旁白文本窗口提交模型上下文；这不是独立秒数章节，最终剪辑与音频时钟由宿主统一合成。</p>
        {piActivity?.runId === run.id ? <p role="status" data-pi-live-activity>{piActivity.modelRequests} 次模型请求开始（SDK事件）{piActivity.maxRequests ? ` / 上限 ${piActivity.maxRequests}` : ''}{piActivity.maxTokens ? ` · 累计 Token 上限 ${piActivity.maxTokens.toLocaleString()}` : ''}{piActivity.received ? ` · 已收到 ${piActivity.received} 次` : ''}{piActivity.inputTokens || piActivity.outputTokens ? ` · 输入 ${piActivity.inputTokens.toLocaleString()} / 输出 ${piActivity.outputTokens.toLocaleString()} tokens` : ' · 实际用量在本段结束后汇总'}{piActivity.latestTool ? ` · 正在${piActivity.latestTool}` : ''}{piActivity.error ? ` · ${summarizeErrorMessage(piActivity.error)}` : ''}</p> : null}
      </> : null}
      {run.authoringVersion === 4 && piEvidence ? <section data-pi-evidence aria-label="宿主检查证据">
        <ul>
          <li>技术检查：{piEvidence.technicalPassed ? '通过' : '未通过'}</li>
          <li>阅读时长：{piEvidence.readingPassed ? '通过' : '未通过'}</li>
          <li>音频：{piEvidence.audioPassed ? '通过' : '未通过'}</li>
          <li>素材署名：{piEvidence.creditsPassed ? '通过' : '未通过'}</li>
          <li>抽帧审片：{piEvidence.contactSheetPasses} 轮 · {piEvidence.visuallyReviewed ? '模型已看到画面' : '模型未看到画面，仅做了技术检查'}</li>
          <li>人工验收：{piEvidence.humanReviewed ? '已确认' : '待你确认'}</li>
        </ul>
        <p>宿主检查通过不等于审美验收，请自行观看预览后再确认。</p>
        {!piEvidence.humanReviewed ? <>
          <CheckboxField label="我已完整观看预览的画面与声音" checked={watched} disabled={busy || run.status === 'running'} onChange={(_, e) => setWatched(e.checked === true)} />
          <Button disabled={busy || run.status === 'running' || !watched} onClick={async () => { await onControl('confirm-human-review'); setWatched(false); }}>记录我已观看并认可</Button>
        </> : null}
      </section> : null}
      {run.authoringVersion !== 3 && shots.length ? <details className="vox-settings-disclosure" open><summary>镜头采用的风格</summary><ol>{shots.map(shot => <li key={shot.id}>{creativeStyleStatus(shot.animation, run.settings)}{shot.animation?.authoring?.status === 'fallback' && shot.animation.creativeStyle?.source !== 'local' ? <span role="status"> · AI 检查未通过，已采用所选风格的本地保底。<details><summary>检查原因</summary>{summarizeErrorMessage(shot.animation.authoring.error ?? '检查未通过')}</details></span> : null}</li>)}</ol></details> : null}
      <ol ref={nodeList} className="vox-production-node-list">{run.nodes.map(n => <li key={n.id} data-node-id={n.id} data-status={voxProductionNodeStatus(n)}>
        <strong>{run.authoringVersion === 3 && n.kind === 'film-edit' ? '原生 Agent · 第 ' + n.fileId + ' 轮' : run.authoringVersion === 4 && n.id.startsWith('pi-segment:') ? '运行段 ' + n.id.slice('pi-segment:'.length) + '（按旁白文本窗口）' : voxProductionNodeLabels[n.kind]}{n.editRound ? ' · 第 ' + n.editRound + ' 批' : ''}{!(run.authoringVersion === 3 && n.kind === 'film-edit') && (n.fileId || n.materialId || n.shotId) ? ` · ${n.fileId || n.materialId || n.shotId}` : ''}</strong><span>{statuses[voxProductionNodeStatus(n)]}</span>
        {n.requestId ? <small>请求 {n.requestId} · 第 {n.attempt} 次</small> : null}
        {run.authoringVersion === 3 && n.kind === 'film-edit' && n.fileId && turnSummaries.has(n.fileId) ? (() => { const turn = turnSummaries.get(n.fileId)!; return <small data-agent-turn={turn.tool}>{turn.ok ? '' : '未执行 · '}{lemoAgentToolLabel(turn.tool)}{turn.target ? ` ${turn.target}` : ''}{turn.detail ? ` · ${turn.detail}` : ''}</small>; })() : null}
        {n.error ? <><p role="alert">{summarizeErrorMessage(n.error)}</p>{n.kind === 'image' && /^Image provider (?:API error|edit API error|async submit error) \((?:400|401|402|403|404|405|413|415|422)\):/u.test(n.error) ? <p>图片服务拒绝了本次请求。请先检查错误详情和模型配置；可关闭此窗口，在“更多 → 制作设置”关闭自动生成图片，或更换服务后重新开始制作。</p> : null}<details><summary>错误详情</summary><p>{n.error}</p></details></> : null}
        {n.recoveryNote ? <small>核对记录：{n.recoveryNote}</small> : null}
        {voxProductionNodeStatus(n) === 'unknown' ? <Button variant="subtle" disabled={busy} onClick={() => { setSelected(n.id); setEvidence(''); setAcknowledged(false); }}>核对此步骤</Button> : null}
      </li>)}</ol>
      {target ? <section className="vox-production-recovery">
        <h3>请求结果不确定：{voxProductionNodeLabels[target.kind]}</h3>
        {piUnknown ? <>
          <p role="alert">此片段包含多次模型请求，当前账本状态尚未核实。系统不会重试或解锁片段，以免重复计费或丢失已完成内容。</p>
          <p>先尝试恢复本机已保存的回执；若仍待核对，请在服务商侧逐条核实账本，并通过制作记录导入完整核对结果。</p>
        </> : imageUnknown ? <>
          <p role="alert">Agent 申请的插画已经发给生图服务商，但没有收到结果：这张图可能已经生成并计费。系统不会自动重新提交。</p>
          <p>请先到生图服务商后台核对这次请求。查到图片时，可在“其他恢复选项”中恢复已保存结果；确认没有结果后，可选择“直接重试此步骤”（会重新生成，可能再次计费），或“跳过这张插画”（不再提交，Agent 改用代码绘制或现有素材继续）。</p>
        </> : <p role="alert">直接重试会重新提交此步骤。如果原请求仍在服务商处理中，可能重复计费。</p>}
        <details>
          <summary>其他恢复选项</summary>
          <p>尝试恢复本机已保存的回执，不会重新提交生成。找不到回执不代表服务商没有结果；也可以核对服务商记录后解锁此步骤。</p>
          <Button disabled={busy || run.status === 'running'} onClick={() => void onControl('reconcile')}>恢复已保存结果</Button>
          {!piUnknown ? <>
            <TextAreaField label="服务商核对依据" value={evidence} disabled={busy} hint="记录核对时间、服务商记录或客服确认。仅在确认没有生成结果后解锁。" onChange={(_, e) => setEvidence(e.value)} />
            <CheckboxField label="已确认没有结果；继续制作可能再次计费" checked={acknowledged} disabled={busy} onChange={(_, e) => setAcknowledged(e.checked === true)} />
            <Button disabled={busy || !acknowledged || evidence.trim().length < 8} onClick={async () => { await onControl('confirm-no-result', { nodeId: target.id, evidence: evidence.trim() }); setEvidence(''); setAcknowledged(false); }}>记录核对并解锁此步骤</Button>
          </> : null}
          <p>解锁后保持暂停，点击底栏“继续自动制作”才会提交。</p>
        </details>
      </section> : null}
    </div>
  </Dialog>;
}
