import React from 'react';
import * as ReactModule from 'react';
import * as Remotion from 'remotion';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Player, type PlayerRef } from '@remotion/player';
import { getAudioData } from '@remotion/media-utils';
import { VoxComposition, voxAudioCache } from './VoxComposition';
import type { VoxAnimationPayload } from '../../shared/vox-animation';

const runtimeWindow = window as unknown as Window & { VoxRuntime: { require: (id:string)=>unknown; mount:(payload:VoxAnimationPayload,component?:React.ComponentType<any>)=>void }; __ready:boolean; __htmlVideoMediaError?:string };
const fail = (error:unknown) => { const message=error instanceof Error?error.message:String(error); runtimeWindow.__htmlVideoMediaError=message; parent.postMessage({type:'vox-error',message},'*'); };
const runtimeRequire=(id:string)=>{if(id==='react')return ReactModule;if(id==='remotion')return Remotion;throw new Error(`不支持的依赖：${id}`);};
class Boundary extends React.Component<{children:React.ReactNode},{error:string}>{
  state={error:''};
  static getDerivedStateFromError(error:Error){fail(error);return {error:error.message};}
  render(){return this.state.error?<div role="alert">{this.state.error}</div>:this.props.children;}
}
function Subtitles({payload}:{payload:VoxAnimationPayload}) {
  const ms=Remotion.useCurrentFrame()/payload.fps*1000;
  const centered=payload.animation.mode==='template'&&['audio-captions','audio-lyrics'].includes(payload.animation.template.id);
  const outline=payload.subtitleStyle?.includes('描边');
  const fontSize=payload.width*(centered?.055:payload.height>payload.width?.042:.025);
  return <div style={{position:'absolute',inset:0,pointerEvents:'none',fontFamily:'Microsoft YaHei, Noto Sans CJK SC, sans-serif'}}>
    {payload.cues.map((cue,i)=><div key={cue.id??i} className="caption" data-cue-id={cue.id??`#${i}`} data-cue-start={cue.startMs} data-cue-end={cue.endMs} hidden={ms<cue.startMs||ms>=cue.endMs}
      style={{position:'absolute',left:'8%',right:'8%',bottom:centered?'42%':'6%',padding:'.6em .9em',fontSize,fontWeight:650,lineHeight:1.35,textAlign:'center',whiteSpace:'pre-wrap',overflowWrap:'anywhere',color:centered?payload.animation.template.props.foreground:'#fff',background:centered||outline?'transparent':'rgba(7,9,10,.82)',textShadow:outline?'-2px -2px #000,2px 2px #000,0 2px 6px #000':undefined}}>
      {cue.tokens?.length?(()=>{let cursor=0;const parts:React.ReactNode[]=[];cue.tokens!.forEach((token,j)=>{const position=cue.text.indexOf(token.text,cursor);if(position<cursor)return;parts.push(cue.text.slice(cursor,position));parts.push(<span key={j} data-word-start={token.startMs} data-word-end={token.endMs} style={{color:ms>=token.startMs&&ms<token.endMs?'#ff6255':undefined}}>{token.text}</span>);cursor=position+token.text.length;});parts.push(cue.text.slice(cursor));return parts;})():cue.text}
    </div>)}
  </div>;
}
runtimeWindow.VoxRuntime={require:runtimeRequire,mount(payload,Custom){
  runtimeWindow.__ready=false;
  const root=createRoot(document.getElementById('root')!);
  const ref=React.createRef<PlayerRef>();
  const durationInFrames=Math.max(1,Math.ceil(payload.durationMs*payload.fps/1000));
  const Composition=()=> <Boundary><Remotion.AbsoluteFill className="frame">{Custom?<Custom {...payload.animation.template.props} assets={payload.assets} cues={payload.cues}/>:<VoxComposition {...payload}/>}<Subtitles payload={payload}/></Remotion.AbsoluteFill></Boundary>;
  flushSync(()=>root.render(<Player ref={ref} component={Composition} compositionWidth={payload.width} compositionHeight={payload.height} fps={payload.fps} durationInFrames={durationInFrames} controls={false} clickToPlay={false} style={{width:'100%',height:'100%'}} errorFallback={({error})=>{fail(error);return <div>{error.message}</div>;}}/>));
  const ready=Promise.all(payload.assets.filter(x=>x.kind==='audio').map(async a=>{voxAudioCache.set(a.url,await getAudioData(a.url));}));
  let lastFrame=-1;
  const seek=async(seconds:number)=>{
    await ready;
    if(runtimeWindow.__htmlVideoMediaError)throw new Error(runtimeWindow.__htmlVideoMediaError);
    const target=Math.min(durationInFrames-1,Math.max(0,Math.floor(seconds*payload.fps+1e-6)));
    if(target!==lastFrame){flushSync(()=>ref.current?.seekTo(target));lastFrame=target;}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image=>image.decode()));
    document.querySelectorAll<HTMLElement>('.caption').forEach(el=>{el.hidden=seconds*1000<Number(el.dataset.cueStart)||seconds*1000>=Number(el.dataset.cueEnd);});
    document.querySelectorAll<HTMLElement>('[data-word-start]').forEach(el=>{el.style.color=seconds*1000>=Number(el.dataset.wordStart)&&seconds*1000<Number(el.dataset.wordEnd)?'#ff6255':'';});
    if(runtimeWindow.__htmlVideoMediaError)throw new Error(runtimeWindow.__htmlVideoMediaError);
  };
  window.__tl={seek};
  ready.then(()=>seek(0)).then(()=>{runtimeWindow.__ready=true;parent.postMessage({type:'vox-ready'},'*');}).catch(fail);
  window.addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='vox-seek'||!Number.isFinite(event.data.timeMs))return;void seek(event.data.timeMs/1000).catch(fail);});
}};
