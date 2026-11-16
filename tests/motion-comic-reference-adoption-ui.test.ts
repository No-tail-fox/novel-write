import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: vi.fn(), useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }]; } }));
vi.mock('../src/ui', () => ({ Button: 'button', Dialog: 'dialog', CheckboxField: 'checkbox', IconButton: 'iconbutton', Toolbar: 'toolbar' }));
import { MotionComicReferenceEditor } from '../src/features/motion-comic/MotionComicReferenceEditor';
type Node = ReactElement<Record<string, any>>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!isValidElement(value)) return []; const node = value as Node; return [node, ...nodes(node.props.children), ...nodes(node.props.actions)]; }
function input() { return { label: '林夏 · 雨衣', versions: [{ id: 'candidate', kind: 'image' as const, assetId: 'look', localPath: 'test.png', createdAt: '' }], busy: false, active: false, feedback: null, importControl: undefined as never, onSetFixed: vi.fn(), onImageStatus: vi.fn() }; }
function render(props: ReturnType<typeof input> & { fixedVersionId?: string }) { hooks.cursor = 0; return nodes(MotionComicReferenceEditor(props)); }
function button(tree: Node[], label: string) { return tree.find(node => node.type === 'button' && node.props.children === label)!; }
function open(props: ReturnType<typeof input>) { hooks.values[1] = { candidate: 'ready' }; button(render(props), '采用并固定此版本').props.onClick(); }
beforeEach(() => { hooks.values = []; });
describe('reference adoption review', () => {
  it('describes imported and generated images as candidates without automatic adoption', () => {
    const tree = render({ ...input(), versions: [], busy: true, active: true });
    const content = tree.map(node => typeof node.props.children === 'string' ? node.props.children : '').join(' ');
    expect(content).toContain('生成与导入均新增候选，预览并核对后手动采用');
    expect(content).not.toContain('导入会固定');
  });
  it('requires an explicit review before dispatching adoption', () => {
    const props = input(); open(props); let tree = render(props);
    expect(props.onSetFixed).not.toHaveBeenCalled(); expect(button(tree, '确认采用并固定').props.disabled).toBe(true);
    tree.find(node => node.type === 'checkbox')!.props.onChange(null, { checked: true }); tree = render(props);
    expect(button(tree, '确认采用并固定').props.disabled).toBe(false); button(tree, '确认采用并固定').props.onClick();
    expect(props.onSetFixed).toHaveBeenCalledExactlyOnceWith('candidate');
  });
  it('cancel leaves the adopted reference untouched', () => { const props = input(); open(props); button(render(props), '取消').props.onClick(); expect(props.onSetFixed).not.toHaveBeenCalled(); expect(render(props).find(node => node.type === 'dialog')?.props.open).toBe(false); });
  it('blocks review if the fixed reference changes or image becomes unavailable', () => {
    const props = input(); open(props); render(props).find(node => node.type === 'checkbox')!.props.onChange(null, { checked: true });
    expect(button(render({ ...props, fixedVersionId: 'other' }), '确认采用并固定').props.disabled).toBe(true);
    hooks.values[1] = { candidate: 'error' };
    const tree = render(props); expect(button(tree, '确认采用并固定').props.disabled).toBe(true); button(tree, '确认采用并固定').props.onClick(); expect(props.onSetFixed).not.toHaveBeenCalled();
  });
});
