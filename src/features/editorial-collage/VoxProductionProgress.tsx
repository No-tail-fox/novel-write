import type { EditorialCollageShot } from '../../shared/editorial-collage';
import { creativeStyleStatus } from '../../shared/creative-animation/status';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, CheckboxField, Dialog, SelectField, TextAreaField } from '../../ui';
import { voxProductionNodeStatus, type VoxProductionControl, type VoxProductionNode, type VoxProductionRun } from '../../shared/vox-production';
import { summarizeErrorMessage } from '../../components/ErrorDetails';

export const voxProductionNodeLabels: Record<VoxProductionNode['kind'], string> = { 'film-plan-materials': '规划影片素材清单', 'film-plan-scene': '分段导演规划', 'film-plan-finalize': '校验并汇总导演方案', 'film-edit': '分批创作影片画面', 'film-materials': '检查素材与出处', 'film-material': '准备影片素材', 'film-scene': '创作连续场景', 'film-director': '编排整片调度', 'film-sample': '样片浏览器检查', 'film-sample-repair': '按文件修复样片', 'film-sample-finalize': '复查样片', 'film-code': '创作原生全片代码', 'film-review': '原生全片抽帧检查', 'film-repair': '按需修复影片代码', 'film-finalize': '原生复查，失败则停止', plan: '完整导演与画面规划', image: '素材生成或导入', cutout: '主体去底', voice: '生成配音', timing: '旁白校准与自动拆镜', animation: '装配动画', code: '按风格创作代码', 'code-review': '编译与抽帧检查', 'code-repair': '按需修复一次', 'code-finalize': '复查或回退模板', compile: '编译检查', render: '渲染成片', verify: '媒体检查' };
export function voxProductionNodeLabel(run: VoxProductionRun | undefined, node: VoxProductionNode) {
  if (run?.authoringVersion === 4 && node.kind === 'film-edit') {
    if (node.id === 'official-treatment') return '确认创意方案';
    if (node.id === 'official-style-frame') return '生成并审查风格帧';
    if (node.id === 'official-voice-lock') return '锁定旁白与时序';
    if (node.id.startsWith('official-repair:')) return '修复指定镜头';
  }
  if (run?.authoringVersion === 4 && node.kind === 'film-edit') return '创意动画 · 整片创作与审片';
  if (run?.authoringVersion === 4 && node.kind === 'film-finalize') return '校验官方工程与审片凭据';
  return voxProductionNodeLabels[node.kind];
}
const statuses = { pending: '等待', running: '执行中', completed: '已完成', failed: '失败', unknown: '云端结果待核对' };
export function VoxProductionProgress({ open = true, run, shots = [], busy, onClose, onControl }: {
  open?: boolean;
  shots?: readonly EditorialCollageShot[];
  run: VoxProductionRun; busy: boolean; onClose(): void;
  onControl(action: VoxProductionControl['action'], extra?: Pick<VoxProductionControl, 'nodeId' | 'evidence' | 'shotId' | 'instructions'>): Promise<void>;
}) {
  const [evidence, setEvidence] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [selected, setSelected] = useState('');
  const [repairShotId, setRepairShotId] = useState(shots[0]?.id ?? '');
  const [repairInstructions, setRepairInstructions] = useState('');
  const unknown = run.nodes.filter(n => voxProductionNodeStatus(n) === 'unknown');
  const target = unknown.find(n => n.id === selected) ?? unknown[0];
  const officialTarget = run.authoringVersion === 4 && target?.kind === 'film-edit';
  const nodeList = useRef<HTMLOListElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const control = (action: VoxProductionControl['action'], extra?: Pick<VoxProductionControl, 'nodeId' | 'evidence' | 'shotId' | 'instructions'>) => {
    // The action may disappear when the run resumes or a receipt is recovered.
    // Keep focus inside the open dialog so Escape and keyboard navigation work.
    closeButton.current?.focus({ preventScroll: true });
    return onControl(action, extra);
  };
  const focusNode = run.nodes.find(n => n.status === 'running') ?? unknown[0] ?? run.nodes.find(n => n.status === 'failed');
  useEffect(() => {
    if (!open || !focusNode) return;
    const frame = requestAnimationFrame(() => nodeList.current?.querySelector('[data-node-id="' + CSS.escape(focusNode.id) + '"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [open, focusNode?.id, focusNode?.status]);
  const resumable = ['failed', 'paused'].includes(run.status) && !unknown.length;
  const repairCount = run.nodes.filter(node => node.id.startsWith('official-repair:')).length;
  const repairLimit = run.settings.lemoBudget?.maxRepairRounds ?? 2;
  const repairable = run.authoringVersion === 4 && run.nodes.some(node => node.id === 'official-treatment')
    && run.status !== 'running' && !unknown.length
    && run.nodes.every(node => ['official-ready', 'render', 'verify'].includes(node.id) || node.status === 'completed');
  const selectedRepairShotId = shots.some(shot => shot.id === repairShotId) ? repairShotId : shots[0]?.id ?? '';
  return <Dialog open={open} title="自动制作进度" onOpenChange={open => { if (!open) onClose(); }} actions={<>
    <Button ref={closeButton} onClick={onClose}>关闭</Button>
    {target && ['failed', 'paused'].includes(run.status) ? <Button variant="primary" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void control('retry-unknown', { nodeId: target.id })}>{officialTarget ? '继续官方步骤' : '直接重试此步骤'}</Button> : null}
    {resumable ? <Button variant="primary" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void control('resume')}>{run.status === 'failed' ? '重试失败步骤' : '继续自动制作'}</Button> : null}
  </>}>
    <div className="vox-production-progress">
      <p role="status">{run.nodes.filter(n => n.status === 'completed').length}/{run.nodes.length} 步完成 · {run.message ? run.status === 'failed' ? summarizeErrorMessage(run.message) : run.message : run.status === 'running' ? '可离开页面，应用保持打开时会继续执行。' : '运行记录和已完成素材已保存。'}</p>
      {run.authoringVersion === 4 ? <p>官方 Lemo Agent SDK：读取风格资料、编写整片工程并检查实际画面；字幕和配音由本机合成。技术检查通过不等于审美验收。</p> : null}
      {run.authoringVersion === 4 && run.settings.lemoBudget ? <p>本次制作预算：最多 {run.settings.lemoBudget.maxRequests} 次请求 · 每阶段 {run.settings.lemoBudget.maxTurns} 轮 · {run.settings.lemoBudget.maxMinutes} 分钟（含暂停） · SDK 估算上限 {run.settings.lemoBudget.maxEstimatedCostUsd} 美元 · 已发起 {repairCount}/{repairLimit} 次镜头修复。继续制作沿用原预算。</p> : null}
      {run.authoringVersion !== 4 && shots.length ? <details className="vox-settings-disclosure" open><summary>镜头采用的风格</summary><ol>{shots.map(shot => <li key={shot.id}>{creativeStyleStatus(shot.animation, run.settings)}{shot.animation?.authoring?.status === 'fallback' && shot.animation.creativeStyle?.source !== 'local' ? <span role="status"> · AI 检查未通过，已采用所选风格的本地保底。<details><summary>检查原因</summary>{summarizeErrorMessage(shot.animation.authoring.error ?? '检查未通过')}</details></span> : null}</li>)}</ol></details> : null}
      <ol ref={nodeList} className="vox-production-node-list">{run.nodes.map(n => <li key={n.id} data-node-id={n.id} data-status={voxProductionNodeStatus(n)}>
        <strong>{voxProductionNodeLabel(run, n)}{n.editRound ? ' · 第 ' + n.editRound + ' 批' : ''}{!(run.authoringVersion === 4 && n.kind === 'film-edit') && (n.fileId || n.materialId || n.shotId) ? ` · ${n.fileId || n.materialId || n.shotId}` : ''}</strong><span>{statuses[voxProductionNodeStatus(n)]}</span>
        {n.requestId ? <small>请求 {n.requestId} · 第 {n.attempt} 次</small> : null}
        {n.error ? <><p role="alert">{summarizeErrorMessage(n.error)}</p><details><summary>错误详情</summary><p>{n.error}</p></details></> : null}
        {n.recoveryNote ? <small>核对记录：{n.recoveryNote}</small> : null}
        {voxProductionNodeStatus(n) === 'unknown' ? <Button variant="subtle" disabled={busy} onClick={() => { setSelected(n.id); setEvidence(''); setAcknowledged(false); }}>核对此步骤</Button> : null}
      </li>)}</ol>
      {repairable && shots.length ? <section className="vox-production-recovery">
        <h3>单镜头修复</h3>
        <p>只修改选中镜头，复用已有素材和旁白，检查其他镜头保持一致后重新导出成片。沿用本次制作的剩余请求、时间和费用预算；修复次数与自动复审共享额度。</p>
        <SelectField label="需要修复的镜头" value={selectedRepairShotId} disabled={busy || repairCount >= repairLimit}
          options={shots.map((shot, index) => ({ value: shot.id, label: '镜头 ' + (index + 1) + ' · ' + shot.id }))}
          onChange={(_, event) => setRepairShotId(event.value)} />
        <TextAreaField label="镜头修复要求" value={repairInstructions} disabled={busy || repairCount >= repairLimit}
          hint="描述需要改变的画面、运动或节奏（8–4000 个字符）。" onChange={(_, event) => setRepairInstructions(event.value)} />
        <Button disabled={busy || repairCount >= repairLimit || !selectedRepairShotId || repairInstructions.trim().length < 8 || repairInstructions.trim().length > 4000}
          onClick={() => void control('repair-shot', { shotId: selectedRepairShotId, instructions: repairInstructions.trim() })}>修复此镜头并导出成片</Button>
        {repairCount >= repairLimit ? <p role="status">已达到本次制作的镜头修复次数上限。</p> : null}
      </section> : null}
      {target ? <section className="vox-production-recovery">
        <h3>请求结果不确定：{officialTarget ? '创意动画 · 整片创作与审片' : target.kind === 'plan' && run.planningVersion === 1 ? '全局创意大纲' : voxProductionNodeLabels[target.kind]}</h3>
        <p role="alert">{officialTarget ? '继续时会沿用本次制作的官方会话，先核对已保存结果；尚未确认的请求会阻止继续，不会通过新建会话绕过。' : '直接重试会重新提交此步骤。如果原请求仍在服务商处理中，可能重复计费。'}</p>
        <details>
          <summary>其他恢复选项</summary>
          <p>{officialTarget ? '先尝试恢复本机已保存的官方工程与审片凭据。找不到回执不代表服务商没有结果；手工核对记录也不会清除官方会话的未决请求。' : '尝试恢复本机已保存的回执，不会重新提交生成。找不到回执不代表服务商没有结果；也可以核对服务商记录后解锁此步骤。'}</p>
          <Button disabled={busy || run.status === 'running'} onClick={() => void control('reconcile')}>恢复已保存结果</Button>
          <TextAreaField label="服务商核对依据" value={evidence} disabled={busy} hint={officialTarget ? '记录核对时间、服务商记录或客服确认；不会跳过官方会话的恢复检查。' : '记录核对时间、服务商记录或客服确认。仅在确认没有生成结果后解锁。'} onChange={(_, e) => setEvidence(e.value)} />
          <CheckboxField label={officialTarget ? '已确认没有结果，并理解仍须恢复原官方会话' : '已确认没有结果；继续制作可能再次计费'} checked={acknowledged} disabled={busy} onChange={(_, e) => setAcknowledged(e.checked === true)} />
          <Button disabled={busy || !acknowledged || evidence.trim().length < 8} onClick={async () => { await control('confirm-no-result', { nodeId: target.id, evidence: evidence.trim() }); setEvidence(''); setAcknowledged(false); }}>{officialTarget ? '记录核对依据' : '记录核对并解锁此步骤'}</Button>
          <p>{officialTarget ? '记录后保持暂停；继续制作仍须通过原官方会话的恢复检查。' : '解锁后保持暂停，点击底栏“继续自动制作”才会提交。'}</p>
        </details>
      </section> : null}
    </div>
  </Dialog>;
}
