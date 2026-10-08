import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectorDeskWorkspace, type DirectorQueueItem, type DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import { StoryDreamProvider } from '../src/ui';
import '../src/styles.css';

const calls: string[] = [];
const scenario = new URLSearchParams(location.search).get('scenario') ?? 'single';
let videoAttempts = 0;
const shot: DirectorShot = { id: 'qa-shot', index: 1, title: '纸片主体进入画面', scene: '本地交互验收', framing: '中景', characterLabel: '旁白', subtitle: '旁白测试', durationMs: 4000, prompt: '独立背景和主体', motionPrompt: '主体滑入', renderStrategy: 'living-poster', videoInputReady: true, videoJobStatus: 'failed', imageReady: true, voiceReady: true };
const initialJobs: DirectorQueueItem[] = (['shot-image', 'shot-video', 'shot-voice', 'project-render'] as const).map((kind) => ({ id: `job-${kind}`, shotId: kind === 'project-render' ? 'qa-project' : shot.id, kind, title: { 'shot-image': '镜头 · 图片', 'shot-video': '镜头 · 图生视频', 'shot-voice': '镜头 · 旁白', 'project-render': '整片合成' }[kind], status: 'failed', progress: 0, cost: 0, provider: '本地模拟服务', error: '上次请求失败' }));

if (scenario === 'missing') {
  Object.assign(shot, { renderStrategy: 'deterministic-layers', imageReady: false, voiceReady: false });
  initialJobs.splice(0, initialJobs.length, { ...initialJobs[3], error: 'DIRECTOR_RENDER_PREFLIGHT_FAILED: 镜头 1 缺少旁白、独立背景和透明主体。' });
}

function Host() {
  const [jobs, setJobs] = useState(initialJobs);
  const [services, setServices] = useState({ image: true, video: true, voice: true });
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  Object.assign(window, { retryQA: { calls, disconnectUnrelated: () => setServices({ image: false, voice: false, video: true }), disconnectVideo: () => setServices((current) => ({ ...current, video: false })), setTheme: (next: 'dark' | 'light') => { document.documentElement.dataset.theme = next; setTheme(next); } } });
  const complete = async (kind: DirectorQueueItem['kind']) => {
    calls.push(kind!);
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (kind === 'shot-video' && scenario === 'batch' && videoAttempts++ === 0) throw new Error('模拟视频服务超时');
    if (kind === 'project-render' && scenario === 'single') throw new Error('DIRECTOR_RENDER_PREFLIGHT_FAILED: 镜头 1 缺少透明主体和已选旁白。');
    setJobs((current) => [{ ...initialJobs.find((job) => job.kind === kind)!, id: `attempt-${calls.length}`, status: 'completed', progress: 100 }, ...current]);
  };
  return <StoryDreamProvider theme={theme}><DirectorDeskWorkspace
    mode="vox" projectTitle="重试链路本地验收" projectMeta="模拟服务 · 不调用付费接口" episodeTitle="第一集" stageLabel="镜头生成"
    shots={[shot]} selectedShotId={shot.id} dirty={false} jobs={jobs} activeProjectId="qa-project" providerConnected={services.image} voiceConnected={services.voice} videoProviderConnected={services.video}
    providerUnavailableReason="图片服务已离线" voiceUnavailableReason="旁白服务已离线" videoProviderUnavailableReason="视频服务已离线，请重新连接"
    onSelectShot={() => {}} onUpdateShot={() => {}} onSave={() => {}}
    onGenerateShot={async () => { await complete('shot-image'); return { thumbnail: '', provider: 'mock' }; }}
    onGenerateVideo={async () => { calls.push('unexpected-new-video'); return { videoUrl: '', provider: 'mock' }; }}
    onRetryVideo={async () => { await complete('shot-video'); return { videoUrl: '', provider: 'mock' }; }}
    onGenerateVoice={async () => { await complete('shot-voice'); return { audioUrl: '', provider: 'mock' }; }}
    onRender={async () => { await complete('project-render'); }}
  /></StoryDreamProvider>;
}

createRoot(document.getElementById('root')!).render(<Host />);
