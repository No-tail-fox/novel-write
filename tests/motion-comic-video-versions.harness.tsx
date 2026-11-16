// OFFLINE FIXTURE: real component + shared adoption; no IPC/provider or paid generation.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicVideoVersions } from '../src/features/motion-comic/MotionComicVideoVersions';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { motionComicVideoInputHash } from '../src/shared/motion-comic-video';
import { adoptMotionComicVideoVersion } from '../src/shared/motion-comic-video-versions';
import '../src/styles.css';
const now = '2026-09-18T00:00:00.000Z';
function fixture() {
  const doc = createMotionComicStarterProject(createMotionComicDraft({ id: 'offline-versions', title: '离线 fixture', premise: '测试', now }), '第一集', now);
  const shot = doc.episodes[0].scenes[0].shots[0];
  shot.renderStrategy = 'remote-video'; shot.firstFrameAssetVersionId = 'frame';
  doc.assets.push({ id: 'frame', assetId: 'frame', kind: 'image', localPath: 'fixture/frame.png', createdAt: now });
  addCandidate(doc, 'old'); shot.videoAssetVersionId = 'old'; shot.videoJobId = 'job-old';
  doc.episodes[0].timeline.clips.find(c => c.shotId === shot.id)!.assetVersionIds = ['frame', 'old'];
  return doc;
}
function addCandidate(doc: ReturnType<typeof createMotionComicStarterProject>, id: string) {
  const shot = doc.episodes[0].scenes[0].shots[0];
  doc.providerJobs.push({ id: `job-${id}`, workflowKind: 'motion-comic', nodeId: shot.id, episodeId: shot.episodeId, providerId: 'fixture', model: 'fixture', capability: 'image-to-video', status: 'completed', inputHash: motionComicVideoInputHash(doc, shot, 'fixture', 'fixture'), idempotencyKey: id, estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now });
  doc.assets.push({ id, assetId: `shot-video-${shot.id}`, episodeId: shot.episodeId, kind: 'video', localPath: `fixture/${id}.webm`, providerJobId: `job-${id}`, selected: id === 'old', createdAt: now });
}
const counts = { generate: 0, adopt: 0, read: 0 };
Object.assign(window, { fixtureCounts: counts });
const delay = () => new Promise(resolve => setTimeout(resolve, 350));
// Playable local synthetic fixture, recorded entirely in the browser, not model output.
async function localFixtureMedia() {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#18424f'; context.fillRect(0, 0, 320, 180);
  context.fillStyle = 'white'; context.font = '22px sans-serif'; context.fillText('OFFLINE VIDEO FIXTURE', 15, 90);
  const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  const chunks: BlobPart[] = [];
  const finished = new Promise<string>(resolve => { recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))); }; });
  recorder.start();
  for (let frame = 0; frame < 12; frame++) {
    context.fillStyle = frame % 2 ? '#18424f' : '#245868'; context.fillRect(0, 0, 320, 180);
    context.fillStyle = 'white'; context.fillText('OFFLINE VIDEO FIXTURE', 15, 90);
    context.fillRect(frame * 20, 150, 20, 5);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  recorder.stop(); return finished;
}
const media = localFixtureMedia();
function Fixture() {
  const [doc, setDoc] = useState(fixture);
  const [failRead, setFailRead] = useState(false), [failGenerate, setFailGenerate] = useState(false);
  const shot = doc.episodes[0].scenes[0].shots[0];
  Object.assign(window, { fixtureDocument: doc });
  return <StoryDreamProvider theme="dark"><main style={{ maxWidth: 850, margin: 'auto', padding: 20 }}>
    <h1>离线视频候选组件 fixture</h1><p>无真实生成、无 IPC、无付费调用。媒体为浏览器本地合成测试片。</p>
    <output aria-label="当前绑定">{shot.videoAssetVersionId}</output>
    <button onClick={() => setFailRead(!failRead)}>切换读取失败 fixture</button>
    <button onClick={() => setFailGenerate(!failGenerate)}>切换生成失败 fixture</button>
    <button onClick={() => setDoc(current => { const next = structuredClone(current); next.episodes[0].scenes[0].shots[0].motionPrompt += ' changed'; return next; })}>使候选过期 fixture</button>
    <button onClick={() => setDoc(current => { const next = structuredClone(current); Object.assign(next.providerJobs[0], { status: 'unknown' }); return next; })}>未知任务 fixture</button>
    <MotionComicVideoVersions document={doc} shot={shot} busy={false} readVideo={async () => { counts.read++; await delay(); if (failRead) throw new Error('fixture：本地视频读取失败，请检查文件。'); return media; }}
      onGenerateCandidate={async () => { counts.generate++; await delay(); if (failGenerate) throw new Error('fixture：生成请求失败，不会自动重试。'); setDoc(current => { const next = structuredClone(current); addCandidate(next, `candidate-${counts.generate}`); return next; }); }}
      onAdopt={async id => { counts.adopt++; await delay(); setDoc(current => adoptMotionComicVideoVersion(current, shot.episodeId, shot.id, id)); }} />
  </main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
