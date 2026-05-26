import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDraftPackage } from '@shared/draft';
import { buildImagePrompts } from '@shared/story';

describe('draft writer', () => {
  it('writes a structured draft package with assets and manifests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-draft-'));
    const scenes = [
      { id: 1, cap: '第一句', descPrompt: 'prompt 1', durationMs: 1200 },
      { id: 2, cap: '第二句', descPrompt: 'prompt 2', durationMs: 1400 },
    ];

    try {
      const output = await writeDraftPackage({
        outputDir: dir,
        title: '武则天',
        cover: {
          title: '武则天',
          subtitle: ['她被深宫遗忘十二年', '却走成唯一女皇'],
          summary: '十四岁入宫，十二年没有升迁。',
          tags: ['#女皇'],
          comments: ['真传奇'],
        },
        ratio: '9:16',
        scenes,
        imagePrompts: buildImagePrompts(scenes, { inputText: '武则天', style: 'photo-real', ratio: '9:16' }),
        reviewedText: 'reviewed',
        rewrittenCopy: 'rewritten',
        bgm: { title: 'bgm', durationMs: 2400 },
      });

      const items = await readdir(output.packageDir);
      expect(items).toContain('draft-project.json');
      expect(items).toContain('diagnostics.json');
      expect(items).toContain('03-image-prompts.json');

      const draftContent = JSON.parse(await readFile(join(output.packageDir, 'draft-project.json'), 'utf8'));
      expect(draftContent.title).toBe('武则天');
      expect(draftContent.tracks.images).toHaveLength(2);
      expect(output.assets.images).toHaveLength(2);
      expect(output.assets.audio).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
