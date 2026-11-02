import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { lemoUiRun, lemoUiShots } from './lemo-production-ui.fixture';
const hooks = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], cursor: 0, refCursor: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (value: any) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }]; },
  useRef: (initial: any) => hooks.refs[hooks.refCursor++] ??= { current: initial }, useEffect: () => {},
}));
vi.mock('../src/ui', () => ({ Button: 'Button', CheckboxField: 'CheckboxField', TextField: 'TextField', SelectField: 'SelectField', TextAreaField: 'TextAreaField', Dialog: 'Dialog' }));
import { VoxProductionProgress } from '../src/features/editorial-collage/VoxProductionProgress';
import { LemoBudgetFields } from '../src/features/editorial-collage/LemoBudgetFields';
type Props = Parameters<typeof VoxProductionProgress>[0];
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); return isValidElement<{ children?: ReactNode; actions?: ReactNode }>(node) ? [node, ...nodes(node.props.children), ...nodes(node.props.actions)] : []; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(''); return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render(props: Props) { hooks.cursor = 0; hooks.refCursor = 0; return nodes(VoxProductionProgress(props)); }
function find(tree: any[], type: string, label: string) { const node = tree.find(n => n.type === type && (n.props.label === label || text(n.props.children) === label)); expect(node, label).toBeTruthy(); return node; }
function fixture() { return { run: lemoUiRun(), shots: lemoUiShots, busy: false, onClose: vi.fn(), onControl: vi.fn(async () => {}) } satisfies Props; }
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.cursor = 0; hooks.refCursor = 0; });
describe('Lemo controlVoxProduction budget and repair UI', () => {
  it('repairs the selected stable shot ID using trimmed instructions', async () => {
    const props = fixture(); let tree = render(props);
    expect(find(tree, 'Button', '修复此镜头并导出成片').props.disabled).toBe(true);
    find(tree, 'SelectField', '需要修复的镜头').props.onChange({}, { value: 'shot-2' });
    find(tree, 'TextAreaField', '镜头修复要求').props.onChange({}, { value: '  保持素材和旁白，让路线标注更清晰。  ' });
    tree = render(props); expect(find(tree, 'Button', '修复此镜头并导出成片').props.disabled).toBe(false);
    await find(tree, 'Button', '修复此镜头并导出成片').props.onClick();
    expect(props.onControl).toHaveBeenCalledExactlyOnceWith('repair-shot', { shotId: 'shot-2', instructions: '保持素材和旁白，让路线标注更清晰。' });
  });
  it('blocks exhausted repair budget, busy runs, and invalid instruction lengths', () => {
    const props = fixture(); render(props); find(render(props), 'TextAreaField', '镜头修复要求').props.onChange({}, { value: '长'.repeat(4001) });
    expect(find(render(props), 'Button', '修复此镜头并导出成片').props.disabled).toBe(true);
    find(render(props), 'TextAreaField', '镜头修复要求').props.onChange({}, { value: '请让路线标注更加清晰' });
    expect(find(render({ ...props, busy: true }), 'Button', '修复此镜头并导出成片').props.disabled).toBe(true);
    props.run.settings.lemoBudget!.maxRepairRounds = 0;
    const tree = render(props); expect(find(tree, 'SelectField', '需要修复的镜头').props.disabled).toBe(true);
    expect(find(tree, 'Button', '修复此镜头并导出成片').props.disabled).toBe(true);
    expect(tree.some(n => n.props.role === 'status' && text(n.props.children).includes('修复次数上限'))).toBe(true);
  });
  it('counts persisted repairs and hides repair while an official result is unresolved', () => {
    const props = fixture(); props.run.nodes.push({ id: 'official-repair:1', kind: 'film-edit', dependencies: ['official-authoring'], status: 'completed', paid: true, attempt: 1 });
    expect(render(props).some(n => n.type === 'p' && text(n.props.children).includes('已发起 1/2 次镜头修复'))).toBe(true);
    props.run.status = 'paused'; props.run.nodes[3].status = 'unknown';
    const tree = render(props); expect(tree.some(n => n.type === 'Button' && text(n.props.children) === '修复此镜头并导出成片')).toBe(false);
    expect(find(tree, 'Button', '继续官方步骤').props.disabled).toBe(false);
  });
  it('keeps source selection stable after reordering shots and falls back when a shot is removed', () => {
    const props = fixture(); find(render(props), 'SelectField', '需要修复的镜头').props.onChange({}, { value: 'shot-2' });
    expect(find(render({ ...props, shots: [...props.shots].reverse() }), 'SelectField', '需要修复的镜头').props.value).toBe('shot-2');
    expect(find(render({ ...props, shots: [props.shots[0]] }), 'SelectField', '需要修复的镜头').props.value).toBe('shot-1');
  });
  it('keeps all execution ceilings editable and does not coerce an empty input into zero', () => {
    const value = lemoUiRun().settings.lemoBudget!; const onChange = vi.fn();
    const tree = nodes(LemoBudgetFields({ value, onChange })); expect(tree.filter(n => n.type === 'TextField')).toHaveLength(6);
    find(tree, 'TextField', '整片最多模型请求').props.onChange({}, { value: '12' }); expect(onChange).toHaveBeenLastCalledWith({ ...value, maxRequests: 12 });
    find(tree, 'TextField', 'SDK 估算费用上限（美元）').props.onChange({}, { value: '' }); expect(Number.isNaN(onChange.mock.calls.at(-1)![0].maxEstimatedCostUsd)).toBe(true);
    expect(nodes(LemoBudgetFields({ value, onChange, disabled: true })).filter(n => n.type === 'TextField').every(n => n.props.disabled)).toBe(true);
  });
});
