import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLemoUpstreamRenderCacheDir, resolveLemoUpstreamRenderRuntime, stageLemoUpstreamRenderRoot, type LemoUpstreamRenderRuntime } from '../electron/lemo-upstream-video';
import { lemoPageProbeInternals, probeLemoPage } from '../electron/pi-lemo-page-probe';

const roots: string[] = [];
async function temp() { const root = await mkdtemp(join(tmpdir(), 'lemo-probe-test-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
let runtime: LemoUpstreamRenderRuntime, upstreamRoot: string;
beforeAll(async () => {
  const cacheDir = defaultLemoUpstreamRenderCacheDir();
  runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: 'vendor/python', cacheDir });
  upstreamRoot = await stageLemoUpstreamRenderRoot({ upstreamRoot: 'vendor/lemo-upstream', threeRoot: 'node_modules/three', playwrightCorePath: runtime.playwrightCorePath, cacheDir });
}, 90_000);
const base = () => ({ runtime, upstreamRoot, filmDir: 'tests/fixtures/lemo-preview', durationSeconds: 2, fps: 24, width: 480, height: 270, times: [0, 0.5], timeoutMs: 90_000 });
async function fixture(source: string) {
  const filmDir = await temp();
  await writeFile(join(filmDir, 'index.html'), `<!doctype html><script>window.DUR=2;window.READY=true;window.render=()=>{};${source}</script>`, 'utf8');
  return filmDir;
}
describe('real bundled upstream page probe (no paid services)', () => {
  it('observes the existing preview fixture separately in both caption modes', async () => {
    const scratchDir = await temp();
    const result = await probeLemoPage({ ...base(), scratchDir });
    expect(result.errors).toEqual([]);
    expect(result.technicalPassed).toBe(true);
    expect(result.textEvidenceComplete).toBe(false);
    expect(result.modes.map(mode => mode.captions)).toEqual([1, 0]);
    for (const mode of result.modes) for (const sample of mode.samples) {
      expect(sample).toMatchObject({ ready: true, durationSeconds: 2, fontsReady: true, textsPresent: false, eventsPresent: false });
    }
    expect(await readdir(scratchDir)).toEqual([]);
  }, 90_000);
  it('captures real numeric text IDs, pixel boxes and finite event clocks', async () => {
    const filmDir = await fixture(`window.TEXTS=t=>[{id:7,text:location.search,x0:t,y0:2,x1:100,y1:40}];window.EV=[{t:.25,type:'cue',ignored:'payload'}];`);
    const result = await probeLemoPage({ ...base(), filmDir });
    expect(result.errors).toEqual([]);
    expect(result.textEvidenceComplete).toBe(true);
    expect(result.modes[0].samples[1].texts[0]).toEqual({ id: 7, text: '?captions=1', x0: .5, y0: 2, x1: 100, y1: 40 });
    expect(result.modes[1].samples[0].texts[0].text).toBe('?captions=0');
    expect(result.modes[0].samples[0].events).toEqual([{ t: .25, type: 'cue' }]);
  }, 90_000);
  it('rejects actual duration mismatch, malformed TEXTS, nonfinite EV and failed fonts', async () => {
    const filmDir = await fixture(`window.DUR=3;window.TEXTS=()=>[{id:'bad',text:'bad',x:1,y:2,width:3,height:4}];window.EV=[{t:Infinity,type:'cue'}];const f=new FontFace('Broken','url(/missing-font.woff2)');document.fonts.add(f);window.READY=false;f.load().catch(()=>{}).finally(()=>window.READY=true);`);
    const result = await probeLemoPage({ ...base(), filmDir });
    expect(result.technicalPassed).toBe(false);
    for (const code of ['DURATION_MISMATCH', 'TEXTS_SHAPE', 'EV_SHAPE', 'FONT_LOAD_FAILED']) expect(result.errors.some(e => e.includes(code))).toBe(true);
    expect(result.textEvidenceComplete).toBe(false);
  }, 90_000);
  it('accepts a duration within one frame', async () => {
    const result = await probeLemoPage({ ...base(), durationSeconds: 2 + 1 / 24, times: [0] });
    expect(result.errors).toEqual([]);
  }, 90_000);
  it('terminates timed out and cancelled process trees and removes scratch', async () => {
    const scratchDir = await temp();
    const filmDir = await fixture('window.READY=false;');
    await expect(probeLemoPage({ ...base(), filmDir, scratchDir, timeoutMs: 1000 })).rejects.toThrow('TIMEOUT');
    expect(await readdir(scratchDir)).toEqual([]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('cancel-probe')), 1000);
    try { await expect(probeLemoPage({ ...base(), filmDir, scratchDir, signal: controller.signal })).rejects.toThrow('cancel-probe'); }
    finally { clearTimeout(timer); }
    expect(await readdir(scratchDir)).toEqual([]);
  }, 30_000);
  it('bounds and validates host input before spawning', () => {
    expect(() => lemoPageProbeInternals.validate({ ...base(), times: [NaN] })).toThrow('TIME_INVALID');
    expect(() => lemoPageProbeInternals.validate({ ...base(), times: Array(65).fill(0) })).toThrow('TIME_INVALID');
    expect(() => lemoPageProbeInternals.validate({ ...base(), fps: Infinity })).toThrow('FPS_INVALID');
  });
});
