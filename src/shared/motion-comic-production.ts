import { rebuildMotionComicEpisode, invalidateMotionComicShotVideo, type MotionComicPipelineData, type MotionComicShot } from './motion-comic';
import { motionComicVideoDialogue } from './motion-comic-video';
import { videoModelLimits } from './video-models';
import { materializeProductionAudioClipsForShot, sliceProductionAudioClip } from './production-audio';
import type { VideoProviderConfig } from './types';

export interface MotionComicProductionUnit { index:number;startMs:number;endMs:number;generationDurationSec:number;cueIds:string[] }

/** Keep complete utterances together. Only silence may be cut at an arbitrary time. */
export function planMotionComicProductionUnits(document:MotionComicPipelineData,shot:MotionComicShot,provider:VideoProviderConfig):MotionComicProductionUnit[] {
 const limits=videoModelLimits(provider),maxMs=Math.floor(limits.maxDuration)*1000;
 if(maxMs<1000)throw new Error('MOTION_COMIC_UNIT_MODEL_INVALID: 模型可用时长不足一秒。');
 const cues=motionComicVideoDialogue(document,shot).map(c=>{
  const audio=document.assets.find(a=>a.id===c.audioAssetVersionId);
  const endMs=Math.max(c.endMs,c.startMs+(audio?.durationMs??0));
  if(c.startMs<0||endMs>shot.durationMs)throw new Error('MOTION_COMIC_UNIT_AUDIO_OVERFLOW: 实测对白超过镜头边界，请先校准镜头和对白时长。');
  if(endMs-c.startMs>maxMs)throw new Error('MOTION_COMIC_UNIT_DIALOGUE_TOO_LONG: 一句对白超过模型最长时长，请先按语义拆句并重新配音。');
  return {...c,endMs};
 });
 const result:MotionComicProductionUnit[]=[];let startMs=0;
 while(startMs<shot.durationMs) {
  let endMs=Math.min(shot.durationMs,startMs+maxMs);
  // Walk back over overlapping utterances until the cut lies in a genuine gap.
  while(true){const crossing=cues.find(c=>c.startMs<endMs&&c.endMs>endMs);if(!crossing)break;endMs=crossing.startMs;}
  if(endMs<=startMs)throw new Error('MOTION_COMIC_UNIT_OVERLAPPING_DIALOGUE: 重叠对白跨越模型时长限制，请先调整对白边界。');
  result.push({index:result.length+1,startMs,endMs,generationDurationSec:Math.max(limits.minDuration,Math.ceil((endMs-startMs)/1000)),cueIds:cues.filter(c=>c.startMs>=startMs&&c.endMs<=endMs).map(c=>c.id)});
  startMs=endMs;
 }
 return result;
}

/** An explicit edit: preserves audio source trims and dialogue, requires new interior keyframes. */
export function splitMotionComicProductionUnits(document:MotionComicPipelineData,shotId:string,provider:VideoProviderConfig):MotionComicPipelineData {
 const owner=document.episodes.find(e=>e.scenes.some(s=>s.shots.some(shot=>shot.id===shotId)));
 const source=owner?.scenes.flatMap(s=>s.shots).find(shot=>shot.id===shotId);
 if(!owner||!source)throw new Error('MOTION_COMIC_SHOT_MISSING: 当前镜头不存在。');
 const units=planMotionComicProductionUnits(document,source,provider);
 if(units.length===1&&units[0].generationDurationSec===Math.ceil(source.durationMs/1000))return document;
 const base=invalidateMotionComicShotVideo(document,shotId);
 const start=owner.timeline.clips.find(c=>c.shotId===shotId)?.startMs??0;
 const audio=materializeProductionAudioClipsForShot(owner.timeline,source);
 const usedIds=new Set(document.episodes.flatMap(e=>e.scenes.flatMap(s=>s.shots.map(shot=>shot.id))));
 const unitId=(index:number)=>{const baseId=`${shotId.slice(0,220)}-unit-${index+1}`;let id=baseId,n=1;while(usedIds.has(id))id=`${baseId}-${n++}`;usedIds.add(id);return id;};
 const shots=units.map((unit,index):MotionComicShot=>({...source,id:unitId(index),index:source.index+index,title:`${source.title} · ${index+1}/${units.length}`,
  videoProduction:source.videoProduction?{...source.videoProduction,...(units.length>1&&source.videoProduction.audioMode==='audio-driven'?{referenceAudioAssetVersionIds:[]}: {})}:undefined,
  durationMs:unit.endMs-unit.startMs,dialogueCueIds:unit.cueIds,firstFrameAssetVersionId:index===0?source.firstFrameAssetVersionId:undefined,
  lastFrameAssetVersionId:index===units.length-1?source.lastFrameAssetVersionId:undefined,videoAssetVersionId:undefined,videoJobId:undefined,voiceAssetVersionId:undefined,
  productionUnit:{sourceShotId:source.productionUnit?.sourceShotId??source.id,sourceStartMs:(source.productionUnit?.sourceStartMs??0)+unit.startMs,sourceEndMs:(source.productionUnit?.sourceStartMs??0)+unit.endMs,index:index+1,total:units.length,generationDurationSec:unit.generationDurationSec},
  continuity:source.continuity?{...source.continuity,startState:index===0?source.continuity.startState:'待确认：承接上一制作单元末尾的人物、道具和屏幕方向',endState:index===units.length-1?source.continuity.endState:'待确认：为下一制作单元记录人物、道具和屏幕方向'}:undefined,
 }));
 const nextEpisode={...owner,
  scenes:owner.scenes.map(scene=>({...scene,shots:scene.shots.flatMap(shot=>shot.id===source.id?shots:shot)})),
  dialogueCues:owner.dialogueCues.map(cue=>{const shot=shots.find(s=>s.dialogueCueIds.includes(cue.id));return shot?{...cue,shotId:shot.id}:cue;}),
  timeline:{...owner.timeline,
   clips:owner.timeline.clips.flatMap(clip=>clip.shotId===shotId?units.map((u,i)=>({...clip,id:`clip-${shots[i].id}`,shotId:shots[i].id,startMs:start+u.startMs,durationMs:u.endMs-u.startMs,subtitleCueIds:u.cueIds,assetVersionIds:clip.assetVersionIds.filter(id=>id===shots[i].firstFrameAssetVersionId||id===shots[i].lastFrameAssetVersionId)})):clip),
   audioClips:[...(owner.timeline.audioClips??[]).filter(c=>c.shotId!==shotId),...units.flatMap((u,i)=>audio.flatMap(clip=>{const sliced=sliceProductionAudioClip(clip,start+u.startMs,start+u.endMs,start+source.durationMs);return sliced?[{...sliced,id:`${clip.id}-unit-${i+1}`,shotId:shots[i].id}]:[];}))],
  },
 };
 return {...base,updatedAt:document.updatedAt,stage:'shot-board',qualityReports:base.qualityReports.filter(r=>r.episodeId!==owner.id),assets:base.assets.map(a=>a.assetId==='director-final-video'&&a.episodeId===owner.id?{...a,selected:false,pinned:false}:a),episodes:base.episodes.map(e=>e.id===owner.id?rebuildMotionComicEpisode(nextEpisode):e)};
}
