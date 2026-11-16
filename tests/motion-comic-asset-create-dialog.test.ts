import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(), useId: () => 'create-form',
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refCursor++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
}));
vi.mock('../src/ui', () => ({ Button: 'button', Dialog: 'dialog' }));
import { MotionComicAssetCreateDialog, normalizeMotionComicAssetCreateInput, type MotionComicAssetCreateDialogProps } from '../src/features/motion-comic/MotionComicAssetCreateDialog';
type Node = ReactElement<Record<string, any>>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!isValidElement(value)) return []; const node = value as Node; return [node, ...nodes(node.props.children), ...nodes(node.props.actions)]; }
function render(props: MotionComicAssetCreateDialogProps) { hooks.cursor = 0; hooks.refCursor = 0; const node = MotionComicAssetCreateDialog(props) as Node; return nodes((node.type as (props: unknown) => unknown)(node.props)); }
function props(patch: Partial<MotionComicAssetCreateDialogProps> = {}): MotionComicAssetCreateDialogProps { return { open: true, kind: 'character', onOpenChange: vi.fn(), onSubmit: vi.fn(), ...patch }; }
async function submit(tree: Node[]) { tree.find(node => node.type === 'form')!.props.onSubmit({ preventDefault: vi.fn() }); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { hooks.values = []; hooks.refs = []; });
describe('asset creation form boundary', () => {
  it('rejects empty names and requires a stable owner for looks', () => {
    expect(() => normalizeMotionComicAssetCreateInput({ kind: 'character', name: '  ', description: '' })).toThrow('名称');
    expect(() => normalizeMotionComicAssetCreateInput({ kind: 'look', name: '雨衣', description: '' })).toThrow('人物');
    expect(normalizeMotionComicAssetCreateInput({ kind: 'look', name: ' 雨衣 ', description: ' 夜雨 ', characterId: 'person' })).toEqual({ kind: 'look', name: '雨衣', description: '夜雨', characterId: 'person' });
  });
  it('cancel does not create and closed dialogs render no form', () => {
    const input = props(); const tree = render(input);
    tree.find(node => node.type === 'button' && node.props.children === '取消')!.props.onClick();
    expect(input.onOpenChange).toHaveBeenCalledWith(false); expect(input.onSubmit).not.toHaveBeenCalled();
    expect(MotionComicAssetCreateDialog({ ...input, open: false })).toBeNull();
  });
  it('blocks blank submission and retains entered fields on a failed create', async () => {
    const input = props({ onSubmit: vi.fn(async () => { throw new Error('保存失败'); }) });
    await submit(render(input)); expect(input.onSubmit).not.toHaveBeenCalled();
    let tree = render(input); tree.find(node => node.type === 'input')!.props.onChange({ target: { value: ' 林夏 ' } });
    await submit(render(input)); tree = render(input);
    expect(input.onSubmit).toHaveBeenCalledWith({ kind: 'character', name: '林夏', description: '' });
    expect(input.onOpenChange).not.toHaveBeenCalled();
    expect(tree.find(node => node.props.role === 'alert')?.props.children).toBe('保存失败');
    expect(tree.find(node => node.type === 'input')?.props.value).toBe(' 林夏 ');
  });
  it('dispatches only once while awaiting create, then closes after success', async () => {
    let finish!: () => void;
    const input = props({ onSubmit: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
    render(input).find(node => node.type === 'input')!.props.onChange({ target: { value: '人物' } });
    const tree = render(input); await submit(tree); await submit(tree);
    expect(input.onSubmit).toHaveBeenCalledTimes(1); expect(input.onOpenChange).not.toHaveBeenCalled();
    finish(); await Promise.resolve(); await Promise.resolve(); expect(input.onOpenChange).toHaveBeenCalledWith(false);
  });
  it('blocks submission while the parent is busy', async () => { const input = props({ busy: true }); await submit(render(input)); expect(input.onSubmit).not.toHaveBeenCalled(); });
});
