import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { FileDatabase } from '../src/shared/storage';
import { createHtmlVideoTaskInput } from '../src/shared/html-video-workflow';
import type { Task } from '../src/shared/types';

const profile = resolve(process.argv[2]);
await mkdir(join(profile, 'storydream'), { recursive: true });
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
const projects: Task[] = [];
try {
  for (let index = 0; index < 496; index += 1) {
    const task = await db.createTask({
      title: `分页项目 ${String(index).padStart(3, '0')}`,
      taskType: 'story',
      inputText: index === 0 ? '完整正文验证。'.repeat(1800) + '全文末尾令牌' : `第 ${index} 项内容`,
      pipelineData: '{}',
    });
    await db.updateTask(task.id, { status: 'draft', ...(index === 495 ? { ordinaryCoverAsset: {
      version: 1, mode: 'manual', path: join(profile, 'missing-cover.png'), originalName: 'missing-cover.png',
      sizeBytes: 100, width: 1280, height: 720, mimeType: 'image/png', sha256: 'a'.repeat(64), ratio: '16:9', createdAt: task.createdAt,
    } } : {}) });
    projects.push(task);
  }
  projects.push(await db.createTask({ title: '音乐 MV 重开验证', taskKind: 'music-mv', taskType: 'music-mv', inputText: '第一句歌词\n第二句歌词' }));
  await db.updateTask(projects.at(-1)!.id, { status: 'draft' });
  projects.push(await db.createTask({ ...createHtmlVideoTaskInput({ copy: 'HTML 动画重开验证。第二段内容。' }), title: 'HTML 重开验证' }));
  await db.updateTask(projects.at(-1)!.id, { status: 'draft' });
  projects.push(await db.createEditorialCollageTask({ title: 'VOX 重开验证', sourceText: '第一段正文。第二段正文。', durationMs: 'auto' }));
  projects.push(await db.createMotionComicTask({ title: '漫剧重开验证', premise: '系列与角色验证。' }));
  await db.upsertUiPreferences({ activeView: 'projects' });
  await db.upsertUiPreferences({ theme: 'light' });
  const first = await db.listTaskSummaries({ limit: 50 });
  assert.equal(first.totalCount, 500);
  const ids = new Set<string>();
  let current = first;
  let pages = 0;
  do {
    pages += 1;
    assert.equal(current.items.length, 50);
    for (const item of current.items) {
      assert(!ids.has(item.id));
      ids.add(item.id);
      for (const heavy of ['inputText', 'pipelineData', 'selectedSources', 'musicMv']) assert(!(heavy in item));
      assert(item.inputPreview.length <= 160);
    }
    if (!current.nextCursor) break;
    current = await db.listTaskSummaries({ limit: 50, cursor: current.nextCursor });
  } while (true);
  assert.equal(ids.size, 500);
  assert.equal(pages, 10);
  assert.equal((await db.listTaskSummaries({ query: '全文末尾令牌' })).items[0].id, projects[0].id);
  await writeFile(join(profile, 'seed.json'), JSON.stringify({ projects: projects.map(({ id, title, taskType }) => ({ id, title, taskType })), count: ids.size, pages, heavyFieldsExcluded: true, fullTextSearch: true }), 'utf8');
  console.log(JSON.stringify({ count: ids.size, pages, heavyFieldsExcluded: true, fullTextSearch: true }));
} finally {
  await db.close();
}
