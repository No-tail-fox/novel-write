import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildVoxProductionNodes, voxProductionInputErrors, voxProductionEngine } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE, LEMO_FOLLOW_STYLE_SUBTITLES, lemoNativeMessages, lemoShotPreviewPath, resolveLemoAnimation } from '../src/shared/creative-animation/native-film';
import { nativeFrameHasArtwork } from '../src/shared/creative-animation/review';
import { coalesceDirectorNativeScenes } from '../src/shared/creative-animation/native-render';
import { buildVoxAnimationHtml, createVoxAnimation, validateVoxAnimation, type VoxAnimationPayload } from '../src/shared/vox-animation';
import { applyCreativeStyleToDocument } from '../src/shared/creative-animation/assemble';
import { CREATIVE_STYLES, resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import { loadCreativeStyleReference } from '../electron/creative-style-references';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { directorDocumentRenderFingerprint, type DirectorRenderScene } from '../src/shared/director-render';
import { directorVisualFps } from '../src/shared/production-visual-continuity';
import { voxInputHash } from '../electron/vox-production-service';
import { nativeDocument, nativeHarness, nativeHtml, nativeSettings } from './lemo-native.fixture';

const nodeByKind = (h: ReturnType<typeof nativeHarness>, kind: string) => h.get().productionRun!.nodes.find(n => n.kind === kind)!;
describe('native film directing contract', () => {
  it('uses the middle reviewed frame for the exact native shot and rejects stale or unrelated frames', () => {
    const animation = { native: { filmId: 'film' } } as any;
    const frames = ['review-900ms.jpg', 'review-0ms.jpg', 'review-450ms.jpg'].map(name => 'C:\\tasks\\request-shot-1\\' + name);
    const film = { id: 'film', status: 'reviewed', previewPaths: ['/tasks/request-shot-10/review-300ms.jpg', ...frames] } as any;
    expect(lemoShotPreviewPath(animation, 'shot-1', [film])).toBe(frames[2]);
    expect(lemoShotPreviewPath(animation, 'shot-10', [film])).toBe('/tasks/request-shot-10/review-300ms.jpg');
    expect(lemoShotPreviewPath(animation, 'shot-2', [film])).toBeUndefined();
    expect(lemoShotPreviewPath(animation, 'shot-1', [{ ...film, status: 'failed' }])).toBeUndefined();
    expect(lemoShotPreviewPath(animation, 'shot-1', [{ ...film, id: 'other' }])).toBeUndefined();
    expect(lemoShotPreviewPath(undefined, 'shot-1', [film])).toBeUndefined();
  });
  it('creates one continuous film by default, without per-shot template or image generation', () => {
    const d = nativeDocument(), settings = nativeSettings(), nodes = buildVoxProductionNodes(d, settings);
    for (const kind of ['plan', 'film-code', 'film-review', 'film-repair', 'film-finalize']) expect(nodes.filter(n => n.kind === kind)).toHaveLength(1);
    expect(nodes.some(n => ['image','cutout','animation','code'].includes(n.kind))).toBe(false);
    expect(nodes.every(n => n.dependencies.every(dep => nodes.findIndex(p => p.id === dep) < nodes.indexOf(n)))).toBe(true);
    expect(buildVoxProductionNodes(d, settings, 'legacy').some(n => n.kind === 'code')).toBe(true);
    const allLocked = buildVoxProductionNodes(d, { ...settings, lockedShotIds: d.beats.flatMap(b => b.shots.map(s => s.id)) });
    expect(allLocked.some(n => n.paid)).toBe(false);
    expect(allLocked.map(n => n.kind)).toEqual([...d.beats.flatMap(b => b.shots.map(() => 'compile')), 'render','verify']);
  });
  it('passes complete pinned director, technique and the exact selected style for all 59 styles', async () => {
    const dir = resolve('vendor/lemo-opuscar');
    const director = await readFile(resolve(dir, 'DIRECTOR.md'), 'utf8'), technique = await readFile(resolve(dir, 'TECHNIQUE.md'), 'utf8');
    expect(CREATIVE_STYLES).toHaveLength(59);
    for (const style of CREATIVE_STYLES) {
      const reference = await loadCreativeStyleReference(dir, style.slug, LEMO_NATIVE_ENGINE);
      expect(reference).toContain(director); expect(reference).toContain(technique);
      expect(reference).toContain(await readFile(resolve(dir, 'styles', style.slug, 'STYLE.md'), 'utf8'));
      expect(reference).not.toContain('Adaptation: use installed system fonts; no Canvas');
      expect(resolveCreativeStyle(style.slug, 'paper-explainer')?.slug).toBe(style.slug);
    }
  });
  it('gives style-owned drawing and typography the whole canvas without adding settings', () => {
    const messages = lemoNativeMessages('FULL STYLE', { stage: 'code', prompt: '批准文案', source: 'previous full film' });
    expect(messages[0].content).toContain('no React/Remotion');
    expect(messages[0].content).toContain('no titles, captions, backgrounds or transitions');
    expect(messages[0].content).toContain('FULL STYLE');
    expect(messages[1].content).toContain('previous full film');
    expect(messages[0].content).toContain('do not claim a score or Foley has been produced');
  });
});
describe('separate Vox and Lemo workflows with existing settings', () => {
  const treatment = { treatment: '使用当前选定风格的构图、字体、材质和镜头运动呈现道路吸热以及树荫降温的机制，完整保留批准文案及有出处的数据。', fps: 24 };
  it('uses current settings when switching native to Vox and back, without reusing the other engine', async () => {
    const d = nativeDocument();
    const plan = vi.fn(async () => ({ shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: s.title || '城市热岛', scenePrompt: 'A shaded street beside a sunlit road, showing their relationship.' }))) }));
    const planFilm = vi.fn(async () => treatment);
    const generateFilm = vi.fn(async (prompt: string) => nativeHtml(JSON.parse(prompt).durationMs));
    const engines: string[] = [];
    const h = nativeHarness({ plan, planFilm, generateFilm, preflight: (_document, settings) => { engines.push(voxProductionEngine(settings)); } }, d);
    const vox = nativeSettings({ authoring: { mode: 'template', styleId: 'watercolor' } });
    expect(voxProductionEngine(vox)).toBe('legacy');
    expect(voxProductionEngine({})).toBe('legacy');
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    const voxNodes = buildVoxProductionNodes(h.get(), vox);
    expect(voxNodes.some(n => ['film-code','film-review','film-repair','code'].includes(n.kind))).toBe(false);
    expect(voxNodes.some(n => n.kind === 'animation')).toBe(true);
    await h.start(vox); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    expect(h.get().productionRun?.engine).toBeUndefined();
    for (const s of h.get().beats.flatMap(b => b.shots)) { expect(s.animation?.native).toBeUndefined(); expect(s.animation?.code.engine).toBeUndefined(); }
    expect(plan).toHaveBeenCalledOnce(); expect(planFilm).toHaveBeenCalledOnce(); expect(generateFilm).toHaveBeenCalledOnce();
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    expect(h.get().productionRun?.engine).toBe(LEMO_NATIVE_ENGINE);
    expect(plan).toHaveBeenCalledOnce(); expect(planFilm).toHaveBeenCalledTimes(2); expect(generateFilm).toHaveBeenCalledTimes(2);
    expect(engines).toEqual([LEMO_NATIVE_ENGINE, 'legacy', LEMO_NATIVE_ENGINE]);
    expect(h.errors).toEqual([]);
  });
  it.each([undefined, '简体中文 · 下方黑底'])('passes material, data unit, ratio and subtitle choice %s to both native stages', async subtitleStyle => {
    const d = nativeDocument(); d.ratio = '9:16';
    for (const s of d.beats.flatMap(b => b.shots)) s.subtitleStyle = subtitleStyle;
    const planFilm = vi.fn(async (_prompt: string) => treatment);
    const generateFilm = vi.fn(async (prompt: string) => nativeHtml(JSON.parse(prompt).durationMs));
    const settings = nativeSettings({ presetId: 'data-map', dataUnit: '摄氏度', data: [{ label: '道路', value: 42, source: '实测资料' }, { label: '树荫', value: 31, source: '实测资料' }], authoring: { mode: 'ai-code', styleId: 'watercolor', brief: '让温度差沿着街道展开' } });
    const h = nativeHarness({ planFilm, generateFilm }, d); await h.start(settings); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    const planned = JSON.parse(planFilm.mock.calls[0][0]), generated = JSON.parse(generateFilm.mock.calls[0][0]);
    const visualSettings = { presetId: 'data-map', presetVersion: 1, dataUnit: '摄氏度', narration: false, data: settings.data, archives: [], brief: settings.authoring?.brief };
    expect(planned.settings).toEqual(visualSettings); expect(generated).toMatchObject(visualSettings);
    expect(planned.canvas.height).toBeGreaterThan(planned.canvas.width); expect(generated.canvas).toEqual(planned.canvas);
    for (const item of [...planned.provisionalTimeline, ...generated.timeline]) expect(item.subtitleStyle).toBe(subtitleStyle || LEMO_FOLLOW_STYLE_SUBTITLES);
    expect(lemoNativeMessages('STYLE', { stage: 'code', prompt: '' })[0].content).toContain('subtitleStyle');
  });
  it('invalidates plan and film work for visual settings but keeps plan stable across measured timing', async () => {
    const h = nativeHarness(); await h.start(); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    const baseline = h.get(), plan = nodeByKind(h, 'plan'), film = nodeByKind(h, 'film-code');
    const hashes = (d: typeof baseline) => [plan, film].map(n => voxInputHash(h.runtime.input(d, n)));
    const before = hashes(baseline);
    for (const edit of [
      (d: typeof baseline) => { d.productionRun!.settings.dataUnit = '摄氏度'; },
      (d: typeof baseline) => { d.productionRun!.settings.presetId = 'data-map'; },
      (d: typeof baseline) => { d.productionRun!.settings.narration = true; },
      (d: typeof baseline) => { d.beats[0].shots[0].subtitleStyle = '简体中文 · 下方黑底'; },
    ]) { const d = structuredClone(baseline); edit(d); const changed = hashes(d); expect(changed[0]).not.toBe(before[0]); expect(changed[1]).not.toBe(before[1]); }
    const measured = structuredClone(baseline); measured.beats[0].shots[0].durationMs += 100;
    expect(hashes(measured)[0]).toBe(before[0]); expect(hashes(measured)[1]).not.toBe(before[1]);
    const musicOnly = structuredClone(baseline); musicOnly.productionRun!.settings.music = { id: 'music', title: '已有配乐', path: 'offline.mp3', durationMs: 30000, gainDb: -12, loop: true, fadeInMs: 300, fadeOutMs: 900 };
    expect(hashes(musicOnly)).toEqual(before);
  });
  it('creates fresh native work when an explicit subtitle choice changes and reuses it unchanged', async () => {
    const planFilm = vi.fn(async () => treatment);
    const generateFilm = vi.fn(async (prompt: string) => nativeHtml(JSON.parse(prompt).durationMs));
    const h = nativeHarness({ planFilm, generateFilm }); await h.start(); await h.idle();
    const edited = h.get(); edited.beats[0].shots[0].subtitleStyle = '简体中文 · 下方黑底'; h.set(edited);
    await h.start(); await h.idle(); expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    expect(planFilm).toHaveBeenCalledTimes(2); expect(generateFilm).toHaveBeenCalledTimes(2);
    expect(JSON.parse(generateFilm.mock.calls[1][0]).timeline[0].subtitleStyle).toBe('简体中文 · 下方黑底');
    await h.start(); await h.idle(); expect(planFilm).toHaveBeenCalledTimes(2); expect(generateFilm).toHaveBeenCalledTimes(2);
  });
  it('does not copy a native code stub into an applied Vox template', async () => {
    const h = nativeHarness(); await h.start(); await h.idle();
    const d = h.get(), before = structuredClone(d.creativeFilms);
    const styled = applyCreativeStyleToDocument(d, nativeSettings({ authoring: { mode: 'template', styleId: 'watercolor' } }));
    for (const s of styled.beats.flatMap(b => b.shots)) {
      expect(s.animation?.native).toBeUndefined(); expect(s.animation?.code.engine).toBeUndefined();
      expect(s.animation?.authoring).toBeUndefined(); expect(s.animation?.mode).toBe('template');
      expect(validateVoxAnimation(s.animation!, styled.assets)).toEqual([]);
    }
    expect(styled.creativeFilms).toEqual(before);
  });
  it('preserves and validates a deliberately locked native shot in a Vox run', async () => {
    const d = nativeDocument();
    const plan = async () => ({ shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: s.title || '热岛', scenePrompt: 'A shaded street beside a sunlit road, showing their relationship.' }))) });
    const h = nativeHarness({ plan }, d); await h.start(); await h.idle();
    const first = h.get(), locked = first.beats[0].shots[0], filmId = locked.animation!.native!.filmId;
    await h.start(nativeSettings({ authoring: { mode: 'template', styleId: 'watercolor' }, lockedShotIds: [locked.id] })); await h.idle();
    const vox = h.get(); expect(vox.productionRun?.status, vox.productionRun?.message).toBe('completed');
    expect(vox.beats[0].shots[0]).toEqual(locked);
    expect(resolveLemoAnimation(vox.beats[0].shots[0].animation, vox.creativeFilms)?.code.source).toBe(first.creativeFilms!.find(f => f.id === filmId)!.source);
    const corrupt = structuredClone(vox); corrupt.creativeFilms!.find(f => f.id === filmId)!.compiled = 'stale compiled result';
    await expect(h.runtime.execute(corrupt, vox.productionRun!.nodes.find(n => n.kind === 'compile' && n.shotId === locked.id)!)).rejects.toThrow('LEMO_COMPILE_STALE:');
  });
});
describe('native compiler and page', () => {
  it('preserves a complete page and modules including top-level await, core and Three', () => {
    const source = nativeHtml().replace('import {clamp}', 'import * as THREE from "three"; await Promise.resolve(); import {clamp}').replace('type="module"', 'type=module');
    const result = compileVoxCode(source);
    expect(result.engine).toBe('lemo-native');
    expect(result.compiled).toContain('window.LemoHost.require(id)');
    expect(result.compiled).toContain('(async()=>');
    expect(result.compiled).toContain('await Promise.resolve()');
    expect(result.source).toBe(source);
  });
  it.each(['import x from "https://cdn.example/x.js";', 'await import("three");', 'Math.random();', 'Date.now();', 'performance.now();'])('rejects nondeterministic or unsupported dependencies: %s', code => {
    expect(() => compileVoxCode(nativeHtml().replace('import {clamp}', code + 'import {clamp}'))).toThrow('LEMO_CODE:');
  });
  it('rejects invalid JS and missing native protocols before review', () => {
    expect(() => compileVoxCode(nativeHtml().replace('window.render=t=>', 'window.render=(=>'))).toThrow('LEMO_CODE:');
    expect(() => compileVoxCode(nativeHtml().replace('window.READY=true;', ''))).toThrow('LEMO_CODE:');
    expect(() => compileVoxCode(nativeHtml().replace('<canvas', '<link href="x.css"><canvas'))).toThrow('LEMO_CODE:');
  });
  it('keeps shaders and injects only clock/dependencies, without host titles, captions or backgrounds', () => {
    const result = compileVoxCode(nativeHtml().replace('</body>', '<script type="x-shader/x-fragment">void main(){gl_FragColor=vec4(1.0);}</script></body>'));
    const animation = createVoxAnimation('HOST TITLE SHOULD NOT APPEAR'); animation.mode='code'; animation.code={...animation.code,...result};
    const payload: VoxAnimationPayload = {animation,width:1920,height:1080,fps:24,durationMs:3000,assets:[],cues:[{id:'c',text:'HOST CAPTION SHOULD NOT APPEAR',startMs:0,endMs:3000}]};
    const html=buildVoxAnimationHtml('window.testRuntime=true;',payload);
    expect(html).toContain('x-shader/x-fragment');
    expect(html).toContain('window.LemoHost.install(');
    expect(html).not.toContain('class="caption"');
    expect(html).not.toContain('id="root"');
    expect(html).not.toContain('background:#');
    expect(html.indexOf('window.testRuntime')).toBeLessThan(html.indexOf('const ctx='));
    expect(html).toContain("default-src 'none'");
  });
  it('detects sparse native lines but excludes blank frames and capture edge noise', () => {
    const width=320,height=180,pixels=new Uint8Array(width*height*4).fill(255);
    expect(nativeFrameHasArtwork(pixels,width,height)).toBe(false);
    for(let x=0;x<width;x++)for(let c=0;c<3;c++)pixels[x*4+c]=0;
    expect(nativeFrameHasArtwork(pixels,width,height)).toBe(false);
    for(let x=80;x<240;x++)for(let c=0;c<3;c++)pixels[(90*width+x)*4+c]=32;
    expect(nativeFrameHasArtwork(pixels,width,height)).toBe(true);
  });
});
describe('native durable production', () => {
  it('persists the film id, shares one source, and reuses paid work after success', async () => {
    const generateFilm=vi.fn(async prompt=>nativeHtml(JSON.parse(prompt).durationMs));
    const h=nativeHarness({generateFilm}); await h.start(); await h.idle();
    const completed=h.get();
    expect(completed.productionRun?.status, completed.productionRun?.message).toBe('completed');
    expect(completed.productionRun?.engine).toBe(LEMO_NATIVE_ENGINE);
    expect(completed.creativeFilms).toHaveLength(1);
    const film=completed.creativeFilms![0]; expect(completed.productionRun?.filmId).toBe(film.id);
    expect(film.status).toBe('reviewed'); expect(generateFilm).toHaveBeenCalledOnce();
    for(const shot of completed.beats.flatMap(b=>b.shots)){
      expect(shot.animation?.native?.filmId).toBe(film.id); expect(shot.animation?.code.source).toBe('');
      expect(resolveLemoAnimation(shot.animation, completed.creativeFilms)?.code.source).toBe(film.source);
    }
    expect(nodeByKind(h,'film-repair').paid).toBe(false);
    const calls=h.calls.length;
    await h.start(); await h.idle(); expect(h.calls).toHaveLength(calls); expect(generateFilm).toHaveBeenCalledOnce();
    expect(h.errors).toEqual([]);
    expect(JSON.parse(generateFilm.mock.calls[0][0])).toMatchObject({script:completed.sourceText, style:'watercolor'});
    const before=directorDocumentRenderFingerprint(completed); completed.creativeFilms![0].source+='\n<!-- changed -->';
    expect(directorDocumentRenderFingerprint(completed)).not.toBe(before);
  });
  it('repairs once using the original failure, then keeps all paid hashes reusable', async () => {
    const generateFilm=vi.fn(async (prompt:string,_style:string,previous?:string)=>previous?nativeHtml(JSON.parse(prompt).durationMs):'invalid returned source');
    const h=nativeHarness({generateFilm}); await h.start(); await h.idle();
    expect(h.get().productionRun?.status,h.get().productionRun?.message).toBe('completed');
    expect(generateFilm).toHaveBeenCalledTimes(2); expect(nodeByKind(h,'film-repair').paid).toBe(true);
    const film=h.get().creativeFilms![0]; expect(film.attempts).toHaveLength(2); expect(film.repairDiagnostic).toContain('LEMO_CODE:');
    for(const node of h.get().productionRun!.nodes) expect(node.inputHash,node.kind).toBe(voxInputHash(h.runtime.input(h.get(),node)));
    await h.start(); await h.idle(); expect(generateFilm).toHaveBeenCalledTimes(2);
  });
  it('stops instead of substituting a generic template after the single repair fails', async () => {
    const generateFilm=vi.fn(async ()=> 'invalid source'); const h=nativeHarness({generateFilm});
    await h.start(); await h.idle();
    expect(h.get().productionRun).toMatchObject({status:'failed',message:expect.stringContaining('LEMO_NATIVE_FAILED:')});
    expect(generateFilm).toHaveBeenCalledTimes(2); expect(h.get().creativeFilms![0].attempts).toHaveLength(2);
    expect(h.get().creativeFilms![0].source).toBe('invalid source');
    expect(h.calls).not.toContain('render');
    expect(h.get().beats.flatMap(b=>b.shots).some(s=>s.animation?.authoring?.status==='fallback')).toBe(false);
    await h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'resume'});await h.idle();
    expect(generateFilm).toHaveBeenCalledTimes(2); expect(h.get().productionRun?.status).toBe('failed');
  });
  it('keeps uncertain provider outcomes unknown and refuses automatic resubmission', async () => {
    const generateFilm=vi.fn(async ():Promise<string>=>{throw new Error('network closed after submit');});
    const h=nativeHarness({generateFilm});await h.start();await h.idle();
    expect(nodeByKind(h,'film-code').status).toBe('unknown');
    await expect(h.start()).rejects.toThrow('UNKNOWN');
    await expect(h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'resume'})).rejects.toThrow('UNKNOWN');
    expect(generateFilm).toHaveBeenCalledOnce();expect(h.get().creativeFilms![0].attempts).toHaveLength(0);
  });
  it('resumes an infrastructure review failure without paying to generate again', async () => {
    let offline=true;const generateFilm=vi.fn(async prompt=>nativeHtml(JSON.parse(prompt).durationMs));
    const h=nativeHarness({generateFilm,previewCode:async()=>{if(offline)throw new Error('browser could not start');return ['review.jpg'];}});
    await h.start();await h.idle();expect(nodeByKind(h,'film-review').status).toBe('failed');
    offline=false; await h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'resume'});await h.idle();
    expect(h.get().productionRun?.status,h.get().productionRun?.message).toBe('completed'); expect(generateFilm).toHaveBeenCalledOnce();
  });
  it('restores a checkpoint containing the film id after the result save was lost', async () => {
    const h=nativeHarness(); const original=h.store.save;let lost=false;
    h.store.save=async d=>{if(!lost&&d.creativeFilms?.length&&d.productionRun?.nodes.find(n=>n.kind==='plan')?.status==='completed'){lost=true;throw new Error('simulated lost save');}return original(d);};
    await h.start();await h.idle();expect(nodeByKind(h,'plan').status).toBe('unknown');
    await h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'reconcile'});
    expect(h.get().productionRun?.filmId).toBe(h.get().creativeFilms?.[0].id);
    await h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'resume'});await h.idle();
    expect(h.get().productionRun?.status,h.get().productionRun?.message).toBe('completed');expect(h.calls.filter(c=>c==='plan')).toHaveLength(1);
  });
  it('invalidates the native treatment and code when the style changes', async () => {
    const planFilm=vi.fn(async()=>({treatment:'以不同风格的原生材质、构图和镜头运动讲述同一个城市热岛文案，完整保留文字和数据。',fps:24}));
    const generateFilm=vi.fn(async prompt=>nativeHtml(JSON.parse(prompt).durationMs)); const h=nativeHarness({planFilm,generateFilm});
    await h.start();await h.idle();const firstId=h.get().productionRun!.filmId;
    await h.start(nativeSettings({authoring:{mode:'ai-code',styleId:'pixel-rpg'}}));await h.idle();
    expect(h.get().productionRun?.status,h.get().productionRun?.message).toBe('completed');expect(h.get().productionRun?.filmId).not.toBe(firstId);
    expect(planFilm).toHaveBeenCalledTimes(2);expect(generateFilm).toHaveBeenCalledTimes(2);
    expect(generateFilm.mock.calls.map(args=>JSON.parse(args[0]).style)).toEqual(['watercolor','pixel-rpg']);
  });
  it('requires manual code to be locked and leaves locked code unchanged', async () => {
    const d=nativeDocument(),shot=d.beats[0].shots[0],animation=createVoxAnimation(); animation.mode='code';
    animation.code={...animation.code,...compileVoxCode('export default function Scene(){return null;}')}; shot.animation=animation;shot.renderStrategy='remotion';
    expect(voxProductionInputErrors(d,nativeSettings()).join()).toContain('请先锁定');
    const before=structuredClone(shot);const settings=nativeSettings({lockedShotIds:[shot.id]});
    expect(voxProductionInputErrors(d,settings)).toEqual([]);const h=nativeHarness({},d);await h.start(settings);await h.idle();
    expect(h.get().productionRun?.status,h.get().productionRun?.message).toBe('completed');
    expect(h.get().beats[0].shots[0]).toEqual(before);
  });
  it('fails clearly when a film reference has lost its root source', () => {
    const animation=createVoxAnimation();animation.native={filmId:'missing',startMs:0,durationMs:3000,filmDurationMs:3000,width:1920,height:1080,fps:24,assetIds:[]};
    expect(()=>resolveLemoAnimation(animation,[])).toThrow('LEMO_FILM_MISSING:');
  });
});
function scene(id:string,startMs:number,durationMs:number):DirectorRenderScene{
  const animation=createVoxAnimation();animation.mode='code';animation.code={...animation.code,...compileVoxCode(nativeHtml(5000))};
  animation.native={filmId:'f',startMs,durationMs,filmDurationMs:5000,width:1920,height:1080,fps:24,assetIds:[]};
  return {id,index:Number(id),title:'',caption:'',subtitleCues:[],durationMs,renderStrategy:'remotion',transitionIn:{type:'cut',durationMs:0},animation,layers:[],camera:[],audioPath:'',audioClips:[]};
}
describe('native continuous frame clock',()=>{
  it('merges arbitrary editing windows without rounding each cut to a video frame',()=>{
    const a=scene('1',0,1001.3),b=scene('2',1001.3,1017.1),c=scene('3',2018.4,1600.7);
    const before=structuredClone([a,b,c]),stages=coalesceDirectorNativeScenes([a,b,c]);
    expect(stages).toHaveLength(1);expect(stages[0].scene.durationMs).toBeCloseTo(3619.1);
    expect(stages[0].scene.animation?.native?.durationMs).toBeCloseTo(3619.1);
    expect(stages[0].windows.map(w=>w.localOffsetMs)).toEqual([0,1001.3,2018.4]);expect([a,b,c]).toEqual(before);
  });
  it('coalesces repaired windows with one source rate and keeps different rates separate',()=>{
    const a=scene('1',0,2000),b=scene('2',1000,2000),c=scene('3',2000,1000);
    a.animation!.native!.sourceDurationMs=1000;b.animation!.native!.sourceDurationMs=1000;
    const stages=coalesceDirectorNativeScenes([a,b,c]);
    expect(stages).toHaveLength(2);
    expect(stages[0].scene.animation!.native).toMatchObject({startMs:0,durationMs:4000,sourceDurationMs:2000});
    expect(stages[0].windows.map(w=>w.localOffsetMs)).toEqual([0,2000]);
  });
  it('offsets cue/token/audio clocks while preserving source trims, gain and fade envelopes',()=>{
    const a=scene('1',0,1001.3),b=scene('2',1001.3,2000);
    b.subtitleCues=[{id:'cue',text:'树荫',startMs:20,endMs:800,tokens:[{text:'树',startMs:20,endMs:100}]}];
    b.audioClips=[{id:'voice',assetVersionId:'v',path:'voice.wav',trackType:'narration',startMs:50,durationMs:1000,sourceStartMs:125,sourceDurationMs:1000,gainDb:-3,fadeEnvelope:{offsetMs:20,durationMs:2000,fadeInMs:100,fadeOutMs:100}}];
    const stage=coalesceDirectorNativeScenes([a,b])[0].scene;
    expect(stage.subtitleCues![0]).toMatchObject({startMs:1021.3,endMs:1801.3,tokens:[{startMs:1021.3,endMs:1101.3}]});
    expect(stage.audioClips![0]).toEqual({...b.audioClips[0],id:'2:voice',startMs:1051.3});
  });
  it.each(['film','source','fps','gap','transition','assets'])('keeps incompatible windows separate: %s',change=>{
    const a=scene('1',0,1000),b=scene('2',1000,1000);
    if(change==='film')b.animation!.native!.filmId='other';
    if(change==='source')b.animation!.code.source+=' ';
    if(change==='fps')b.animation!.native!.fps=12;
    if(change==='gap')b.animation!.native!.startMs=1100;
    if(change==='transition')b.transitionIn={type:'dissolve',durationMs:100};
    if(change==='assets')b.animationAssets=[{id:'asset',kind:'image',path:'image.png'}];
    expect(coalesceDirectorNativeScenes([a,b])).toHaveLength(2);
  });
  it('uses native fps including 12 and 60, and preserves the old 24fps default',()=>{
    expect(directorVisualFps([])).toBe(24);const a=scene('1',0,1000);a.animation!.native!.fps=12;
    expect(directorVisualFps([a])).toBe(12);const b=scene('2',1000,1000);b.animation!.native!.fps=60;
    expect(directorVisualFps([a,b])).toBe(60);expect(directorVisualFps([a,{}])).toBe(24);
  });
});
