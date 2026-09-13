import { useEffect, useState } from 'react';
import { Flag, Play, Plus, Trash2, Upload, Volume2, WandSparkles } from 'lucide-react';
import type { ProductionSubtitleCue } from '../../shared/production-workflow';
import { isSubtitleAlignmentValid } from '../../shared/audio-alignment';
import { Button, CheckboxField, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';

export interface DirectorSubtitleCue extends ProductionSubtitleCue {
  characterId?: string;
  emotion?: string;
  voiceAssetVersionId?: string;
}

export type DirectorSubtitlePatch = Partial<Pick<DirectorSubtitleCue, 'text' | 'startMs' | 'endMs' | 'characterId' | 'emotion'>>;

export interface DirectorSubtitleInspectorProps {
  cues: readonly DirectorSubtitleCue[];
  focusCueId?: string;
  shotStartMs: number;
  durationMs: number;
  busy: boolean;
  style: string;
  safeAreaVisible: boolean;
  characters?: readonly { value: string; label: string }[];
  voiceConnected?: boolean;
  onGenerateVoice?: (id: string) => void;
  onUpdate: (id: string, patch: DirectorSubtitlePatch) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onAlign: (id: string) => void;
  /** Import a local JSON/SRT/VTT transcript with explicit word/segment clocks. */
  onImportTimestamps?: (id: string) => void;
  onSeek: (timeMs: number) => void;
  onStyleChange: (style: string) => void;
  onSafeAreaChange: (visible: boolean) => void;
}

const sourceLabels = { provider: '服务时间戳', whisper: 'Whisper 对齐', manual: '人工对齐', estimated: '估算对齐' } as const;

export function DirectorSubtitleInspector(props: DirectorSubtitleInspectorProps) {
  const [selectedId, setSelectedId] = useState(props.cues[0]?.id ?? '');
  const [error, setError] = useState('');
  const resolvedFocusCueId = props.cues.some((candidate) => candidate.id === props.focusCueId) ? props.focusCueId : undefined;
  useEffect(() => {
    if (resolvedFocusCueId) setSelectedId(resolvedFocusCueId);
  }, [resolvedFocusCueId]);
  const cue = props.cues.find((candidate) => candidate.id === selectedId) ?? props.cues[0];
  const run = (action: () => void) => {
    try { action(); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="director-form-stack director-cue-editor" aria-label="逐句字幕编辑" data-director-subtitle-editor="true">
    <SelectField label="字幕句子" value={cue?.id ?? ''} disabled={props.busy || !cue} options={props.cues.map((item, index) => ({ value: item.id, label: `${index + 1}. ${item.text.trim() || '空白字幕'}` }))} onChange={(event) => { setSelectedId(event.target.value); setError(''); }} />
    <Toolbar aria-label="字幕句子操作" className="director-cue-actions">
      <Button density="compact" variant="subtle" disabled={props.busy} onClick={() => run(props.onAdd)}><Plus size={13} />新增一句</Button>
      <Button density="compact" variant="subtle" disabled={props.busy || !cue} onClick={() => cue && run(() => props.onRemove(cue.id))}><Trash2 size={13} />删除本句</Button>
      <Button density="compact" variant="subtle" disabled={!cue} onClick={() => cue && props.onSeek(cue.startMs)}><Play size={13} />定位本句</Button>
    </Toolbar>
    {cue ? <>
      {props.characters ? <SelectField label="本句配音角色" value={cue.characterId ?? ''} disabled={props.busy} options={[{ value: '', label: '旁白 · 镜头默认音色' }, ...props.characters]} onChange={(event) => run(() => props.onUpdate(cue.id, { characterId: event.target.value }))} /> : null}
      <TextAreaField fieldClassName="director-prompt-field" label="字幕内容" value={cue.text} disabled={props.busy} onChange={(_, data) => run(() => props.onUpdate(cue.id, { text: data.value }))} resize="vertical" />
      {props.onGenerateVoice ? <Button density="compact" variant="secondary" disabled={props.busy || !props.voiceConnected || !cue.text.trim()} onClick={() => props.onGenerateVoice?.(cue.id)}><Volume2 size={13} />{cue.voiceAssetVersionId ? '重新生成本句配音' : '生成本句配音'}</Button> : null}
      <CueTimeFields key={cue.id} cue={cue} shotStartMs={props.shotStartMs} durationMs={props.durationMs} disabled={props.busy} onUpdate={(patch) => props.onUpdate(cue.id, patch)} />
      <div className="director-cue-alignment"><span>{cue.tokens?.length ? `${isSubtitleAlignmentValid(cue) ? sourceLabels[cue.alignmentSource ?? 'manual'] : '对齐已失效'} · ${cue.tokens.length} 词` : '尚未对齐'}</span><div className="director-cue-alignment-actions"><Button density="compact" variant="subtle" disabled={props.busy || !cue.text.trim()} onClick={() => run(() => props.onAlign(cue.id))}><WandSparkles size={13} />估算逐词时间</Button>{props.onImportTimestamps ? <Button density="compact" variant="subtle" disabled={props.busy || !cue.text.trim()} onClick={() => run(() => props.onImportTimestamps?.(cue.id))}><Upload size={13} />导入识别时间戳</Button> : null}</div></div>
      {cue.tokens?.length ? <div className="director-cue-tokens" aria-label="逐词时间预览">{cue.tokens.map((token, index) => <Button key={`${cue.id}-${index}`} density="compact" variant="subtle" title={`${((token.startMs - props.shotStartMs) / 1000).toFixed(3)}–${((token.endMs - props.shotStartMs) / 1000).toFixed(3)} 秒`} onClick={() => props.onSeek(token.startMs)}>{token.text}</Button>)}</div> : null}
    </> : <div className="director-inspector-note">当前镜头没有字幕。新增一句后即可编辑。</div>}
    {error ? <div className="director-inspector-note is-warning" role="alert">{error}</div> : null}
    <SelectField label="字幕样式" value={props.style} disabled={props.busy} options={[{ value: '简体中文 · 白色描边', label: '简体中文 · 白色描边' }, { value: '简体中文 · 下方黑底', label: '简体中文 · 下方黑底' }]} onChange={(event) => props.onStyleChange(event.target.value)} />
    <CheckboxField label="显示安全区提示" checked={props.safeAreaVisible} onChange={(_, data) => props.onSafeAreaChange(Boolean(data.checked))} />
    <div className="director-inspector-note"><Flag size={14} /><span>每句独立保存，不增加镜头。估算时间不代表真实语音识别；可导入本地 Whisper/OpenAI JSON、SRT 或 VTT 时间戳。修改文本后需重新生成旁白。</span></div>
  </section>;
}

function CueTimeFields({ cue, shotStartMs, durationMs, disabled, onUpdate }: {
  cue: DirectorSubtitleCue; shotStartMs: number; durationMs: number; disabled: boolean;
  onUpdate: (patch: DirectorSubtitlePatch) => void;
}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setStart(((cue.startMs - shotStartMs) / 1000).toFixed(3));
    setEnd(((cue.endMs - shotStartMs) / 1000).toFixed(3));
    setError('');
  }, [cue.startMs, cue.endMs, shotStartMs]);
  const save = () => {
    const startMs = Math.round(Number(start) * 1000);
    const endMs = Math.round(Number(end) * 1000);
    if (!start.trim() || !end.trim() || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs > durationMs) {
      setError(`时间须位于当前镜头 0–${durationMs / 1000} 秒内，结束晚于开始。`);
      return;
    }
    try { onUpdate({ startMs: shotStartMs + startMs, endMs: shotStartMs + endMs }); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="director-cue-time-editor"><div className="director-two-col"><TextField label="开始（秒）" value={start} disabled={disabled} onChange={(_, data) => setStart(data.value)} /><TextField label="结束（秒）" value={end} disabled={disabled} onChange={(_, data) => setEnd(data.value)} /></div><Button density="compact" variant="subtle" disabled={disabled} onClick={save}>应用时间</Button>{error ? <div role="alert" className="director-inspector-note is-warning">{error}</div> : null}</div>;
}

/** Preserve authored spaces; only highlight verified tokens while the cue is active. */
export function DirectorSubtitlePreview({ cue, timeMs }: { cue: ProductionSubtitleCue; timeMs: number }) {
  if (!cue.tokens?.length || !isSubtitleAlignmentValid(cue)) return <>{cue.text}</>;
  let cursor = 0;
  const content = cue.tokens.map((token, index) => {
    const position = cue.text.indexOf(token.text, cursor);
    if (position < cursor) return null;
    const prefix = cue.text.slice(cursor, position);
    cursor = position + token.text.length;
    return <span key={index}>{prefix}<span className={timeMs >= token.startMs && timeMs < token.endMs ? 'director-subtitle-word is-active' : 'director-subtitle-word'}>{token.text}</span></span>;
  });
  return <>{content}{cue.text.slice(cursor)}</>;
}
