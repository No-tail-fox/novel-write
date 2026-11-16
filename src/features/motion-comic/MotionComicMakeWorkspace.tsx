import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ImageOff, Plus, Trash2, Video } from 'lucide-react';
import type { DirectorAsset, DirectorShot } from '../director-desk/DirectorDeskWorkspace';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { Button, Dialog, IconButton, TextAreaField, TextField } from '../../ui';
import { storyboardDurationMs, storyboardImageStatus, storyboardSceneGroups, storyboardSelectedShot, storyboardShotStatusTone } from './motion-comic-storyboard';
import { motionComicVideoErrorMessage } from './motion-comic-video-failure';
import '../../styles/features/motion-comic-make.css';

export interface MotionComicMakeWorkspaceProps {
  episode: MotionComicPipelineData['episodes'][number];
  shots: readonly DirectorShot[];
  selectedShotId: string;
  busy: boolean;
  providerConnected: boolean;
  providerUnavailableReason?: string;
  onSelectShot: (id: string) => void;
  onUpdateShot: (id: string, patch: Partial<DirectorShot>) => void;
  onUpdateSubtitleCue?: (shotId: string, cueId: string, text: string) => void;
  onAddShot: () => void;
  onRemoveShot: (id: string) => void;
  onMoveShot: (direction: 'up' | 'down') => void;
  onGenerateImage: (id: string) => void | Promise<unknown>;
  onGenerateVideo: (id: string) => void | Promise<unknown>;
  renderFrames: (shotId: string, busy: boolean) => ReactNode;
  renderWorkflow: (shotId: string, busy: boolean) => ReactNode;
  renderCandidates: (shotId: string, busy: boolean) => ReactNode;
  assets?: readonly DirectorAsset[];
  onToggleAsset?: (asset: DirectorAsset) => void;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function MotionComicMakeWorkspace(props: MotionComicMakeWorkspaceProps) {
  const { episode, shots, busy } = props;
  const selected = storyboardSelectedShot(shots, props.selectedShotId);
  const groups = storyboardSceneGroups(episode, shots);
  const selectedIndex = shots.findIndex((shot) => shot.id === selected?.id);
  const referenceMode = (shotId: string) => episode.scenes.flatMap(scene => scene.shots).find(shot => shot.id === shotId)?.videoProduction?.referenceMode ?? 'frames';
  const optionalFrames = Boolean(selected && referenceMode(selected.id) === 'references');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const failure = selected && failures[selected.id] ? { id: selected.id, message: failures[selected.id] } : null;
  const gate = useRef(new Set<string>());
  const removeTarget = shots.find((shot) => shot.id === removeId);
  const selectedRunning = Boolean(selected && (running.has(`image:${selected.id}`) || running.has(`video:${selected.id}`)));
  const locked = busy || selectedRunning;
  const videoPending = selected?.videoJobStatus === 'queued' || selected?.videoJobStatus === 'running';
  const videoBlocked = selected?.renderStrategy !== 'living-poster' ? '请切换为远程视频制作方式。'
    : !selected.videoInputReady ? selected.videoInputUnavailableReason || '请补全视频制作输入。' : undefined;
  async function run(id: string, kind: 'image' | 'video') {
    const key = `${kind}:${id}`;
    if (gate.current.has(`image:${id}`) || gate.current.has(`video:${id}`)) return;
    gate.current.add(key); setRunning(new Set(gate.current)); setFailures(current => ({ ...current, [id]: '' }));
    try { await (kind === 'image' ? props.onGenerateImage(id) : props.onGenerateVideo(id)); }
    catch (reason) { setFailures(current => ({ ...current, [id]: motionComicVideoErrorMessage(reason) })); }
    finally { gate.current.delete(key); setRunning(new Set(gate.current)); }
  }
  const shotStatus = (shot: DirectorShot) => <span className='comic-make__status' data-state={(running.has(`image:${shot.id}`) || running.has(`video:${shot.id}`)) ? 'generating' : storyboardShotStatusTone(shot)}>{(running.has(`image:${shot.id}`) || running.has(`video:${shot.id}`)) ? (shot.videoRecovery === 'unknown' ? '提交结果待核对' : '生成中') : storyboardImageStatus(shot)}</span>;
  const preview = (shot: DirectorShot) => shot.videoUrl
    ? <video key={shot.videoUrl} src={shot.videoUrl} controls preload='metadata' aria-label='镜头视频预览' />
    : shot.thumbnail ? <img src={shot.thumbnail} alt={`${shot.title}画面`} />
    : <span className='comic-make__empty'><ImageOff size={24} aria-hidden='true' /><strong>等待镜头画面</strong><span>{referenceMode(shot.id) === 'references' ? '参考素材就绪后可直接生成视频，无需先生成分镜图。' : '请上传首帧或生成分镜图，再生成视频；尾帧可选。'}</span></span>;

  const selectedAssets = props.assets?.filter((a) => a.selected) ?? [];
  const allAssets = props.assets ?? [];

  return <section className='comic-make' aria-label='制作工作台'>
    {/* ── 左栏：分镜列表 ── */}
    <aside className='comic-make__list' aria-label='分镜列表'>
      <header>
        <strong>分镜 · {shots.length}</strong>
        <span>
          <IconButton label='新增分镜' icon={<Plus size={15} />} density='compact' variant='subtle' disabled={locked || !episode.scenes.length} onClick={props.onAddShot} />
          <IconButton label='上移' icon={<ArrowUp size={14} />} density='compact' variant='subtle' disabled={locked || selectedIndex <= 0} onClick={() => props.onMoveShot('up')} />
          <IconButton label='下移' icon={<ArrowDown size={14} />} density='compact' variant='subtle' disabled={locked || selectedIndex < 0 || selectedIndex >= shots.length - 1} onClick={() => props.onMoveShot('down')} />
          <IconButton label='删除' icon={<Trash2 size={14} />} density='compact' variant='subtle' disabled={locked || shots.length <= 1} onClick={() => setRemoveId(selected?.id ?? null)} />
        </span>
      </header>
      {groups.map((group) => <section key={group.id} aria-label={group.title}>
        <h3>{group.title}<small>{group.shots.length} 镜头</small></h3>
        {group.shots.map((shot) => <Button key={shot.id} variant='subtle' className='comic-make__row' aria-label={shot.title} aria-pressed={shot.id === selected?.id} onClick={() => props.onSelectShot(shot.id)}>
          <span className='comic-make__thumb'>{shot.thumbnail ? <img src={shot.thumbnail} alt='' loading='lazy' /> : <ImageOff size={14} aria-hidden='true' />}</span>
          <span className='comic-make__copy'><small>{String(shot.index).padStart(2, '0')} · {seconds(shot.durationMs)}</small><strong title={shot.title}>{shot.title}</strong></span>
          {shotStatus(shot)}
        </Button>)}
      </section>)}
      {!groups.length ? <p className='comic-make__hint'>当前分集暂无场次，请先在剧本中完成分幕分场。</p> : null}
    </aside>

    {selected ? <>
      <section className='comic-make__info' key={selected.id} aria-label='分镜信息'>
        <header className='comic-make__heading'><h2>镜头 {String(selected.index).padStart(2, '0')}<span>分镜编辑</span></h2>{shotStatus(selected)}</header>
        <div className='comic-make__editor'>
          <div className='comic-make__upper'>
            <section className='comic-make__description' aria-label='画面描述'>
              <TextField label='镜头标题' value={selected.title} disabled={locked} onChange={(_, data) => props.onUpdateShot(selected.id, { title: data.value })} />
              <TextAreaField label='画面描述 / 图片提示词' rows={5} value={selected.prompt} disabled={locked} resize='vertical' onChange={(_, data) => props.onUpdateShot(selected.id, { prompt: data.value })} />
              {selected.subtitleCues?.length ? selected.subtitleCues.map((cue, index) => <TextAreaField key={cue.id} label={`对白 / 字幕 ${index + 1}`} rows={2} value={cue.text} disabled={locked || !props.onUpdateSubtitleCue} resize='vertical' onChange={(_, data) => props.onUpdateSubtitleCue?.(selected.id, cue.id, data.value)} />) : <p className='comic-make__hint'>本镜头暂无对白，可在剧本中添加。</p>}
            </section>
            <section className='comic-make__refs-section' aria-label='参考素材'>
              <h3>参考素材<small>{selectedAssets.length} 已绑定</small></h3>
              <div className='comic-make__refs'>
                {(['角色造型', '场景', '道具'] as const).map((type) => {
                  const items = allAssets.filter((asset) => asset.type === type);
                  return <div key={type} className='comic-make__ref-group'>
                    <strong>{type === '角色造型' ? '角色' : type}</strong>
                    {items.length ? <div className='comic-make__ref-list'>{items.map((asset) => <Button key={asset.id} density='compact' variant='subtle' className='comic-make__ref' aria-pressed={Boolean(asset.selected)} disabled={locked || !props.onToggleAsset} title={asset.warning ? `${asset.label} · ${asset.warning}` : asset.label} onClick={() => props.onToggleAsset?.(asset)}>
                      <span className='comic-make__ref-thumb'>{asset.thumbnail ? <img src={asset.thumbnail} alt='' loading='lazy' /> : <ImageOff size={14} aria-hidden='true' />}</span>
                      <span className='comic-make__ref-name'>{asset.label}</span>
                      <small>{asset.selected ? '已绑定' : asset.warning ? '缺参考图' : '未绑定'}</small>
                    </Button>)}</div> : <p className='comic-make__hint'>暂无{type === '角色造型' ? '角色' : type}素材</p>}
                  </div>;
                })}
              </div>
            </section>
          </div>
          <section className='comic-make__motion' aria-label='视频运动提示词'>
            <TextAreaField label='视频运动提示词' rows={6} value={selected.motionPrompt} disabled={locked} resize='vertical' placeholder='描述人物动作、镜头运动，以及画面之间的变化。' onChange={(_, data) => props.onUpdateShot(selected.id, { motionPrompt: data.value })} />
          </section>
          <details key={optionalFrames ? 'optional-frames' : 'required-frames'} className='comic-make__frames' open={!optionalFrames && !selected.videoFirstFrameReady || undefined}>
            <summary>{optionalFrames ? '分镜图 / 首尾帧（可选）' : '首尾帧图片（首帧必需）'} <span>{selected.videoFirstFrameReady ? '首帧已就绪' : optionalFrames ? '按需设置构图参考' : '上传 / 选择'}{selected.videoLastFrameReady ? ' · 尾帧已就绪' : ''}</span></summary>
            <div>
              <p className='comic-make__hint'>{optionalFrames ? '角色、场景和道具参考图可直接用于视频生成；需要指定构图时，可补充分镜图作为参考。' : '当前使用首帧 / 首尾帧模式，需要先上传或生成首帧；尾帧可选。'}</p>
              <Button density='compact' disabled={locked || !props.providerConnected || Boolean(selected.imageUnavailableReason)} title={selected.imageUnavailableReason || props.providerUnavailableReason} onClick={() => void run(selected.id, 'image')}>{running.has(`image:${selected.id}`) ? '正在生成分镜图…' : selected.imageReady ? '更新分镜图' : optionalFrames ? '生成分镜图（可选）' : '生成首帧分镜图'}</Button>
              {props.renderFrames(selected.id, locked)}
            </div>
          </details>
        </div>
      </section>
      <aside className='comic-make__preview' aria-label='预览与生成'>
        <div className='comic-make__preview-body'>
          <section className='comic-make__preview-media'>
            <header className='comic-make__heading'><h2>效果预览</h2><small>{seconds(selected.durationMs)}</small></header>
            <div className='comic-make__player'>{preview(selected)}</div>
          </section>
          <div className='comic-make__history'>{props.renderCandidates(selected.id, locked)}</div>
          <section className='comic-make__bound' aria-label='已绑定参考图'>
            <h3>已绑定参考图<small>{selectedAssets.length}</small></h3>
            {selectedAssets.length ? <div className='comic-make__bound-list'>{selectedAssets.map(asset => <figure key={asset.id} title={asset.warning ? `${asset.label} · ${asset.warning}` : asset.label}>
              {asset.thumbnail ? <img src={asset.thumbnail} alt={asset.label} loading='lazy' /> : <span><ImageOff size={18} aria-hidden='true' /></span>}
              <figcaption>{asset.label}</figcaption>
            </figure>)}</div> : <p className='comic-make__hint'>从中栏选择角色、场景和道具</p>}
          </section>
        </div>
        <footer className='comic-make__generate-area'>
          <div className='comic-make__settings-scroll'>
            <TextField label='时长（秒）' type='number' min='0.001' max='60' step='0.1' value={String(selected.durationMs / 1000)} disabled={locked} onChange={(_, data) => { const durationMs = storyboardDurationMs(data.value); if (durationMs !== undefined) props.onUpdateShot(selected.id, { durationMs }); }} />
            <section className='comic-make__params' aria-label='视频参数'>{props.renderWorkflow(selected.id, locked)}</section>
            {failure?.id === selected.id ? <p role='alert' className='comic-make__error' title={failure.message}>{failure.message.replace(/^DIRECTOR_[A-Z_]+:\s*/, '')}</p> : null}
            {videoBlocked ? <p className='comic-make__hint' title={videoBlocked}>{videoBlocked.replace(/^DIRECTOR_[A-Z_]+:\s*/, '')}</p> : null}
          </div>
          <Button className='comic-make__generate' variant='primary' icon={<Video size={15} />} disabled={locked || videoPending || Boolean(videoBlocked)} title={videoBlocked} onClick={() => void run(selected.id, 'video')}>
            {selected.videoRecovery === 'unknown' ? '提交结果待核对' : running.has(`video:${selected.id}`) || videoPending ? '正在生成视频…' : '生成视频'}
          </Button>
        </footer>
      </aside>
    </> : <p className='comic-make__hint'>添加分镜后可在这里制作。</p>}

    <Dialog open={Boolean(removeTarget)} onOpenChange={(open) => { if (!open) setRemoveId(null); }} title='删除分镜' actions={<><Button onClick={() => setRemoveId(null)}>取消</Button><Button disabled={locked} onClick={() => { if (removeTarget) props.onRemoveShot(removeTarget.id); setRemoveId(null); }}>删除镜头</Button></>}>
      <p>确定删除「{removeTarget?.title}」？现有历史结果不会被重新生成。</p>
    </Dialog>
  </section>;
}
