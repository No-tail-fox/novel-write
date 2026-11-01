import { describe, expect, it, vi } from 'vitest';
import { nativeHarness } from './lemo-native.fixture';
import { LEMO_EDIT_MAX_ROUNDS } from '../src/shared/creative-animation/lemo-edits';

const sourceFor = (id: string) => id === 'shared' ? 'return {};' : id === 'director'
  ? 'return {render(t){scenes["scene-1"].render(t);},texts(t){return scenes["scene-1"].texts(t);}};'
  : 'const iconSize=18; const titleSize=17; return {render(){},texts(){return []}};';
const reply = (p: any, edits: Array<{ search: string; replace: string }>) => {
  const text = JSON.stringify({ baseHash: p.batch.baseHash, edits, done: true, summary: 'Address only the measured layout issue.' });
  return { text, raw: text, requestId: 'offline-repair', finishReason: 'stop' };
};
const activeFilm = (d: ReturnType<ReturnType<typeof nativeHarness>['get']>) => d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!;

describe('incremental browser repair continuation', () => {
  it.each([false, true])('reopens residual issues without replaying successful requests (sample=%s)', async sample => {
    const edit = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      if (!p.batch.source) return reply(p, [{ search: '', replace: sourceFor(p.file.id) }]);
      if (p.batch.repair && p.file.id === 'scene-1') return reply(p, [p.batch.source.includes('iconSize=18')
        ? { search: 'iconSize=18', replace: 'iconSize=24' } : { search: 'titleSize=17', replace: 'titleSize=24' }]);
      return reply(p, []);
    });
    const h = nativeHarness({ editFilmFile: edit, previewCode: async d => {
      const film = activeFilm(d);
      if (sample || film.source.includes('director=await')) {
        const source = film.project!.files.find(f => f.id === 'scene-1')!.source;
        if (source.includes('iconSize=18')) throw Error('CREATIVE_LAYOUT: icon 18px');
        if (source.includes('titleSize=17')) throw Error('CREATIVE_LAYOUT: title 17px');
      }
      return ['offline-layout-frame.jpg'];
    } });
    const originalText = h.get().sourceText;
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    const repairs = edit.mock.calls.map(([p]) => JSON.parse(p)).filter(p => p.batch.repair);
    if (!sample) expect(activeFilm(h.get()).project!.editSessions?.['film-sample-repair:scene-1']).toBeUndefined();
    const sceneRepairs = repairs.filter(p => p.file.id === 'scene-1');
    expect(sceneRepairs.map(p => [p.file.id, p.batch.round])).toEqual([['scene-1', 1], ['scene-1', 2]]);
    expect(sceneRepairs[1].batch.diagnostic).toContain('title 17px');
    expect(sceneRepairs[1].batch.diagnostic).toContain('shotId=');
    expect(sceneRepairs[1].batch.diagnostic).toContain('sceneFile=scene-1');
    expect(sceneRepairs[1].batch.diagnostic).toContain('absoluteStartMs=');
    expect(sceneRepairs[1].batch.diagnostic).toContain('绝对时间=absoluteStartMs+采样时间');
    const prefix = sample ? 'film-sample-repair:' : 'film-repair:';
    expect(activeFilm(h.get()).project!.editSessions?.[prefix + 'scene-1']).toMatchObject({done: true, rounds: 2});
    const attempts = activeFilm(h.get()).project!.files.find(f => f.id === 'scene-1')!.attempts;
    expect(attempts.filter(a => a.editNodeId?.startsWith(prefix)).every(a => a.applied)).toBe(true);
    expect(new Set(attempts.map(a => a.requestId)).size).toBe(attempts.length);
    expect(h.get().sourceText).toBe(originalText);
    expect(h.errors).toEqual([]);
  });

  it('does not spin paid repair calls when an accepted patch changes nothing', async () => {
    const edit = vi.fn(async (prompt: string) => { const p = JSON.parse(prompt); return reply(p, p.batch.source ? [] : [{ search: '', replace: sourceFor(p.file.id) }]); });
    const h = nativeHarness({ editFilmFile: edit, previewCode: async d => {
      if (activeFilm(d).source.includes('director=await')) throw Error('CREATIVE_LAYOUT: unchanged measured failure');
      return ['offline-layout-frame.jpg'];
    } });
    const originalText = h.get().sourceText;
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed');
    const repairs = edit.mock.calls.map(([p]) => JSON.parse(p)).filter(p => p.batch.repair);
    expect(repairs.filter(p => p.file.id === 'scene-1')).toHaveLength(1);
    expect(repairs.every(p => p.batch.round === 1)).toBe(true);
    expect(h.get().sourceText).toBe(originalText);
  });

  it('stops at the existing per-file limit even if each patch changes source', async () => {
    const edit = vi.fn(async (prompt: string) => { const p = JSON.parse(prompt); return reply(p, !p.batch.source
      ? [{ search: '', replace: sourceFor(p.file.id) }]
      : p.file.id === 'scene-1' ? [{ search: 'const iconSize=', replace: '/* repair */ const iconSize=' }] : []); });
    const h = nativeHarness({ editFilmFile: edit, previewCode: async d => {
      if (activeFilm(d).source.includes('director=await')) throw Error('CREATIVE_LAYOUT: unresolved measured failure');
      return ['offline-layout-frame.jpg'];
    } });
    const originalText = h.get().sourceText;
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed');
    expect(edit.mock.calls.map(([p]) => JSON.parse(p)).filter(p => p.batch.repair && p.file.id === 'scene-1')).toHaveLength(LEMO_EDIT_MAX_ROUNDS);
    expect(h.get().sourceText).toBe(originalText);
  });
});

it('routes clipped cached typography back to shared drawing helpers during full-film repair',async()=>{
 const edit=vi.fn(async(prompt:string)=>{
  const p=JSON.parse(prompt);
  if(!p.batch.source)return reply(p,[{search:'',replace:p.file.id==='shared'?'const clipped=true; return {};':sourceFor(p.file.id)}]);
  if(p.batch.repair&&p.file.id==='shared')return reply(p,[{search:'clipped=true',replace:'clipped=false'}]);
  return reply(p,[]);
 });
 const h=nativeHarness({editFilmFile:edit,previewCode:async d=>{
  const film=activeFilm(d);
  if(film.source.includes('director=await')&&film.project!.files.find(f=>f.id==='shared')!.source.includes('clipped=true'))
   throw Error('CREATIVE_LAYOUT: LEMO_TEXT_CLIPPED: cached title exceeds texture');
  return ['offline-frame.jpg'];
 }});
 await h.start();await h.idle();
 expect(h.get().productionRun?.status,h.get().productionRun?.message).toBe('completed');
 expect(edit.mock.calls.map(([p])=>JSON.parse(p)).some(p=>p.batch.repair&&p.file.id==='shared')).toBe(true);
});

