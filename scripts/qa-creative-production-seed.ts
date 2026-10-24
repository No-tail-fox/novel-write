/** Isolated migration acceptance: reuse an actual completed plan and paid voices. */
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';

const profile = resolve(process.argv[2]);
const source = resolve('.artifacts/vox-production-data/document.json');
const live = join(process.env.APPDATA!, 'storydream');
await mkdir(join(profile, 'storydream'), { recursive: true });
await copyFile(join(live, 'Local State'), join(profile, 'Local State'));
for (const file of ['config.json', 'secrets.v1.json']) await copyFile(join(live, 'storydream', file), join(profile, 'storydream', file));
const original = parseEditorialCollagePipelineData(JSON.parse(await readFile(source, 'utf8')));
if (original.productionRun?.status !== 'completed' || original.productionRun.nodes.some(n => n.status !== 'completed')) throw new Error('Only fully completed real samples may be migrated');
if (!original.sourceText) throw new Error('The source narration is required.');
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
try {
  const task = await db.createEditorialCollageTask({ title: '创意动画 · NASA 数据风格代码验收', sourceText: original.sourceText, ratio: original.ratio, durationMs: 'auto' });
  const fresh = parseEditorialCollagePipelineData(task.pipelineData);
  const document = { ...original, id: task.id, title: task.title ?? original.title, createdAt: fresh.createdAt, updatedAt: fresh.updatedAt };
  await db.saveEditorialCollageTask({ id: task.id, expectedUpdatedAt: fresh.updatedAt, document }, document.productionRun!.id);
  const other = await db.createEditorialCollageTask({ title: '后台制作隔离验收', sourceText: '保留这个项目的原始内容。', durationMs: 15000 });
  await db.upsertUiPreferences({ activeView: 'projects' });
  await db.upsertUiPreferences({ theme: 'dark' });
  await writeFile(join(profile, 'seed.json'), JSON.stringify({ id: task.id, other: other.id, source, sourceText: original.sourceText,
    settings: { ...original.productionRun!.settings, authoring: { mode: 'ai-code', styleId: 'dataviz' } },
    reusePaidRequests: Object.fromEntries(original.productionRun!.nodes.filter(n => n.paid).map(n => [n.id, n.requestId])),
  }, null, 2), 'utf8');
} finally { await db.close(); }
