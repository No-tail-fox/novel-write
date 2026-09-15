import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { createHtmlVideoTaskInput, parseHtmlVideoPipelineData } from '../src/shared/html-video-workflow';

const profile = resolve(process.argv[2]);
await mkdir(join(profile, 'storydream'), { recursive: true });
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
try {
  const html = await db.createTask({ ...createHtmlVideoTaskInput({ copy: '第一段文案。第二段内容。' }), title: 'HTML 返回验证' });
  const pipeline = parseHtmlVideoPipelineData(html.pipelineData);
  pipeline.compositions = pipeline.scenes.map(({ index }) => ({ index, durationSec: 6, canvas: { w: 1280, h: 720 }, audio: { src: '', durationSec: 6 }, background: { src: '' }, captions: [] }));
  parseHtmlVideoPipelineData(JSON.stringify(pipeline));
  await db.updateTask(html.id, { status: 'draft', pipelineData: JSON.stringify(pipeline) });
  const mv = await db.createTask({ title: '音乐 MV 返回验证', taskType: 'music-mv', taskKind: 'music-mv', inputText: '第一句歌词\n第二句歌词' });
  await db.updateTask(mv.id, { status: 'draft' });
  await db.upsertUiPreferences({ activeView: 'projects', theme: 'light' });
} finally {
  await db.close();
}
