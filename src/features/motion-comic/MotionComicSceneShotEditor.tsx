import { useState, type ReactElement, type ReactNode } from 'react';
import { Image, Pencil, Save, X } from 'lucide-react';
import { Button, TextAreaField, TextField, Toolbar } from '../../ui';
import type { MotionComicDialogueCue, MotionComicPipelineData, MotionComicShot } from '../../shared/motion-comic';
import './motion-comic-scene-shot.css';

export interface SceneShotDraft {
  title: string;
  framing: string;
  duration: string;
  prompt: string;
  motionPrompt: string;
  startState: string;
  endState: string;
  screenDirection: string;
  actionBeats: string;
  dialogue: Record<string, string>;
}

export function createSceneShotDraft(shot: MotionComicShot, cues: MotionComicDialogueCue[]): SceneShotDraft {
  return {
    title: shot.title, framing: shot.framing, duration: String(shot.durationMs / 1000),
    prompt: shot.prompt, motionPrompt: shot.motionPrompt,
    startState: shot.continuity?.startState ?? '', endState: shot.continuity?.endState ?? '',
    screenDirection: shot.continuity?.screenDirection ?? '', actionBeats: shot.continuity?.actionBeats.join('\n') ?? '',
    dialogue: Object.fromEntries(cues.map((cue) => [cue.id, cue.text])),
  };
}

export function validateSceneShotDraft(draft: SceneShotDraft, baseline?: SceneShotDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.title.trim()) errors.title = '请填写镜头标题。';
  if (!draft.framing.trim()) errors.framing = '请填写景别，如中景、近景。';
  const durationMs = Number(draft.duration) * 1000;
  if (!draft.duration.trim() || !Number.isFinite(durationMs) || durationMs < 1 || durationMs > 60_000) errors.duration = '时长须大于 0 且不超过 60 秒，最小精度为 0.001 秒。';
  if (!draft.prompt.trim()) errors.prompt = '请填写画面描述。';
  if (!draft.motionPrompt.trim()) errors.motionPrompt = '请填写动作与运镜；静止镜头可填写固定机位。';
  if ([draft.startState, draft.endState, draft.screenDirection, draft.actionBeats, baseline?.startState ?? '', baseline?.endState ?? '', baseline?.screenDirection ?? '', baseline?.actionBeats ?? ''].some((value) => value.trim())) {
    if (!draft.startState.trim()) errors.startState = '请填写镜头开始时的状态。';
    if (!draft.endState.trim()) errors.endState = '请填写镜头结束时的状态。';
    if (!draft.screenDirection.trim()) errors.screenDirection = '请填写画面方向与视线。';
    const beats = draft.actionBeats.split('\n').map((value) => value.trim()).filter(Boolean);
    if (beats.length < 1 || beats.length > 8 || beats.some((value) => value.length > 2000)) errors.actionBeats = '请填写 1–8 个动作节拍，每行一项，每项最多 2000 字。';
  }
  for (const [id, text] of Object.entries(draft.dialogue)) if (!text.trim()) errors[`cue:${id}`] = '对白不能为空；无声镜头请在对白管理中移除该句。';
  return errors;
}

export function sceneShotDraftPatch(before: SceneShotDraft, draft: SceneShotDraft): Partial<MotionComicShot> {
  const patch: Partial<MotionComicShot> = {};
  for (const key of ['title', 'framing', 'prompt', 'motionPrompt'] as const) if (draft[key] !== before[key]) patch[key] = draft[key].trim();
  if (draft.duration !== before.duration) patch.durationMs = Math.round(Number(draft.duration) * 1000);
  if (['startState', 'endState', 'screenDirection', 'actionBeats'].some((key) => draft[key as keyof SceneShotDraft] !== before[key as keyof SceneShotDraft])) {
    patch.continuity = [draft.startState, draft.endState, draft.screenDirection, draft.actionBeats].some((value) => value.trim()) ? {
      startState: draft.startState.trim(), endState: draft.endState.trim(), screenDirection: draft.screenDirection.trim(),
      actionBeats: draft.actionBeats.split('\n').map((value) => value.trim()).filter(Boolean),
    } : undefined;
  }
  return patch;
}

export interface SceneShotEditorProps {
  document: MotionComicPipelineData;
  shot: MotionComicShot;
  cues: MotionComicDialogueCue[];
  preview?: ReactNode;
  hasPreview?: boolean;
  onUpdateShot?: (shotId: string, updates: Partial<MotionComicShot>) => void;
  onUpdateCue?: (cueId: string, updates: Partial<MotionComicDialogueCue>) => void;
  onEditingChange?: (shotId: string, editing: boolean) => void;
}

export function MotionComicSceneShotEditor({ document, shot, cues, preview, hasPreview, onUpdateShot, onUpdateCue, onEditingChange }: SceneShotEditorProps): ReactElement {
  const [draft, setDraft] = useState<SceneShotDraft | null>(null);
  const [baseline, setBaseline] = useState<SceneShotDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const characters = shot.characterLookIds.flatMap((id) => document.characters.flatMap((character) => character.looks.filter((look) => look.id === id).map((look) => `${character.name} · ${look.label}`)));
  const location = document.sceneAssets.find((asset) => asset.id === shot.sceneAssetId);
  const props = shot.propAssetIds.flatMap((id) => document.props.filter((asset) => asset.id === id).map((asset) => asset.label));
  const speaker = (cue: MotionComicDialogueCue) => cue.speakerName || document.characters.find((character) => character.id === cue.characterId)?.name || (cue.speakerRole === 'narrative' ? '旁白' : '未标注说话人');
  function closeEditor() { setDraft(null); setBaseline(null); setErrors({}); setSaveError(''); onEditingChange?.(shot.id, false); }
  function save() {
    if (!draft || !baseline || !onUpdateShot) return;
    const nextErrors = validateSceneShotDraft(draft, baseline);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (JSON.stringify(createSceneShotDraft(shot, cues)) !== JSON.stringify(baseline)) {
      setSaveError('镜头内容已在其他位置更新。请先复制需要保留的修改，取消后重新编辑。');
      return;
    }
    try {
      const patch = sceneShotDraftPatch(baseline, draft);
      if (Object.keys(patch).length) onUpdateShot(shot.id, patch);
      for (const cue of cues) if (onUpdateCue && draft.dialogue[cue.id] !== baseline.dialogue[cue.id]) onUpdateCue(cue.id, { text: draft.dialogue[cue.id].trim() });
      closeEditor();
    } catch (error) { setSaveError(error instanceof Error ? error.message : '镜头保存失败，请重试。'); }
  }
  const set = (key: Exclude<keyof SceneShotDraft, 'dialogue'>, value: string) => setDraft((current) => current ? { ...current, [key]: value } : current);
  return <article className={`comic-scene-shot${draft ? ' is-editing' : ''}`} data-shot-content={shot.id}>
    <header className="comic-scene-shot__header">
      <div className="comic-scene-shot__metadata"><strong>镜头{String(shot.index).padStart(2, '0')}</strong><span>景别 <b>{shot.framing || '待补充'}</b></span><span>时长 <b>{shot.durationMs / 1000} 秒</b></span>{hasPreview !== undefined ? <span className="comic-scene-shot__preview-status">{hasPreview ? '已有画面' : '待生成画面'}</span> : null}</div>
      {!draft ? <Button variant="secondary" density="compact" icon={<Pencil size={14} />} aria-label={`编辑镜头 ${shot.index}`} disabled={!onUpdateShot} onClick={() => { const next = createSceneShotDraft(shot, cues); setDraft(next); setBaseline(next); onEditingChange?.(shot.id, true); }}>编辑</Button> : <span className="comic-scene-shot__draft-status">编辑中 · 尚未应用</span>}
    </header>
    {draft ? <form className="comic-scene-shot__editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="comic-scene-shot__fields">
        <TextField label="镜头标题" value={draft.title} maxLength={512} validationMessage={errors.title} onChange={(_, data) => set('title', data.value)} />
        <TextField label="景别" value={draft.framing} maxLength={512} validationMessage={errors.framing} onChange={(_, data) => set('framing', data.value)} />
        <TextField label="时长（秒）" type="number" min={0.001} max={60} step={0.001} value={draft.duration} validationMessage={errors.duration} onChange={(_, data) => set('duration', data.value)} />
      </div>
      <TextAreaField label="画面描述" rows={3} value={draft.prompt} maxLength={65536} validationMessage={errors.prompt} onChange={(_, data) => set('prompt', data.value)} />
      <TextAreaField label="动作 / 运镜" rows={3} value={draft.motionPrompt} maxLength={65536} validationMessage={errors.motionPrompt} onChange={(_, data) => set('motionPrompt', data.value)} />
      <fieldset className="comic-scene-shot__continuity"><legend>动作承接</legend>
        <TextAreaField label="起始状态" rows={2} value={draft.startState} maxLength={8000} validationMessage={errors.startState} onChange={(_, data) => set('startState', data.value)} />
        <TextAreaField label="结束状态" rows={2} value={draft.endState} maxLength={8000} validationMessage={errors.endState} onChange={(_, data) => set('endState', data.value)} />
        <TextField label="画面方向 / 视线" value={draft.screenDirection} maxLength={1000} validationMessage={errors.screenDirection} onChange={(_, data) => set('screenDirection', data.value)} />
        <TextAreaField label="动作节拍（每行一项）" rows={3} value={draft.actionBeats} validationMessage={errors.actionBeats} onChange={(_, data) => set('actionBeats', data.value)} />
      </fieldset>
      <section className="comic-scene-dialogue" aria-label="编辑对白与旁白"><strong>对白与旁白</strong>
        {cues.length ? cues.map((cue) => <TextAreaField key={cue.id} label={`${speaker(cue)}${cue.emotion ? ` · ${cue.emotion}` : ''}`} value={draft.dialogue[cue.id] ?? cue.text} rows={2} readOnly={!onUpdateCue} validationMessage={errors[`cue:${cue.id}`]} onChange={(_, data) => setDraft((current) => current ? { ...current, dialogue: { ...current.dialogue, [cue.id]: data.value } } : current)} />) : <p>本镜无对白或旁白，可保留为无声动作镜头。</p>}
        {cues.length && !onUpdateCue ? <small>对白编辑尚未连接，请到配音字幕工作区修改。</small> : null}
      </section>
      {saveError ? <p role="alert">{saveError}</p> : null}
      {Object.keys(errors).length ? <p role="alert">请修正标出的字段后再保存。</p> : null}
      <Toolbar aria-label={`镜头 ${shot.index} 编辑操作`}><Button type="submit" variant="primary" icon={<Save size={14} />}>保存镜头</Button><Button type="button" variant="secondary" icon={<X size={14} />} onClick={closeEditor}>取消</Button><small>保存后应用到当前项目；项目保存状态以工作区提示为准。</small></Toolbar>
    </form> : <>
      <div className="comic-scene-shot__body">
        <div className="comic-scene-shot__thumbnail">{preview ?? <div className="comic-scene-shot__placeholder"><Image size={28} aria-hidden="true" /><span>暂无镜头画面</span></div>}</div>
        <div className="comic-scene-shot__content">
          <h3>{shot.title || '镜头标题待补充'}</h3>
          <dl className="comic-scene-shot__description">
            <div><dt>画面</dt><dd>{shot.prompt || '待补充画面描述'}</dd></div>
            <div><dt>动作 / 运镜</dt><dd>{shot.motionPrompt || '待补充动作与运镜'}</dd></div>
            <div><dt>对白 / 旁白</dt><dd><div className="comic-scene-dialogue" aria-label="对白与旁白">{cues.length ? cues.map((cue) => <p key={cue.id}><span>{speaker(cue)}{cue.emotion ? ` · ${cue.emotion}` : ''}</span>{cue.text}</p>) : <small>本镜未配置对白或旁白；无声动作镜头可留空。</small>}</div></dd></div>
          </dl>
        </div>
      </div>
      <details className="comic-scene-shot__references">
        <summary>连续性与资产引用</summary>
        <dl>
          <div><dt>起始状态</dt><dd>{shot.continuity?.startState || '待补充承接状态'}</dd></div>
          <div><dt>结束状态</dt><dd>{shot.continuity?.endState || '待补充结束状态'}</dd></div>
          <div><dt>画面方向 / 视线</dt><dd>{shot.continuity?.screenDirection || '待补充方向'}</dd></div>
          <div><dt>动作节拍</dt><dd>{shot.continuity?.actionBeats.length ? <ol>{shot.continuity.actionBeats.map((beat, index) => <li key={index}>{beat}</li>)}</ol> : '待补充动作节拍'}</dd></div>
          <div><dt>角色造型</dt><dd>{characters.join('、') || '无角色引用'}</dd></div>
          <div><dt>场景 / 道具</dt><dd>{location?.label || '场景待关联'}{props.length ? ` · ${props.join('、')}` : ' · 无道具引用'}</dd></div>
        </dl>
      </details>
    </>}
  </article>;
}
