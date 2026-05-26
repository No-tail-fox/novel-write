import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { defaultConfig } from '@shared/config';

describe('file database', () => {
  it('persists config, tasks, and events across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-db-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertConfig({
        ...defaultConfig,
        llm: { ...defaultConfig.llm, provider: 'custom', baseUrl: 'https://example.com', apiKey: 'k', model: 'gpt-5', proxyUrl: '' },
        image: { ...defaultConfig.image, baseUrl: 'https://example.com', apiKey: 'img', model: 'image-1', ratio: '9:16', concurrency: 2 },
        jianying: { ...defaultConfig.jianying, draftPath: 'G:/JianyingPro Drafts' },
      });
      const task = await db.createTask({ title: '20260507 - 武则天', inputText: '武曌...', track: 'character-story', style: 'photo-real' });
      await db.addTaskEvent(task.id, { type: 'step_start', step: 0, agent: 'Reviewer', detail: '预审整理文案' });
      await db.updateTask(task.id, { status: 'running', currentStep: 1 });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.config.jianying.draftPath).toBe('G:/JianyingPro Drafts');
      expect(state.tasks).toHaveLength(1);
      expect(state.events).toHaveLength(1);
      expect(state.tasks[0].title).toBe('20260507 - 武则天');
      await reopened.close();
      const raw = await readFile(file);
      expect(raw.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
