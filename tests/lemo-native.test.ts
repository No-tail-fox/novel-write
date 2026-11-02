import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildVoxProductionNodes, voxProductionEngine } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE, lemoNativeMessages, lemoShotPreviewPath, resolveLemoAnimation } from '../src/shared/creative-animation/native-film';
import { nativeFrameHasArtwork } from '../src/shared/creative-animation/review';
import { coalesceDirectorNativeScenes } from '../src/shared/creative-animation/native-render';
import { buildVoxAnimationHtml, createVoxAnimation, validateVoxAnimation, type VoxAnimationPayload } from '../src/shared/vox-animation';
import { applyCreativeStyleToDocument } from '../src/shared/creative-animation/assemble';
import { CREATIVE_STYLES, resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import { loadCreativeStyleReference } from '../electron/creative-style-references';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { type DirectorRenderScene } from '../src/shared/director-render';
import { directorVisualFps } from '../src/shared/production-visual-continuity';
import { nativeDocument, nativeHarness, nativeHtml, nativeSettings } from './lemo-native.fixture';

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
  it('creates the official treatment, style frame, voice lock and authoring stages without the retired planner', () => {
    const d=nativeDocument(),settings=nativeSettings(),nodes=buildVoxProductionNodes(d,settings);
    expect(nodes.filter(n=>n.kind==='film-edit').map(n=>n.id)).toEqual(['official-treatment','official-style-frame','official-voice-lock','official-authoring']);
    expect(nodes.find(n=>n.id==='official-authoring')).toMatchObject({fileId:'official-film',paid:true,dependencies:['official-voice-lock']});
    expect(nodes.find(n=>n.id==='official-voice-lock')).toMatchObject({paid:false,dependencies:nodes.filter(n=>n.kind==='timing').map(n=>n.id)});
    expect(nodes.filter(n=>n.kind==='film-finalize')).toHaveLength(1);
    expect(nodes.some(n=>['plan','film-code','film-review','film-repair','image','cutout','animation','code'].includes(n.kind))).toBe(false);
    expect(nodes.every(n=>n.dependencies.every(dep=>nodes.findIndex(p=>p.id===dep)<nodes.indexOf(n)))).toBe(true);
    expect(buildVoxProductionNodes(d,nativeSettings({authoring:{mode:'template',styleId:'watercolor'}})).some(n=>n.kind==='animation')).toBe(true);
    for(const version of [1,2,3])expect(()=>buildVoxProductionNodes(d,settings,LEMO_NATIVE_ENGINE,version)).toThrow('LEMO_WORKFLOW_UNSUPPORTED');
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
describe('official-only native production selection', () => {
  it('refuses missing official dependencies before calling any retired planner or author', async () => {
    const planFilm=vi.fn(),generateFilm=vi.fn(),h=nativeHarness({planFilm,generateFilm});
    await expect(h.start()).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    expect(h.get().productionRun).toBeUndefined();expect(h.calls).toEqual([]);
    expect(planFilm).not.toHaveBeenCalled();expect(generateFilm).not.toHaveBeenCalled();
  });
  it('keeps local templates selectable without using them as a native fallback', () => {
    const template=nativeSettings({authoring:{mode:'template',styleId:'watercolor'}});
    expect(voxProductionEngine(template)).toBe('legacy');expect(voxProductionEngine(nativeSettings())).toBe(LEMO_NATIVE_ENGINE);
    const d=nativeDocument(),styled=applyCreativeStyleToDocument(d,template);
    for(const shot of styled.beats.flatMap(b=>b.shots)) {
      expect(shot.animation?.native).toBeUndefined();expect(shot.animation?.mode).toBe('template');
      expect(validateVoxAnimation(shot.animation!,styled.assets)).toEqual([]);
    }
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
describe('native source reference validation', () => {
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
