import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import type { ImagePrompt, PipelineArtifact, StoryboardScene } from '@shared/types';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

describe('pipeline cache and retry', () => {
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
      const statePath = join(dir, 'tasks', task.id, 'pipeline', 'state.json');
      const cachedAfterFailure = JSON.parse(await readFile(statePath, 'utf8'));

      expect(failedTask.status).toBe('paused');
      expect(failedTask.failedStep).toBe(4);
      expect(failedTask.retryFromStep).toBe(4);
      expect(failedTask.artifactStatePath).toBe(statePath);
      expect(cachedAfterFailure.steps[0].status).toBe('completed');
      expect(cachedAfterFailure.assets.images).toHaveLength(1);

      await runTask(db, { ...failedTask, status: 'pending', errorMessage: '' }, {
        appDataDir: dir,
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
});

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
