import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { runTask } from '@shared/runner';
import type { ImagePrompt, PipelineArtifact, StoryboardScene } from '@shared/types';
import type { LlmJsonRequest } from '@shared/llm-provider';
import type { PyJianYingBridgeInput } from '@shared/jianying-bridge';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

describe('AI creation research flow', () => {
  it('runs AI creation with web search context before content generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-ai-research-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    const mediaDir = join(dir, 'media');
    const llmRequests: LlmJsonRequest[] = [];

    try {
      const stateBefore = await db.getState();
      await db.upsertConfig({ ...stateBefore.config, jianying: { ...stateBefore.config.jianying, draftPath: join(dir, 'JianyingPro Drafts') } });
      const task = await db.createTask({
        title: 'AI search run',
        inputText: '',
        mode: 'ai',
        aiKeyword: 'Wu Zetian comeback',
        aiSources: ['web', 'builtin-knowledge'],
        extraRequirements: 'Focus on verified turning points.',
        track: 'character-story',
        style: 'photo-real',
        speaker: 'voice-a',
        ratio: '9:16',
        templateId: 'default-portrait-9-16',
        ttsSpeed: 1,
      });

      await runTask(db, task, {
        appDataDir: dir,
        resolveAiSourceContext: async () => ({
          query: 'Wu Zetian comeback',
          sections: [
            { source: 'web', title: 'Web result', url: 'https://example.test/wu', content: 'Search says she returned to power after years outside the center.' },
            { source: 'builtin-knowledge', title: 'Built-in context', content: 'Use cautious historical narration.' },
          ],
          warnings: [],
        }),
        llm: async (request) => {
          llmRequests.push(request);
          return mockLlmResponse(request);
        },
        generateImages: async (scenes) => writeSceneAssets(mediaDir, scenes, 'png', tinyPng),
        synthesizeNarration: async (scenes) => writeSceneAssets(mediaDir, scenes, 'wav', wavTone(1000)),
        draftWriterOptions: { runBridge: fakeBridge },
      } as Parameters<typeof runTask>[2] & {
        resolveAiSourceContext: () => Promise<{
          query: string;
          sections: Array<{ source: string; title: string; url?: string; content: string }>;
          warnings: string[];
        }>;
      });

      const state = await db.getState();
      const completed = state.tasks[0];
      const workDir = join(dir, 'tasks', task.id);
      const sourceContext = JSON.parse(await readFile(join(workDir, '00-source-context.json'), 'utf8')) as { sections: Array<{ title: string }> };
      const sourceContextMarkdown = await readFile(join(workDir, '00-source-context.md'), 'utf8');
      const reviewInput = llmRequests.find((request) => request.name === 'review')?.messages.at(-1)?.content ?? '';

      expect(completed.status).toBe('completed');
      expect(sourceContext.sections.map((section) => section.title)).toEqual(['Web result', 'Built-in context']);
      expect(sourceContextMarkdown).toContain('Sources: web, builtin-knowledge');
      expect(reviewInput).toContain('Wu Zetian comeback');
      expect(reviewInput).toContain('Search says she returned to power');
      expect(state.events.some((event) => event.detail.includes('AI source research completed'))).toBe(true);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function mockLlmResponse(request: LlmJsonRequest) {
  const scenes: StoryboardScene[] = [
    { id: 1, cap: 'Wu Zetian was pushed away from power.', descPrompt: 'palace corridor', durationMs: 1000 },
    { id: 2, cap: 'She returned and changed the court.', descPrompt: 'imperial court', durationMs: 1000 },
  ];
  const imagePrompts: ImagePrompt[] = scenes.map((scene) => ({
    sceneId: scene.id,
    cap: scene.cap,
    prompt: scene.descPrompt,
    negativePrompt: 'blur, distortion',
    style: 'photo-real',
    ratio: '9:16',
    characterProfile: 'same historical protagonist',
  }));
  const responses: Record<string, unknown> = {
    review: { reviewedText: 'Reviewed copy from search context.' },
    rewrite: {
      rewrittenCopy: 'Wu Zetian was pushed away from power.\n\nShe returned and changed the court.',
      cover: { title: 'Wu Zetian', subtitle: ['The return'], summary: 'A comeback story', tags: ['#history'], comments: ['Power changes people.'] },
    },
    storyboard: { scenes },
    'image-prompts': { imagePrompts },
  };
  return Promise.resolve({
    json: responses[request.name] as PipelineArtifact,
    raw: JSON.stringify(responses[request.name]),
    requestId: `mock-${request.name}`,
  });
}

async function fakeBridge(payload: PyJianYingBridgeInput) {
  await mkdir(payload.draftDir, { recursive: true });
  const draftContentPath = join(payload.draftDir, 'draft_content.json');
  const draftMetaPath = join(payload.draftDir, 'draft_meta_info.json');
  await writeFile(draftContentPath, JSON.stringify({ materials: { videos: payload.images, audios: payload.narration, texts: payload.scenes }, tracks: [] }), 'utf8');
  await writeFile(draftMetaPath, JSON.stringify({ draft_name: payload.title }), 'utf8');
  return { draftDir: payload.draftDir, draftContentPath, draftMetaPath, durationUs: payload.totalDurationUs ?? 0 };
}

async function writeSceneAssets(mediaDir: string, scenes: StoryboardScene[], extension: string, data: Buffer) {
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
  return buffer;
}
