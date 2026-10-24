import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';

const profile = resolve(process.argv[2]);
await mkdir(join(profile, 'storydream'), { recursive: true });
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
try {
  const sourceText = '阿青收到一封信。';
  const paused = await db.createMotionComicTask({ title: '漫剧 · 剧本队列暂停', premise: sourceText, source: {
    kind: 'novel', adaptationMode: 'novel-adaptation', fileName: '来信.txt', originalText: sourceText, episodes: [{ title: '第一集', sourceText }],
  } });
  const imported = await db.motionComicScripts.readProject(paused.id);
  await db.motionComicScripts.enqueue({ id: paused.id, expectedUpdatedAt: imported.updatedAt, scope: 'missing' }, { provider: 'offline', model: 'offline' });
  await db.motionComicScripts.control(paused.id, 'pause');
  const review = await db.createMotionComicTask({ title: '漫剧 · 剧本待审核', premise: sourceText, source: {
    kind: 'novel', adaptationMode: 'novel-adaptation', fileName: '来信.txt', originalText: sourceText, episodes: [{ title: '第一集', sourceText }],
  } });
  const draft = await db.motionComicScripts.readProject(review.id);
  await db.motionComicScripts.enqueue({ id: review.id, expectedUpdatedAt: draft.updatedAt, scope: 'missing' }, { provider: 'offline', model: 'offline' });
  const claimed = (await db.motionComicScripts.claim(review.id))!;
  await db.motionComicScripts.finish(claimed, { issues: [], adjustments: [], script: {
    title: '来信', logline: '一封来信。', characters: [], props: [],
    sceneAssets: [{ key: 'room', label: '门厅', description: '门厅', prompt: '门厅', continuityNotes: '左侧光' }],
    scenes: [{ key: 'scene', actIndex: 1, actTitle: '来信', actBoundaryReason: '信件到来。', title: '来信', summary: '收到信件。', locationKey: 'room', beats: [{ key: 'beat', sourceUnitIds: ['S1'], kind: 'action', text: sourceText }] }],
  } });
  const completed = await db.createMotionComicTask({ title: '漫剧 · 成片已完成', premise: sourceText });
  const document = parseMotionComicPipelineData(completed.pipelineData);
  await db.saveMotionComicTask({ id: completed.id, expectedUpdatedAt: document.updatedAt, document: { ...document, stage: 'completed' } });
  const vox = await db.createEditorialCollageTask({ title: 'VOX · 实时后台任务', sourceText });
  await db.upsertUiPreferences({ activeView: 'projects' });
  await db.upsertUiPreferences({ theme: 'light' });
  await writeFile(join(profile, 'seed.json'), JSON.stringify({ paused: paused.id, review: review.id, completed: completed.id, vox: vox.id }), 'utf8');
} finally { await db.close(); }
