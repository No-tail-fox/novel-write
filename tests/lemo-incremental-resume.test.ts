import { describe, expect, it, vi } from 'vitest';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { fitEditorialNarrationTiming } from '../src/shared/editorial-narration-timing';
import { LEMO_NATIVE_ENGINE, lemoNativeFilmSchema } from '../src/shared/creative-animation/native-film';
import { lemoProjectFiles } from '../src/shared/creative-animation/native-project';
import { reconcileLemoEditSessions } from '../electron/lemo-incremental-resume';
import { voxInputHash } from '../electron/vox-production-service';

function retainedIncrementalDocument() {
  const d = nativeDocument(), settings = nativeSettings(), session = 'film-code:shared';
  const files = lemoProjectFiles(d.beats.flatMap(beat => beat.shots.map(shot => shot.id)));
  files[0] = { ...files[0], source: 'return {palette:1};', status: 'valid', attempts: [{ requestId: 'saved-request', source: 'return {palette:1};', providerRequestId: 'saved-provider-id', rawResponse: '{"edits":[],"done":true}', applied: true }] };
  d.creativeFilms = [lemoNativeFilmSchema.parse({ id: 'saved-film', styleId: 'watercolor', upstreamRevision: 'fixture', treatment: '保留原始源码与已保存的请求回执。', durationMs: d.timeline!.durationMs,
    width: 1920, height: 1080, fps: 24, assetIds: [], status: 'generated',
    project: { version: 2, authoringMode: 'incremental', materials: [], bindings: {}, files,
      editSessions: { [session]: { rounds: 1, done: true } }, repairFileIds: [], samplePaths: [] } })];
  d.productionRun = { version: 1, id: 'retained-run', status: 'paused', engine: LEMO_NATIVE_ENGINE, authoringVersion: 2, filmId: 'saved-film', settings,
    nodes: [{ id: session + ':edit:1', kind: 'film-edit', fileId: 'shared', editSession: session, editRound: 1, dependencies: [], status: 'pending', paid: true, attempt: 1, requestId: 'saved-request', inputHash: 'saved-input-hash' }],
    sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'native-offline-test', createdAt: d.createdAt, updatedAt: d.updatedAt };
  return parseEditorialCollagePipelineData(d);
}

// These are pure retained-data utilities; the production service never resumes v1/v2/v3.
describe('retained incremental revision utility', () => {
  it('rebases the session receipt without mutating accepted source or consumed request identities', () => {
    const d = retainedIncrementalDocument(), before = structuredClone(d), next = reconcileLemoEditSessions(d);
    expect(d).toEqual(before); expect(next).not.toBe(d);
    expect(next.creativeFilms![0].project!.files).toEqual(before.creativeFilms![0].project!.files);
    expect(next.creativeFilms![0].project!.editSessions!['film-code:shared']).toMatchObject({ revision: 1, rounds: 0, done: false,
      history: [{ revision: 0, rounds: 1, done: true, receipts: [{ nodeId: 'film-code:shared:edit:1', requestId: 'saved-request', inputHash: 'saved-input-hash' }] }] });
    expect(next.creativeFilms![0].project!.editSessions!['film-code:shared'].diagnostic).toContain('UPSTREAM_INPUT_CHANGED');
    expect(next.productionRun!.nodes).toEqual(before.productionRun!.nodes);
    expect(parseEditorialCollagePipelineData(next).creativeFilms).toEqual(next.creativeFilms);
  });
  it.each(['unknown', 'running'] as const)('does not rebase an unresolved paid %s request', status => {
    const d = retainedIncrementalDocument(); d.productionRun!.nodes[0].status = status;
    const before = structuredClone(d);
    expect(reconcileLemoEditSessions(d)).toBe(d); expect(d).toEqual(before);
  });
  it('bounds revision history without discarding existing source or receipts', () => {
    const d = retainedIncrementalDocument(), session = d.creativeFilms![0].project!.editSessions!['film-code:shared'];
    session.revision = 64; d.productionRun!.nodes[0].id = 'film-code:shared:revision:64:edit:1';
    const before = structuredClone(d);
    expect(() => reconcileLemoEditSessions(d)).toThrow('LEMO_EDIT_REVISION_LIMIT'); expect(d).toEqual(before);
  });
  it('rejects old saved production before applying any revision or resubmitting retained edits', async () => {
    const d = retainedIncrementalDocument(), editFilmFile = vi.fn(), officialStep = vi.fn(), recoverOfficialStep = vi.fn();
    const h = nativeHarness({ editFilmFile, officialStep, recoverOfficialStep }, d), save = vi.spyOn(h.store, 'save');
    for (const action of ['resume', 'reconcile', 'retry-unknown'] as const) {
      await expect(h.service.control({ id: d.id, runId: d.productionRun!.id, action, nodeId: d.productionRun!.nodes[0].id })).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    }
    for (const operation of [editFilmFile, officialStep, recoverOfficialStep, save]) expect(operation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(d); expect(h.receipts.size).toBe(0);
  });
});

describe('official v4 recovery after upstream changes', () => {
  it.each(['timing', 'source', 'style', 'scene'] as const)('retains an unknown request after a %s change and never replays or adopts stale recovery', async changed => {
    const officialStep = vi.fn(async (document: ReturnType<typeof nativeDocument>, node: { id: string }) => {
      if (node.id === 'official-authoring') throw new Error('socket disconnected after submitting official request');
      return document;
    });
    const recoverOfficialStep = vi.fn(async () => undefined), editFilmFile = vi.fn();
    const h = nativeHarness({ officialStep, recoverOfficialStep, editFilmFile });
    await h.start(); await h.idle();
    const d = h.get(), original = structuredClone(d.productionRun!.nodes.find(node => node.id === 'official-authoring')!);
    expect(d.productionRun!.authoringVersion).toBe(4); expect(original.status).toBe('unknown'); expect(original.requestId).toBeTruthy();
    if (changed === 'timing') { d.beats[0].shots[0].durationMs += 1000; d.beats[0].durationMs += 1000; Object.assign(d, fitEditorialNarrationTiming(d)); }
    else if (changed === 'source') d.sourceText += '保留新的文案修改。';
    else if (changed === 'style') d.productionRun!.settings.authoring!.styleId = 'brick-toy';
    else d.beats[0].shots[0].scenePrompt += '新场景要求';
    expect(voxInputHash(h.runtime.input(d, original))).not.toBe(original.inputHash);
    d.productionRun!.status = 'paused'; h.set(d);
    await h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'reconcile' });
    const reconciled = h.get();
    expect(reconciled.productionRun!.nodes.find(node => node.id === original.id)).toEqual(original);
    expect(reconciled.productionRun!.id).toBe(d.productionRun!.id);
    expect(reconciled.sourceText).toBe(d.sourceText); expect(reconciled.beats).toEqual(d.beats);
    await expect(h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'resume' })).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    expect(officialStep.mock.calls.map(([, node]) => node.id)).toEqual(['official-treatment', 'official-style-frame', 'official-voice-lock', 'official-authoring']);
    expect(recoverOfficialStep).not.toHaveBeenCalled(); expect(editFilmFile).not.toHaveBeenCalled();
    expect(h.calls).not.toContain('render'); expect(h.errors).toEqual([]);
  });
});
