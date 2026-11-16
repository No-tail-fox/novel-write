import { useState } from 'react';
import { CheckCircle2, CircleAlert, Clipboard, Clock3, Images, Settings2, Video } from 'lucide-react';
import { buildVideoFailureDiagnostics, motionComicVideoErrorMessage, videoFailureHint } from './motion-comic-video-failure';
import type { DirectorProviderOption, DirectorShot, DirectorVideoJobStatus } from '../director-desk/DirectorDeskWorkspace';
import type { VideoCapability } from '../../shared/types';
import type { MotionComicVideoProduction } from '../../shared/motion-comic';
import type { MotionComicProductionUnit } from '../../shared/motion-comic-production';
import { Button, CheckboxField, Dialog, SegmentedControl, SelectField, TextField } from '../../ui';
import { motionComicVideoRecoveryInputSchema } from '../../shared/motion-comic-video-recovery';

export function MotionComicVideoReadiness({
  shot,
  connected,
  providerLabel,
  providerModel,
  providerId,
  providerOptions,
  unavailableReason,
  busy,
  remoteOnly = false,
  compact = false,
  outputRatio,
  onStrategyChange,
  onProviderChange,
  onConfigureProvider,
  onResumeVideo,
  onRecoverSubmission,
  providerCapabilities = [], keyframeAsReference = false, production, submittedReferences=[], onInsertReference, referenceError, dialogue=[], referenceAudioOptions=[], units=[], unitError, onProductionChange, onSplitUnits,
}: {
  shot: DirectorShot;
  connected: boolean;
  providerLabel: string;
  providerModel: string;
  providerId?: string;
  providerOptions: readonly DirectorProviderOption[];
  unavailableReason?: string;
  busy: boolean;
  remoteOnly?: boolean;
  /** Dense layout for the make workspace: no status hero, settings always open. */
  compact?: boolean;
  /** Actual project ratio submitted by the motion-comic video request. */
  outputRatio?: string;
  onStrategyChange: (strategy: 'deterministic-layers' | 'living-poster') => void;
  onProviderChange?: (providerId: string) => void | Promise<void>;
  onConfigureProvider?: () => void;
  onResumeVideo?: () => Promise<unknown>;
  onRecoverSubmission?: (resolution: { action: 'attach-remote-task'; remoteTaskId: string } | { action: 'confirm-not-submitted'; confirmedNotSubmitted: true }) => Promise<unknown>;
  providerCapabilities?: readonly VideoCapability[];
  keyframeAsReference?: boolean;
  production?: MotionComicVideoProduction;
  submittedReferences?: Array<{assetVersionId:string;kind:string;description:string;token?:string}>;
  onInsertReference?: (token: string) => void;
  referenceError?:string;
  dialogue?:Array<{id:string;text:string;speaker:string;role:string;startMs:number;endMs:number}>;
  referenceAudioOptions?:Array<{value:string;label:string}>;
  units?:MotionComicProductionUnit[];
  unitError?:string;
  onProductionChange?:(patch:Partial<MotionComicVideoProduction>)=>void;
  onSplitUnits?:()=>void;
}) {
  const remoteVideo = remoteOnly || shot.renderStrategy === 'living-poster';
  const status = shot.videoJobStatus === 'running' || shot.videoJobStatus === 'queued' ? shot.videoJobStatus : shot.videoUrl ? 'completed' : shot.videoJobStatus ?? 'idle';
  const failed = status === 'failed' || status === 'cancelled';
  const running = status === 'queued' || status === 'running';
  const ready = connected && Boolean(shot.videoInputReady);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  async function copyDiagnostics() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(buildVideoFailureDiagnostics({ shotTitle: shot.title, jobId: shot.videoJobId, providerLabel, providerModel, status, error: shot.videoJobError }));
      setCopyState('done');
    } catch { setCopyState('error'); }
  }
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [remoteTaskId, setRemoteTaskId] = useState('');
  const [confirmedNotSubmitted, setConfirmedNotSubmitted] = useState(false);
  const remoteTaskIdIsValid = motionComicVideoRecoveryInputSchema.safeParse({ id: 'project', shotId: 'shot', jobId: 'job', expectedUpdatedAt: new Date().toISOString(), action: 'attach-remote-task', remoteTaskId: remoteTaskId.trim() }).success;
  async function resolveSubmission(action: 'attach-remote-task' | 'confirm-not-submitted') {
    if (!onRecoverSubmission || recovering || busy) return;
    setRecovering(true); setRecoveryError('');
    try {
      await onRecoverSubmission(action === 'attach-remote-task'
        ? { action, remoteTaskId: remoteTaskId.trim() }
        : { action, confirmedNotSubmitted: true });
      setReviewOpen(false); setRemoteTaskId(''); setConfirmedNotSubmitted(false);
    } catch (error) { setRecoveryError(motionComicVideoErrorMessage(error)); }
    finally { setRecovering(false); }
  }
  async function resumeVideo() {
    if (!onResumeVideo || recovering || busy) return;
    setRecovering(true); setRecoveryError('');
    try { await onResumeVideo(); }
    catch (error) { setRecoveryError(motionComicVideoErrorMessage(error)); }
    finally { setRecovering(false); }
  }
  const Settings = 'details';
  const audioFields = production ? <>
              <SelectField 
                label="声音制作" 
                value={production.audioMode} 
                disabled={busy} 
                options={[
                  {value:'post-mix', label:'静音 + 后期混音'},
                  {value:'native', label:'原生音画', disabled:!providerCapabilities.includes('synchronized-audio')},
                  {value:'audio-driven', label:'音频驱动', disabled:!providerCapabilities.includes('reference-audio')}
                ]} 
                onChange={event=>onProductionChange?.({
                  audioMode:event.target.value as MotionComicVideoProduction['audioMode'],
                  ...(event.target.value==='audio-driven'?{}:{referenceAudioAssetVersionIds:[]})
                })}
              />
              {production.audioMode==='audio-driven' ? <SelectField 
                label="参考音频" 
                value={production.referenceAudioAssetVersionIds?.[0]??''} 
                disabled={busy} 
                options={[{value:'',label:'选择对白音频'},...referenceAudioOptions]} 
                onChange={event=>onProductionChange?.({referenceAudioAssetVersionIds:event.target.value?[event.target.value]:[]})}
              /> : null}
  </> : null;
  return <section className="motion-comic-video-readiness" data-compact={compact || undefined} aria-label="视频制作">
    {/* Status Hero */}
    {compact ? null : <div className="motion-comic-video-readiness__hero" data-status={failed ? 'error' : status === 'completed' ? 'ready' : running ? 'running' : 'idle'}>
      <div className="motion-comic-video-readiness__hero-icon">
        {failed ? <CircleAlert size={20} /> : status === 'completed' ? <CheckCircle2 size={20} /> : running ? <Clock3 size={20} /> : <Video size={20} />}
      </div>
      <div className="motion-comic-video-readiness__hero-content">
        <h3>{shot.videoRecovery === 'unknown' ? '提交结果待核对' : videoStatusLabel(status)}</h3>
        {status === 'completed' && shot.videoUrl ? <p>视频已就绪 · {providerLabel}</p> : null}
        {running && shot.videoRecovery !== 'unknown' ? <p>远程任务处理中，完成后自动更新</p> : null}
        {!remoteVideo ? <p>本地图片运镜</p> : ready && !running && !shot.videoUrl ? <p>{production?.referenceMode === 'references' ? '参考资产已就绪' : '关键帧已就绪'}</p> : null}
      </div>
    </div>}
    
    {compact ? <p className="motion-comic-video-readiness__compact-summary" title={`${providerLabel} · ${providerModel}`}><span>{providerModel || providerLabel || '未配置视频模型'}</span><small>{outputRatio ?? '跟随项目'}</small></p> : null}
    {shot.videoRecovery === 'resume' && onResumeVideo ? <Button density="compact" disabled={busy || recovering} onClick={() => void resumeVideo()}>{recovering ? '正在查询原任务…' : '恢复查询原视频任务'}</Button> : null}
    {shot.videoRecovery === 'unknown' ? <div role="status"><p>视频提交结果待核对，尚未取得云端任务编号。</p>{shot.videoJobError ? <p>{motionComicVideoErrorMessage(shot.videoJobError)}</p> : null}{onRecoverSubmission && shot.videoJobError ? <Button density="compact" disabled={busy || recovering} onClick={() => setReviewOpen(true)}>核对服务商任务</Button> : <p>提交请求仍在处理中，请稍候。</p>}</div> : null}
    <Dialog open={reviewOpen} onOpenChange={setReviewOpen} title="核对视频提交结果" actions={<Button disabled={recovering} onClick={() => setReviewOpen(false)}>关闭</Button>}>
      <p>请在服务商后台按提交时间核对本次请求。已有任务可补录编号，随后查询原任务；只有服务商确认未受理时才解除阻塞。</p>
      <TextField label="云端任务编号" value={remoteTaskId} disabled={recovering} onChange={(_, data) => setRemoteTaskId(data.value)} />
      <Button disabled={recovering || !remoteTaskIdIsValid} onClick={() => void resolveSubmission('attach-remote-task')}>关联已有云端任务</Button>
      <CheckboxField label="我已在服务商后台确认这次请求未受理，没有待完成或已生成的任务" checked={confirmedNotSubmitted} disabled={recovering} onChange={(_, data) => setConfirmedNotSubmitted(Boolean(data.checked))} />
      <Button disabled={recovering || !confirmedNotSubmitted} onClick={() => void resolveSubmission('confirm-not-submitted')}>确认未受理并解除阻塞</Button>
      {recoveryError ? <p role="alert">{recoveryError}</p> : null}
    </Dialog>
    {recoveryError ? <p role="alert">{recoveryError}</p> : null}
    {/* Error or Warning Messages */}
    {remoteVideo && !connected && unavailableReason ? <div className="motion-comic-video-readiness__notice motion-comic-video-readiness__notice--warning" role="alert">
      <CircleAlert size={14} /><span>{unavailableReason}</span>
      {onConfigureProvider ? <Button type="button" density="compact" variant="secondary" icon={<Settings2 size={13} />} onClick={onConfigureProvider}>配置服务</Button> : null}
    </div> : null}
    {remoteVideo && failed && shot.videoJobError ? <div className="motion-comic-video-readiness__notice motion-comic-video-readiness__notice--error" role="alert">
      <CircleAlert size={14} /><span>{motionComicVideoErrorMessage(shot.videoJobError)}</span>
      <Button type="button" density="compact" variant="subtle" icon={<Clipboard size={13} />} onClick={() => void copyDiagnostics()}>{copyState === 'done' ? '已复制' : copyState === 'error' ? '复制失败' : '复制诊断信息'}</Button>
      {videoFailureHint(shot.videoJobError) ? <p className="motion-comic-video-readiness__hint">{videoFailureHint(shot.videoJobError)}</p> : null}
    </div> : null}
    {referenceError ? <div className="motion-comic-video-readiness__notice motion-comic-video-readiness__notice--error" role="alert">
      <CircleAlert size={14} /><span>{referenceError}</span>
    </div> : null}
    
    {unitError ? <p className="motion-comic-video-readiness__hint" role="alert">{unitError}</p> : null}
    {remoteOnly && shot.renderStrategy !== 'living-poster' ? <Button density="compact" disabled={busy} onClick={() => onStrategyChange('living-poster')}>启用远程视频制作</Button> : null}
    {/* Compact mode exposes ordinary fields without nested disclosures. */}
    <Settings className="motion-comic-video-readiness__settings" open={!compact && (!remoteVideo || !ready) || undefined}>
      <summary>{remoteVideo ? <Video size={14} /> : <Images size={14} />}{compact ? '生成设置' : '制作设置'}</summary>
      <div className="motion-comic-video-readiness__settings-body">
        {compact && remoteOnly ? null : <SegmentedControl
          className="motion-comic-video-readiness__mode"
          label="镜头制作方式"
          value={remoteVideo ? 'living-poster' : 'deterministic-layers'}
          options={remoteOnly
            ? [{ value: 'living-poster', label: '远程视频', icon: <Video size={13} />, disabled: true }]
            : [
                { value: 'deterministic-layers', label: '图片运镜', icon: <Images size={13} />, disabled: busy },
                { value: 'living-poster', label: '远程视频', icon: <Video size={13} />, disabled: busy },
              ]}
          onChange={onStrategyChange}
        />}
        
        {remoteVideo && onProviderChange && providerOptions.length > 0 ? <SelectField
          label="视频服务"
          value={providerId ?? ''}
          options={providerOptions}
          disabled={busy}
          onChange={(event) => void onProviderChange(event.target.value)}
        /> : null}
        {remoteVideo && !compact && !onProviderChange ? <p className="motion-comic-video-readiness__model">项目视频模型：{providerLabel}{providerModel ? ` · ${providerModel}` : ''}</p> : null}

        
        {remoteVideo && production ? <>
          <SelectField 
            label="参考输入方式" 
            value={production.referenceMode} 
            disabled={busy} 
            options={[
              {value:'references', label:'参考图直出视频（推荐）', disabled:!providerCapabilities.includes('reference-image')},
              {value:'frames', label:keyframeAsReference?'关键帧软约束':'首帧 / 首尾帧'}
            ]} 
            onChange={event=>onProductionChange?.({
              referenceMode:event.target.value as MotionComicVideoProduction['referenceMode'],
              ...(event.target.value==='frames'?{audioMode:'post-mix',referenceAudioAssetVersionIds:[]}:{})
            })}
          />
          
          <p className="motion-comic-video-readiness__hint">{production.referenceMode === 'references'
            ? '使用已确认的角色、场景和道具参考图；分镜图可选，无需逐镜生图。'
            : '需要首帧图片，尾帧可选；可在首尾帧区域上传或生成分镜图。'}</p>
          {production.referenceMode === 'references' && !providerCapabilities.includes('reference-image') ? <p className="motion-comic-video-readiness__hint" role="alert">当前模型不支持参考图直出视频，请更换支持参考图的模型，或切换首帧 / 首尾帧模式并提供首帧。</p> : null}
          {compact ? audioFields : null}
          {submittedReferences.length > 0 ? <details className="motion-comic-video-readiness__refs">
            <summary>参考图列表 · {submittedReferences.length} 项</summary>
            <ol>{submittedReferences.map((ref,index)=><li key={`${index}-${ref.assetVersionId}`}>
              <strong>{ref.description}</strong><small>参考 {index + 1}</small>
              {ref.token && onInsertReference ? <Button density="compact" variant="subtle" disabled={busy} onClick={() => onInsertReference(ref.token!)}>插入引用</Button> : null}
            </li>)}</ol>
          </details> : null}
          
          <details className="motion-comic-video-readiness__advanced">
            <summary>{compact ? '对白与分段详情' : '声音与分段'}</summary>
            <div className="motion-comic-video-readiness__advanced-body">
              {!compact ? audioFields : null}

              {dialogue.length > 0 ? <details><summary>完整对白 · {dialogue.length} 条</summary>
                {dialogue.map(cue=><p key={cue.id}>
                  <strong>{cue.role==='narrative'?'VO':cue.role==='monologue'?'OS':cue.speaker}</strong> · {(cue.startMs/1000).toFixed(1)}–{(cue.endMs/1000).toFixed(1)} 秒<br/>{cue.text}
                </p>)}
              </details> : null}
              
              {units.length > 0 ? <div className="motion-comic-video-readiness__units">
                <strong>制作单元 · {units.length} 段</strong>
                {units.map(unit=><p key={unit.index}>
                  {unit.index}. {(unit.startMs/1000).toFixed(1)}–{(unit.endMs/1000).toFixed(1)} 秒 · 生成 {unit.generationDurationSec} 秒 · {unit.cueIds.length} 条对白
                </p>)}
                {onSplitUnits ? <Button disabled={busy} onClick={onSplitUnits}>按模型时长拆分</Button> : null}
              </div> : null}
            </div>
          </details>
        </> : null}
      </div>
    </Settings>
    
    {remoteVideo ? <p className="motion-comic-video-readiness__cost">{shot.videoEstimatedCost !== undefined && shot.videoEstimatedCost > 0 ? <>预计费用 <strong>¥{shot.videoEstimatedCost.toFixed(2)}</strong></> : <>费用未知 · 以服务商实际账单为准</>}</p> : null}
  </section>;
}

function videoStatusLabel(status: DirectorVideoJobStatus): string {
  if (status === 'queued') return '等待远程服务处理';
  if (status === 'running') return '远程生成中';
  if (status === 'completed') return '视频已生成';
  if (status === 'failed') return '上次生成失败，可在下方重试';
  if (status === 'cancelled') return '任务未完成，可在下方重试';
  return '尚未提交';
}
