import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { Button, Dialog, HoverPreview, IconButton, SelectField, SliderField, TextField } from '../../ui';
import { VOX_ANIMATION_CATEGORIES, VOX_TEMPLATES, voxAnimationAssetIds, type VoxAnimation, type VoxSavedTemplate } from '../../shared/vox-animation';
import { VoxAnimationPreview, type VoxApi, type VoxLocalAsset } from './VoxAnimationPreview';
import { createVoxTemplateExample, voxTemplateExampleAssets } from './vox-template-examples';
import { VoxTemplateSample } from './VoxTemplateSample';

export function VoxTemplateCatalog({ currentId, api, assets, ratio, durationMs, saved, busy, onApply, onApplySaved, onDeleteSaved, onClose }: {
  currentId: string; api: VoxApi; assets: readonly VoxLocalAsset[]; ratio: string; durationMs: number; saved: readonly VoxSavedTemplate[]; busy: boolean;
  onApply: (id: string) => void; onApplySaved: (animation: VoxAnimation) => void; onDeleteSaved: (id: string) => void; onClose: () => void;
}) {
  const [category, setCategory] = useState('全部'), [search, setSearch] = useState('');
  const [selected, setSelected] = useState(VOX_TEMPLATES.some(template => template.id === currentId) ? currentId : 'text-opening'), [savedId, setSavedId] = useState<string>();
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [timeMs, setTimeMs] = useState(0), [playing, setPlaying] = useState(!reducedMotion), [ready, setReady] = useState(false), [replay, setReplay] = useState(0);
  const playbackGeneration = useRef(0);
  const examples = useMemo(voxTemplateExampleAssets, []);
  const previewApi = useMemo<VoxApi>(() => ({ ...api, readVoxAnimationAsset: async path => examples.find(asset => asset.path === path)?.url ?? api.readVoxAnimationAsset(path) }), [api, examples]);
  const selectedSaved = saved.find(template => template.id === savedId);
  const missingSavedAssets = Boolean(selectedSaved && voxAnimationAssetIds(selectedSaved.animation).some(id => !assets.some(asset => asset.id === id)));
  const selectedTemplate = VOX_TEMPLATES.find(template => template.id === (selectedSaved?.animation.template.id ?? selected)) ?? VOX_TEMPLATES.find(template => template.id === 'text-opening')!;
  const example = useMemo(() => createVoxTemplateExample(selectedTemplate.id), [selectedTemplate.id]);
  const preview = selectedSaved ? { animation: selectedSaved.animation, durationMs, cues: example.cues.map(cue => ({ ...cue,
    startMs: cue.startMs * durationMs / example.durationMs, endMs: cue.endMs * durationMs / example.durationMs,
    tokens: cue.tokens?.map(token => ({ ...token, startMs: token.startMs * durationMs / example.durationMs, endMs: token.endMs * durationMs / example.durationMs })),
  })) } : example;
  const lastFrameMs = (Math.ceil(preview.durationMs * 24 / 1000) - 1) * 1000 / 24;
  const filtered = VOX_TEMPLATES.filter(template => (category === '全部' || category === template.category) && `${template.name}${template.description}`.includes(search.trim()));
  const filteredSaved = saved.filter(template => template.name.includes(search.trim()));
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);
  useEffect(() => { if (reducedMotion) setPlaying(false); }, [reducedMotion]);
  useEffect(() => { playbackGeneration.current++; setTimeMs(0); setReady(false); setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, [selected, savedId]);
  useEffect(() => {
    if (!playing || !ready) return;
    let frame = 0, previous = performance.now();
    const started = previous, startTime = timeMs, generation = playbackGeneration.current;
    const tick = (now: number) => {
      if (generation !== playbackGeneration.current) return;
      if (now - previous >= 1000 / 24) {
        previous = now;
        const next = Math.min(lastFrameMs, startTime + now - started);
        setTimeMs(next);
        if (next >= lastFrameMs) { setPlaying(false); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, ready, lastFrameMs, replay]);
  const name = selectedSaved?.name ?? selectedTemplate.name;
  return <Dialog open title="预览并选择动画模板" onOpenChange={open => { if (!open) onClose(); }} actions={<>
    <Button onClick={onClose}>取消</Button>
    <Button variant="primary" disabled={busy || (!selectedSaved && !ready)} onClick={() => selectedSaved ? onApplySaved(selectedSaved.animation) : onApply(selected)}>应用{selectedSaved ? '个人模板' : '此动画'}</Button>
  </>}>
    <div className="vox-template-catalog">
      <div className="vox-catalog-filters"><SelectField label="模板分类" value={category} options={[{ value: '全部', label: `全部 · ${VOX_TEMPLATES.length}` }, ...VOX_ANIMATION_CATEGORIES.map(value => ({ value, label: value })), { value: '我的模板', label: '我的模板' }]} onChange={event => setCategory(event.target.value)} /><TextField label="搜索模板" value={search} onChange={(_, data) => setSearch(data.value)} /></div>
      <div className="vox-catalog-body">
        <div className="vox-template-list" role="group" aria-label="可预览的动画模板">
          {category === '我的模板' ? filteredSaved.map(template => <div className="vox-saved-row" key={template.id}><HoverPreview title={template.name} description="个人模板 · 点击可查看完整预览" renderPreview={() => <VoxTemplateSample templateId={template.animation.template.id} animation={template.animation} api={api} assets={assets} ratio={ratio} durationMs={durationMs} />}><Button variant={savedId === template.id ? 'secondary' : 'subtle'} className="vox-template-option" aria-pressed={savedId === template.id} onClick={() => setSavedId(template.id)}>{template.name}</Button></HoverPreview><IconButton label={`删除模板 ${template.name}`} icon={<Trash2 size={14} />} onClick={() => { if (savedId === template.id) setSavedId(undefined); onDeleteSaved(template.id); }} /></div>) : filtered.map(template => <HoverPreview key={template.id} title={template.name} description={template.description} renderPreview={() => <VoxTemplateSample templateId={template.id} api={api} ratio={ratio} />}><Button variant={!savedId && selected === template.id ? 'secondary' : 'subtle'} className="vox-template-option" aria-pressed={!savedId && selected === template.id} onClick={() => { setSelected(template.id); setSavedId(undefined); }}><span><strong>{template.name}</strong><small>{template.description}</small></span>{currentId === template.id ? <Check size={14} aria-label="当前镜头已用" /> : null}</Button></HoverPreview>)}
          {(category === '我的模板' ? !filteredSaved.length : !filtered.length) ? <p className="vox-hint">{category === '我的模板' && !saved.length ? '保存的个人模板会显示在这里。' : '没有匹配的模板'}</p> : null}
        </div>
        <section className="vox-catalog-preview" aria-label={`${name} 动态预览`}>
          <div className="vox-catalog-preview-heading"><strong>{name}</strong><span>{selectedSaved ? '个人模板' : '示例预览'}</span></div>
          <p className="vox-hint">{selectedSaved ? missingSavedAssets ? '部分素材不在当前项目。可先应用，再补齐素材或修正内容；预览通过后才能导出。' : !ready ? '可先应用个人模板，再补齐素材或修正内容；预览通过后才能导出。' : preview.cues.length ? '字幕使用示例时间演示；应用后跟随当前镜头字幕。' : '预览已保存的内容；应用后替换当前动画设置。' : '示例图文用于展示动作；应用时保留当前镜头内容。'}</p>
          <div className="vox-catalog-stage" data-ratio={ratio} style={{ aspectRatio: ratio.replace(':', '/') }}>
            <VoxAnimationPreview key={`${selected}:${savedId ?? ''}`} animation={preview.animation} api={previewApi} assets={selectedSaved ? assets : examples} ratio={ratio} durationMs={preview.durationMs} timeMs={timeMs} cues={preview.cues} onReady={setReady} />
          </div>
          <div className="vox-catalog-playback"><Button density="compact" disabled={!ready} onClick={() => { if (timeMs >= lastFrameMs) setTimeMs(0); setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停动画' : '播放动画'}</Button><IconButton label="重新播放示例" disabled={!ready} icon={<RotateCcw size={14} />} onClick={() => { setTimeMs(0); setPlaying(true); setReplay(value => value + 1); }} /><output aria-label="示例播放时间">{(timeMs / 1000).toFixed(1)} / {(preview.durationMs / 1000).toFixed(1)} 秒</output></div>
          <SliderField label="动画示例进度" min={0} max={Math.round(lastFrameMs)} step={1000 / 24} value={Math.min(timeMs, lastFrameMs)} disabled={!ready} onChange={(_, data) => { setPlaying(false); setTimeMs(Number(data.value)); }} />
          <p className="vox-hint">{reducedMotion && !playing ? '已按系统设置关闭自动播放，可手动播放查看效果。' : !selectedSaved && selectedTemplate.audio ? '波形与频谱使用本地合成音源演示，仅预览画面。' : selectedTemplate.description}</p>
        </section>
      </div>
    </div>
  </Dialog>;
}
