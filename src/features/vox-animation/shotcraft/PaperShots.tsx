/* Adapted from Vincentwei1021/video-shotcraft, commit 5e71af35 (Apache-2.0).
 * Retains the tape landing, hinge spring and letterpress timing. StoryDream
 * supplies text/assets, frame-rate mapping and responsive content geometry.
 * See THIRD_PARTY_NOTICES.md and shotcraft/LICENSE. */
import type { CSSProperties } from 'react';
import { Easing, Img, interpolate, spring } from 'remotion';
import type { ShotcraftSceneProps } from './types';

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const between = (f: number, a: number, b: number) => clamp((f-a)/Math.max(0.001,b-a));
const mix = (a: number, b: number, t: number) => a+(b-a)*t;
const outCubic = (t: number) => 1-(1-t)**3;
const sourceFrame = (s: ShotcraftSceneProps, last: number) => clamp(s.frame/Math.max(1,s.durationInFrames-1))*last;
const textStyle: CSSProperties = { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 };
const tapeClip = 'polygon(0% 8%,2.5% 0%,97% 3%,100% 12%,98.2% 30%,100% 52%,98% 74%,100% 90%,96.5% 100%,3% 97%,0% 88%,1.8% 64%,0% 42%,2% 22%)';

export function tapeState(f: number) {
  const amp = (x: number) => between(x,38,46)*mix(1,.45,between(x,58,62));
  const rawRot = (x: number) => amp(x)*1.5*Math.sin((x-38)*.16);
  const rawBob = (x: number) => amp(x)*5*Math.sin((x-38)*.11);
  const stop = between(f,82,84);
  return {
    rotation: f<=82?rawRot(f):rawRot(82)*(1-stop),
    y: -70*(1-outCubic(between(f,12,38)))+(f<=82?rawBob(f):rawBob(82)*(1-stop))+2*stop,
    opacity: between(f,12,22), shadowOffset: mix(16,3,stop), shadowBlur: mix(34,8,stop),
  };
}

function Tape({f,land,x,y,size,fromX,fromY}:{f:number;land:number;x:number;y:number;size:number;fromX:number;fromY:number}) {
  if(f<land-6)return null;
  const t=outCubic(between(f,land-6,land));
  const rotation=interpolate(f,[land-6,land,land+4],[-61,-38,-45],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.out(Easing.quad)});
  // Source-time windows preserve the squash even when the host uses 24 fps.
  const squash=f>=land&&f<land+1?.72:f>=land+1&&f<land+2?.9:1;
  return <div data-shotcraft-tape={land} style={{position:'absolute',left:x-size/2,top:y-size*.105,width:size,height:size*.21,
    opacity:.85*between(f,land-6,land-4),transform:`translate(${fromX*(1-t)}px,${fromY*(1-t)}px) rotate(${rotation}deg) scale(${1.45-.45*t},${(1.45-.45*t)*squash})`,
    clipPath:tapeClip,background:'linear-gradient(95deg, #d6d4ceee, #f0eadccc 35%, #d4d2ccee)',boxShadow:'0 1px 3px #0002'}}/>;
}

export function MaskingTapeShot(s: ShotcraftSceneProps) {
  const {p,width:w,height:h,images}=s,f=sourceFrame(s,139),state=tapeState(f);
  const cardW=Math.min(w*.78,h>w?650:560),cardH=Math.min(h*.84,images[0]?cardW*.82:330);
  const x=(w-cardW)/2,y=(h-cardH)/2,tapeSize=Math.min(180,cardW*.38);
  return <div style={{position:'relative',width:w,height:h}}>
    <div data-shotcraft-card="tape" style={{position:'absolute',left:x,top:y,width:cardW,height:cardH,padding:24,background:p.background,border:`1px solid ${p.foreground}25`,
      boxShadow:`0 ${state.shadowOffset}px ${state.shadowBlur}px ${p.foreground}35`,opacity:state.opacity,transform:`translateY(${state.y}px) rotate(${state.rotation}deg)`,display:'flex',flexDirection:'column',gap:16}}>
      {images[0]?<Img src={images[0]} style={{width:'100%',minHeight:0,flex:1,objectFit:'contain'}}/>:null}
      {p.subtitle?<p data-shotcraft-text style={{...textStyle,fontSize:images[0]?20:Math.min(38,Math.sqrt((cardW-48)*(cardH-48)/Math.max(1,p.subtitle.length)*.65)),textAlign:'center',margin:images[0]?0:'auto'}}>{p.subtitle}</p>:!images[0]?<p data-shotcraft-text style={{...textStyle,fontSize:32,margin:'auto',textAlign:'center'}}>{p.title}</p>:null}
    </div>
    <Tape f={f} land={58} x={x+cardW*.11} y={y+cardH*.12} size={tapeSize} fromX={-130} fromY={-100}/>
    <Tape f={f} land={82} x={x+cardW*.89} y={y+cardH*.88} size={tapeSize} fromX={130} fromY={100}/>
  </div>;
}

export function popupState(progress: number, index: number, count: number) {
  const lastStart=14+Math.max(0,count-1)*7, settle=lastStart+34, rest=settle+25;
  const f=clamp(progress)*(rest+40);
  const rise=f>=14+index*7+34?1:spring({frame:f-14-index*7,fps:30,config:{damping:11,stiffness:130,mass:.9},durationInFrames:34,durationRestThreshold:.0001});
  return {rotation:-90*rise,sceneRotation:mix(75,68,Easing.inOut(Easing.cubic)(between(f,settle,rest))),shadow:1-clamp(Math.abs(rise))};
}

export function PopupBookShot(s: ShotcraftSceneProps) {
  const {p,width:w,height:h,images}=s,count=Math.min(3,Math.max(p.items.length,images.length)),t=sourceFrame(s,1);
  if(!count)return null;
  const portrait=h>w*.9,cols=portrait?Math.min(2,count):Math.min(3,count),rows=Math.ceil(count/cols),gap=26;
  const cellW=Math.min(portrait?350:250,(w-64-gap*(cols-1))/cols),cellH=Math.min(portrait?360:240,(h-55-gap*(rows-1))/rows);
  const gridW=cols*cellW+(cols-1)*gap,gridH=rows*cellH+(rows-1)*gap;
  // Independent row positions keep multiple rows legible; the paired rotations
  // retain the upstream bottom-hinge motion without flattening the whole grid.
  return <div style={{position:'relative',width:w,height:h,perspective:1800}}>{Array.from({length:count},(_,i)=>{
    const m=popupState(t,i,count),item=p.items[i],img=images[i];
    const textWidth=cellW-32,minImageHeight=img?Math.min(60,cellH*.23):0;
    let labelSize=portrait?28:24,detailSize=portrait?22:20;
    const textHeight=()=>Math.ceil((item?.label.length??0)/Math.max(1,Math.floor(textWidth/labelSize)))*labelSize*1.25+
      Math.ceil((item?.detail.length??0)/Math.max(1,Math.floor(textWidth/detailSize)))*detailSize*1.5;
    while((labelSize>18||detailSize>15)&&textHeight()+minImageHeight+48>cellH){labelSize=Math.max(18,labelSize-1);detailSize=Math.max(15,detailSize-1);}
    return <div key={i} style={{position:'absolute',left:(w-gridW)/2+(i%cols)*(cellW+gap),top:(h-gridH)/2+Math.floor(i/cols)*(cellH+gap),width:cellW,height:cellH,perspective:1600}}>
      <div style={{position:'absolute',left:8,right:8,bottom:-3,height:8+m.shadow*35,background:`${p.foreground}24`,filter:'blur(10px)'}}/>
      <div data-shotcraft-card="popup" style={{position:'absolute',inset:0,transformOrigin:'50% 100%',transform:`rotateX(${m.sceneRotation}deg)`,transformStyle:'preserve-3d'}}>
        <div style={{position:'absolute',inset:0,transformOrigin:'50% 100%',transform:`rotateX(${m.rotation}deg)`,backfaceVisibility:'hidden',background:p.background,border:`1px solid ${p.foreground}35`,borderBottom:`4px solid ${p.accent}`,padding:16,boxShadow:`0 6px 12px ${p.foreground}15`,display:'flex',flexDirection:'column',gap:8}}>
          {img?<Img src={img} style={{width:'100%',minHeight:minImageHeight,flex:1,objectFit:'contain'}}/>:null}
          {item?.label?<strong data-shotcraft-text style={{...textStyle,fontSize:labelSize,lineHeight:1.25}}>{item.label}</strong>:null}
          {item?.detail?<p data-shotcraft-text style={{...textStyle,fontSize:detailSize}}>{item.detail}</p>:null}
        </div>
      </div>
    </div>;
  })}</div>;
}

export function paperTitleTokens(text: string, highlight: string) {
  const split=(value:string)=>value.match(/[\u3400-\u9fff]{1,4}|[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|\s+|[^\s]/gu)??[];
  const selected=highlight.split(/[,，]/u).map(x=>x.trim()).find(x=>x&&text.includes(x));
  if(!selected)return split(text).map(text=>({text,accent:false}));
  const at=text.indexOf(selected);
  return [...split(text.slice(0,at)).map(text=>({text,accent:false})),{text:selected,accent:true},...split(text.slice(at+selected.length)).map(text=>({text,accent:false}))];
}

export function PaperTitleShot(s: ShotcraftSceneProps) {
  const {p,width:w,height:h}=s,t=sourceFrame(s,1),tokens=paperTitleTokens(p.title,p.highlight),n=Math.max(1,tokens.length);
  const fontSize=Math.min(86,Math.max(30,Math.sqrt(w*h*.26/Math.max(1,p.title.length)))),fade=1-between(t,.93,1);
  const subtitleSize=Math.min(30,Math.max(22,Math.sqrt(w*h*.13/Math.max(1,p.subtitle.length))));
  return <div style={{width:w,height:h,display:'flex',flexDirection:'column',justifyContent:'center',gap:24,textAlign:'center',opacity:fade}}>
    <div data-shotcraft-text style={{fontFamily:'Noto Serif CJK SC, SimSun, serif',fontSize,fontWeight:700,lineHeight:1.35,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{tokens.map((word,i)=>{
      const start=.05+i*.36/n,a=Easing.bezier(.2,.75,.3,1)(between(t,start,start+.14));
      return <span key={i} data-shotcraft-word style={{display:'inline-block',opacity:a,transform:`scale(${1.28-.28*a})`,filter:`blur(${7*(1-a)}px)`,fontStyle:word.accent?'italic':undefined,color:word.accent?p.accent:undefined,whiteSpace:'pre-wrap',maxWidth:'100%',overflowWrap:'anywhere'}}>{word.text}</span>;
    })}</div>
    <div style={{height:4,width:150,alignSelf:'center',background:p.accent,transform:`scaleX(${Easing.bezier(.3,0,.2,1)(between(t,.3,.58))})`}}/>
    {p.subtitle?<p data-shotcraft-text style={{...textStyle,fontSize:subtitleSize,opacity:between(t,.2,.4)}}>{p.subtitle}</p>:null}
  </div>;
}
