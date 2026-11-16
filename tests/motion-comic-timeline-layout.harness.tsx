// Isolated presentation fixture: real AppShell + real page, no application bootstrap,
// license overrides, IPC bridge, provider credentials, generated media or paid calls.
import { createRoot } from 'react-dom/client';
import { AppShell } from '../src/app/AppShell';
import { useEffect, useState } from 'react';
import { DirectorDeskWorkspace, type DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import { MotionComicMakeFixture } from './motion-comic-make.fixture';
import { MotionComicProductionWorkspace } from '../src/features/motion-comic/MotionComicProductionWorkspace';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider, Button } from '../src/ui';
import { ProjectModelBar } from '../src/features/projects/ProjectModelFields';
import { defaultConfig, defaultActivation, defaultAccount, defaultUiPreferences } from '../src/shared/config';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { Task } from '../src/shared/types';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';
import '../src/features/motion-comic/motion-comic-project-controls.css';

const now = '2026-09-06T00:00:00.000Z';
const document = createMotionComicStarterProject(createMotionComicDraft({
  id: 'shell-fixture-project', title: 'AppShell 本地结构验证', premise: '仅用于导航与布局的手工空白项目，不包含 AI 生成结果。', now,
}), '本地空白分集', now);
if (new URLSearchParams(location.search).get('fixture') === 'empty') {
  document.episodes = [];
  document.activeEpisodeId = 'episode-not-created-yet';
  document.sourceDocument = {
    kind: 'script', adaptationMode: 'faithful-script', originalText: '雨夜，小林收到一封信。', importedAt: now,
    episodes: [{ id: 'source-empty-1', number: 1, title: '尚未规划的源分集', sourceText: '雨夜，小林收到一封信。' }],
  };
  // Exercise a schema-valid project through the actual page loader.
  parseMotionComicPipelineData(JSON.stringify(document));
}
const task = { id: document.id, title: document.title, taskType: 'motion-comic', pipelineData: JSON.stringify(document), createdAt: now, status: 'draft' } as Task;
const controls = { apiCalls: [] as string[], forbiddenCalls: [] as string[], shellNavigation: [] as string[] };
const reads: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  getTaskDetail: async () => task,
  getFinalFilmGate: async () => null,
  listDirectorBatches: async () => [],
  getMotionComicScripts: async () => { throw new Error('No generated script batch in this local fixture'); },
};
const api = new Proxy({}, {
  get(_target, key: string) {
    return (...args: unknown[]) => {
      controls.apiCalls.push(key);
      if (reads[key]) return reads[key](...args);
      controls.forbiddenCalls.push(key);
      return Promise.reject(new Error(`Shell fixture forbids API operation: ${key}`));
    };
  },
}) as StoryDreamApi;
const state: RendererAppState = {
  config: structuredClone(defaultConfig), secretStatus: {}, tasks: [task],
  events: [], viralAnalyses: [], viralEvents: [], promptTemplates: [], draftTemplates: [],
  imageLabRecords: [], voiceLabRecords: [], customStyles: [], customCoverTemplates: [],
  creditTransactions: [], minimaxCloneVoices: [], account: { ...defaultAccount },
  // Keep the genuine default INACTIVE display. This does not assert licensed access.
  activation: { ...defaultActivation }, ui: { ...defaultUiPreferences, activeView: 'motion-comic' },
};
const noop = () => {};
const svgFrame = (color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='${color}'/></svg>`)}`;
const frameOptions = [{ id: 'frame-a', label: '画面 1', url: svgFrame('#8a4b3a') }, { id: 'frame-b', label: '画面 2', url: svgFrame('#3a5a8a') }];
Object.assign(window, { comicShellQA: controls });
const shots: DirectorShot[] = Array.from({ length: 8 }, (_, index) => ({
  id: `shot-${index}`, index: index + 1, title: `本地镜头 ${index + 1}`, scene: '测试场景', durationMs: 8000,
  framing: '中景', characterLabel: '角色', prompt: '本地布局验证', motionPrompt: '', subtitle: '',
  subtitleCues: [{ id: `cue-${index}`, text: '字幕片段', startMs: index * 8000, endMs: index * 8000 + 4000 }],
  soundClips: ['dialogue', 'music', 'sfx', 'ambience'].map((trackType, n) => ({ id: `sound-${index}-${n}`, assetVersionId: `asset-${n}`, trackType: trackType as 'music', title: `本地${trackType}`, startMs: index * 8000 + 1000, durationMs: 6000, available: false })),
}));
function TimelineFixture() {
  const [editableShots, setEditableShots] = useState(shots);
  const [savedShots, setSavedShots] = useState<DirectorShot[]>([]);
  const [edits, setEdits] = useState<string[]>([]);
  const dirty = edits.length > 0 && JSON.stringify(editableShots) !== JSON.stringify(savedShots);
  useEffect(() => { Object.assign(window, { timelineStateQA: { shots: editableShots, savedShots, edits } }); }, [editableShots, savedShots, edits]);
  const updateShot: NonNullable<Parameters<typeof DirectorDeskWorkspace>[0]['onUpdateShot']> = (id, patch) => setEditableShots(current => current.map(shot => shot.id === id ? { ...shot, ...patch } : shot));
  const updateSubtitle: NonNullable<Parameters<typeof DirectorDeskWorkspace>[0]['onUpdateSubtitleCue']> = (shotId, cueId, patch) => {
    setEditableShots(current => current.map(shot => shot.id === shotId ? { ...shot, subtitleCues: shot.subtitleCues?.map(cue => cue.id === cueId ? { ...cue, ...patch } : cue) } : shot));
    setEdits(current => [...current, `subtitle:${cueId}`]);
  };
  const updateSound: NonNullable<Parameters<typeof DirectorDeskWorkspace>[0]['onUpdateSoundClip']> = (shotId, clipId, patch) => {
    setEditableShots(current => current.map(shot => shot.id === shotId ? { ...shot, soundClips: shot.soundClips?.map(clip => clip.id === clipId ? { ...clip, ...patch } : clip) } : shot));
    setEdits(current => [...current, `sound:${clipId}`]);
  };
  const reorder = (shotId: string, targetId: string) => {
    setEditableShots(current => {
      const next = [...current];
      const from = next.findIndex(shot => shot.id === shotId), to = next.findIndex(shot => shot.id === targetId);
      if (from < 0 || to < 0 || from === to) return current;
      next.splice(to, 0, next.splice(from, 1)[0]);
      let offset = 0;
      return next.map((shot, index) => {
        const oldOffset = current.slice(0, current.findIndex(item => item.id === shot.id)).reduce((sum, item) => sum + item.durationMs, 0);
        const delta = offset - oldOffset;
        offset += shot.durationMs;
        return { ...shot, index: index + 1, subtitleCues: shot.subtitleCues?.map(cue => ({ ...cue, startMs: cue.startMs + delta, endMs: cue.endMs + delta })), soundClips: shot.soundClips?.map(clip => ({ ...clip, startMs: clip.startMs + delta })) };
      });
    });
    setEdits(current => [...current, `reorder:${shotId}:${targetId}`]);
  };
  const save = () => setSavedShots(structuredClone(editableShots));
  const [selected, setSelected] = useState('shot-0');
  const storyboard = new URLSearchParams(location.search).get('stage') === 'storyboard';
  const [stage, setStage] = useState<'export' | 'video'>(new URLSearchParams(location.search).get('stage') === 'production' ? 'video' : 'export');
  const stages = Object.fromEntries(['source','episodes','scenes','assets','storyboard','video','audio','export'].map(key => [key, { ready: true, complete: false, detail: '本地布局验证' }])) as any;
  if (storyboard) {
    const episode = { ...document.episodes[0], scenes: [{ ...document.episodes[0].scenes[0], shots: shots.map(shot => ({ ...document.episodes[0].scenes[0].shots[0], id: shot.id })) }] };
    return <MotionComicProductionWorkspace document={document} stage="storyboard" stageState={stages} showProjectHeader headerActions={<><ProjectModelBar inline task={{ id: 'fixture-project', title: document.title, status: 'draft' }} config={defaultConfig} api={{} as StoryDreamApi} onUpdated={noop} /><Button density='compact' variant='subtle'>后台任务</Button></>} dirty={false} busy={false} onSave={noop} onNewProject={noop} onBack={noop} onStageChange={noop}><MotionComicMakeFixture episode={episode} shots={shots} /></MotionComicProductionWorkspace>;
  }
  return <MotionComicProductionWorkspace document={document} stage={stage} stageState={stages} showProjectHeader={false} dirty={false} busy={false} onSave={noop} onNewProject={noop} onBack={noop} onStageChange={next => setStage(next === 'export' ? 'export' : 'video')}>
    <DirectorDeskWorkspace mode="motion-comic" projectTitle="图10 · 本地布局验证" projectMeta="无付费调用" episodeTitle="第一集" stageLabel={stage === 'export' ? '导出' : '视频生成'} shots={editableShots} selectedShotId={selected} dirty={dirty} onSelectShot={setSelected} onUpdateShot={updateShot} onSave={save} onReorderTimelineShot={reorder} onUpdateSubtitleCue={updateSubtitle} onImportSound={async () => {}} onUpdateSoundClip={updateSound} onRemoveSoundClip={noop} />
  </MotionComicProductionWorkspace>;
}
createRoot(window.document.getElementById('root')!).render(
  <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider>
    <AppShell activeView="motion-comic" returnView="history" state={state} saveTone="saved"
      isBrowserPreview={new URLSearchParams(location.search).get('runtime') === 'browser-fallback'} busy={false} feedback={null} navigate={(view) => controls.shellNavigation.push(view)}
      openTaskDetail={(id) => controls.shellNavigation.push(`task:${id}`)} minimizeWindow={noop}
      toggleMaximizeWindow={noop} closeWindow={noop} toggleTheme={noop} updateStatus={null}
      updateBusy={false} updateAction={null} openAnnouncements={noop} checkForUpdate={noop}
      downloadUpdate={noop} installUpdate={noop}>
      <TimelineFixture />
    </AppShell>
  </WorkspaceNavigationProvider></StoryDreamProvider>,
);
