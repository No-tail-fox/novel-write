import { readFile } from 'node:fs/promises';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { productionNavItems, taskWorkspaceView } from '../src/app/navigation';
import { routeLoaders } from '../src/app/route-registry';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import { DirectorCopyAssist } from '../src/features/director-desk/DirectorProjectStart';
import { EditorialCollagePage } from '../src/features/editorial-collage/EditorialCollagePage';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, EDITORIAL_STARTER_DURATIONS_MS } from '../src/shared/editorial-collage';
import { planEditorialScript } from '../src/shared/editorial-script';
import { SHELL_VIEWS } from '../src/shared/types';
import { elementWithClass, fieldControl, markupButtons, markupText, openingTag } from './helpers/ssr-markup';

// Server markup cannot mount a Fluent portal; render the inspector drawer inline
// so the shot action footer is inspectable.
vi.mock('../src/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/ui')>(),
  Drawer: ({ children }: { children: ReactNode }) => createElement('aside', { 'data-ssr-inspector': true }, children),
}));

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function directorDeskMarkup(props: Partial<ComponentProps<typeof DirectorDeskWorkspace>>): string {
  return renderToStaticMarkup(createElement(DirectorDeskWorkspace, {
    mode: 'vox', projectTitle: '拉萨旧城的回声', projectMeta: '', episodeTitle: '', stageLabel: '镜头生成',
    selectedShotId: 'shot', dirty: false, providerConnected: true,
    shots: [{ id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' }],
    onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
    ...props,
  }));
}

function enabledOpenOutputButtons(markup: string): string[] {
  return (markup.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g) ?? [])
    .filter((button) => button.includes('打开导出目录') && !/\sdisabled=""/.test(button.slice(0, button.indexOf('>') + 1)));
}

describe('editorial collage workbench', () => {
  it('owns a dedicated route and routes task history back into the VOX workspace', async () => {
    const [routes, app] = await Promise.all([
      source('src/app/AppRoutes.tsx'),
      source('src/app/App.tsx'),
    ]);
    expect(SHELL_VIEWS).toContain('editorial-collage');
    // The route lazily loads the VOX page itself (shared with 模板动画).
    expect((await routeLoaders['editorial-collage']()).default).toBe(EditorialCollagePage);
    expect((await routeLoaders['template-animation']()).default).toBe(EditorialCollagePage);
    expect(routes).toContain("activeView === 'editorial-collage'");
    // The VOX workspace is exposed in the production navigation as 创意动画 (renamed from “VOX 视频”).
    expect(productionNavItems.find((item) => item.view === 'editorial-collage')?.label).toBe('创意动画');
    // History rows of editorial-collage tasks open the VOX workspace (or 模板动画 for template-routed projects).
    expect(taskWorkspaceView('editorial-collage')).toBe('editorial-collage');
    expect(taskWorkspaceView('editorial-collage', 'lemo')).toBe('editorial-collage');
    expect(taskWorkspaceView('editorial-collage', 'template')).toBe('template-animation');
    expect(taskWorkspaceView('story')).toBe('task-detail');
    // History hand-off opens the requested project in the VOX page for both production routes.
    expect(app).toContain("setRequestedEditorialCollageTaskId(targetView === 'editorial-collage' || targetView === 'template-animation' ? taskId : '')");
  });

  it('uses the shared Director Desk with real media, shot controls, generation queue, and persisted VOX edits', async () => {
    const [page, workspace, css, shellCss] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
      source('src/styles/shell.css'),
    ]);
    for (const component of ['Button', 'CheckboxField', 'IconButton', 'Pane', 'SelectField', 'SliderField', 'Tabs', 'TextAreaField', 'TextField', 'Toolbar']) {
      expect(workspace).toContain(component);
    }
    for (const rawControl of ['<button', '<input', '<select', '<textarea']) {
      expect(page).not.toContain(rawControl);
      expect(workspace).not.toContain(rawControl);
    }
    expect(page).toContain('data-editorial-collage-workbench="true"');
    expect(page).toContain('<DirectorDeskWorkspace');
    expect(page).toContain('mode="vox"');
    expect(page).toContain('api.createEditorialCollage');
    // Structure is no longer a fixed concise/standard/extended preset table: the chosen starter
    // duration (or “按全文分配时长”) is planned against the actual script, previewed, and persisted.
    expect(page).toContain('EDITORIAL_STARTER_DURATIONS_MS.map(');
    expect(page).toContain("{ value: 'auto', label: '按全文分配时长' }");
    expect(page).toContain('planEditorialScript(createSource, createDurationMs)');
    expect(page).toContain("{ label: '结构', value: createStructure }");
    expect(page).toContain('<strong>{createStructure}</strong>');
    expect(page).toMatch(/api\.createEditorialCollage\(\{[^}]*sourceText: createSource[^}]*durationMs: createDurationMs/);
    expect(page).not.toContain('<strong>30 秒解释结构</strong>');
    const structureSource = '开场先抛出问题。背景交代来龙去脉。证据给出关键事实。结论回应开场。';
    const structureDraft = createEditorialCollageDraft({ id: 'structure', title: '结构', now: '2026-08-17T00:00:00.000Z' });
    expect([...EDITORIAL_STARTER_DURATIONS_MS]).toEqual([15_000, 30_000, 60_000]);
    for (const durationMs of EDITORIAL_STARTER_DURATIONS_MS) {
      const plan = planEditorialScript(structureSource, durationMs);
      const starter = createEditorialCollageStarterPlan(structureDraft, structureSource, '2026-08-17T00:00:00.000Z', durationMs);
      expect(plan.durationMs).toBe(durationMs);
      expect(starter.beats).toHaveLength(plan.beats.length);
      expect(starter.beats.reduce((total, beat) => total + beat.durationMs, 0)).toBe(durationMs);
    }
    const fullText = planEditorialScript(structureSource, 'auto');
    expect(fullText.durationMs).toBe(fullText.minimumDurationMs);
    expect(page).toContain('api.saveEditorialCollage');
    expect(page).toContain('api.generateImageLab');
    // Image provider selection is project-scoped (shared project model bar), not a global config write.
    expect(page).toContain('<ProjectModelBar');
    expect(page).toContain('useProjectModelConfig(state.config, selectedProjectModels)');
    expect(page).not.toContain('api.saveConfig');
    expect(page).toContain('resolveDirectorImageProviderOptions');
    expect(page).toContain('applyEditorialImageRecord');
    expect(page).toContain('applyEditorialVoiceRecord');
    expect(page).toContain('api.generateVoiceLabPreview');
    expect(page).toContain('api.renderDirectorProject');
    expect(page).toContain('api.composeResearchCopy');
    expect(page).toContain('buildDirectorCopyAssistRequest');
    expect(page).toContain('<DirectorCopyAssist');
    // The copy-assist toolbar offers both AI actions, disabled while a request runs or nothing can be acted on.
    const assistButtons = (props: Partial<ComponentProps<typeof DirectorCopyAssist>>) => markupButtons(renderToStaticMarkup(createElement(DirectorCopyAssist, {
      activeIntent: null, canCreate: true, canRevise: true, onCreate: () => {}, onRevise: () => {}, ...props,
    })));
    expect(assistButtons({}).map(markupText)).toEqual(['AI 创作', 'AI 修改']);
    expect(assistButtons({}).every((button) => !/\sdisabled=""/u.test(openingTag(button)))).toBe(true);
    expect(assistButtons({ activeIntent: 'create' }).map(markupText)).toEqual(['创作中', 'AI 修改']);
    expect(assistButtons({ activeIntent: 'create' }).every((button) => /\sdisabled=""/u.test(openingTag(button)))).toBe(true);
    expect(assistButtons({ canRevise: false }).map((button) => /\sdisabled=""/u.test(openingTag(button)))).toEqual([false, true]);
    expect(page).toContain('api.openTaskOutputDirectory');
    // Shot generation is still gated on history capacity, now sized by the shot's real image count.
    expect(page).toContain('const count = shot ? editorialImageGenerationCount(shot, documentRef.current ?? undefined) : 1;');
    expect(page).toContain('return withHistoryCapacity({ assets: count, providerJobs: count }, () => generateShot(shotId));');
    expect(page).toContain('onNewProject={startCreate}');
    // Switching projects still goes through the unsaved-changes guard (and may hand off to the template route).
    expect(page).toContain('projectLeave.requestLeave(async () => { const redirect = await openProject(id); if (redirect) handOffProject(redirect, id); })');
    expect(page).toContain('onRatioChange={updateRatio}');
    // Shot and beat structure edits are both wired (hidden only for music-video projects).
    for (const [prop, handler] of [
      ['onAddShot', 'addShot'], ['onRemoveShot', 'removeShot'], ['onMoveShot', 'moveShot'],
      ['onAddBeat', 'addBeat'], ['onRemoveBeat', 'removeBeat'], ['onMoveBeat', 'moveBeat'],
      ['onSplitShot', 'splitShot'], ['onMergeShot', 'mergeShot'],
    ] as const) {
      expect(page).toContain(`${prop}={isMusicVideo ? undefined : ${handler}}`);
    }
    for (const operation of ['insertEditorialBeat(', 'reorderEditorialBeat(', 'removeEditorialBeat(', 'insertEditorialShot(', 'removeEditorialShot(', 'moveEditorialShot(', 'splitEditorialShot(', 'mergeEditorialShots(']) {
      expect(page).toContain(operation);
    }
    expect(page).toContain("projectAction.feedback?.tone === 'error'");
    expect(page).toContain("providerAction.feedback?.tone === 'error'");
    expect(page).toContain('onRestoreVersion={restoreVersion}');
    expect(page).not.toContain('onGenerateShot={() => undefined}');
    expect(page).toContain('onSave={() => void saveProject()}');
    // Save is a labelled header action that is only enabled while there are unsaved edits.
    const saveButton = (markup: string) => markupButtons(markup).find((button) => openingTag(button).includes('aria-label="保存版本"')) ?? '';
    expect(/\sdisabled=""/u.test(openingTag(saveButton(directorDeskMarkup({}))))).toBe(true);
    expect(/\sdisabled=""/u.test(openingTag(saveButton(directorDeskMarkup({ dirty: true }))))).toBe(false);
    const comic = directorDeskMarkup({ mode: 'motion-comic', projects: [{ id: 'p1', title: '拉萨旧城的回声', meta: '3 镜头' }], onSelectProject: () => {} });
    expect(markupButtons(comic).some((button) => markupText(button) === '生成当前镜头')).toBe(true);
    // A failed provider job surfaces its error with a retry action; the render action is reachable when wired.
    const failedJob = directorDeskMarkup({ mode: 'motion-comic', jobs: [{ id: 'job-1', shotId: 'shot', kind: 'shot-image', title: '镜头 1', status: 'failed', progress: 0, cost: 0, provider: 'GPT Image', error: '接口超时' }] });
    const failedItem = elementWithClass(failedJob, 'director-queue-item', 'div') ?? '';
    expect(failedItem).toContain('is-failed');
    expect(markupText(failedJob)).toContain('接口超时');
    expect(markupButtons(failedJob).some((button) => markupText(button) === '重试')).toBe(true);
    expect(markupButtons(directorDeskMarkup({ mode: 'motion-comic' })).some((button) => markupText(button) === '重试')).toBe(false);
    // The voice generator itself lives in the 声音与字幕 inspector tab, which needs a client-side tab switch.
    expect(workspace).toContain('generateVoice');
    const renderAction = (markup: string) => markupButtons(markup).find((button) => markupText(button) === '生成成片') ?? '';
    expect(/\sdisabled=""/u.test(openingTag(renderAction(directorDeskMarkup({ mode: 'motion-comic', onRender: async () => {} }))))).toBe(false);
    expect(/\sdisabled=""/u.test(openingTag(renderAction(directorDeskMarkup({ mode: 'motion-comic', onRender: async () => {}, rendering: true }))))).toBe(true);
    // Without a rendered output the shared desk offers no enabled “打开导出目录” action;
    // once the page reports an output, it becomes reachable.
    const onOpenOutput = async () => {};
    expect(enabledOpenOutputButtons(directorDeskMarkup({ onOpenOutput }))).toHaveLength(0);
    expect(enabledOpenOutputButtons(directorDeskMarkup({ mode: 'motion-comic', onOpenOutput }))).toHaveLength(0);
    expect(enabledOpenOutputButtons(directorDeskMarkup({ mode: 'motion-comic', onOpenOutput, outputUrl: 'file:///I:/output/final.mp4' }))).toHaveLength(1);
    // The VOX preview shows the selected shot's title over a ratio-aware frame with copy and a scrubber.
    const voxPreview = directorDeskMarkup({ ratio: '9:16', shots: [{ id: 'shot', index: 1, title: '布达拉宫的清晨', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' }] });
    expect(voxPreview).toMatch(/class="director-media-preview[^"]*"[^>]*data-preview-ratio="9:16"|data-preview-ratio="9:16"[^>]*class="director-media-preview/u);
    expect(voxPreview).toContain('<div class="director-preview-title">布达拉宫的清晨</div>');
    expect(voxPreview).toContain('class="director-preview-copy');
    expect(fieldControl(voxPreview, '播放进度')).toBeDefined();
    // Image provider switching is offered only when the page wires a handler.
    expect(fieldControl(directorDeskMarkup({ mode: 'motion-comic', onProviderProfileChange: () => {} }), '图片生成服务')).toBeDefined();
    expect(fieldControl(directorDeskMarkup({ mode: 'motion-comic' }), '图片生成服务')).toBeUndefined();
    // Comic uses the editable multitrack timeline; VOX's process outline shows current shot content.
    expect(comic).toContain('class="director-multitrack" aria-label="多轨时间线"');
    expect(comic).not.toContain('class="director-filmstrip"');
    expect(voxPreview).toContain('class="vox-shot-content" aria-label="当前镜头内容"');
    expect(fieldControl(voxPreview, '画面描述')).toBeDefined();
    expect(comic).toContain('class="director-asset-grid');
    expect(comic).toMatch(/<section class="director-queue-panel" aria-label="生成队列">/u);
    expect(markupButtons(comic).some((button) => openingTag(button).includes('director-project-menu') && button.includes('拉萨旧城的回声'))).toBe(true);
    expect(fieldControl(comic, '搜索镜头')).toBeDefined();
    expect(fieldControl(comic, '搜索素材')).toBeDefined();
    expect(fieldControl(voxPreview, '搜索素材')).toBeDefined();
    // The version list is part of the 版本 inspector tab (client-side tab switch).
    expect(workspace).toContain('director-version-list');
    // Structure controls render as labelled shot/beat toolbars when the page supplies handlers,
    // and disappear when it does not (music-video projects).
    const noop = () => {};
    const structureMarkup = directorDeskMarkup({
      shots: [
        { id: 'shot', index: 1, title: '镜头一', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' },
        { id: 'shot-2', index: 2, title: '镜头二', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' },
      ],
      onAddShot: noop, onRemoveShot: noop, onMoveShot: noop, onSplitShot: noop, onMergeShot: noop,
      onAddBeat: noop, onRemoveBeat: noop, onMoveBeat: noop,
    });
    for (const label of ['镜头结构操作', '节拍结构操作', '删除当前镜头', '上移当前镜头', '下移当前镜头']) {
      expect(structureMarkup).toContain(`aria-label="${label}"`);
    }
    for (const text of ['新增镜头', '拆分', '合并', '新增节拍', '上移节拍', '下移节拍', '删除节拍']) expect(structureMarkup).toContain(text);
    const withoutStructureHandlers = directorDeskMarkup({});
    for (const control of ['aria-label="删除当前镜头"', 'aria-label="上移当前镜头"', '新增镜头', '新增节拍', '删除节拍']) {
      expect(withoutStructureHandlers).not.toContain(control);
    }
    // Removing a shot still requires an explicit confirmation dialog.
    expect(workspace).toContain('title="删除当前镜头"');
    expect(workspace).toContain('onRemoveShot?.(removingShot.id); setRemovingShotId(\'\'); }}>删除镜头</Button>');
    expect(workspace).not.toContain('onChange={() => undefined}');
    expect(workspace).not.toContain('item.progress + 9');
    expect(css).toContain('grid-template-columns: 274px minmax(0, 1fr) clamp(396px, calc(100vw - 1044px), 492px)');
    expect(elementWithClass(withoutStructureHandlers, 'director-status-footer', 'footer')).toBeDefined();
    expect(css).toContain('grid-template-rows: 56px minmax(0, 1fr) 38px');
    expect(css).not.toContain('min-width: 1000px');
    expect(css).toContain('.director-media-preview');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('font-size: var(--director-title-size)');
    expect(css).toContain('bottom: 6%; left: 8%');
    expect(css).toContain('.director-preview-copy');
    expect(css).toContain('.director-scrub-field');
    expect(css).toContain('.director-inspector-pane');
    expect(css).toContain('.director-queue-panel');
    expect(css).toContain('.director-copy-assist');
    expect(shellCss).toContain(":not(:has(.director-desk)) .content:has(.page-head .local-note)");
  });

  it('keeps an unknown paid-request warning visible in the action bar without opening the dialog', () => {
    const noop = () => {};
    const base = { running: false, summary: '3/9 步', label: '查看失败与恢复', disabled: false, onAction: noop, onPause: noop, onCancel: noop, onSettings: noop, onDetails: noop };
    const warning = '有请求结果未知，可能已计费，系统不会自动重发。';
    const withAlert = directorDeskMarkup({ production: { ...base, alert: warning } });
    expect(withAlert).toContain('data-production-alert="true"');
    expect(withAlert).toContain(warning);
    expect(withAlert).toMatch(/<span[^>]*role="alert"[^>]*data-production-alert="true"/u);
    const withoutAlert = directorDeskMarkup({ production: base });
    expect(withoutAlert).not.toContain('data-production-alert');
    expect(withoutAlert).not.toContain(warning);
  });

  it('wires the persistent warning to the same unknown-result condition as the recovery button', async () => {
    const page = await source('src/features/editorial-collage/EditorialCollagePage.tsx');
    expect(page).toContain('alert: productionUnknown ?');
    expect(page).toContain('可能已计费');
    expect(page).toContain('不会自动重发');
    expect(page).toContain("label: productionUnknown ? '查看失败与恢复'");
    expect(page).toContain('onAction: () => productionUnknown ? setProductionDetailsOpen(true)');
  });
});
