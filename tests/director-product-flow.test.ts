import { readFile } from 'node:fs/promises';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import type { DirectorImageProviderStatus } from '../src/features/director-desk/director-generation';
import { MotionComicCreateFlow } from '../src/features/motion-comic/MotionComicCreateFlow';
import { MotionComicProductionWorkspace, type MotionComicStageState } from '../src/features/motion-comic/MotionComicProductionWorkspace';
import { motionComicReferenceGenerationInput } from '../src/features/motion-comic/motion-comic-reference-generation';
import { createMotionComicDraft, createMotionComicStarterProject, MOTION_COMIC_WORKFLOW_STAGES, type MotionComicWorkflowStage } from '../src/shared/motion-comic';

// Server markup cannot mount a Fluent portal; render the inspector drawer inline.
vi.mock('../src/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/ui')>(),
  Drawer: ({ children }: { children: ReactNode }) => createElement('aside', { 'data-ssr-inspector': true }, children),
}));

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

const noop = () => {};

function motionComicProject() {
  return createMotionComicStarterProject(createMotionComicDraft({ id: 'series-bible', title: '来信', premise: '在邮局找到线索。', now: '2026-10-20T00:00:00.000Z' }));
}

function motionComicCreateFlowMarkup(step: number): string {
  return renderToStaticMarkup(createElement(MotionComicCreateFlow, {
    step, title: '雨夜来信', ratio: '16:9', sourceKind: 'script', adaptationMode: 'faithful-script', sourceFileName: '', sourceText: '第一章 雨夜。',
    targetCharacters: '2400', targetDurationSec: '', splitInstructions: '', episodes: [{ title: '第 1 集', sourceText: '第一章 雨夜。' }], busy: false,
    services: [{ id: 'image', label: '参考图与分镜图', model: 'gpt-image', ready: false }],
    onStepChange: noop, onTitleChange: noop, onRatioChange: noop, onSourceKindChange: noop, onAdaptationModeChange: noop, onSourceTextChange: noop,
    onTargetCharactersChange: noop, onTargetDurationSecChange: noop, onSplitInstructionsChange: noop, onEpisodeChange: noop,
    onImportFile: noop, onPrepareEpisodes: noop, onCreate: noop,
  }));
}

function actionFeedbackDeclaration(page: string): string {
  return page.split('\n').find((line) => line.trimStart().startsWith('const actionFeedback = ')) ?? '';
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
    expect(vox).toContain('onBackToTasks={() => navigate?.(returnView)}');
    expect(comic).toContain('onBackToTasks={() => navigate?.(returnView)}');
    expect(start).not.toContain('onReturnTasks');
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
    // AI 漫剧 uses its own source-first three-step preflight (剧本导入 → 分集确认 → 创建项目).
    for (const step of [0, 1, 2]) {
      const markup = motionComicCreateFlowMarkup(step);
      expect(markup).toContain(`data-step="${step}"`);
      expect(markup).toContain(`步骤 ${step + 1} / 3`);
      for (const label of ['剧本导入', '分集确认', '创建项目']) expect(markup).toContain(label);
    }
    expect(motionComicCreateFlowMarkup(2)).toContain('建立项目不会调用图片、视频、配音或文本生成接口');
    expect(comic).toContain('<MotionComicCreateFlow');
    expect(comic).toContain('step={createStep}');
    // Preflight choices survive as a draft and are persisted into the created document.
    for (const value of ['createTitle,', 'createRatio,', 'createSourceKind,', 'createAdaptationMode,', 'createSplitStrategy,', 'createEpisodeDraftsJson: JSON.stringify(createEpisodeDrafts)']) {
      expect(comic).toContain(value);
    }
    expect(comic).toMatch(/api\.createMotionComic\(\{[\s\S]*?title: createTitle,[\s\S]*?ratio: createRatio,[\s\S]*?kind: createSourceKind,[\s\S]*?adaptationMode: createAdaptationMode,[\s\S]*?episodes,[\s\S]*?splitEvidence,/);
    // Series, voice, subtitle and seed choices moved out of the preflight and are persisted where they are edited.
    for (const field of ['genre', 'tone', 'audience']) expect(comic).toContain(`series: { ...current.series, ${field}: data.value }`);
    for (const field of ['voiceId: update.voiceId ?? shot.voiceId', 'subtitleStyle: update.subtitleStyle ?? shot.subtitleStyle', 'seedLocked: update.seedLocked ?? shot.seedLocked']) {
      expect(comic).toContain(field);
    }
    expect(vox).toContain('api.saveEditorialCollage');
    expect(comic).toContain('api.saveMotionComic');
    expect(start).toContain('图片服务');
    expect(start).toContain('旁白服务');
    expect(start).toContain('创建项目本身不调用付费生成');
    // Only successful action feedback is surfaced as shared feedback; errors use the error channel.
    for (const [page, surfaces] of [[vox, 2], [comic, 3]] as const) {
      const declaration = actionFeedbackDeclaration(page);
      expect(declaration).toContain("providerAction.feedback?.tone === 'success' ? providerAction.feedback.message");
      expect(declaration).toContain("projectAction.feedback?.tone === 'success' ? projectAction.feedback.message");
      expect(declaration).not.toContain("tone === 'error'");
      expect(page.match(/feedback=\{actionFeedback\}/g)).toHaveLength(surfaces);
    }
    expect(actionFeedbackDeclaration(vox)).toMatch(/^\s*const actionFeedback = providerAction\.feedback\?\.tone === 'success'/);
    expect(actionFeedbackDeclaration(comic)).toMatch(/^\s*const actionFeedback = sourceFileAction\.feedback\?\.tone === 'success'/);
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
    expect(settings).toContain('返回 创意动画');
    expect(settings).toContain('返回 AI 漫剧');
    expect(vox).toContain("openSettings?.('image', 'editorial-collage')");
    expect(comic).toContain("openSettings?.('image', 'motion-comic')");
  });

  it('renders the AI series bible as a full page rather than an overflowing dialog', async () => {
    const comic = await source('src/features/motion-comic/MotionComicPage.tsx');
    expect(comic).toContain('data-motion-comic-series-bible="true"');
    expect(comic).toContain('director-series-page');
    expect(comic).not.toContain('<Dialog');
    // The series bible is the full-page 项目资产 stage of the production workspace, saved via that page's save action.
    expect(comic).toMatch(/<MotionComicProductionWorkspace\s+document=\{document\}\s+stage="assets"[^>]*?onSave=\{\(\) => void saveProject\(\)\}[\s\S]*?\n\s*>\s*<div data-motion-comic-series-bible="true" className="director-series-page">/);
    const document = motionComicProject();
    const stageState = Object.fromEntries(MOTION_COMIC_WORKFLOW_STAGES.map((stage) => [stage, { ready: true, complete: false, detail: '' }])) as Record<MotionComicWorkflowStage, MotionComicStageState>;
    const page = createElement(MotionComicProductionWorkspace, {
      document, stage: 'assets', stageState, dirty: true, busy: false,
      onStageChange: noop, onSave: noop, onNewProject: noop, onBack: noop,
      children: createElement('div', { 'data-motion-comic-series-bible': 'true', className: 'director-series-page' }, '系列圣经'),
    });
    const markup = renderToStaticMarkup(page);
    expect(markup).toContain('data-stage="assets"');
    expect(markup).toContain('data-motion-comic-series-bible="true"');
    expect(markup).not.toContain('role="dialog"');
    const saveButton = (markup.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g) ?? []).find((button) => button.includes('保存'));
    expect(saveButton).toBeDefined();
    expect(saveButton?.slice(0, saveButton.indexOf('>') + 1)).not.toContain('disabled');
    // Scene (empty-shot) and prop reference images are managed on the same page.
    expect(comic).toContain("referenceImportControl('scene', asset.id, versions.length > 0)");
    expect(comic).toContain("referenceImportControl('prop', asset.id, versions.length > 0)");
    const provider: DirectorImageProviderStatus = {
      profileId: 'image-profile', connected: true, provider: 'gpt_image', supportsReferenceImages: true,
      maxReferenceImages: 10, label: 'Configured image model', model: 'gpt-image-2.5', resolution: '2K', quality: 'high',
    };
    expect(motionComicReferenceGenerationInput(document, { kind: 'scene', id: document.sceneAssets[0].id }, provider).prompt).toContain('场景空镜参考图');
    expect(motionComicReferenceGenerationInput(document, { kind: 'prop', id: document.props[0].id }, provider).prompt).toContain('道具参考图');
  });

  it('derives stage completion and health from real project and provider state', async () => {
    const [vox, comic, workspace] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
    ]);
    expect(vox).toContain('completedStages={completedStages}');
    expect(comic).toContain('completedStages={completedStages}');
    expect(workspace).toContain('reviewedCompletedStages.includes(stage)');
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
    expect(workspace).toContain('onReviewQualityArtifact');
    expect(workspace).toContain('data-artifact-status');
    expect(workspace).not.toContain('confirmedAt: new Date()');
    expect(workspace).toContain('data-quality-confirmed');
    expect(vox).toContain('qualityReview={qualityReview}');
    expect(comic).toContain('qualityReview={qualityReview}');
    expect(vox).toContain('directorQualityReview(document)');
    expect(comic).toContain('directorQualityReview(document, activeEpisode?.id)');
    expect(workspace).toContain('data-quality-freshness={qualityFreshness}');
    expect(workspace).toContain('resolveProductionQualityRecheckScope');
    expect(vox).toContain('onReviewQualityArtifact={reviewQualityArtifact}');
    expect(comic).toContain('onReviewQualityArtifact={reviewQualityArtifact}');
    expect(vox).toContain('api.reviewDirectorArtifact');
    expect(comic).toContain('api.reviewDirectorArtifact');
  });

  it('exposes persisted VOX style candidates as a selectable baseline', async () => {
    const [workspace, vox] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
    ]);
    expect(workspace).toContain('director-style-candidates');
    // Persisted candidates render as selectable baselines (selection state from the document) with a per-style generate action.
    const candidates = [
      { id: 'paper', label: '纸张拼贴', prompt: '撕纸纹理与旧报纸', assetVersionId: 'asset-paper-1', selected: false },
      { id: 'ink', label: '水墨晕染', prompt: '水墨与留白', selected: true },
    ];
    const markup = renderToStaticMarkup(createElement(DirectorDeskWorkspace, {
      mode: 'vox', projectTitle: '拉萨旧城的回声', projectMeta: '', episodeTitle: '', stageLabel: '镜头生成',
      selectedShotId: 'shot', dirty: false, providerConnected: true,
      shots: [{ id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' }],
      onSelectShot: noop, onUpdateShot: noop, onSave: noop,
      styleCandidates: candidates, onSelectStyle: noop, onGenerateStyleCandidate: async () => ({ thumbnail: '', provider: 'gpt_image' }),
    }));
    expect(markup).toContain('class="director-style-candidates"');
    const selectButtons = markup.match(/<button[^>]*director-style-candidate-select[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(selectButtons).toHaveLength(2);
    expect(selectButtons[0]).toContain('aria-pressed="false"');
    expect(selectButtons[0]).toContain('纸张拼贴');
    expect(selectButtons[0]).toContain('已有样片');
    expect(selectButtons[1]).toContain('aria-pressed="true"');
    expect(selectButtons[1]).toContain('待试片');
    for (const candidate of candidates) expect(markup).toContain(`aria-label="生成${candidate.label}试片"`);
    // Choosing a candidate and generating its sample are wired to the page callbacks.
    expect(workspace).toContain('onClick={() => onSelectStyle?.(style.id)}');
    expect(workspace).toContain('onClick={() => void generateStyleCandidate(style.id)}');
    expect(workspace).toContain('await onGenerateStyleCandidate(styleId);');
    expect(vox).toContain('styleCandidates={directorStyleCandidates}');
    expect(vox).toContain('onSelectStyle={selectStyle}');
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
