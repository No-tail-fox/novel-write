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

  it('blocks unavailable image services and unsupported references before paid generation', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    const comicGeneration = comic.slice(comic.indexOf('async function generateShot(shotId: string)'));
    const voxGeneration = vox.slice(vox.indexOf('async function generateShot(shotId: string)'));
    expect(comicGeneration).toContain('if (!providerStatus.supportsReferenceImages)');
    expect(comic).toContain('不支持参考图编辑');
    for (const generation of [voxGeneration, comicGeneration]) {
      expect(generation).toContain('if (!providerStatus.connected)');
      expect(generation).toContain('图片服务未配置');
      expect(generation.indexOf('if (!providerStatus.connected)')).toBeLessThan(generation.indexOf('api.generateImageLab('));
    }
    expect(comicGeneration.indexOf('if (!providerStatus.supportsReferenceImages)')).toBeLessThan(comicGeneration.indexOf('api.generateImageLab('));
    expect(voxGeneration).toContain("if (shot.productionRecipe === 'paper-cut')");
    expect(voxGeneration).toContain('原画参考分层需要支持参考图的图片服务');
    expect(vox).toContain('disabled: !profile.connected');
    expect(comic).toContain('disabled: !profile.connected || !profile.supportsReferenceImages');
  });

  it('does not persist a fallback celebrity voice when narration is disconnected', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    expect(vox).toContain('const createVoiceIdForProject = voiceStatus.connected ? (createVoiceId || voiceStatus.voiceId) : undefined;');
    expect(vox).toContain('voiceId: createVoiceIdForProject');
    const createComic = comic.slice(comic.indexOf('async function createProject()'), comic.indexOf('async function persistProject('));
    expect(createComic).toContain('api.createMotionComic({');
    expect(createComic).not.toContain('voiceId:');
    expect(comic).toContain("value={character.voiceId ?? ''}");
    expect(comic).toContain("{ value: '', label: '跟随镜头默认音色' }, ...voiceStatus.voices");
    expect(comic).toContain('voiceId: event.target.value || undefined');
  });

  it('renders Chinese labels for MV preview enums', async () => {
    const page = await source('src/features/music-mv/MusicMvPage.tsx');
    expect(page).toContain("options={['lyric-sync', 'fast-cut', 'slow-cinematic']} labels={['歌词同步', '快切', '慢镜头']}");
    expect(page).toContain("options={['minimal', 'karaoke', 'none']} labels={['极简', '卡拉 OK', '无字幕']}");
    expect(page).toContain("options={['full-auto', 'manual']} labels={['全自动制作', '先检查时间轴']}");
    expect(page).not.toContain("index === 0 ? 'intro'");
    expect(page).not.toContain("index === lyricLines.length - 1 ? 'outro'");
  });
});
