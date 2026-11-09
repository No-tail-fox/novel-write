import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import { createHtmlVideoTaskInput } from '../src/shared/html-video-workflow';

const profile = resolve(process.argv[2]);
await mkdir(join(profile, 'storydream'), { recursive: true });
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
try {
  const base = normalizeAppConfig(defaultConfig);
  const config = normalizeAppConfig({ ...base,
    activeLlmProfileId: 'llm-a', llmProfiles: ['a', 'b'].map(id => ({ ...base.llm, id: `llm-${id}`, name: `语言配置 ${id.toUpperCase()}`, model: `text-${id}`, apiKey: '', enabled: id === 'a' })),
    activeImageProfileId: 'image-a', imageProfiles: ['a', 'b', 'missing'].map(id => ({ ...base.imageProfiles[0], id: `image-${id}`, name: `生图配置 ${id.toUpperCase()}`, provider: 'gpt_image', enabled: id === 'a', gptImage: { ...base.gptImage, model: `image-${id}`, apiKey: '' } })),
    video: { ...base.video, activeProviderId: 'video-a', providers: ['a', 'b'].map(id => ({ ...base.video.providers[0], id: `video-${id}`, name: `视频配置 ${id.toUpperCase()}`, model: `video-${id}`, apiKey: '', enabled: id === 'a' })) },
  });
  await db.upsertConfig(config);
  const projects = [];
  const normal = await db.createTask({ title: '普通项目 · 固定模型', taskType: 'story', inputText: '演示项目的所有步骤使用相同模型。' });
  await db.updateTask(normal.id, { status: 'draft' }); projects.push(normal);
  projects.push(await db.createEditorialCollageTask({ title: '创意动画 · 固定模型', sourceText: '第一段介绍主题。第二段呈现内容。', durationMs: 'auto' }));
  projects.push(await db.createMotionComicTask({ title: 'AI 漫剧 · 固定模型', premise: '角色在城市中寻找线索。' }));
  const html = await db.createTask({ ...createHtmlVideoTaskInput({ copy: 'HTML 动画演示。第二段内容。' }), title: 'HTML 动画 · 固定模型' });
  await db.updateTask(html.id, { status: 'draft' }); projects.push(html);
  const missing = await db.createTask({ title: '配置已删除 · 需要重选', inputText: '配置缺失演示', projectModels: { llmProfileId: 'llm-a', imageProfileId: 'image-missing', videoProviderId: null } });
  await db.updateTask(missing.id, { status: 'draft' }); projects.push(missing);
  const paused = await db.createTask({ title: '暂停项目 · 仅可查看', inputText: '暂停演示' });
  await db.updateTask(paused.id, { status: 'paused' }); projects.push(paused);
  const archived = await db.createTask({ title: '归档项目 · 仅可查看', inputText: '归档演示' });
  await db.updateTask(archived.id, { status: 'draft' }); await db.archiveTask(archived.id); projects.push(archived);
  await db.upsertConfig({ ...config, imageProfiles: config.imageProfiles.filter(p => p.id !== 'image-missing') });
  await db.upsertUiPreferences({ activeView: 'projects' });
  await db.upsertUiPreferences({ theme: 'light' as const });
  await writeFile(join(profile, 'seed.json'), JSON.stringify({ projects: projects.map(({ id, title, taskType }) => ({ id, title, taskType })) }), 'utf8');
} finally { await db.close(); }
