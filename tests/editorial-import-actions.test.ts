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

vi.mock('../src/ui',()=>Object.fromEntries(['Button','CheckboxField','SelectField','SliderField','PreviewSelectField'].map(n=>[n,n])));
vi.mock('../src/features/director-desk/DirectorOptionPreview',()=>({DirectorOptionPreview:'preview'}));
vi.mock('../src/features/director-desk/director-sound',()=>({readDirectorSoundDuration:vi.fn(async()=>5000)}));
import { ProjectMusicFields } from '../src/features/editorial-collage/ProjectMusicFields';
import { EditorialRecipeInspector } from '../src/features/editorial-collage/EditorialRecipeInspector';
import { createEditorialCollageDraft,createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { applyEditorialRecipe } from '../src/shared/editorial-recipes';
describe('editorial import action ownership',()=>{
 it('serializes importBgmAudio before rerender and preserves the selected music on rejection',async()=>{
  const pending=deferred(),api={importBgmAudio:vi.fn(()=>pending.promise)},onChange=vi.fn();
  const component=()=>ProjectMusicFields({api,library:[],busy:false,onChange});
  const click=button(render(component),'导入背景音乐').props.onClick;click();click();
  expect(api.importBgmAudio).toHaveBeenCalledTimes(1);
  expect(button(render(component),'正在导入').props.disabled).toBe(true);
  pending.reject(new Error('无法读取音频'));await settle();
  expect(render(component).some(n=>n.props.role==='alert'&&text(n.props.children)==='无法读取音频')).toBe(true);
  expect(onChange).not.toHaveBeenCalled();expect(button(render(component),'导入背景音乐').props.disabled).toBe(false);
 });
 it('blocks busy background-music imports and ignores completion after unmount',async()=>{
  const pending=deferred(),api={importBgmAudio:vi.fn(()=>pending.promise)},onChange=vi.fn();let busy=true;
  const component=()=>ProjectMusicFields({api,library:[],busy,onChange});
  button(render(component),'导入背景音乐').props.onClick();expect(api.importBgmAudio).not.toHaveBeenCalled();
  busy=false;button(render(component),'导入背景音乐').props.onClick();const cleanup=hooks.effects[0]();cleanup();
  pending.resolve({title:'配乐',path:'music.wav'});await settle();expect(onChange).not.toHaveBeenCalled();
 });
 it('locks 导入原画 / 尾帧 and keeps failed import feedback visible without changing the selected frame',async()=>{
  let document=createEditorialCollageStarterPlan(createEditorialCollageDraft({id:'import-test',title:'城市',now:'2026-10-30T00:00:00Z'}),'城市沿河发展。');
  const shotId=document.beats[0].shots[0].id;document=applyEditorialRecipe(document,shotId,'paper-cut');
  const pending=deferred(),onImport=vi.fn(()=>pending.promise),onKeyframe=vi.fn();
  const component=()=>EditorialRecipeInspector({document,shotId,busy:false,onImport,onKeyframe,onLastFrame:vi.fn(),onRecipe:vi.fn()});
  const click=button(render(component),'导入原画 / 尾帧').props.onClick;click();click();expect(onImport).toHaveBeenCalledTimes(1);
  expect(button(render(component),'正在导入').props.disabled).toBe(true);pending.reject(new Error('原画读取失败'));await settle();
  expect(render(component).some(n=>n.props.role==='alert'&&text(n.props.children)==='原画读取失败')).toBe(true);
  expect(onKeyframe).not.toHaveBeenCalled();expect(button(render(component),'导入原画 / 尾帧').props.disabled).toBe(false);
 });
});
