import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('director product flow', () => {
  it('uses the unified task system instead of a route-local project library', async () => {
    const [vox, comic, start] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/director-desk/DirectorProjectStart.tsx'),
    ]);
    expect(vox).not.toContain('void openProject(projects[0].id)');
    expect(comic).not.toContain('void openProject(projects[0].id)');
    expect(vox).not.toContain('<DirectorProjectLibrary');
    expect(comic).not.toContain('<DirectorProjectLibrary');
    expect(start).not.toContain('data-director-project-library');
    expect(vox).toContain('onReturnTasks={() => navigate?.(returnView)}');
    expect(comic).toContain('onReturnTasks={() => navigate?.(returnView)}');
    expect(start).toContain('data-director-project-recovery');
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
    for (const page of [vox, comic]) {
      expect(page).toContain("const actionFeedback = providerAction.feedback?.tone === 'success'");
      expect(page.match(/feedback=\{actionFeedback\}/g)).toHaveLength(2);
    }
  });

  it('keeps the create action row reachable while the form scrolls', async () => {
    const css = await source('src/styles/features/director-desk.css');
    expect(css).toMatch(/\.director-create-footer\s*\{[^}]*position:\s*sticky/);
    expect(css).toContain('bottom: 0');
    expect(css).toContain('background: var(--shell-surface)');
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
    expect(workspace).toContain('useLayoutEffect');
    expect(workspace).toContain("const status = loadState.src === src ? loadState.status : 'loading'");
    expect(workspace).not.toContain("setStatus('loading')");
    expect(workspace).toContain('thumbnail?: string');
    expect(workspace).toContain('asset.thumbnail');
    expect(workspace).toContain('director-asset-missing');
    expect(workspace).toContain('缺少参考图');
    expect(workspace).toContain('显示项目与镜头');
    expect(workspace).toContain('显示镜头检查器');
    expect(workspace).toContain('directorShotStatusLabel');
    expect(css).toContain("[data-left-pane-open='true']");
    expect(css).toContain("[data-inspector-open='true']");
    expect(css).not.toContain('font-size: 8px');
    expect(css).toContain('.director-mini-status-label');
    expect(css).toContain('.director-asset-missing');
    expect(css).toMatch(/\.director-queue-copy span\s*\{[^}]*font-size:\s*10px/);
    expect(css).toMatch(/\.director-video-job-id\s*\{[^}]*font-size:\s*10px/);
  });

  it('uses a real project asset for the cover and exposes an empty cover state', async () => {
    const [workspace, css] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
    ]);
    expect(workspace).toContain('const projectCover = useMemo(');
    expect(workspace).toContain("assets?.find((asset) => asset.thumbnail?.trim())?.thumbnail");
    expect(workspace).toContain("shots.find((shot) => shot.thumbnail?.trim())?.thumbnail");
    expect(workspace).toContain('尚未生成项目封面');
    expect(workspace).toContain('尚未生成镜头画面');
    expect(workspace).not.toContain("selectedShot.thumbnail ?? previewCity");
    expect(workspace).not.toContain('<DirectorMediaImage src={previewCity} alt="项目封面"');
    expect(css).toContain('.director-project-cover--empty');
  });

  it('keeps every matching asset reachable with an explicit expand control', async () => {
    const [workspace, css] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
    ]);
    expect(workspace).toContain("const [showAllAssets, setShowAllAssets] = useState(false);");
    expect(workspace).toContain('const renderedAssets = showAllAssets ? assetPage.items : visibleAssets.slice(0, 9);');
    expect(workspace).toContain('{renderedAssets.map((asset) => (');
    expect(workspace).toContain('显示全部素材（${visibleAssets.length}）');
    expect(workspace).toContain("{showAllAssets ? '收起素材' : `显示全部素材（${visibleAssets.length}）`}");
    expect(workspace).toContain('aria-expanded={showAllAssets}');
    expect(css).toContain('.director-assets-grid-footer');
    expect(css).toContain('.director-asset-workspace:not(.is-filtered) .director-assets-grid-footer');
    expect(css).toContain('.director-asset-workspace.is-filtered .director-assets-grid-footer');
  });

  it('exposes the persisted render quality report in the审片 stage', async () => {
    const [workspace, vox, comic] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    expect(workspace).toContain("inspectorTab === 'quality'");
    expect(workspace).toContain("if (stage === '审片') setInspectorTab('quality');");
    expect(workspace).not.toContain("if (stage === '审片') setInspectorTab('generate');");
    expect(workspace).toContain('director-quality-review');
    expect(workspace).toContain('重新生成并审片');
    expect(workspace).toContain('qualityPassedCount');
    expect(workspace).toContain('formatQualityRecheckScope');
    expect(workspace).toContain('定位复检范围');
    expect(workspace).toContain('onConfirmQualityReview');
    expect(workspace).toContain('data-quality-confirmed');
    expect(vox).toContain('qualityReview={qualityReview}');
    expect(comic).toContain('qualityReview={qualityReview}');
    expect(vox).toContain('directorQualityReview(document)');
    expect(comic).toContain('directorQualityReview(document, activeEpisode?.id)');
    expect(workspace).toContain('data-quality-freshness={qualityFreshness}');
    expect(workspace).toContain('resolveProductionQualityRecheckScope');
    expect(vox).toContain('onConfirmQualityReview={confirmQualityReview}');
    expect(comic).toContain('onConfirmQualityReview={confirmQualityReview}');
  });

  it('exposes persisted VOX style candidates as a selectable baseline', async () => {
    const [workspace, vox] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
    ]);
    expect(workspace).toContain('director-style-candidates');
    expect(workspace).toContain('onSelectStyle?.(style.id)');
    expect(workspace).toContain('onGenerateStyleCandidate');
    expect(workspace).toContain('generateStyleCandidate(style.id)');
    expect(vox).toContain('styleCandidates={directorStyleCandidates}');
    expect(vox).toContain('styleCandidates: current.styleCandidates.map');
    expect(vox).toContain('applyEditorialStyleCandidateRecord');
    expect(vox).toContain('directorStyleCandidateInput');
  });

  it('exposes an authoritative batch generation plan with pause, cancel, and retry controls', async () => {
    const [workspace, batch, vox, comic] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/features/director-desk/director-batch.ts'),
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    for (const label of ['批量生成计划', '仅缺失/失败', '全部重做', '暂停批量生成', '取消未开始项', '重试失败项']) {
      expect(workspace).toContain(label);
    }
    expect(batch).toContain('runDirectorBatchPlan');
    expect(batch).toContain('createDirectorBatchController');
    expect(batch).toContain('concurrency');
    expect(vox).toContain('enqueueProjectMutation');
    expect(comic).toContain('enqueueProjectMutation');
    expect(workspace).not.toContain('item.progress + 9');
  });
});
