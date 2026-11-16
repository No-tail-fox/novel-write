import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { motionComicReferenceGenerationInput } from '../src/features/motion-comic/motion-comic-reference-generation';
import { motionComicVideoPrompt } from '../src/shared/motion-comic-video';
import { defaultCustomStyles } from '../src/shared/config';
import { FileDatabase } from '../src/shared/storage';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('motion comic persistence', () => {
  it('strictly validates dedicated create and save IPC requests', () => {
    const create = ipcInputSchemas['motion-comic:create'];
    expect(create.parse({ title: '雨夜来信', premise: '一封来自未来的信。', ratio: '9:16' })).toMatchObject({ ratio: '9:16' });
    expect(() => create.parse({ title: '雨夜来信', premise: '故事', runNow: true })).toThrow();
  });

  it.each(['preset', 'custom'])('persists %s style across reopening and feeds real image/video prompts', async (kind) => {
    const preset = defaultCustomStyles.find((style) => style.id === 'watercolor')!;
    const visualStyle = kind === 'preset' ? `${preset.name}：${preset.prefix}；${preset.suffix}` : '黑白铅笔线稿，保留纸张颗粒';
    const root = await mkdtemp(join(tmpdir(), 'storydream-motion-comic-style-'));
    cleanupPaths.push(root);
    const path = join(root, 'storydream.sqlite');
    const database = await FileDatabase.open(path);
    let id: string;
    try {
      const task = await database.createMotionComicTask({ title: '来信', premise: '邮局的来信', visualStyle: `  ${visualStyle}  ` });
      id = task.id;
      const document = parseMotionComicPipelineData(task.pipelineData);
      expect(document.series.visualRules).toContain(`视觉风格：${visualStyle}`);
      expect(document).not.toHaveProperty('visualStyle');
      await database.saveMotionComicTask({ id, expectedUpdatedAt: document.updatedAt, document });
    } finally { await database.close(); }
    const reopened = await FileDatabase.open(path);
    try {
      const task = await reopened.getTaskDetail(id!);
      const restored = parseMotionComicPipelineData(task!.pipelineData);
      expect(restored.series.visualRules).toContain(`视觉风格：${visualStyle}`);
      const document = createMotionComicStarterProject(restored);
      const input = motionComicReferenceGenerationInput(document, { kind: 'scene', id: document.sceneAssets[0].id }, {
        profileId: 'test', connected: true, provider: 'gpt_image', supportsReferenceImages: true,
        maxReferenceImages: 10, label: 'Test', model: 'test', resolution: '2K', quality: 'high',
      });
      expect(input.prompt).toContain(visualStyle);
      const shot = document.episodes[0].scenes[0].shots[0];
      const owners = [
        ...document.characters.flatMap(character => character.looks).filter(look => shot.characterLookIds.includes(look.id)),
        ...document.sceneAssets.filter(scene => scene.id === shot.sceneAssetId),
        ...document.props.filter(prop => shot.propAssetIds.includes(prop.id)),
      ];
      for (const owner of owners) {
        const referenceId = `reference-${owner.id}`;
        owner.referenceAssetVersionIds = [referenceId];
        document.assets.push({ id: referenceId, assetId: referenceId, kind: 'image', localPath: `C:/fixtures/${referenceId}.png`, selected: true, pinned: true, createdAt: document.createdAt });
      }
      expect(motionComicVideoPrompt(document, shot)).toContain(visualStyle);
      expect(restored.providerJobs).toEqual([]);
    } finally { await reopened.close(); }
  });

  it('keeps legacy defaults when visual style is omitted or blank', () => {
    const base = { id: 'legacy', title: '来信', premise: '邮局', now: '2026-10-20T00:00:00.000Z' };
    const legacy = createMotionComicDraft(base);
    expect(legacy.series.visualRules).toHaveLength(2);
    expect(createMotionComicDraft({ ...base, visualStyle: '  ' })).toEqual(legacy);
    expect(parseMotionComicPipelineData(JSON.stringify(legacy))).toEqual(legacy);
    expect(ipcInputSchemas['motion-comic:create'].parse({ title: '来信', premise: '邮局', visualStyle: '  ' }).visualStyle).toBe('');
  });

  it('creates a task-backed series project and rejects stale saves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-motion-comic-'));
    cleanupPaths.push(root);
    const database = await FileDatabase.open(join(root, 'storydream.sqlite'));
    try {
      const created = await database.createMotionComicTask({ title: '雨夜来信', premise: '一封来自未来的信。', ratio: '9:16' });
      expect(created.taskType).toBe('motion-comic');
      const document = parseMotionComicPipelineData(created.pipelineData);
      expect(document.series.title).toBe('雨夜来信');
      expect(document.providerJobs).toEqual([]);

      const saved = await database.saveMotionComicTask({
        id: created.id,
        expectedUpdatedAt: document.updatedAt,
        document: { ...document, title: '雨夜来信：第一季' },
      });
      const savedDocument = parseMotionComicPipelineData(saved.pipelineData);
      expect(saved.title).toBe('雨夜来信：第一季');
      expect(savedDocument.updatedAt).not.toBe(document.updatedAt);

      await expect(database.saveMotionComicTask({ id: created.id, expectedUpdatedAt: document.updatedAt, document }))
        .rejects.toThrow(/MOTION_COMIC_STALE_WRITE/u);
    } finally {
      await database.close();
    }
  });
});
