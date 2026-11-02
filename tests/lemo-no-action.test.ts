import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { nativeHarness } from './lemo-native.fixture';
import { applyLemoEdits } from '../src/shared/creative-animation/lemo-edits';
import { lemoTruncationDiagnostic } from '../electron/lemo-file-validation';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import type { LlmTextResult } from '../src/shared/llm-provider';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';

const announcement = 'Reading the current factory source. I will add the remaining painter next.';
const response = (text: string): LlmTextResult => ({ text, raw: text, finishReason: 'end_turn', requestId: 'offline-no-action' });
const source = 'return {palette: 1};';
const hash = createHash('sha256').update(source).digest('hex');

describe('retained no-action and interrupted-text diagnostics', () => {
  it.each([announcement, '下一步将读取文件并补充绘制代码。'])('rejects a prose-only announcement without fabricating source: %s', text => {
    expect(() => applyLemoEdits(source, hash, text)).toThrow('LEMO_EDIT_NO_ACTION');
    expect(source).toBe('return {palette: 1};');
  });
  it.each(['{', '{"baseHash":', '', '\x60\x60\x60json\n{'])('distinguishes incomplete JSON from prose-only delivery: %s', text => {
    expect(() => applyLemoEdits(source, hash, text)).toThrow('LEMO_EDIT_INVALID');
  });
  it('accepts an explicit completion only when existing source is present', () => {
    const raw = JSON.stringify({ baseHash: hash, edits: [], done: true, summary: '现有完整源码已检查。' });
    expect(applyLemoEdits(source, hash, raw)).toMatchObject({ source, done: true });
    expect(() => applyLemoEdits('', hash, raw)).toThrow('LEMO_EDIT_EMPTY');
  });
  it('retains the actual interrupted receipt and distinguishes truncation evidence', () => {
    const result = { ...response(announcement), finishReason: null, usage: { completion_tokens: 18 } };
    const cause = new Error('offline interruption'), error = new LlmTextInterruptedError(result, cause);
    expect(error.result).toBe(result); expect(error.cause).toBe(cause);
    expect(error.message).toContain('LLM_STREAM_INTERRUPTED'); expect(error.message).toContain('offline-no-action');
    expect(error.message).toContain('云端最终结果仍待核对');
    expect(lemoTruncationDiagnostic({ ...result, finishReason: 'max_tokens' })).toContain('LEMO_FILE_TRUNCATED');
    expect(result.text).toBe(announcement); expect(result.raw).toBe(announcement);
  });
});

describe('official-only authoring never invokes a retired corrective loop', () => {
  it.each(['prose', 'malformed', 'truncated', 'interrupted'] as const)('fails preflight instead of using the old %s provider as a fallback', async kind => {
    const editFilmFile = vi.fn(async () => {
      if (kind === 'interrupted') throw new LlmTextInterruptedError(response(announcement), new Error('offline interruption'));
      return { ...response(kind === 'malformed' ? '{' : announcement), ...(kind === 'truncated' ? { finishReason: 'max_tokens' } : {}) };
    });
    const planFilm = vi.fn(), authorFilmFile = vi.fn(), h = nativeHarness({ editFilmFile, planFilm, authorFilmFile });
    const before = h.get(), save = vi.spyOn(h.store, 'save');
    await expect(h.start()).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    for (const operation of [editFilmFile, planFilm, authorFilmFile, save]) expect(operation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(before); expect(h.receipts.size).toBe(0); expect(h.calls).toEqual([]);
  });
  it('does not treat an official response without film artifacts as a delivered film or buy legacy corrections', async () => {
    const officialStep = vi.fn(async (d: EditorialCollagePipelineData, _node: { id: string }) => d), recoverOfficialStep = vi.fn(async () => undefined);
    const editFilmFile = vi.fn(), planFilm = vi.fn(), authorFilmFile = vi.fn(), h = nativeHarness({ officialStep, recoverOfficialStep, editFilmFile, planFilm, authorFilmFile });
    const original = h.get();
    await h.start(); await h.idle();
    expect(h.get().productionRun).toMatchObject({ authoringVersion: 4, status: 'failed' });
    expect(h.get().productionRun!.message).toContain('LEMO_AGENT_NOT_READY');
    expect(officialStep.mock.calls.map(([, node]) => node.id)).toEqual(['official-treatment', 'official-style-frame', 'official-voice-lock', 'official-authoring']);
    expect(h.get().productionRun!.nodes.find(n => n.id === 'official-ready')!.status).toBe('failed');
    expect(h.calls).not.toContain('render');
    for (const operation of [editFilmFile, planFilm, authorFilmFile]) expect(operation).not.toHaveBeenCalled();
    expect(h.get().sourceText).toBe(original.sourceText); expect(h.get().creativeFilms).toEqual(original.creativeFilms);
  });
  it('keeps an interrupted official request unknown without reissuing it or using old edit providers', async () => {
    const officialStep = vi.fn(async (document: EditorialCollagePipelineData, node: { id: string }) => {
      if (node.id === 'official-authoring') throw new LlmTextInterruptedError(response(announcement), new Error('offline interruption'));
      return document;
    });
    const recoverOfficialStep = vi.fn(async () => undefined), editFilmFile = vi.fn(), planFilm = vi.fn();
    const h = nativeHarness({ officialStep, recoverOfficialStep, editFilmFile, planFilm });
    await h.start(); await h.idle(); const d = h.get();
    expect(d.productionRun!.nodes.find(n => n.id === 'official-authoring')).toMatchObject({ status: 'unknown', attempt: 1 });
    await h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'reconcile' });
    await expect(h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'resume' })).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    expect(officialStep.mock.calls.map(([, node]) => node.id)).toEqual(['official-treatment', 'official-style-frame', 'official-voice-lock', 'official-authoring']);
    expect(editFilmFile).not.toHaveBeenCalled(); expect(planFilm).not.toHaveBeenCalled();
    expect(h.get().productionRun!.nodes.find(n => n.id === 'official-authoring')!.requestId).toBe(d.productionRun!.nodes.find(n => n.id === 'official-authoring')!.requestId);
  });
});
