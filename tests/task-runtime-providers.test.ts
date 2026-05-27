import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTaskRuntimeProviders } from '@shared/task-runtime-providers';
import { defaultConfig } from '@shared/config';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';

describe('task runtime providers', () => {
  it('runs the AI creation pipeline with local mock providers when API keys are missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runtime-providers-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');

    try {
      await db.upsertConfig({ ...defaultConfig, jianying: { ...defaultConfig.jianying, draftPath: draftRootDir } });
      const task = await db.createTask({
        title: 'AI local fallback',
        inputText: '',
        mode: 'ai',
        aiKeyword: 'Wu Zetian comeback',
        aiSources: ['web', 'builtin-knowledge'],
        extraRequirements: 'Use a short-video narration style.',
        track: 'character-story',
        style: 'photo-real',
        ratio: '9:16',
      });

      await runTask(db, task, {
        appDataDir: dir,
        resolveAiSourceContext: async () => ({
          query: task.aiKeyword,
          sections: [{ source: 'web', title: 'Search result', content: 'Wu Zetian returns to the court.' }],
          warnings: [],
        }),
        ...createTaskRuntimeProviders(defaultConfig, join(dir, 'tasks', task.id)),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const state = await db.getState();
      const completed = state.tasks[0];
      const draftFiles = await readdir(completed.outputDir);

      expect(completed.status).toBe('completed');
      expect(completed.errorMessage).toBe('');
      expect(draftFiles).toEqual(expect.arrayContaining(['draft_content.json', 'draft_meta_info.json']));
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function fakeBridge(payload: PyJianYingBridgeInput) {
  await mkdir(payload.draftDir, { recursive: true });
  const draftContentPath = join(payload.draftDir, 'draft_content.json');
  const draftMetaPath = join(payload.draftDir, 'draft_meta_info.json');
  await Promise.all([
    writeFile(draftContentPath, JSON.stringify({ materials: { videos: payload.images, audios: payload.narration, texts: payload.scenes }, tracks: [] }), 'utf8'),
    writeFile(draftMetaPath, JSON.stringify({ draft_name: payload.title }), 'utf8'),
  ]);
  return { draftDir: payload.draftDir, draftContentPath, draftMetaPath, durationUs: payload.totalDurationUs ?? 0 };
}
