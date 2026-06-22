import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPromptTemplates } from '@shared/config';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import type { CoverImageMode, ImagePrompt, StoryboardScene } from '@shared/types';
import type { JsonLlm, LlmJsonRequest } from '@shared/llm-provider';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

describe('StoryDream mainline sync', () => {
  it('keeps seven Storybound lanes with task-level storyboard and image prompt rules', () => {
    for (const baseTrack of ['character-story', 'folk-story', 'culture-science', 'health-book', 'mind-soup', 'ecommerce', 'picture-book']) {
      const template = defaultPromptTemplates.find((item) => item.type === 'task' && item.baseTrack === baseTrack);
      expect(template?.stepPrompts?.rewrite).toBeTruthy();
      expect(template?.stepPrompts?.cover).toBeTruthy();
      expect(template?.stepPrompts?.storyboard).toContain('split only');
      expect(template?.stepPrompts?.storyboard).toContain('cap');
      expect(template?.stepPrompts?.['image-prompt']).toContain('desc_prompt');
    }
  });

  it('persists target length and generated cover image task settings across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-mainline-fields-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.createTask({
        title: 'cover mode task',
        inputText: 'source',
        targetLength: 650,
        storyboardSceneCount: 16,
        coverImageMode: 'generated',
        coverTemplateId: 'cinematic-poster',
        coverRatio: '3:4',
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();
      expect(state.tasks[0]).toMatchObject({
        targetLength: 650,
        storyboardSceneCount: 16,
        coverImageMode: 'generated' satisfies CoverImageMode,
        coverTemplateId: 'cinematic-poster',
        coverRatio: '3:4',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes step 0-3 prompt snapshots while preserving strict JSON LLM calls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-mainline-snapshots-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    const calls: LlmJsonRequest[] = [];
    const llm: JsonLlm = async <T = unknown>(request: LlmJsonRequest) => {
      calls.push(request);
      if (request.name === 'review') return { json: { reviewedText: 'reviewed source' } as T, raw: '{}', requestId: request.name };
      if (request.name.startsWith('rewrite-round')) {
        return {
          json: {
            rewrittenCopy: 'First sentence keeps the hook. Second sentence moves the story.',
            cover: { title: 'Cover Title', subtitle: ['Subtitle'], summary: 'Summary', tags: ['#story'], comments: ['comment'] },
          } as T,
          raw: '{}',
          requestId: request.name,
        };
      }
      if (request.name === 'rewrite-evaluation') {
        return { json: { bestRound: 1, evaluations: [{ round: 1, score: 90, reason: 'ok' }] } as T, raw: '{}', requestId: request.name };
      }
      if (request.name === 'storyboard') {
        return { json: { scenes: [{ id: 1, cap: 'First sentence keeps the hook.', descPrompt: 'one visible scene', durationMs: 1200 }] } as T, raw: '{}', requestId: request.name };
      }
      if (request.name === 'character-card') {
        return {
          json: { characterCard: { summary: 'consistent subject', characters: [{ name: 'hero', appearance: 'stable', role: 'protagonist' }], consistencyRules: ['stable'] } } as T,
          raw: '{}',
          requestId: request.name,
        };
      }
      return {
        json: { imagePrompts: [{ sceneId: 1, cap: 'First sentence keeps the hook.', prompt: 'safe visible scene', negativePrompt: 'no text', style: 'photo-real', ratio: '9:16', characterProfile: 'hero' }] } as T,
        raw: '{}',
        requestId: request.name,
      };
    };

    try {
      const task = await db.createTask({
        title: 'snapshots',
        inputText: 'source material',
        processingMode: 'clip-only',
        track: 'character-story',
        targetLength: 500,
      });

      await runTask(db, task, { appDataDir: dir, llm });

      const promptDir = join(dir, 'tasks', task.id, 'prompt-snapshots');
      expect(await readFile(join(promptDir, '00-review.md'), 'utf8')).toContain('Review instructions:');
      expect(await readFile(join(promptDir, '01-rewrite.md'), 'utf8')).toContain('Rewrite instructions:');
      expect(await readFile(join(promptDir, '02-storyboard.md'), 'utf8')).toContain('Storyboard scene count target');
      expect(await readFile(join(promptDir, '03-image-prompts.md'), 'utf8')).toContain('desc_prompt');
      expect(calls.every((call) => call.messages[0]?.content.includes('Return strict JSON only'))).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses first scene artwork as the cover image when selected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-mainline-first-scene-cover-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    const mediaDir = join(dir, 'media');
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const draftPayloads: Array<{ coverImagePath?: string }> = [];

    try {
      await db.upsertConfig({
        ...(await db.getState()).config,
        jianying: { ...(await db.getState()).config.jianying, draftPath: draftRootDir },
      });
      const task = await db.createTask({
        title: 'first scene cover',
        inputText: 'source',
        coverImageMode: 'first-scene',
      });

      await runTask(db, task, {
        appDataDir: dir,
        generatePipelineArtifact: async () => makeArtifact(),
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes),
        draftWriterOptions: {
          runBridge: async (payload) => {
            draftPayloads.push({ coverImagePath: payload.coverImagePath });
            await mkdir(payload.draftDir, { recursive: true });
            await writeFile(join(payload.draftDir, 'draft_content.json'), '{}', 'utf8');
            await writeFile(join(payload.draftDir, 'draft_meta_info.json'), JSON.stringify({ draft_cover: payload.coverImagePath ?? '' }), 'utf8');
            return { draftDir: payload.draftDir, draftContentPath: join(payload.draftDir, 'draft_content.json'), draftMetaPath: join(payload.draftDir, 'draft_meta_info.json'), durationUs: payload.totalDurationUs ?? 0 };
          },
        },
      });

      const completed = (await db.getState()).tasks[0];
      const pipeline = JSON.parse(await readFile(completed.artifactStatePath, 'utf8'));
      const firstImagePath = join(mediaDir, '001.asset');
      expect(pipeline.artifact.coverImage).toMatchObject({ mode: 'first-scene', path: firstImagePath });
      expect(draftPayloads[0].coverImagePath).toBe(firstImagePath);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function makeArtifact() {
  const scenes: StoryboardScene[] = [
    { id: 1, cap: 'First sentence.', descPrompt: 'first visible scene', durationMs: 1000 },
    { id: 2, cap: 'Second sentence.', descPrompt: 'second visible scene', durationMs: 1000 },
  ];
  const imagePrompts: ImagePrompt[] = scenes.map((scene) => ({
    sceneId: scene.id,
    cap: scene.cap,
    prompt: scene.descPrompt,
    negativePrompt: 'no text',
    style: 'photo-real',
    ratio: '9:16',
    characterProfile: 'consistent subject',
  }));
  return {
    reviewedText: 'reviewed',
    rewrittenCopy: scenes.map((scene) => scene.cap).join(' '),
    cover: { title: 'Cover Title', subtitle: [], summary: 'Summary', tags: [], comments: [] },
    scenes,
    imagePrompts,
    subtitles: { cues: [], srt: '' },
  };
}

async function writeSceneAssets(dir: string, scenes: StoryboardScene[]) {
  await mkdir(dir, { recursive: true });
  return Promise.all(
    scenes.map(async (scene) => {
      const path = join(dir, `${String(scene.id).padStart(3, '0')}.asset`);
      await writeFile(path, tinyPng);
      return { sceneId: scene.id, path };
    }),
  );
}
