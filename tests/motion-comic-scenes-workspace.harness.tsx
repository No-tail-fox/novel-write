import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider, Button } from '../src/ui';
import { MotionComicScenesPanel } from '../src/features/motion-comic/MotionComicScenesPanel';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';

const initial = createMotionComicStarterProject(createMotionComicDraft({ id: 'scenes-workspace-qa', title: '场次工作台 QA', premise: '雨夜的信封', now: '2026-09-06T00:00:00.000Z' }));
const first = initial.episodes[0];
first.scenes = Array.from({ length: 9 }, (_, index) => ({ ...structuredClone(first.scenes[index % first.scenes.length]), id: `qa-scene-${index}`, index: index + 1, title: `雨夜线索场次 ${index + 1}`, actIndex: Math.floor(index / 3) + 1, actTitle: ['引子', '冲突', '转折'][Math.floor(index / 3)], actSource: 'manual' as const, shots: first.scenes[index % first.scenes.length].shots.map((shot, si) => ({ ...structuredClone(shot), id: `qa-shot-${index}-${si}`, title: `场次 ${index + 1} 的镜头 ${si + 1}` })) }));
if (new URLSearchParams(location.search).has('images')) {
  initial.assets.push({ id: 'qa-image', assetId: 'qa-image', kind: 'image', localPath: 'qa-frame.png', createdAt: initial.createdAt });
  first.scenes[0].shots[0].firstFrameAssetVersionId = 'qa-image';
  initial.sceneAssets[0].referenceAssetVersionIds = ['qa-image'];
}
const second = structuredClone(first); second.id = 'qa-episode-2'; second.number = 2; second.title = '第二集';
initial.episodes.push(second); initial.activeEpisodeId = first.id;
function App() {
  const [document, setDocument] = useState(initial);
  const guard = useRef<(() => boolean) | null>(null);
  const [allowed, setAllowed] = useState('尚未切换');
  const activeEpisode = document.episodes.find(episode => episode.id === document.activeEpisodeId)!;
  return <StoryDreamProvider theme="dark"><main style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 12 }}>
    <Button onClick={() => setAllowed(guard.current?.() === false ? '切换已阻止' : '允许切换')}>测试外部切换</Button><output>{allowed}</output>
    <MotionComicScenesPanel resolveMediaUrl={path => `${location.origin}/${path}`} document={document} activeEpisode={activeEpisode} onBack={() => setAllowed('返回剧本')} onContinue={() => setAllowed('进入资产')}
      onSelectEpisode={id => setDocument(current => ({ ...current, activeEpisodeId: id }))}
      onDraftGuardChange={value => { guard.current = value; }}
      onAddScene={() => {}} onSetActBoundary={() => {}} onRenameAct={() => {}}
      onUpdateScene={(id, patch) => setDocument(current => ({ ...current, episodes: current.episodes.map(episode => ({ ...episode, scenes: episode.scenes.map(scene => scene.id === id ? { ...scene, ...patch } : scene) })) }))}
      onUpdateShot={(id, patch) => setDocument(current => ({ ...current, episodes: current.episodes.map(episode => ({ ...episode, scenes: episode.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => shot.id === id ? { ...shot, ...patch } : shot) })) })) }))}
      onUpdateCue={() => {}} />
  </main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
