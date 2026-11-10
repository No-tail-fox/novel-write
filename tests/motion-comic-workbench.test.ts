import { readFile } from 'node:fs/promises';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import { productionNavItems, taskWorkspaceView } from '../src/app/navigation';
import { routeLoaders } from '../src/app/route-registry';
import { DirectorCopyAssist } from '../src/features/director-desk/DirectorProjectStart';
import { MotionComicPage } from '../src/features/motion-comic/MotionComicPage';
import { MotionComicReferenceEditor } from '../src/features/motion-comic/MotionComicReferenceEditor';
import type { ProductionAssetVersion } from '../src/shared/production-workflow';
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
    mode: 'motion-comic', projectTitle: '雨夜来信', projectMeta: '', episodeTitle: '第 1 集', stageLabel: '镜头生成',
    selectedShotId: 'shot', dirty: false, providerConnected: true,
    shots: [{ id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' }],
    onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
    ...props,
  }));
}

function openOutputButtons(markup: string): string[] {
  return markup.match(/<button[^>]*aria-label="打开导出目录"[^>]*>/g) ?? [];
}

describe('motion comic workbench', () => {
  it('owns an independent route and history handoff', async () => {
    const [routes, app] = await Promise.all([source('src/app/AppRoutes.tsx'), source('src/app/App.tsx')]);
    expect(SHELL_VIEWS).toContain('motion-comic');
    expect((await routeLoaders['motion-comic']()).default).toBe(MotionComicPage);
    expect(routes).toContain("activeView === 'motion-comic'");
    expect(productionNavItems.find((item) => item.view === 'motion-comic')?.label).toBe('AI 漫剧');
    // History rows of motion-comic tasks open the AI 漫剧 workspace regardless of the production route hint.
    expect(taskWorkspaceView('motion-comic')).toBe('motion-comic');
    expect(taskWorkspaceView('motion-comic', 'template')).toBe('motion-comic');
    expect(app).toContain("setRequestedMotionComicTaskId(targetView === 'motion-comic' ? taskId : '')");
  });

  it('uses the shared Director Desk for shot production while preserving AI 漫剧 create/save ownership', async () => {
    const [page, workspace, css, shellCss] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
      source('src/styles/shell.css'),
    ]);
    for (const component of ['Button', 'IconButton', 'Pane', 'SelectField', 'SliderField', 'Tabs', 'TextAreaField', 'TextField', 'Toolbar']) expect(workspace).toContain(component);
    for (const rawControl of ['<button', '<input', '<select', '<textarea']) {
      expect(page).not.toContain(rawControl);
      expect(workspace).not.toContain(rawControl);
    }
    expect(page).toContain('data-motion-comic-workbench="true"');
    expect(page).toContain('<DirectorDeskWorkspace');
    expect(page).toContain('mode="motion-comic"');
    expect(page).toContain('api.createMotionComic');
    expect(page).toContain('api.saveMotionComic');
    expect(page).toContain('api.generateImageLab');
    expect(page).toContain('async function importReference');
    expect(page).toContain('api.selectLocalImage()');
    expect(page).toContain('api.addImageLabRecord({');
    expect(page).toContain('<ProjectModelBar');
    expect(page).toContain('useProjectModelConfig');
    expect(page).not.toContain('api.saveConfig');
    expect(page).toContain('resolveDirectorImageProviderOptions');
    expect(page).toContain('applyMotionComicImageRecord');
    expect(page).toContain('applyMotionComicVoiceRecord');
    expect(page).toContain('api.generateVoiceLabPreview');
    expect(page).toContain('api.renderDirectorProject');
    expect(page).toContain('api.composeResearchCopy');
    expect(page).toContain('buildDirectorCopyAssistRequest');
    expect(page).toContain('<DirectorCopyAssist');
    const assist = markupButtons(renderToStaticMarkup(createElement(DirectorCopyAssist, { activeIntent: 'revise', canCreate: true, canRevise: true, onCreate: () => {}, onRevise: () => {} })));
    expect(assist.map(markupText)).toEqual(['AI 创作', '修改中']);
    expect(assist.every((button) => /\sdisabled=""/u.test(openingTag(button)))).toBe(true);
    expect(page).toContain('api.openTaskOutputDirectory');
    expect(page).toContain('onGenerateShot={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateShot(shotId))}');
    expect(page).toContain('onNewProject={startCreate}');
    expect(page).toContain('onAddEpisode={addEpisode}');
    expect(page).toContain('onAddScene={addScene}');
    expect(page).toContain('onAddShot={addShot}');
    expect(page).toContain('onSelectEpisode={selectEpisode}');
    expect(page).toContain('onToggleAsset={toggleConsistencyAsset}');
    expect(page).toContain('onRatioChange={updateRatio}');
    expect(page).toContain("projectAction.feedback?.tone === 'error'");
    expect(page).toContain("providerAction.feedback?.tone === 'error'");
    expect(page).toContain('系列圣经');
    expect(page).toContain('个角色造型');
    expect(page).not.toContain('onGenerateShot={() => undefined}');
    expect(page).toContain('onSave={() => void saveProject()}');
    // Render the AI 漫剧 desk: labelled save, per-shot generation, shot list, preview copy and scrubber,
    // project-scoped provider switcher, asset grid and generation queue.
    const desk = directorDeskMarkup({ dirty: true, onProviderProfileChange: () => {}, projects: [{ id: 'p1', title: '雨夜来信', meta: '第 1 集' }], onSelectProject: () => {} });
    const saveHeader = markupButtons(desk).find((button) => openingTag(button).includes('aria-label="保存版本"'));
    expect(saveHeader).toBeDefined();
    expect(/\sdisabled=""/u.test(openingTag(saveHeader ?? ''))).toBe(false);
    expect(markupButtons(desk).some((button) => markupText(button) === '生成当前镜头')).toBe(true);
    expect(desk).toContain('class="director-shot-list');
    expect(workspace).toContain('director-preview-title');
    expect(desk).toContain('class="director-preview-copy');
    expect(fieldControl(desk, '播放进度')).toBeDefined();
    expect(fieldControl(desk, '图片生成服务')).toBeDefined();
    expect(fieldControl(directorDeskMarkup({}), '图片生成服务')).toBeUndefined();
    expect(desk).toContain('class="director-asset-grid');
    expect(desk).toMatch(/<section class="director-queue-panel" aria-label="生成队列">/u);
    expect(css).toContain('.director-copy-assist');
    // Voice generation lives in the 声音与字幕 inspector tab (client-side tab switch, not SSR-reachable).
    expect(workspace).toContain('generateVoice');
    const renderAction = (markup: string) => markupButtons(markup).find((button) => markupText(button) === '生成成片') ?? '';
    expect(/\sdisabled=""/u.test(openingTag(renderAction(directorDeskMarkup({ onRender: async () => {} }))))).toBe(false);
    expect(/\sdisabled=""/u.test(openingTag(renderAction(directorDeskMarkup({ onRender: async () => {}, rendering: true }))))).toBe(true);
    // The open-output control stays disabled until a rendered output exists
    // (either a playable URL or a persisted output flagged by the page).
    const onOpenOutput = async () => {};
    const [withoutOutput] = openOutputButtons(directorDeskMarkup({ onOpenOutput }));
    const [withOutputUrl] = openOutputButtons(directorDeskMarkup({ onOpenOutput, outputUrl: 'file:///I:/output/final.mp4' }));
    const [withPersistedOutput] = openOutputButtons(directorDeskMarkup({ onOpenOutput, outputAvailable: true }));
    expect(withoutOutput).toContain('disabled=""');
    expect(withOutputUrl).toBeDefined();
    expect(withOutputUrl).not.toContain('disabled');
    expect(withPersistedOutput).toBeDefined();
    expect(withPersistedOutput).not.toContain('disabled');
    // While an open request is in flight the same control is locked (state is not reachable via SSR).
    expect(workspace).toContain('disabled={!hasOutput || outputBusy}');
    expect(css).toContain('grid-template-columns: 274px minmax(0, 1fr) clamp(396px, calc(100vw - 1044px), 492px)');
    expect(css).toContain('.director-episode-row .sd-button__content');
    expect(css).toContain('flex: 0 0 auto');
    expect(elementWithClass(desk, 'director-status-footer', 'footer')).toBeDefined();
    expect(markupButtons(desk).some((button) => openingTag(button).includes('director-project-menu') && button.includes('雨夜来信'))).toBe(true);
    expect(fieldControl(desk, '搜索镜头')).toBeDefined();
    expect(fieldControl(desk, '搜索素材')).toBeDefined();
    // The version list belongs to the 版本 inspector tab (client-side tab switch).
    expect(workspace).toContain('director-version-list');
    // Errors reported by the page are announced as an alert in the header; normal status is not.
    const headerMessage = (markup: string) => markup.match(/<span class="director-header-message"[^>]*>/u)?.[0] ?? '';
    expect(headerMessage(directorDeskMarkup({ errorMessage: '保存失败：磁盘已满' }))).toContain('role="alert"');
    expect(directorDeskMarkup({ errorMessage: '保存失败：磁盘已满' })).toContain('>保存失败：磁盘已满</span>');
    expect(headerMessage(directorDeskMarkup({}))).not.toContain('role=');
    expect(workspace).not.toContain('onChange={() => undefined}');
    expect(workspace).not.toContain('item.progress + 9');
    expect(css).toContain('grid-template-rows: 56px minmax(0, 1fr) 38px');
    expect(css).not.toContain('min-width: 1000px');
    expect(shellCss).toContain(":not(:has(.director-desk)) .content:has(.page-head .local-note)");
  });

  it('provides a complete reference-version workflow and blocks unsafe consistency generation', async () => {
    const [page, reference, consistency, css] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/motion-comic/MotionComicReferenceEditor.tsx'),
      source('src/features/motion-comic/motion-comic-consistency.ts'),
      source('src/styles/features/director-desk.css'),
    ]);
    expect(page).toContain('MotionComicReferenceEditor');
    for (const label of ['导入参考图', '导入新版本']) expect(page).toContain(label);
    // Render the reference editor in its missing / unfixed / fixed states.
    const version = (id: string, localPath?: string): ProductionAssetVersion => ({ id, assetId: 'hero', kind: 'image', localPath, createdAt: '2026-10-20T08:00:00.000Z' });
    const referenceMarkup = (versions: ProductionAssetVersion[], fixedVersionId?: string) => renderToStaticMarkup(createElement(MotionComicReferenceEditor, {
      label: '林雨', versions, fixedVersionId, busy: false, active: true, feedback: null,
      importControl: createElement('span', null, '导入参考图'), onSetFixed: () => {}, onImageStatus: () => {},
    }));
    const missing = referenceMarkup([]);
    expect(missing).toContain('data-motion-comic-reference="missing"');
    expect(markupText(missing)).toContain('缺少参考图');
    // An unfixed version can only be fixed after its file has been verified readable; a version without a file reports it.
    const unfixed = referenceMarkup([version('v1', 'I:/refs/v1.png'), version('v2')]);
    expect(unfixed).toContain('data-motion-comic-reference="unfixed"');
    const fixButton = markupButtons(unfixed).find((button) => markupText(button) === '固定此版本');
    expect(fixButton).toBeDefined();
    expect(/\sdisabled=""/u.test(openingTag(fixButton ?? ''))).toBe(true);
    expect(markupText(unfixed)).toContain('文件不可用');
    // The fixed version offers an explicit un-fix action instead of the fix action.
    const fixed = referenceMarkup([version('v1', 'I:/refs/v1.png'), version('v2', 'I:/refs/v2.png')], 'v1');
    expect(fixed).toContain('data-motion-comic-reference="fixed"');
    expect(markupButtons(fixed).some((button) => openingTag(button).includes('aria-label="取消固定参考版本"'))).toBe(true);
    expect(markupButtons(fixed).some((button) => markupText(button) === '固定此版本')).toBe(false);
    // Click handlers cannot be fired through server markup.
    expect(reference).toContain('onSetFixed(preview.id)');
    expect(reference).toContain('onSetFixed(null)');
    expect(page).toContain('imageLabRecordIdFromMutation(imported)');
    expect(page).toContain('setDirty(true)');
    expect(page).toContain('motionComicReferenceVersionIds(document)');
    expect(page).toContain("asset.assetId.startsWith('shot-keyframe-')");
    expect(page).toContain('if (!providerStatus.supportsReferenceImages)');
    expect(page).toContain('inspectMotionComicShotConsistency(current, sourceShot)');
    expect(page).toContain("smartMode: 'reference-edit'");
    expect(page).toContain('await api.readAssetDataUrl(path)');
    expect(page).not.toContain("smartMode: referenceImagePaths.length ? 'reference-edit' : 'video-narration'");
    expect(consistency).toContain('REFERENCE IMAGE ORDER:');
    expect(consistency).toContain('selected === true && asset.pinned === true');
    expect(css).toContain('.motion-comic-reference-versions');
    expect(css).toContain('.motion-comic-readiness');
  });
});
