import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLemoUpstreamRenderCacheDir, resolveLemoUpstreamRenderRuntime, stageLemoUpstreamRenderRoot, type LemoUpstreamRenderRuntime } from '../electron/lemo-upstream-video';
import { piFilmReadcheckInternals, runPiFilmReadcheck } from '../electron/pi-film-readcheck';
const roots: string[] = [];
async function temp() { const root = await mkdtemp(join(tmpdir(), 'film-readcheck-test-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
let runtime: LemoUpstreamRenderRuntime, upstreamRoot: string;
beforeAll(async () => {
  const cacheDir = defaultLemoUpstreamRenderCacheDir();
  runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: 'vendor/python', cacheDir });
  upstreamRoot = await stageLemoUpstreamRenderRoot({ upstreamRoot: 'vendor/lemo-upstream', threeRoot: 'node_modules/three', playwrightCorePath: runtime.playwrightCorePath, cacheDir });
}, 90_000);
const base = () => ({ runtime, upstreamRoot, filmDir: '', durationSeconds: 3, fps: 10, width: 480, height: 270, captionMode: 'film' as const, cues: [{ id: 'a', text: 'Narration', startSeconds: .5, endSeconds: 1.5 }], timeoutMs: 90_000 });
async function fixture(source: string) {
  const filmDir = await temp();
  await writeFile(join(filmDir, 'index.html'), `<!doctype html><meta charset="utf-8"><div id="text"></div><script>window.DUR=3;window.READY=true;let rendered=-1;const box=(id,text)=>({id,text,x0:10,y0:10,x1:200,y1:40});window.render=async t=>{await new Promise(r=>setTimeout(r,0));rendered=t;document.getElementById('text').textContent=String(t)};${source}</script>`, 'utf8');
  return filmDir;
}
const captions = `new URLSearchParams(location.search).get('captions')==='1' && t>=.5 && t<1.5 ? [box('cap:a','Narration')] : []`;
describe('trusted full-film readcheck using real upstream openDemo (no paid services)', () => {
  it('awaits every rendered frame, records full canonical text, and validates caption windows', async () => {
    const filmDir = await fixture(`window.TEXTS=t=>{if(rendered!==t)throw Error('not awaited');return [box('title','Title'),...(${captions})]};`);
    const result = await runPiFilmReadcheck({ ...base(), filmDir });
    expect(result.errors).toEqual([]); expect(result.readingPassed).toBe(true);
    expect(result.modes.map(m => m.sampledFrames)).toEqual([30, 30]);
    expect(result.modes[0].texts.find(t => t.id === 'title')).toMatchObject({ text: 'Title', observedFrames: 30, requiredSeconds: 1.5 + 5 / 15, intervals: [{ startSeconds: 0, endSeconds: 3, frames: 30 }] });
    expect(result.modes[1].captionFrames).toBe(0);
  }, 90_000);
  it('fails a too-short title despite correct captions', async () => {
    const filmDir = await fixture(`window.TEXTS=t=>[...(t<.2?[box('title','Title')]:[]),...(${captions})];`);
    const result = await runPiFilmReadcheck({ ...base(), filmDir });
    expect(result.readingPassed).toBe(false); expect(result.errors.some(e => e.code === 'READING_TOO_SHORT')).toBe(true);
  }, 90_000);
  it('allows caption-only only after both complete mode checks prove exact cue coverage', async () => {
    const filmDir = await fixture(`window.TEXTS=t=>(${captions});`);
    const result = await runPiFilmReadcheck({ ...base(), filmDir });
    expect(result.errors).toEqual([]); expect(result.readingPassed).toBe(true);
    expect(result.evidenceReason).toBe('CAPTION_ONLY_FULL_FILM_COVERAGE_PROVEN');
  }, 90_000);
  it('rejects incorrect text, late cue windows and captions ignoring query off', async () => {
    for (const expression of [captions.replace("'Narration'", "'Wrong'"), captions.replace('t>=.5', 't>=.9'), "t>=.5&&t<1.5?[box('cap:a','Narration')]:[]"]) {
      const filmDir = await fixture(`window.TEXTS=t=>[box('title','Title'),...(${expression})];`);
      const result = await runPiFilmReadcheck({ ...base(), filmDir });
      expect(result.readingPassed).toBe(false);
      expect(result.errors.some(e => ['CAPTION_TEXT_MISMATCH', 'CAPTION_WINDOW_MISMATCH', 'CAPTION_NOT_SUPPRESSED'].includes(e.code))).toBe(true);
    }
  }, 90_000);
  it('host mode suppresses all page captions and empty/missing TEXTS cannot pass', async () => {
    const filmDir = await fixture(`window.TEXTS=t=>[box('title','Title'),...(${captions})];`);
    const result = await runPiFilmReadcheck({ ...base(), filmDir, captionMode: 'host' });
    expect(result.readingPassed).toBe(true); expect(result.modes.map(m => m.captions)).toEqual([0]);
    for (const source of ['', 'window.TEXTS=()=>[]']) {
      const result = await runPiFilmReadcheck({ ...base(), filmDir: await fixture(source), captionMode: 'host' });
      expect(result.readingPassed).toBe(false);
      expect(result.errors.some(e => e.code === 'NO_NONCAPTION_TEXT_WITHOUT_PROVEN_CAPTION_COVERAGE')).toBe(true);
    }
  }, 90_000);
  it('checks CJK rate and every-frame safe areas', async () => {
    const filmDir = await fixture(`window.TEXTS=t=>[{...box('title','中文测试标题文字'),x0:t===1.1?-1:10}];`);
    const result = await runPiFilmReadcheck({ ...base(), filmDir, captionMode: 'host' });
    expect(result.readingPassed).toBe(false);
    expect(result.modes[0].texts[0].requiredSeconds).toBe(8 / 4.5 + 1.5);
    expect(result.errors.some(e => e.code === 'OUTSIDE_FRAME')).toBe(true);
  }, 90_000);
  it('kills timed out and cancelled trees and removes private scratch', async () => {
    const filmDir = await fixture('window.render=()=>new Promise(()=>{});'), scratchDir = await temp();
    await expect(runPiFilmReadcheck({ ...base(), filmDir, scratchDir, timeoutMs: 1000 })).rejects.toThrow('TIMEOUT');
    expect(await readdir(scratchDir)).toEqual([]);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('cancel-readcheck')), 1000);
    try { await expect(runPiFilmReadcheck({ ...base(), filmDir, scratchDir, signal: controller.signal })).rejects.toThrow('cancel-readcheck'); }
    finally { clearTimeout(timer); }
    expect(await readdir(scratchDir)).toEqual([]);
  }, 30_000);
  it('bounds duration, fps and cue arrays before spawning', () => {
    const valid = { ...base(), filmDir: 'film' };
    expect(() => piFilmReadcheckInternals.validate({ ...valid, durationSeconds: 198 })).not.toThrow();
    expect(() => piFilmReadcheckInternals.validate({ ...valid, durationSeconds: 198.001 })).toThrow('DURATION_INVALID');
    expect(() => piFilmReadcheckInternals.validate({ ...valid, fps: 61 })).toThrow('FPS_INVALID');
    expect(() => piFilmReadcheckInternals.validate({ ...valid, cues: Array(513).fill(valid.cues[0]) })).toThrow('CUE_LIMIT');
  });
});
