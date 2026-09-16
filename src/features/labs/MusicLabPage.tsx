import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, ChevronRight, Clapperboard, CloudDownload, Download, FolderOpen, Headphones, Library, Loader2, Music2, Pause, Play, RefreshCw, RotateCcw, Search, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Star, Upload, Wand2 } from 'lucide-react';
import type { ApplyMutationResult } from '../../app/route-types';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppConfig } from '../../shared/types';
import { estimateMusicCost, type MusicLabRecord, type MusicModel, type MusicServiceStatus, type MusicMediaFormat } from '../../shared/music-lab';
import { Button, CheckboxField, Dialog, IconButton, SegmentedControl, SelectField, SliderField, TextAreaField, TextField } from '../../ui';
import { toLocalAssetUrl } from '../tasks/task-formatters';
import { defaultMusicDraft, musicDraftInput, musicDraftIssue, musicLibraryRows, musicRecordDraft, musicTime, type MusicDraft } from './music-lab-helpers';
import './music-lab.css';
import { MusicSourceTools, musicOperationGroups } from './MusicSourceTools';
import { MUSIC_OPERATION_LABELS, type MusicOperation } from '../../shared/music-operations';
import { MusicVoicePanel } from './MusicVoicePanel';
import { MusicEnhancedPanel } from './MusicEnhancedPanel';
import { PlatformMusicControls } from './PlatformMusicControls';
import { useCommercialSnapshot } from '../account/useCommercialSnapshot';
import { formatCredits } from '../../shared/commercial-contract';

const statusLabels = { submitting: '提交中', pending: '排队中', processing: '创作中', completed: '已完成', partial: '部分完成', failed: '失败', 'needs-recovery': '待核对' } as const;
const inspirations = [
  { title: '纪录片配乐', icon: Headphones, prompt: '为一段关于城市记忆的纪录片创作温暖而克制的配乐。柔和钢琴与弦乐，缓慢铺陈，在中段增加层次，为旁白留出空间。', instrumental: true },
  { title: '中文流行', icon: Music2, prompt: '一首关于离开故乡、在陌生城市重新出发的中文流行歌。温暖的人声，木吉他与轻鼓点，主歌像讲故事，副歌有希望感、容易跟唱。', instrumental: false },
  { title: '氛围电子', icon: AudioLines, prompt: '夜晚雨中的未来城市，氛围电子音乐，细腻合成器与低频脉冲，安静、空灵、有电影感，适合作为视觉短片背景。', instrumental: true },
];
const styles = ['流行', '电影配乐', 'Lo-fi', '电子', '民谣', '国风'];
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function MusicLabPage({ api, applyState, onUseInMv, musicConfig, openSettings }: {
  api: StoryDreamApi; applyState: ApplyMutationResult;
  musicConfig?: AppConfig['music']; openSettings?: () => void;
  onUseInMv: (song: { title: string; lyrics: string; audioPath: string }) => void;
}) {
  const commercial = useCommercialSnapshot(api);
  const activeCommercialMusic = commercial.snapshot?.profiles.profiles.find(item => item.id === commercial.snapshot?.profiles.active.music);
  const platformMusic = activeCommercialMusic?.source === 'platform';
  const platformModel = commercial.snapshot?.catalog.find(item => item.id === activeCommercialMusic?.modelId);
  const byokReady = !platformMusic && !commercial.loading && (!commercial.snapshot?.authenticated || activeCommercialMusic?.source === 'byok');
  const [draft, setDraft] = useState<MusicDraft>(() => {
    const profile = musicConfig?.profiles.find((item) => item.id === musicConfig.activeProfileId);
    return { ...defaultMusicDraft, ...(profile ? { profileId: profile.id, model: profile.model } : {}) };
  });
  const [records, setRecords] = useState<MusicLabRecord[]>([]);
  const [platformOutputHost, setPlatformOutputHost] = useState<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState(() => { try { return sessionStorage.getItem('storydream.music-selected') || ''; } catch { return ''; } });
  const [favoriteIds,setFavoriteIds] = useState<string[]>(() => { try { const values:unknown=JSON.parse(localStorage.getItem('storydream.music-favorites') || '[]');return Array.isArray(values)?values.filter((item):item is string=>typeof item==='string'):[]; }catch{return [];} });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [service, setService] = useState<MusicServiceStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [helperOpen, setHelperOpen] = useState(false);
  const [lyricInstruction, setLyricInstruction] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [operation, setOperation] = useState<MusicOperation | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPath, setUploadPath] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadMode,setUploadMode] = useState('normal');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<MusicMediaFormat>('lrc');
  const [serviceOpen,setServiceOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playAfterDownload = useRef('');
  const currentSelection = useRef(selectedId);
  currentSelection.current = selectedId;
  const mounted = useRef(false);
  const actionLock = useRef(false);
  const listSequence = useRef(0);
  const inputRevision = useRef(0);
  const allRows = musicLibraryRows(records);
  const rows = musicLibraryRows(records, query, filter, sort).filter((row)=>filter!=='favorites'||favoriteIds.includes(row.id));
  const playableRows = rows.filter((row) => row.track?.audioUrl || row.track?.localMp3Path || row.track?.localWavPath);
  const playbackIndex = playableRows.findIndex((row) => row.id === selectedId);
  const selected = allRows.find((item) => item.id === selectedId);
  const track = selected?.track;
  const record = selected?.record;
  const localPath = track?.localMp3Path || track?.localWavPath;
  const audioSource = localPath ? toLocalAssetUrl(localPath) : undefined;
  const issue = musicDraftIssue(draft);
  const cost = estimateMusicCost(musicDraftInput(draft));
  const activeCount = records.filter((item) => ['submitting', 'processing'].includes(item.status) || (item.status === 'needs-recovery' && item.tracks.some((candidate) => !['completed', 'failed'].includes(candidate.status)))).length;
  const busy = !!pendingAction;
  const profileSignature = JSON.stringify([musicConfig, commercial.snapshot?.user?.id, activeCommercialMusic?.localProfileId]);

  const draftGuard = useWorkspaceDraft({ id: 'music-lab-create', label: '音乐创作草稿', value: draft, restore: setDraft, busy });
  function patchDraft(patch: Partial<MusicDraft>) { inputRevision.current++; setDraft((current) => ({ ...current, ...patch })); }
  function updateRecord(next: MusicLabRecord) {
    listSequence.current++;
    setRecords((current) => [next, ...current.filter((item) => item.id !== next.id)]);
  }
  const refreshLibrary = useCallback(async () => {
    const sequence = ++listSequence.current;
    try {
      const next = await api.listMusicLabRecords();
      if (mounted.current && sequence === listSequence.current) setRecords(next);
    } catch (cause) { if (mounted.current && sequence === listSequence.current) setError(messageOf(cause)); }
    finally { if (mounted.current) setLoading(false); }
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setService(null); setBalance(null); setLoading(true); setRecords([]);
    void refreshLibrary();
    void api.getMusicLabServiceStatus().then((next) => {
      if (cancelled || !mounted.current) return;
      setService(next);
      if (next.profileId && next.defaultModel) setDraft((current) => current.profileId === next.profileId ? current : { ...current, profileId: next.profileId!, model: next.defaultModel! });
    }).catch((cause) => { if (!cancelled && mounted.current) setError(messageOf(cause)); });
    const focus = () => { void refreshLibrary(); };
    window.addEventListener('focus', focus);
    return () => { cancelled = true; mounted.current = false; listSequence.current++; window.removeEventListener('focus', focus); };
  }, [api, refreshLibrary, profileSignature]);
  useEffect(() => {
    if (!activeCount) return;
    const timer = window.setInterval(() => { void refreshLibrary(); }, 4000);
    return () => window.clearInterval(timer);
  }, [activeCount, refreshLibrary]);
  useEffect(() => { setPlaying(false); setCurrentTime(0); setDuration(0); }, [selectedId, audioSource]);
  useEffect(() => { try { sessionStorage.setItem('storydream.music-selected',selectedId); } catch { /* Selection still works in memory. */ } }, [selectedId]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume, audioSource]);
  useEffect(() => {
    if (!audioSource || playAfterDownload.current !== selectedId) return;
    playAfterDownload.current = '';
    void audioRef.current?.play().catch(() => setError('音频已保存，请点击播放试听。'));
  }, [audioSource, selectedId]);

  async function runAction(name: string, operation: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setPendingAction(name); setError(''); setNotice('');
    try { await operation(); } catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { actionLock.current = false; if (mounted.current) setPendingAction(''); }
  }
  async function generateMusic() {
    if (platformMusic) return;
    if (issue || !service?.configured) return;
    const snapshot = draftGuard.snapshot();
    await runAction('generate', async () => {
      const next = await api.generateMusicLab(musicDraftInput(snapshot));
      if (!mounted.current) return;
      updateRecord(next); setSelectedId(next.tracks[0]?.id ?? next.id);
      draftGuard.complete(snapshot);
      setNotice(next.status === 'failed' || next.status === 'needs-recovery' ? next.errorMessage : '任务已保存，生成完成后会出现在作品库中。');
      setBalance(null);
    });
  }
  async function generateLyrics() {
    const revision = inputRevision.current;
    await runAction('lyrics', async () => {
      const result = await api.generateMusicLabLyrics({ model: draft.model, instruction: lyricInstruction, style: draft.style, title: draft.title });
      if (!mounted.current) return;
      if (revision !== inputRevision.current) { setNotice('草稿已更新，请重新生成歌词以免覆盖修改。'); return; }
      patchDraft({ lyrics: result.lyrics, mode: 'custom', instrumental: false }); setHelperOpen(false);
      setNotice('歌词已填入，可继续修改后再创作。');
    });
  }
  async function boostStyle() {
    const revision = inputRevision.current;
    await runAction('style', async () => {
      const result = await api.boostMusicLabStyle({ model: draft.model, style: draft.style, lyrics: draft.lyrics, instrumental: draft.instrumental });
      if (mounted.current && revision === inputRevision.current) patchDraft({ style: result.style });
    });
  }
  async function checkBalance() {
    await runAction('balance', async () => { const result = await api.getMusicLabBalance(); if (mounted.current) setBalance(result.balance); });
  }
  async function openServiceSite() {
    await runAction('portal',async()=>{await api.openProviderPortal('https://www.suno-api.io/create/');});
  }
  async function chooseUpload() {
    await runAction('choose-upload', async () => {
      const result = await api.importBgmAudio();
      if (result && mounted.current) { setUploadPath(result.path); setUploadTitle(result.title); }
    });
  }
  async function uploadSource() {
    await runAction('upload', async () => {
      const next = await api.uploadMusicLabSource({ audioPath: uploadPath, title: uploadTitle, model: draft.model });
      if (mounted.current) {
        updateRecord(next); setSelectedId(next.tracks[0]?.id ?? next.id);
        if (next.status === 'failed' || next.status === 'needs-recovery') throw new Error(next.errorMessage || '上传未完成，请先核对任务记录。');
        setUploadOpen(false); setNotice('源音频已上传，可在歌曲工具中翻唱、续写或分轨。');
      }
    });
  }
  async function syncHistory() {
    await runAction('sync', async () => {
      const result = await api.syncMusicLabHistory();
      if (mounted.current) { listSequence.current++; setRecords(result.records); setNotice(`云端曲库已同步，新增 ${result.added} 首，更新 ${result.updated} 首。`); }
    });
  }
  async function refreshSelected() {
    await runAction('refresh', async () => {
      if (record) { const next = await api.refreshMusicLabRecord(record.id); if (mounted.current) updateRecord(next); }
      else await refreshLibrary();
    });
  }
  async function downloadTrack(format: MusicMediaFormat) {
    if (!record || !track) return;
    await runAction(`download-${format}`, async () => {
      const next = await api.downloadMusicLabTrack({ recordId: record.id, trackId: track.id, format });
      if (mounted.current) {
        updateRecord(next);
        const saved = next.tracks.find((item) => item.id === track.id);
        if (!(format === 'mp3' ? saved?.localMp3Path : format === 'wav' ? saved?.localWavPath : saved?.mediaPaths?.[format])) throw new Error(saved?.downloadError || '文件下载未完成，请重试。');
        setNotice(`${format.toUpperCase()} 已保存到本地音乐目录。`);
      }
    });
  }
  async function importBgm() {
    if (!record || !track) return;
    await runAction('bgm', async () => {
      const result = await api.importMusicLabTrackAsBgm({ recordId: record.id, trackId: track.id });
      if (mounted.current) { updateRecord(result.record); applyState(result.mutation); setNotice('已加入背景音乐库，可在视频项目中选用。'); }
    });
  }
  async function openOutput() {
    if (!record) return;
    await runAction('folder', async () => { await api.openMusicLabOutputDirectory(record.id); });
  }
  async function useInMv() {
    if (!record || !track) return;
    await runAction('mv', async () => {
      let path = localPath;
      if (!path) {
        const next = await api.downloadMusicLabTrack({ recordId: record.id, trackId: track.id, format: 'mp3' });
        if (!mounted.current) return;
        updateRecord(next); path = next.tracks.find((item) => item.id === track.id)?.localMp3Path;
      }
      if (!path) throw new Error('音频尚未保存，请先下载 MP3。');
      onUseInMv({ title: track.title, lyrics: track.lyrics, audioPath: path });
    });
  }
  async function togglePlayback() {
    if (!localPath && record && track?.status === 'completed') {
      await runAction('preview', async () => {
        const next = await api.downloadMusicLabTrack({ recordId: record.id, trackId: track.id, format: 'mp3' });
        if (!mounted.current) return;
        const saved = next.tracks.find((item) => item.id === track.id);
        if (!saved?.localMp3Path) { updateRecord(next); throw new Error(saved?.downloadError || '试听音频准备失败，请重试。'); }
        playAfterDownload.current = currentSelection.current === track.id ? track.id : '';
        updateRecord(next);
      });
      return;
    }
    const audio = audioRef.current;
    if (!audio || !audioSource) return;
    try { if (audio.paused) await audio.play(); else audio.pause(); }
    catch { setError('暂时无法播放。可以刷新状态，或下载 MP3 后重试。'); }
  }
  function toggleFavorite() {
    if (!track) return;
    const next=favoriteIds.includes(track.id)?favoriteIds.filter((id)=>id!==track.id):[...favoriteIds,track.id];
    setFavoriteIds(next);try{localStorage.setItem('storydream.music-favorites',JSON.stringify(next));}catch{setError('收藏只保留在当前窗口，本地存储暂不可用。');}
  }
  function stepTrack(direction: number) {
    const next = playableRows[playbackIndex + direction];
    if (next) setSelectedId(next.id);
  }

  return <div className="music-lab" data-music-workspace data-platform-music={platformMusic || undefined}>
    <header className="music-lab__header">
      <div className="music-lab__heading"><Music2 size={21} /><div><h2>音乐创作</h2><span>让灵感成为下一段旋律</span></div></div>
      <div className="music-lab__service"><span className={`music-lab__dot ${(platformMusic ? platformModel?.status === 'available' : service?.configured) ? 'is-ready' : ''}`} />{platformMusic ? `平台积分 · ${platformModel?.name || activeCommercialMusic?.name}` : service === null ? '检查服务…' : `${service.providerName} ${service.enabled === false ? '已停用' : service.configured ? '已配置' : '未配置'}`}
        {platformMusic ? <span>可用 {commercial.snapshot?.wallet ? formatCredits(commercial.snapshot.wallet.availableUnits) : '—'} 积分</span> : <Button density="compact" variant="subtle" onClick={() => void checkBalance()} disabled={busy || !byokReady || !service?.configured}>{pendingAction === 'balance' ? '查询中…' : balance === null ? '查询余额' : `余额 ¥${balance.toFixed(2)}`}</Button>}
        <Button density="compact" variant="subtle" onClick={()=>setServiceOpen(true)}>服务与授权</Button>
        {openSettings && <Button density="compact" variant="subtle" disabled={busy} onClick={openSettings}>API 设置</Button>}
      </div>
    </header>
    {(error || notice) && <div className={`music-lab__feedback ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    <div className="music-lab__workspace">
      <section className="music-lab__composer" aria-label="音乐创作表单">
        <div className="music-lab__composer-head"><SegmentedControl label="创作模式" value={draft.mode} onChange={(mode) => patchDraft({ mode })} options={[{ value: 'description', label: '简易' }, { value: 'custom', label: '高级' }, { value: 'sounds', label: '音色' }]} /><IconButton label="重置创作草稿" icon={<RotateCcw size={15} />} variant="subtle" disabled={busy} onClick={() => setClearOpen(true)} /></div>
        <div className="music-lab__entry-tools"><Button density="compact" variant="subtle" icon={<Upload size={14} />} disabled={busy || !byokReady} onClick={() => setUploadOpen(true)}>上传音频</Button><Button density="compact" variant="subtle" icon={<Headphones size={14} />} disabled={!byokReady || busy} onClick={() => setVoiceOpen(true)}>人声克隆</Button><Button density="compact" variant="subtle" icon={<Sparkles size={14} />} disabled={!byokReady || busy} onClick={() => setOperation('inspo')}>灵感生成</Button><Button density="compact" variant="subtle" icon={<SlidersHorizontal size={14} />} disabled={!byokReady || busy} onClick={() => setToolsOpen(true)}>歌曲工具</Button></div>
        <div className="music-lab__form">
          {platformMusic ? <p className="music-lab__hint">平台模型：{platformModel?.name || activeCommercialMusic?.name}。可在 API 设置中切换。当前支持普通创作、纯音乐和音效的积分结算；歌词辅助、克隆和歌曲编辑需明确启用自有 API。</p> : <SelectField label="生成模型" value={draft.model} onChange={(_, data) => patchDraft({ model: data.value as MusicModel })} options={[{ value: 'suno-v6', label: 'Suno V6' }, { value: 'suno-v6-wild', label: 'Suno V6 Wild' }, { value: 'suno-v6-mini', label: 'Suno V6 Mini' }]} />}
          {draft.mode === 'description' && <>
            <TextAreaField label="歌曲描述" placeholder="描述主题、情绪、乐器和人声，例如：温暖的中文民谣，木吉他与轻鼓点，唱一段重新出发的故事…" rows={7} maxLength={10000} value={draft.description} onChange={(_, data) => patchDraft({ description: data.value })} />
            <div className="music-lab__field-caption"><span>一句话也可以开始</span><span>{draft.description.length} / 10000</span></div>
            <div className="music-lab__section-label"><Sparkles size={14} /> 从一个灵感开始</div>
            <div className="music-lab__inspiration-buttons">{inspirations.map((item) => <Button key={item.title} density="compact" variant="subtle" icon={<item.icon size={14} />} onClick={() => patchDraft({ description: item.prompt, instrumental: item.instrumental })}>{item.title}</Button>)}</div>
          </>}
          {draft.mode === 'custom' && <>
            <TextField label="歌曲标题" placeholder="为这首歌起个名字（选填）" maxLength={200} value={draft.title} onChange={(_, data) => patchDraft({ title: data.value })} />
            <TextAreaField label="歌词" hint={draft.instrumental ? '纯音乐模式下不发送歌词，已写内容会保留。' : '支持 [Verse]、[Chorus] 等段落标记。'} placeholder={'[Verse]\n在这里写下第一句\n\n[Chorus]\n让故事随旋律展开'} rows={7} maxLength={30000} value={draft.lyrics} disabled={draft.instrumental} onChange={(_, data) => patchDraft({ lyrics: data.value })} />
            <div className="music-lab__inline-actions"><Button density="compact" variant="subtle" icon={<Wand2 size={14} />} disabled={busy || !byokReady || !service?.configured || draft.instrumental} onClick={() => { setLyricInstruction(draft.description); setHelperOpen(true); }}>帮我写歌词</Button><Button density="compact" variant="subtle" disabled={draft.instrumental} onClick={() => patchDraft({ lyrics: `${draft.lyrics}${draft.lyrics ? '\n\n' : ''}[Verse]\n\n[Chorus]\n\n[Outro]\n` })}>插入结构</Button><Button density="compact" variant="subtle" disabled={busy || !byokReady || !draft.lyrics.trim() || draft.instrumental || !service?.configured} onClick={()=>{setLyricInstruction(`请把以下歌词转换为便于演唱的拼音，保留段落结构，只输出转换后的完整歌词：\n${draft.lyrics}`);setHelperOpen(true);}}>拼音辅助</Button></div>
            <TextAreaField label="音乐风格" placeholder="如：Chinese pop, warm vocal, acoustic guitar" rows={3} maxLength={5000} value={draft.style} onChange={(_, data) => patchDraft({ style: data.value })} />
            <div className="music-lab__tags">{styles.map((style) => <Button key={style} density="compact" variant="subtle" onClick={() => patchDraft({ style: [draft.style, style].filter(Boolean).join(', ') })}>{style}</Button>)}</div>
            <Button density="compact" variant="subtle" icon={<Sparkles size={14} />} disabled={busy || !byokReady || !service?.configured || !draft.style.trim()} onClick={() => void boostStyle()}>{pendingAction === 'style' ? '正在润色…' : '润色风格'}</Button>
            <p className="music-lab__hint">歌词与风格辅助：额度内免费，超额 ¥0.10 / 次。</p>
          </>}
          {draft.mode === 'sounds' && <>
            <TextAreaField label="音效描述" placeholder="例如：胶片放映机缓缓转动，带轻微机械噪声；或一段轻快的打击乐循环。" value={draft.soundDescription} rows={7} maxLength={10000} onChange={(_, data) => patchDraft({ soundDescription: data.value })} />
            <details className="music-lab__advanced" open><summary><SlidersHorizontal size={14} /> 高级选项 <ChevronRight size={14} /></summary><div><SegmentedControl label="音色类型" value={draft.loop ? 'loop' : 'one-shot'} options={[{value:'one-shot',label:'单次音效'},{value:'loop',label:'循环采样'}]} onChange={(value) => patchDraft({loop: value === 'loop'})} /><div className="music-lab__two-fields"><TextField label="BPM（选填）" inputMode="numeric" value={draft.bpm} onChange={(_, data) => patchDraft({ bpm: data.value })} /><SelectField label="Key / 调性" value={draft.key} onChange={(_, data) => patchDraft({ key: data.value })} options={[{value:'',label:'任意'},...['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].flatMap((key) => [{value:`${key} Major`,label:`${key} 大调`},{value:`${key} Minor`,label:`${key} 小调`}])]} /></div></div></details>
            <p className="music-lab__hint">适合短音效、转场与循环素材，生成结果以服务实际返回为准。</p>
          </>}
          {draft.mode !== 'sounds' && <>
            <div className="music-lab__switch-row"><CheckboxField label="纯音乐" checked={draft.instrumental} onChange={(_, data) => patchDraft({ instrumental: data.checked === true })} /><span>仅生成器乐</span></div>
            <CheckboxField label="Max Mode · 双倍费用" checked={draft.maxMode} onChange={(_, data) => patchDraft({maxMode:data.checked===true})} />
            <details className="music-lab__advanced"><summary><SlidersHorizontal size={14} /> 高级参数 <ChevronRight size={14} /></summary><div>
              {draft.mode === 'custom' && <>
                <TextField label="目标时长（秒，留空自动）" type="number" min={1} max={480} value={draft.targetDuration} hint="通过提示词引导，实际时长可能不同。" onChange={(_,data)=>patchDraft({targetDuration:data.value})} />
                <TextField label="排除风格（选填）" value={draft.negativeStyle} onChange={(_, data) => patchDraft({ negativeStyle: data.value })} />
                <SelectField label="演唱偏好" disabled={draft.instrumental} value={draft.vocalGender} onChange={(_, data) => patchDraft({ vocalGender: data.value })} options={[{ value: '', label: '不限' }, { value: 'm', label: '男声' }, { value: 'f', label: '女声' }]} />
                <SliderField label="随机度" min={0} max={1} step={0.05} value={draft.weirdness} valueLabel={`${Math.round(draft.weirdness * 100)}%`} onChange={(_, data) => patchDraft({ weirdness: data.value })} />
                <SliderField label="风格影响" min={0} max={1} step={0.05} value={draft.styleWeight} valueLabel={`${Math.round(draft.styleWeight * 100)}%`} onChange={(_, data) => patchDraft({ styleWeight: data.value })} />
              </>}
              <SelectField label="多样性" value={String(draft.variety)} onChange={(_, data) => patchDraft({ variety: Number(data.value) })} options={[0, 1, 2, 3, 4].map((value) => ({ value: String(value), label: String(value) }))} />
            </div></details>
          </>}
        </div>
        {platformMusic ? <PlatformMusicControls api={api} input={issue ? null : musicDraftInput(draft)} invalid={Boolean(issue)} onUseInMv={onUseInMv} outputHost={platformOutputHost} onSubmitted={() => draftGuard.complete(draftGuard.snapshot())} /> : <div className="music-lab__submit"><Button variant="primary" icon={pendingAction === 'generate' ? <Loader2 size={17} className="music-lab__spin" /> : <AudioLines size={17} />} disabled={busy || !!issue || !service?.configured || !byokReady} onClick={() => void generateMusic()}>{pendingAction === 'generate' ? '正在提交…' : '生成音乐'}<span className="music-lab__price">¥{cost.toFixed(2)} / 次</span></Button><p>{!service?.configured ? service === null ? '正在检查音乐服务…' : '请在系统设置中配置并启用音乐 API。' : issue || (draft.mode === 'sounds' ? '音效数量以实际结果为准' : '通常返回 2 首候选 · 时长由模型决定')}</p></div>}
      </section>
      <section className="music-lab__library" aria-label="音乐作品库">
        {platformMusic ? <><div className="music-lab__pane-title"><h3><Library size={16} /> 平台音乐作品</h3></div><div ref={setPlatformOutputHost} className="platform-music-library" /></> : <>
        <div className="music-lab__pane-title"><h3><Library size={16} /> 我的作品 <span>{allRows.filter((row) => row.track).length}</span></h3><div><IconButton label="同步云端曲库" icon={<CloudDownload size={15} />} variant="subtle" disabled={busy || !byokReady || !service?.configured} onClick={() => void syncHistory()} /><IconButton label="刷新音乐作品" icon={<RefreshCw size={15} className={pendingAction === 'refresh' ? 'music-lab__spin' : ''} />} variant="subtle" disabled={busy || loading} onClick={() => void refreshSelected()} /></div></div>
        <div className="music-lab__library-tools"><TextField label="搜索作品" contentBefore={<Search size={14} />} placeholder="标题、歌词或风格" value={query} onChange={(_, data) => setQuery(data.value)} /><SelectField label="排序" value={sort} onChange={(_, data) => setSort(data.value)} options={[{ value: 'newest', label: '最新优先' }, { value: 'title', label: '按标题' }]} /></div>
        <SegmentedControl label="作品筛选" value={filter} onChange={setFilter} options={[{value:'all',label:'全部'},{value:'favorites',label:'收藏'},{value:'generated',label:'生成'},{value:'upload',label:'上传'},{value:'remix',label:'改编'},{value:'stems',label:'分轨'},{value:'active',label:'进行中'},{value:'saved',label:'已保存'}]} />
        <div className="music-lab__tracks" aria-busy={loading}>
          {loading ? <div className="music-lab__empty"><Loader2 size={24} className="music-lab__spin" /><p>读取作品库…</p></div> : rows.length ? rows.map((row) => <Button key={row.id} variant="subtle" className={`music-lab__track ${selectedId === row.id ? 'is-selected' : ''}`} aria-pressed={selectedId === row.id} onClick={() => setSelectedId(row.id)}>
            <span className="music-lab__track-art">{row.track?.imageUrl ? <img src={row.track.imageUrl} alt="" loading="lazy" /> : <AudioLines size={23} />}</span>
            <span className="music-lab__track-text"><strong>{row.track?.title || (row.record.input.mode === 'custom' ? row.record.input.title : '') || '未命名作品'}</strong><span>{row.track?.style || (row.record.input.mode === 'sounds' ? '音效素材' : row.record.input.mode === 'description' ? row.record.input.description : row.record.input.style)}</span><small>{statusLabels[row.track?.status ?? row.record.status]} · {row.record.model.replace('suno-', '').toUpperCase()}{row.track?.localMp3Path || row.track?.localWavPath ? ' · 已保存' : ''}</small></span><span className="music-lab__track-duration">{row.track?.durationSec ? musicTime(row.track.durationSec) : '—'}</span>
          </Button>) : <div className="music-lab__empty"><span className="music-lab__empty-icon"><AudioLines size={32} strokeWidth={1.3} /></span><h3>{query || filter !== 'all' ? '没有符合条件的作品' : '你的第一首作品，从这里开始'}</h3><p>{query || filter !== 'all' ? '换个关键词，或查看全部作品。' : '在左侧描述音乐，或带着自己的歌词创作。生成的候选歌曲会保存在这里。'}</p>{!query && filter === 'all' && <div className="music-lab__steps"><span>01 描述灵感</span><ChevronRight size={13} /><span>02 试听挑选</span><ChevronRight size={13} /><span>03 用于创作</span></div>}</div>}
        </div>
        <div className="music-lab__library-footer"><span className={`music-lab__dot ${activeCount ? 'is-working' : ''}`} />{activeCount ? `${activeCount} 个任务正在创作，关闭页面后仍会继续` : '本地作品记录 · 音频下载后可持续复用'}</div>
        </>}
      </section>
      <aside className="music-lab__inspector" aria-label="歌曲详情">
        <div className="music-lab__pane-title"><h3>歌曲详情</h3>{track && <div><span className="music-lab__status">{statusLabels[track.status]}</span><IconButton label={favoriteIds.includes(track.id)?'取消收藏':'收藏歌曲'} icon={<Star size={14} fill={favoriteIds.includes(track.id)?'currentColor':'none'} />} variant="subtle" onClick={toggleFavorite} /></div>}</div>
        {record ? <div className="music-lab__detail-body">
          <div className="music-lab__cover">{track?.imageUrl ? <img src={track.imageUrl} alt={`${track.title}的封面`} /> : <Music2 size={44} strokeWidth={1} />}</div>
          <h3>{track?.title || '正在创作'}</h3><p className="music-lab__hint">{track?.style || '生成后显示风格与歌曲信息'}</p>
          <div className="music-lab__metadata"><span>{record.model}</span><span>{track?.durationSec ? musicTime(track.durationSec) : '时长待返回'}</span><span>{record.origin === 'history' ? '云端导入' : record.origin === 'upload' ? '上传素材' : `预计 ¥${record.estimatedCost.toFixed(2)} / 次`}</span>{record.operation && <span>{MUSIC_OPERATION_LABELS[record.operation.operation]}</span>}{track?.stemType && <span>{track.stemType}</span>}</div>
          {(record.errorMessage || track?.errorMessage || track?.downloadError) && <p className="music-lab__error" role="alert">{record.errorMessage || track?.errorMessage || track?.downloadError}</p>}
          {record.status === 'needs-recovery' && <p className="music-lab__hint">提交结果不明确，请先在服务网站核对记录，避免重复付费提交。</p>}
          <div className="music-lab__download-actions"><Button density="compact" icon={<Download size={14} />} disabled={busy || track?.status !== 'completed'} onClick={() => void downloadTrack('mp3')}>{pendingAction === 'download-mp3' ? '下载中…' : 'MP3'}</Button><Button density="compact" icon={<Download size={14} />} disabled={busy || track?.status !== 'completed'} onClick={() => void downloadTrack('wav')}>{pendingAction === 'download-wav' ? '下载中…' : 'WAV'}</Button><IconButton label="打开音乐文件夹" icon={<FolderOpen size={15} />} disabled={busy} onClick={() => void openOutput()} /></div>
          <div className="music-lab__export-row"><SelectField label="更多格式" value={exportFormat} onChange={(_,data) => setExportFormat(data.value as MusicMediaFormat)} options={[{value:'lyrics',label:'歌词 TXT'},{value:'lrc',label:'时间轴歌词 LRC'},{value:'cover',label:'歌曲封面'},{value:'mp4',label:'歌曲视频 MP4'},{value:'midi',label:'分轨 MIDI',disabled:!track?.stemType && !['separate','vocal-removal'].includes(record.operation?.operation ?? '')}]} /><Button density="compact" disabled={busy || track?.status !== 'completed' || exportFormat === 'midi' && !track.stemType && !['separate','vocal-removal'].includes(record.operation?.operation ?? '')} onClick={() => void downloadTrack(exportFormat)}>导出</Button></div>
          <Button icon={track?.bgmId ? <Check size={15} /> : <Library size={15} />} disabled={busy || track?.status !== 'completed' || !!track?.bgmId} onClick={() => void importBgm()}>{pendingAction === 'bgm' ? '正在加入…' : track?.bgmId ? '已加入背景音乐库' : '加入背景音乐库'}</Button>
          <Button icon={<Clapperboard size={15} />} disabled={busy || track?.status !== 'completed'} onClick={() => void useInMv()}>{pendingAction === 'mv' ? '准备音频…' : '用于音乐 MV'}</Button>
          <Button icon={<SlidersHorizontal size={15} />} disabled={busy || !byokReady || track?.status !== 'completed'} onClick={() => setToolsOpen(true)}>编辑、翻唱与分轨</Button>
          <Button variant="subtle" density="compact" icon={<RotateCcw size={14} />} disabled={busy} onClick={() => { patchDraft(musicRecordDraft(record.input)); setNotice('已复用创作参数，修改后可再次生成。'); }}>复用创作参数</Button>
          <div className="music-lab__lyrics"><h4>歌词</h4><pre>{track?.lyrics || (record.input.mode === 'custom' && !record.input.instrumental ? record.input.lyrics : '暂无歌词 · 纯音乐作品可直接用于配乐')}</pre></div>
          <details className="music-lab__source"><summary>创作记录</summary><p>{new Date(record.createdAt).toLocaleString('zh-CN')}</p><p>服务：{record.providerName}</p><p>歌曲 ID：{track?.songId || '尚未返回'}</p></details>
        </div> : <div className="music-lab__detail-empty"><Music2 size={28} strokeWidth={1.3} /><h3>选择一首作品</h3><p>查看歌词与创作参数，下载音频，或把音乐带入视频。</p><div><span><Download size={14} /> MP3 / WAV</span><span><Library size={14} /> 项目背景音乐</span><span><Clapperboard size={14} /> 音乐 MV</span></div></div>}
      </aside>
    </div>
    <footer className="music-lab__player" aria-label="音乐播放器">
      <div className="music-lab__now-playing"><span className="music-lab__player-art"><Music2 size={19} /></span><div><strong>{track?.title || '尚未选择音乐'}</strong><span>{track ? track.style || statusLabels[track.status] : '选择作品后即可试听'}</span></div></div>
      <div className="music-lab__transport"><IconButton label="上一首" variant="subtle" icon={<SkipBack size={17} />} disabled={playbackIndex <= 0} onClick={() => stepTrack(-1)} /><IconButton label={pendingAction === 'preview' ? '准备试听…' : playing ? '暂停音乐' : '播放音乐'} variant="primary" icon={playing ? <Pause size={18} /> : <Play size={18} />} disabled={busy || (!audioSource && track?.status !== 'completed')} onClick={() => void togglePlayback()} /><IconButton label="下一首" variant="subtle" icon={<SkipForward size={17} />} disabled={playbackIndex < 0 || playbackIndex >= playableRows.length - 1} onClick={() => stepTrack(1)} /></div>
      <div className="music-lab__seek"><span>{musicTime(currentTime)}</span><SliderField label="播放进度" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(currentTime, Math.max(duration, 1))} disabled={!audioSource || !duration} onChange={(_, data) => { if (audioRef.current) audioRef.current.currentTime = data.value; setCurrentTime(data.value); }} /><span>{musicTime(duration || track?.durationSec)}</span></div>
      <div className="music-lab__volume"><SliderField label="音量" valueLabel={`${Math.round(volume * 100)}%`} min={0} max={1} step={0.05} value={volume} onChange={(_, data) => setVolume(data.value)} /></div>
      {audioSource && <audio key={audioSource} ref={audioRef} src={audioSource} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onError={() => { setPlaying(false); setError('音频暂时无法播放，请刷新歌曲状态或下载后试听。'); }} />}
    </footer>
    <Dialog open={helperOpen} title="歌词灵感" onOpenChange={setHelperOpen} actions={<><Button disabled={busy} onClick={() => setHelperOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !lyricInstruction.trim()} onClick={() => void generateLyrics()}>{pendingAction === 'lyrics' ? '正在创作…' : '生成歌词'}</Button></>}><TextAreaField label="这首歌想表达什么？" rows={5} value={lyricInstruction} onChange={(_, data) => setLyricInstruction(data.value)} placeholder="描述主题、故事、语言和歌词结构…" /><p className="music-lab__hint">额度内免费，超额 ¥0.10 / 次。生成结果将替换当前歌词。</p></Dialog>
    <Dialog open={clearOpen} title="重置创作草稿？" onOpenChange={setClearOpen} actions={<><Button onClick={() => setClearOpen(false)}>保留草稿</Button><Button variant="primary" onClick={() => { patchDraft({ ...defaultMusicDraft }); setClearOpen(false); }}>重置草稿</Button></>}><p>当前描述、歌词和参数将被清空。已有作品会保留。</p></Dialog>
    <Dialog open={serviceOpen} title="Suno-API 服务与授权" onOpenChange={setServiceOpen} actions={<><Button onClick={()=>setServiceOpen(false)}>关闭</Button><Button disabled={busy} onClick={()=>void openServiceSite()}>打开服务网站</Button></>}><div className="music-lab__operation-form"><p>本软件通过 Suno-API 第三方服务生成音乐。</p><p className="music-lab__hint">充值、消费明细、商用授权书申请及 ¥20 自动人声克隆在服务网站处理，沿用你在浏览器中的登录状态。</p><p className="music-lab__hint">商用授权书有累计充值和身份资料要求。资格、具体授权范围及有效期以服务网站返回的条款和证书为准。</p><p className="music-lab__hint">应用内已接入普通人声克隆验证、指定人声创作、强化上传及歌曲编辑流程。网站专用自动克隆不会由应用在后台触发。</p></div></Dialog>
    <Dialog open={toolsOpen} title="歌曲工具" onOpenChange={setToolsOpen} actions={<Button onClick={() => setToolsOpen(false)}>关闭</Button>}><p className="music-lab__hint">{track?.title ? `当前作品：${track.title}` : '进入工具后，选择已完成的作品作为来源。'}</p><div className="music-lab__tool-groups">{musicOperationGroups.map((group) => <section key={group.label}><h4>{group.label}</h4><div>{group.operations.map((item) => <Button key={item} onClick={() => { setToolsOpen(false); setOperation(item); }}>{MUSIC_OPERATION_LABELS[item]}</Button>)}</div></section>)}</div></Dialog>
    {operation && <MusicSourceTools key={operation} open api={api} records={records} initialOperation={operation} selected={selected} configured={byokReady && !!service?.configured} onClose={() => setOperation(null)} onRecord={(next) => { updateRecord(next); setSelectedId(next.tracks[0]?.id ?? next.id); }} />}
    {voiceOpen && <MusicVoicePanel api={api} draft={draft} configured={byokReady && !!service?.configured} onClose={() => { setVoiceOpen(false); void refreshLibrary(); }} onLibraryChanged={() => void refreshLibrary()} />}
    <Dialog open={uploadOpen} title="上传音频" onOpenChange={(open) => { if (!busy) setUploadOpen(open); }} actions={<><Button disabled={busy} onClick={() => setUploadOpen(false)}>关闭</Button>{uploadMode === 'normal' && <Button variant="primary" disabled={busy || !uploadPath || !service?.configured} onClick={() => void uploadSource()}>{pendingAction === 'upload' ? '上传中…' : '上传源音频 · 免费'}</Button>}</>}><div className="music-lab__operation-form"><SegmentedControl label="上传方式" value={uploadMode} disabled={busy} onChange={setUploadMode} options={[{value:'normal',label:'普通上传'},{value:'enhanced',label:'强化上传'}]} /><p className="music-lab__hint">导入自己的录音或歌曲，上传后可用于翻唱、续写和分轨。</p><Button icon={<FolderOpen size={16} />} disabled={busy} onClick={() => void chooseUpload()}>{pendingAction === 'choose-upload' ? '选择中…' : '选择音频文件'}</Button>{uploadPath && <p className="music-lab__hint">{uploadPath.split(/[\\/]/u).pop()}</p>}<TextField label="素材名称" disabled={busy} value={uploadTitle} onChange={(_, data) => setUploadTitle(data.value)} />{uploadOpen && uploadMode === 'enhanced' && <MusicEnhancedPanel api={api} audioPath={uploadPath} title={uploadTitle} configured={byokReady && !!service?.configured} onLibraryChanged={()=>void refreshLibrary()} onBusyChange={(value)=>setPendingAction(value?'enhanced':'')} />}{error && <p className="music-lab__error" role="alert">{error}</p>}</div></Dialog>
  </div>;
}
