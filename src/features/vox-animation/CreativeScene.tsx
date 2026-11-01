import React, { type CSSProperties } from 'react';
import { AbsoluteFill, Img } from 'remotion';
import type { VoxAnimationPayload } from '../../shared/vox-animation';
import { creativeClamp as clamp, creativeEase as ease, creativeLayout, creativeMotion, creativePalette, creativeRenderSpec, type CreativeRect, type CreativeRenderSpec } from '../../shared/creative-animation/render-spec';
import { buildCreativeTextSvg, creativeCueAnnotation } from '../../shared/creative-animation/text-layer';

type Layer = NonNullable<VoxAnimationPayload['semanticLayers']>[number];
const boxStyle = (r: CreativeRect): CSSProperties => ({ position: 'absolute', left: `${r.x*100}%`, top: `${r.y*100}%`, width: `${r.width*100}%`, height: `${r.height*100}%` });
function pose(layer: Layer, ms: number) {
  const frames=layer.motion; let from=frames[0],to=frames.at(-1);
  for(let i=1;i<frames.length;i++)if(frames[i].atMs>=ms){from=frames[i-1];to=frames[i];break;}
  const base={x:.5,y:.5,scale:1,rotation:0,opacity:1};if(!from||!to)return base;
  const t=clamp((ms-from.atMs)/Math.max(1,to.atMs-from.atMs));
  return Object.fromEntries(Object.keys(base).map(key=>[key,from![key as keyof typeof base]+(to![key as keyof typeof base]-from![key as keyof typeof base])*t])) as typeof base;
}
function reveal(spec: CreativeRenderSpec, progress: number, width: number): CSSProperties {
  const t=clamp(progress);
  if(spec.reveal==='draw')return {clipPath:`polygon(0 0, ${t*100}% 0, ${Math.min(100,t*100+1.5)}% 19%, ${t*100}% 45%, ${Math.min(100,t*100+1)}% 74%, ${t*100}% 100%,0 100%)`};
  if(spec.reveal==='wash')return {clipPath:`ellipse(${t*86}% ${t*93}% at 42% 48%)`,opacity:Math.min(1,t*2.5)};
  if(spec.reveal==='iris')return {clipPath:`circle(${t*75}% at 50% 50%)`};
  if(spec.reveal==='scan')return {clipPath:`inset(0 0 ${(1-t)*100}% 0)`};
  if(['wipe','print','scroll'].includes(spec.reveal))return {clipPath:`inset(0 ${(1-t)*100}% 0 0)`,transform:spec.reveal==='scroll'?`translateX(${Math.round((1-t)*width*.04)}px)`:undefined};
  if(spec.reveal==='hinge')return {transform:`perspective(${width}px) rotateX(${(1-t)*-86}deg)`,transformOrigin:'50% 100%',opacity:t>0?1:0};
  if(spec.reveal==='stamp')return {transform:`scale(${1+Math.pow(1-t,3)*.55}) rotate(${spec.tilt*(1-t)}deg)`,opacity:t>0?1:0};
  if(spec.reveal==='snap')return {clipPath:`inset(0 ${(1-Math.ceil(t*5)/5)*100}% 0 0)`};
  if(spec.reveal==='assemble')return {transform:`translateY(${(1-t)*-width*.06}px)`,opacity:t>0?1:0};
  if(spec.reveal==='elastic')return {transform:`translateY(${(1-t)*width*.04}px) scale(${1+Math.sin(t*Math.PI*2)*(1-t)*.12},${1-Math.sin(t*Math.PI*2)*(1-t)*.12})`,opacity:t>0?1:0};
  if(spec.reveal==='pose')return {transform:`translateX(${Math.round((1-t)*width*.025)}px) rotate(${spec.tilt*(1-t)}deg)`,opacity:t>0?1:0};
  return {opacity:t,transform:`scale(${.97+t*.03})`};
}
function Material({spec,ink,accent,w,h}:{spec:CreativeRenderSpec;ink:string;accent:string;w:number;h:number}) {
  const dots=['halftone','print'].includes(spec.material),draft=spec.material==='draft',crt=spec.material==='phosphor';
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{position:'absolute',inset:0,pointerEvents:'none'}} aria-hidden="true">
    <defs><pattern id="creative-dots" width="13" height="13" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r={spec.material==='halftone'?1.8:.7} fill={ink}/></pattern><pattern id="creative-grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke={accent} strokeWidth=".6"/></pattern><pattern id="creative-scan" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 1H5" stroke={ink} strokeWidth="1"/></pattern><pattern id="creative-grain" width="47" height="37" patternUnits="userSpaceOnUse"><path d="M2 5h2 M24 17h1 M40 28h2 M8 32h1" stroke={ink} strokeWidth=".6"/></pattern></defs>
    {dots?<><rect width={w*.19} height={h*.84} fill="url(#creative-dots)" opacity=".13"/><rect x={w*.86} width={w*.14} height={h*.84} fill="url(#creative-dots)" opacity=".2"/></>:null}
    {draft?<rect width={w} height={h*.84} fill="url(#creative-grid)" opacity=".17"/>:null}
    {crt?<rect width={w} height={h} fill="url(#creative-scan)" opacity=".09"/>:null}
    {['paper','ink','paint','film'].includes(spec.material)?<rect width={w} height={h} fill="url(#creative-grain)" opacity=".16"/>:null}
    {spec.layout==='theatre'?<path d={`M${w*.09} ${h*.79}H${w*.91}`} stroke={accent} strokeWidth="1" opacity=".4"/>:null}
    {spec.layout==='grid'?<path d={`M${w*.385} ${h*.29}V${h*.78} M${w*.06} ${h*.26}H${w*.93}`} fill="none" stroke={ink} strokeWidth="1" opacity=".32"/>:null}
    {spec.layout==='game'?<path d={`M${w*.12} ${h*.62}H${w*.88} M${w*.16} ${h*.62}v${h*.025} M${w*.84} ${h*.62}v${h*.025}`} stroke={ink} strokeWidth="4" fill="none"/>:null}
  </svg>;
}
function Type({text,rect,styleId,w,h,note=false,progress=1}:{text:string;rect:CreativeRect;styleId:string;w:number;h:number;note?:boolean;progress?:number}) {
  return <div style={boxStyle(rect)} dangerouslySetInnerHTML={{__html:buildCreativeTextSvg(text,w*rect.width,h*rect.height,styleId,{note,progress})}}/>;
}
/** Shared deterministic scene for preview and final render. */
export function CreativeScene({payload,frame}:{payload:VoxAnimationPayload;frame:number}) {
  const styleId=payload.animation.creativeStyle!.styleId;
  const spec=creativeRenderSpec(styleId),palette=creativePalette(styleId);
  if(!spec||!palette)throw new Error('CREATIVE_STYLE_MISSING: '+styleId);
  const w=payload.width,h=payload.height,ms=frame/payload.fps*1000;
  const p=payload.animation.template.props,layout=creativeLayout(spec,w,h);
  const camera=creativeMotion(spec,ms,0,payload.durationMs,payload.durationMs);
  // Narration is the clock; use the original authored cue spans and words.
  const cues=payload.cues.filter(c=>c.text.trim());
  const active=cues.filter(c=>c.startMs<=ms).at(-1)??cues[0];
  const cueStart=active?.tokens?.[0]?.startMs??active?.startMs??0;
  const cueEnd=active?.endMs??payload.durationMs;
  const cueMotion=creativeMotion(spec,ms,cueStart,cueEnd,payload.durationMs);
  const supplied=payload.semanticLayers??[],visible=supplied.filter(l=>l.visible!==false);
  const backgrounds=visible.filter(l=>l.kind==='background');
  const authoredSubjects=supplied.filter(l=>!l.content&&l.kind!=='background');
  let subjects=visible.filter(l=>!l.content&&l.kind!=='background'&&payload.assets.some(a=>a.id===l.assetId));
  // A hidden subject stays hidden; a background plate never becomes a second subject.
  if(!authoredSubjects.length) {
    const ids=p.assetIds.filter(id=>!supplied.some(l=>l.kind==='background'&&l.assetId===id)&&payload.assets.some(a=>a.id===id&&a.kind==='image')).slice(0,4);
    subjects=ids.map((id,i)=>({id:'asset-'+i,assetId:id,kind:'subject',zIndex:10+i,depth:.12,width:layout.subject.width/ids.length,height:layout.subject.height,motion:[{atMs:0,x:layout.subject.x+layout.subject.width*(i+.5)/ids.length,y:layout.subject.y+layout.subject.height/2,scale:1,rotation:0,opacity:1}]}));
  }
  const titleLayer=supplied.find(l=>l.content?.text.trim()===p.title.trim());
  const labels=visible.filter(l=>l.content?.text.trim()&&l.id!==titleLayer?.id);
  const matte=['board','paper','ink','draft','print'].includes(spec.material);
  const cueText=active?.text??p.subtitle;
  const note=subjects.length?(p.highlight.trim()||creativeCueAnnotation(cueText)):cueText;
  const relationship=['board','technical','diagram','archive'].includes(spec.layout);
  const relation=ease(clamp((ms-cueStart)/Math.min(600,spec.durationMs*.55)));
  const labelProgress=relationship?ease(clamp((ms-cueStart-spec.durationMs*.28)/Math.max(100,spec.durationMs*.6))):cueMotion.progress;
  const noteBelow=layout.note.y>=layout.subject.y+layout.subject.height*.9;
  const noteLeft=layout.note.x+layout.note.width<=layout.subject.x;
  const left=layout.subject.x+layout.subject.width*(noteBelow?.5:noteLeft?0:1),top=layout.subject.y+layout.subject.height*(noteBelow?1:.5);
  const nx=layout.note.x+layout.note.width*(noteBelow?.5:noteLeft?1:0),ny=layout.note.y+layout.note.height*(noteBelow?0:.5);
  const layerText=(layer:Layer,title=false)=>{
    const state=pose(layer,ms),beat=payload.semanticBeats?.find(b=>b.targetLayerIds.includes(layer.id));
    const progress=beat?creativeMotion(spec,ms,beat.startMs,cues.find(c=>c.id===beat.cueId)?.endMs??beat.endMs,payload.durationMs).progress:1;
    const width=(layer.width??.25)*state.scale,height=(layer.height??.15)*state.scale;
    const rect={x:state.x-width/2,y:state.y-height/2,width,height};
    return <div key={layer.id} style={{position:'absolute',inset:0,zIndex:layer.zIndex,opacity:state.opacity,transform:'rotate('+state.rotation+'deg)',transformOrigin:(state.x*100)+'% '+(state.y*100)+'%'}}><Type text={layer.content!.text} rect={rect} styleId={styleId} w={w} h={h} note={!title} progress={title?1:progress}/></div>;
  };
  return <AbsoluteFill data-creative-style={styleId} data-creative-layout={spec.layout} style={{background:p.background,color:p.foreground,overflow:'hidden'}}>
    {spec.material==='glass'||spec.layout==='stage'?<AbsoluteFill style={{background:'radial-gradient(ellipse at 73% 44%,'+p.accent+'22,transparent 53%)'}}/>:null}
    {backgrounds.map(layer=>{const a=payload.assets.find(a=>a.id===layer.assetId),state=pose(layer,ms);return a?<Img key={layer.id} src={a.url} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',opacity:state.opacity*(matte?.13:.48),transform:'translate('+camera.x*w*.22+'px,'+camera.y*h*.22+'px) scale('+(1+spec.zoom*.3*camera.camera)+')'}}/>:null;})}
    <Material spec={spec} ink={p.foreground} accent={p.accent} w={w} h={h}/>
    {subjects.map(layer=>{
      const asset=payload.assets.find(a=>a.id===layer.assetId);if(!asset)return null;
      const beats=payload.semanticBeats?.filter(b=>b.targetLayerIds.includes(layer.id))??[];
      const first=beats[0],start=first?.startMs??0;
      const end=cues.find(cue=>cue.id===first?.cueId)?.endMs??start+spec.durationMs;
      const motion=creativeMotion(spec,ms,start,end,payload.durationMs);
      // Stepped subject poses and smooth camera travel are separate clocks.
      const poseMs=spec.stepFps?Math.floor(ms*spec.stepFps/1000)*1000/spec.stepFps:ms;
      const state=pose(layer,poseMs);
      let dx=0,emphasis=1,dim=1;
      for(const beat of beats) {
        if(beat.startMs>poseMs)continue;
        const action=creativeMotion(spec,poseMs,beat.startMs,beat.endMs,payload.durationMs);
        if(beat.action==='move')dx+=action.progress*.12;
        if(beat.action==='emphasize')emphasis+=Math.sin(action.raw*Math.PI)*(spec.reveal==='elastic'?.11:spec.material==='paper'?.025:.055);
        if(beat.action==='dim')dim=1-action.progress*.65;
      }
      const x=state.x+dx+camera.x*layer.depth,y=state.y+camera.y*layer.depth;
      const pixel=spec.title==='pixel',unit=pixel?Math.max(1,w/320):1;
      const sx=Math.round(x*w/unit)*unit,sy=Math.round(y*h/unit)*unit;
      const alpha=(ms<start?0:state.opacity)*dim;
      const arrival=!first||first.action==='reveal'?motion.arrival:1;
      return <div key={layer.id} data-creative-subject={spec.reveal} style={{position:'absolute',left:sx,top:sy,width:(layer.width??layout.subject.width)*w,height:(layer.height??layout.subject.height)*h,zIndex:layer.zIndex,opacity:alpha,transform:'translate(-50%,-50%) scale('+(state.scale*emphasis*(1+spec.zoom*camera.camera))+') rotate('+state.rotation+'deg)'}}>
        <div style={{width:'100%',height:'100%',...reveal(spec,arrival,w)}}><Img src={asset.url} style={{width:'100%',height:'100%',objectFit:layer.fit??'contain',imageRendering:pixel?'pixelated':'auto',filter:matte?undefined:'drop-shadow(0 10px 10px #0003)'}}/></div>
      </div>;
    })}
    {relationship&&subjects.length&&note&&!labels.length?<svg width={w} height={h} style={{position:'absolute',inset:0,zIndex:19,pointerEvents:'none'}} aria-hidden="true"><path d={'M'+left*w+' '+top*h+' Q'+(left+nx)*w/2+' '+top*h+' '+nx*w+' '+ny*h} fill="none" stroke={p.accent} strokeWidth={spec.material==='board'?Math.max(2,w*.002):Math.max(1,w*.0008)} pathLength="1" strokeDasharray="1" strokeDashoffset={1-relation} strokeLinecap="round"/>{spec.layout==='technical'?<circle cx={left*w} cy={top*h} r={w*.004} fill={p.background} stroke={p.accent}/>:null}</svg>:null}
    {!subjects.length&&note&&!labels.length?<Type text={note} rect={layout.subject} styleId={styleId} w={w} h={h} progress={cueMotion.progress}/>:null}
    {subjects.length&&note&&!labels.length?<div style={{position:'absolute',inset:0,zIndex:22}}><Type text={note} rect={layout.note} styleId={styleId} w={w} h={h} note progress={ms<cueStart?0:labelProgress}/></div>:null}
    {labels.map(layer=>layerText(layer))}
    {titleLayer?titleLayer.visible!==false?layerText(titleLayer,true):null:<div style={{position:'absolute',inset:0,zIndex:25}}><Type text={p.title} rect={layout.title} styleId={styleId} w={w} h={h}/></div>}
    {p.source?<div style={{position:'absolute',left:'7%',right:'7%',top:'80%',height:'3%',fontSize:Math.min(w,h)/45,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',zIndex:30}}>{p.source}</div>:null}
  </AbsoluteFill>;
}
