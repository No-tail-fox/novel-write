import { fitEditorialNarrationTiming } from '../src/shared/editorial-narration-timing';
import { describe, expect, it, vi } from 'vitest';
import { nativeHarness } from './lemo-native.fixture';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { reconcileLemoEditSessions } from '../electron/lemo-incremental-resume';

const reply = (prompt: string) => {
  const p = JSON.parse(prompt);
  const text = JSON.stringify({ baseHash: p.batch.baseHash, edits: p.batch.source ? [] : [{ search: '', replace: p.file.id === 'shared' ? 'return {palette:1};' : 'return {render(){},texts(){return []}};' }], done: true, summary: '已检查现有源码与当前时序' });
  return { text, raw: text, requestId: 'offline', finishReason: 'stop' };
};

describe('incremental upstream input revisions', () => {
  it('revalidates saved source with new batch identities after retiming, without replaying consumed edits', async () => {
    const edit = vi.fn(async (prompt: string) => reply(prompt));
    const h = nativeHarness({ editFilmFile: edit }); await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('completed');
    const d = h.get(), oldFilm = d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!;
    const oldSource = oldFilm.project!.files.map(f => f.source);
    const oldReceipts = [...h.receipts.keys()];
    d.beats[0].shots[0].durationMs += 1000; d.beats[0].durationMs += 1000; d.productionRun!.status = 'paused';
    h.set(fitEditorialNarrationTiming(d));
    await h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'resume' }); await h.idle();
    const next = h.get(), film = next.creativeFilms!.find(f => f.id === next.productionRun!.filmId)!;
    expect(next.productionRun?.status, next.productionRun?.message).toBe('completed');
    expect(edit).toHaveBeenCalledTimes(6);
    expect(film.project!.files.map(f => f.source)).toEqual(oldSource);
    expect(film.project!.editSessions?.['film-code:shared']).toMatchObject({ revision: 1, rounds: 1, done: true, history: [{ revision: 0, rounds: 1, done: true }] });
    expect(film.project!.editSessions?.['film-code:shared'].history?.[0].receipts[0].requestId).toBeTruthy();
    expect(next.productionRun!.nodes.filter(n => n.kind === 'film-edit').every(n => n.id.includes(':revision:1:'))).toBe(true);
    expect(edit.mock.calls.slice(3).every(([p]) => JSON.parse(p).batch.source && JSON.parse(p).batch.diagnostic.includes('UPSTREAM_INPUT_CHANGED'))).toBe(true);
    expect(oldReceipts.every(id => h.receipts.has(id))).toBe(true);
    expect(next.sourceText).toBe(d.sourceText);
    expect(parseEditorialCollagePipelineData(next).creativeFilms).toEqual(next.creativeFilms);
    next.productionRun!.status = 'paused'; h.set(next);
    await h.service.control({ id: d.id, runId: next.productionRun!.id, action: 'resume' }); await h.idle();
    expect(edit).toHaveBeenCalledTimes(6); expect(h.errors).toEqual([]);
  });
  it('rechecks a fixed host runtime without repaying cleared source repairs', async () => {
    let hostBroken = true;
    const edit = vi.fn(async (prompt: string) => reply(prompt));
    const preview = vi.fn(async () => { if (hostBroken) throw new Error('LEMO_TEXTS: host caption parsing'); return ['real-check-fixture.jpg']; });
    const h = nativeHarness({ editFilmFile: edit, previewCode: preview });
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed');
    const d = h.get(), before = d.creativeFilms![0].project!.files.map(f => f.source);
    const repairCalls = () => edit.mock.calls.filter(([p]) => JSON.parse(p).batch.repair).length;
    const paidRepairs = repairCalls(); expect(paidRepairs).toBe(2);
    d.productionRun!.nodes.find(n => n.id === 'film-sample')!.inputHash = 'old-host-runtime';
    h.set(d); hostBroken = false;
    await h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'resume' }); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    expect(repairCalls()).toBe(paidRepairs);
    expect(h.get().productionRun!.nodes.filter(n => n.kind === 'film-edit' && n.editSession?.startsWith('film-sample-repair:')).every(n => !n.paid)).toBe(true);
    expect(h.get().creativeFilms![0].project!.files.slice(0, 2).map(f => f.source)).toEqual(before.slice(0, 2));
    expect(preview.mock.calls.length).toBeGreaterThan(2);
  });
  it('does not rebase or resubmit unresolved paid calls', async () => {
    const h = nativeHarness({ editFilmFile: async p => reply(p) }); await h.start(); await h.idle();
    const d = h.get(); const edits = d.productionRun!.nodes.filter(n => n.kind === 'film-edit');
    edits[0].status = 'pending'; edits[1].status = 'unknown';
    expect(reconcileLemoEditSessions(d)).toBe(d);
    d.productionRun!.status = 'paused'; h.set(d);
    await expect(h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'resume' })).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
  });
});
