import { useState } from 'react';
import { Button, CheckboxField, Dialog, TextAreaField } from '../../ui';
import type { VoxProductionControl, VoxProductionNode, VoxProductionRun } from '../../shared/vox-production';

export const voxProductionNodeLabels: Record<VoxProductionNode['kind'], string> = { plan: '规划画面', image: '素材生成或导入', cutout: '主体去底', voice: '生成配音', timing: '字幕排时', animation: '装配动画', code: '按风格创作代码', 'code-review': '编译与抽帧检查', 'code-repair': '按需修复一次', 'code-finalize': '复查或回退模板', compile: '编译检查', render: '渲染成片', verify: '媒体检查' };
const statuses = { pending: '等待', running: '执行中', completed: '已完成', failed: '失败', unknown: '云端结果待核对' };
export function VoxProductionProgress({ run, busy, onClose, onControl }: {
  run: VoxProductionRun; busy: boolean; onClose(): void;
  onControl(action: VoxProductionControl['action'], extra?: Pick<VoxProductionControl, 'nodeId' | 'evidence'>): Promise<void>;
}) {
  const [evidence, setEvidence] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [selected, setSelected] = useState('');
  const unknown = run.nodes.filter(n => n.status === 'unknown');
  const target = unknown.find(n => n.id === selected) ?? unknown[0];
  return <Dialog open title="自动制作进度" onOpenChange={open => { if (!open) onClose(); }} actions={<Button onClick={onClose}>关闭</Button>}>
    <div className="vox-production-progress">
      <p role="status">{run.nodes.filter(n => n.status === 'completed').length}/{run.nodes.length} 步完成 · {run.message || (run.status === 'running' ? '可离开页面，应用保持打开时会继续执行。' : '运行记录和已完成素材已保存。')}</p>
      <ol className="vox-production-node-list">{run.nodes.map(n => <li key={n.id} data-status={n.status}>
        <strong>{voxProductionNodeLabels[n.kind]}{n.shotId ? ` · ${n.shotId}` : ''}</strong><span>{statuses[n.status]}</span>
        {n.requestId ? <small>请求 {n.requestId} · 第 {n.attempt} 次</small> : null}
        {n.error ? <p role="alert">{n.error}</p> : null}
        {n.recoveryNote ? <small>核对记录：{n.recoveryNote}</small> : null}
        {n.status === 'unknown' ? <Button variant="subtle" disabled={busy} onClick={() => { setSelected(n.id); setEvidence(''); setAcknowledged(false); }}>核对此步骤</Button> : null}
      </li>)}</ol>
      {target ? <section className="vox-production-recovery">
        <h3>核对：{voxProductionNodeLabels[target.kind]}</h3>
        <p>只恢复本机已有回执对应的结果（下载图片或查询已提交的远端任务），不会重新提交生成。找不到回执不代表服务商没有结果；请用请求编号、模型和时间核对服务商记录。</p>
        <Button disabled={busy || run.status === 'running'} onClick={() => void onControl('reconcile')}>恢复已保存结果</Button>
        <TextAreaField label="服务商核对依据" value={evidence} disabled={busy} hint="记录核对时间、服务商记录或客服确认。仅在确认没有生成结果后解锁。" onChange={(_, e) => setEvidence(e.value)} />
        <CheckboxField label="已确认没有结果；继续制作可能再次计费" checked={acknowledged} disabled={busy} onChange={(_, e) => setAcknowledged(e.checked === true)} />
        <Button disabled={busy || !acknowledged || evidence.trim().length < 8} onClick={async () => { await onControl('confirm-no-result', { nodeId: target.id, evidence: evidence.trim() }); setEvidence(''); setAcknowledged(false); }}>记录核对并解锁此步骤</Button>
        <p>解锁后保持暂停，点击底栏“继续自动制作”才会提交。</p>
      </section> : null}
    </div>
  </Dialog>;
}
