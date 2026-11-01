import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { nativeHarness, nativeSettings } from './lemo-native.fixture';
import { applyLemoEdits, LEMO_EDIT_MAX_ROUNDS } from '../src/shared/creative-animation/lemo-edits';
import { VoxProductionService } from '../electron/vox-production-service';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import type { LlmTextResult } from '../src/shared/llm-provider';
import { lemoEditReference, loadCreativeStyleReference } from '../electron/creative-style-references';
import { join } from 'node:path';

const sourceFor = (id: string) => id === 'shared' ? 'return {calls: []};' : id === 'director'
  ? 'return {render(t){for(const s of Object.values(scenes)) s.render(t);},texts(t){return Object.values(scenes).flatMap(s=>s.texts(t));}};'
  : 'return {render(t){shared.calls.push(t);},texts(t){return [];}};';
const result = (text: string, extra: Partial<LlmTextResult> = {}): LlmTextResult => ({ text, raw: text, requestId: 'offline-provider', finishReason: 'stop', ...extra });
const reply = (prompt: string, done = true, suffix = '') => {
  const p = JSON.parse(prompt);
  return result(JSON.stringify({ baseHash: p.batch.baseHash, edits: p.batch.source ? (suffix ? [{ search: 'return {', replace: suffix + 'return {' }] : []) : [{ search: '', replace: sourceFor(p.file.id) }], done, summary: '完成本批绘图实现' }));
};
const film = (h: ReturnType<typeof nativeHarness>) => h.get().creativeFilms!.find(f => f.id === h.get().productionRun!.filmId)!;
const resume = async (h: ReturnType<typeof nativeHarness>, service = h.service) => { await service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' }); await service.idle(h.get().id); };
const finished = (h: ReturnType<typeof nativeHarness>) => expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');

describe('bounded exact-source edit transactions', () => {
  const source = 'const palette={ink:1}; return {palette};';
  const hash = createHash('sha256').update(source).digest('hex');
  const patch = (edits: {search:string;replace:string}[], baseHash = hash) => JSON.stringify({ baseHash, edits, done: true, summary: '调整色板' });
  it('extracts one complete fenced JSON reply without changing embedded code strings', () => {
    const json = patch([{ search: 'ink:1', replace: 'ink:2' }]);
    const fenced = 'Batch explanation.\n\n```json\n' + json + '\n```\nCompleted this batch.';
    expect(applyLemoEdits(source, hash, fenced).source).toBe('const palette={ink:2}; return {palette};');
    expect(() => applyLemoEdits(source, hash, fenced + '\n```json\n' + json + '\n```')).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n```json\n' + json)).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n```json\n' + json.slice(0, -2) + '\n```')).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n' + json)).toThrow('LEMO_EDIT_INVALID');
  });
  it('applies ordered unique edits and checks the saved base hash', () => {
    expect(applyLemoEdits(source, hash, patch([{ search: 'ink:1', replace: 'ink:2' }])).source).toContain('ink:2');
    expect(() => applyLemoEdits(source, hash, patch([{ search: 'ink:1', replace: 'ink:2' }], '0'.repeat(64)))).toThrow('LEMO_EDIT_STALE');
  });
  it.each([
    [{ search: 'palette', replace: 'p' }], [{ search: 'missing', replace: 'p' }], [{ search: '', replace: 'p' }], [{ search: 'ink:1', replace: 'ink:1' }],
  ])('rejects missing, ambiguous, empty and no-op searches %#', (...edits) => {
    expect(() => applyLemoEdits(source, hash, patch(edits))).toThrow('LEMO_EDIT_');
  });
  it('reports an oversized replacement as a size failure with the actual limit, rather than malformed JSON', () => {
    const atLimit = '/*' + 'x'.repeat(15986) + '*/return {};';
    expect(atLimit).toHaveLength(16000);
    expect(applyLemoEdits('', hash, patch([{ search: '', replace: atLimit }])).source).toBe(atLimit);
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: atLimit + ' ' }]))).toThrow('16001 字符');
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: atLimit + ' ' }]))).toThrow('16000 字符限制');
  });
  it('limits reply size and permits an empty insertion only for a new file', () => {
    expect(applyLemoEdits('', hash, patch([{ search: '', replace: 'return {};' }])).source).toBe('return {};');
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: 'x'.repeat(16001) }]))).toThrow('LEMO_EDIT_SIZE');
    expect(() => applyLemoEdits(source, hash, '{')).toThrow('LEMO_EDIT_INVALID');
  });
});

describe('durable incremental Lemo authoring', () => {
  it('preserves a reply longer than 90000 characters through production checkpoint serialization', async () => {
    const summary = '  保留完整创作说明'.repeat(10000) + '  ';
    const rawByFile = new Map<string, string>();
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      const raw = JSON.stringify({ ...JSON.parse(reply(prompt).text), summary });
      expect(raw.length).toBeGreaterThan(90000);
      rawByFile.set(p.file.id, raw);
      return result(raw);
    });
    const h = nativeHarness({ editFilmFile });
    const original = h.get().sourceText;
    await h.start(); await h.idle(); finished(h);
    expect(h.get().sourceText).toBe(original);
    for (const file of film(h).project!.files) {
      expect(file.attempts.at(-1)).toMatchObject({ rawResponse: rawByFile.get(file.id), summary, applied: true });
      expect(file.source).toBe(sourceFor(file.id));
    }
  });
  it('revalidates a previously rejected completed receipt after upgrading the parser without paying again', async () => {
    const editFilmFile = vi.fn(async (prompt: string) => editFilmFile.mock.calls.length === 1 ? result('{') : reply(prompt));
    const h = nativeHarness({ editFilmFile }); await h.start(); await h.idle();
    expect(h.get().productionRun!.status).toBe('failed');
    const document = h.get();
    const saved = document.creativeFilms!.find(f => f.id === document.productionRun!.filmId)!.project!.files[0].attempts[0];
    const receipt = 'Batch explanation.\n```json\n' + reply(editFilmFile.mock.calls[0][0]).text + '\n```';
    // Simulate a persisted receipt rejected by the old parser, not a new model response.
    saved.rawResponse = receipt;
    h.set(document);
    await resume(h); finished(h);
    expect(editFilmFile.mock.calls.filter(([p]) => JSON.parse(p).file.id === 'shared')).toHaveLength(1);
    expect(film(h).project!.files[0].source).toBe(sourceFor('shared'));
    expect(film(h).project!.files[0].attempts.at(-1)).toMatchObject({ applied: true, rawResponse: receipt, reusedFromRequestId: saved.requestId });
  });
  it('saves and checkpoints every batch before requesting the next, with one final absolute clock', async () => {
    let h: ReturnType<typeof nativeHarness>;
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (p.file.id === 'shared' && p.batch.round === 1) return reply(prompt, false);
      if (p.file.id === 'shared') {
        expect(film(h).project!.files[0].source).toBe(sourceFor('shared'));
        const previous = h.get().productionRun!.nodes.find(n => n.id === 'film-code:shared:edit:1')!;
        expect(previous.status).toBe('completed'); expect(h.receipts.has(previous.requestId!)).toBe(true);
        return reply(prompt, true, 'const palette = {ink: 2}; ');
      }
      return reply(prompt);
    });
    const authorFilmFile = vi.fn(async () => result('unexpected'));
    h = nativeHarness({ editFilmFile, authorFilmFile }); await h.start(); await h.idle(); finished(h);
    expect(editFilmFile).toHaveBeenCalledTimes(4); expect(authorFilmFile).not.toHaveBeenCalled();
    expect(film(h).project!.editSessions?.['film-code:shared']).toEqual({ rounds: 2, done: true });
    expect(film(h).project!.files[0].source).toContain('const palette');
    expect(film(h).source.match(/window.render=/g)).toHaveLength(1);
    expect(h.get().productionRun!.nodes.filter(n => n.kind === 'film-edit').every(n => n.paid && n.status === 'completed')).toBe(true);
    expect(h.get().productionRun!.nodes.filter(n => ['film-code','film-scene','film-director'].includes(n.kind)).every(n => !n.paid)).toBe(true);
    const sharedPrompt = JSON.parse(editFilmFile.mock.calls[0][0]);
    expect(sharedPrompt.input.timeline.every((t: object) => !('cues' in t))).toBe(true);
    expect(sharedPrompt.batch.limits).toMatchObject({ preferredNewCodeChars: 6000, maxReplacementChars: 16000, maxCombinedEditChars: 24000 });
    expect(sharedPrompt.batchScope).toContain('one small drawing capability');
    expect(sharedPrompt.textLayout.minimumFontSizePx).toBe(24);
    expect(sharedPrompt.textLayout.units).toContain('after all scaling');
    const prompts = editFilmFile.mock.calls.map(c => JSON.parse(c[0]));
    const scenePrompt = prompts.find(p => p.file.kind === 'scene');
    const directorPrompt = prompts.find(p => p.file.kind === 'director');
    expect(directorPrompt.input.timeline).toEqual(scenePrompt.input.timeline);
    const suppliedCues = directorPrompt.input.timeline.flatMap((w: { cues: unknown[] }) => w.cues);
    expect(suppliedCues.length).toBeGreaterThan(0);
    expect(suppliedCues).toEqual(h.get().beats.flatMap(b => b.subtitleCues).map(c => ({ id: c.id, text: c.text, startMs: c.startMs, endMs: c.endMs, ...(c.tokens ? { tokens: c.tokens } : {}) })));
    expect(directorPrompt.captions.owner).toBe('scene');
    expect(directorPrompt.captions.cueIds).toContain('cues[].id');
    expect(directorPrompt.captions.director).toContain('Do not draw captions again');
    expect(directorPrompt.captions.director).toContain('filter out visible text metadata');
    expect(sharedPrompt.input.script).toBeUndefined(); expect(h.errors).toEqual([]);
  });
  it('retains good source when the second batch is invalid and retries only that batch after restart', async () => {
    let broken = true;
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (p.file.id === 'shared') return p.batch.round === 1 ? reply(prompt, false) : broken ? result('{') : reply(prompt, true, 'const added = 1; ');
      return reply(prompt);
    });
    const h = nativeHarness({ editFilmFile }); await h.start(); await h.idle();
    expect(film(h).project!.files[0]).toMatchObject({ source: sourceFor('shared'), status: 'valid' });
    expect(film(h).project!.files[0].attempts.at(-1)).toMatchObject({ applied: false, rawResponse: '{' });
    expect(h.get().productionRun!.nodes.find(n => n.id === 'film-code:shared:edit:2')!.status).toBe('failed');
    const restarted = new VoxProductionService(h.store, async () => h.runtime); await restarted.restore(); broken = false;
    await resume(h, restarted); finished(h);
    expect(editFilmFile.mock.calls.map(c => { const p = JSON.parse(c[0]); return [p.file.id, p.batch.round]; })).toEqual([['shared',1],['shared',2],['shared',2],['scene-1',1],['director',1]]);
  });
  it('returns the unapplied patch and precise factory-order failure to the retry without changing accepted source', async () => {
    let broken = true;
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (p.file.id !== 'shared') {
        expect(p.batch.lastRejectedBatch).toBeUndefined();
        return reply(prompt);
      }
      if (p.batch.round === 1) return reply(prompt, false);
      if (broken) return result(JSON.stringify({ baseHash: p.batch.baseHash, done: true,
        edits: [{ search: 'return {calls: []};', replace: 'return {calls: [], fields}; const fields={};' }], summary: 'add fields' }));
      expect(p.batch.source).toBe(sourceFor('shared'));
      expect(p.batch.lastRejectedBatch).toMatchObject({ applied: false, truncated: false });
      expect(p.batch.lastRejectedBatch.diagnostic).toContain('移到最终 return');
      expect(p.batch.lastRejectedBatch.responseExcerpt).toContain('const fields={}');
      expect(p.factoryOrder).toContain('BEFORE return');
      return reply(prompt, true, 'const fields = {}; ');
    });
    const h = nativeHarness({ editFilmFile }); await h.start(); await h.idle();
    expect(film(h).project!.files[0].source).toBe(sourceFor('shared'));
    expect(film(h).project!.files[0].attempts.at(-1)?.applied).toBe(false);
    broken = false; await resume(h); finished(h);
    expect(film(h).project!.files[0].source).toContain('const fields = {}; return');
    expect(editFilmFile.mock.calls.map(c => { const p = JSON.parse(c[0]); return [p.file.id, p.batch.round]; }))
      .toEqual([['shared',1],['shared',2],['shared',2],['scene-1',1],['director',1]]);
  });
  it('rechecks retained source after an empty repair reply through the normal control and resumes without reauthoring', async () => {
    let hostBroken = true;
    const editFilmFile = vi.fn(async (prompt: string) => JSON.parse(prompt).batch.repair
      ? result('', { finishReason: 'stop', usage: { completion_tokens: 32768 } }) : reply(prompt));
    const previewCode = vi.fn(async () => {
      if (hostBroken) throw new Error('CREATIVE_CONTENT: host subtitle boundary failure');
      return ['browser-reviewed.jpg'];
    });
    const h = nativeHarness({ editFilmFile, previewCode });
    await h.start(); await h.idle();
    expect(h.get().productionRun!.status).toBe('failed');
    expect(h.get().productionRun!.message).toContain('LEMO_EDIT_EMPTY_RESPONSE');
    const project = film(h).project!;
    expect(project.files[0]).toMatchObject({ source: sourceFor('shared'), status: 'valid' });
    expect(project.files[0].attempts.at(-1)).toMatchObject({ applied: false, rawResponse: '' });
    const paidCalls = editFilmFile.mock.calls.length;
    const control = { id: h.get().id, runId: h.get().productionRun!.id, action: 'recheck-code' as const };
    await expect(h.service.control(control)).rejects.toThrow('LEMO_PROJECT_FAILED');
    expect(editFilmFile).toHaveBeenCalledTimes(paidCalls);
    hostBroken = false;
    await h.service.control(control);
    expect(h.get().productionRun!.status).toBe('paused');
    expect(film(h).project!.repairFileIds).toEqual([]);
    expect(film(h).project!.files.map(f => [f.source, f.attempts])).toEqual(project.files.map(f => [f.source, f.attempts]));
    expect(editFilmFile).toHaveBeenCalledTimes(paidCalls);
    await resume(h); finished(h);
    expect(editFilmFile.mock.calls.slice(paidCalls).map(c => JSON.parse(c[0]).file.id)).toEqual(['director']);
    expect(h.get().productionRun!.nodes.filter(n => ['failed', 'unknown'].includes(n.status))).toEqual([]);
  });
  it('recovers an accepted batch from its receipt after a document save fails, without another paid request', async () => {
    const editFilmFile = vi.fn(async (prompt:string) => reply(prompt, JSON.parse(prompt).file.id !== 'shared' || JSON.parse(prompt).batch.round > 1));
    const h = nativeHarness({ editFilmFile }); const save = h.store.save; let broken = true;
    h.store.save = async d => {
      if (broken && d.productionRun?.nodes.some(n => n.id === 'film-code:shared:edit:1' && n.status === 'completed')) { broken = false; throw new Error('offline save interrupted'); }
      return save(d);
    };
    await h.start(); await h.idle();
    expect(h.get().productionRun!.nodes.find(n=>n.id==='film-code:shared:edit:1')!.status).toBe('unknown');
    expect(film(h).project!.files[0].source).toBe('');
    await h.service.control({ id:h.get().id, runId:h.get().productionRun!.id, action:'reconcile' });
    expect(film(h).project!.files[0].source).toBe(sourceFor('shared'));
    await resume(h); finished(h); expect(editFilmFile).toHaveBeenCalledTimes(4);
  });
  it('keeps the sample gate ahead of later scene requests and supplies only owned cue windows', async () => {
    const initial = nativeHarness().get(), shot = initial.beats[0].shots[0];
    initial.beats = [initial.beats[0]]; initial.beats[0].shots = Array.from({length:17},(_,i)=>({...structuredClone(shot),id:'shot-'+i,subtitleCueIds:[]}));
    initial.beats[0].subtitleCues=[]; initial.beats[0].durationMs=shot.durationMs*17;
    const editFilmFile = vi.fn(async (prompt:string)=>reply(prompt));
    const h = nativeHarness({ editFilmFile, previewCode:async()=>{throw new Error('CREATIVE_CONTENT: subtitle missing');} }, initial);
    await h.start(); await h.idle();
    const prompts = editFilmFile.mock.calls.map(c=>JSON.parse(c[0]));
    expect(prompts.map(p=>p.file.id)).toEqual(['shared','scene-1','shared','scene-1']);
    expect(prompts.find(p=>p.file.id==='scene-1').input.timeline.map((w:{id:string})=>w.id)).toEqual(Array.from({length:8},(_,i)=>'shot-'+i));
    expect(h.get().productionRun!.nodes.find(n=>n.id==='film-scene:scene-2:edit:1')!.status).toBe('pending');
  });
  it('pauses between saved batches and resumes without replaying the first request', async () => {
    let h: ReturnType<typeof nativeHarness>;
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (p.file.id === 'shared' && p.batch.round === 1) {
        await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'pause' }); return reply(prompt, false);
      }
      return reply(prompt);
    });
    h = nativeHarness({ editFilmFile }); await h.start(); await h.idle();
    expect(h.get().productionRun!.status).toBe('paused'); expect(editFilmFile).toHaveBeenCalledTimes(1);
    expect(film(h).project!.files[0].source).toBe(sourceFor('shared'));
    await resume(h); finished(h); expect(editFilmFile).toHaveBeenCalledTimes(4);
  });
  it.each(['syntax','truncated','empty'])('rejects %s edits without replacing saved valid code', async failure => {
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt); if (p.batch.round === 1) return reply(prompt, false);
      if (failure === 'empty') return result('', { finishReason: 'stop', usage: { completion_tokens: 32768 } });
      return failure === 'truncated' ? result('{', { finishReason: 'length', usage: { completion_tokens: 12000 } }) : result(JSON.stringify({ baseHash: p.batch.baseHash, edits: [{ search: p.batch.source, replace: 'return {' }], done: true, summary: 'invalid' }));
    });
    const h = nativeHarness({ editFilmFile }); await h.start(); await h.idle();
    expect(h.get().productionRun!.nodes.find(n => n.id.endsWith(':edit:2'))!.status).toBe('failed');
    expect(film(h).project!.files[0].source).toBe(sourceFor('shared')); expect(film(h).project!.editSessions?.['film-code:shared'].rounds).toBe(1);
  });
  it('retains interrupted raw deltas, preserves prior source and requires explicit retry of the unknown batch', async () => {
    let disconnected = true;
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (p.file.id === 'shared' && p.batch.round === 1) return reply(prompt, false);
      if (p.file.id === 'shared' && disconnected) throw new LlmTextInterruptedError(result('{"baseHash":', { requestId: 'ambiguous', finishReason: undefined }), new Error('socket closed'));
      return reply(prompt);
    });
    const h = nativeHarness({ editFilmFile }); await h.start(); await h.idle();
    const nodeId = 'film-code:shared:edit:2';
    expect(h.get().productionRun!.nodes.find(n => n.id === nodeId)!.status).toBe('unknown');
    expect(film(h).project!.files[0].attempts.at(-1)).toMatchObject({ interrupted: true, applied: false, rawResponse: '{"baseHash":', providerRequestId: 'ambiguous' });
    await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'reconcile' });
    await expect(resume(h)).rejects.toThrow('VOX_PRODUCTION_UNKNOWN'); expect(editFilmFile).toHaveBeenCalledTimes(2);
    disconnected = false; await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'retry-unknown', nodeId }); await h.idle(); finished(h);
    expect(editFilmFile).toHaveBeenCalledTimes(5);
  });
  it('bounds paid batches and saves the latest valid source when the model never finishes', async () => {
    const editFilmFile = vi.fn(async (prompt: string) => reply(prompt, false, JSON.parse(prompt).batch.source ? 'const batch' + JSON.parse(prompt).batch.round + '=1; ' : ''));
    const h = nativeHarness({ editFilmFile }); await h.start(); await h.idle();
    expect(editFilmFile).toHaveBeenCalledTimes(LEMO_EDIT_MAX_ROUNDS);
    expect(h.get().productionRun!.message).toContain('LEMO_EDIT_LIMIT');
    expect(film(h).project!.files[0].status).toBe('valid'); expect(film(h).project!.editSessions?.['film-code:shared'].rounds).toBe(16);
  });
  it('repairs the existing files, preserves finished sessions, and automatically continues new batches after failed recheck', async () => {
    const editFilmFile = vi.fn(async (prompt: string) => reply(prompt, true, JSON.parse(prompt).batch.repair ? '/*repair round ' + JSON.parse(prompt).batch.round + '*/ ' : ''));
    const h = nativeHarness({ editFilmFile, previewCode: async d => {
      const shared = d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!.project!.files.find(f => f.id === 'shared')!;
      // A residual browser error must schedule the second repair without manual resume.
      if (!shared.source.includes('repair round 2')) throw new Error('CREATIVE_CONTENT: title missing');
      return ['frame.jpg'];
    } });
    await h.start(); await h.idle(); finished(h);
    const shared = editFilmFile.mock.calls.map(c=>JSON.parse(c[0])).filter(p=>p.file.id==='shared');
    expect(shared.map(p=>[p.batch.repair,p.batch.round])).toEqual([[false,1],[true,1],[true,2]]);
    expect(shared[1].batch.source).toBe(sourceFor('shared')); expect(shared[2].batch.source).toContain('repair round 1');
    expect(film(h).project!.repairFileIds).toEqual([]); expect(h.errors).toEqual([]);
  });
  it('keeps old project tasks on their existing whole-file path', async () => {
    let broken = true;
    const authorFilmFile = vi.fn(async (_p:string,_s:string,id:string) => result(sourceFor(id), { finishReason: broken ? 'length' : 'stop' }));
    const old = nativeHarness({ authorFilmFile }); await old.start(); await old.idle();
    expect(film(old).project!.authoringMode).toBeUndefined(); broken = false;
    const editFilmFile = vi.fn(async (prompt:string) => reply(prompt));
    const h = nativeHarness({ authorFilmFile, editFilmFile }, old.get()); await resume(h); finished(h);
    expect(editFilmFile).not.toHaveBeenCalled();
  });
  it('retains complete style and technique guidance without duplicating director guidance in every edit', async () => {
    const full = await loadCreativeStyleReference(join(process.cwd(),'vendor/lemo-opuscar'), 'watercolor', 'lemo-native-v1');
    const focused = lemoEditReference(full);
    expect(focused).toContain(full.match(/<style-reference[\s\S]*?<\/style-reference>/)![0]);
    expect(focused).toContain('<technique-reference>'); expect(focused).not.toContain('<director-reference>');
  });
});


describe('verify repaired code before another paid edit', () => {
  it.each(['sample', 'film'])('skips unrelated paid repairs after a shared fix passes %s browser review', async phase => {
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (p.batch.repair) {
        expect(p.file.id).toBe('shared');
        expect(p.batchScope).toContain('Repair only the diagnosed defect');
        return reply(prompt, true, '/* fixed-shared */ ');
      }
      return reply(prompt);
    });
    const previewCode = vi.fn(async (d: Parameters<NonNullable<import('../electron/vox-production-runtime').VoxProductionOperations['previewCode']>>[0]) => {
      const files = d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!.project!.files;
      const applicable = phase === 'sample' || files.find(f => f.id === 'director')!.status === 'valid';
      if (applicable && !files.find(f => f.id === 'shared')!.source.includes('fixed-shared')) throw Error('LEMO_CANVAS_STATE: shared helper omitted restore');
      return ['verified.jpg'];
    });
    const h = nativeHarness({ editFilmFile, previewCode });
    await h.start(); await h.idle(); finished(h);
    const repairs = editFilmFile.mock.calls.map(c => JSON.parse(c[0])).filter(p => p.batch.repair);
    expect(repairs.map(p => p.file.id)).toEqual(['shared']);
    expect(film(h).project!.repairFileIds).toEqual([]);
    expect(h.calls).toContain('render'); expect(h.calls).toContain('verify');
    expect(film(h).project!.files.find(f => f.id === 'scene-1')!.source).toBe(sourceFor('scene-1'));
    expect(film(h).project!.files.find(f => f.id === 'director')!.source).toBe(sourceFor('director'));
  });
  it('uses the fresh diagnostic and accepted upstream repair when another file still fails', async () => {
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (p.batch.repair && p.file.id === 'scene-1') {
        expect(p.batch.diagnostic).toContain('remaining scene caption');
        expect(p.repairContext.acceptedFiles).toEqual([expect.objectContaining({ id: 'shared', summary: '完成本批绘图实现' })]);
        expect(p.sharedSource).toContain('fixed-shared');
        expect(p.repairContext.instruction).toContain('do not clone or replace a shared helper');
      }
      return reply(prompt, true, p.batch.repair ? '/* fixed-' + p.file.id + ' */ ' : '');
    });
    const h = nativeHarness({ editFilmFile, previewCode: async d => {
      const files = d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!.project!.files;
      if (!files.find(f => f.id === 'shared')!.source.includes('fixed-shared')) throw Error('LEMO_CANVAS_STATE: shared helper omitted restore');
      if (!files.find(f => f.id === 'scene-1')!.source.includes('fixed-scene-1')) throw Error('CREATIVE_CONTENT: remaining scene caption');
      return ['verified.jpg'];
    } });
    await h.start(); await h.idle(); finished(h);
    expect(editFilmFile.mock.calls.map(c => JSON.parse(c[0])).filter(p => p.batch.repair).map(p => p.file.id)).toEqual(['shared', 'scene-1']);
    expect(film(h).project!.repairFileIds).toEqual([]);
  });
});
