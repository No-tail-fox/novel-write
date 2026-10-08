import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('motion comic AI planning and remote video UI', () => {
  it('plans the selected imported episode and writes the first result into its placeholder', async () => {
    const [page, panels, dialog, planning, planner, scenesPanel] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/motion-comic/MotionComicWorkflowPanels.tsx'),
      source('src/features/motion-comic/MotionComicPlanDialog.tsx'),
      source('src/shared/motion-comic-planning.ts'),
      source('src/shared/motion-comic-planner.ts'),
      source('src/features/motion-comic/MotionComicScenesPanel.tsx'),
    ]);

    expect(page).toContain('function openPlanDialog(sourceEpisodeId?: string)');
    expect(page).toContain('documentRef.current?.sourceDocument?.episodes.find((episode) => episode.id === sourceEpisodeId)');
    expect(page).toContain('nextUnplannedMotionComicSourceEpisodeId(documentRef.current)');
    expect(page).toContain('if (nextId && sourceEpisode.id !== nextId) return');
    expect(page).toContain('setPlanSourceText(sourceEpisode.sourceText)');
    expect(page).toContain("documentRef.current?.sourceDocument?.adaptationMode === 'novel-adaptation'");
    expect(page).toContain('api.planMotionComic');
    expect(page).toContain('api.applyMotionComicPlan');
    expect(page).toContain('<MotionComicPlanDialog');
    expect(page).toContain("replaceStarterByDefault={Boolean(canReplaceStarter && document.sourceDocument?.episodes.find((episode) => episode.id === planningSourceEpisodeId)?.number === 1)}");
    expect(page).toContain("...(planningSourceEpisodeId ? { sourceEpisodeId: planningSourceEpisodeId } : {})");
    expect(page).toContain('canCreateBlankEpisode={!document.sourceDocument}');
    expect(page).toContain('nextSourceEpisodeId={nextSourceEpisodeId}');
    expect(panels).toContain('episode.planningEvidence?.sourceEpisodeId === selected.id');
    expect(panels).toContain('selected.id === nextSourceEpisodeId');
    expect(panels).toContain('等待前一集完成');
    expect(panels).toContain('完成前一集后自动解锁');
    expect(panels).toContain('onPlanEpisode(selected.id)');
    expect(panels).toContain('生成剧本与分幕预览');
    expect(panels).toContain('选择一集后，在右侧顶部点击「生成剧本与分幕预览」');
    expect(dialog).toContain('生成剧本，进入审核');
    expect(dialog).toContain('确认剧本，生成分镜');
    expect(page).toContain("stage: resume ? 'storyboard' : 'script'");
    expect(page).toContain('onReviewScriptChange={changeReviewedScript}');
    expect(page).toContain('onSourceTextChange={(value) => changePlanInput(setPlanSourceText, value)}');
    expect(page).toContain('onInstructionsChange={(value) => changePlanInput(setPlanInstructions, value)}');
    expect(page).toContain('onTargetDurationSecChange={(value) => changePlanInput(setPlanTargetDurationSec, value)}');
    expect(page).toContain('JSON.stringify(documentRef.current) !== JSON.stringify(current)');
    expect(dialog).toContain('返回修改剧本');
    expect(dialog).toContain('写入已确认的首个分集');
    expect(dialog).toContain('确认并写入第 ${episodeNumber} 集');
    expect(dialog).toContain('不会调用图片或视频服务');
    expect(dialog).toContain('canCreateBlankEpisode && !recovery ? <Button');
    expect(dialog).toContain('result!.summary.coveredSourceUnits');
    expect(dialog).toContain('result!.summary.acts');
    expect(dialog).toContain('selectedScene.actBoundaryReason');
    expect(dialog).toContain('句段已覆盖，镜头顺序与对白时长校验通过');
    expect(dialog).toContain('保存修正并重新校验');
    expect(dialog).toContain('剧本已暂存，但未通过实体校验');
    expect(dialog).toContain('不会重跑整集剧本');
    expect(dialog).toContain('onScriptDraftChange(updateFailedBeat(');
    expect(dialog).not.toContain('setScriptDraft');
    expect(page).toContain('onScriptDraftChange={changePlanScriptDraft}');
    expect(page).toContain('planScriptFailureJson: JSON.stringify(failure)');
    expect(page).toContain('onOpenChange={changePlanOpen}');
    expect(page).toContain('Boolean(currentPlanRecovery || currentPlanScriptFailure)');
    expect(planning).toContain('sourceEpisodeId: key.optional()');
    expect(planning).toContain('MOTION_COMIC_SOURCE_EPISODE_ORDER');
    expect(planning).toContain("actSource: 'ai-planned' as const");
    expect(planning).not.toContain('Math.floor((si * 3)');
    expect(planning).toContain('...(sourceEpisodeId ? { sourceEpisodeId } : {})');
    expect(planner).toContain('不要为了凑三幕强行平均分组，幕数应由本集真实剧情阶段决定');
    expect(planner).toContain('只有叙事目标、冲突阶段或人物行动方向发生实质变化时才开始新幕');
    expect(planner).toContain('必须基于原文中的具体事件或转折');
    for (const label of ['AI 规划', '规则推断', '人工调整', '从本场开始新一幕', '幕边界依据']) {
      expect(scenesPanel).toContain(label);
    }
    for (const rawControl of ['<button', '<input', '<textarea', '<select']) expect(dialog).not.toContain(rawControl);
  });

  it('keeps destructive starter replacement guarded for historical projects', async () => {
    const [page, dialog] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/motion-comic/MotionComicPlanDialog.tsx'),
    ]);

    expect(page).toContain('isUntouchedMotionComicStarter(document)');
    expect(page).toContain('canReplaceStarter={canReplaceStarter}');
    expect(page).toContain('onReplaceStarter={(reviewed) => void applyPlan(true, reviewed)}');
    expect(dialog).toContain('canReplaceStarter && !replaceStarterByDefault');
    expect(dialog).toContain('替换默认空模板');
    expect(dialog).toContain('只会移除未修改的占位内容并写入本次规划');
    expect(dialog).toContain('一旦首集被编辑或生成过素材，该操作就不会出现');
  });

  it('locks imported projects to remote video while preserving queue, retry and provider controls', async () => {
    const [page, readiness, workspace] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/features/motion-comic/MotionComicVideoReadiness.tsx'),
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
    ]);

    for (const marker of [
      'resolveDirectorVideoProviderOptions',
      'resolveDirectorVideoProviderStatus',
      "job.capability === 'image-to-video'",
      "renderStrategy: remoteVideo ? 'living-poster' : 'deterministic-layers'",
      'videoInputReady: firstFrameReady',
      'videoJobStatus: videoJob?.status',
      'videoEstimatedCost:',
      'onGenerateVideo=',
      'onRetryVideo=',
      'onVideoProviderChange={selectVideoProvider}',
      'renderShotWorkflow=',
      '<MotionComicVideoReadiness',
      'remoteOnly={Boolean(document.sourceDocument)}',
      "openSettings?.('video', 'motion-comic', document.id)",
      'invalidateMotionComicVideosForChangedInputs(current, update(current))',
      'invalidateMotionComicVideosForChangedInputs(latest, attachMotionComicReference(latest, target, asset))',
    ]) expect(page).toContain(marker);
    expect(page).toContain('api.generateDirectorShotVideo');
    expect(page).toContain("if (sourceShot.renderStrategy !== 'remote-video')");
    expect(page).toContain('远程视频任务完成，但没有返回可播放的视频资产');
    expect(page).toContain("latestVideoJob?.status === 'running'");
    expect(readiness).toContain('const remoteVideo = remoteOnly ||');
    expect(readiness).toContain('options={remoteOnly');
    expect(readiness).toContain("[{ value: 'living-poster', label: '远程视频'");
    expect(readiness).toContain("label: '图片运镜'");
    expect(workspace).toContain('videoReady: Boolean(shot.videoUrl)');
    expect(workspace).not.toContain("videoReady: Boolean(shot.videoUrl) || shot.videoJobStatus === 'completed'");
  });

  it('defines bounded layouts for planning and the source-first production stages', async () => {
    const css = await source('src/styles/features/motion-comic.css');
    expect(css).toContain('.sd-dialog-surface:has(.motion-comic-plan-dialog)');
    expect(css).toContain('width: min(960px, calc(100vw - 48px))');
    expect(css).toContain('.motion-comic-create__layout');
    expect(css).toContain('.motion-comic-production__stages');
    expect(css).toContain('grid-template-columns: repeat(8, minmax(0, 1fr))');
    expect(css).toContain('.motion-comic-source-panel__layout');
    expect(css).toContain('.motion-comic-episodes-panel__layout');
    expect(css).toContain('.motion-comic-episode-plan-state {');
    expect(css).toContain('position: sticky;');
    expect(css).toContain('.motion-comic-episode-plan-state > button { flex: 0 0 auto; }');
    expect(css).toContain('.motion-comic-scene-editor__row');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('@media (max-width: 620px)');
    expect(css).toContain('.motion-comic-plan-error');
    expect(css).toContain('.motion-comic-video-readiness__checks');
    expect(css).toContain('.motion-comic-video-readiness__notice');
    expect(css).toContain('.motion-comic-video-readiness__mode');
  });
});
