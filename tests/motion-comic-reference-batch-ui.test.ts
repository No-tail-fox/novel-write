import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMotionComicDraft } from '../src/shared/motion-comic';
import type { DirectorBatchRecord } from '../src/shared/director-batch-persistence';
import { AppError, serializeAppErrorForBridge } from '../src/shared/app-error';
import { canResumeReferenceBatch, referenceBatchChoices, referenceBatchErrorMessage, referenceBatchNodeLabel, submitPreparedReferenceBatch } from '../src/features/motion-comic/MotionComicReferenceBatch';

function project() {
  const document = createMotionComicDraft({ id: 'batch-ui', title: '测试', premise: '' });
  document.sceneAssets = [
    { id: 'empty', label: '空场景', description: '', prompt: '雨', continuityNotes: '', referenceAssetVersionIds: [] },
    { id: 'candidate', label: '有候选', description: '', prompt: '夜', continuityNotes: '', referenceAssetVersionIds: ['image'] },
  ];
  return document;
}
function batch(state = 'not-submitted'): DirectorBatchRecord {
  return { id: 'batch', status: 'paused', recoveryRequired: false, cancelRequested: false, nodes: [{ id: 'node', status: 'pending', reference: { submissionState: state, applyState: 'pending' } }] } as DirectorBatchRecord;
}

describe('reference batch UI submission boundary', () => {
  it('retains persisted plain Chinese failures and explicit underlying causes', () => {
    const cause = '图片服务 HTTP 400：本次从零生成却被要求提供原图，请检查图片模型。';
    for (const reason of [cause, new Error(cause)]) {
      const message = referenceBatchErrorMessage(reason);
      expect(message).toContain(cause);
      expect(message).toContain('诊断号：');
      expect(message).not.toContain('操作失败，请重试。');
    }
    const message = referenceBatchErrorMessage(new Error('图片请求失败', { cause: Object.assign(new Error('连接被重置'), { code: 'ECONNRESET', status: 502 }) }));
    expect(message).toContain('图片请求失败');
    expect(message).toContain('连接被重置');
    expect(message).toContain('ECONNRESET');
    expect(message).toContain('HTTP 502');
  });
  it('decodes persisted safe bridge payloads while retaining their diagnostic and retry hint', () => {
    const payload = serializeAppErrorForBridge(new AppError('IPC_HANDLER_FAILED', '图片服务暂不可用，请稍后再试。', true, 'reference-diag-1234'));
    for (const reason of [payload, new Error(`Error invoking remote method: ${payload}`)]) {
      const message = referenceBatchErrorMessage(reason);
      expect(message).toBe('图片服务暂不可用，请稍后再试。 可以重试。（诊断号：reference-diag-1234）');
      expect(message).not.toContain('__STORYDREAM_SAFE_APP_ERROR_V1__');
      expect(message).not.toContain('%7B');
    }
  });
  it('redacts secrets from plain errors and decoded bridge messages without dropping the cause', () => {
    const cause = '图片服务拒绝请求 apiKey=plain-test-secret https://images.example.test?token=query-test-secret Authorization: Bearer bearer-test-secret';
    const plain = referenceBatchErrorMessage(new Error(cause));
    const bridged = referenceBatchErrorMessage(serializeAppErrorForBridge(new AppError('IMAGE_PROVIDER_FAILED', cause, false, 'reference-diag-5678')));
    for (const message of [plain, bridged]) {
      expect(message).toContain('图片服务拒绝请求');
      expect(message).toContain('[REDACTED]');
      for (const secret of ['plain-test-secret', 'query-test-secret', 'bearer-test-secret']) expect(message).not.toContain(secret);
      expect(message).not.toContain('__STORYDREAM_SAFE_APP_ERROR_V1__');
    }
    expect(bridged).toContain('reference-diag-5678');
  });
  it('awaits persisted document then sends exactly one batch request for all selected targets', async () => {
    const document = project();
    const saved = { ...document, updatedAt: 'saved-version' };
    let finish!: (value: typeof document) => void;
    const onPrepare = vi.fn(() => new Promise<typeof document>((resolve) => { finish = resolve; }));
    const onSubmit = vi.fn(async () => batch());
    const targets = document.sceneAssets.map((asset) => ({ kind: 'scene' as const, id: asset.id }));
    const pending = submitPreparedReferenceBatch({ document, category: 'scenes', onPrepare, onSubmit }, targets);
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    finish(saved);
    await pending;
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(saved, targets);
  });
  it('rejects empty selection without saving or submitting', async () => {
    const document = project();
    const onPrepare = vi.fn(async () => document);
    const onSubmit = vi.fn(async () => batch());
    await expect(submitPreparedReferenceBatch({ document, category: 'scenes', onPrepare, onSubmit }, [])).rejects.toThrow('至少');
    expect(onPrepare).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('does not submit a target removed while saving', async () => {
    const document = project();
    const onSubmit = vi.fn(async () => batch());
    await expect(submitPreparedReferenceBatch({ document, category: 'scenes', onPrepare: async () => ({ ...document, sceneAssets: [] }), onSubmit }, [{ kind: 'scene', id: 'empty' }])).rejects.toThrow('不存在');
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('supports mixed episode targets with kind-qualified filtering and revalidates within scope', async () => {
    const document = project();
    document.characters = [{ id: 'person', name: '人', role: '', identityPrompt: '', personality: '', voiceNotes: '', looks: [{ id: 'same-id', characterId: 'person', label: '造型', appearancePrompt: '', wardrobe: '', continuityNotes: '', referenceAssetVersionIds: [], pinned: false }] }];
    document.sceneAssets.push({ id: 'same-id', label: '同 ID 场景', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: [] });
    const choices = referenceBatchChoices(document, 'episode');
    expect(choices.map((choice) => `${choice.target.kind}:${choice.target.id}`)).toContain('look:same-id');
    expect(choices.map((choice) => `${choice.target.kind}:${choice.target.id}`)).toContain('scene:same-id');
    const onSubmit = vi.fn(async () => batch());
    await submitPreparedReferenceBatch({ document, category: 'episode', targetKeys: ['look:same-id'], onPrepare: async () => document, onSubmit }, [{ kind: 'look', id: 'same-id' }]);
    expect(onSubmit).toHaveBeenCalledWith(document, [{ kind: 'look', id: 'same-id' }]);
  });
  it('defaults to missing targets only, including dangling candidates as existing references', () => {
    const choices = referenceBatchChoices(project(), 'scenes');
    expect(choices.map((choice) => choice.defaultSelected)).toEqual([true, false]);
    expect(choices[1].candidateCount).toBe(1);
  });
  it('expands each character look and includes the preferred look when it has no reference', () => {
    const document = project();
    document.characters = [{ id: 'person', name: '人', role: '', identityPrompt: '', personality: '', voiceNotes: '', looks: [false, true].map((pinned, index) => ({ id: `look-${index}`, characterId: 'person', label: '造型', appearancePrompt: '', wardrobe: '', continuityNotes: '', referenceAssetVersionIds: [], pinned })) }];
    expect(referenceBatchChoices(document, 'characters').map((choice) => [choice.target.kind, choice.defaultSelected])).toEqual([['look', true], ['look', true]]);
  });
  it('keeps fixed reference images unselected and never submits after a failed save', async () => {
    const document = project();
    document.sceneAssets[0].referenceAssetVersionIds = ['fixed'];
    document.assets.push({ id: 'fixed', assetId: 'empty', kind: 'image', pinned: true, selected: true, createdAt: '' });
    expect(referenceBatchChoices(document, 'scenes')[0]).toMatchObject({ fixed: true, defaultSelected: false });
    const onSubmit = vi.fn(async () => batch());
    await expect(submitPreparedReferenceBatch({ document, category: 'scenes', onPrepare: async () => { throw new Error('save failed'); }, onSubmit }, [{ kind: 'scene', id: 'empty' }])).rejects.toThrow('save failed');
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('blocks automatic regeneration when candidates appeared during save', async () => {
    const document = project();
    const saved = project();
    saved.sceneAssets[0].referenceAssetVersionIds = ['new'];
    const onSubmit = vi.fn(async () => batch());
    await expect(submitPreparedReferenceBatch({ document, category: 'scenes', onPrepare: async () => saved, onSubmit }, [{ kind: 'scene', id: 'empty' }])).rejects.toThrow('已变化');
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('never permits resume for unknown/submitted requests or recovery-required batches', () => {
    expect(canResumeReferenceBatch(batch())).toBe(true);
    for (const state of ['unknown', 'submitted', 'resolved']) expect(canResumeReferenceBatch(batch(state))).toBe(false);
    const pending = batch();
    pending.nodes.push(batch('unknown').nodes[0]);
    expect(canResumeReferenceBatch(pending)).toBe(false);
    expect(canResumeReferenceBatch({ ...batch(), recoveryRequired: true })).toBe(false);
    expect(canResumeReferenceBatch({ ...batch(), cancelRequested: true })).toBe(false);
  });
  it('shows unknown, stale and pending attachment explicitly without invented completion', () => {
    expect(referenceBatchNodeLabel(batch('unknown').nodes[0])).toContain('结果未知');
    const node = batch('resolved').nodes[0];
    expect(referenceBatchNodeLabel(node)).toBe('待挂接');
    node.reference!.applyState = 'stale';
    expect(referenceBatchNodeLabel(node)).toContain('输入过期');
    node.reference!.applyState = 'applied';
    expect(referenceBatchNodeLabel(node)).toContain('待采用');
  });
  it('mounts a kind-qualified missing-reference batch on the storyboard page', () => {
    const page = readFileSync(new URL('../src/features/motion-comic/MotionComicPage.tsx', import.meta.url), 'utf8');
    const mount = page.slice(page.indexOf('missingEpisodeReferenceTargets.length > 0 ? <MotionComicReferenceBatch'), page.indexOf('onRefresh={async () => {', page.indexOf('missingEpisodeReferenceTargets.length > 0 ? <MotionComicReferenceBatch')));
    expect(mount).toContain('category="episode"');
    expect(mount).toContain('targetKeys={missingEpisodeReferenceTargets.map');
    expect(mount).toContain('selectionMode: \'selected\'');
    expect(mount).toContain('concurrency: 3');
    expect(mount).toContain('onControl={(id, action) => api.controlMotionComicReferenceBatch({ id, action })}');
  });
  it('is mounted on the project asset page for every non-series category', () => {
    const page = readFileSync(new URL('../src/features/motion-comic/MotionComicPage.tsx', import.meta.url), 'utf8');
    const mount = page.slice(page.indexOf("assetSection !== 'series' ? <MotionComicReferenceBatch"), page.indexOf('onRefresh={async () => {', page.indexOf("assetSection !== 'series' ? <MotionComicReferenceBatch")));
    expect(mount).toContain('category={assetSection}');
    expect(mount).toContain('onPrepare={() => withSavedScriptProject(async (saved) => saved)}');
    expect(mount).toContain('selectionMode: \'selected\'');
    expect(mount).toContain("concurrency: assetSection === 'characters' ? 3 : 1");
    // One batch request for all selected targets, never one request per target.
    expect(mount).not.toContain('targets: [');
    expect(mount).toContain('onControl={(id, action) => api.controlMotionComicReferenceBatch({ id, action })}');
  });
});
