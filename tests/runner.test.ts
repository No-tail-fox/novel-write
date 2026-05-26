import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';

const sampleInput =
  '武曌，通称武则天、武后，是中国历史上唯一的女皇帝。武则天十四岁入宫为唐太宗才人，历经十二年不得升迁。唐高宗时复为昭仪，通过废黜王皇后与萧淑妃，得以立为皇后。并尊号为天后，与唐高宗并称二圣。';

describe('task runner', () => {
  it('runs a task through the core loop and writes output artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));

    try {
      const task = await db.createTask({
        title: '20260507 - 武则天',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: '灿博小叔',
      });

      await runTask(db, task, { appDataDir: dir });
      const state = await db.getState();
      const completed = state.tasks[0];
      const files = await readdir(completed.outputDir);

      expect(completed.status).toBe('completed');
      expect(files).toContain('00-reviewed.txt');
      expect(files).toContain('02-sentences.json');
      expect(files).toContain('03-image-prompts.json');
      expect(state.events.some((event) => event.detail.includes('草稿包已生成'))).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
