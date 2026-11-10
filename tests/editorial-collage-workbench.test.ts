import { readFile } from 'node:fs/promises';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { productionNavItems, taskWorkspaceView } from '../src/app/navigation';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, EDITORIAL_STARTER_DURATIONS_MS } from '../src/shared/editorial-collage';
import { planEditorialScript } from '../src/shared/editorial-script';

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
    const [types, registry, routes, navigation, app] = await Promise.all([
      source('src/shared/types.ts'),
      source('src/app/route-registry.ts'),
      source('src/app/AppRoutes.tsx'),
      source('src/app/navigation.ts'),
      source('src/app/App.tsx'),
    ]);
    expect(types).toContain("'editorial-collage'");
    expect(registry).toContain("'editorial-collage': loadEditorialCollagePage");
    expect(routes).toContain("activeView === 'editorial-collage'");
    // The VOX workspace is exposed in the production navigation as 创意动画 (renamed from “VOX 视频”).
    expect(productionNavItems.find((item) => item.view === 'editorial-collage')?.label).toBe('创意动画');
    expect(taskWorkspaceView('editorial-collage')).toBe('editorial-collage');
    expect(navigation).toContain("taskType === 'editorial-collage'");
    expect(taskWorkspaceView('editorial-collage', 'template')).toBe('template-animation');
    // History hand-off opens the requested project in the VOX page for both production routes.
    expect(app).toContain("setRequestedEditorialCollageTaskId(targetView === 'editorial-collage' || targetView === 'template-animation' ? taskId : '')");
  });

  it('uses the shared Director Desk with real media, shot controls, generation queue, and persisted VOX edits', async () => {
    const [page, workspace, start, css, shellCss] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/features/director-desk/DirectorProjectStart.tsx'),
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
    expect(start).toContain('AI 创作');
    expect(start).toContain('AI 修改');
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
    expect(workspace).toContain('label="保存版本"');
    expect(workspace).toContain('生成当前镜头');
    expect(workspace).toContain('retryGeneration');
    expect(workspace).toContain('generateVoice');
    expect(workspace).toContain('renderProject');
    expect(workspace).toContain('openOutput');
    // Without a rendered output the shared desk offers no enabled “打开导出目录” action;
    // once the page reports an output, it becomes reachable.
    const onOpenOutput = async () => {};
    expect(enabledOpenOutputButtons(directorDeskMarkup({ onOpenOutput }))).toHaveLength(0);
    expect(enabledOpenOutputButtons(directorDeskMarkup({ mode: 'motion-comic', onOpenOutput }))).toHaveLength(0);
    expect(enabledOpenOutputButtons(directorDeskMarkup({ mode: 'motion-comic', onOpenOutput, outputUrl: 'file:///I:/output/final.mp4' }))).toHaveLength(1);
    expect(workspace).toContain('disabled={!hasOutput || outputBusy}');
    expect(workspace).toContain('director-media-preview');
    expect(workspace).toContain('director-preview-title');
    expect(workspace).toContain('data-preview-ratio={ratio}');
    expect(workspace).toContain('selectedShot.title');
    expect(workspace).toContain('director-preview-copy');
    expect(workspace).toContain('label="播放进度"');
    expect(workspace).toContain('onProviderProfileChange');
    expect(workspace).toContain('director-filmstrip');
    expect(workspace).toContain('director-asset-grid');
    expect(workspace).toContain('director-queue-panel');
    expect(workspace).toContain('director-project-menu');
    expect(workspace).toContain('director-shot-search');
    expect(workspace).toContain('director-asset-search');
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
    expect(workspace).toContain('director-status-footer');
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
});
