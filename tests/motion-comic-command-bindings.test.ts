import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFile(new URL(`../src/features/motion-comic/${name}.tsx`, import.meta.url), 'utf8');

describe('motion comic command bridges', () => {
  it('keeps proposal generation, adoption and revert behind distinct reviewed controls', async () => {
    const workspace = await read('MotionComicScriptWorkspace');
    const panel = await read('MotionComicScriptProposal');
    for (const method of ['proposeMotionComicScriptChange', 'adoptMotionComicScriptChange', 'revertMotionComicScriptChange']) {
      expect(workspace).toContain(`withSavedProject(current => api.${method}(`);
    }
    expect(panel).toContain('生成单段候选');
    expect(panel).toContain('disabled={Boolean(submitReason)}');
    expect(panel).toContain("perform('adopt', () => onAdopt(proposal)");
    expect(panel).toContain("perform('revert', () => onRevert(proposal)");
    expect(panel).toContain('disabled={Boolean(revertReason)}');
    expect(panel).toContain('撤销此次采用');
    expect(panel).toContain('setUncertain({ kind, requestId, proposalId })');
  });
  it('separates paid extraction from explicit selected-asset adoption', async () => {
    const page = await read('MotionComicPage');
    const panel = await read('MotionComicAssetExtraction');
    expect(page).toContain('api.proposeMotionComicAssetExtraction({ ...input, id: saved.id, expectedUpdatedAt: saved.updatedAt })');
    expect(page).toContain('api.applyMotionComicAssetExtraction({ ...input, id: saved.id, expectedUpdatedAt: saved.updatedAt })');
    expect(panel).toContain('保存并生成');
    expect(panel).toContain('保存并入库');
    expect(panel).toContain('disabled={blocked || !source?.sourceText.trim()}');
    expect(panel).toContain("disabled={blocked || candidate.status !== 'ready' || !selected.length || incomplete}");
    expect(panel.indexOf('persist(intent)')).toBeLessThan(panel.indexOf('await onApply(saved,'));
    expect(panel).toContain('await onPropose(saved, { sourceEpisodeId, category: backendCategory, requestId: intent.requestId })');
  });
  it('imports voice samples through the saved project and exposes import failure', async () => {
    const page = await read('MotionComicPage');
    const panel = await read('MotionComicCharacterVoiceSample');
    expect(page).toContain('api.importCharacterVoiceSample({ taskId: saved.id, characterId: character.id, expectedUpdatedAt: saved.updatedAt })');
    expect(panel).toContain("run('import', onImport)");
    expect(panel).toContain('disabled={blocked}');
    expect(panel).toContain('导入样本');
    expect(panel).toContain("fail(reason, kind === 'import' ? '导入失败' : '解绑失败')");
  });
  it('routes single and bulk reference generation to persisted background batches', async () => {
    const page = await read('MotionComicPage');
    const panel = await read('MotionComicReferenceBatch');
    expect(page.match(/api\.submitMotionComicReferenceBatch\(/gu)).toHaveLength(3);
    expect(page).toContain('targets: [target]');
    expect(panel).toContain('保存并提交');
    expect(panel).toContain('disabled={disabled || busy || !targets.length}');
    expect(panel).toContain('await submitPreparedReferenceBatch(latest.current, targets)');
    expect(panel).toContain('remember(await latest.current.onControl(batch.id, action))');
  });
});
