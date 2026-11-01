import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, useEffect, type ReactNode } from 'react';
const hooks = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], cursor: 0, refCursor: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (next: any) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: any) => { const i = hooks.refCursor++; return hooks.refs[i] ??= { current: initial }; },
  useEffect: vi.fn(),
}));
vi.mock('../src/ui', () => Object.fromEntries(['Button','IconButton','SegmentedControl','SelectField','SliderField','TextAreaField','TextField'].map(name => [name, name])));
vi.mock('../src/features/vox-animation/VoxTemplateCatalog', () => ({ VoxTemplateCatalog: 'catalog' }));
import { VoxAnimationEditor } from '../src/features/vox-animation/VoxAnimationEditor';
import { createVoxAnimation, VOX_TEMPLATES } from '../src/shared/vox-animation';
type Props = Parameters<typeof VoxAnimationEditor>[0];
function props(extra: Partial<Props> = {}): Props {
  return { shotId: 'one', title: '标题', subtitle: '', animation: createVoxAnimation('标题'), api: { saveVoxTemplate: vi.fn(), deleteVoxTemplate: vi.fn() } as any,
    assets: [], ratio: '16:9', durationMs: 5000, busy: false, previewReady: true, onChange: vi.fn(), onImportAsset: vi.fn(), ...extra };
}
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === 'string' ? node : '';
}
function render(input: Props) { hooks.cursor = 0; hooks.refCursor = 0; return nodes(VoxAnimationEditor(input)); }
function button(tree: any[], label: string) { const found = tree.find(n => n.type === 'Button' && text(n.props.children).includes(label)); expect(found, label).toBeTruthy(); return found; }
function deferred() { let resolve!: (value?: any) => void, reject!: (error: Error) => void; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return { promise, resolve, reject }; }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { hooks.values=[];hooks.refs=[];hooks.cursor=0;hooks.refCursor=0; });
describe('Vox editor asynchronous controls', () => {
  it('locks duplicate image imports before a rerender, shows busy feedback and preserves the authored draft on failure', async () => {
    const pending=deferred(), onImportAsset=vi.fn(() => pending.promise as Promise<void>), input=props({ onImportAsset });
    const click=button(render(input),'导入图片').props.onClick;
    click();click();
    expect(onImportAsset).toHaveBeenCalledExactlyOnceWith('image');
    let tree=render(input);
    expect(button(tree,'导入图片').props.disabled).toBe(true);
    expect(tree.some(n=>n.props.role==='status' && text(n.props.children)==='正在导入素材…')).toBe(true);
    pending.reject(new Error('读取原图失败'));await settle();tree=render(input);
    expect(tree.some(n=>n.props.role==='alert' && text(n.props.children).includes('读取原图失败'))).toBe(true);
    expect(button(tree,'导入图片').props.disabled).toBe(false);
    expect(input.onChange).not.toHaveBeenCalled();
  });
  it('dispatches audio import and blocks all imports while the workspace is busy', async () => {
    const animation=createVoxAnimation('音频'); animation.template.id=VOX_TEMPLATES.find(t=>t.audio)!.id;
    const onImportAsset=vi.fn(async()=>{}), input=props({ animation,onImportAsset });
    button(render(input),'导入音频到时间线').props.onClick(); await settle();
    expect(onImportAsset).toHaveBeenCalledExactlyOnceWith('audio');
    input.busy=true;
    const tree=render(input);
    expect(button(tree,'导入音频到时间线').props.disabled).toBe(true);
    button(tree,'导入音频到时间线').props.onClick();
    expect(onImportAsset).toHaveBeenCalledTimes(1);
  });
  it('serializes save and delete requests, surfaces rejection, and releases the template lock', async () => {
    const pending=deferred(), input=props();
    input.api.saveVoxTemplate=vi.fn(()=>pending.promise) as any;
    input.api.deleteVoxTemplate=vi.fn(async()=>[]);
    let tree=render(input);
    tree.find(n=>n.type==='TextField' && n.props.label==='保存为我的模板').props.onChange(null,{value:'我的模板'});
    button(render(input),'选择模板').props.onClick();
    tree=render(input);
    const save=button(tree,'保存模板').props.onClick;
    save();save();
    tree.find(n=>n.type==='catalog').props.onDeleteSaved('saved-template');
    expect(input.api.saveVoxTemplate).toHaveBeenCalledTimes(1);
    expect(input.api.deleteVoxTemplate).not.toHaveBeenCalled();
    tree=render(input);
    expect(button(tree,'正在保存').props.disabled).toBe(true);
    expect(tree.find(n=>n.type==='catalog').props.busy).toBe(true);
    pending.reject(new Error('保存失败')); await settle();tree=render(input);
    expect(tree.some(n=>n.props.role==='alert' && text(n.props.children).includes('保存失败'))).toBe(true);
    expect(tree.find(n=>n.type==='catalog').props.busy).toBe(false);
    tree.find(n=>n.type==='catalog').props.onDeleteSaved('saved-template'); await settle();
    expect(input.api.deleteVoxTemplate).toHaveBeenCalledExactlyOnceWith('saved-template');
    expect(input.onChange).not.toHaveBeenCalled();
  });
  it('shows delete progress in the ordinary editor, prevents duplicate requests and keeps failure visible', async () => {
    const pending=deferred(), input=props(); input.api.deleteVoxTemplate=vi.fn(()=>pending.promise) as any;
    button(render(input),'选择模板').props.onClick();
    const remove=render(input).find(n=>n.type==='catalog').props.onDeleteSaved;
    remove('a');remove('a');
    expect(input.api.deleteVoxTemplate).toHaveBeenCalledExactlyOnceWith('a');
    expect(render(input).some(n=>n.props.role==='status' && text(n.props.children)==='正在删除模板…')).toBe(true);
    pending.reject(new Error('删除失败'));await settle();
    expect(render(input).some(n=>n.props.role==='alert' && text(n.props.children).includes('删除失败'))).toBe(true);
  });
});

describe('Vox generation command lifecycle', () => {
  it('serializes generateVoxAnimation and reports a failed cancelVoxAnimation without losing the live request', async () => {
    const pending=deferred(), cancel=deferred(), input=props();
    input.animation!.mode='code'; input.animation!.code.prompt='制作动画';
    input.api.generateVoxAnimation=vi.fn(()=>pending.promise) as any;
    input.api.cancelVoxAnimation=vi.fn(()=>cancel.promise) as any;
    const generate=button(render(input),'生成动画').props.onClick;
    generate();generate(); expect(input.api.generateVoxAnimation).toHaveBeenCalledTimes(1);
    const stop=button(render(input),'取消').props.onClick;
    stop();stop();expect(input.api.cancelVoxAnimation).toHaveBeenCalledTimes(1);
    expect(button(render(input),'正在取消').props.disabled).toBe(true);
    cancel.reject(new Error('取消通信失败'));await settle();
    let tree=render(input);
    expect(tree.some(n=>n.props.role==='alert'&&text(n.props.children).includes('取消通信失败'))).toBe(true);
    expect(button(tree,'正在生成').props.disabled).toBe(true);
    input.api.cancelVoxAnimation=vi.fn(async()=>{});
    button(tree,'取消').props.onClick();await settle();
    expect(button(render(input),'生成动画').props.disabled).toBe(false);
    pending.resolve({source:'late',compiled:'late'});await settle();
    expect(input.onChange).not.toHaveBeenCalled();
  });
  it('serializes compileVoxAnimation and exposes a compilation failure without changing the draft', async () => {
    const pending=deferred(), input=props();input.animation!.mode='code';input.animation!.code.source='source';
    input.api.compileVoxAnimation=vi.fn(()=>pending.promise) as any;
    button(render(input),'查看代码').props.onClick();
    const compile=button(render(input),'检查代码并预览').props.onClick;compile();compile();
    expect(input.api.compileVoxAnimation).toHaveBeenCalledExactlyOnceWith('source');
    expect(button(render(input),'检查代码并预览').props.disabled).toBe(true);
    pending.reject(new Error('编译失败'));await settle();
    expect(render(input).some(n=>n.props.role==='alert'&&text(n.props.children).includes('编译失败'))).toBe(true);
    expect(input.onChange).not.toHaveBeenCalled();
  });
});

it('catches cancelVoxAnimation rejection during editor cleanup and never commits an unmounted generation',async()=>{
 const pending=deferred(),input=props();input.animation!.mode='code';input.animation!.code.prompt='动画';
 input.api.listVoxTemplates=vi.fn(async()=>[]);input.api.generateVoxAnimation=vi.fn(()=>pending.promise) as any;
 input.api.cancelVoxAnimation=vi.fn(async()=>{throw new Error('offline');});
 vi.mocked(useEffect).mockClear();button(render(input),'生成动画').props.onClick();
 const cleanup=vi.mocked(useEffect).mock.calls[0][0]();if(typeof cleanup!=='function')throw Error('missing cleanup');cleanup();
 await settle();expect(input.api.cancelVoxAnimation).toHaveBeenCalledTimes(1);
 pending.resolve({source:'late',compiled:'late'});await settle();expect(input.onChange).not.toHaveBeenCalled();
});

it('locks 导出此镜头 and 取消导出, shows cancellation failure without ending the export, and permits retry',async()=>{
 const pending=deferred(),cancel=deferred(),onExport=vi.fn(()=>pending.promise as Promise<boolean>),onCancelExport=vi.fn(()=>cancel.promise as Promise<void>),input=props({onExport,onCancelExport});
 const click=button(render(input),'导出此镜头').props.onClick;click();click();expect(onExport).toHaveBeenCalledTimes(1);
 let tree=render(input);expect(button(tree,'正在导出镜头').props.disabled).toBe(true);
 const stop=button(tree,'取消导出').props.onClick;stop();stop();expect(onCancelExport).toHaveBeenCalledTimes(1);expect(button(render(input),'正在取消导出').props.disabled).toBe(true);
 cancel.reject(new Error('取消渲染连接失败'));await settle();tree=render(input);expect(tree.some(n=>n.props.role==='alert'&&text(n.props.children).includes('取消渲染连接失败'))).toBe(true);expect(button(tree,'正在导出镜头').props.disabled).toBe(true);
 onCancelExport.mockResolvedValueOnce();button(tree,'取消导出').props.onClick();await settle();expect(onCancelExport).toHaveBeenCalledTimes(2);
 pending.reject(new Error('导出已终止'));await settle();tree=render(input);expect(button(tree,'导出此镜头').props.disabled).toBe(false);expect(tree.some(n=>n.props.role==='alert'&&text(n.props.children).includes('导出已终止'))).toBe(true);
 onExport.mockResolvedValueOnce(true);button(tree,'导出此镜头').props.onClick();await settle();expect(render(input).some(n=>n.props.role==='status'&&text(n.props.children).includes('镜头已导出'))).toBe(true);
});
