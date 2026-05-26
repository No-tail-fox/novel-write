import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJianyingDraft } from '@shared/draft';
import { buildImagePrompts } from '@shared/story';
import type { StoryboardScene } from '@shared/types';

const twoByTwoPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

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

describe('draft writer', () => {
  it('writes a Jianying draft folder with materials, tracks, and microsecond timing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-draft-'));
    const draftRootDir = join(dir, 'JianyingPro Drafts');
    const workDir = join(dir, 'work');
    const scenes: StoryboardScene[] = [
      { id: 1, cap: 'First line', descPrompt: 'prompt 1', durationMs: 1200 },
      { id: 2, cap: 'Second line', descPrompt: 'prompt 2', durationMs: 1400 },
    ];
    const images = await writeAssets(workDir, scenes, 'png', twoByTwoPng);
    await mkdir(join(workDir, 'audio'), { recursive: true });
    const narration = await Promise.all(
      scenes.map(async (scene) => {
        const path = join(workDir, 'audio', `${scene.id}.wav`);
        await writeFile(path, wavTone(scene.durationMs));
        return { sceneId: scene.id, path };
      }),
    );

    try {
      const bridgePayloads: unknown[] = [];
      const output = await writeJianyingDraft(
        {
          workDir,
          draftRootDir,
          title: 'Real Draft',
          cover: {
            title: 'Real Draft',
            subtitle: ['subtitle'],
            summary: 'summary',
            tags: ['#tag'],
            comments: ['comment'],
          },
          ratio: '9:16',
          scenes,
          imagePrompts: buildImagePrompts(scenes, { inputText: 'Wu Zetian', style: 'photo-real', ratio: '9:16' }),
          reviewedText: 'reviewed',
          rewrittenCopy: 'rewritten',
          generatedImages: images,
          narrationAudio: narration,
          bgm: null,
        },
        {
          runBridge: async (payload) => {
            bridgePayloads.push(payload);
            await mkdir(payload.draftDir, { recursive: true });
            await mkdir(join(payload.draftDir, 'materials'), { recursive: true });
            await writeFile(
              join(payload.draftDir, 'draft_content.json'),
              JSON.stringify({
                duration: payload.totalDurationUs,
                canvas_config: { width: payload.canvas.width, height: payload.canvas.height, ratio: 'original' },
                materials: {
                  videos: payload.images,
                  audios: payload.narration,
                  texts: payload.scenes,
                },
                tracks: [
                  { type: 'video', segments: [{ target_timerange: { start: 0, duration: 1_200_000 } }, { target_timerange: { start: 1_200_000, duration: 1_400_000 } }] },
                  { type: 'audio', segments: [] },
                  { type: 'text', segments: [] },
                ],
              }),
              'utf8',
            );
            await writeFile(join(payload.draftDir, 'draft_meta_info.json'), JSON.stringify({ draft_name: payload.title, tm_duration: payload.totalDurationUs }), 'utf8');
            return {
              draftDir: payload.draftDir,
              draftContentPath: join(payload.draftDir, 'draft_content.json'),
              draftMetaPath: join(payload.draftDir, 'draft_meta_info.json'),
              durationUs: payload.totalDurationUs ?? 0,
            };
          },
        },
      );

      const draftContent = JSON.parse(await readFile(output.draftContentPath, 'utf8'));
      const draftMeta = JSON.parse(await readFile(output.draftMetaPath, 'utf8'));

      expect(output.draftDir).toContain('Real Draft');
      expect(draftContent.duration).toBe(2_600_000);
      expect(draftContent.canvas_config).toMatchObject({ width: 1080, height: 1920, ratio: 'original' });
      expect(draftContent.materials.videos).toHaveLength(2);
      expect(draftContent.materials.audios).toHaveLength(2);
      expect(draftContent.materials.texts).toHaveLength(2);
      expect(draftContent.tracks.map((track: { type: string }) => track.type)).toEqual(['video', 'audio', 'text']);
      expect(draftContent.tracks[0].segments[1].target_timerange.start).toBe(1_200_000);
      expect(draftMeta.draft_name).toBe('Real Draft');
      expect(draftMeta.tm_duration).toBe(2_600_000);
      expect(output.assets.images).toHaveLength(2);
      expect(output.assets.narration).toHaveLength(2);
      expect(output.diagnostics.checks.find((check) => check.id === 'jianying-draft')?.status).toBe('pass');
      expect(bridgePayloads).toHaveLength(1);
      expect(bridgePayloads[0]).toMatchObject({
        title: 'Real Draft',
        totalDurationUs: 2_600_000,
        scenes: [
          { sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'First line' },
          { sceneId: 2, startUs: 1_200_000, durationUs: 1_400_000, text: 'Second line' },
        ],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects draft creation when real image or narration assets are missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-draft-missing-'));
    const scenes: StoryboardScene[] = [{ id: 1, cap: 'Only line', descPrompt: 'prompt', durationMs: 1000 }];
    const audioPath = join(dir, 'audio.wav');
    await writeFile(audioPath, wavTone(1000));

    try {
      await expect(
        writeJianyingDraft({
          workDir: join(dir, 'work'),
          draftRootDir: join(dir, 'JianyingPro Drafts'),
          title: 'Missing Image',
          cover: { title: 'Missing Image', subtitle: [], summary: '', tags: [], comments: [] },
          ratio: '9:16',
          scenes,
          imagePrompts: [],
          reviewedText: 'reviewed',
          rewrittenCopy: 'rewritten',
          generatedImages: [{ sceneId: 1, path: join(dir, 'missing.png') }],
          narrationAudio: [{ sceneId: 1, path: audioPath }],
          bgm: null,
        }),
      ).rejects.toThrow(/image asset/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeAssets(
  workDir: string,
  scenes: StoryboardScene[],
  extension: string,
  data: Buffer,
): Promise<Array<{ sceneId: number; path: string }>> {
  await mkdir(join(workDir, 'images'), { recursive: true });
  return Promise.all(
    scenes.map(async (scene) => {
      const path = join(workDir, 'images', `${scene.id}.${extension}`);
      await writeFile(path, data);
      return { sceneId: scene.id, path };
    }),
  );
}
