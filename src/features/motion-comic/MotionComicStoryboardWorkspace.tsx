import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Image as ImageIcon, LayoutGrid, List, Plus, Save, Trash2 } from 'lucide-react';
import type { DirectorShot } from '../director-desk/DirectorDeskWorkspace';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { Button, Dialog, SegmentedControl, TextAreaField, TextField, Toolbar } from '../../ui';
import { storyboardDurationMs, storyboardImageStatus, storyboardKeyframeActionLabel, storyboardKeyframeHint, storyboardSceneGroups, storyboardSelectedShot, storyboardShotStatusTone } from './motion-comic-storyboard';
import '../../styles/features/motion-comic-storyboard.css';

interface MotionComicStoryboardWorkspaceProps {
  episode: MotionComicPipelineData['episodes'][number];
  shots: readonly DirectorShot[];
  selectedShotId: string;
  dirty: boolean;
  busy: boolean;
  providerConnected: boolean;
  providerUnavailableReason?: string;
  onSelectShot: (id: string) => void;
  onUpdateShot: (id: string, patch: Partial<DirectorShot>) => void;
  onAddShot: () => void;
  onRemoveShot: (id: string) => void;
  onMoveShot: (direction: 'up' | 'down') => void;
  onSave: () => void;
  onGenerateShot: (id: string) => void | Promise<unknown>;
  onOpenAssets: () => void;
  onOpenProduction: () => void;
}

export function MotionComicStoryboardWorkspace(props: MotionComicStoryboardWorkspaceProps) {
  const { episode, shots, selectedShotId, busy } = props;
  const [view, setView] = useState('table');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const generationGate = useRef(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState('');
  async function generateShot(id: string) {
    if (generationGate.current) return;
    generationGate.current = true;
    setGeneratingId(id);
    setGenerationError('');
    try { await props.onGenerateShot(id); }
    catch (error) { setGenerationError(error instanceof Error ? error.message : '分镜图生成失败，请检查模型配置后重试。'); }
    finally { generationGate.current = false; setGeneratingId(null); }
  }
  const selected = storyboardSelectedShot(shots, selectedShotId);
  const groups = storyboardSceneGroups(episode, shots);
  const selectedIndex = shots.findIndex((shot) => shot.id === selected?.id);
  const removeTarget = shots.find((shot) => shot.id === removeId);
  const totalSeconds = shots.reduce((sum, shot) => sum + shot.durationMs, 0) / 1000;
  const totalTime = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(Math.floor(totalSeconds % 60)).padStart(2, '0')}`;
  const selectedGroup = groups.find((group) => group.shots.some((shot) => shot.id === selected?.id));
  const status = (shot: DirectorShot) => <span className="comic-storyboard__status" data-state={generatingId === shot.id ? 'generating' : storyboardShotStatusTone(shot)}>{generatingId === shot.id ? (shot.renderStrategy === 'living-poster' ? '正在生成视频' : '正在生成') : storyboardImageStatus(shot)}</span>;
  useEffect(() => {
    if (selected && selected.id !== selectedShotId) props.onSelectShot(selected.id);
  }, [selected, selectedShotId, props.onSelectShot]);
  const thumbnail = (shot: DirectorShot) => shot.thumbnail
    ? <img src={shot.thumbnail} alt={`${shot.title}分镜画面`} loading="lazy" />
    : <span className="comic-storyboard__placeholder"><ImageIcon size={24} aria-hidden="true" /><span>待生成画面</span></span>;
  const select = (shot: DirectorShot, showTitle = false) => <button type="button" className="comic-storyboard__select" aria-label={`选择镜头 ${shot.title}`} aria-pressed={selected?.id === shot.id} onClick={() => props.onSelectShot(shot.id)}><span className="comic-storyboard__thumbnail">{thumbnail(shot)}<span className="comic-storyboard__frame-label">{shot.framing || '未设景别'}</span></span>{showTitle && <strong>{String(shot.index).padStart(2, '0')} · {shot.title}</strong>}</button>;
  return <section className="comic-storyboard" aria-label="分镜编排工作台">
    <div className="comic-storyboard__main">
      <header className="comic-storyboard__heading"><div><h2>分镜编排工作台</h2><p>EP{String(episode.number).padStart(2, '0')} · {episode.title}</p></div><SegmentedControl label="分镜显示方式" value={view} onChange={setView} options={[{ value: 'table', label: '列表', icon: <List size={16} /> }, { value: 'cards', label: '卡片', icon: <LayoutGrid size={16} /> }]} /></header>
      <Toolbar aria-label="分镜编排操作">
        <span className="comic-storyboard__save-state" role="status">{props.dirty ? '有未保存修改' : '分镜已保存'}</span>
        <Button icon={<Plus size={15} />} disabled={busy || !episode.scenes.length} onClick={props.onAddShot}>添加分镜</Button>
        <Button icon={<Trash2 size={15} />} disabled={busy || shots.length <= 1} onClick={() => setRemoveId(selected?.id ?? null)}>删除分镜</Button>
        <Button icon={<ArrowUp size={15} />} disabled={busy || selectedIndex <= 0} onClick={() => props.onMoveShot('up')}>上移</Button>
        <Button icon={<ArrowDown size={15} />} disabled={busy || selectedIndex < 0 || selectedIndex === shots.length - 1} onClick={() => props.onMoveShot('down')}>下移</Button>
        <Button icon={<Save size={15} />} disabled={busy || !props.dirty} onClick={props.onSave}>保存分镜</Button>
      </Toolbar>
      <div className="comic-storyboard__groups">
        {view === 'table' ? <>
          {shots.length > 0 && <div className="comic-storyboard__table-wrap"><table aria-label="分镜列表"><thead><tr><th scope="col">序号</th><th scope="col">画面缩略图</th><th scope="col">场景 / 镜头</th><th scope="col">角色</th><th scope="col">时长</th><th scope="col">对白</th><th scope="col">状态</th></tr></thead><tbody>{groups.flatMap((group) => group.shots.map((shot) => <tr key={shot.id} data-selected={selected?.id === shot.id}><td className="comic-storyboard__number">{String(shot.index).padStart(2, '0')}</td><td>{select(shot)}</td><td><button type="button" className="comic-storyboard__title-button" aria-pressed={selected?.id === shot.id} onClick={() => props.onSelectShot(shot.id)}>{shot.title}</button>{group.title !== shot.title && <span className="comic-storyboard__scene-title">{group.title}</span>}<span className="comic-storyboard__compact-meta">{shot.durationMs / 1000} 秒 · {shot.characterLabel || '无角色'}</span></td><td>{shot.characterLabel || '—'}</td><td className="comic-storyboard__duration">{shot.durationMs / 1000}s</td><td className="comic-storyboard__dialogue">{shot.subtitle || '—'}</td><td>{status(shot)}</td></tr>))}</tbody></table></div>}
          {groups.filter((group) => !group.shots.length).map((group) => <p key={group.id} className="comic-storyboard__empty">{group.title}暂无镜头，可在分幕分场中补充。</p>)}
        </> : groups.map((group, index) => <section key={group.id} aria-label={`场次 ${index + 1} ${group.title}`}>
          <h3><span>场次 {String(index + 1).padStart(2, '0')}</span>{group.title}<small>{group.shots.length} 个镜头</small></h3>
          {!group.shots.length ? <p className="comic-storyboard__empty">本场次暂无镜头，可在分幕分场中补充。</p> : <div className="comic-storyboard__cards">{group.shots.map((shot) => <article key={shot.id} data-selected={selected?.id === shot.id}>{select(shot, true)}<p className="comic-storyboard__card-meta">{shot.characterLabel || '无角色'}<span>{shot.durationMs / 1000}s</span></p><p>{shot.subtitle || '暂无对白'}</p>{status(shot)}</article>)}</div>}
        </section>)}
        {!groups.length && <p className="comic-storyboard__empty">当前分集暂无场次，请先在剧本中完成分幕分场。</p>}
      </div>
      <footer className="comic-storyboard__summary"><span>预计时长：<strong>{totalTime}</strong><small>（{totalSeconds.toFixed(1)} 秒）</small></span><span>共 {groups.length} 个场次 · {shots.length} 个镜头</span></footer>
    </div>
    <aside className="comic-storyboard__inspector" aria-label="分镜详情">
      <header><h2>分镜详情</h2><Button variant="primary" disabled={busy || !shots.length} onClick={props.onOpenProduction}>进入生产</Button></header>
      {selected ? <div key={selected.id}>
        <div className="comic-storyboard__preview">{thumbnail(selected)}</div>
        <div className="comic-storyboard__selection"><div><strong>镜头 {String(selected.index).padStart(2, '0')}</strong><span>{selectedGroup?.title || selected.scene} · {selected.characterLabel || '未关联角色'}</span></div>{status(selected)}</div>
        <div className="comic-storyboard__fields">
        <TextField label="镜头标题" value={selected.title} disabled={busy} onChange={(_, data) => props.onUpdateShot(selected.id, { title: data.value })} />
        <TextField label="时长（秒）" type="number" min="0.001" step="0.1" value={String(selected.durationMs / 1000)} disabled={busy} onChange={(_, data) => { const durationMs = storyboardDurationMs(data.value); if (durationMs !== undefined) props.onUpdateShot(selected.id, { durationMs }); }} />
        <TextField label="景别" value={selected.framing} disabled={busy} onChange={(_, data) => props.onUpdateShot(selected.id, { framing: data.value })} />
        <TextAreaField label="画面提示词" value={selected.prompt} disabled={busy} resize="vertical" onChange={(_, data) => props.onUpdateShot(selected.id, { prompt: data.value })} />
        <TextAreaField label="运镜与动作" value={selected.motionPrompt} disabled={busy} resize="vertical" onChange={(_, data) => props.onUpdateShot(selected.id, { motionPrompt: data.value })} />
        <TextAreaField label="对白 / 字幕" value={selected.subtitle} disabled={busy} resize="vertical" onChange={(_, data) => props.onUpdateShot(selected.id, { subtitle: data.value })} />
        </div>
        <div className="comic-storyboard__actions"><Button disabled={busy} onClick={props.onOpenAssets}>管理参考资产</Button><Button icon={<ImageIcon size={16} />} disabled={busy || Boolean(generatingId) || !props.providerConnected || Boolean(selected.imageUnavailableReason)} onClick={() => void generateShot(selected.id)}>{generatingId === selected.id ? '正在生成关键帧…' : storyboardKeyframeActionLabel(selected)}</Button></div>
        {generationError ? <p role="alert" className="comic-storyboard__hint">{generationError}</p> : null}
        {selected.imageUnavailableReason || (!props.providerConnected && props.providerUnavailableReason) ? <p className="comic-storyboard__hint">{selected.imageUnavailableReason || props.providerUnavailableReason}</p> : null}
        {storyboardKeyframeHint(selected) ? <p className="comic-storyboard__hint">{storyboardKeyframeHint(selected)}</p> : null}
        <p className="comic-storyboard__hint">画面生成沿用当前图像模型与参考资产。编辑提示词或时长后，请在生产中检查结果是否需要更新。</p>
      </div> : <p className="comic-storyboard__empty">添加镜头后可编辑分镜详情。</p>}
    </aside>
    <Dialog open={Boolean(removeTarget)} onOpenChange={(open) => { if (!open) setRemoveId(null); }} title="删除分镜" actions={<><Button onClick={() => setRemoveId(null)}>取消</Button><Button disabled={busy} onClick={() => { if (removeTarget) props.onRemoveShot(removeTarget.id); setRemoveId(null); }}>删除镜头</Button></>}><p>确定删除「{removeTarget?.title}」？现有历史结果不会被重新生成。</p></Dialog>
  </section>;
}
