import { describe, expect, it } from 'vitest';
import { HTML_VIDEO_SCENE_TEMPLATES } from '../src/shared/html-video-scene-templates';
import { upgradeHtmlSceneComposition, resolveHtmlCompositionLayout, htmlCompositionBeatTweens } from '../src/shared/html-video-composition';
import { resolveHtmlVideoCaptionCues } from '../src/shared/html-video-captions';
import { validateHtmlVideoScenePlans } from '../src/shared/html-video-workflow';
import type { HtmlVideoScenePlan } from '../src/shared/types';
const scene:HtmlVideoScenePlan={index:1,narration:'第一句。第二句。',title:'标题',captions:['第一句。','第二句。'],sceneTemplate:'left-text-right-object',background:{prompt:'纸纹'},elements:[{slot:0,prompt:'人物'}]};
describe('HTML composition v2 semantics',()=>{
 it('keeps legacy optional and roundtrips independent portrait and landscape boxes',()=>{
  expect(validateHtmlVideoScenePlans([scene],8)[0].compositionVersion).toBeUndefined();
  const upgraded=upgradeHtmlSceneComposition(scene);
  expect(validateHtmlVideoScenePlans([upgraded],8)[0]).toEqual(upgraded);
  const wide=resolveHtmlCompositionLayout(upgraded,false), tall=resolveHtmlCompositionLayout(upgraded,true);
  expect(wide.objects[0].geometry.x).toBeGreaterThan(wide.title.x+wide.title.width);
  expect(tall.objects[0].geometry.y).toBeGreaterThanOrEqual(tall.title.y+tall.title.height);
  for(const layout of [wide,tall]) for(const {geometry:g} of layout.objects){expect(g.x+g.width).toBeLessThanOrEqual(100);expect(g.y+g.height).toBeLessThanOrEqual(layout.caption.y);}
 });
 it('gives each multi-object template distinct safe boxes in both orientations',()=>{
  for(const template of HTML_VIDEO_SCENE_TEMPLATES.filter(t=>t.materialSlots>1)) {
   const plan=upgradeHtmlSceneComposition({...scene,sceneTemplate:template.id,elements:Array.from({length:template.materialSlots},(_,slot)=>({slot,prompt:`object ${slot}`}))});
   for(const portrait of [false,true]) {
    const layout=resolveHtmlCompositionLayout(plan,portrait);
    const boxes=layout.objects.map(o=>o.geometry);
    expect(new Set(boxes.map(g=>`${g.x},${g.y},${g.width},${g.height}`)).size,template.id).toBe(template.materialSlots);
    for(const g of boxes) {
     expect(g.x,template.id).toBeGreaterThanOrEqual(0);
     expect(g.y,template.id).toBeGreaterThanOrEqual(layout.title.y+layout.title.height);
     expect(g.x+g.width,template.id).toBeLessThanOrEqual(100);
     expect(g.y+g.height,template.id).toBeLessThanOrEqual(layout.caption.y);
    }
   }
  }
 });
 it('separates the hero subject from callouts and preserves authored geometry',()=>{
  const hero={...scene,sceneTemplate:'hero-callouts',elements:[0,1,2].map(slot=>({slot,prompt:`object ${slot}`}))};
  for(const portrait of [false,true]) {
   const [subject,left,right]=resolveHtmlCompositionLayout(hero,portrait).objects.map(o=>o.geometry);
   expect(left.x+left.width).toBeLessThanOrEqual(right.x);
   if(portrait) expect(subject.y).toBeGreaterThan(left.y);
   else {expect(left.x+left.width).toBeLessThanOrEqual(subject.x);expect(subject.x+subject.width).toBeLessThanOrEqual(right.x);}
  }
  const custom=upgradeHtmlSceneComposition(hero);
  custom.elements[1].layout!.portrait={x:1,y:2,width:30,height:40,fit:'contain',anchor:'center bottom',zIndex:9};
  expect(upgradeHtmlSceneComposition(custom)).toBe(custom);
  expect(resolveHtmlCompositionLayout(custom,true).objects[1].geometry).toEqual(custom.elements[1].layout!.portrait);
 });
 it('resolves cue actions from authoritative times and remaps hidden slots',()=>{
  const plan=upgradeHtmlSceneComposition(scene);
  const cues=resolveHtmlVideoCaptionCues(scene.captions,8,1,[{text:scene.captions[0],startSec:.3,endSec:2.8,source:'tts',confidence:.95},{text:scene.captions[1],startSec:3.4,endSec:7.8,source:'tts',confidence:.95}]);
  expect(cues.map(c=>c.source)).toEqual(['tts','tts']);
  expect(htmlCompositionBeatTweens(plan,cues,[0],8)).toContain('}, 3.4)');
  expect(htmlCompositionBeatTweens(plan,cues,[],8)).toBe('');
  plan.beats![0].targetSlots=[9];expect(()=>validateHtmlVideoScenePlans([plan],8)).toThrow('missing slot');
 });
 it('restores a previously dimmed foreground when it becomes the focus again',()=>{
  const plan=upgradeHtmlSceneComposition({...scene,sceneTemplate:'hero-callouts',captions:['一','二','三','四'],elements:[0,1,2].map(slot=>({slot,prompt:`object ${slot}`}))});
  const cues=resolveHtmlVideoCaptionCues(plan.captions,8,1);
  const script=htmlCompositionBeatTweens(plan,cues,[0,1,2],8);
  expect(script).toContain(`tl.to('#foreground-1', { opacity: 1, duration: 0.25 }, ${cues[3].startSec});`);
  expect(script).toContain(`tl.to('#foreground-1', { opacity: 0.35, duration: 0.5 }, ${cues[1].startSec});`);
 });
 it('preserves exact spoken text and word times; rejects overlap or ASR rewrites',()=>{
  const timed=[{text:'第一句。',startSec:.2,endSec:2,source:'tts' as const,confidence:.9,words:[{text:'第一',startSec:.2,endSec:.9},{text:'句。',startSec:.9,endSec:2}]}];
  expect(resolveHtmlVideoCaptionCues(['第一句。'],3,1,timed)[0].words).toEqual(timed[0].words);
  expect(resolveHtmlVideoCaptionCues(['原文。'],3,1,timed)[0]).toMatchObject({text:'原文。',source:'estimated'});
  const overlap=[...timed,{text:'第二句。',startSec:1.5,endSec:2.9,source:'asr' as const,confidence:.9}];
  expect(resolveHtmlVideoCaptionCues(scene.captions,3,1,overlap).every(c=>c.source==='estimated')).toBe(true);
 });
});
