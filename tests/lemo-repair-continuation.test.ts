import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { applyLemoEdits, LEMO_EDIT_MAX_ROUNDS } from '../src/shared/creative-animation/lemo-edits';
import { lemoProjectFiles, lemoProjectSchema } from '../src/shared/creative-animation/native-project';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { validateLemoFile } from '../electron/lemo-file-validation';
import { buildVoxProductionNodes, type VoxProductionNode } from '../src/shared/vox-production';
import { voxInputHash } from '../electron/vox-production-service';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const patch = (source: string, edits: Array<{ search: string; replace: string }>, done = true) => JSON.stringify({ baseHash: hash(source), edits, done, summary: 'Address only the measured layout issue.' });

describe('retained exact-source repair helpers', () => {
  it('applies successive measured fixes to the newly accepted source without replaying the first patch', () => {
    const original = 'const iconSize=18; const titleSize=17; return {render(){},texts(){return []}};';
    const firstRaw = patch(original, [{ search: 'iconSize=18', replace: 'iconSize=24' }]);
    const first = applyLemoEdits(original, hash(original), firstRaw);
    const second = applyLemoEdits(first.source, hash(first.source), patch(first.source, [{ search: 'titleSize=17', replace: 'titleSize=24' }]));
    expect(second.source).toBe('const iconSize=24; const titleSize=24; return {render(){},texts(){return []}};');
    expect(() => validateLemoFile(second.source, 'scene')).not.toThrow();
    expect(() => applyLemoEdits(first.source, hash(first.source), firstRaw)).toThrow('LEMO_EDIT_STALE');
    expect(original).toContain('iconSize=18'); expect(first.source).toContain('titleSize=17');
  });
  it('identifies an accepted empty repair as unchanged source and rejects a no-op replacement', () => {
    const source = 'return {render(){},texts(){return []}};';
    expect(applyLemoEdits(source, hash(source), patch(source, [])).source).toBe(source);
    expect(() => applyLemoEdits(source, hash(source), patch(source, [], false))).toThrow('LEMO_EDIT_EMPTY');
    expect(() => applyLemoEdits(source, hash(source), patch(source, [{ search: 'render', replace: 'render' }]))).toThrow('LEMO_EDIT_NOOP');
  });
  it('keeps a shared typography fix scoped to the exact cached helper', () => {
    const source = 'const clipped=true; const palette={ink:1}; return {clipped,palette};';
    const repaired = applyLemoEdits(source, hash(source), patch(source, [{ search: 'clipped=true', replace: 'clipped=false' }]));
    expect(repaired.source).toBe('const clipped=false; const palette={ink:1}; return {clipped,palette};');
    expect(() => validateLemoFile(repaired.source, 'shared')).not.toThrow();
    expect(source).toContain('clipped=true');
  });
  it('retains the per-file batch limit in saved project validation', () => {
    const project = { version: 2, authoringMode: 'incremental', materials: [], bindings: {}, files: lemoProjectFiles(['shot-1']),
      editSessions: { 'film-repair:scene-1': { rounds: LEMO_EDIT_MAX_ROUNDS, done: false, diagnostic: 'Unresolved measured layout failure' } }, repairFileIds: ['scene-1'], samplePaths: [] };
    expect(lemoProjectSchema.parse(project).editSessions!['film-repair:scene-1'].rounds).toBe(16);
    expect(() => lemoProjectSchema.parse({ ...project, editSessions: { 'film-repair:scene-1': { rounds: LEMO_EDIT_MAX_ROUNDS + 1, done: false } } })).toThrow();
  });
});

describe('retired repair orchestration is unreachable from official v4', () => {
  function current() {
    const d = nativeDocument(), settings = nativeSettings();
    d.productionRun = { version: 1, id: 'official-repair-test', status: 'paused', engine: LEMO_NATIVE_ENGINE, authoringVersion: 4, settings,
      nodes: buildVoxProductionNodes(d, settings, LEMO_NATIVE_ENGINE, 4), sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'native-offline-test', createdAt: d.createdAt, updatedAt: d.updatedAt };
    return d;
  }
  it.each(['film-sample-repair', 'film-repair', 'film-sample-finalize', 'film-review'] as const)('rejects %s without invoking the old planner, preview or repair provider', async kind => {
    const d = current(), editFilmFile = vi.fn(), planFilm = vi.fn(), previewCode = vi.fn(), officialStep = vi.fn(), recoverOfficialStep = vi.fn();
    const h = nativeHarness({ editFilmFile, planFilm, previewCode, officialStep, recoverOfficialStep }, d);
    const node: VoxProductionNode = { id: kind + ':scene-1', kind, fileId: 'scene-1', dependencies: [], status: 'pending', paid: true, attempt: 0 };
    await expect(h.runtime.execute(d, node)).rejects.toThrow('LEMO_OFFICIAL_NODE_UNSUPPORTED');
    await expect(h.runtime.recover!(d, node)).rejects.toThrow('LEMO_OFFICIAL_NODE_UNSUPPORTED');
    for (const operation of [editFilmFile, planFilm, previewCode, officialStep, recoverOfficialStep]) expect(operation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(d); expect(h.receipts.size).toBe(0);
  });
  it.each(['resume', 'recheck-code', 'retry-unknown'] as const)('refuses %s on a stored legacy repair run without purchasing any further batches', async action => {
    const d = current(); d.productionRun!.authoringVersion = 2;
    d.productionRun!.status = 'failed';
    d.productionRun!.nodes = [{ id: 'film-repair:scene-1:edit:16', kind: 'film-edit', fileId: 'scene-1', editSession: 'film-repair:scene-1', editRound: 16, dependencies: [], status: 'unknown', paid: true, attempt: 1, requestId: 'retained-paid-repair' }];
    const editFilmFile = vi.fn(), planFilm = vi.fn(), previewCode = vi.fn(), h = nativeHarness({ editFilmFile, planFilm, previewCode }, d), save = vi.spyOn(h.store, 'save');
    await expect(h.service.control({ id: d.id, runId: d.productionRun!.id, action, nodeId: d.productionRun!.nodes[0].id })).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    for (const operation of [editFilmFile, planFilm, previewCode, save]) expect(operation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(d); expect(h.calls).toEqual([]);
  });
});
