import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
const hooks=vi.hoisted(()=>({values:[] as any[],refs:[] as any[],effects:[] as any[],cursor:0,refCursor:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(v:any)=>hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v];},
 useRef:(initial:any)=>hooks.refs[hooks.refCursor++]??={current:initial}, useEffect:(fn:any)=>hooks.effects.push(fn),
}));
function nodes(node:ReactNode):any[]{if(Array.isArray(node))return node.flatMap(nodes);if(!isValidElement<{children?:ReactNode}>(node))return [];return [node,...nodes(node.props.children)];}
function text(node:ReactNode):string{if(Array.isArray(node))return node.map(text).join('');if(isValidElement<{children?:ReactNode}>(node))return text(node.props.children);return typeof node==='string'?node:'';}
function render(component:()=>ReactNode){hooks.cursor=0;hooks.refCursor=0;return nodes(component());}
function button(tree:any[],label:string){const found=tree.find(n=>n.type==='Button'&&text(n.props.children).includes(label));expect(found,label).toBeTruthy();return found;}
function deferred(){let resolve!:(value?:any)=>void,reject!:(error:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
beforeEach(()=>{hooks.values=[];hooks.refs=[];hooks.effects=[];hooks.cursor=0;hooks.refCursor=0;});

import { afterEach } from 'vitest';
import { VoxAnimationPreview } from '../src/features/vox-animation/VoxAnimationPreview';
import { createVoxAnimation } from '../src/shared/vox-animation';
afterEach(()=>vi.useRealTimers());
it('runs compileVoxAnimation in the preview effect, reports errors and drops stale completion after cleanup',async()=>{
 vi.useFakeTimers();const pending=deferred(),animation=createVoxAnimation('预览');animation.mode='code';animation.code.source='export default function Scene(){return null}';animation.code.compiled='export default function Scene(){return null}';
 const api={compileVoxAnimation:vi.fn(()=>pending.promise),getVoxAnimationRuntime:vi.fn(async()=>''),readVoxAnimationAsset:vi.fn()} as any;
 const component=()=>VoxAnimationPreview({animation,api,assets:[],ratio:'16:9',durationMs:5000,timeMs:0});
 render(component);const cleanup=hooks.effects[1]();await vi.advanceTimersByTimeAsync(200);await settle();
 expect(api.compileVoxAnimation).toHaveBeenCalledExactlyOnceWith(animation.code.source);
 pending.reject(new Error('预览编译失败'));await settle();expect(render(component).some(n=>n.props.role==='alert'&&text(n.props.children)==='预览编译失败')).toBe(true);
 cleanup();const second=deferred();api.compileVoxAnimation.mockImplementation(()=>second.promise);const cleanup2=hooks.effects[1]();await vi.advanceTimersByTimeAsync(200);await settle();cleanup2();
 second.reject(new Error('过期错误'));await settle();expect(render(component).some(n=>n.props.role==='alert'&&text(n.props.children)==='过期错误')).toBe(false);
});
