import { useEffect, useRef, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { buildVoxAnimationHtml, validateVoxAnimation, voxAnimationAssetIds, type VoxAnimation, type VoxAnimationCue, type VoxAnimationPayload } from '../../shared/vox-animation';
import { directorCanvasForRatio } from '../../shared/director-render';
export interface VoxLocalAsset {id:string;label:string;kind:'image'|'audio';path:string;}
export type VoxApi=Pick<StoryDreamApi,'getVoxAnimationRuntime'|'readVoxAnimationAsset'|'compileVoxAnimation'|'generateVoxAnimation'|'cancelVoxAnimation'|'listVoxTemplates'|'saveVoxTemplate'|'deleteVoxTemplate'>;
const runtimes=new WeakMap<VoxApi,Promise<string>>();
const assetCache=new Map<string,Promise<string>>();
export function VoxAnimationPreview({animation,api,assets,ratio,durationMs,timeMs,cues=[],subtitleStyle,audioClips,onReady}:{animation:VoxAnimation;api:VoxApi;assets:readonly VoxLocalAsset[];ratio:string;durationMs:number;timeMs:number;cues?:VoxAnimationCue[];subtitleStyle?:string;audioClips?:VoxAnimationPayload['audioClips'];onReady?:(ready:boolean)=>void}){
  const ref=useRef<HTMLIFrameElement>(null),latestTime=useRef(timeMs);latestTime.current=timeMs;
  const [html,setHtml]=useState(''),[frameRevision,setFrameRevision]=useState(0),[error,setError]=useState(''),[ready,setReady]=useState(false);const readyCallback=useRef(onReady);readyCallback.current=onReady;
  const signature=JSON.stringify({animation,assets,ratio,durationMs,cues,subtitleStyle,audioClips});
  useEffect(()=>{let cancelled=false;setError('');setReady(false);readyCallback.current?.(false);const timer=setTimeout(()=>{void (async()=>{
    const issues=validateVoxAnimation(animation,assets);if(issues.length)throw new Error(issues.join('；'));
    if(animation.mode==='template'&&['audio-captions','audio-lyrics'].includes(animation.template.id)&&!cues.length)throw new Error('请先在字幕面板添加字幕或导入歌词时间戳');
    let runtime=runtimes.get(api);if(!runtime){runtime=api.getVoxAnimationRuntime();runtimes.set(api,runtime);runtime.catch(()=>runtimes.delete(api));}
    const ids=voxAnimationAssetIds(animation);
    const media=await Promise.all(ids.map(async id=>{const asset=assets.find(a=>a.id===id);if(!asset)throw new Error('素材不存在');const key=`${asset.id}:${asset.path}`;let loaded=assetCache.get(key);if(!loaded){loaded=api.readVoxAnimationAsset(asset.path);assetCache.set(key,loaded);loaded.catch(()=>assetCache.delete(key));if(assetCache.size>32)assetCache.delete(assetCache.keys().next().value!);}return {id,kind:asset.kind,label:asset.label,url:await loaded};}));
    const safeAnimation=animation.mode==='code'?{...animation,code:{...animation.code,...await api.compileVoxAnimation(animation.code.source)}}:animation;
    const payload:VoxAnimationPayload={animation:safeAnimation,assets:media,...directorCanvasForRatio(ratio),durationMs,fps:24,cues,subtitleStyle,audioClips};
    const result=buildVoxAnimationHtml(await runtime,payload);if(!cancelled){setHtml(result);setFrameRevision(revision=>revision+1);}
  })().catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:String(e));});},200);return()=>{cancelled=true;clearTimeout(timer);};},[signature,api]);
  useEffect(()=>{if(!html||ready||error)return;const timer=setTimeout(()=>{setError('预览加载超时，请检查素材或动画代码');readyCallback.current?.(false);},20000);return()=>clearTimeout(timer);},[html,ready,error]);
  useEffect(()=>{const listener=(e:MessageEvent)=>{if(e.source!==ref.current?.contentWindow)return;if(e.data?.type==='vox-ready'){setReady(true);readyCallback.current?.(true);ref.current?.contentWindow?.postMessage({type:'vox-seek',timeMs:latestTime.current},'*');}if(e.data?.type==='vox-error'){setError(e.data.message);setReady(false);readyCallback.current?.(false);}};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);},[]);
  useEffect(()=>{if(ready)ref.current?.contentWindow?.postMessage({type:'vox-seek',timeMs},'*');},[timeMs,ready]);
  return <div className="vox-preview" data-vox-ready={ready?'true':'false'}>{html?<iframe key={frameRevision} ref={ref} title="Remotion 动画画面" sandbox="allow-scripts" srcDoc={html}/>:null}{error?<div className="vox-preview-message" role="alert">{error}</div>:!ready?<div className="vox-preview-message" role="status">正在准备动画预览…</div>:null}</div>;
}
