import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectorDeskWorkspace, type DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import { StoryDreamProvider } from '../src/ui';
import '../src/styles.css';

const svgUrl = (body: string) => `data:image/svg+xml,${encodeURIComponent(body)}`;
const background = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#e9ddbd"/><path d="M0 850 Q500 600 980 850 T1920 800 V1080 H0Z" fill="#527861"/><path d="M0 970 Q600 680 1300 1010 T1920 920 V1080 H0Z" fill="#324f48"/></svg>');
const subject = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="650"><circle cx="250" cy="160" r="95" fill="#db9672"/><path d="M95 620V350Q100 255 250 265Q400 255 405 350V620Z" fill="#bd543d"/><path d="M164 155Q158 60 245 55Q344 40 348 145L314 118L285 150L225 114L170 166Z" fill="#302e28"/></svg>');
const steady = [{ atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }];
const initialShot: DirectorShot = {
  id: 'collage', index: 1, title: '分层素材独立运动', scene: '', framing: '', characterLabel: '', subtitle: '',
  durationMs: 4000, prompt: '独立背景与主体素材', motionPrompt: '主体从左侧进入，数据标签随后出现',
  thumbnail: background, imageReady: true, imageGenerationCount: 2, renderStrategy: 'deterministic-layers',
  cameraKeyframes: [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }],
  previewLayers: [
    { id: 'background', label: '背景', kind: 'background', src: background, zIndex: 0, depth: 0, width: 1, height: 1, motion: steady },
    { id: 'subject', label: '独立主体', kind: 'subject', src: subject, zIndex: 1, depth: 0, width: 0.38, height: 0.78, fit: 'contain', motion: [
      { atMs: 0, x: -0.18, y: 0.57, scale: 0.85, rotation: -12, opacity: 0 },
      { atMs: 1200, x: 0.4, y: 0.57, scale: 1, rotation: 2, opacity: 1 },
      { atMs: 4000, x: 0.4, y: 0.57, scale: 1.02, rotation: 0, opacity: 1 },
    ] },
    { id: 'label', label: '文字标签', kind: 'label', zIndex: 2, depth: 0, width: 0.35, height: 0.2, content: { type: 'text', text: '分层素材独立运动' }, motion: [
      { atMs: 0, x: 0.78, y: 0.8, scale: 0.8, rotation: 0, opacity: 0 },
      { atMs: 800, x: 0.78, y: 0.8, scale: 0.8, rotation: 0, opacity: 0 },
      { atMs: 1500, x: 0.75, y: 0.55, scale: 1, rotation: -3, opacity: 1 },
      { atMs: 4000, x: 0.75, y: 0.55, scale: 1, rotation: -3, opacity: 1 },
    ] },
  ],
};
const controls = { useTextOnly: () => {}, useSubjectOnly: () => {}, useLocal: () => {}, useMissing: () => {}, generationCalls: 0 };
Object.assign(window, { voxPreviewQA: controls });
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;

function Host() {
  const [shot, setShot] = useState(initialShot);
  controls.useTextOnly = () => setShot({ ...initialShot, thumbnail: undefined, previewLayers: [{ ...initialShot.previewLayers![2], motion: steady }] });
  controls.useSubjectOnly = () => setShot({ ...initialShot, previewLayers: initialShot.previewLayers!.filter((layer) => layer.id !== 'background') });
  controls.useLocal = () => setShot(initialShot);
  controls.useMissing = () => setShot({ ...initialShot, imageReady: false, imageGenerationCount: 1, imageUnavailableReason: '还缺少独立主体素材，请补齐后生成成片。', previewLayers: initialShot.previewLayers!.map((layer) => layer.id === 'subject' ? { ...layer, src: undefined } : layer) });
  return <DirectorDeskWorkspace mode="vox" projectTitle="VOX 双链路验收" projectMeta="本地测试素材" episodeTitle="第一集" stageLabel="镜头生成"
    shots={[shot]} selectedShotId={shot.id} dirty={false} providerConnected providerLabel="本地验收服务" providerModel="素材测试" videoProviderLabel="视频服务未配置"
    onSelectShot={() => {}} onSave={() => {}} onUpdateShot={(_, patch) => setShot((current) => ({ ...current, ...patch, previewLayers: patch.title === undefined ? current.previewLayers : current.previewLayers?.map((layer) => layer.id === 'label' ? { ...layer, content: { type: 'text', text: patch.title! } } : layer) }))}
    onGenerateShot={async () => { controls.generationCalls += 1; return { thumbnail: background, provider: '本地验收' }; }}
  />;
}

createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme={theme}><Host /></StoryDreamProvider>);
