import { AppError } from '../src/shared/app-error';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
const hooks=vi.hoisted(()=>({values:[] as any[],refs:[] as any[],effects:[] as any[],cursor:0,refCursor:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(v:any)=>hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v];},
 useRef:(initial:any)=>hooks.refs[hooks.refCursor++]??={current:initial},useEffect:(fn:any)=>hooks.effects.push(fn),useCallback:(fn:any)=>fn,
}));
vi.mock('../src/ui',()=>({Button:'Button',Dialog:'Dialog',TextField:'TextField'}));
import { ActivationPage } from '../src/features/account/ActivationPage';
function nodes(node:ReactNode):any[]{if(Array.isArray(node))return node.flatMap(nodes);if(!isValidElement<{children?:ReactNode;actions?:ReactNode}>(node))return [];return [node,...nodes(node.props.children),...nodes(node.props.actions)];}
function text(node:ReactNode):string{if(Array.isArray(node))return node.map(text).join('');if(isValidElement<{children?:ReactNode}>(node))return text(node.props.children);return typeof node==='string'?node:'';}
function deferred(){let resolve!:(v?:any)=>void,reject!:(e:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const button=(tree:any[],label:string)=>{const result=tree.find(n=>n.type==='Button'&&text(n.props.children)===label);expect(result,label).toBeTruthy();return result;};
const license={status:'active',configured:true,devices:[],deviceId:'this-device',deviceLabel:'测试设备',message:'已激活'};
const update={phase:'available',currentVersion:'1.0',downloaded:0,release:{version:'2.0',size:100,notes:'更新'}};
const api=()=>({getLicenseStatus:vi.fn(async()=>license),getUpdateStatus:vi.fn(async()=>update),activateLicense:vi.fn(),refreshLicense:vi.fn(),releaseLicense:vi.fn(),checkForUpdate:vi.fn(),downloadUpdate:vi.fn(),installUpdate:vi.fn()});
function renderer(service:any){return()=>{hooks.cursor=0;hooks.refCursor=0;return nodes(ActivationPage({api:service}));};}
async function load(render:()=>any[]){render();hooks.effects[2]();await settle();return render();}
function hasError(tree:any[],message:string){return tree.some(n=>n.props.feedback?.tone==='error'&&n.props.feedback.message.includes(message));}
beforeEach(()=>{hooks.values=[];hooks.refs=[];hooks.effects=[];hooks.cursor=0;hooks.refCursor=0;vi.useFakeTimers();});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
it('submits 激活本机 once, preserves the code on failure and allows a retry through activateLicense',async()=>{
 const service=api(),pending=deferred();service.activateLicense.mockReturnValueOnce(pending.promise).mockResolvedValue(license);const render=renderer(service);let tree=await load(render);
 const code='SD-12345678-12345678-12345678-12345678';tree.find(n=>n.type==='TextField').props.onChange(null,{value:code});tree=render();expect(button(tree,'激活本机').props.disabled).toBe(false);
 const submit=tree.find(n=>n.type==='form').props.onSubmit;submit({preventDefault:vi.fn()});submit({preventDefault:vi.fn()});expect(service.activateLicense).toHaveBeenCalledExactlyOnceWith(code);expect(button(render(),'激活本机').props.disabled).toBe(true);
 pending.reject(new AppError('ACTIVATION_FAILED', '激活接口失败'));await settle();tree=render();expect(hasError(tree,'激活接口失败')).toBe(true);expect(tree.find(n=>n.type==='TextField').props.value).toBe(code);
 tree.find(n=>n.type==='form').props.onSubmit({preventDefault:vi.fn()});await settle();expect(service.activateLicense).toHaveBeenCalledTimes(2);tree=render();expect(tree.find(n=>n.type==='TextField').props.value).toBe('');expect(button(tree,'激活本机').props.disabled).toBe(true);expect(hasError(tree,'激活接口失败')).toBe(false);
});
it('runs 验证授权 and requires 确认解绑 before releaseLicense, surfacing failures',async()=>{
 const service=api(),pending=deferred();service.refreshLicense.mockReturnValue(pending.promise);service.releaseLicense.mockRejectedValue(new AppError('RELEASE_FAILED', '解绑失败'));const render=renderer(service);let tree=await load(render);
 const verify=button(tree,'验证授权').props.onClick;verify();verify();expect(service.refreshLicense).toHaveBeenCalledTimes(1);pending.resolve(license);await settle();tree=render();
 button(tree,'解绑本机').props.onClick();expect(service.releaseLicense).not.toHaveBeenCalled();tree=render();expect(tree.find(n=>n.type==='Dialog').props.open).toBe(true);const confirm=button(tree,'确认解绑').props.onClick;confirm();confirm();await settle();expect(service.releaseLicense).toHaveBeenCalledTimes(1);expect(hasError(render(),'解绑失败')).toBe(true);
});
it('serializes 检查更新 / 下载更新 and requires confirmation for 安装并退出',async()=>{
 const service=api(),pending=deferred();service.checkForUpdate.mockReturnValue(pending.promise);service.downloadUpdate.mockResolvedValue({...update,phase:'ready'});service.installUpdate.mockRejectedValue(new AppError('UPDATE_INSTALL_FAILED', '安装失败'));const render=renderer(service);let tree=await load(render);
 const check=button(tree,'检查更新').props.onClick;check();check();button(tree,'下载更新').props.onClick();expect(service.checkForUpdate).toHaveBeenCalledTimes(1);expect(service.downloadUpdate).not.toHaveBeenCalled();expect(button(render(),'检查更新').props.disabled).toBe(true);
 pending.resolve(update);await settle();tree=render();button(tree,'下载更新').props.onClick();await settle();expect(service.downloadUpdate).toHaveBeenCalledTimes(1);tree=render();expect(button(tree,'安装并退出').props.disabled).toBe(false);button(tree,'安装并退出').props.onClick();expect(service.installUpdate).not.toHaveBeenCalled();tree=render();const confirm=button(tree,'确认安装').props.onClick;confirm();confirm();await settle();expect(service.installUpdate).toHaveBeenCalledTimes(1);expect(hasError(render(),'安装失败')).toBe(true);
});
