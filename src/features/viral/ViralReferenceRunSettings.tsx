import { useEffect, useState } from 'react';
import { Button, CheckboxField, SelectField, TextField } from '../../ui';
import type { ViralAnalysisSettings } from '../../shared/types';

export type ReferenceRunConfiguration = {
  analysisId: string;
  maxAnalysisRequests: number;
  referenceVisualInput: 'frames' | 'video';
  referenceAudioInput: boolean;
  retryReviewedRequests: boolean;
};

export function ReferenceCapabilityFields({ visualInput, audioInput, onVisualChange, onAudioChange, disabled = false }: {
  visualInput: 'frames' | 'video'; audioInput: boolean;
  onVisualChange: (value: 'frames' | 'video') => void; onAudioChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <div className="viral-reference-capabilities">
    <SelectField label="画面分析输入" value={visualInput} disabled={disabled} onChange={(event) => onVisualChange(event.target.value as 'frames' | 'video')} options={[
      { value: 'frames', label: '有序画面帧' }, { value: 'video', label: '连续视频片段' },
    ]} hint={visualInput === 'video' ? '当前视觉服务必须支持 video_url 视频输入；启用后才提交连续视频片段。' : '适用于支持多图的视觉服务。仅凭抽帧无法确定全部连续动作和转场细节。'} />
    <CheckboxField label="同时分析配乐与音效" checked={audioInput} disabled={disabled} onChange={(_, data) => onAudioChange(data.checked === true)} />
    <p className="muted-text">声音分析需当前视觉服务支持 input_audio 音频输入；未启用时，对应声音维度保留待分析状态。语音转写独立处理。</p>
  </div>;
}

export function ViralReferenceRunSettings({ analysisId, settings, busy, onConfigure }: {
  analysisId: string; settings: ViralAnalysisSettings; busy: boolean;
  onConfigure: (input: ReferenceRunConfiguration) => Promise<void>;
}) {
  const [maxRequests, setMaxRequests] = useState(settings.maxAnalysisRequests ?? 64);
  const [visualInput, setVisualInput] = useState<'frames' | 'video'>(settings.referenceVisualInput ?? 'frames');
  const [audioInput, setAudioInput] = useState(settings.referenceAudioInput ?? false);
  const [reviewedCharges, setReviewedCharges] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const currentBudget = settings.maxAnalysisRequests ?? 64;
  const budgetInvalid = maxRequests < currentBudget || maxRequests > 10000;

  useEffect(() => {
    if (dirty) return;
    setMaxRequests(settings.maxAnalysisRequests ?? 64);
    setVisualInput(settings.referenceVisualInput ?? 'frames');
    setAudioInput(settings.referenceAudioInput ?? false);
  }, [dirty, settings.maxAnalysisRequests, settings.referenceVisualInput, settings.referenceAudioInput]);

  async function configure(retryReviewedRequests: boolean) {
    if (busy || budgetInvalid || (retryReviewedRequests && !reviewedCharges)) return;
    setNotice(''); setError('');
    try {
      await onConfigure({ analysisId, maxAnalysisRequests: maxRequests, referenceVisualInput: visualInput, referenceAudioInput: audioInput, retryReviewedRequests });
      setDirty(false); setReviewedCharges(false);
      setNotice(retryReviewedRequests ? '已允许重新提交核对过的失败或未知请求。点击“继续”运行；新提交可能再次计费。' : '运行设置已保存。点击“继续”处理剩余区间，累计调用次数不会清零。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <section className="viral-reference-recovery" aria-label="整体拆解恢复设置">
    <div className="viral-reference-recovery-heading"><h4>调整后继续分析</h4><span>当前累计调用上限：{currentBudget}</span></div>
    <p>已保存的区间结果继续保留。可提高累计调用上限，或启用当前服务支持的输入能力。保存设置不会开始分析。</p>
    <div className="viral-reference-recovery-grid">
      <TextField label="新的累计调用上限" type="number" min={currentBudget} max={10000} step={1} value={String(maxRequests)} disabled={busy} onChange={(event) => { setMaxRequests(Math.round(Number(event.target.value) || currentBudget)); setDirty(true); }} validationMessage={budgetInvalid ? `请输入 ${currentBudget}–10000 之间的整数。` : undefined} hint="本次运行已使用的调用计数保留；服务实际费用以账单为准。" />
      <ReferenceCapabilityFields visualInput={visualInput} audioInput={audioInput} disabled={busy} onVisualChange={(value) => { setVisualInput(value); setDirty(true); }} onAudioChange={(value) => { setAudioInput(value); setDirty(true); }} />
    </div>
    <Button density="compact" disabled={busy || budgetInvalid} onClick={() => void configure(false)}>保存预算与能力设置</Button>
    <details className="viral-reference-request-recovery">
      <summary>处理失败或结果未知的模型请求</summary>
      <p>默认不会自动重新发送这类请求。请先查看服务账单和任务记录，确认是否已有结果或已扣费。许可重发后，服务可能再次计费。</p>
      <CheckboxField checked={reviewedCharges} disabled={busy} label="我已核对账单与任务结果，并接受重新提交可能重复计费" onChange={(_, data) => setReviewedCharges(data.checked === true)} />
      <Button density="compact" disabled={busy || budgetInvalid || !reviewedCharges} onClick={() => void configure(true)}>允许重新提交已核对的请求</Button>
    </details>
    {notice ? <p className="viral-reference-notice" role="status">{notice}</p> : null}
    {error ? <p className="viral-reference-error" role="alert">{error} 你的设置仍保留，可以修正后重试。</p> : null}
  </section>;
}
