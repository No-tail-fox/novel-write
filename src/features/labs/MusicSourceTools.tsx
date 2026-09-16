import { useEffect, useRef, useState } from 'react';
import { AudioLines, FolderOpen, Loader2, Upload } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { MUSIC_MODELS, type MusicLabRecord, type MusicModel, type MusicTrack } from '../../shared/music-lab';
import { estimateMusicOperationCost, MUSIC_OPERATION_LABELS, musicOperationInputSchema, type MusicOperation, type MusicOperationInput } from '../../shared/music-operations';
import { Button, CheckboxField, Dialog, SegmentedControl, SelectField, SliderField, TextAreaField, TextField } from '../../ui';
import './music-source-tools.css';
import { MusicStylePickerButton } from './MusicStylePicker';

export interface MusicSourceToolsProps {
  open: boolean;
  initialMode?: 'operation' | 'upload';
  initialOperation?: MusicOperation;
  api: StoryDreamApi;
  records: MusicLabRecord[];
  selected?: { record: MusicLabRecord; track?: MusicTrack };
  configured: boolean;
  onRecord: (record: MusicLabRecord) => void;
  onClose: () => void;
}

export const musicOperationGroups = [
  { value: 'creative', label: '生成与改编', operations: ['cover', 'extend', 'replace', 'add-instrumental', 'add-vocal', 'add-stem', 'mashup', 'sample', 'inspo'] },
  { value: 'editing', label: '歌曲剪辑', operations: ['crop', 'remove-section', 'fade', 'reverse', 'speed'] },
  { value: 'stems', label: '人声与分轨', operations: ['vocal-removal', 'separate'] },
] as const;
const creativeOperations = new Set<MusicOperation>(musicOperationGroups[0].operations);
const rangeOperations = new Set<MusicOperation>(['replace', 'sample', 'crop', 'remove-section']);
const operationHints: Record<MusicOperation, string> = {
  cover: '保留来源音乐的表达，重新演绎曲风与编配。', extend: '从指定时间继续创作。生成结果可能是续写片段。',
  replace: '重新创作指定区间，可用前后文歌词帮助衔接。', 'add-instrumental': '为来源音频增加伴奏编配。',
  'add-vocal': '用填写的歌词为来源音乐增加演唱。', 'add-stem': '按乐器指令为来源歌曲增加一个声部。',
  mashup: '选择两首不同歌曲，融合它们的音乐元素。', sample: '以指定音频片段为采样，创作新的音乐。',
  inspo: '从一至两首来源歌曲获得风格与编配灵感。', crop: '保留所选区间，另存为新的音频。',
  'remove-section': '移除指定区间，保留其余部分。', fade: '给歌曲添加淡入或淡出。', reverse: '生成倒放版本。',
  speed: '改变整首歌的播放速度，可选择保持音高。', separate: '将歌曲分离为人声与伴奏，或更多乐器声部。',
  'vocal-removal': '免费快捷分离人声与伴奏，候选数量以实际结果为准。',
};

export interface MusicSourceDraft {
  operation: MusicOperation; model: MusicModel; source: string; secondSource: string;
  title: string; lyrics: string; style: string; negativeStyle: string;
  startSeconds: string; endSeconds: string; continueAt: string; durationSec: string;
  contextLyrics: string; contextWindowLyrics: string; stemControlTags: string;
  direction: 'in' | 'out'; speedMultiplier: string; keepPitch: boolean; stemMode: 'two' | 'twelve';
  instrumental: boolean; maxMode: boolean; variety: number; audioWeight: number; styleWeight: number; weirdness: number;
}
export const defaultMusicSourceDraft: MusicSourceDraft = {
  operation: 'cover', model: 'suno-v6', source: '', secondSource: '', title: '', lyrics: '', style: '', negativeStyle: '',
  startSeconds: '0', endSeconds: '', continueAt: '', durationSec: '', contextLyrics: '', contextWindowLyrics: '',
  stemControlTags: '', direction: 'out', speedMultiplier: '1', keepPitch: true, stemMode: 'twelve',
  instrumental: false, maxMode: false, variety: 1, audioWeight: 0.5, styleWeight: 0.5, weirdness: 0.5,
};
export function musicSourceCandidates(records: readonly MusicLabRecord[]) {
  return records.flatMap((record) => record.tracks.filter((track) => track.status === 'completed' && track.songId && !track.songId.startsWith('pending:'))
    .map((track) => ({ value: `${record.id}/${track.id}`, record, track, label: `${track.title || '未命名音频'} · ${record.model}${track.durationSec ? ` · ${Math.round(track.durationSec)} 秒` : ''}` })));
}
function numeric(value: string): number { return value.trim() ? Number(value) : NaN; }
export function buildMusicSourceOperation(draft: MusicSourceDraft, records: readonly MusicLabRecord[]): { input?: MusicOperationInput; issue: string } {
  const candidates = musicSourceCandidates(records);
  const first = candidates.find((item) => item.value === draft.source);
  const second = candidates.find((item) => item.value === draft.secondSource);
  if (!first) return { issue: '请选择已完成的来源音频，或先上传本地音频。' };
  const needsTwo = draft.operation === 'mashup';
  if (needsTwo && !second) return { issue: '融合两曲需要选择第二首来源歌曲。' };
  if ((needsTwo || draft.operation === 'inspo') && draft.secondSource && !second) return { issue: '第二首来源音频不可用，请重新选择。' };
  const selected = [first, ...((needsTwo || draft.operation === 'inspo') && second ? [second] : [])];
  if (selected.length === 2 && (first.value === second?.value || first.track.songId === second?.track.songId)) return { issue: '请选择两首不同的来源歌曲。' };
  const duration = first.track.durationSec;
  if (rangeOperations.has(draft.operation)) {
    const start = numeric(draft.startSeconds); const end = numeric(draft.endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return { issue: '填写有效区间：开始不小于 0，结束晚于开始。' };
    if (duration && end > duration) return { issue: `区间不能超出来源音频时长 ${duration.toFixed(2)} 秒。` };
  }
  if (draft.operation === 'extend' && (!Number.isFinite(numeric(draft.continueAt)) || numeric(draft.continueAt) < 0 || (duration && numeric(draft.continueAt) > duration))) return { issue: '请填写原音频时长内的续写起点。' };
  if (draft.operation === 'fade' && duration && numeric(draft.durationSec) > duration) return { issue: '淡入淡出时长不能超过来源音频。' };
  if (draft.operation === 'fade' && (!Number.isFinite(numeric(draft.durationSec)) || numeric(draft.durationSec) <= 0)) return { issue: '淡入淡出时长必须大于 0 秒。' };
  if (draft.operation === 'add-instrumental' && draft.durationSec.trim() && (!Number.isInteger(numeric(draft.durationSec)) || numeric(draft.durationSec) < 1 || numeric(draft.durationSec) > 480)) return { issue: '目标时长需要填写 1 至 480 的整数秒数。' };
  if (draft.operation === 'speed' && (!Number.isFinite(numeric(draft.speedMultiplier)) || numeric(draft.speedMultiplier) <= 0 || Math.abs(numeric(draft.speedMultiplier) * 10000 - Math.round(numeric(draft.speedMultiplier) * 10000)) > 0.000001)) return { issue: '速度倍数必须大于 0，最多保留 4 位小数。' };
  if (draft.operation === 'cover' && !draft.style.trim()) return { issue: '请填写翻唱改编的音乐风格。' };
  if (['replace', 'add-vocal'].includes(draft.operation) && !draft.lyrics.trim()) return { issue: '请填写本次创作使用的歌词。' };
  if (draft.operation === 'add-stem' && !draft.stemControlTags.trim()) return { issue: '请填写要添加的乐器与演奏方式。' };
  const raw: Record<string, unknown> = {
    operation: draft.operation, model: draft.model,
    sources: selected.map((item) => ({ recordId: item.record.id, trackId: item.track.id })),
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
  };
  if (creativeOperations.has(draft.operation)) Object.assign(raw, {
    ...(draft.lyrics.trim() ? { lyrics: draft.lyrics.trim() } : {}),
    ...(draft.style.trim() ? { style: draft.style.trim() } : {}),
    ...(draft.negativeStyle.trim() ? { negativeStyle: draft.negativeStyle.trim() } : {}),
    maxMode: draft.maxMode, variety: draft.variety,
  });
  if (rangeOperations.has(draft.operation)) Object.assign(raw, { startSeconds: numeric(draft.startSeconds), endSeconds: numeric(draft.endSeconds) });
  if (['cover', 'mashup', 'inspo'].includes(draft.operation)) raw.instrumental = draft.instrumental;
  if (['cover', 'add-instrumental'].includes(draft.operation)) raw.audioWeight = draft.audioWeight;
  if (draft.operation === 'cover') Object.assign(raw, { styleWeight: draft.styleWeight, weirdness: draft.weirdness });
  if (draft.operation === 'extend') raw.continueAt = numeric(draft.continueAt);
  if (draft.operation === 'replace') Object.assign(raw, {
    ...(draft.contextLyrics.trim() ? { contextLyrics: draft.contextLyrics.trim() } : {}),
    ...(draft.contextWindowLyrics.trim() ? { contextWindowLyrics: draft.contextWindowLyrics.trim() } : {}),
  });
  if (draft.operation === 'add-stem') raw.stemControlTags = draft.stemControlTags.trim();
  if (draft.operation === 'add-instrumental' && draft.durationSec.trim()) raw.durationSec = numeric(draft.durationSec);
  if (draft.operation === 'fade') Object.assign(raw, { direction: draft.direction, durationSec: numeric(draft.durationSec) });
  if (draft.operation === 'speed') Object.assign(raw, { speedMultiplier: numeric(draft.speedMultiplier), keepPitch: draft.keepPitch });
  if (draft.operation === 'separate') raw.stemMode = draft.stemMode;
  const result = musicOperationInputSchema.safeParse(raw);
  return result.success ? { input: result.data, issue: '' } : { issue: result.error.issues[0]?.message || '请检查本次操作的参数。' };
}

export function MusicSourceTools({ open, initialMode = 'operation', initialOperation = 'cover', api, records, selected, configured, onRecord, onClose }: MusicSourceToolsProps) {
  const [mode, setMode] = useState<'operation' | 'upload'>(initialMode);
  const [draft, setDraft] = useState<MusicSourceDraft>({ ...defaultMusicSourceDraft });
  const [upload, setUpload] = useState<{ audioPath: string; title: string; fileName: string }>({ audioPath: '', title: '', fileName: '' });
  const [pendingAction, setPendingAction] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const wasOpen = useRef(false);
  const mounted = useRef(true);
  const candidates = musicSourceCandidates(records);
  const source = candidates.find((item) => item.value === draft.source);
  const group = musicOperationGroups.find((item) => (item.operations as readonly string[]).includes(draft.operation)) ?? musicOperationGroups[0];
  const built = buildMusicSourceOperation(draft, records);
  const creative = creativeOperations.has(draft.operation);
  const hasSecond = draft.operation === 'mashup' || draft.operation === 'inspo';
  const busy = !!pendingAction;
  const cost = built.input ? estimateMusicOperationCost(built.input) : draft.operation === 'vocal-removal' ? 0 : draft.operation === 'separate' ? (draft.stemMode === 'twelve' ? 3 : 0.6) : creative && draft.maxMode ? 1.2 : 0.6;
  const issue = !configured ? '音乐服务尚未配置，请先连接服务。' : mode === 'upload' ? (upload.audioPath ? '' : '先选择要上传的音频。') : built.issue;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode(initialMode); setError('');
      const candidate = selected?.track && candidates.find((item) => item.record.id === selected.record.id && item.track.id === selected.track?.id);
      setDraft((current) => ({ ...current, operation: initialOperation,
        ...(candidate ? { source: candidate.value, model: candidate.record.model, title: candidate.track.title, lyrics: candidate.track.lyrics, style: candidate.track.style,
          endSeconds: candidate.track.durationSec ? String(candidate.track.durationSec) : '', continueAt: candidate.track.durationSec ? String(candidate.track.durationSec) : '' } : {}),
      }));
    }
    wasOpen.current = open;
  }, [open, initialMode, initialOperation, selected, candidates]);

  function patch(value: Partial<MusicSourceDraft>) { setDraft((current) => ({ ...current, ...value })); setError(''); }
  function chooseSource(value: string) {
    const next = candidates.find((item) => item.value === value);
    patch({ source: value, ...(next ? { title: next.track.title, lyrics: next.track.lyrics, style: next.track.style,
      startSeconds: '0', endSeconds: next.track.durationSec ? String(next.track.durationSec) : '', continueAt: next.track.durationSec ? String(next.track.durationSec) : '' } : {}) });
  }
  async function selectAudio() {
    if (lock.current) return;
    lock.current = true; setPendingAction('select'); setError('');
    try {
      const imported = await api.importBgmAudio();
      if (imported && mounted.current) setUpload({ audioPath: imported.path, title: imported.title, fileName: imported.title });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; if (mounted.current) setPendingAction(''); }
  }
  async function submitOperation() {
    if (lock.current || !built.input || !configured) return;
    lock.current = true; setPendingAction('operation'); setError('');
    try {
      const result = await api.performMusicLabOperation(built.input);
      onRecord(result);
      if (!mounted.current) return;
      if (result.status === 'failed' || result.status === 'needs-recovery') setError(result.errorMessage || '创作未能完成，请在作品库核对记录。');
      else onClose();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; if (mounted.current) setPendingAction(''); }
  }
  async function uploadSource() {
    if (lock.current || !upload.audioPath || !configured) return;
    lock.current = true; setPendingAction('upload'); setError('');
    try {
      const result = await api.uploadMusicLabSource({ audioPath: upload.audioPath, title: upload.title, model: draft.model });
      onRecord(result);
      if (!mounted.current) return;
      if (result.status === 'failed' || result.status === 'needs-recovery') setError(result.errorMessage || '上传未能完成，请在作品库核对记录。');
      else onClose();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; if (mounted.current) setPendingAction(''); }
  }

  return <Dialog open={open} title="音频与歌曲工具" onOpenChange={(next) => { if (!next && !busy) onClose(); }} actions={<>
    <Button disabled={busy} onClick={onClose}>取消</Button>
    {mode === 'upload' ? <Button variant="primary" icon={pendingAction === 'upload' ? <Loader2 size={15} className="music-source-tools__spin" /> : <Upload size={15} />} disabled={busy || !!issue} onClick={() => void uploadSource()}>{pendingAction === 'upload' ? '正在上传…' : '上传为来源音频'}</Button>
      : <Button variant="primary" icon={pendingAction === 'operation' ? <Loader2 size={15} className="music-source-tools__spin" /> : <AudioLines size={15} />} disabled={busy || !!issue} onClick={() => void submitOperation()}>{pendingAction === 'operation' ? '正在提交…' : `开始${MUSIC_OPERATION_LABELS[draft.operation]}`}</Button>}
  </>}>
    <div className="music-source-tools" data-music-source-tools>
      <SegmentedControl label="音乐工具" value={mode} disabled={busy} onChange={(value) => { setMode(value); setError(''); }} options={[{ value: 'operation', label: '歌曲再创作' }, { value: 'upload', label: '上传音频' }]} />
      <SelectField label="生成模型" disabled={busy} value={draft.model} onChange={(_, data) => patch({ model: data.value as MusicModel })} options={MUSIC_MODELS.map((value) => ({ value, label: value.replace('suno-', 'Suno ').toUpperCase() }))} />
      {mode === 'upload' ? <div className="music-source-tools__upload">
        <p>上传本地歌曲、人声或旋律，保存为后续翻唱、续写与采样的来源音频。</p>
        <Button icon={<FolderOpen size={15} />} disabled={busy} onClick={() => void selectAudio()}>{pendingAction === 'select' ? '正在选择…' : '选择本地音频'}</Button>
        {upload.fileName && <p className="music-source-tools__file">已选择：{upload.fileName}</p>}
        <TextField label="音频名称（选填）" value={upload.title} maxLength={200} disabled={busy} onChange={(_, data) => setUpload((current) => ({ ...current, title: data.value }))} />
        <p className="music-source-tools__hint">来源上传免费；后续生成按所选操作计费。支持 MP3、WAV、M4A、AAC、OGG、FLAC。</p>
      </div> : <>
        <div className="music-source-tools__pair">
          <SelectField label="工具分组" value={group.value} disabled={busy} onChange={(_, data) => { const next = musicOperationGroups.find((item) => item.value === data.value); if (next) patch({ operation: next.operations[0] }); }} options={musicOperationGroups.map(({ value, label }) => ({ value, label }))} />
          <SelectField label="操作" value={draft.operation} disabled={busy} onChange={(_, data) => patch({ operation: data.value as MusicOperation })} options={group.operations.map((value) => ({ value, label: MUSIC_OPERATION_LABELS[value] }))} />
        </div>
        <p className="music-source-tools__hint">{operationHints[draft.operation]}</p>
        <SelectField label="来源歌曲" value={draft.source} disabled={busy} onChange={(_, data) => chooseSource(data.value)} options={[{ value: '', label: candidates.length ? '选择来源音频' : '暂无可用来源，请先上传音频' }, ...candidates.map(({ value, label }) => ({ value, label }))]} />
        {hasSecond && <SelectField label={draft.operation === 'mashup' ? '第二首来源歌曲' : '第二首来源（选填）'} value={draft.secondSource} disabled={busy} onChange={(_, data) => patch({ secondSource: data.value })} options={[{ value: '', label: draft.operation === 'mashup' ? '选择另一首歌曲' : '不使用第二首' }, ...candidates.filter((item) => item.track.songId !== source?.track.songId).map(({ value, label }) => ({ value, label }))]} />}
        <TextField label="新作品标题（选填）" maxLength={200} value={draft.title} disabled={busy} onChange={(_, data) => patch({ title: data.value })} />
        {rangeOperations.has(draft.operation) && <div className="music-source-tools__pair">
          <TextField label="开始时间（秒）" type="number" min={0} step={0.01} value={draft.startSeconds} disabled={busy} onChange={(_, data) => patch({ startSeconds: data.value })} />
          <TextField label="结束时间（秒）" type="number" min={0} step={0.01} value={draft.endSeconds} disabled={busy} onChange={(_, data) => patch({ endSeconds: data.value })} />
        </div>}
        {draft.operation === 'extend' && <TextField label="续写起点（秒）" type="number" min={0} step={0.01} value={draft.continueAt} disabled={busy} onChange={(_, data) => patch({ continueAt: data.value })} />}
        {creative && <>
          <TextAreaField label={draft.operation === 'replace' ? '替换片段的歌词' : draft.operation === 'add-vocal' ? '演唱歌词' : '歌词 / 创作要求（选填）'} value={draft.lyrics} maxLength={30000} rows={5} disabled={busy} onChange={(_, data) => patch({ lyrics: data.value })} />
          <TextAreaField label={draft.operation === 'cover' ? '目标音乐风格' : '音乐风格（选填）'} value={draft.style} maxLength={5000} rows={3} disabled={busy} onChange={(_, data) => patch({ style: data.value })} />
          <MusicStylePickerButton value={draft.style} disabled={busy} onChange={style => patch({ style })} />
          {draft.operation === 'add-stem' && <TextField label="乐器与演奏指令" hint="例如：warm piano, gentle arpeggio" value={draft.stemControlTags} maxLength={120} disabled={busy} onChange={(_, data) => patch({ stemControlTags: data.value })} />}
          {draft.operation === 'add-instrumental' && <TextField label="目标时长（秒，选填）" type="number" min={1} max={480} step={1} value={draft.durationSec} disabled={busy} onChange={(_, data) => patch({ durationSec: data.value })} />}
          {['cover', 'mashup', 'inspo'].includes(draft.operation) && <CheckboxField label="生成纯音乐" checked={draft.instrumental} disabled={busy} onChange={(_, data) => patch({ instrumental: data.checked === true })} />}
          <details className="music-source-tools__advanced"><summary>更多创作参数</summary><div>
            <TextField label="排除风格（选填）" maxLength={5000} value={draft.negativeStyle} disabled={busy} onChange={(_, data) => patch({ negativeStyle: data.value })} />
            {['cover', 'add-instrumental'].includes(draft.operation) && <SliderField label="来源音频影响" min={0} max={1} step={0.05} value={draft.audioWeight} valueLabel={`${Math.round(draft.audioWeight * 100)}%`} disabled={busy} onChange={(_, data) => patch({ audioWeight: data.value })} />}
            {draft.operation === 'cover' && <>
              <SliderField label="风格影响" min={0} max={1} step={0.05} value={draft.styleWeight} valueLabel={`${Math.round(draft.styleWeight * 100)}%`} disabled={busy} onChange={(_, data) => patch({ styleWeight: data.value })} />
              <SliderField label="随机度" min={0} max={1} step={0.05} value={draft.weirdness} valueLabel={`${Math.round(draft.weirdness * 100)}%`} disabled={busy} onChange={(_, data) => patch({ weirdness: data.value })} />
            </>}
            {draft.operation === 'replace' && <>
              <TextAreaField label="完整上下文歌词（选填）" rows={3} maxLength={30000} value={draft.contextLyrics} disabled={busy} onChange={(_, data) => patch({ contextLyrics: data.value })} />
              <TextAreaField label="片段附近歌词（选填）" rows={3} maxLength={30000} value={draft.contextWindowLyrics} disabled={busy} onChange={(_, data) => patch({ contextWindowLyrics: data.value })} />
            </>}
            <SelectField label="多样性" value={String(draft.variety)} disabled={busy} onChange={(_, data) => patch({ variety: Number(data.value) })} options={[0, 1, 2, 3, 4].map((value) => ({ value: String(value), label: value === 1 ? '1 · 默认' : String(value) }))} />
            <CheckboxField label="Max Mode · 双倍费用" checked={draft.maxMode} disabled={busy} onChange={(_, data) => patch({ maxMode: data.checked === true })} />
          </div></details>
        </>}
        {draft.operation === 'fade' && <div className="music-source-tools__pair"><SelectField label="方向" value={draft.direction} disabled={busy} options={[{ value: 'in', label: '淡入' }, { value: 'out', label: '淡出' }]} onChange={(_, data) => patch({ direction: data.value as 'in' | 'out' })} /><TextField label="淡入淡出时长（秒）" type="number" min={0.01} step={0.1} value={draft.durationSec} disabled={busy} onChange={(_, data) => patch({ durationSec: data.value })} /></div>}
        {draft.operation === 'speed' && <><TextField label="速度倍数" hint="1 为原速，最多 4 位小数。" type="number" min={0.0001} step={0.1} value={draft.speedMultiplier} disabled={busy} onChange={(_, data) => patch({ speedMultiplier: data.value })} /><CheckboxField label="保持音高" checked={draft.keepPitch} disabled={busy} onChange={(_, data) => patch({ keepPitch: data.checked === true })} /></>}
        {draft.operation === 'separate' && <SelectField label="分轨方式" value={draft.stemMode} disabled={busy} options={[{ value: 'two', label: '人声与伴奏 · 预计 ¥0.60' }, { value: 'twelve', label: '多乐器分轨 · 预计 ¥3.00' }]} onChange={(_, data) => patch({ stemMode: data.value as 'two' | 'twelve' })} />}
        <div className="music-source-tools__cost"><span>本次预计费用</span><strong>{cost === 0 ? '免费' : `¥${cost.toFixed(2)}`}</strong></div>
        <p className="music-source-tools__hint">结果作为新作品保存在音乐库。实际扣费以服务账单为准。</p>
      </>}
      {error ? <p className="music-source-tools__error" role="alert">{error}</p> : issue ? <p className="music-source-tools__hint" role="status">{issue}</p> : null}
    </div>
  </Dialog>;
}
