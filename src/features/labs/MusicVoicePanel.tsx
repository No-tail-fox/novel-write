import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, Mic2, RefreshCw, Trash2 } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { MusicVoiceRequest, MusicVoiceState } from '../../shared/music-voice';
import type { MusicDraft } from './music-lab-helpers';
import { Button, Dialog, SelectField, TextAreaField, TextField } from '../../ui';

export function MusicVoicePanel({ api, draft, configured, onClose, onLibraryChanged }: { api: StoryDreamApi; draft: MusicDraft; configured: boolean; onClose: () => void; onLibraryChanged: () => void }) {
  const [state, setState] = useState<MusicVoiceState>({ voices: [], jobs: [] });
  const [selectedId, setSelectedId] = useState(0);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState('流行');
  const [language, setLanguage] = useState('zh');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('20');
  const [audioPath, setAudioPath] = useState('');
  const [verifyPath, setVerifyPath] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  const selected = state.voices.find((voice) => voice.id === selectedId);
  const busy = !!pendingAction;
  const custom = draft.mode === 'custom';
  const prompt = custom ? draft.lyrics : draft.description;
  const ready = selected?.available && draft.mode !== 'sounds' && !!prompt.trim() && (!custom || !!draft.style.trim() && !!draft.title.trim());
  useEffect(() => { mounted.current = true; void loadVoices(); return () => { mounted.current = false; }; }, []);
  useEffect(() => { setVerifyPath(''); setDeleteOpen(false); }, [selectedId, selected?.validationText]);
  async function loadVoices() {
    try { const next = await api.musicLabVoice({ action: 'list' }); if (mounted.current) { setState(next); setSelectedId((id) => id || next.voices[0]?.id || 0); } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function performVoiceAction(input: MusicVoiceRequest) {
    if (lock.current) return; lock.current = true; setPendingAction(input.action); setError('');
    try {
      const next = await api.musicLabVoice(input);
      if (!mounted.current) return;
      setState(next);
      if (input.action === 'validate') { setCreate(false); setSelectedId(next.voices[0]?.id || 0); setAudioPath(''); }
      if (input.action === 'poll') onLibraryChanged();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; if (mounted.current) setPendingAction(''); }
  }
  async function chooseRecording(verification: boolean) {
    if (lock.current) return; lock.current = true; setPendingAction('file'); setError('');
    try {
      const result = await api.importBgmAudio();
      if (result && mounted.current) { if (verification) setVerifyPath(result.path); else setAudioPath(result.path); }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; if (mounted.current) setPendingAction(''); }
  }
  return <Dialog open title="人声克隆与指定人声创作" onOpenChange={(open) => { if (!open && !busy) onClose(); }} actions={<Button disabled={busy} onClick={onClose}>完成</Button>}><div className="music-lab__operation-form">
    <p className="music-lab__hint">属性设置 → 上传源人声 → 朗读验证文本 → 生成人声。人声可能过期，使用前会重新检查。</p>
    <div className="music-lab__inline-actions"><Button icon={<Mic2 size={15} />} disabled={busy} onClick={() => setCreate(!create)}>{create ? '返回声音库' : '创建新人声'}</Button><Button icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void loadVoices()}>读取声音库</Button></div>
    {create ? <>
      <TextField label="人声名称" value={name} onChange={(_, data) => setName(data.value)} />
      <TextAreaField label="声音属性与描述" rows={2} placeholder="如：清亮自然的女声，温柔、轻盈" value={description} onChange={(_, data) => setDescription(data.value)} />
      <div className="music-lab__two-fields"><SelectField label="风格" value={style} onChange={(_, data) => setStyle(data.value)} options={['流行','抒情','摇滚','电子','民谣'].map((value) => ({value,label:value}))} /><SelectField label="演唱语言" value={language} onChange={(_, data) => setLanguage(data.value)} options={[{value:'zh',label:'中文'},{value:'yue',label:'粤语'},{value:'en',label:'英文'}]} /></div>
      <Button icon={<FolderOpen size={15} />} disabled={busy} onClick={() => void chooseRecording(false)}>选择源人声录音</Button>{audioPath && <p className="music-lab__hint">{audioPath.split(/[\\/]/u).pop()}</p>}
      <div className="music-lab__two-fields"><TextField label="有效人声开始（秒）" type="number" min={0} step={0.1} value={start} onChange={(_, data) => setStart(data.value)} /><TextField label="有效人声结束（秒）" type="number" min={0} step={0.1} value={end} onChange={(_, data) => setEnd(data.value)} /></div>
      <p className="music-lab__hint">上传清晰、无明显伴奏的本人录音。普通验证流程按服务文档免费。</p>
      <Button variant="primary" disabled={busy || !configured || !name.trim() || !audioPath || Number(end) <= Number(start) || Number(start) < 0} onClick={() => void performVoiceAction({ action:'validate',audioPath,name,description,style,language,start:Number(start),end:Number(end) })}>{pendingAction === 'validate' ? '提交校验中…' : '开始人声校验'}</Button>
    </> : <>
      <SelectField label="我的人声" value={String(selectedId)} onChange={(_, data) => setSelectedId(Number(data.value))} options={[{value:'0',label:'选择已创建的人声'},...state.voices.map((voice) => ({value:String(voice.id),label:`${voice.name} · ${voice.available ? '可用' : voice.status || '待校验'}`}))]} />
      {!state.voices.length && <p className="music-lab__hint">还没有克隆的人声。创建后按服务返回的文字录制二次验证音频。</p>}
      {selected && <>
        <p className="music-lab__hint">{selected.description || selected.name} · {selected.available ? '已验证可用' : selected.status}</p>
        <div className="music-lab__inline-actions"><Button density="compact" disabled={busy || !configured} onClick={() => void performVoiceAction({action:'refresh',taskId:selected.id})}>查询进度</Button><Button density="compact" disabled={busy || !configured} onClick={() => void performVoiceAction({action:'check',taskId:selected.id})}>检查可用性</Button><Button density="compact" disabled={busy || !configured} icon={<Trash2 size={13} />} onClick={() => setDeleteOpen(true)}>删除人声</Button></div>
        {selected.error && <p className="music-lab__error">{selected.error}</p>}
        {!selected.available && <>
          <TextAreaField label="二次验证：请朗读以下文字" value={selected.validationText || '源人声校验完成后，点击查询进度获取验证文字。'} readOnly rows={4} />
          <Button density="compact" disabled={busy || !configured} onClick={() => void performVoiceAction({action:'regenerate',taskId:selected.id})}>重新获取验证文字</Button>
          <Button icon={<FolderOpen size={15} />} disabled={busy || !selected.validationText} onClick={() => void chooseRecording(true)}>选择验证录音</Button>{verifyPath && <p className="music-lab__hint">{verifyPath.split(/[\\/]/u).pop()}</p>}
          <Button variant="primary" disabled={busy || !configured || !verifyPath || !selected.validationText} onClick={() => void performVoiceAction({action:'verify',taskId:selected.id,audioPath:verifyPath})}>{pendingAction === 'verify' ? '提交中…' : '提交验证录音并创建人声'}</Button>
        </>}
        {selected.available && <><div className="music-lab__voice-ready"><Check size={17} /><span>将使用创作面板中的{custom ? '标题、歌词与风格' : '歌曲描述'}。</span></div><p className="music-lab__hint">{ready ? `${draft.title || '新歌曲'} · ${prompt.slice(0,120)}` : '先在简易或高级模式填写描述或完整歌词；高级模式还需要标题和风格。'}</p><Button variant="primary" disabled={busy || !configured || !ready} onClick={() => void performVoiceAction({action:'generate',taskId:selected.id,model:draft.model,prompt,custom,style:draft.style,title:draft.title,maxMode:draft.maxMode,variety:draft.variety,styleWeight:draft.styleWeight,weirdness:draft.weirdness})}>{pendingAction === 'generate' ? '提交中…' : `用此人声生成 · ¥${draft.maxMode ? '2.40' : '1.20'}`}</Button></>}
      </>}
    </>}
    {state.jobs.length > 0 && <section><h4>人声歌曲生成记录</h4>{state.jobs.map((job) => <div className="music-lab__voice-job" key={job.id}><strong>{job.title}</strong><span>{({processing:'生成中',completed:'已完成',partial:'部分完成','needs-recovery':'待核对',failed:'失败',submitting:'提交中'} as Record<string,string>)[job.status] || job.status}</span><Button density="compact" disabled={busy || !job.requestId || !configured} onClick={() => void performVoiceAction({action:'poll',jobId:job.id})}>查询歌曲</Button>{job.error && <p className="music-lab__error">{job.error}</p>}</div>)}</section>}
    {error && <p className="music-lab__error" role="alert">{error}</p>}
    <p className="music-lab__hint">网站的 ¥20 自动克隆需要网页登录。这里采用公开 API 的源录音与二次录音验证流程。</p>
  </div><Dialog open={deleteOpen} title="删除这个克隆人声？" onOpenChange={setDeleteOpen} actions={<><Button onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="danger" disabled={busy || !configured || !selected} onClick={() => { setDeleteOpen(false); if (selected) void performVoiceAction({action:'delete',taskId:selected.id}); }}>删除人声</Button></>}><p>删除后不能再选择这个人声生成新歌曲。</p></Dialog></Dialog>;
}
