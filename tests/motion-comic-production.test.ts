import {describe,it,expect} from 'vitest';
import {createMotionComicDraft,createMotionComicStarterProject,parseMotionComicPipelineData,rebuildMotionComicEpisode} from '../src/shared/motion-comic';
import {defaultConfig} from '../src/shared/config';
import {planMotionComicProductionUnits,splitMotionComicProductionUnits} from '../src/shared/motion-comic-production';
import {buildMotionComicShotVideoRequest,motionComicVideoInputHash,motionComicVideoReferences,selectMotionComicVideoRoute} from '../src/shared/motion-comic-video';
const now='2026-10-21T00:00:00.000Z';
function fixture(){
 const document=createMotionComicStarterProject(createMotionComicDraft({id:'production',title:'制作单元',premise:'雨夜一封信',now}));
 const episode=document.episodes[0],shot=episode.scenes[0].shots[0];
 shot.renderStrategy='remote-video';shot.firstFrameAssetVersionId='frame';shot.videoProduction={version:1,referenceMode:'references',audioMode:'post-mix'};
 document.assets.push({id:'frame',assetId:`shot-keyframe-${shot.id}`,kind:'image',localPath:'C:/frame.png',createdAt:now});
 for(const lookId of shot.characterLookIds){const look=document.characters.flatMap(c=>c.looks).find(l=>l.id===lookId)!;const id=`ref-${look.id}`;look.referenceAssetVersionIds=[id];document.assets.push({id,assetId:`reference-look-${look.id}`,kind:'image',localPath:`C:/${id}.png`,selected:true,pinned:true,createdAt:now});}
 const scene=document.sceneAssets.find(s=>s.id===shot.sceneAssetId)!;scene.referenceAssetVersionIds=['scene-ref'];document.assets.push({id:'scene-ref',assetId:`reference-scene-${scene.id}`,kind:'image',localPath:'C:/scene.png',selected:true,pinned:true,createdAt:now});shot.propAssetIds=[];
 const provider={...defaultConfig.video.providers[0],enabled:true,apiKey:'test',baseUrl:'https://video.invalid',model:'seedance-2.0',modelPreset:'seedance-2.0' as const,maxDurationSec:15,capabilities:['i2v','first-last-frame','reference-image','reference-audio','synchronized-audio'] as typeof defaultConfig.video.providers[0]['capabilities']};
 return {document,episode,shot,provider};
}
describe('motion comic explicit production inputs',()=>{
 it('submits ordered confirmed references and preserves complete authored dialogue',()=>{
  const {document,shot}=fixture();const refs=motionComicVideoReferences(document,shot),request=buildMotionComicShotVideoRequest(document,shot);
  expect(refs.map(r=>r.kind)).toEqual(['opening',...shot.characterLookIds.map(()=> 'character'),'scene']);
  expect(request.firstFramePath).toBeUndefined();expect(request.referenceImages?.map(r=>r.path)).toEqual(refs.map(r=>r.path));
  const cue=document.episodes[0].dialogueCues.find(c=>c.id===shot.dialogueCueIds[0])!;expect(request.prompt).toContain(cue.text);
  const hash=motionComicVideoInputHash(document,shot,'p','m');cue.text+='完整尾句。';expect(motionComicVideoInputHash(document,shot,'p','m')).not.toBe(hash);
  document.assets.find(a=>a.id===refs[1].assetVersionId)!.pinned=false;expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('固定参考');
 });
 it('fingerprints order, audio mode, voice, reference audio and production boundaries',()=>{
  const {document,shot}=fixture();document.assets.push({id:'voice',assetId:'voice',kind:'audio',localPath:'C:/voice.wav',durationMs:1000,createdAt:now});
  const base=motionComicVideoInputHash(document,shot,'p','m');
  shot.videoProduction={...shot.videoProduction!,audioMode:'audio-driven',referenceAudioAssetVersionIds:['voice']};expect(buildMotionComicShotVideoRequest(document,shot)).toMatchObject({generateAudio:true,referenceAudioPaths:['C:/voice.wav']});expect(motionComicVideoInputHash(document,shot,'p','m')).not.toBe(base);
  const audioHash=motionComicVideoInputHash(document,shot,'p','m');shot.productionUnit={sourceShotId:'source',sourceStartMs:0,sourceEndMs:shot.durationMs,index:1,total:2,generationDurationSec:7};expect(motionComicVideoInputHash(document,shot,'p','m')).not.toBe(audioHash);
 });
 it('does not report a provider ready when below model duration or native sound unsupported',()=>{
  const {document,shot,provider}=fixture();const config=structuredClone(defaultConfig);config.video.providers=[provider];config.video.activeProviderId=provider.id;config.video.automation.providerWhitelist=[provider.id];config.video.automation.budgetLimit=100;
  expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).toBe('provider');
  shot.durationMs=2000;expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).not.toBe('provider');
  shot.durationMs=7000;shot.videoProduction!.audioMode='native';provider.model='MiniMax-H3';provider.modelPreset='h3' as never;expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).not.toBe('provider');
 });
 it('splits at complete dialogue boundaries, retaining voice samples and ownership',()=>{
  const {document,episode,shot,provider}=fixture();shot.durationMs=24000;
  const cue=structuredClone(episode.dialogueCues.find(c=>c.id===shot.dialogueCueIds[0])!);
  const lines=[{id:'a',text:'第一句完整对白。',startMs:0,endMs:9000},{id:'b',text:'第二句完整对白。',startMs:9000,endMs:17000},{id:'c',text:'最后一句完整对白。',startMs:17000,endMs:24000}];
  episode.dialogueCues=episode.dialogueCues.filter(c=>c.shotId!==shot.id).concat(lines.map(c=>({...cue,...c,shotId:shot.id})));shot.dialogueCueIds=lines.map(c=>c.id);
  episode.timeline.clips.find(c=>c.shotId===shot.id)!.durationMs=24000;document.episodes[0]=rebuildMotionComicEpisode(episode);
  const units=planMotionComicProductionUnits(document,shot,provider);expect(units.map(u=>[u.startMs,u.endMs])).toEqual([[0,9000],[9000,24000]]);
  const split=splitMotionComicProductionUnits(document,shot.id,provider),restored=parseMotionComicPipelineData(JSON.stringify(split));
  const produced=restored.episodes[0].scenes.flatMap(s=>s.shots).filter(s=>s.productionUnit?.sourceShotId===shot.id);
  expect(split.updatedAt).toBe(document.updatedAt);expect(produced).toHaveLength(2);expect(produced[1].firstFrameAssetVersionId).toBeUndefined();expect(produced.flatMap(s=>s.dialogueCueIds)).toEqual(['a','b','c']);
  expect(restored.episodes[0].dialogueCues.filter(c=>['a','b','c'].includes(c.id)).map(c=>c.text)).toEqual(lines.map(c=>c.text));
 });
 it('refuses to cut a long utterance or overrun measured speech',()=>{
  const {document,episode,shot,provider}=fixture();shot.durationMs=20000;const cue=episode.dialogueCues.find(c=>c.id===shot.dialogueCueIds[0])!;cue.startMs=0;cue.endMs=18000;
  expect(()=>planMotionComicProductionUnits(document,shot,provider)).toThrow('语义拆句');
  cue.endMs=1000;cue.voiceAssetVersionId='long-audio';document.assets.push({id:'long-audio',assetId:'long-audio',kind:'audio',localPath:'C:/long.wav',durationMs:22000,createdAt:now});expect(()=>planMotionComicProductionUnits(document,shot,provider)).toThrow('实测对白');
 });
 it('pads a short unit without extending the authored timeline and persists it',()=>{
  const {document,episode,shot,provider}=fixture();shot.durationMs=2000;shot.dialogueCueIds=[];episode.dialogueCues=episode.dialogueCues.filter(c=>c.shotId!==shot.id);
  episode.timeline.clips.find(c=>c.shotId===shot.id)!.durationMs=2000;
  const units=planMotionComicProductionUnits(document,shot,provider);expect(units[0].generationDurationSec).toBeGreaterThanOrEqual(3);
  const split=parseMotionComicPipelineData(JSON.stringify(splitMotionComicProductionUnits(document,shot.id,provider)));
  const unit=split.episodes[0].scenes.flatMap(s=>s.shots).find(s=>s.productionUnit?.sourceShotId===shot.id)!;
  expect(unit.durationMs).toBe(2000);expect(buildMotionComicShotVideoRequest(split,unit).durationSec).toBe(units[0].generationDurationSec);
 });
 it('requires individual reference audio after splitting instead of repeating the whole recording',()=>{
  const {document,episode,shot,provider}=fixture();shot.durationMs=24000;shot.dialogueCueIds=[];episode.dialogueCues=episode.dialogueCues.filter(c=>c.shotId!==shot.id);
  shot.videoProduction={version:1,referenceMode:'references',audioMode:'audio-driven',referenceAudioAssetVersionIds:['whole']};
  document.assets.push({id:'whole',assetId:'whole',kind:'audio',localPath:'C:/whole.wav',durationMs:24000,createdAt:now});
  episode.timeline.clips.find(c=>c.shotId===shot.id)!.durationMs=24000;
  const split=splitMotionComicProductionUnits(document,shot.id,provider);
  const units=split.episodes[0].scenes.flatMap(s=>s.shots).filter(s=>s.productionUnit?.sourceShotId===shot.id);
  expect(units).toHaveLength(2);expect(units.every(s=>s.videoProduction?.referenceAudioAssetVersionIds?.length===0)).toBe(true);
  expect(()=>buildMotionComicShotVideoRequest(split,units[0])).toThrow('完整对白音频');
 });

});
