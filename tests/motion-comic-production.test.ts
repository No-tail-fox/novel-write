import {describe,it,expect} from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfiguredVideoProvider } from '../src/shared/video-provider';
import { startMockRelay } from './helpers/mock-relay';
import type { VideoProviderConfig } from '../src/shared/types';
import {createMotionComicDraft,createMotionComicStarterProject,parseMotionComicPipelineData,rebuildMotionComicEpisode,updateMotionComicShotDuration,validateMotionComicPipeline} from '../src/shared/motion-comic';
import {defaultConfig} from '../src/shared/config';
import {planMotionComicProductionUnits,splitMotionComicProductionUnits} from '../src/shared/motion-comic-production';
import {buildMotionComicShotVideoRequest,motionComicVideoInputHash,motionComicVideoInputFingerprintSource,motionComicVideoFrames,motionComicVideoReferences,selectMotionComicVideoRoute} from '../src/shared/motion-comic-video';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { resolveMotionComicStageState } from '../src/features/motion-comic/motion-comic-stage-state';
const now='2026-10-21T00:00:00.000Z';
function fixture(){
 const document=createMotionComicStarterProject(createMotionComicDraft({id:'production',title:'制作单元',premise:'雨夜一封信',now}));
 const episode=document.episodes[0],shot=episode.scenes[0].shots[0];
 shot.renderStrategy='remote-video';shot.firstFrameAssetVersionId='frame';shot.videoProduction={version:1,referenceMode:'references',audioMode:'post-mix'};
 document.assets.push({id:'frame',assetId:`shot-keyframe-${shot.id}`,kind:'image',localPath:'C:/frame.png',createdAt:now});
 for(const lookId of shot.characterLookIds){const look=document.characters.flatMap(c=>c.looks).find(l=>l.id===lookId)!;const id=`ref-${look.id}`;look.referenceAssetVersionIds=[id];document.assets.push({id,assetId:`reference-look-${look.id}`,kind:'image',localPath:`C:/${id}.png`,selected:true,pinned:true,createdAt:now});}
 const scene=document.sceneAssets.find(s=>s.id===shot.sceneAssetId)!;scene.referenceAssetVersionIds=['scene-ref'];document.assets.push({id:'scene-ref',assetId:`reference-scene-${scene.id}`,kind:'image',localPath:'C:/scene.png',selected:true,pinned:true,createdAt:now});shot.propAssetIds=[];
 const provider: VideoProviderConfig={...defaultConfig.video.providers[0],enabled:true,apiKey:'test',baseUrl:'https://video.invalid',model:'seedance-2.0',modelPreset:'seedance-2.0' as const,maxDurationSec:15,capabilities:['i2v','first-last-frame','reference-image','reference-audio','synchronized-audio'] as typeof defaultConfig.video.providers[0]['capabilities']};
 return {document,episode,shot,provider};
}
describe('motion comic explicit production inputs',()=>{
  it('builds frame-free asset references and fingerprints optional frames without weakening frames mode',()=>{
    const {document,shot}=fixture();
    const oldHash=motionComicVideoInputHash(document,shot,'p','m');
    delete shot.firstFrameAssetVersionId;
    const refs=motionComicVideoReferences(document,shot);
    const request=buildMotionComicShotVideoRequest(document,shot);
    expect(refs.map(r=>r.kind)).toEqual([...shot.characterLookIds.map(()=> 'character'),'scene']);
    expect(request.firstFramePath).toBeUndefined();
    expect(request.lastFramePath).toBeUndefined();
    expect(resolveMotionComicStageState(document,new Set(),false).video.ready).toBe(true);
    expect(resolveMotionComicStageState(document,new Set(),false).storyboard.complete).toBe(false);
    expect(request.referenceImages?.map(r=>r.path)).toEqual(refs.map(r=>r.path));
    expect(request.prompt).not.toContain('保持首帧中的');
    expect(motionComicVideoInputFingerprintSource(document,shot,'p','m').firstFrameAssetVersionId).toBeUndefined();
    const hash=motionComicVideoInputHash(document,shot,'p','m');expect(hash).not.toBe(oldHash);
    document.assets.find(a=>a.id===refs[0].assetVersionId)!.sha256='changed-reference';
    expect(motionComicVideoInputHash(document,shot,'p','m')).not.toBe(hash);
    shot.lastFrameAssetVersionId='frame';
    expect(motionComicVideoReferences(document,shot).at(-1)?.kind).toBe('ending');
    expect(buildMotionComicShotVideoRequest(document,shot).lastFramePath).toBeUndefined();
    expect(()=>motionComicVideoFrames(document,shot)).toThrow('FIRST_FRAME_REQUIRED');
    shot.videoProduction!.referenceMode='frames';
    expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('FIRST_FRAME_REQUIRED');
    delete shot.videoProduction;
    expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('FIRST_FRAME_REQUIRED');
  });
  it('never ignores missing references, explicitly selected broken frames, or empty reference input',()=>{
    for(const mutate of [
      (shot:ReturnType<typeof fixture>['shot'])=>{shot.characterLookIds=['missing-look'];},
      (shot:ReturnType<typeof fixture>['shot'])=>{shot.sceneAssetId='missing-scene';},
      (shot:ReturnType<typeof fixture>['shot'])=>{shot.propAssetIds=['missing-prop'];},
    ]) {
      const {document,shot}=fixture();delete shot.firstFrameAssetVersionId;mutate(shot);
      expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('REFERENCE_MISSING');
    }
    const {document,shot}=fixture();shot.firstFrameAssetVersionId='deleted-frame';
    expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('FRAME_INVALID');
    delete shot.firstFrameAssetVersionId;shot.lastFrameAssetVersionId='deleted-frame';
    expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('FRAME_INVALID');
    delete shot.lastFrameAssetVersionId;
    document.assets.find(a=>a.id==='scene-ref')!.pinned=false;
    expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('固定参考');
    shot.characterLookIds=[];shot.sceneAssetId='';shot.propAssetIds=[];
    expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('REFERENCE_REQUIRED');
  });
  it('requires actual reference capability and respects reference counts and budget without a first frame',()=>{
    const {document,shot,provider}=fixture();delete shot.firstFrameAssetVersionId;provider.pricePerSecond=1;
    const config=structuredClone(defaultConfig);config.video.providers=[provider];config.video.activeProviderId=provider.id;config.video.automation.providerWhitelist=[provider.id];
    const selection=selectMotionComicVideoRoute(config,document,shot,100);
    expect(selection.capabilities).toEqual(['reference-image']);expect(selection.route.kind).toBe('provider');
    expect(selectMotionComicVideoRoute(config,document,shot,0).route.kind).not.toBe('provider');
    provider.model='custom-model';provider.modelPreset='custom' as never;provider.capabilities=['t2v','i2v'];
    expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).not.toBe('provider');
    provider.capabilities=['reference-image'];
    shot.characterLookIds=Array(10).fill(shot.characterLookIds[0]);
    expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).not.toBe('provider');
  });
 it('submits ordered confirmed references and preserves complete authored dialogue',()=>{
  const {document,shot}=fixture();shot.videoProduction!.audioMode='native';const refs=motionComicVideoReferences(document,shot),request=buildMotionComicShotVideoRequest(document,shot);
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
 it('does not submit or fingerprint inactive audio references after switching to post-mix',()=>{
   const {document,shot}=fixture();
   const baseline=motionComicVideoInputHash(document,shot,'p','m');
   shot.videoProduction={...shot.videoProduction!,audioMode:'post-mix',referenceAudioAssetVersionIds:['deleted-old-dialogue']};
   const request=buildMotionComicShotVideoRequest(document,shot);
   expect(request.referenceAudioPaths).toBeUndefined();
   expect(request.generateAudio).toBe(false);
   expect(motionComicVideoInputHash(document,shot,'p','m')).toBe(baseline);
   shot.videoProduction.audioMode='audio-driven';
   expect(()=>buildMotionComicShotVideoRequest(document,shot)).toThrow('参考声音文件已失效');
 });
 it('does not report a provider ready when below model duration or native sound unsupported',()=>{
  const {document,shot,provider}=fixture();const config=structuredClone(defaultConfig);config.video.providers=[provider];config.video.activeProviderId=provider.id;config.video.automation.providerWhitelist=[provider.id];config.video.automation.budgetLimit=100;
  expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).toBe('provider');
  shot.durationMs=2000;expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).not.toBe('provider');
  shot.durationMs=7000;shot.videoProduction!.audioMode='native';provider.capabilities=provider.capabilities.filter(c=>c!=='synchronized-audio');expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).not.toBe('provider');
 });
 it.each(['MiniMax-H3', 'MiniMax-H3-768p', 'unknown-video-model'])('requires explicit native audio capability for %s', (model)=>{
  const {document,shot,provider}=fixture();const config=structuredClone(defaultConfig);
  provider.model=model;delete provider.modelPreset;shot.durationMs=7000;shot.videoProduction!.audioMode='native';
  config.video.providers=[provider];config.video.activeProviderId=provider.id;config.video.automation.providerWhitelist=[provider.id];config.video.automation.budgetLimit=100;
  const selected=selectMotionComicVideoRoute(config,document,shot,100);
  expect(selected.request.generateAudio).toBe(true);
  expect(selected.capabilities).toContain('synchronized-audio');
  expect(selected.route.kind).toBe('provider');
  provider.capabilities=provider.capabilities.filter(c=>c!=='synchronized-audio');
  expect(selectMotionComicVideoRoute(config,document,shot,100).route.kind).not.toBe('provider');
 });
 it('submits native H3 through capability validation without an unsupported audio flag',async()=>{
  const relay=await startMockRelay();const dir=await mkdtemp(join(tmpdir(),'storydream-native-h3-'));
  try {
   const {document,shot,provider}=fixture();const config=structuredClone(defaultConfig);
   provider.model='MiniMax-H3-768p';delete provider.modelPreset;
   provider.baseUrl=relay.origin;provider.submitPath='/videos/generations';provider.maxResolution='768P';
   shot.durationMs=7000;shot.videoProduction!.audioMode='native';delete shot.firstFrameAssetVersionId;
   // Remote reference URLs are serialized without fetching them in this offline adapter check.
   for(const asset of document.assets)if(asset.kind==='image')asset.localPath='https://reference.invalid/'+asset.id+'.png';
   config.video.providers=[provider];config.video.activeProviderId=provider.id;config.video.automation.providerWhitelist=[provider.id];config.video.automation.budgetLimit=100;
   const selected=selectMotionComicVideoRoute(config,document,shot,100);
   expect(selected.route.kind).toBe('provider');
   const adapter=createConfiguredVideoProvider(config,dir,{durationSec:7,requiredCapabilities:selected.capabilities,remainingBudget:100});
   relay.enqueue({kind:'json',body:{b64_json:Buffer.from('offline-video').toString('base64')}});
   await adapter.generate(selected.request);
   expect(relay.requests).toHaveLength(1);
   expect(relay.requests[0].json).toMatchObject({model:'MiniMax-H3-768p',duration:7,ratio:document.ratio});
   expect(relay.requests[0].json).not.toHaveProperty('generate_audio');
   provider.capabilities=provider.capabilities.filter(c=>c!=='synchronized-audio');
   expect(()=>createConfiguredVideoProvider(config,dir,{durationSec:7,requiredCapabilities:selected.capabilities,remainingBudget:100})).toThrow('VIDEO_PROVIDER_NOT_CONFIGURED');
   expect(relay.requests).toHaveLength(1);
  } finally {await relay.close();await rm(dir,{recursive:true,force:true});}
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
 it.each([15000, 3500])('requests the edited duration %i after resizing a production unit', (durationMs)=>{
    const {document,episode,shot,provider}=fixture();
    shot.durationMs=20000;shot.dialogueCueIds=[];
    episode.dialogueCues=episode.dialogueCues.filter(c=>c.shotId!==shot.id);
    episode.timeline.clips.find(c=>c.shotId===shot.id)!.durationMs=20000;
    const split=splitMotionComicProductionUnits(document,shot.id,provider);
    const units=split.episodes[0].scenes.flatMap(s=>s.shots).filter(s=>s.productionUnit?.sourceShotId===shot.id);
    const unit=units[1];
    expect(unit.durationMs).toBe(5000);
    expect(buildMotionComicShotVideoRequest(split,unit).durationSec).toBe(5);
    expect(updateMotionComicShotDuration(split,episode.id,unit.id,5000)).toBe(split);
    const resized=updateMotionComicShotDuration(split,episode.id,unit.id,durationMs);
    const restored=parseMotionComicPipelineData(JSON.stringify(resized));
    const edited=restored.episodes[0].scenes.flatMap(s=>s.shots).find(s=>s.id===unit.id)!;
    expect(edited.productionUnit).toBeUndefined();
    expect(buildMotionComicShotVideoRequest(restored,edited).durationSec).toBe(Math.ceil(durationMs/1000));
    expect(restored.episodes[0].scenes[0].shots[0].productionUnit).toEqual(units[0].productionUnit);
    expect(unit.productionUnit?.generationDurationSec).toBe(5);
    expect(validateMotionComicPipeline(restored)).toEqual([]);
  });
  it('renders complete existing dialogue after a 24-second shot splits into 9/15-second units',()=>{
    const {document,episode,shot,provider}=fixture();
    shot.durationMs=24000;
    const template=episode.dialogueCues.find(c=>c.id===shot.dialogueCueIds[0])!;
    const lines=[{id:'a',startMs:0,endMs:9000},{id:'b',startMs:9000,endMs:17000},{id:'c',startMs:17000,endMs:24000}];
    episode.dialogueCues=episode.dialogueCues.filter(c=>c.shotId!==shot.id).concat(lines.map(c=>({...template,...c,text:`完整对白 ${c.id}`,voiceAssetVersionId:`voice-${c.id}`,audioAssetVersionId:`voice-${c.id}`})));
    shot.dialogueCueIds=lines.map(c=>c.id);
    episode.timeline.clips.find(c=>c.shotId===shot.id)!.durationMs=24000;
    document.assets.push(...lines.map(c=>({id:`voice-${c.id}`,assetId:`voice-${c.id}`,kind:'audio' as const,localPath:`C:/voice-${c.id}.wav`,durationMs:c.endMs-c.startMs,createdAt:now})),{id:'music',assetId:'music',kind:'audio',localPath:'C:/music.wav',durationMs:25000,createdAt:now});
    episode.timeline.audioClips=[...lines.map(c=>({id:`dialogue-clip-${c.id}`,shotId:shot.id,assetVersionId:`voice-${c.id}`,trackType:'dialogue' as const,startMs:c.startMs,durationMs:c.endMs-c.startMs,sourceStartMs:0,sourceDurationMs:c.endMs-c.startMs})),{id:'music-clip',shotId:shot.id,assetVersionId:'music',trackType:'music',startMs:0,durationMs:24000,sourceStartMs:1000,sourceDurationMs:24000,sourceMediaDurationMs:25000,gainDb:-8}];
    document.episodes[0]=rebuildMotionComicEpisode(episode);
    const split=parseMotionComicPipelineData(JSON.stringify(splitMotionComicProductionUnits(document,shot.id,provider)));
    const owner=split.episodes[0];
    const units=owner.scenes.flatMap(s=>s.shots).filter(s=>s.productionUnit?.sourceShotId===shot.id);
    expect(units.map(s=>s.durationMs)).toEqual([9000,15000]);
    expect(owner.timeline.audioClips?.filter(c=>c.trackType==='dialogue').map(c=>c.id)).toEqual(['dialogue-clip-a','dialogue-clip-b','dialogue-clip-c']);
    expect(owner.timeline.audioClips?.filter(c=>c.trackType==='music')).toEqual([
      expect.objectContaining({id:'music-clip-unit-1',shotId:units[0].id,startMs:0,durationMs:9000,sourceStartMs:1000,sourceDurationMs:9000}),
      expect.objectContaining({id:'music-clip-unit-2',shotId:units[1].id,startMs:9000,durationMs:15000,sourceStartMs:10000,sourceDurationMs:15000}),
    ]);
    for(const unit of units){
      unit.videoAssetVersionId=`video-${unit.id}`;unit.videoJobId=`job-${unit.id}`;
      split.assets.push({id:unit.videoAssetVersionId,assetId:`shot-video-${unit.id}`,kind:'video',localPath:`C:/${unit.id}.mp4`,providerJobId:unit.videoJobId,durationMs:unit.durationMs,createdAt:now});
      split.providerJobs.push({id:unit.videoJobId,workflowKind:'motion-comic',nodeId:unit.id,episodeId:owner.id,providerId:provider.id,model:provider.model,capability:'image-to-video',status:'completed',inputHash:motionComicVideoInputHash(split,unit,provider.id,provider.model),idempotencyKey:unit.id,estimatedCost:0,attempt:1,createdAt:now,updatedAt:now});
    }
    expect(validateMotionComicPipeline(split)).toEqual([]);
    const scenes=buildDirectorRenderScenes(split,owner.id,{shotIds:units.map(s=>s.id)});
    expect(scenes.map(s=>s.durationMs)).toEqual([9000,15000]);
    expect(scenes.map(s=>s.audioClips?.filter(c=>c.trackType==='dialogue').map(c=>[c.id,c.startMs,c.durationMs,c.sourceStartMs]))).toEqual([
      [['dialogue-clip-a',0,9000,0]],
      [['dialogue-clip-b',0,8000,0],['dialogue-clip-c',8000,7000,0]],
    ]);
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
