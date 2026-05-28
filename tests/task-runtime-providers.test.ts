import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTaskRuntimeProviders } from '@shared/task-runtime-providers';
import { defaultConfig } from '@shared/config';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';

describe('task runtime providers', () => {
  it('treats Volcengine V3 API key settings as a usable TTS provider', () => {
    const providers = createTaskRuntimeProviders(
      {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            appId: '',
            accessKey: '',
            resourceId: 'seed-tts-2.0',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      },
      'D:/tmp/storybound-task',
    );

    expect(providers.synthesizeNarration).toBeTypeOf('function');
  });

  it('pauses at content generation instead of using mock providers when the LLM is not configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runtime-providers-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));

    try {
      await db.upsertConfig(defaultConfig);
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

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          resolveAiSourceContext: async () => ({
            query: task.aiKeyword,
            sections: [{ source: 'web', title: 'Search result', content: 'Wu Zetian returns to the court.' }],
            warnings: [],
          }),
          ...createTaskRuntimeProviders(defaultConfig, join(dir, 'tasks', task.id)),
        }),
      ).rejects.toThrow(/LLM provider is not configured/);

      const state = await db.getState();

      expect(state.tasks[0]).toMatchObject({
        status: 'paused',
        currentStep: 0,
        failedStep: 0,
        retryFromStep: 0,
      });
      expect(state.tasks[0].errorMessage).toContain('LLM provider is not configured');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
