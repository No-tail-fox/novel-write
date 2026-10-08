import { CheckCircle2, CircleAlert, Clock3, Images, Settings2, Video } from 'lucide-react';
import type { DirectorProviderOption, DirectorShot, DirectorVideoJobStatus } from '../director-desk/DirectorDeskWorkspace';
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
