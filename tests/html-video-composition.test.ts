import { describe, expect, it } from 'vitest';
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
 it('resolves cue actions from authoritative times and remaps hidden slots',()=>{
  const plan=upgradeHtmlSceneComposition(scene);
  const cues=resolveHtmlVideoCaptionCues(scene.captions,8,1,[{text:scene.captions[0],startSec:.3,endSec:2.8,source:'tts',confidence:.95},{text:scene.captions[1],startSec:3.4,endSec:7.8,source:'tts',confidence:.95}]);
  expect(cues.map(c=>c.source)).toEqual(['tts','tts']);
  expect(htmlCompositionBeatTweens(plan,cues,[0],8)).toContain('}, 3.4)');
  expect(htmlCompositionBeatTweens(plan,cues,[],8)).toBe('');
  plan.beats![0].targetSlots=[9];expect(()=>validateHtmlVideoScenePlans([plan],8)).toThrow('missing slot');
 });
 it('preserves exact spoken text and word times; rejects overlap or ASR rewrites',()=>{
  const timed=[{text:'第一句。',startSec:.2,endSec:2,source:'tts' as const,confidence:.9,words:[{text:'第一',startSec:.2,endSec:.9},{text:'句。',startSec:.9,endSec:2}]}];
  expect(resolveHtmlVideoCaptionCues(['第一句。'],3,1,timed)[0].words).toEqual(timed[0].words);
  expect(resolveHtmlVideoCaptionCues(['原文。'],3,1,timed)[0]).toMatchObject({text:'原文。',source:'estimated'});
  const overlap=[...timed,{text:'第二句。',startSec:1.5,endSec:2.9,source:'asr' as const,confidence:.9}];
  expect(resolveHtmlVideoCaptionCues(scene.captions,3,1,overlap).every(c=>c.source==='estimated')).toBe(true);
 });
});
