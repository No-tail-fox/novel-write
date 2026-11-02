import { describe, expect, it, vi } from 'vitest';
import { AppError, normalizeAppError } from '../src/shared/app-error';
import { deferred, handlerSource, productionHandler, sourceText } from './helpers/source-handler';

const editorial = 'src/features/editorial-collage/EditorialCollagePage.tsx';
const desk = 'src/features/director-desk/DirectorDeskWorkspace.tsx';
const comic = 'src/features/motion-comic/MotionComicPage.tsx';
const scripts = 'src/features/motion-comic/MotionComicScriptWorkspace.tsx';
const viral = 'src/features/viral/ViralAnalyzerPage.tsx';
const run = async (operation: () => Promise<unknown>) => operation();
function tokens(source: string, required: string[]) { for (const value of required) expect(source, value).toContain(value); }

describe('creative production command behavior', () => {
  it('clears previous action feedback before reopening production settings', async () => {
    const clear = vi.fn(), open = vi.fn();
    const show = productionHandler(editorial, 'openProductionSettings', { projectAction: { clearFeedback: clear }, setProductionOpen: open });
    await show();
    expect(clear).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledExactlyOnceWith(true);
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
  });

  it.each(['save', 'start'])('keeps the production dialog open when %s fails and routes its feedback into the dialog', async failure => {
    const error = new Error(failure === 'start' ? 'LEMO_SDK_PROTOCOL: 需要 Anthropic Messages。' : '项目保存失败。');
    const feedback = vi.fn(), close = vi.fn();
    const guardedRun = async (operation: () => Promise<unknown>) => {
      try { return { ok: true, value: await operation() }; }
      catch (cause) { feedback(cause); return { ok: false }; }
    };
    const save = vi.fn(async () => { if (failure === 'save') throw error; return { id: 'project', updatedAt: 'revision-2' }; });
    const api = { startVoxProduction: vi.fn(async () => { throw error; }), getTaskDetail: vi.fn() };
    const start = productionHandler(editorial, 'startProduction', { documentRef: { current: { id: 'project' } }, projectAction: { run: guardedRun }, enqueueProjectMutation: save, api, setProductionOpen: close });
    await start({ authoring: { mode: 'ai-code', styleId: 'caption-news' } });
    expect(feedback).toHaveBeenCalledExactlyOnceWith(error);
    expect(close).not.toHaveBeenCalled();
    expect(api.getTaskDetail).not.toHaveBeenCalled();
    expect(api.startVoxProduction).toHaveBeenCalledTimes(failure === 'start' ? 1 : 0);
    expect(sourceText(editorial).match(/<VoxProductionDialog[^>]+>/)?.[0]).toContain('feedback={projectAction.feedback}');
  });

  it('startVoxProduction saves first and submits the saved revision and settings', async () => {
    const saved = { id: 'project', updatedAt: 'revision-2' }, settings = { mode: 'film' };
    const api = { startVoxProduction: vi.fn(async () => undefined), getTaskDetail: vi.fn(async () => null) };
    const save = vi.fn(async () => saved), close = vi.fn();
    const start = productionHandler(editorial, 'startProduction', { documentRef: { current: { id: 'project' } }, projectAction: { run }, enqueueProjectMutation: save, api, setProductionOpen: close });
    await start(settings);
    expect(save).toHaveBeenCalledExactlyOnceWith('project', expect.any(Function));
    expect(api.startVoxProduction).toHaveBeenCalledExactlyOnceWith({ id: 'project', expectedUpdatedAt: 'revision-2', settings });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(api.startVoxProduction.mock.invocationCallOrder[0]);
    expect(close).toHaveBeenCalledWith(false);
    tokens(sourceText(editorial), ['onStart={startProduction}', 'onControl={controlProduction}']);
  });
  it('controlVoxProduction keeps cancel pending until the backend actually stops', async () => {
    const current = { id: 'project', productionRun: { id: 'run-1', status: 'running' } };
    const api = { controlVoxProduction: vi.fn(async () => ({ status: 'running', message: '等待请求结束' })), getTaskDetail: vi.fn(async () => null) };
    const intent = vi.fn(), save = vi.fn();
    const control = productionHandler(editorial, 'controlProduction', { documentRef: { current }, savedDocumentRef: { current }, projectAction: { run }, enqueueProjectMutation: save, api, setProductionIntent: intent });
    await control('cancel');
    expect(api.controlVoxProduction).toHaveBeenCalledExactlyOnceWith({ id: 'project', runId: 'run-1', action: 'cancel' });
    expect(intent).toHaveBeenCalledWith('等待请求结束'); expect(save).not.toHaveBeenCalled();
    expect(current.productionRun.status).toBe('running');
  });
  it('cancelDirectorRender is serialized and cancellation failure does not pretend the render finished', async () => {
    const pending = deferred(), cancel = vi.fn(() => pending.promise), lock = { current: false }, busy = vi.fn(), error = vi.fn();
    const cancelRender = productionHandler(desk, 'cancelRender', { onCancelRender: cancel, renderBusy: true, cancelRenderLock: lock, setRenderCancelling: busy, setActionError: error, normalizeAppError });
    const first = cancelRender(); await cancelRender(); expect(cancel).toHaveBeenCalledTimes(1); expect(lock.current).toBe(true);
    pending.reject(new AppError('CANCEL_RENDER_FAILED', '取消失败')); await first;
    expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'CANCEL_RENDER_FAILED' })); expect(lock.current).toBe(false); expect(busy).toHaveBeenLastCalledWith(false);
    expect(handlerSource(desk, 'cancelRender')).not.toContain('setRenderBusy(false)');
    for (const page of [editorial, comic]) tokens(sourceText(page), ['onCancelRender=', 'api.cancelDirectorRender(']);
  });
  it('renderDirectorProject prevents same-frame duplicate render and opens export only after success', async () => {
    const pending = deferred(), render = vi.fn(() => pending.promise), stage = vi.fn(), lock = { current: false }, busy = vi.fn();
    const action = productionHandler(desk, 'renderProject', { renderBusy: false, renderLock: lock, onRender: render, setActiveStage: stage, setRenderBusy: busy, setActionError: vi.fn(), normalizeAppError });
    const first = action(); await action(); expect(render).toHaveBeenCalledTimes(1); expect(stage).not.toHaveBeenCalled();
    pending.resolve(undefined); await first; expect(stage).toHaveBeenCalledWith('导出'); expect(lock.current).toBe(false);
    for (const page of [editorial, comic]) tokens(handlerSource(page, 'renderProject'), ['persistQueueRef.current', 'api.renderDirectorProject(', 'api.getTaskDetail(', 'acceptSavedDocument']);
  });
  it('exportVoxAnimationShot uses the persisted revision, not a stale draft', async () => {
    const api = { exportVoxAnimationShot: vi.fn(async () => 'shot.mp4') }, saved = { id: 'project', updatedAt: 'saved-2' };
    const action = productionHandler(editorial, 'exportAnimationShot', { persistQueueRef: { current: Promise.resolve() }, documentRef: { current: { id: 'project', updatedAt: 'old' } }, dirty: true, enqueueProjectMutation: vi.fn(async () => saved), api });
    expect(await action('shot-7')).toBe('shot.mp4'); expect(api.exportVoxAnimationShot).toHaveBeenCalledExactlyOnceWith({ id: 'project', shotId: 'shot-7', expectedUpdatedAt: 'saved-2' });
  });
  it('reviewDirectorArtifact refuses a switched project before a review mutation', async () => {
    const api = { reviewDirectorArtifact: vi.fn() };
    const action = productionHandler(editorial, 'reviewQualityArtifact', { persistQueueRef: { current: Promise.resolve() }, documentRef: { current: { id: 'new' } }, savedDocumentRef: { current: { id: 'old' } }, api });
    await expect(action({ id: 'old' })).rejects.toThrow('项目已切换'); expect(api.reviewDirectorArtifact).not.toHaveBeenCalled();
    for (const page of [editorial, comic]) tokens(handlerSource(page, 'reviewQualityArtifact'), ['expectedUpdatedAt: baseline.updatedAt', 'acceptSavedDocument']);
  });
  it('openTaskOutputDirectory remains wired from both project workspaces', () => {
    for (const page of [editorial, comic]) tokens(sourceText(page), ['onOpenOutput=', 'api.openTaskOutputDirectory(']);
    tokens(sourceText(desk), ["id: 'output'", "id: 'open-output'", 'onOpenOutput']);
  });
});

describe('remaining workflow safety contracts', () => {
  it('generateCustomStylePreview does not overwrite a template edited during generation', async () => {
    const submitted = { id: 'style', prompt: 'original' }, draft = { current: submitted }, pending = deferred(), apply = vi.fn(), status = vi.fn();
    const api = { generateCustomStylePreview: vi.fn(() => pending.promise) };
    const generate = productionHandler('src/features/templates/PromptTemplatesPage.tsx', 'generateImageTemplatePreview', { imageDraftRef: draft, promptTemplateAction: { run }, promptDetailGeneration: { current: 1 }, setImageTemplatePreviewGenerating: vi.fn(), setImageTemplateAiStatus: status, api, setImageDraft: apply });
    const request = generate(); draft.current = { ...submitted, prompt: 'edited' }; pending.resolve({ preview: 'new.png' }); await request;
    expect(api.generateCustomStylePreview).toHaveBeenCalledExactlyOnceWith(submitted); expect(apply).not.toHaveBeenCalled(); expect(status).toHaveBeenLastCalledWith('模板已继续编辑，本次样图未覆盖当前内容。');
  });
  it('checkForUpdate / downloadUpdate / installUpdate stay behind shared update locks and installation confirmation', () => {
    const shell = sourceText('src/app/App.tsx'), announcements = sourceText('src/app/AnnouncementsDialog.tsx');
    tokens(shell, ['api.checkForUpdate(', 'api.downloadUpdate(', 'api.installUpdate(', 'runUpdateAction']);
    tokens(handlerSource('src/features/account/ActivationPage.tsx', 'confirmed'), ['api.installUpdate(', 'updateAction.run']);
    tokens(announcements, ['disabled={busy || updateInProgress || isBrowserPreview}', 'onInstallUpdate', 'onDownloadUpdate', 'onCheckForUpdate']);
  });
  it('planMotionComicEpisodes and selectMotionComicSourceFile preserve source import and stale-request guards', () => {
    tokens(handlerSource(comic, 'prepareCreateEpisodes'), ['api.planMotionComicEpisodes(', 'episodePlanningAction.run', 'episodePlanningRequestRef.current', 'setCreateEpisodeDrafts']);
    tokens(handlerSource(comic, 'importSourceFile'), ['sourceFileAction.run', 'api.selectMotionComicSourceFile(', 'result.ok']);
    tokens(sourceText(comic), ['onPrepareEpisodes=', 'onImportFile=']);
  });
  it('planMotionComic and applyMotionComicPlan require project revisions and explicitly reviewed adjustments', () => {
    tokens(handlerSource(comic, 'generatePlan'), ['planningAction.run', 'api.planMotionComic(', 'expectedUpdatedAt: current.updatedAt', 'request !== planRequestRef.current']);
    tokens(handlerSource(comic, 'applyPlan'), ['planApplyAction.run', 'api.applyMotionComicPlan(', 'expectedUpdatedAt: current.updatedAt', 'reviewedAdjustments', 'api.getTaskDetail(']);
  });
  it('enqueueMotionComicScripts validates duration and sends saved revision and selected scope', async () => {
    const api = { enqueueMotionComicScripts: vi.fn(async (input: unknown) => input) }, error = vi.fn();
    const closure = { startScope: 'selected', duration: '90', selected: { id: 'ep-2' }, instructions: '继续', setError: error, run, withSavedProject: (fn: any) => fn({ id: 'project', updatedAt: 'r2' }), api, alive: { current: true }, setStartScope: vi.fn() };
    await productionHandler(scripts, 'enqueue', closure)();
    expect(api.enqueueMotionComicScripts).toHaveBeenCalledExactlyOnceWith({ id: 'project', expectedUpdatedAt: 'r2', scope: 'selected', sourceEpisodeIds: ['ep-2'], instructions: '继续', targetDurationSec: 90 });
    await productionHandler(scripts, 'enqueue', { ...closure, duration: 'invalid' })(); expect(api.enqueueMotionComicScripts).toHaveBeenCalledTimes(1); expect(error).toHaveBeenCalled();
  });
  it('controlMotionComicScripts, editMotionComicScript and storyboardMotionComicScript share a synchronous mutation lock', async () => {
    const pending = deferred(), mutating = { current: false }, error = vi.fn();
    const execute = productionHandler(scripts, 'run', { mutating, sequence: { current: 0 }, alive: { current: true }, setBusy: vi.fn(), setError: error, setSnapshot: vi.fn(), setNotice: vi.fn(), message: (e: Error) => e.message });
    const first = execute(() => pending.promise, 'done'); await expect(execute(vi.fn(), 'duplicate')).rejects.toThrow('上一项操作');
    pending.reject(new Error('服务失败')); await expect(first).rejects.toThrow('服务失败'); expect(error).toHaveBeenLastCalledWith('服务失败'); expect(mutating.current).toBe(false);
    tokens(handlerSource(scripts, 'control'), ['run(() => api.controlMotionComicScripts(', "action === 'cancel'", 'taskId: task?.id']);
    tokens(sourceText(scripts), ['api.editMotionComicScript({ id: current.id, expectedUpdatedAt: current.updatedAt', 'outputRevision: revision', 'api.storyboardMotionComicScript({ id: current.id, expectedUpdatedAt: current.updatedAt', 'outputRevision: candidate.outputRevision']);
  });
  it('approveMotionComicScripts and applyMotionComicScriptStoryboard retain revision checks and reload accepted documents', () => {
    tokens(handlerSource(comic, 'approveScripts'), ['withSavedScriptProject', 'api.approveMotionComicScripts(', 'expectedUpdatedAt: submitted.updatedAt', 'revisions', 'acceptSavedDocument']);
    tokens(handlerSource(comic, 'applyScriptStoryboard'), ['withSavedScriptProject', 'api.applyMotionComicScriptStoryboard(', 'expectedUpdatedAt: submitted.updatedAt', 'acceptSavedDocument', 'documentRef.current?.id !== submitted.id']);
  });
  it.each(['move-up', 'move-down', 'duplicate', 'add-after', 'remove'])('updateHtmlVideoSceneStructure %s routes the selected scene and refreshes only after success', async operation => {
    const api = { updateHtmlVideoSceneStructure: vi.fn(async () => ({ revision: 3 })) }, apply = vi.fn(), refresh = vi.fn();
    const action = productionHandler('src/features/html-video/HtmlVideoStoryboundPanels.tsx', 'mutateStructure', { action: { run }, api, task: { id: 'task' }, scene: { index: 4 }, applyState: apply, refreshTaskDetail: refresh });
    await action(operation); expect(api.updateHtmlVideoSceneStructure).toHaveBeenCalledExactlyOnceWith('task', { operation, sceneIndex: 4 }); expect(apply).toHaveBeenCalledWith({ revision: 3 }); expect(refresh).toHaveBeenCalledWith('task');
  });
  it('importLocalViralAnalysis does not automatically submit paid analysis, and analyzePreparedViralAnalysis rejects archived selections', async () => {
    tokens(handlerSource(viral, 'startAnalysis').split("if (!url.trim())")[0], ['api.importLocalViralAnalysis(', '确认任务后点击', 'return;']);
    const api = { analyzePreparedViralAnalysis: vi.fn() }, action = productionHandler(viral, 'analyzePrepared', { selected: { id: 'report' }, selectedArchived: true, api, viralAction: { run }, applyState: vi.fn() });
    await action(); expect(api.analyzePreparedViralAnalysis).not.toHaveBeenCalled();
  });
  it('configureViralReferenceRun propagates failure instead of falsely clearing edited settings', async () => {
    const cause = new Error('保存失败'), api = { configureViralReferenceRun: vi.fn() };
    const action = productionHandler(viral, 'configureReferenceRun', { viralAction: { run: async () => ({ ok: false, error: cause }) }, api, applyState: vi.fn() });
    await expect(action({ analysisId: 'report' })).rejects.toBe(cause);
    tokens(handlerSource('src/features/viral/ViralReferenceRunSettings.tsx', 'configure'), ['retryReviewedRequests && !reviewedCharges', 'await onConfigure(', 'catch (cause)', 'setError(']);
  });
  it('removeImageLabBackground uses record detail and does not submit an unfinished image', async () => {
    const api = { removeImageLabBackground: vi.fn(async () => ({ changed: true })) }, apply = vi.fn();
    const action = productionHandler('src/features/labs/ImageLabPage.tsx', 'retryImageLabBackground', { generating: false, imageLabAction: { run }, imageLabRecordDetail: async () => ({ id: 'image', cutoutMethod: 'chroma' }), api, applyState: apply, setSubmitError: vi.fn() });
    await action({ id: 'image', status: 'pending' }); expect(api.removeImageLabBackground).not.toHaveBeenCalled();
    await action({ id: 'image', status: 'generated' }); expect(api.removeImageLabBackground).toHaveBeenCalledExactlyOnceWith({ id: 'image', method: 'chroma' }); expect(apply).toHaveBeenCalledWith({ changed: true });
  });
  it('saveViralReferenceEdit keeps drafts on failure and uses expectedRevision on retry', async () => {
    const api = { saveViralReferenceEdit: vi.fn().mockRejectedValueOnce(new Error('revision conflict')).mockResolvedValue({ revision: 5 }) }, drafts = vi.fn(), manifest = vi.fn(), error = vi.fn(), epoch = { current: 2 };
    const action = productionHandler('src/features/viral/ViralReferenceReport.tsx', 'saveEdit', { selected: { id: 'obs' }, draft: { revision: 4, partId: 'part', text: '  修订  ' }, editable: true, busy: false, analysisId: 'report', api, setBusy: vi.fn(), setNotice: vi.fn(), setError: error, setDrafts: drafts, setManifest: manifest, epoch, errorText: (e: Error) => e.message });
    await action(); expect(drafts).not.toHaveBeenCalled(); expect(manifest).not.toHaveBeenCalled(); expect(epoch.current).toBe(2); expect(error).toHaveBeenCalledWith('revision conflict');
    await action(); expect(api.saveViralReferenceEdit).toHaveBeenLastCalledWith({ analysisId: 'report', expectedRevision: 4, partId: 'part', observationId: 'obs', text: '修订' }); expect(epoch.current).toBe(3); expect(manifest).toHaveBeenCalledWith({ revision: 5 });
  });
});
