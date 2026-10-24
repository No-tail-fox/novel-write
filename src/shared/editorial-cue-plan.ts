import { z } from 'zod';
import type { EditorialCollageLayer } from './editorial-collage';
import type { EditorialMotionStyle } from './editorial-motion';
import type { ProductionSubtitleCue, ProductionSubtitleToken } from './production-workflow';
import { hashSubtitleText, isSubtitleAlignmentValid } from './audio-alignment';

export const editorialCuePlanSchema = z.object({
 version:z.literal(1), narrationHash:z.string().min(1).max(256),
 beats:z.array(z.object({
  id:z.string().min(1).max(256),purpose:z.enum(['reveal','evidence','compare','path','focus']),
  cueId:z.string().min(1).max(256), sourceStart:z.number().int().nonnegative(),sourceEnd:z.number().int().positive(),
  text:z.string().min(1).max(10000), occurrence:z.number().int().positive(),
  targetLayerIds:z.array(z.string().min(1).max(256)).min(1).max(6),
  action:z.enum(['reveal','emphasize','move','dim']),durationMs:z.number().int().min(50).max(3000),
 }).strict()).max(100),
}).strict();
export type EditorialCuePlan=z.infer<typeof editorialCuePlanSchema>;
export type ResolvedEditorialBeat = EditorialCuePlan['beats'][number] & {
 startMs:number;endMs:number;timingSource:'provider'|'whisper'|'manual'|'estimated';confidence?:number;
 timingPrecision:'token-boundary'|'estimated';
 timingReason:'matched-token-boundaries'|'alignment-unavailable'|'token-text-mismatch'|'partial-token';
}
const occurrenceAt=(text:string,phrase:string,end:number)=>{let count=0,index=0;while(index<=end){const found=text.indexOf(phrase,index);if(found<0||found>end)break;count++;index=found+Math.max(1,phrase.length);}return count;};
/** Source spans refer to the exact concatenated authored cues, including punctuation. */
export function createEditorialCuePlan(cues:readonly ProductionSubtitleCue[],layers:readonly EditorialCollageLayer[],style?:EditorialMotionStyle):EditorialCuePlan {
 const narration=cues.map(c=>c.text).join('');let cursor=0;
 const subjects=layers.filter(layer=>['subject','archival','map'].includes(layer.kind)&&layer.visible!==false);
 const labels=layers.filter(layer=>layer.content?.text.trim()&&layer.visible!==false);
 const targets=subjects.length?subjects:labels;
 const purpose=style==='evidence-stack'?'evidence':style==='comparison'?'compare':style==='path-progress'?'path':'focus';
 return {version:1,narrationHash:hashSubtitleText(narration),beats:cues.flatMap((cue,i)=>{
  const start=cursor;cursor+=cue.text.length;if(!cue.text||!targets.length)return [];
  const target=targets[i%targets.length];
  return [{id:`${cue.id}-visual`,purpose,cueId:cue.id,sourceStart:start,sourceEnd:cursor,text:cue.text,occurrence:occurrenceAt(narration,cue.text,start),targetLayerIds:[target.id],action:i===0||i<targets.length?'reveal':purpose==='path'?'move':'emphasize',durationMs:600}];
 })};
}

/** Preserve authored UTF-16 offsets while ignoring only untimed whitespace. */
function compactSource(text:string) {
 const chars:Array<{start:number;end:number;compactStart:number;compactEnd:number}>=[];let compact='';let offset=0;
 for(const char of text){
  if(!/\s/u.test(char)){const compactStart=compact.length;compact+=char;for(let i=0;i<char.length;i++)chars.push({start:offset,end:offset+char.length,compactStart:compactStart+i,compactEnd:compactStart+i+1});}
  offset+=char.length;
 }
 return {compact,chars};
}

function phraseTokens(cue:ProductionSubtitleCue,start:number,end:number):{tokens?:ProductionSubtitleToken[];reason:ResolvedEditorialBeat['timingReason']} {
 if(!isSubtitleAlignmentValid(cue)||!['provider','whisper','manual'].includes(cue.alignmentSource??''))return {reason:'alignment-unavailable'};
 const source=compactSource(cue.text),tokens=cue.tokens??[];
 const texts=tokens.map(token=>token.text.replace(/\s/gu,''));
 // Legacy files without text hashes may contain valid times for unrelated words.
 if(!source.compact||texts.some(text=>!text)||texts.join('')!==source.compact)return {reason:'token-text-mismatch'};
 const first=source.chars.findIndex(char=>char.start>=start&&char.end<=end);
 let last=first;while(last+1<source.chars.length&&source.chars[last+1].end<=end)last++;
 if(first<0)return {reason:'partial-token'};
 let cursor=0;const spans=texts.map(text=>{const span={start:cursor,end:cursor+text.length};cursor=span.end;return span;});
 const from=spans.findIndex(span=>span.start===source.chars[first].compactStart),to=spans.findIndex(span=>span.end===source.chars[last].compactEnd);
 // A timestamp for “向右” does not measure the interior character “右”.
 if(from<0||to<from)return {reason:'partial-token'};
 return {tokens:tokens.slice(from,to+1),reason:'matched-token-boundaries'};
}

export function resolveEditorialCuePlan(plan:EditorialCuePlan,cues:readonly ProductionSubtitleCue[],shotStartMs:number,durationMs:number):ResolvedEditorialBeat[] {
 const narration=cues.map(c=>c.text).join('');
 if(hashSubtitleText(narration)!==plan.narrationHash)throw new Error('EDITORIAL_CUE_PLAN_STALE: 旁白已修改，请重新选择动作样式以更新语义节拍。');
 let cursor=0;
 const spans=cues.map(cue=>{const span={cue,start:cursor,end:cursor+cue.text.length};cursor=span.end;return span;});
 return plan.beats.map(beat=>{
  const span=spans.find(({cue})=>cue.id===beat.cueId);
  if(!span||beat.sourceStart<span.start||beat.sourceEnd>span.end||beat.sourceEnd<=beat.sourceStart||narration.slice(beat.sourceStart,beat.sourceEnd)!==beat.text||occurrenceAt(narration,beat.text,beat.sourceStart)!==beat.occurrence)throw new Error('EDITORIAL_CUE_PLAN_STALE: 节拍原文位置或字幕引用已失效。');
  const {cue}=span,localStart=beat.sourceStart-span.start,localEnd=beat.sourceEnd-span.start;
  const matched=phraseTokens(cue,localStart,localEnd),tokens=matched.tokens;
  const estimatedAt=(offset:number)=>cue.startMs+(cue.endMs-cue.startMs)*offset/cue.text.length;
  const start=Math.max(0,Math.min(durationMs,Math.round((tokens?.[0]?.startMs??estimatedAt(localStart))-shotStartMs)));
  const phraseEnd=Math.min(durationMs,Math.round((tokens?.at(-1)?.endMs??estimatedAt(localEnd))-shotStartMs));
  const confidence=tokens?.every(token=>token.confidence!==undefined)?Math.min(...tokens.map(token=>token.confidence!)):undefined;
  return {...beat,startMs:start,endMs:Math.max(start,Math.min(phraseEnd,start+beat.durationMs)),timingSource:tokens?cue.alignmentSource as 'provider'|'whisper'|'manual':'estimated',timingPrecision:tokens?'token-boundary':'estimated',timingReason:matched.reason,...(confidence===undefined?{}:{confidence})};
 });
}

/** Both rendering engines consume these same deterministic keyframes. */
export function compileEditorialCueLayers(layers:readonly EditorialCollageLayer[],beats:readonly ResolvedEditorialBeat[],durationMs:number):EditorialCollageLayer[] {
 const ids=new Set(layers.map(layer=>layer.id));
 for(const beat of beats)if(beat.targetLayerIds.some(id=>!ids.has(id)))throw new Error('EDITORIAL_CUE_TARGET_MISSING: 语义节拍的目标图层已删除，请更新动作样式。');
 return layers.map(layer=>{
  const actions=beats.filter(beat=>beat.targetLayerIds.includes(layer.id)&&beat.endMs>beat.startMs);
  if(!actions.length)return layer;
  const settled=(actions[0].purpose==='path'?layer.motion.find(frame=>frame.opacity===1):layer.motion.filter(frame=>frame.opacity===1&&frame.atMs<=durationMs*.95).at(-1))??layer.motion[0]??{atMs:0,x:.5,y:.5,scale:1,rotation:0,opacity:1};
  const first=actions[0];let state={...settled,atMs:0,opacity:first.action==='reveal'?0:1};
  const motion=[{...state}];
  for(const beat of actions){
   const start=Math.max(motion.at(-1)!.atMs,beat.startMs);const end=Math.max(start,beat.endMs);
   motion.push({...state,atMs:start});
   if(beat.action==='reveal')motion.push({...state,atMs:start,y:state.y+.035,scale:state.scale*.94,opacity:0});
   const next={...state,atMs:end,opacity:beat.action==='dim'?.35:1};
   if(beat.action==='move'){next.x=Math.min(.8,state.x+.3);next.y=.57;}
   if(beat.action==='emphasize'){motion.push({...state,atMs:Math.round((start+end)/2),scale:state.scale*1.08,opacity:1});}
   motion.push(next);state=next;
  }
  motion.push({...state,atMs:durationMs});
  return {...layer,motion};
 });
}
