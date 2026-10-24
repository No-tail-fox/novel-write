import { CheckCircle2, CircleAlert, Clock3, Images, Settings2, Video } from 'lucide-react';
import type { DirectorProviderOption, DirectorShot, DirectorVideoJobStatus } from '../director-desk/DirectorDeskWorkspace';
import type { MotionComicVideoProduction } from '../../shared/motion-comic';
import type { MotionComicProductionUnit } from '../../shared/motion-comic-production';
import { Button, SegmentedControl, SelectField } from '../../ui';

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
  onStrategyChange,
  onProviderChange,
  onConfigureProvider,
  production, submittedReferences=[], referenceError, dialogue=[], referenceAudioOptions=[], units=[], unitError, onProductionChange, onSplitUnits,
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
  onStrategyChange: (strategy: 'deterministic-layers' | 'living-poster') => void;
  onProviderChange?: (providerId: string) => void | Promise<void>;
  onConfigureProvider?: () => void;
  production?: MotionComicVideoProduction;
  submittedReferences?: Array<{assetVersionId:string;kind:string;description:string}>;
  referenceError?:string;
  dialogue?:Array<{id:string;text:string;speaker:string;role:string;startMs:number;endMs:number}>;
  referenceAudioOptions?:Array<{value:string;label:string}>;
  units?:MotionComicProductionUnit[];
  unitError?:string;
  onProductionChange?:(patch:Partial<MotionComicVideoProduction>)=>void;
  onSplitUnits?:()=>void;
}) {
  const remoteVideo = remoteOnly || shot.renderStrategy === 'living-poster';
  const status = shot.videoUrl ? 'completed' : shot.videoJobStatus ?? 'idle';
  const failed = status === 'failed' || status === 'cancelled';
  const running = status === 'queued' || status === 'running';
  const ready = connected && Boolean(shot.videoInputReady);
  return <section className="motion-comic-video-readiness" aria-label="镜头制作方式与准备度">
    <div className="motion-comic-video-readiness__heading">
      {remoteVideo ? <Video size={15} /> : <Images size={15} />}
      <span><strong>镜头制作方式</strong><small>{remoteVideo ? '远程视频 API' : '本地图片运镜'}</small></span>
    </div>
    <SegmentedControl
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
    />
    {remoteVideo && providerOptions.length > 0 ? <SelectField
      label="视频生成服务"
      value={providerId ?? ''}
      options={providerOptions}
      disabled={busy || !onProviderChange}
      onChange={(event) => void onProviderChange?.(event.target.value)}
    /> : null}
    {remoteVideo && production ? <>
      <SelectField label="参考输入方式" value={production.referenceMode} disabled={busy} options={[{value:'frames',label:'首帧 / 首尾帧 · 严格约束'},{value:'references',label:'角色、场景、道具 · 多参考'}]} onChange={event=>onProductionChange?.({referenceMode:event.target.value as MotionComicVideoProduction['referenceMode'],...(event.target.value==='frames'?{audioMode:'post-mix',referenceAudioAssetVersionIds:[]}: {})})}/>
      <p>{production.referenceMode==='references'?'开场与结尾作为软参考；下列固定版本将按顺序提交。':'首尾帧模式通过关键帧承载角色与场景；固定参考图不会额外提交。'}</p>
      {submittedReferences.length ? <ol aria-label="实际提交参考列表">{submittedReferences.map((ref,index)=><li key={`${index}-${ref.assetVersionId}`}><strong>{ref.description}</strong><small>版本 {ref.assetVersionId}</small></li>)}</ol>:null}
      {referenceError?<p role="alert">{referenceError}</p>:null}
      <SelectField label="声音制作" value={production.audioMode} disabled={busy} options={[{value:'post-mix',label:'静音画面 + 独立配音混音'},{value:'native',label:'原生音画 · 模型生成声音'},{value:'audio-driven',label:'参考音频驱动 · 需样片核验'}]} onChange={event=>onProductionChange?.({audioMode:event.target.value as MotionComicVideoProduction['audioMode'],...(event.target.value==='audio-driven'?{}:{referenceAudioAssetVersionIds:[]})})}/>
      {production.audioMode==='audio-driven'?<SelectField label="完整对白参考音频" value={production.referenceAudioAssetVersionIds?.[0]??''} disabled={busy} options={[{value:'',label:'选择已经生成或导入的完整对白'},...referenceAudioOptions]} onChange={event=>onProductionChange?.({referenceAudioAssetVersionIds:event.target.value?[event.target.value]:[]})}/>:null}
      <p>{production.audioMode==='post-mix'?'使用独立角色音色；当前模式不承诺口型同步。':'原生声音会保留到预览与导出。台词、音色与口型需观看实际模型样片核验。'}</p>
      {dialogue.length?<details><summary>完整对白 · {dialogue.length} 条</summary>{dialogue.map(cue=><p key={cue.id}><strong>{cue.role==='narrative'?'VO':cue.role==='monologue'?'OS':cue.speaker}</strong> · {(cue.startMs/1000).toFixed(1)}–{(cue.endMs/1000).toFixed(1)} 秒<br/>{cue.text}</p>)}</details>:null}
      <div aria-label="制作单元"><strong>制作单元</strong>{units.map(unit=><p key={unit.index}>{unit.index}. {(unit.startMs/1000).toFixed(1)}–{(unit.endMs/1000).toFixed(1)} 秒 · 生成 {unit.generationDurationSec} 秒 · {unit.cueIds.length} 条完整对白</p>)}{unitError?<p role="alert">{unitError}</p>:null}{onSplitUnits?<><p>按对白边界拆分后，中间单元需要补关键帧并确认前后状态；音频驱动需为各单元重新选择对应对白音频。</p><Button disabled={busy} onClick={onSplitUnits}>按模型时长拆分制作单元</Button></>:null}</div>
    </>:null}
    {remoteVideo ? <div className="motion-comic-video-readiness__checks">
      <span data-state={shot.videoInputReady ? 'ready' : 'blocked'}>{shot.videoInputReady ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}<span><strong>关键帧</strong><small>{shot.videoInputReady ? '已就绪' : shot.videoInputUnavailableReason ?? '需要先生成关键帧'}</small></span></span>
      <span data-state={connected ? 'ready' : 'blocked'}>{connected ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}<span><strong>远程服务</strong><small>{connected ? `${providerLabel} · ${providerModel}` : '尚未连接'}</small></span></span>
      <span data-state={failed ? 'blocked' : status === 'completed' ? 'ready' : 'pending'}>{failed ? <CircleAlert size={14} /> : status === 'completed' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}<span><strong>任务状态</strong><small>{videoStatusLabel(status)}</small></span></span>
    </div> : null}
    {remoteVideo && shot.videoEstimatedCost !== undefined ? <p className="motion-comic-video-readiness__cost">本镜头预计费用 <strong>¥ {shot.videoEstimatedCost.toFixed(2)}</strong>，以接口账单为准。</p> : null}
    {remoteVideo && !ready && unavailableReason ? <div className="motion-comic-video-readiness__notice" role="alert"><CircleAlert size={14} /><span>{unavailableReason}</span>{onConfigureProvider ? <Button type="button" density="compact" variant="secondary" icon={<Settings2 size={13} />} onClick={onConfigureProvider}>配置视频服务</Button> : null}</div> : null}
    {remoteVideo && failed && shot.videoJobError ? <div className="motion-comic-video-readiness__notice" role="alert"><CircleAlert size={14} /><span>{shot.videoJobError}</span></div> : null}
    {remoteVideo && running ? <p className="motion-comic-video-readiness__running" role="status">远程任务正在处理；完成后会核对当前镜头输入，已变化的结果会保留在历史版本。</p> : null}
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
