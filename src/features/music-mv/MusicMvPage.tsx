import { useState } from 'react';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import { FolderOpen, Loader2, Music } from 'lucide-react';
import { FormField as Field } from '../../components/FormField';
import { OptionGroup as OptionCloud } from '../../components/OptionGroup';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { AspectRatioSwatch } from '../../components/AspectRatioSwatch';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { PausePoint, ProcessingMode, Task } from '../../shared/types';
import type { TemplateOption } from '../../shared/prompt-templates';
import { pauseOptions, storyboardSceneCountOptions, styleOptions } from '../../shared/editorial-options';
import { useAsyncAction } from '../../ui/async-action';
import { addUploadedBgm, resolveDefaultBgmId, taskFromMutation, validBgmItems } from '../tasks/task-formatters';

const MUSIC_MV_RHYTHM_LABELS: Record<Task['musicMv']['rhythmMode'], string> = {
  'lyric-sync': '歌词同步',
  'fast-cut': '快切',
  'slow-cinematic': '慢镜头',
};
const MUSIC_MV_CAPTION_LABELS: Record<Task['musicMv']['captionStyle'], string> = {
  karaoke: '卡拉 OK',
  minimal: '极简字幕',
  none: '无字幕',
};
const MUSIC_MV_SCENE_LABELS = ['开场', '主歌', '副歌', '结尾'] as const;

export function MusicMvPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const defaultTemplateId = state.draftTemplates[0]?.id ?? 'default-portrait-9-16';
  const [title, setTitle] = useState('音乐MV');
  const [lyrics, setLyrics] = useState('雨落下第一句\n霓虹亮起第二句\n副歌把夜色唱亮');
  const [style, setStyle] = useState('modern-film');
  const [ratio, setRatio] = useState('16:9');
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [storyboardSceneCount, setStoryboardSceneCount] = useState(12);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('full-auto');
  const [pausePoint, setPausePoint] = useState<PausePoint>('critical');
  const [musicMvRhythmMode, setMusicMvRhythmMode] = useState<Task['musicMv']['rhythmMode']>('lyric-sync');
  const [musicMvCaptionStyle, setMusicMvCaptionStyle] = useState<Task['musicMv']['captionStyle']>('karaoke');
  const [musicMvVisualMotif, setMusicMvVisualMotif] = useState('雨夜霓虹、孤独背影、慢镜头');
  const [musicMvAudioPath, setMusicMvAudioPath] = useState('');
  const [bgmId, setBgmId] = useState(resolveDefaultBgmId(state.config));
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const musicAction = useAsyncAction();
  const creationDraft = useWorkspaceDraft({
    id: 'music-mv-create', label: '音乐 MV 草稿',
    busy: running,
    value: { title, lyrics, style, ratio, templateId, storyboardSceneCount, processingMode, pausePoint, musicMvRhythmMode, musicMvCaptionStyle, musicMvVisualMotif, musicMvAudioPath, bgmId },
    restore: (draft) => {
      setTitle(draft.title); setLyrics(draft.lyrics); setStyle(draft.style); setRatio(draft.ratio); setTemplateId(draft.templateId);
      setStoryboardSceneCount(draft.storyboardSceneCount); setProcessingMode(draft.processingMode); setPausePoint(draft.pausePoint);
      setMusicMvRhythmMode(draft.musicMvRhythmMode); setMusicMvCaptionStyle(draft.musicMvCaptionStyle); setMusicMvVisualMotif(draft.musicMvVisualMotif);
      setMusicMvAudioPath(draft.musicMvAudioPath); setBgmId(draft.bgmId);
    },
  });
  const bgmOptions = validBgmItems(state.config);
  const lyricLines = lyrics.split(/\n/u).map((line) => line.trim()).filter(Boolean);
  const musicMvStyleOptions = styleOptions;
  const musicMvDraftTemplateOptions = state.draftTemplates.map((template): TemplateOption => [template.id, template.name, `出图 ${template.image.ratio}`]);

  async function selectMusicMvAudio() {
    await musicAction.run(async () => {
      const imported = await api.importBgmAudio();
      if (!imported) return;
      setMusicMvAudioPath(imported.path);
      const nextBgm = addUploadedBgm(state.config, imported);
      const next = await api.saveConfig({ config: nextBgm.config, secretChanges: {} });
      applyState(next);
      setBgmId(nextBgm.bgmId);
    });
  }

  async function runMusicMv() {
    if (isBrowserPreview) {
      setMessage('浏览器预览不能执行真实流水线，请在 Electron 应用中生成音乐 MV。');
      return;
    }
    if (!lyrics.trim()) {
      setMessage('请先输入歌词 / 文案。');
      return;
    }
    if (!musicMvAudioPath.trim()) {
      setMessage('请先选择主歌曲音频；BGM 只能作为辅助配乐，不能替代主歌曲。');
      return;
    }
    await musicAction.run(async () => {
      setRunning(true);
      const submittedDraft = creationDraft.snapshot();
      setMessage('');
      try {
        const next = await api.createAndRunTask({
          title,
          inputText: lyrics,
          taskKind: 'music-mv',
          processingMode,
          mode: 'paste',
          track: 'music-mv',
          style,
          ratio,
          templateId,
          bgmId,
          pausePoints: [pausePoint],
          storyboardSceneCount,
          musicMv: {
            rhythmMode: musicMvRhythmMode,
            captionStyle: musicMvCaptionStyle,
            visualMotif: musicMvVisualMotif,
            audioPath: musicMvAudioPath,
          },
        });
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) {
          creationDraft.complete(submittedDraft);
          openTaskDetail(createdTask.id);
        }
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <div className="music-mv-layout">
      <section className="task-card">
        <div className="panel-title-row">
          <div>
            <h2>音乐MV</h2>
            <span>按歌词切分镜头、同步字幕节奏，并输出剪映草稿。</span>
          </div>
          <button className="primary-action slim" onClick={runMusicMv} disabled={running || !lyrics.trim() || !musicMvAudioPath.trim()}>
            {running ? <Loader2 className="spin" size={15} /> : <Music size={15} />}
            生成音乐 MV
          </button>
        </div>

        <Field label="标题">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="歌词 / 文案">
          <textarea className="source-textarea" value={lyrics} onChange={(event) => setLyrics(event.target.value)} />
        </Field>

        <div className="advanced-grid">
          <Segmented label="节奏模式" value={musicMvRhythmMode} options={['lyric-sync', 'fast-cut', 'slow-cinematic']} labels={['歌词同步', '快切', '慢镜头']} onChange={(value) => setMusicMvRhythmMode(value as Task['musicMv']['rhythmMode'])} />
          <Segmented label="歌词字幕" value={musicMvCaptionStyle} options={['karaoke', 'minimal', 'none']} labels={['卡拉 OK', '极简', '无字幕']} onChange={(value) => setMusicMvCaptionStyle(value as Task['musicMv']['captionStyle'])} />
          <Segmented label="自动化模式" value={processingMode} options={['full-auto', 'milestone-review', 'scene-review', 'manual']} labels={['全自动', '里程碑审批', '逐场景审批', '手动']} onChange={(value) => setProcessingMode(value as ProcessingMode)} />
          <Segmented label="暂停确认" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
          <Segmented label="分镜数量" value={String(storyboardSceneCount)} options={storyboardSceneCountOptions.map(String)} labels={storyboardSceneCountOptions.map((count) => `${count} 条`)} onChange={(value) => setStoryboardSceneCount(Number(value))} />
        </div>

        <OptionCloud title="画面风格" options={musicMvStyleOptions} value={style} onChange={setStyle} />
        <div className="option-two-col">
          <OptionCloud title="草稿模板" options={musicMvDraftTemplateOptions} value={templateId} onChange={setTemplateId} />
          <div>
            <span className="field-title">AI 出图比例</span>
            <div className="ratio-grid">
              {['9:16', '4:3', '1:1', '16:9'].map((item) => (
                <button key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => setRatio(item)}>
                  <AspectRatioSwatch ratio={item} />
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Field label="视觉母题">
          <input value={musicMvVisualMotif} onChange={(event) => setMusicMvVisualMotif(event.target.value)} placeholder="例如：雨夜霓虹、孤独背影、慢镜头" />
        </Field>
        <Field label="音频文件">
          <div className="upload-row">
            <input value={musicMvAudioPath} onChange={(event) => setMusicMvAudioPath(event.target.value)} placeholder="可选择本地歌曲或伴奏" />
            <button className="ghost-action" disabled={musicAction.busy} onClick={selectMusicMvAudio}><FolderOpen size={15} />选择音频</button>
          </div>
          {!musicMvAudioPath.trim() ? <small className="field-hint is-warning">必须选择主歌曲后才能生成；BGM 不会替代主歌曲。</small> : null}
        </Field>

        <span className="field-title">背景音乐</span>
        <div className="chip-row">
          <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>无 BGM</button>
          {bgmOptions.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>{bgm.title}</button>
          ))}
        </div>

        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={musicAction.feedback} />
      </section>
      <aside className="music-mv-preview panel" data-media-canvas="music-mv-timeline-audio">
        <h3>MV 结构预览</h3>
        <div className="task-metrics">
          <div><small>歌词行</small><strong>{lyricLines.length}</strong></div>
          <div><small>节奏模式</small><strong>{MUSIC_MV_RHYTHM_LABELS[musicMvRhythmMode]}</strong></div>
          <div><small>字幕样式</small><strong>{MUSIC_MV_CAPTION_LABELS[musicMvCaptionStyle]}</strong></div>
        </div>
        <div className="artifact-scene-list">
          {lyricLines.slice(0, 8).map((line, index) => (
            <div key={`${line}-${index}`}>
              <strong>{index + 1}. {index === 0 ? MUSIC_MV_SCENE_LABELS[0] : index === lyricLines.length - 1 ? MUSIC_MV_SCENE_LABELS[3] : index >= Math.floor(lyricLines.length / 2) ? MUSIC_MV_SCENE_LABELS[2] : MUSIC_MV_SCENE_LABELS[1]}</strong>
              <p>{line}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
