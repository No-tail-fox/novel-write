import { describe, expect, it, vi } from 'vitest';
import { nativeHarness } from './lemo-native.fixture';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import type { LlmTextResult } from '../src/shared/llm-provider';

const announcement = 'Reading the current factory source. I will add the remaining painter next.';
const response = (text: string): LlmTextResult => ({ text, raw: text, finishReason: 'end_turn', requestId: 'offline-no-action' });
const reply = (prompt: string) => {
  const p = JSON.parse(prompt);
  const source = p.file.id === 'shared' ? 'return {calls: []};' : p.file.id === 'director'
    ? 'return {render(t){for(const s of Object.values(scenes)) s.render(t);},texts(t){return Object.values(scenes).flatMap(s=>s.texts(t));}};'
    : 'return {render(t){shared.calls.push(t);},texts(t){return [];}};';
  return response(JSON.stringify({ baseHash: p.batch.baseHash, edits: [{ search: '', replace: source }], done: true, summary: '交付实际代码' }));
};
const sharedFile = (h: ReturnType<typeof nativeHarness>) => h.get().creativeFilms!.find(f => f.id === h.get().productionRun!.filmId)!.project!.files.find(f => f.id === 'shared')!;

describe('durable bounded correction of prose-only authoring', () => {
  it('checkpoints the rejected receipt, sends corrective context, then continues without changing the original', async () => {
    let h: ReturnType<typeof nativeHarness>;
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      expect(p.execution).toContain('Deliver the actual JSON edit transaction NOW');
      if (editFilmFile.mock.calls.length === 1) return response(announcement);
      if (p.file.id === 'shared') {
        const rejected = sharedFile(h).attempts.at(-1)!;
        expect(rejected).toMatchObject({ applied: false, rawResponse: announcement });
        expect(h.receipts.has(rejected.requestId)).toBe(true);
        expect(p.batch.lastRejectedBatch).toMatchObject({ applied: false, responseExcerpt: announcement });
        expect(p.batch.lastRejectedBatch.diagnostic).toContain('LEMO_EDIT_NO_ACTION');
        expect(p.batch.round).toBe(1);
        expect(p.batch.source).toBe('');
      }
      return reply(prompt);
    });
    h = nativeHarness({ editFilmFile });
    const original = h.get().sourceText;
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('completed');
    expect(h.get().sourceText).toBe(original);
    const file = sharedFile(h);
    expect(file.attempts.map(a => a.applied)).toEqual([false, true]);
    expect(new Set(file.attempts.map(a => a.requestId)).size).toBe(2);
    expect(h.get().productionRun!.nodes.find(n => n.id === 'film-code:shared:edit:1')).toMatchObject({ attempt: 2, status: 'completed' });
  });

  it('stops after three attempts with every paid receipt retained and no invented code', async () => {
    const editFilmFile = vi.fn(async () => response(announcement));
    const h = nativeHarness({ editFilmFile });
    await h.start(); await h.idle();
    expect(editFilmFile).toHaveBeenCalledTimes(3);
    expect(h.get().productionRun?.status).toBe('failed');
    expect(h.get().productionRun?.message).toContain('LEMO_EDIT_NO_ACTION');
    const file = sharedFile(h);
    expect(file.source).toBe('');
    expect(file.attempts).toHaveLength(3);
    expect(new Set(file.attempts.map(a => a.requestId)).size).toBe(3);
    for (const a of file.attempts) {
      expect(a).toMatchObject({ rawResponse: announcement, applied: false });
      expect(h.receipts.has(a.requestId)).toBe(true);
    }
  });

  it('honors pause before purchasing a corrective turn', async () => {
    let h: ReturnType<typeof nativeHarness>;
    const editFilmFile = vi.fn(async () => {
      await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'pause' });
      return response(announcement);
    });
    h = nativeHarness({ editFilmFile });
    await h.start(); await h.idle();
    expect(editFilmFile).toHaveBeenCalledTimes(1);
    expect(h.get().productionRun?.status).toBe('paused');
    expect(sharedFile(h).attempts[0]).toMatchObject({ applied: false, rawResponse: announcement });
  });

  it('never automatically reissues an interrupted paid response', async () => {
    const editFilmFile = vi.fn(async () => { throw new LlmTextInterruptedError(response(announcement), new Error('offline interruption')); });
    const h = nativeHarness({ editFilmFile });
    await h.start(); await h.idle();
    expect(editFilmFile).toHaveBeenCalledTimes(1);
    expect(h.get().productionRun?.nodes.find(n => n.id === 'film-code:shared:edit:1')?.status).toBe('unknown');
    expect(sharedFile(h).attempts[0]).toMatchObject({ interrupted: true, applied: false, rawResponse: announcement });
  });

  it('does not introduce hidden retries for other malformed JSON or output truncation', async () => {
    for (const r of [response('{'), { ...response(announcement), finishReason: 'max_tokens' }, { ...response(announcement), finishReason: null }]) {
      const editFilmFile = vi.fn(async () => r);
      const h = nativeHarness({ editFilmFile });
      await h.start(); await h.idle();
      expect(editFilmFile).toHaveBeenCalledTimes(1);
      expect(h.get().productionRun?.status).toBe('failed');
    }
  });
});
