import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('director product flow', () => {
  it('opens on a stable project library instead of auto-opening the first project', async () => {
    const [vox, comic, start] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/director-desk/DirectorProjectStart.tsx'),
    ]);
    expect(vox).not.toContain('void openProject(projects[0].id)');
    expect(comic).not.toContain('void openProject(projects[0].id)');
    expect(vox).toContain('<DirectorProjectLibrary');
    expect(comic).toContain('<DirectorProjectLibrary');
    expect(start).toContain('继续上次项目');
    expect(start).toContain('新建项目');
    expect(start).toContain('data-director-project-library');
  });

  it('uses a three-step preflight whose choices are persisted into both documents', async () => {
    const [vox, comic, start] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/director-desk/DirectorProjectStart.tsx'),
    ]);
    for (const label of ['内容结构', '生成与一致性', '声音与输出']) expect(start).toContain(label);
    expect(start).toContain('data-director-create-wizard');
    for (const value of ['createStep', 'createStyleId', 'createLayoutTemplate', 'createMotionPreset', 'createVoiceId', 'createSubtitleStyle', 'createSeedLocked']) {
      expect(vox).toContain(value);
    }
    for (const value of ['createStep', 'createGenre', 'createTone', 'createAudience', 'createProtagonist', 'createLocation', 'createVoiceId', 'createSubtitleStyle', 'createSeedLocked']) {
      expect(comic).toContain(value);
    }
    expect(vox).toContain('api.saveEditorialCollage');
    expect(comic).toContain('api.saveMotionComic');
    expect(start).toContain('图片服务');
    expect(start).toContain('旁白服务');
    expect(start).toContain('创建项目本身不调用付费生成');
  });

  it('deep-links provider repair to AI drawing and restores the source workflow', async () => {
    const [app, routes, settings, vox, comic] = await Promise.all([
      source('src/app/App.tsx'),
      source('src/app/AppRoutes.tsx'),
      source('src/features/settings/SettingsPage.tsx'),
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    expect(app).toContain('settingsEntry');
    expect(app).toContain('openSettings');
    expect(routes).toContain('initialSettingsSection');
    expect(routes).toContain('returnFromSettings');
    expect(settings).toContain("useState<SettingsSection>(initialSection ?? 'llm')");
    expect(settings).toContain('返回 VOX 视频');
    expect(settings).toContain('返回 AI 漫剧');
    expect(vox).toContain("openSettings?.('image', 'editorial-collage')");
    expect(comic).toContain("openSettings?.('image', 'motion-comic')");
  });

  it('renders the AI series bible as a full page rather than an overflowing dialog', async () => {
    const comic = await source('src/features/motion-comic/MotionComicPage.tsx');
    expect(comic).toContain('data-motion-comic-series-bible="true"');
    expect(comic).toContain('director-series-page');
    expect(comic).toContain('保存系列圣经');
    expect(comic).toContain('场景一致性');
    expect(comic).toContain('道具一致性');
    expect(comic).not.toContain('<Dialog');
  });

  it('derives stage completion and health from real project and provider state', async () => {
    const [vox, comic, workspace] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
    ]);
    expect(vox).toContain('completedStages={completedStages}');
    expect(comic).toContain('completedStages={completedStages}');
    expect(workspace).toContain('completedStages.includes(stage)');
    expect(workspace).not.toContain('index < 3');
    expect(workspace).toContain('systemStatusTone');
    expect(workspace).toContain('{systemStatus}');
    expect(workspace).not.toContain('系统状态：正常');
    expect(workspace).not.toContain("stage === '审片' && !isPlaying");
    expect(vox).toContain("asset.kind === 'image'");
    expect(comic).toContain('shot.firstFrameAssetVersionId');
  });

  it('uses explicit media states and compact pane controls without 8px workflow text', async () => {
    const [workspace, css] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
    ]);
    expect(workspace).toContain('DirectorMediaImage');
    expect(workspace).toContain('正在恢复镜头画面');
    expect(workspace).toContain('画面加载失败');
    expect(workspace).toContain('显示项目与镜头');
    expect(workspace).toContain('显示镜头检查器');
    expect(workspace).toContain('directorShotStatusLabel');
    expect(css).toContain("[data-left-pane-open='true']");
    expect(css).toContain("[data-inspector-open='true']");
    expect(css).not.toContain('font-size: 8px');
    expect(css).toContain('.director-mini-status-label');
  });
});
