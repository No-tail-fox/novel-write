// Isolated UI QA: real components and canonical request validation; no provider or IPC calls.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicMakeWorkspace } from '../src/features/motion-comic/MotionComicMakeWorkspace';
import { MotionComicVideoReadiness } from '../src/features/motion-comic/MotionComicVideoReadiness';
import { MotionComicFramePanel } from '../src/features/motion-comic/MotionComicFramePanel';
import { createMotionComicDraft, createMotionComicStarterProject, type MotionComicShot } from '../src/shared/motion-comic';
import { buildMotionComicShotVideoRequest } from '../src/shared/motion-comic-video';
import type { DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import '../src/styles.css';
import '../src/styles/features/motion-comic.css';
import '../src/styles/features/motion-comic-production-layout.css';
const initial = createMotionComicStarterProject(createMotionComicDraft({ id: 'direct-video-qa', title: '参考图直出视频验证', premise: '雨夜收到来信。' }));
const canonical = initial.episodes[0].scenes[0].shots[0];
initial.episodes[0].scenes = [{ ...initial.episodes[0].scenes[0], shots: [canonical] }];
const owners = [...initial.characters.flatMap(c => c.looks).filter(l => canonical.characterLookIds.includes(l.id)), ...initial.sceneAssets.filter(s => s.id === canonical.sceneAssetId), ...initial.props.filter(p => canonical.propAssetIds.includes(p.id))];
for (const owner of owners) {
  const id = `reference-${owner.id}`;
  owner.referenceAssetVersionIds = [id];
  initial.assets.push({ id, assetId: id, kind: 'image', localPath: `C:/fixture/${id}.png`, selected: true, pinned: true, createdAt: initial.createdAt });
}
const thumbnail = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#514d68"/><circle cx="160" cy="70" r="28" fill="#aaa0be"/><path d="M110 180 Q110 105 160 105 Q210 105 210 180" fill="#aaa0be"/></svg>')}`;
const qa = { imageMode: 'error', imageCalls: 0, requests: [] as unknown[], finish: () => {}, canonicalMode: '', ready: false, reason: '' };
Object.assign(window, { directVideoQA: qa });
const noop = () => {};
function Fixture() {
  const [document, setDocument] = useState(initial);
  const episode = document.episodes[0], shot = episode.scenes[0].shots[0];
  const patch = (value: Partial<MotionComicShot>) => setDocument(current => ({ ...current, episodes: current.episodes.map(e => ({ ...e, scenes: e.scenes.map(s => ({ ...s, shots: s.shots.map(item => item.id === shot.id ? { ...item, ...value } : item) })) })) }));
  let ready = true, reason = '';
  try { buildMotionComicShotVideoRequest(document, shot); } catch (error) { ready = false; reason = error instanceof Error ? error.message : String(error); }
  Object.assign(qa, { canonicalMode: shot.videoProduction?.referenceMode, ready, reason });
  const view: DirectorShot = { id: shot.id, index: 1, title: '雨夜来信', scene: '街角', durationMs: shot.durationMs, framing: '中景', characterLabel: '角色', prompt: shot.prompt || '雨夜街角，人物抬头看向远处的灯光。', motionPrompt: shot.motionPrompt || '镜头缓慢推进，人物转身。', subtitle: '', renderStrategy: 'living-poster', videoInputReady: ready, videoInputUnavailableReason: reason, videoFirstFrameReady: Boolean(shot.firstFrameAssetVersionId), videoLastFrameReady: false };
  return <main style={{height:'100vh', paddingTop:12, boxSizing:'border-box'}}><MotionComicMakeWorkspace episode={episode} shots={[view]} selectedShotId={shot.id} busy={false} providerConnected onSelectShot={noop} onUpdateShot={(_, value) => patch({ durationMs:value.durationMs ?? shot.durationMs, motionPrompt:value.motionPrompt ?? shot.motionPrompt })} onAddShot={noop} onRemoveShot={noop} onMoveShot={noop}
    assets={owners.map(owner => ({id:owner.id,label:owner.label,type:initial.characters.some(c => c.looks.some(l => l.id === owner.id)) ? '角色造型' as const : initial.sceneAssets.some(s => s.id === owner.id) ? '场景' as const : '道具' as const,selected:true,thumbnail}))} onToggleAsset={noop}
    onGenerateVideo={() => { qa.requests.push(buildMotionComicShotVideoRequest(document, shot)); }}
    onGenerateImage={async () => { qa.imageCalls++; if (qa.imageMode === 'pending') await new Promise<void>(resolve => { qa.finish = resolve; }); else throw new Error('生图服务暂时不可用，请重试。'); }}
    renderFrames={(_, busy) => <MotionComicFramePanel options={[]} busy={busy} onSetFirst={noop} onSetLast={noop} onUsePrevious={noop} />}
    renderWorkflow={(_, busy) => <MotionComicVideoReadiness compact remoteOnly shot={view} connected providerLabel='本地模拟服务' providerModel='参考图模型' providerOptions={[]} providerCapabilities={['reference-image']} busy={busy} outputRatio={document.ratio} production={shot.videoProduction} onProductionChange={value => patch({ videoProduction: { ...shot.videoProduction!, ...value } })} onStrategyChange={noop} />}
    renderCandidates={() => <section className='motion-comic-video-versions'><p className='motion-comic-video-versions__empty'>尚无视频候选</p></section>} /></main>;
}
createRoot(window.document.getElementById('root')!).render(<StoryDreamProvider theme='dark'><Fixture /></StoryDreamProvider>);
