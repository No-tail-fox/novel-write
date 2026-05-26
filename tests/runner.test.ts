import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import type { ImagePrompt, PipelineArtifact, StoryboardScene } from '@shared/types';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';

const sampleInput =
  'Wu Zetian entered the palace at fourteen. Years later, she returned to the center of power and changed the court forever.';
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

describe('task runner', () => {
  it('runs a task into a real Jianying draft folder when providers return real assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: '20260507 - Wu Zetian',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1200)),
        draftWriterOptions: { runBridge: fakeBridge },
      });
      const state = await db.getState();
      const completed = state.tasks[0];
      const files = await readdir(completed.outputDir);
      const draftContent = JSON.parse(await readFile(join(completed.outputDir, 'draft_content.json'), 'utf8'));

      expect(completed.status).toBe('completed');
      expect(completed.outputDir).toContain('JianyingPro Drafts');
      expect(files).toEqual(expect.arrayContaining(['draft_content.json', 'draft_meta_info.json']));
      expect(draftContent.materials.videos.length).toBeGreaterThan(0);
      expect(draftContent.materials.audios.length).toBeGreaterThan(0);
      expect(state.events.some((event) => event.detail.includes('Jianying draft'))).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails instead of completing with fake assets when real image generation is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-no-image-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));

    try {
      const task = await db.createTask({
        title: 'No providers',
        inputText: sampleInput,
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice',
      });

      await expect(runTask(db, task, { appDataDir: dir, generatePipelineArtifact: async () => makeArtifact() })).rejects.toThrow(/image provider/i);
      const state = await db.getState();

      expect(state.tasks[0].status).toBe('paused');
      expect(state.tasks[0].currentStep).toBe(4);
      expect(state.tasks[0].failedStep).toBe(4);
      expect(state.tasks[0].errorMessage).toMatch(/image provider/i);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function fakeBridge(payload: PyJianYingBridgeInput) {
  await mkdir(payload.draftDir, { recursive: true });
  await mkdir(join(payload.draftDir, 'materials'), { recursive: true });
  const draftContentPath = join(payload.draftDir, 'draft_content.json');
  const draftMetaPath = join(payload.draftDir, 'draft_meta_info.json');
  await writeFile(
    draftContentPath,
    JSON.stringify({
      duration: payload.totalDurationUs,
      materials: {
        videos: payload.images,
        audios: payload.narration,
        texts: payload.scenes,
      },
      tracks: [{ type: 'video' }, { type: 'audio' }, { type: 'text' }],
    }),
    'utf8',
  );
  await writeFile(draftMetaPath, JSON.stringify({ draft_name: payload.title, tm_duration: payload.totalDurationUs }), 'utf8');
  return {
    draftDir: payload.draftDir,
    draftContentPath,
    draftMetaPath,
    durationUs: payload.totalDurationUs ?? 0,
  };
}

async function writeSceneAssets(
  mediaDir: string,
  scenes: StoryboardScene[],
  extension: string,
  data: Buffer,
): Promise<Array<{ sceneId: number; path: string }>> {
  const targetDir = join(mediaDir, extension);
  await mkdir(targetDir, { recursive: true });
  return Promise.all(
    scenes.map(async (scene) => {
      const path = join(targetDir, `${scene.id}.${extension}`);
      await writeFile(path, data);
      return { sceneId: scene.id, path };
    }),
  );
}

function makeArtifact(): PipelineArtifact {
  const scenes: StoryboardScene[] = [
    { id: 1, cap: 'First line', descPrompt: 'first prompt', durationMs: 1200 },
    { id: 2, cap: 'Second line', descPrompt: 'second prompt', durationMs: 1200 },
  ];
  const imagePrompts: ImagePrompt[] = scenes.map((scene) => ({
    sceneId: scene.id,
    cap: scene.cap,
    prompt: scene.descPrompt,
    negativePrompt: 'none',
    style: 'photo-real',
    ratio: '9:16',
    characterProfile: 'same person',
  }));
  return {
    reviewedText: sampleInput,
    rewrittenCopy: 'First line\n\nSecond line',
    cover: { title: 'Wu Zetian', subtitle: [], summary: 'summary', tags: ['#tag'], comments: [] },
    scenes,
    imagePrompts,
    subtitles: { cues: [], srt: '' },
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
