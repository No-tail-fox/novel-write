import { useState } from 'react';
import type { DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import type { MotionComicPipelineData, MotionComicVideoProduction } from '../src/shared/motion-comic';
import { MotionComicMakeWorkspace } from '../src/features/motion-comic/MotionComicMakeWorkspace';
import { MotionComicFramePanel } from '../src/features/motion-comic/MotionComicFramePanel';
import { MotionComicVideoReadiness } from '../src/features/motion-comic/MotionComicVideoReadiness';
import '../src/styles/features/motion-comic-production-layout.css';

// UI-only bridge fixture. Managed byte import/persistence is covered by frame-import and backend tests.
const noop = () => {};
const image = (color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`)}`;
const options = [{ id: 'frame-a', label: '测试画面 A', url: image('#8a4b3a') }, { id: 'frame-b', label: '测试画面 B', url: image('#3a5a8a') }];
const qa = { mode: 'success', calls: [] as string[], generated: [] as string[], finish: () => {} };
Object.assign(window, { makeQA: qa });
export function MotionComicMakeFixture({ episode, shots: initial }: { episode: MotionComicPipelineData['episodes'][number]; shots: DirectorShot[] }) {
  const [shots, setShots] = useState(initial.map(shot => ({ ...shot, renderStrategy: 'living-poster' as const, videoInputReady: true, motionPrompt: '镜头缓慢推进，人物转身望向远处，保持构图与光线连续。' })));
  const [selected, setSelected] = useState(shots[0].id);
  const [bindings, setBindings] = useState<Record<string, string[]>>({ [shots[0].id]: ['asset-3'] });
  const assets = ['凌皓', '陆跃', '慈蕊', '云城城南废弃厂区门口', '废弃工厂内部', '黑色商务车', '旧报纸', '手提箱'].map((label, index) => ({ id: `asset-${index}`, label, type: index < 3 ? '角色造型' as const : index < 5 ? '场景' as const : '道具' as const, selected: (bindings[selected] ?? []).includes(`asset-${index}`), thumbnail: options[index % 2].url }));
  const [frames, setFrames] = useState<Record<string, { first?: string; last?: string }>>({});
  const [production, setProduction] = useState<MotionComicVideoProduction>({ version: 1, referenceMode: 'frames', audioMode: 'post-mix' });
  const patchFrame = (id: string, slot: 'first' | 'last', value?: string) => setFrames(current => ({ ...current, [id]: { ...current[id], [slot]: value } }));
  const state = new URLSearchParams(location.search).get('state');
  return <MotionComicMakeWorkspace episode={episode} shots={shots} selectedShotId={selected} busy={state === 'busy'} providerConnected onSelectShot={setSelected}
    onUpdateShot={(id, patch) => setShots(current => current.map(shot => shot.id === id ? { ...shot, ...patch, renderStrategy: 'living-poster' as const, videoInputReady: true } : shot))}
    onUpdateSubtitleCue={(shotId, cueId, text) => setShots(current => current.map(shot => shot.id === shotId ? { ...shot, subtitleCues: shot.subtitleCues?.map(cue => cue.id === cueId ? { ...cue, text } : cue) } : shot))}
    assets={assets} onToggleAsset={asset => setBindings(current => ({ ...current, [selected]: asset.selected ? (current[selected] ?? []).filter(id => id !== asset.id) : [...(current[selected] ?? []), asset.id] }))}
    onAddShot={noop} onRemoveShot={noop} onMoveShot={noop} onGenerateImage={noop} onGenerateVideo={async id => { qa.generated.push(id); if (qa.mode === 'video-pending') await new Promise<void>(resolve => { qa.finish = resolve; }); }}
    renderFrames={(id, busy) => <MotionComicFramePanel key={id} firstId={frames[id]?.first} lastId={frames[id]?.last} previousId={id !== shots[0].id ? 'frame-a' : undefined} options={options} busy={busy}
      onSetFirst={value => patchFrame(id, 'first', value)} onSetLast={value => patchFrame(id, 'last', value)} onUsePrevious={() => patchFrame(id, 'first', 'frame-a')}
      onImport={async (slot, signal, onPhase) => {
        qa.calls.push(`${id}:${slot}`);
        if (qa.mode === 'cancel') return;
        if (qa.mode === 'error') throw new Error('图片格式无法读取，请重新选择 PNG 或 JPEG 图片。');
        if (qa.mode === 'pending') await new Promise<void>(resolve => { qa.finish = resolve; });
        signal.throwIfAborted(); onPhase('saving');
        patchFrame(id, slot, slot === 'first' ? 'frame-a' : 'frame-b');
      }} />}
    renderWorkflow={(id, busy) => <MotionComicVideoReadiness compact outputRatio='9:16' shot={{ ...shots.find(shot => shot.id === id)!, videoJobStatus: state === 'failed' ? 'failed' : undefined, videoJobError: state === 'failed' ? '服务暂时不可用，请重试。' : undefined }} connected={state !== 'disconnected'} providerLabel='测试视频服务' providerModel='测试模型' providerOptions={[]} busy={busy} remoteOnly providerCapabilities={['reference-image', 'synchronized-audio', 'reference-audio']} production={production} onProductionChange={patch => setProduction(current => ({ ...current, ...patch }))} onStrategyChange={noop} onConfigureProvider={noop} unavailableReason={state === 'disconnected' ? '请先配置并连接视频模型。' : undefined} referenceAudioOptions={[{ value: 'voice-1', label: '对白音频' }]} unitError={state === 'unit-error' ? '当前镜头超过模型时长上限，请拆分。' : undefined} />}
    renderCandidates={() => <section className='motion-comic-video-versions'><div className='motion-comic-video-versions__heading'><strong>候选历史</strong><span>0 个版本</span></div><p className='motion-comic-video-versions__empty'>生成后可在这里比较并采用视频版本。</p></section>} />;
}
