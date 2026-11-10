import { readFile } from 'node:fs/promises';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import { DirectorCreateWizard, DirectorProjectRecovery } from '../src/features/director-desk/DirectorProjectStart';
import { createDirectorBatchController, runDirectorBatchPlan, type DirectorBatchNode } from '../src/features/director-desk/director-batch';
import type { DirectorImageProviderStatus } from '../src/features/director-desk/director-generation';
import { MotionComicCreateFlow } from '../src/features/motion-comic/MotionComicCreateFlow';
import { MotionComicProductionWorkspace, type MotionComicStageState } from '../src/features/motion-comic/MotionComicProductionWorkspace';
import { motionComicReferenceGenerationInput } from '../src/features/motion-comic/motion-comic-reference-generation';
import { createMotionComicDraft, createMotionComicStarterProject, MOTION_COMIC_WORKFLOW_STAGES, type MotionComicWorkflowStage } from '../src/shared/motion-comic';
import { elementWithClass, markupButtons, markupText, openingTag } from './helpers/ssr-markup';

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

type DirectorDeskProps = Parameters<typeof DirectorDeskWorkspace>[0];
type DirectorDeskShot = DirectorDeskProps['shots'][number];

function deskShot(overrides: Partial<DirectorDeskShot> = {}): DirectorDeskShot {
  return { id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '', ...overrides };
}

function directorDeskMarkup(props: Partial<DirectorDeskProps> = {}): string {
  return renderToStaticMarkup(createElement(DirectorDeskWorkspace, {
    mode: 'motion-comic', projectTitle: '雨夜来信', projectMeta: '', episodeTitle: '第 1 集', stageLabel: '镜头生成',
    selectedShotId: 'shot', dirty: false, providerConnected: true, shots: [deskShot()],
    onSelectShot: noop, onUpdateShot: noop, onSave: noop,
    ...props,
  }));
}

function createWizardMarkup(connected: boolean): string {
  return renderToStaticMarkup(createElement(DirectorCreateWizard, {
    mode: 'motion-comic', step: 0, canContinue: true, canCreate: true,
    providerConnected: connected, providerLabel: 'GPT Image', voiceConnected: connected, voiceLabel: 'MiniMax 语音',
    summary: [], children: null, onStepChange: noop, onConfigureImage: noop, onConfigureVoice: noop, onCreate: noop,
  }));
}

function actionFeedbackDeclaration(page: string): string {
  return page.split('\n').find((line) => line.trimStart().startsWith('const actionFeedback = ')) ?? '';
}

describe('director product flow', () => {
  it('uses the unified task system instead of a route-local project library', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    expect(vox).not.toContain('void openProject(projects[0].id)');
    expect(comic).not.toContain('void openProject(projects[0].id)');
    expect(vox).not.toContain('<DirectorProjectLibrary');
    expect(comic).not.toContain('<DirectorProjectLibrary');
    expect(vox).toContain('onBackToTasks={() => navigate?.(returnView)}');
    expect(comic).toContain('onBackToTasks={() => navigate?.(returnView)}');
    // A missing project lands on the recovery state (not a route-local project library), and its only
    // action is creating a new project — returning to the task list stays with the unified task system.
    for (const [mode, action] of [['motion-comic', '新建 AI 漫剧系列'], ['vox', '新建 创意动画项目']] as const) {
      const recovery = renderToStaticMarkup(createElement(DirectorProjectRecovery, { mode, onNewProject: noop }));
      expect(recovery).toContain('data-director-project-recovery');
      expect(recovery).not.toContain('data-director-project-library');
      expect(markupButtons(recovery).map(markupText)).toEqual([action]);
    }
  });

  it('uses a three-step preflight whose choices are persisted into both documents', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    const offlineWizard = createWizardMarkup(false);
    const onlineWizard = createWizardMarkup(true);
    expect(offlineWizard).toContain('data-director-create-wizard');
    const createSteps = offlineWizard.match(/<nav[^>]*aria-label="创建步骤"[^>]*>[\s\S]*?<\/nav>/u)?.[0] ?? '';
    expect(markupButtons(createSteps).map((button) => button.match(/<strong>([^<]*)<\/strong>/u)?.[1])).toEqual(['内容结构', '生成与一致性', '声音与输出']);
    expect(markupButtons(createSteps).map((button) => /\sdisabled=""/u.test(openingTag(button)))).toEqual([false, true, true]);
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
    // The preflight reports both services and states that creating the project itself is free.
    for (const service of ['图片服务', '旁白服务']) {
      expect(offlineWizard).toContain(`<strong>${service}</strong>`);
      expect(onlineWizard).toContain(`<strong>${service}</strong>`);
    }
    expect(markupText(onlineWizard)).toContain('GPT Image 已配置');
    expect(markupText(onlineWizard)).toContain('MiniMax 语音 已配置');
    expect(markupText(offlineWizard)).not.toContain('已配置');
    for (const wizard of [offlineWizard, onlineWizard]) expect(markupText(wizard)).toContain('创建项目本身不调用付费生成');
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
    // Phase completion comes from the reported stages (not the phase position), and 审片 only counts once the
    // quality review is confirmed — an unconfirmed 审片 keeps 交付 open even when 导出 is reported.
    const stageTitles = (markup: string) => markupButtons(markup)
      .filter((button) => openingTag(button).includes('director-stage-step'))
      .map((button) => openingTag(button).match(/title="([^"]+)"/u)?.[1]);
    expect(stageTitles(directorDeskMarkup({ completedStages: ['剧本'] }))).toEqual(['文案 · 已完成', '分镜 · 待完成', '声音 · 待完成', '交付 · 待完成']);
    expect(stageTitles(directorDeskMarkup({ completedStages: ['配音字幕', '审片', '导出'] }))).toEqual(['文案 · 待完成', '分镜 · 待完成', '声音 · 已完成', '交付 · 待完成']);
    expect(stageTitles(directorDeskMarkup({ completedStages: ['画面拆解', '素材一致性', '镜头生成'] }))).toEqual(['文案 · 待完成', '分镜 · 已完成', '声音 · 待完成', '交付 · 待完成']);
    // The status footer shows the caller's real system status and tone instead of a hard-coded "normal".
    const statusFooter = (markup: string) => elementWithClass(markup, 'director-status-footer', 'footer') ?? '';
    const degraded = statusFooter(directorDeskMarkup({ systemStatus: '视频服务未连接', systemStatusTone: 'warning' }));
    expect(degraded).toContain('<span class="director-status-dot is-warning"></span>视频服务未连接');
    expect(degraded).not.toContain('生成服务正常');
    expect(statusFooter(directorDeskMarkup({ systemStatus: '图片服务异常', systemStatusTone: 'error' }))).toContain('<span class="director-status-dot is-error"></span>图片服务异常');
    expect(statusFooter(directorDeskMarkup())).toContain('<span class="director-status-dot is-ok"></span>生成服务正常');
    expect(markupText(directorDeskMarkup())).not.toContain('系统状态：正常');
    expect(workspace).not.toContain("stage === '审片' && !isPlaying");
    expect(vox).toContain("asset.kind === 'image'");
    expect(comic).toContain('shot.firstFrameAssetVersionId');
  });

  it('uses explicit media states and compact pane controls without 8px workflow text', async () => {
    const [workspace, css] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
    ]);
    // A persisted shot image starts in an explicit restoring state instead of flashing as ready or empty.
    const restoring = directorDeskMarkup({ shots: [deskShot({ thumbnail: 'file:///shot-1.png' })] });
    expect(restoring).toMatch(/<img[^>]*src="file:\/\/\/shot-1\.png"/u);
    expect(restoring).toMatch(/role="status"[^>]*>(?:(?!<\/div>)[\s\S])*?正在恢复镜头画面/u);
    // The error branch only exists after an <img> error event, which server markup cannot fire.
    expect(workspace).toContain('画面加载失败');
    expect(workspace).toContain('useLayoutEffect');
    expect(workspace).toContain("const status = loadState.src === src ? loadState.status : 'loading'");
    expect(workspace).not.toContain("setStatus('loading')");
    // Reference assets render their real thumbnail (with a loading state) or an explicit missing-reference tile.
    const assetMarkup = directorDeskMarkup({ assets: [
      { id: 'hero', label: '主角', type: '角色', thumbnail: 'file:///hero.png' },
      { id: 'alley', label: '小巷', type: '场景' },
    ] });
    const tiles = markupButtons(assetMarkup).filter((button) => openingTag(button).includes('director-asset-tile'));
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatch(/<img[^>]*src="file:\/\/\/hero\.png"/u);
    expect(tiles[0]).toContain('<strong>主角</strong>');
    expect(tiles[0]).toContain('class="director-media-image is-loading"');
    expect(tiles[0]).not.toContain('director-asset-missing');
    expect(tiles[1]).toContain('<span class="director-asset-missing" role="img" aria-label="缺少参考图">');
    expect(tiles[1]).not.toContain('<img');
    // Compact pane toggles are real, labelled controls bound to their panes.
    const paneToggles = markupButtons(directorDeskMarkup()).filter((button) => openingTag(button).includes('director-pane-toggle'));
    expect(paneToggles.map((button) => [openingTag(button).match(/aria-label="([^"]+)"/u)?.[1], openingTag(button).match(/aria-controls="([^"]+)"/u)?.[1], openingTag(button).match(/aria-expanded="([^"]+)"/u)?.[1]]))
      .toEqual([['显示项目与镜头', 'director-objects', 'false'], ['显示镜头检查器', 'director-inspector', 'false']]);
    // Shot cards carry a readable status label for every shot state.
    const statusMarkup = directorDeskMarkup({ shots: [
      deskShot({ id: 'shot', status: 'failed' }),
      deskShot({ id: 'queued', index: 2, status: 'queued' }),
      deskShot({ id: 'idle', index: 3, status: 'idle' }),
    ] });
    const statusLabels = [...statusMarkup.matchAll(/class="director-mini-status-label">([^<]*)</gu)].map((match) => match[1]);
    expect(statusLabels).toEqual(expect.arrayContaining(['失败', '排队中', '待生成']));
    expect(css).toContain("[data-left-pane-open='true']");
    expect(css).toContain("[data-inspector-open='true']");
    expect(css).not.toContain('font-size: 8px');
    expect(css).toContain('.director-mini-status-label');
    expect(css).toContain('.director-asset-missing');
    expect(css).toMatch(/\.director-queue-copy span\s*\{[^}]*font-size:\s*10px/);
    expect(css).toMatch(/\.director-video-job-id\s*\{[^}]*font-size:\s*10px/);
  });

  it('uses a real project asset for the cover and exposes an empty cover state', async () => {
    const css = await source('src/styles/features/director-desk.css');
    const coverSrc = (markup: string) => markup.match(/<img[^>]*src="([^"]*)"[^>]*alt="项目封面"/u)?.[1];
    // Nothing generated yet: explicit empty cover and empty shot preview, and no stock placeholder image anywhere.
    const empty = directorDeskMarkup({ assets: [{ id: 'hero', label: '主角', type: '角色' }] });
    expect(empty).toContain('aria-label="尚未生成项目封面"');
    expect(markupText(empty)).toContain('尚未生成镜头画面');
    expect(coverSrc(empty)).toBeUndefined();
    expect(empty.match(/<img\b[^>]*>/gu) ?? []).toEqual([]);
    // The first project asset with a real thumbnail wins over shot frames (blank thumbnails are skipped).
    const fromAsset = directorDeskMarkup({
      assets: [{ id: 'blank', label: '空', type: '角色', thumbnail: ' ' }, { id: 'hero', label: '主角', type: '角色', thumbnail: 'file:///hero.png' }],
      shots: [deskShot({ thumbnail: 'file:///shot-1.png' })],
    });
    expect(coverSrc(fromAsset)).toBe('file:///hero.png');
    expect(fromAsset.includes('尚未生成项目封面')).toBe(false);
    // Without asset thumbnails the cover falls back to the first generated shot frame, while the selected shot
    // without its own frame still reports the empty preview rather than borrowing a placeholder.
    const fromShot = directorDeskMarkup({
      shots: [deskShot({ id: 'shot' }), deskShot({ id: 'second', index: 2, thumbnail: 'file:///shot-2.png' })],
    });
    expect(coverSrc(fromShot)).toBe('file:///shot-2.png');
    expect(markupText(elementWithClass(fromShot, 'director-media-preview', 'div') ?? fromShot)).toContain('尚未生成镜头画面');
    expect(css).toContain('.director-project-cover--empty');
  });

  it('keeps every matching asset reachable with an explicit expand control', async () => {
    const css = await source('src/styles/features/director-desk.css');
    const assets = Array.from({ length: 12 }, (_, index) => ({ id: `asset-${index + 1}`, label: `素材 ${index + 1}`, type: '角色' }));
    const assetTiles = (markup: string) => markupButtons(markup).filter((button) => openingTag(button).includes('director-asset-tile'));
    const many = directorDeskMarkup({ assets });
    // The collapsed grid shows the first nine assets and an explicit, collapsed "show all (N)" control.
    expect(assetTiles(many).map((tile) => tile.match(/<strong>([^<]*)<\/strong>/u)?.[1])).toEqual(assets.slice(0, 9).map((asset) => asset.label));
    const expand = markupButtons(many).filter((button) => button.includes('显示全部素材'));
    expect(expand).toHaveLength(1);
    expect(markupText(expand[0])).toBe('显示全部素材（12）');
    expect(openingTag(expand[0])).toContain('aria-expanded="false"');
    expect(many).toContain('class="director-assets-grid-footer"');
    // Nine or fewer assets are all rendered and need no expand control.
    const few = directorDeskMarkup({ assets: assets.slice(0, 9) });
    expect(assetTiles(few)).toHaveLength(9);
    expect(few).not.toContain('显示全部素材');
    expect(few).not.toContain('director-assets-grid-footer');
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
    const [workspace, vox, comic] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    // The plan dialog and the running/paused/finished queue controls only open after user interaction.
    for (const label of ['批量生成计划', '仅缺失/失败', '全部重做', '暂停批量生成', '取消未开始项', '重试失败项']) {
      expect(workspace).toContain(label);
    }
    // The batch runner honours its concurrency bound, and its controller pauses and cancels unstarted work.
    const node = (id: string): DirectorBatchNode => ({ id, capability: 'image', shotId: id, title: id, status: 'pending', estimatedCost: 0, dependencies: [] });
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const controller = createDirectorBatchController();
    const run = runDirectorBatchPlan([node('a'), node('b'), node('c'), node('d')], {
      image: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => releases.push(resolve));
        inFlight -= 1;
      },
    }, { concurrency: 2, controller });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(peak).toBe(2);
    controller.pause();
    expect(controller.isPaused()).toBe(true);
    controller.cancel();
    expect(controller.isCancelled()).toBe(true);
    for (const release of releases.splice(0)) release();
    const summary = await run;
    expect(summary.completed).toBe(2);
    expect(summary.cancelled).toBe(2);
    expect(summary.nodes.filter((item) => item.status === 'cancelled').map((item) => item.id)).toEqual(['c', 'd']);
    expect(peak).toBe(2);
    expect(vox).toContain('enqueueProjectMutation');
    expect(comic).toContain('enqueueProjectMutation');
    expect(workspace).not.toContain('item.progress + 9');
  });
});
