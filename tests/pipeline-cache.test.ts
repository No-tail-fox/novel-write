import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import { markSceneImageForRegeneration, markSceneNarrationForRegeneration, markTaskStepForRerun, updateSceneImagePrompt } from '@shared/pipeline-cache';
import type { ImagePrompt, PipelineArtifact, StoryboardScene, Task, TaskStepRerunMode } from '@shared/types';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

describe('pipeline cache and retry', () => {
  it('runs image generation at configured concurrency and persists each finished image while others continue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-pipeline-concurrency-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const scenes: StoryboardScene[] = [
      { id: 1, cap: 'Scene one', descPrompt: 'prompt one', durationMs: 1000 },
      { id: 2, cap: 'Scene two', descPrompt: 'prompt two', durationMs: 1000 },
      { id: 3, cap: 'Scene three', descPrompt: 'prompt three', durationMs: 1000 },
    ];
    const artifact = createArtifact('Concurrent Draft', scenes);
    const activeSceneIds = new Set<number>();
    const startedSceneIds: number[] = [];
    let maxActive = 0;
    let stateAfterFirstImage: unknown = null;

    try {
      const config = (await db.getState()).config;
      await db.upsertConfig({ ...config, jianying: { ...config.jianying, draftPath: draftRootDir } });
      const task = await db.createTask({ title: 'Concurrent Draft', inputText: 'source text' });
      const statePath = join(managedTaskWorkDir(dir, task), 'pipeline', 'state.json');

      await runTask(db, task, {
        appDataDir: dir,
        workDir: managedTaskWorkDir(dir, task),
        imageConcurrency: 2,
        generatePipelineArtifact: async () => artifact,
        generateImages: async (missingScenes) => {
          const scene = missingScenes[0];
          startedSceneIds.push(scene.id);
          activeSceneIds.add(scene.id);
          maxActive = Math.max(maxActive, activeSceneIds.size);
          await delay(scene.id === 1 ? 10 : 60);
          await mkdir(mediaDir, { recursive: true });
          const path = join(mediaDir, `${scene.id}.png`);
          await writeFile(path, tinyPng);
          activeSceneIds.delete(scene.id);
          return [{ sceneId: scene.id, path }];
        },
        synthesizeNarration: async (missingScenes) => writeAudioAssets(mediaDir, missingScenes),
        draftWriterOptions: { runBridge: fakeBridge },
        onHeartbeat: async (_taskId, step, detail) => {
          if (step === 4 && detail === 'image scene 1 completed') {
            stateAfterFirstImage = JSON.parse(await readFile(statePath, 'utf8'));
          }
        },
      });

      expect(startedSceneIds.slice(0, 2)).toEqual([1, 2]);
      expect(maxActive).toBe(2);
      expect((stateAfterFirstImage as { assets: { images: Array<{ sceneId: number }> } }).assets.images).toEqual([{ sceneId: 1, path: join(mediaDir, '1.png') }]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it('persists step state, pauses on provider failure, and retries only missing image assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-pipeline-cache-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const scenes: StoryboardScene[] = [
      { id: 1, cap: 'First scene', descPrompt: 'first prompt', durationMs: 1000 },
      { id: 2, cap: 'Second scene', descPrompt: 'second prompt', durationMs: 1100 },
    ];
    const artifact: PipelineArtifact = {
      reviewedText: 'reviewed',
      rewrittenCopy: 'rewritten',
      cover: { title: 'Retry Draft', subtitle: [], summary: '', tags: [], comments: [] },
      scenes,
      imagePrompts: scenes.map(
        (scene): ImagePrompt => ({
          sceneId: scene.id,
          cap: scene.cap,
          prompt: scene.descPrompt,
          negativePrompt: 'none',
          style: 'photo-real',
          ratio: '9:16',
          characterProfile: 'same person',
        }),
      ),
      subtitles: { cues: [], srt: '' },
    };
    let llmRuns = 0;
    const generatedSceneIds: number[] = [];
    let firstImageAttempt = true;

    try {
      const config = (await db.getState()).config;
      await db.upsertConfig({ ...config, jianying: { ...config.jianying, draftPath: draftRootDir } });
      const task = await db.createTask({ title: 'Retry Draft', inputText: 'source text' });

      await expect(
        runTask(db, task, {
          appDataDir: dir,
          workDir: managedTaskWorkDir(dir, task),
          generatePipelineArtifact: async () => {
            llmRuns += 1;
            return artifact;
          },
          generateImages: async (missingScenes) => {
            await mkdir(mediaDir, { recursive: true });
            const assets = [];
            for (const scene of missingScenes) {
              if (firstImageAttempt && scene.id === 2) {
                firstImageAttempt = false;
                throw new Error('image provider failed after first scene');
              }
              generatedSceneIds.push(scene.id);
              const path = join(mediaDir, `${scene.id}.png`);
              await writeFile(path, tinyPng);
              assets.push({ sceneId: scene.id, path });
            }
            return assets;
          },
          synthesizeNarration: async (missingScenes) => writeAudioAssets(mediaDir, missingScenes),
          draftWriterOptions: { runBridge: fakeBridge },
        }),
      ).rejects.toThrow(/image provider failed/);

      const failedState = await db.getState();
      const failedTask = failedState.tasks[0];
      const statePath = join(managedTaskWorkDir(dir, task), 'pipeline', 'state.json');
      const cachedAfterFailure = JSON.parse(await readFile(statePath, 'utf8'));

      expect(failedTask.status).toBe('paused');
      expect(failedTask.failedStep).toBe(4);
      expect(failedTask.retryFromStep).toBe(4);
      expect(failedTask.artifactStatePath).toBe(statePath);
      expect(cachedAfterFailure.steps[0].status).toBe('completed');
      expect(cachedAfterFailure.assets.images).toHaveLength(1);

      await runTask(db, { ...failedTask, status: 'pending', errorMessage: '' }, {
        appDataDir: dir,
        workDir: managedTaskWorkDir(dir, failedTask),
        generatePipelineArtifact: async () => {
          llmRuns += 1;
          return artifact;
        },
        generateImages: async (missingScenes) => {
          await mkdir(mediaDir, { recursive: true });
          return Promise.all(
            missingScenes.map(async (scene) => {
              generatedSceneIds.push(scene.id);
              const path = join(mediaDir, `${scene.id}-retry.png`);
              await writeFile(path, tinyPng);
              return { sceneId: scene.id, path };
            }),
          );
        },
        synthesizeNarration: async (missingScenes) => writeAudioAssets(mediaDir, missingScenes),
        draftWriterOptions: { runBridge: fakeBridge },
      });

      const completed = (await db.getState()).tasks[0];
      const cachedAfterRetry = JSON.parse(await readFile(statePath, 'utf8'));

      expect(completed.status).toBe('completed');
      expect(llmRuns).toBe(1);
      expect(generatedSceneIds).toEqual([1, 2]);
      expect(cachedAfterRetry.assets.images.map((asset: { sceneId: number }) => asset.sceneId)).toEqual([1, 2]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks one scene image for regeneration without clearing completed text or narration assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-regenerate-image-'));
    const statePath = join(dir, 'pipeline', 'state.json');

    try {
      await mkdir(join(dir, 'pipeline'), { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            taskId: 'task-regenerate',
            updatedAt: '2026-05-27T00:00:00.000Z',
            steps: {
              '3': { status: 'completed', outputPath: 'prompts.json' },
              '4': { status: 'completed', outputPath: '1.png\n2.png' },
              '5': { status: 'completed', outputPath: '1.mp3\n2.mp3' },
              '6': { status: 'completed', outputPath: 'draft-dir' },
            },
            artifact: {
              reviewedText: 'reviewed',
              rewrittenCopy: 'copy',
              cover: { title: 'Title', subtitle: [], summary: '', tags: [], comments: [] },
              scenes: [
                { id: 1, cap: 'one', descPrompt: 'one', durationMs: 1000 },
                { id: 2, cap: 'two', descPrompt: 'two', durationMs: 1000 },
              ],
              imagePrompts: [
                { sceneId: 1, cap: 'one', prompt: 'one', negativePrompt: '', style: '', ratio: '9:16', characterProfile: '' },
                { sceneId: 2, cap: 'two', prompt: 'two', negativePrompt: '', style: '', ratio: '9:16', characterProfile: '' },
              ],
            },
            assets: {
              images: [
                { sceneId: 1, path: '1.png' },
                { sceneId: 2, path: '2.png' },
              ],
              narration: [
                { sceneId: 1, path: '1.mp3' },
                { sceneId: 2, path: '2.mp3' },
              ],
            },
            draft: {
              draftDir: 'draft-dir',
              draftContentPath: 'draft_content.json',
              draftMetaPath: 'draft_meta_info.json',
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const result = await markSceneImageForRegeneration(statePath, 2);
      const next = JSON.parse(await readFile(statePath, 'utf8'));

      expect(result.removed).toBe(true);
      expect(next.assets.images).toEqual([{ sceneId: 1, path: '1.png' }]);
      expect(next.assets.narration).toEqual([
        { sceneId: 1, path: '1.mp3' },
        { sceneId: 2, path: '2.mp3' },
      ]);
      expect(next.artifact.reviewedText).toBe('reviewed');
      expect(next.steps['4'].status).toBe('pending');
      expect(next.steps['4'].outputPath).toBe('1.png');
      expect(next.steps['5'].status).toBe('completed');
      expect(next.steps['6'].status).toBe('pending');
      expect(next.draft).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks one scene narration for regeneration without clearing completed text or image assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-regenerate-narration-'));
    const statePath = join(dir, 'pipeline', 'state.json');

    try {
      await mkdir(join(dir, 'pipeline'), { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            taskId: 'task-regenerate-audio',
            updatedAt: '2026-05-27T00:00:00.000Z',
            steps: {
              '3': { status: 'completed', outputPath: 'prompts.json' },
              '4': { status: 'completed', outputPath: '1.png\n2.png' },
              '5': { status: 'completed', outputPath: '1.mp3\n2.mp3' },
              '6': { status: 'completed', outputPath: 'draft-dir' },
            },
            artifact: {
              reviewedText: 'reviewed',
              rewrittenCopy: 'copy',
              cover: { title: 'Title', subtitle: [], summary: '', tags: [], comments: [] },
              scenes: [
                { id: 1, cap: 'one', descPrompt: 'one', durationMs: 1000 },
                { id: 2, cap: 'two', descPrompt: 'two', durationMs: 1000 },
              ],
              imagePrompts: [
                { sceneId: 1, cap: 'one', prompt: 'one', negativePrompt: '', style: '', ratio: '9:16', characterProfile: '' },
                { sceneId: 2, cap: 'two', prompt: 'two', negativePrompt: '', style: '', ratio: '9:16', characterProfile: '' },
              ],
            },
            assets: {
              images: [
                { sceneId: 1, path: '1.png' },
                { sceneId: 2, path: '2.png' },
              ],
              narration: [
                { sceneId: 1, path: '1.mp3' },
                { sceneId: 2, path: '2.mp3' },
              ],
            },
            draft: {
              draftDir: 'draft-dir',
              draftContentPath: 'draft_content.json',
              draftMetaPath: 'draft_meta_info.json',
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const result = await markSceneNarrationForRegeneration(statePath, 2);
      const next = JSON.parse(await readFile(statePath, 'utf8'));

      expect(result.removed).toBe(true);
      expect(next.assets.images).toEqual([
        { sceneId: 1, path: '1.png' },
        { sceneId: 2, path: '2.png' },
      ]);
      expect(next.assets.narration).toEqual([{ sceneId: 1, path: '1.mp3' }]);
      expect(next.artifact.reviewedText).toBe('reviewed');
      expect(next.steps['4'].status).toBe('completed');
      expect(next.steps['5'].status).toBe('pending');
      expect(next.steps['5'].outputPath).toBe('1.mp3');
      expect(next.steps['6'].status).toBe('pending');
      expect(next.draft).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('updates one scene image prompt without changing other prompt fields or cached assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-update-image-prompt-'));
    const statePath = join(dir, 'pipeline', 'state.json');

    try {
      await mkdir(join(dir, 'pipeline'), { recursive: true });
      const draft = {
        draftDir: 'draft-dir',
        draftContentPath: 'draft_content.json',
        draftMetaPath: 'draft_meta_info.json',
      };
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            taskId: 'task-update-image-prompt',
            updatedAt: '2026-07-08T00:00:00.000Z',
            steps: {
              '3': { status: 'completed', outputPath: 'prompts.json' },
              '4': { status: 'failed', outputPath: '1.png\n2.png', error: 'policy failed' },
              '6': { status: 'completed', outputPath: 'draft-dir' },
            },
            artifact: {
              scenes: [
                { id: 1, cap: 'one', descPrompt: 'one prompt', durationMs: 1000 },
                { id: 2, cap: 'two', descPrompt: 'two prompt', durationMs: 1000 },
              ],
              imagePrompts: [
                { sceneId: 1, cap: 'one', prompt: 'image one', negativePrompt: 'first negative', style: 'photo-real', ratio: '9:16', characterProfile: 'same person' },
                { sceneId: 2, cap: 'two', prompt: 'unsafe image two', negativePrompt: 'keep negative', style: 'photo-real', ratio: '9:16', characterProfile: 'same person' },
              ],
            },
            assets: {
              images: [
                { sceneId: 1, path: '1.png' },
                { sceneId: 2, path: '2.png' },
              ],
              imageErrors: [{ sceneId: 2, message: 'policy failed' }],
              narration: [{ sceneId: 1, path: '1.mp3' }],
            },
            draft,
          },
          null,
          2,
        ),
        'utf8',
      );

      const result = await updateSceneImagePrompt(statePath, 2, 'safer repaired prompt');
      const next = JSON.parse(await readFile(statePath, 'utf8'));

      expect(result.updatedPrompt.prompt).toBe('safer repaired prompt');
      expect(next.artifact.imagePrompts[0].prompt).toBe('image one');
      expect(next.artifact.imagePrompts[1]).toMatchObject({
        sceneId: 2,
        prompt: 'safer repaired prompt',
        negativePrompt: 'keep negative',
        style: 'photo-real',
        ratio: '9:16',
        characterProfile: 'same person',
      });
      expect(next.assets.images).toEqual([
        { sceneId: 1, path: '1.png' },
        { sceneId: 2, path: '2.png' },
      ]);
      expect(next.assets.imageErrors).toEqual([{ sceneId: 2, message: 'policy failed' }]);
      expect(next.assets.narration).toEqual([{ sceneId: 1, path: '1.mp3' }]);
      expect(next.draft).toEqual(draft);
      expect(new Date(next.updatedAt).getTime()).toBeGreaterThan(new Date('2026-07-08T00:00:00.000Z').getTime());

      await expect(updateSceneImagePrompt(statePath, 2, '   ')).rejects.toThrow(/Image prompt cannot be empty/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes every narration turn for a scene when regenerating dual voice audio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-regenerate-dual-voice-narration-'));
    const statePath = join(dir, 'pipeline', 'state.json');

    try {
      await mkdir(join(dir, 'pipeline'), { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            taskId: 'task-regenerate-dual-voice-audio',
            updatedAt: '2026-06-16T00:00:00.000Z',
            steps: {
              '4': { status: 'completed', outputPath: '1.png\n2.png' },
              '5': { status: 'completed', outputPath: '1-a.mp3\n1-b.mp3\n2-a.mp3' },
              '6': { status: 'completed', outputPath: 'draft-dir' },
            },
            artifact: {
              reviewedText: 'reviewed',
              rewrittenCopy: 'copy',
              cover: { title: 'Title', subtitle: [], summary: '', tags: [], comments: [] },
              scenes: [
                { id: 1, cap: 'Host A: one\nHost B: two', descPrompt: 'one', durationMs: 1000 },
                { id: 2, cap: 'Host A: three', descPrompt: 'two', durationMs: 1000 },
              ],
              imagePrompts: [],
            },
            assets: {
              images: [
                { sceneId: 1, path: '1.png' },
                { sceneId: 2, path: '2.png' },
              ],
              narration: [
                { sceneId: 1, path: '1-a.mp3', speaker: 'A', turnIndex: 1, text: 'one' },
                { sceneId: 1, path: '1-b.mp3', speaker: 'B', turnIndex: 2, text: 'two' },
                { sceneId: 2, path: '2-a.mp3', speaker: 'A', turnIndex: 1, text: 'three' },
              ],
            },
            draft: {
              draftDir: 'draft-dir',
              draftContentPath: 'draft_content.json',
              draftMetaPath: 'draft_meta_info.json',
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const result = await markSceneNarrationForRegeneration(statePath, 1);
      const next = JSON.parse(await readFile(statePath, 'utf8'));

      expect(result.removed).toBe(true);
      expect(next.assets.narration).toEqual([{ sceneId: 2, path: '2-a.mp3', speaker: 'A', turnIndex: 1, text: 'three' }]);
      expect(next.steps['5'].status).toBe('pending');
      expect(next.steps['5'].outputPath).toBe('2-a.mp3');
      expect(next.draft).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks a content step for rewrite-assisted rerun and clears downstream artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-rerun-step-rewrite-'));
    const statePath = join(dir, 'pipeline', 'state.json');

    try {
      await mkdir(join(dir, 'pipeline'), { recursive: true });
      await writeFile(statePath, JSON.stringify(createCompletedPipelineState('task-rerun-rewrite'), null, 2), 'utf8');

      const result = await markTaskStepForRerun(statePath, 1, 'rewrite');
      const next = JSON.parse(await readFile(statePath, 'utf8'));

      expect(result.step).toBe(1);
      expect(result.mode).toBe('rewrite');
      expect(next.artifact.sourceContext.query).toBe('source query');
      expect(next.artifact.reviewedText).toBe('reviewed');
      expect(next.artifact.rewrittenCopy).toBeUndefined();
      expect(next.artifact.cover).toBeUndefined();
      expect(next.artifact.scenes).toBeUndefined();
      expect(next.artifact.imagePrompts).toBeUndefined();
      expect(next.artifact.subtitles).toBeUndefined();
      expect(next.assets.images).toEqual([]);
      expect(next.assets.narration).toEqual([]);
      expect(next.rerun.step).toBe(1);
      expect(next.rerun.mode).toBe('rewrite');
      expect(next.rerun.context.rewrittenCopy).toBe('old rewritten copy');
      expect(next.steps['0'].status).toBe('completed');
      for (const step of ['1', '2', '3', '4', '5', '6']) {
        expect(next.steps[step].status).toBe('pending');
        expect(next.steps[step].error).toBeUndefined();
        expect(next.steps[step].completedAt).toBeUndefined();
      }
      expect(next.draft).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks the draft step for regeneration without clearing content or media assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-rerun-step-draft-'));
    const statePath = join(dir, 'pipeline', 'state.json');

    try {
      await mkdir(join(dir, 'pipeline'), { recursive: true });
      await writeFile(statePath, JSON.stringify(createCompletedPipelineState('task-rerun-draft'), null, 2), 'utf8');

      const result = await markTaskStepForRerun(statePath, 6, 'regenerate');
      const next = JSON.parse(await readFile(statePath, 'utf8'));

      expect(result.step).toBe(6);
      expect(result.mode).toBe('regenerate');
      expect(next.artifact.rewrittenCopy).toBe('old rewritten copy');
      expect(next.artifact.scenes).toHaveLength(2);
      expect(next.artifact.imagePrompts).toHaveLength(2);
      expect(next.assets.images).toEqual([
        { sceneId: 1, path: '1.png' },
        { sceneId: 2, path: '2.png' },
      ]);
      expect(next.assets.narration).toEqual([
        { sceneId: 1, path: '1.mp3' },
        { sceneId: 2, path: '2.mp3' },
      ]);
      expect(next.rerun.step).toBe(6);
      expect(next.rerun.mode).toBe('regenerate');
      expect(next.rerun.context).toBeUndefined();
      expect(next.steps['5'].status).toBe('completed');
      expect(next.steps['6'].status).toBe('pending');
      expect(next.draft).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks the image step for regeneration and clears downstream narration and draft assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-rerun-step-images-'));
    const statePath = join(dir, 'pipeline', 'state.json');

    try {
      await mkdir(join(dir, 'pipeline'), { recursive: true });
      await writeFile(statePath, JSON.stringify(createCompletedPipelineState('task-rerun-images'), null, 2), 'utf8');

      await markTaskStepForRerun(statePath, 4, 'regenerate');
      const next = JSON.parse(await readFile(statePath, 'utf8'));

      expect(next.artifact.reviewedText).toBe('reviewed');
      expect(next.artifact.imagePrompts).toHaveLength(2);
      expect(next.assets.images).toEqual([]);
      expect(next.assets.narration).toEqual([]);
      expect(next.steps['3'].status).toBe('completed');
      expect(next.steps['4'].status).toBe('pending');
      expect(next.steps['5'].status).toBe('pending');
      expect(next.steps['6'].status).toBe('pending');
      expect(next.draft).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('serializes concurrent mutations of the same pipeline state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-pipeline-mutation-serialization-'));
    try {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const statePath = join(dir, `state-${attempt}.json`);
        await writeFile(statePath, JSON.stringify(createCompletedPipelineState(`task-${attempt}`), null, 2), 'utf8');

        await Promise.all([
          markSceneImageForRegeneration(statePath, 1),
          markSceneNarrationForRegeneration(relative(process.cwd(), statePath), 1),
          updateSceneImagePrompt(statePath, 1, 'updated image prompt'),
          markTaskStepForRerun(statePath, 6, 'regenerate'),
        ]);

        const state = JSON.parse(await readFile(statePath, 'utf8')) as ReturnType<typeof createCompletedPipelineState> & {
          rerun: { step: number; mode: TaskStepRerunMode };
        };
        expect(state.assets.images).toEqual([{ sceneId: 2, path: '2.png' }]);
        expect(state.assets.narration).toEqual([{ sceneId: 2, path: '2.mp3' }]);
        expect(state.artifact.imagePrompts[0].prompt).toBe('updated image prompt');
        expect(state.rerun).toMatchObject({ step: 6, mode: 'regenerate' });
        expect(state.steps['6']).toMatchObject({ status: 'pending' });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('serializes runner checkpoint ownership with an artifact prompt edit', async () => {
    const pipelineCache = await import('@shared/pipeline-cache') as Record<string, unknown>;
    const withPipelineStateLock = pipelineCache.withPipelineStateLock;
    const runnerSource = await readFile(new URL('../src/shared/runner.ts', import.meta.url), 'utf8');
    expect(withPipelineStateLock).toBeTypeOf('function');
    expect(runnerSource).toContain('withPipelineStateLock(statePath');
    if (typeof withPipelineStateLock !== 'function') return;

    const dir = await mkdtemp(join(tmpdir(), 'storybound-pipeline-runner-lock-'));
    const statePath = join(dir, 'state.json');
    try {
      await writeFile(statePath, JSON.stringify(createCompletedPipelineState('task-runner-lock'), null, 2), 'utf8');
      let markRunnerRead!: () => void;
      let releaseRunner!: () => void;
      const runnerRead = new Promise<void>((resolve) => {
        markRunnerRead = resolve;
      });
      const runnerGate = new Promise<void>((resolve) => {
        releaseRunner = resolve;
      });
      const runnerWrite = (withPipelineStateLock as (
        path: string,
        operation: (normalizedStatePath: string) => Promise<void>,
      ) => Promise<void>)(statePath, async (normalizedStatePath) => {
        const staleSnapshot = await readFile(normalizedStatePath, 'utf8');
        markRunnerRead();
        await runnerGate;
        await writeFile(normalizedStatePath, staleSnapshot, 'utf8');
      });
      await runnerRead;

      const promptEdit = updateSceneImagePrompt(statePath, 1, 'user edited prompt');
      releaseRunner();
      await Promise.all([runnerWrite, promptEdit]);

      const state = JSON.parse(await readFile(statePath, 'utf8')) as ReturnType<typeof createCompletedPipelineState>;
      expect(state.artifact.imagePrompts[0].prompt).toBe('user edited prompt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function managedTaskWorkDir(appDataDir: string, task: Pick<Task, 'managedStorageKey'>): string {
  if (!task.managedStorageKey) throw new Error('Test task is missing a managed storage key.');
  return join(appDataDir, 'tasks', task.managedStorageKey);
}

function createArtifact(title: string, scenes: StoryboardScene[]): PipelineArtifact {
  return {
    reviewedText: 'reviewed',
    rewrittenCopy: 'rewritten',
    cover: { title, subtitle: [], summary: '', tags: [], comments: [] },
    scenes,
    imagePrompts: scenes.map(
      (scene): ImagePrompt => ({
        sceneId: scene.id,
        cap: scene.cap,
        prompt: scene.descPrompt,
        negativePrompt: 'none',
        style: 'photo-real',
        ratio: '9:16',
        characterProfile: 'same person',
      }),
    ),
    subtitles: { cues: [], srt: '' },
  };
}

function createCompletedPipelineState(taskId: string) {
  return {
    version: 1,
    taskId,
    updatedAt: '2026-06-09T00:00:00.000Z',
    steps: Object.fromEntries(
      Array.from({ length: 7 }, (_, step) => [
        String(step),
        { status: 'completed', outputPath: `step-${step}.json`, completedAt: '2026-06-09T00:00:01.000Z', error: 'old error' },
      ]),
    ),
    artifact: {
      sourceContext: {
        query: 'source query',
        warnings: [],
        sections: [{ source: 'web', title: 'Source', url: 'https://example.test', content: 'source body' }],
      },
      reviewedText: 'reviewed',
      rewrittenCopy: 'old rewritten copy',
      cover: { title: 'Old title', subtitle: ['Sub'], summary: 'Summary', tags: ['tag'], comments: ['comment'] },
      scenes: [
        { id: 1, cap: 'one', descPrompt: 'one prompt', durationMs: 1000 },
        { id: 2, cap: 'two', descPrompt: 'two prompt', durationMs: 1000 },
      ],
      imagePrompts: [
        { sceneId: 1, cap: 'one', prompt: 'image one', negativePrompt: '', style: 'photo-real', ratio: '9:16', characterProfile: '' },
        { sceneId: 2, cap: 'two', prompt: 'image two', negativePrompt: '', style: 'photo-real', ratio: '9:16', characterProfile: '' },
      ],
      subtitles: { cues: [{ index: 1, startMs: 0, endMs: 1000, text: 'one' }], srt: '1\n00:00:00,000 --> 00:00:01,000\none\n' },
    },
    assets: {
      images: [
        { sceneId: 1, path: '1.png' },
        { sceneId: 2, path: '2.png' },
      ],
      narration: [
        { sceneId: 1, path: '1.mp3' },
        { sceneId: 2, path: '2.mp3' },
      ],
    },
    draft: {
      draftDir: 'draft-dir',
      draftContentPath: 'draft_content.json',
      draftMetaPath: 'draft_meta_info.json',
    },
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeAudioAssets(mediaDir: string, scenes: StoryboardScene[]): Promise<Array<{ sceneId: number; path: string }>> {
  await mkdir(mediaDir, { recursive: true });
  return Promise.all(
    scenes.map(async (scene) => {
      const path = join(mediaDir, `${scene.id}.wav`);
      await writeFile(path, wavTone(scene.durationMs));
      return { sceneId: scene.id, path };
    }),
  );
}

async function fakeBridge(payload: PyJianYingBridgeInput) {
  await mkdir(payload.draftDir, { recursive: true });
  const draftContentPath = join(payload.draftDir, 'draft_content.json');
  const draftMetaPath = join(payload.draftDir, 'draft_meta_info.json');
  await writeFile(draftContentPath, JSON.stringify({ duration: payload.totalDurationUs, materials: { videos: payload.images, audios: payload.narration, texts: payload.scenes }, tracks: [] }), 'utf8');
  await writeFile(draftMetaPath, JSON.stringify({ draft_name: payload.title, tm_duration: payload.totalDurationUs }), 'utf8');
  return {
    draftDir: payload.draftDir,
    draftContentPath,
    draftMetaPath,
    durationUs: payload.totalDurationUs ?? 0,
  };
}

function wavTone(durationMs: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 8000);
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  return buffer;
}
