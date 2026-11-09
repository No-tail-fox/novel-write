import { ProjectModelFields } from '../projects/ProjectModelFields';
import { defaultProjectModels, readProjectModelsDraft } from '../../shared/project-models';
import { useState } from 'react';
import { FolderOpen, Loader2, Music } from 'lucide-react';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { Task } from '../../shared/types';
import { CREATIVE_STYLES, creativeStyle } from '../../shared/creative-animation/styles';
import { useAsyncAction } from '../../ui/async-action';
import { Button, TextField, TextAreaField, SelectField } from '../../ui';
import { taskFromMutation } from '../tasks/task-formatters';
import { applyMusicMvHandoff, type MusicMvHandoff } from './music-mv-handoff';

export function MusicMvPage({ api, state, applyState, openTaskDetail, isBrowserPreview, initialMusic, onInitialMusicHandled }: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
  initialMusic?: MusicMvHandoff;
  onInitialMusicHandled?: (id: string) => void;
}) {
  const [projectModels, setProjectModels] = useState(() => defaultProjectModels(state.config));
  const [title, setTitle] = useState('音乐 MV');
  const [lyrics, setLyrics] = useState('雨落下第一句\n霓虹亮起第二句\n副歌把夜色唱亮');
  const [style, setStyle] = useState('cel-anime-80s');
  const [ratio, setRatio] = useState('16:9');
  const [storyboardSceneCount, setStoryboardSceneCount] = useState(12);
  const [processingMode, setProcessingMode] = useState<'full-auto' | 'manual'>('full-auto');
  const [musicMvRhythmMode, setMusicMvRhythmMode] = useState<Task['musicMv']['rhythmMode']>('lyric-sync');
  const [musicMvCaptionStyle, setMusicMvCaptionStyle] = useState<Task['musicMv']['captionStyle']>('minimal');
  const [musicMvVisualMotif, setMusicMvVisualMotif] = useState('雨夜霓虹、孤独背影、慢镜头');
  const [musicMvAudioPath, setMusicMvAudioPath] = useState('');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [handledMusicId, setHandledMusicId] = useState('');
  const musicAction = useAsyncAction();
  const creationDraft = useWorkspaceDraft({
    id: 'music-mv-create', label: '音乐 MV 草稿', busy: running,
    value: { projectModelsJson: JSON.stringify(projectModels), title, lyrics, style, ratio, storyboardSceneCount, processingMode, musicMvRhythmMode, musicMvCaptionStyle, musicMvVisualMotif, musicMvAudioPath, bgmId: '' },
    restore: draft => {
      setProjectModels(current => readProjectModelsDraft(draft.projectModelsJson, current));
      setTitle(draft.title); setLyrics(draft.lyrics); setStyle(creativeStyle(draft.style)?.slug ?? 'cel-anime-80s'); setRatio(draft.ratio);
      setStoryboardSceneCount(draft.storyboardSceneCount); setProcessingMode(draft.processingMode === 'manual' ? 'manual' : 'full-auto');
      setMusicMvRhythmMode(draft.musicMvRhythmMode); setMusicMvCaptionStyle(draft.musicMvCaptionStyle);
      setMusicMvVisualMotif(draft.musicMvVisualMotif); setMusicMvAudioPath(draft.musicMvAudioPath);
    },
  });
  const pendingMusic = initialMusic && initialMusic.id !== handledMusicId ? initialMusic : undefined;
  const lyricLines = lyrics.split(/\n/u).map(line => line.trim()).filter(Boolean);
  const hasLrcTimestamps = /\[\d{1,3}:[0-5]\d(?:\.\d{1,3})?\]/u.test(lyrics);

  function handleInitialMusic(useMusic: boolean) {
    if (!pendingMusic || running || musicAction.busy) return;
    if (useMusic) {
      if (!pendingMusic.audioPath.trim()) return;
      const next = applyMusicMvHandoff(creationDraft.snapshot(), pendingMusic);
      setTitle(next.title); setLyrics(next.lyrics); setMusicMvAudioPath(next.musicMvAudioPath);
      setMessage('已使用歌曲，可继续设置画面并生成音乐 MV。');
    }
    setHandledMusicId(pendingMusic.id);
    onInitialMusicHandled?.(pendingMusic.id);
  }

  async function selectMusicMvAudio() {
    await musicAction.run(async () => {
      const imported = await api.importBgmAudio();
      if (imported) setMusicMvAudioPath(imported.path);
    });
  }

  async function runMusicMv() {
    if (isBrowserPreview) { setMessage('请在桌面应用中运行真实音乐 MV 制作。'); return; }
    if (!lyrics.trim() || !musicMvAudioPath.trim()) { setMessage('请填写歌词并选择主歌曲。'); return; }
    await musicAction.run(async () => {
      setRunning(true);
      const submittedDraft = creationDraft.snapshot();
      setMessage('正在读取歌曲并创建 Lemo 项目…');
      try {
        const next = await api.createAndRunTask({
        projectModels, title, inputText: lyrics, taskKind: 'music-mv', processingMode,
          mode: 'paste', track: 'music-mv', style, ratio, bgmId: '', storyboardSceneCount,
          musicMv: { rhythmMode: musicMvRhythmMode, captionStyle: musicMvCaptionStyle, visualMotif: musicMvVisualMotif, audioPath: musicMvAudioPath } });
        applyState(next);
        const task = taskFromMutation(next);
        if (task) { creationDraft.complete(submittedDraft); openTaskDetail(task.id); }
      } finally { setRunning(false); }
    }, { onError: error => setMessage(error.message) });
  }

  return (
    <div className="music-mv-layout">
      <section className="task-card">
        <div className="panel-title-row">
          <div><h2>音乐 MV</h2><span>主歌曲与完整歌词 → Lemo 自动制作 → 预览与 MP4 导出</span></div>
          <Button variant="primary" onClick={runMusicMv} disabled={running || musicAction.busy || !lyrics.trim() || !musicMvAudioPath.trim()} icon={running ? <Loader2 className="spin" size={15} /> : <Music size={15} />}>
            {processingMode === 'manual' ? '创建 MV 项目' : '生成音乐 MV'}
          </Button>
        </div>
        {pendingMusic ? (
          <section className="local-note" aria-label="来自音乐创作的歌曲">
            <strong>来自音乐创作：{pendingMusic.title || '未命名歌曲'}</strong>
            <p>使用后将更新标题、歌词和主歌曲，保留画面设置。</p>
            {!pendingMusic.audioPath.trim() ? <p>这首歌曲尚未下载，请先在音乐创作中下载音频。</p> : null}
            <div className="chip-row">
              <Button variant="primary" disabled={running || musicAction.busy || !pendingMusic.audioPath.trim()} onClick={() => handleInitialMusic(true)}>使用这首歌曲</Button>
              <Button variant="subtle" disabled={running || musicAction.busy} onClick={() => handleInitialMusic(false)}>忽略</Button>
            </div>
          </section>
        ) : null}
        <TextField label="标题" value={title} onChange={event => setTitle(event.target.value)} disabled={running} />
        <TextAreaField label="歌词 / LRC" className="source-textarea" value={lyrics} onChange={event => setLyrics(event.target.value)} disabled={running}
          hint={hasLrcTimestamps
            ? '检测到 LRC：字幕按句时间显示，镜头切点优先贴近歌词起点；逐字高亮暂不支持精准对齐。请确认时间戳已按实际演唱校准。'
            : '未检测到 LRC 时间戳：创建时会尝试用已配置的语音转写逐句对齐；转写不可用或无法匹配时会退回时长均分估算，并在任务事件中说明，不代表实际演唱同步。卡拉 OK 不会伪造逐字高亮。也可直接提供校准后的逐句 LRC。'} />
        <ProjectModelFields config={state.config} value={projectModels} onChange={setProjectModels} disabled={running} />
        <div className="advanced-grid">
          <Segmented label="节奏模式" value={musicMvRhythmMode} options={['lyric-sync', 'fast-cut', 'slow-cinematic']} labels={['歌词同步', '快切', '慢镜头']} onChange={value => setMusicMvRhythmMode(value as Task['musicMv']['rhythmMode'])} />
          <Segmented label="歌词字幕" value={musicMvCaptionStyle} options={['minimal', 'karaoke', 'none']} labels={['极简', '卡拉 OK', '无字幕']} onChange={value => setMusicMvCaptionStyle(value as Task['musicMv']['captionStyle'])} />
          <Segmented label="制作方式" value={processingMode} options={['full-auto', 'manual']} labels={['全自动制作', '先检查时间轴']} onChange={value => setProcessingMode(value as 'full-auto' | 'manual')} />
          <SelectField label="目标分镜数量" value={String(storyboardSceneCount)} onChange={event => setStoryboardSceneCount(Number(event.target.value))}
            hint="镜头数量不影响歌词完整性；长歌曲会自动增加镜头，保证单镜头不超过 15 秒。" options={[2, 4, 6, 8, 12, 16, 24, 32, 48, 64].map(value => ({ value: String(value), label: `${value} 个镜头` }))} />
          <SelectField label="Lemo 视觉风格" value={style} onChange={event => setStyle(event.target.value)} options={CREATIVE_STYLES.map(item => ({ value: item.slug, label: item.cn }))} />
          <SelectField label="成片画幅" value={ratio} onChange={event => setRatio(event.target.value)} options={['16:9', '9:16', '1:1', '4:3'].map(value => ({ value, label: value }))} />
        </div>
        <TextField label="视觉母题" value={musicMvVisualMotif} onChange={event => setMusicMvVisualMotif(event.target.value)} disabled={running} />
        <div className="upload-row">
          <TextField label="主歌曲音频" value={musicMvAudioPath} onChange={event => setMusicMvAudioPath(event.target.value)} placeholder="选择本地歌曲，或粘贴文件路径" disabled={running} />
          <Button disabled={running || musicAction.busy} icon={<FolderOpen size={15} />} onClick={selectMusicMvAudio}>选择音频</Button>
        </div>
        <p className="field-hint">成片保留主歌曲原声。创建后可在 Lemo 工作台查看进度、修复镜头并导出 MP4。</p>
        {message ? <p className="local-note" role="status">{message}</p> : null}
        <InlineActionFeedback feedback={musicAction.feedback} />
      </section>
      <aside className="music-mv-preview panel" data-media-canvas="music-mv-timeline-audio">
        <h3>歌词预览</h3>
        <p>{lyricLines.length} 行输入 · 所有歌词均会进入时间轴</p>
        <p>歌曲时长将在创建项目时读取。Lemo 按歌曲时间轴制作画面，无额外旁白。</p>
        <div className="artifact-scene-list">
          {lyricLines.slice(0, 8).map((line, index) => <div key={`${index}-${line}`}><strong>{index + 1}</strong><p>{line}</p></div>)}
          {lyricLines.length > 8 ? <p>还有 {lyricLines.length - 8} 行，将完整保留。</p> : null}
        </div>
      </aside>
    </div>
  );
}
