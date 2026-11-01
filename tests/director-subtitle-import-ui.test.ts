import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock('../src/ui', () => ({ Button: 'button', CheckboxField: 'checkbox', SelectField: 'select', TextAreaField: 'textarea', TextField: 'input', Toolbar: 'toolbar' }));
import { DirectorSubtitleInspector, type DirectorSubtitleInspectorProps } from '../src/features/director-desk/DirectorSubtitleInspector';

function props(overrides: Partial<DirectorSubtitleInspectorProps> = {}): DirectorSubtitleInspectorProps {
  return {
    cues: [{ id: 'cue-one', text: '第一句', startMs: 0, endMs: 1000 }, { id: 'cue-two', text: '第二句', startMs: 1000, endMs: 2000 }],
    shotStartMs: 0, durationMs: 2000, busy: false, style: 'default', safeAreaVisible: false,
    onUpdate: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onAlign: vi.fn(), onImportTimestamps: vi.fn(),
    onSeek: vi.fn(), onStyleChange: vi.fn(), onSafeAreaChange: vi.fn(), ...overrides,
  };
}
function elements(node: ReactNode): Array<{ type: unknown; props: { children?: ReactNode; disabled?: boolean; onClick?: () => void } }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === 'string' ? node : '';
}
function controls(input: DirectorSubtitleInspectorProps) {
  return elements(DirectorSubtitleInspector(input)).filter(node => node.type === 'button' && text(node.props.children) === '导入识别时间戳');
}
describe('subtitle timestamp import control', () => {
  it('exposes a separate import command for each cue and dispatches its stable id', () => {
    const input = props();
    const buttons = controls(input);
    expect(buttons).toHaveLength(2);
    buttons[1].props.onClick?.();
    expect(input.onImportTimestamps).toHaveBeenCalledExactlyOnceWith('cue-two');
    expect(input.onAlign).not.toHaveBeenCalled();
    expect(input.onUpdate).not.toHaveBeenCalled();
  });
  it('disables timestamp imports while the workspace is busy', () => {
    expect(controls(props({ busy: true })).every(button => button.props.disabled)).toBe(true);
  });
  it('disables empty cues without disabling adjacent authored cues', () => {
    const input = props();
    input.cues = [{ ...input.cues[0], text: '  ' }, input.cues[1]];
    expect(controls(input).map(button => button.props.disabled)).toEqual([true, false]);
  });
  it('does not expose a dead command when the host has no import capability', () => {
    expect(controls(props({ onImportTimestamps: undefined }))).toHaveLength(0);
  });
});
