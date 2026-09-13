import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('U04 service terminology and capability semantics', () => {
  it('keeps voice selection in the voice inspector instead of a fake single-option dropdown', async () => {
    const workspace = await source('src/features/director-desk/DirectorDeskWorkspace.tsx');
    expect(workspace).not.toContain('李立宏（男声）');
    expect(workspace).toContain('跟随旁白设置');
    expect(workspace).toContain('请在“旁白与字幕”中选择真实音色');
    expect(workspace).toContain('TextField label="音色" value={voice} readOnly');
  });

  it('blocks image profiles that cannot support the workflow before saving them', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    expect(comic).toContain('!option.supportsReferenceImages');
    expect(comic).toContain('不支持参考图编辑');
    for (const page of [vox, comic]) expect(page).toContain('图片生成服务未配置');
    expect(vox).not.toContain('if (!option.supportsReferenceImages)');
    expect(vox).toContain('disabled: !profile.connected');
    expect(comic).toContain('disabled: !profile.connected || !profile.supportsReferenceImages');
  });

  it('does not persist a fallback celebrity voice when narration is disconnected', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    for (const page of [vox, comic]) {
      expect(page).toContain('const createVoiceIdForProject = voiceStatus.connected');
      expect(page).toContain('voiceId: createVoiceIdForProject');
      expect(page).toContain(': undefined;');
    }
  });

  it('renders Chinese labels for MV preview enums', async () => {
    const page = await source('src/features/music-mv/MusicMvPage.tsx');
    expect(page).toContain('MUSIC_MV_RHYTHM_LABELS');
    expect(page).toContain('MUSIC_MV_CAPTION_LABELS');
    expect(page).toContain('MUSIC_MV_SCENE_LABELS');
    expect(page).not.toContain("index === 0 ? 'intro'");
    expect(page).not.toContain("index === lyricLines.length - 1 ? 'outro'");
  });
});
