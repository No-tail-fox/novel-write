import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJianyingDraft, type WriteJianyingDraftInput } from '../src/shared/draft';

describe('video-only draft scene assets', () => {
  it('keeps scene IDs aligned when a video scene has no fallback image', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'draft-video-only-'));
    try {
      const image = join(dir, 'image.png'), video = join(dir, 'video.mp4'), voice = join(dir, 'voice.wav');
      await Promise.all([image, video, voice].map(path => writeFile(path, 'test-asset')));
      const input: WriteJianyingDraftInput = {
        workDir: dir, draftRootDir: join(dir, 'drafts'), title: 'Video-only', ratio: '9:16',
        cover: { title: 'Video-only', subtitle: [], summary: '', tags: [], comments: [] },
        scenes: [{ id: 1, cap: 'video', descPrompt: '', durationMs: 1000 }, { id: 2, cap: 'image', descPrompt: '', durationMs: 1000 }],
        imagePrompts: [], reviewedText: '', rewrittenCopy: '', bgm: null,
        generatedImages: [{ sceneId: 2, path: image }],
        generatedVideos: [{ sceneId: 1, path: video, durationMs: 1000, source: 'local-upload', originalName: 'video.mp4', width: 720, height: 1280, trimStartMs: 0, fit: 'cover', muted: true }],
        narrationAudio: [{ sceneId: 1, path: voice }, { sceneId: 2, path: voice }],
      };
      await writeJianyingDraft(input, { runBridge: async payload => {
        expect(payload.images).toEqual([{ sceneId: 2, path: image }]);
        expect(payload.videos?.map(v => v.sceneId)).toEqual([1]);
        await mkdir(payload.draftDir, { recursive: true });
        return { draftDir: payload.draftDir, draftContentPath: join(payload.draftDir, 'draft_content.json'), draftMetaPath: join(payload.draftDir, 'draft_meta_info.json'), durationUs: 2000000 };
      }});
      await writeJianyingDraft(input, { runSidecar: async payload => {
        if (!('assets' in payload)) throw new Error('Expected story payload');
        expect(payload.assets?.images).toEqual([{ scene_id: 2, path: image }]);
        return { success: true, draft_dir: join(dir, 'drafts') };
      }});
      await expect(writeJianyingDraft({ ...input, generatedImages: [] })).rejects.toThrow('Missing image asset for scene 2');
      await expect(writeJianyingDraft({ ...input, generatedVideos: [] })).rejects.toThrow('Missing image asset for scene 1');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
