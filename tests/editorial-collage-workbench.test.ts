import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
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
    expect(navigation).toContain("view: 'editorial-collage', label: 'VOX 视频'");
    expect(navigation).toContain("taskType === 'editorial-collage'");
    expect(app).toContain("setRequestedEditorialCollageTaskId(targetView === 'editorial-collage' ? taskId : '')");
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
    expect(page).toContain('api.saveEditorialCollage');
    expect(page).toContain('api.generateImageLab');
    expect(page).toContain('api.saveConfig');
    expect(page).toContain('enableImageProfile');
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
    expect(page).toContain('onGenerateShot={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateShot(shotId))}');
    expect(page).toContain('onNewProject={startCreate}');
    expect(page).toContain('projectLeave.requestLeave(() => openProject(id))');
    expect(page).toContain('onRatioChange={updateRatio}');
    expect(page).toContain("projectAction.feedback?.tone === 'error'");
    expect(page).toContain("providerAction.feedback?.tone === 'error'");
    expect(page).toContain('onRestoreVersion={restoreVersion}');
    expect(page).toContain('onAddShot={addShot}');
    expect(page).toContain('onRemoveShot={removeShot}');
    expect(page).toContain('onMoveShot={moveShot}');
    expect(page).toContain('onSplitShot={splitShot}');
    expect(page).toContain('onMergeShot={mergeShot}');
    expect(page).not.toContain('onGenerateShot={() => undefined}');
    expect(page).toContain('onSave={() => void saveProject()}');
    expect(workspace).toContain('label="保存版本"');
    expect(workspace).toContain('生成当前镜头');
    expect(workspace).toContain('retryGeneration');
    expect(workspace).toContain('generateVoice');
    expect(workspace).toContain('renderProject');
    expect(workspace).toContain('openOutput');
    expect(workspace).toContain('disabled={!outputUrl || outputBusy}');
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
