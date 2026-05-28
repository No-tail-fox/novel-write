import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import type { ImagePrompt, PipelineArtifact, StoryboardScene } from '@shared/types';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';

const sampleInput =
  'Wu Zetian entered the palace at fourteen. After years of silence, she returned to the center of power and changed the court forever.';
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

describe('high parity Storybound shell model', () => {
  it('migrates observed provider, template, credit, style, and lab defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-high-parity-defaults-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const state = await db.getState();

      expect(state.config.imageProvider).toBe('gpt_image');
      expect(state.config.llmProfiles[0]).toMatchObject({ provider: 'custom', model: 'gpt-5.5' });
      expect(state.config.gptImage).toMatchObject({ model: 'gpt-image-2', resolution: '2K' });
      expect(state.config.jimeng).toMatchObject({ model: 'jimeng-3.1', resolution: '2K' });
      expect(state.config.customImage).toMatchObject({ asyncMode: false });
      expect(state.config.tts.provider).toBe('volcengine');
      expect(state.config.tts.minimax.model).toBe('speech-02-hd');
      expect(state.config.ima).toMatchObject({ clientId: '', apiKey: '' });
      expect(state.creditTransactions[0]).toMatchObject({ type: 'system', amount: 0, balance: 0 });
      expect(state.minimaxCloneVoices).toEqual([]);

      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists observed new-task options and lifecycle controls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-high-parity-task-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const task = await db.createTask({
        title: 'Wu Zetian trial',
        inputText: sampleInput,
        mode: 'ai',
        aiKeyword: 'Wu Zetian comeback',
        aiSources: ['web', 'builtin-knowledge', 'ima'],
        extraRequirements: 'Focus on the reversal.',
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice-a',
        ratio: '9:16',
        templateId: 'default-portrait-9-16',
        bgmId: '__builtin__',
        pausePoints: ['critical'],
        referenceImagePath: 'C:/refs/wu.png',
        rewriteIntensity: 'deep',
        narrativePov: 'first-person',
        keepPromotion: true,
        ttsProvider: 'minimax',
        ttsSpeed: 1.15,
        step3PromptSnapshot: 'custom step3',
      });

      await db.updateTask(task.id, {
        status: 'paused',
        currentStep: 3,
        startedAt: '2026-05-27T00:00:00.000Z',
        lastHeartbeatAt: '2026-05-27T00:00:01.000Z',
      });
      await db.updateTask(task.id, { status: 'cancelled', errorMessage: 'user cancelled' });
      const state = await db.getState();

      expect(state.tasks[0]).toMatchObject({
        title: 'Wu Zetian trial',
        status: 'cancelled',
        mode: 'ai',
        aiKeyword: 'Wu Zetian comeback',
        aiSources: ['web', 'builtin-knowledge', 'ima'],
        speaker: 'voice-a',
        bgmId: '__builtin__',
        referenceImagePath: 'C:/refs/wu.png',
        rewriteIntensity: 'deep',
        narrativePov: 'first-person',
        keepPromotion: true,
        ttsProvider: 'minimax',
        ttsSpeed: 1.15,
        step3PromptSnapshot: 'custom step3',
        startedAt: '2026-05-27T00:00:00.000Z',
        lastHeartbeatAt: '2026-05-27T00:00:01.000Z',
      });

      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes the complete observable artifact contract for a real Jianying draft run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-high-parity-run-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const mediaDir = join(dir, 'media');

    try {
      const stateBefore = await db.getState();
      await db.upsertConfig({ ...stateBefore.config, jianying: { ...stateBefore.config.jianying, draftPath: draftRootDir } });
      const task = await db.createTask({
        title: 'Wu Zetian complete loop',
        inputText: sampleInput,
        mode: 'paste',
        track: 'character-story',
        style: 'photo-real',
        ratio: '9:16',
        templateId: 'default-portrait-9-16',
        speaker: 'voice-a',
        ttsSpeed: 1,
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
      const draftFiles = await readdir(completed.outputDir);
      const draftContent = JSON.parse(await readFile(join(completed.outputDir, 'draft_content.json'), 'utf8'));
      const workDir = join(dir, 'tasks', task.id);
      const workFiles = await readdir(workDir);
      const prompts = JSON.parse(await readFile(join(workDir, '03-image-prompts.json'), 'utf8'));
      const diagnostics = JSON.parse(await readFile(join(workDir, 'diagnostics.json'), 'utf8'));

      expect(completed.status).toBe('completed');
      expect(completed.outputDir).toContain('JianyingPro Drafts');
      expect(draftFiles).toEqual(expect.arrayContaining(['draft_content.json', 'draft_meta_info.json', 'materials']));
      expect(workFiles).toEqual(expect.arrayContaining(['00-reviewed.txt', '01-rewritten-copy.md', '02-sentences.json', '03-image-prompts.json', 'subtitles.srt', 'diagnostics.json']));
      expect(draftContent.materials.videos.length).toBeGreaterThan(0);
      expect(draftContent.materials.audios.length).toBeGreaterThan(0);
      expect(draftContent.materials.texts.length).toBeGreaterThan(0);
      expect(prompts[0]).toHaveProperty('negativePrompt');
      expect(diagnostics.checks.map((check: { id: string }) => check.id)).toContain('jianying-draft');
      expect(state.events.map((event) => event.detail)).toContain('Jianying draft folder generated');
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders observed high-parity feature structure in the React shell source', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of ['pipelineSteps', 'TaskDetailPage', 'MiniMax', 'ImageLabPage', 'DraftTemplatesPage']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.draft-editor-shell');
    expect(css).toContain('.segmented');
  });
});

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

function makeArtifact(): PipelineArtifact {
  const scenes: StoryboardScene[] = [
    { id: 1, cap: 'Wu Zetian entered the palace at fourteen.', descPrompt: 'palace scene', durationMs: 1200 },
    { id: 2, cap: 'She returned to power years later.', descPrompt: 'court scene', durationMs: 1200 },
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
    rewrittenCopy: 'Wu Zetian entered the palace at fourteen.\n\nShe returned to power years later.',
    cover: { title: 'Wu Zetian', subtitle: ['A comeback'], summary: 'summary', tags: ['#history'], comments: ['comment'] },
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
