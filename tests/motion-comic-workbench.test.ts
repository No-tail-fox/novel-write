import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('motion comic workbench', () => {
  it('owns an independent route and history handoff', async () => {
    const [types, registry, routes, navigation, app] = await Promise.all([
      source('src/shared/types.ts'), source('src/app/route-registry.ts'), source('src/app/AppRoutes.tsx'),
      source('src/app/navigation.ts'), source('src/app/App.tsx'),
    ]);
    expect(types).toContain("'motion-comic'");
    expect(registry).toContain("'motion-comic': loadMotionComicPage");
    expect(routes).toContain("activeView === 'motion-comic'");
    expect(navigation).toContain("view: 'motion-comic', label: 'AI 漫剧'");
    expect(navigation).toContain("taskType === 'motion-comic'");
    expect(app).toContain("setRequestedMotionComicTaskId(targetView === 'motion-comic' ? taskId : '')");
  });

  it('uses the shared Director Desk for shot production while preserving AI 漫剧 create/save ownership', async () => {
    const [page, workspace, start, css, shellCss] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/features/director-desk/DirectorProjectStart.tsx'),
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
    expect(page).toContain('api.saveConfig');
    expect(page).toContain('enableImageProfile');
    expect(page).toContain('resolveDirectorImageProviderOptions');
    expect(page).toContain('applyMotionComicImageRecord');
    expect(page).toContain('applyMotionComicVoiceRecord');
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
    expect(page).toContain('onAddEpisode={addEpisode}');
    expect(page).toContain('onAddScene={addScene}');
    expect(page).toContain('onAddShot={addShot}');
    expect(page).toContain('onSelectEpisode={selectEpisode}');
    expect(page).toContain('onToggleAsset={toggleConsistencyAsset}');
    expect(page).toContain('onRatioChange={updateRatio}');
    expect(page).toContain("projectAction.feedback?.tone === 'error'");
    expect(page).toContain("providerAction.feedback?.tone === 'error'");
    expect(page).toContain('系列圣经');
    expect(page).toContain('角色一致性');
    expect(page).not.toContain('onGenerateShot={() => undefined}');
    expect(page).toContain('onSave={() => void saveProject()}');
    expect(workspace).toContain('label="保存版本"');
    expect(workspace).toContain('生成当前镜头');
    expect(workspace).toContain('director-shot-list');
    expect(workspace).toContain('director-preview-title');
    expect(workspace).toContain('director-preview-copy');
    expect(workspace).toContain('label="播放进度"');
    expect(workspace).toContain('onProviderProfileChange');
    expect(workspace).toContain('director-asset-grid');
    expect(workspace).toContain('director-queue-panel');
    expect(css).toContain('.director-copy-assist');
    expect(workspace).toContain('generateVoice');
    expect(workspace).toContain('renderProject');
    expect(workspace).toContain('openOutput');
    expect(workspace).toContain('disabled={!outputUrl || outputBusy}');
    expect(css).toContain('grid-template-columns: 274px minmax(0, 1fr) clamp(396px, calc(100vw - 1044px), 492px)');
    expect(css).toContain('.director-episode-row .sd-button__content');
    expect(css).toContain('flex: 0 0 auto');
    expect(workspace).toContain('director-status-footer');
    expect(workspace).toContain('director-project-menu');
    expect(workspace).toContain('director-shot-search');
    expect(workspace).toContain('director-asset-search');
    expect(workspace).toContain('director-version-list');
    expect(workspace).toContain("role={statusError ? 'alert' : undefined}");
    expect(workspace).not.toContain('onChange={() => undefined}');
    expect(workspace).not.toContain('item.progress + 9');
    expect(css).toContain('grid-template-rows: 56px minmax(0, 1fr) 38px');
    expect(css).not.toContain('min-width: 1000px');
    expect(shellCss).toContain(":not(:has(.director-desk)) .content:has(.page-head .local-note)");
  });

  it('provides a complete reference-version workflow and blocks unsafe consistency generation', async () => {
    const [page, consistency, css] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/motion-comic/motion-comic-consistency.ts'),
      source('src/styles/features/director-desk.css'),
    ]);
    expect(page).toContain('MotionComicReferenceEditor');
    for (const label of ['导入参考图', '导入新版本', '固定此版本', '取消固定', '缺少参考图', '文件不可用']) expect(page).toContain(label);
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
