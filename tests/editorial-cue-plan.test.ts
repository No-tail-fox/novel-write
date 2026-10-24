import {describe,it,expect} from 'vitest';
import {createEditorialCuePlan,resolveEditorialCuePlan,compileEditorialCueLayers} from '../src/shared/editorial-cue-plan';
import {createEditorialMotionLayers} from '../src/shared/editorial-motion';
import {createEditorialCollageDraft,createEditorialCollageStarterPlan,rebuildEditorialTimeline} from '../src/shared/editorial-collage';
import {buildDirectorRenderScenes} from '../src/shared/director-render';
import {alignSubtitleCue} from '../src/shared/audio-alignment';
import {buildSapiWordTimings} from '../scripts/qa-animation-media';
const cues=[{id:'cue-1',text:'看见自己。',startMs:1000,endMs:3500},{id:'cue-2',text:'看见自己。',startMs:4200,endMs:7000}];
const layers=createEditorialMotionLayers({shotId:'shot',title:'看见',narration:'看见自己。看见自己。',durationMs:8000,ratio:'16:9',index:0,motionStyle:'evidence-stack'});
describe('Vox semantic cue clock',()=>{
 it('merges invalid SAPI tail boundaries without losing cue text or extending beyond audio',()=>{
  const text='人物沿着画面前进。';
  const {words,tailMerged}=buildSapiWordTimings(text,[
   {charIndex:0,audioMs:137},{charIndex:2,audioMs:760},{charIndex:4,audioMs:1310},
   {charIndex:7,audioMs:2290},{charIndex:9,audioMs:2850},{charIndex:10,audioMs:3110},
  ],3000);
  expect(tailMerged).toBe(true);
  expect(words.map(word=>word.text).join('')).toBe(text);
  expect(words.at(-1)?.endSec).toBe(3);
  expect(()=>buildSapiWordTimings(text,[{charIndex:0,audioMs:100},{charIndex:99,audioMs:800}],3000)).not.toThrow();
 });
 const timedCue=()=>alignSubtitleCue({id:'words',text:'先向右，再向右。',startMs:5000,endMs:11000},{source:'provider',timestamps:[
  {text:'先',startMs:5100,endMs:5500},{text:'向右，',startMs:5600,endMs:6500},
  {text:'再',startMs:7000,endMs:7400},{text:'向右。',startMs:8200,endMs:9500},
 ]});
 const phrasePlan=(cue:ReturnType<typeof timedCue>,text:string,start:number,occurrence=1)=>{
  const plan=createEditorialCuePlan([cue],layers,'path-progress');
  Object.assign(plan.beats[0],{text,sourceStart:start,sourceEnd:start+text.length,occurrence,action:'move'});
  return plan;
 };
 it('uses the matching repeated phrase token boundary on the shot-local clock, without inventing confidence',()=>{
  const cue=timedCue(),plan=phrasePlan(cue,'向右。',5);
  const [beat]=resolveEditorialCuePlan(plan,[cue],5000,6000);
  expect(beat).toMatchObject({startMs:3200,endMs:3800,timingSource:'provider',timingPrecision:'token-boundary',timingReason:'matched-token-boundaries'});
  expect(beat.confidence).toBeUndefined();
  const second=phrasePlan(cue,'向右',5,2);
  expect(resolveEditorialCuePlan(second,[cue],5000,6000)[0]).toMatchObject({timingSource:'estimated',timingReason:'partial-token'});
 });
 it('does not reuse a different cue just because its full narration span is valid',()=>{
  const cue=timedCue(),other={...cue,id:'other',startMs:12000,endMs:18000};
  const plan=createEditorialCuePlan([cue,other],layers);
  plan.beats[1].cueId=cue.id;
  expect(()=>resolveEditorialCuePlan(plan,[cue,other],0,18000)).toThrow('STALE');
 });
 it.each(['stale','estimated','incomplete','wrong-text'] as const)('reports %s token timing as estimated',mode=>{
  const cue=timedCue(),plan=phrasePlan(cue,'向右。',5);
  if(mode==='stale')cue.audioAssetVersionId='changed-audio';
  if(mode==='estimated')cue.alignmentSource='estimated';
  if(mode==='incomplete')cue.tokens=cue.tokens!.slice(1);
  if(mode==='wrong-text')cue.tokens![0].text='后';
  const [beat]=resolveEditorialCuePlan(plan,[cue],5000,6000);
  expect(beat).toMatchObject({startMs:3750,timingSource:'estimated',timingPrecision:'estimated'});
 });
 it('matches complete repeated English words despite whitespace and preserves provider confidence',()=>{
  const cue=alignSubtitleCue({id:'en',text:'Go right, then right.',startMs:100,endMs:4500},{source:'whisper',timestamps:[
   {text:'Go',startMs:200,endMs:500,confidence:.98},{text:'right,',startMs:700,endMs:1500,confidence:.92},
   {text:'then',startMs:1800,endMs:2200,confidence:.95},{text:'right.',startMs:3000,endMs:4000,confidence:.88},
  ]});
  const plan=phrasePlan(cue,'right.',15);
  expect(resolveEditorialCuePlan(plan,[cue],100,4400)[0]).toMatchObject({startMs:2900,timingSource:'whisper',confidence:.88});
 });
 it('distinguishes repeated text by exact spans and occurrence, rejects stale copy',()=>{
  const plan=createEditorialCuePlan(cues,layers,'evidence-stack');
  expect(plan.beats.map(beat=>beat.occurrence)).toEqual([1,2]);
  expect(resolveEditorialCuePlan(plan,cues,0,8000).map(beat=>beat.startMs)).toEqual([1000,4200]);
  expect(resolveEditorialCuePlan(plan,cues,0,8000).every(beat=>beat.timingSource==='estimated')).toBe(true);
  expect(()=>resolveEditorialCuePlan(plan,[cues[0],{...cues[1],text:'看别人。'}],0,8000)).toThrow('STALE');
 });
 it('holds the first artwork until its authored spoken cue and does not invent word times',()=>{
  const beats=resolveEditorialCuePlan(createEditorialCuePlan(cues,layers),cues,0,8000);
  const compiled=compileEditorialCueLayers(layers,beats,8000),subject=compiled.find(layer=>layer.kind==='archival')!;
  expect(subject.motion[0].opacity).toBe(0);
  expect(subject.motion.find(frame=>frame.atMs===1000)?.opacity).toBe(0);
  expect(subject.motion.some(frame=>frame.atMs===1600&&frame.opacity===1)).toBe(true);
 });
 it('starts a path at its first visible station and progresses monotonically',()=>{
  const path=createEditorialMotionLayers({shotId:'path',title:'路径',narration:'先出现。再向右。最后抵达。',durationMs:9000,ratio:'16:9',index:0,motionStyle:'path-progress'});
  const lines=['先出现。','再向右。','最后抵达。'].map((text,i)=>({id:`p${i}`,text,startMs:i*3000,endMs:(i+1)*3000}));
  const compiled=compileEditorialCueLayers(path,resolveEditorialCuePlan(createEditorialCuePlan(lines,path,'path-progress'),lines,0,9000),9000);
  const points=compiled.find(l=>l.kind==='subject')!.motion.filter(f=>f.opacity===1);
  expect(points[0].x).toBeLessThan(.3);
  expect(points.at(-1)!.x).toBeGreaterThan(.7);
  for(let i=1;i<points.length;i++)expect(points[i].x).toBeGreaterThanOrEqual(points[i-1].x);
 });
 it('passes the same resolved actions and compiled geometry to both engines',()=>{
  const doc=createEditorialCollageStarterPlan(createEditorialCollageDraft({id:'semantic',title:'身体的提醒',ratio:'16:9'}),'先看见身体的提醒。然后把目光转向自己。');
  const shot=doc.beats[0].shots[0];
  const firstBeat=doc.beats[0];
  firstBeat.subtitleCues=firstBeat.subtitleCues.map(cue=>alignSubtitleCue(cue,{source:'provider',timestamps:[{text:cue.text,startMs:cue.startMs+100,endMs:cue.endMs-50}]}));
  for(const beat of doc.beats)for(const s of beat.shots){
   for(const layer of s.layers)if(!layer.content){layer.assetVersionId=`asset-${layer.id}`;doc.assets.push({id:layer.assetVersionId,assetId:layer.id,kind:'image',localPath:`C:/media/${layer.id}.png`,backgroundRemoval:{method:'native-alpha',transparentFraction:.5,foregroundFraction:.49,edgeFraction:.01,quality:'passed'},createdAt:doc.createdAt});}
   s.voiceAssetVersionId=`voice-${s.id}`;doc.assets.push({id:s.voiceAssetVersionId,assetId:s.id,kind:'audio',localPath:'C:/media/voice.wav',createdAt:doc.createdAt});
  }
  const wide=buildDirectorRenderScenes(rebuildEditorialTimeline(doc))[0];
  shot.renderStrategy='remotion';shot.animation={version:1,mode:'template',template:{id:'paper-actors',props:{title:'标题',subtitle:'',author:'',source:'',accent:'#c7513b',background:'#eee8dc',foreground:'#242820',unit:'',highlight:'',items:[],assetIds:shot.layers.flatMap(layer=>layer.assetVersionId??[]),geoJson:'',focus:{x:.25,y:.25,width:.5,height:.5}}},code:{source:'',compiled:'',prompt:''}};
  const remotion=buildDirectorRenderScenes(rebuildEditorialTimeline(doc))[0];
  expect(remotion.semanticBeats).toEqual(wide.semanticBeats);
  expect(remotion.semanticBeats?.[0]).toMatchObject({timingPrecision:'token-boundary',timingSource:'provider'});
  expect(remotion.subtitleCues?.[0].tokens).toEqual(wide.subtitleCues?.[0].tokens);
  expect(remotion.layers.map(layer=>layer.motion)).toEqual(wide.layers.map(layer=>layer.motion));
 });
});
