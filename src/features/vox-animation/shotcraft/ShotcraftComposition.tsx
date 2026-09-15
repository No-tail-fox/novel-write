import { AbsoluteFill } from 'remotion';
import type { VoxAnimationPayload } from '../../../shared/vox-animation';
import type { ShotcraftSceneProps } from './types';
import { MaskingTapeShot, PaperTitleShot, PopupBookShot } from './PaperShots';
import { TimelineTravelShot } from './TimelineTravelShot';
import { SourceMergeShot, RingRevealShot } from './FlowShots';

const COMPONENTS = {
  'shotcraft-paper-tape': MaskingTapeShot,
  'shotcraft-paper-popup': PopupBookShot,
  'shotcraft-paper-title': PaperTitleShot,
  'shotcraft-timeline-travel': TimelineTravelShot,
  'shotcraft-source-merge': SourceMergeShot,
  'shotcraft-ring-reveal': RingRevealShot,
};

/** Logical width stays stable; each shot lays out its actual content-stage height. */
export function ShotcraftComposition({payload,frame,durationInFrames}:{payload:VoxAnimationPayload;frame:number;durationInFrames:number}) {
  const {animation,width,height,fps}=payload;
  // Editorial fields wrap to their available width. Keep authored whitespace in
  // the saved props, but reflow pasted line breaks in these fixed video layouts.
  const reflow=(text:string)=>text.replace(/\s+/gu,' ').trim();
  const authored=animation.template.props;
  const p={...authored,title:reflow(authored.title),subtitle:reflow(authored.subtitle),source:reflow(authored.source),
    items:authored.items.map(item=>({...item,label:reflow(item.label),detail:reflow(item.detail),date:reflow(item.date)}))};
  const Scene=COMPONENTS[animation.template.id as keyof typeof COMPONENTS];
  if(!Scene)return null;
  const w=1000,h=height/width*w,isTitle=animation.template.id==='shotcraft-paper-title';
  const headingSize=p.title.length>32?35:p.title.length>18?42:50;
  const headingLines=Math.max(1,Math.ceil(p.title.length/Math.floor(880/headingSize)));
  const top=isTitle?45:36+headingLines*headingSize*1.25+28;
  const sourceSize=14,sourceLines=Math.max(1,Math.ceil(p.source.length/Math.floor(880/sourceSize)));
  const bottom=Math.max(105,h*.2)+(p.source?Math.max(32,sourceLines*sourceSize*1.4+12):0),stageHeight=Math.max(120,h-top-bottom);
  const images=p.assetIds.flatMap(id=>payload.assets.find(a=>a.id===id&&a.kind==='image')?.url??[]);
  const props:ShotcraftSceneProps={p,images,frame,durationInFrames,fps,width:880,height:stageHeight};
  return <AbsoluteFill style={{background:p.background,color:p.foreground,fontFamily:'Microsoft YaHei, Noto Sans CJK SC, sans-serif'}}>
    <div data-shotcraft-template={animation.template.id} style={{position:'absolute',width:w,height:h,transform:`scale(${width/w})`,transformOrigin:'top left',overflow:'hidden',backgroundImage:`radial-gradient(ellipse at 42% 30%, ${p.foreground}04, transparent 70%)`}}>
      {!isTitle&&p.title?<div data-shotcraft-heading style={{position:'absolute',left:60,right:60,top:36,fontSize:headingSize,fontWeight:800,lineHeight:1.25,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{p.title}</div>:null}
      <div data-shotcraft-stage style={{position:'absolute',left:60,top,width:880,height:stageHeight}}><Scene {...props}/></div>
      {p.source?<div data-shotcraft-source style={{position:'absolute',left:60,right:60,bottom:Math.max(92,h*.19),fontSize:sourceSize,lineHeight:1.4,opacity:.7,overflowWrap:'anywhere'}}>{p.source}</div>:null}
    </div>
  </AbsoluteFill>;
}
