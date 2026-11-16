import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { DirectorSubtitleInspector, type DirectorSubtitleInspectorProps } from '../src/features/director-desk/DirectorSubtitleInspector';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { setDirectorSubtitleCues } from '../src/shared/director-subtitle-structure';

// Exercise the component's event handlers and state transitions without a browser/portal.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
}));
vi.mock('../src/ui', () => Object.fromEntries(['Button', 'CheckboxField', 'Dialog', 'SelectField', 'TextAreaField', 'TextField', 'Toolbar'].map(name => [name, name])));

type Element = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children), ...nodes(element.props.actions)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node && typeof node === 'object' && 'props' in node ? text((node as Element).props.children) : '';
}
function harness(extra: Partial<DirectorSubtitleInspectorProps> = {}) {
  const props: DirectorSubtitleInspectorProps = {
    cues: [{ id: 'original', shotId: 'shot', text: '原有对白', startMs: 0, endMs: 3000, voiceAssetVersionId: 'voice-old' }],
    shotId: 'shot', shotPrompt: '林夏（愤怒）：不要过来！', shotStartMs: 0, durationMs: 3000,
    busy: false, style: '', safeAreaVisible: true, onUpdate: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onAlign: vi.fn(), onSeek: vi.fn(), onStyleChange: vi.fn(), onSafeAreaChange: vi.fn(), ...extra,
  };
  function render() { hooks.cursor = 0; return DirectorSubtitleInspector(props); }
  function button(label: string) { return nodes(render()).find(node => node.type as unknown === 'Button' && text(node.props.children) === label)!; }
  function parse() { button('智能提取').props.onClick(); button('分析提取').props.onClick(); }
  return { props, render, button, parse };
}
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });

describe('subtitle extraction application safety', () => {
  it('disables both applications without a batch capability and never falls back to destructive single edits', () => {
    const h = harness(); const before = structuredClone(h.props.cues); h.parse();
    for (const label of ['替换当前所有对白', '追加到末尾']) expect(h.button(label).props.disabled).toBe(true);
    h.button('追加到末尾').props.onClick();
    expect(text(h.render())).toContain('当前工作流尚未接入对白批量应用');
    expect(h.props.onRemove).not.toHaveBeenCalled(); expect(h.props.onAdd).not.toHaveBeenCalled(); expect(h.props.cues).toEqual(before);
  });
  it('requires confirmation before replacing existing dialogue and cancel preserves it', () => {
    const apply = vi.fn(); const h = harness({ onBatchApplyCues: apply }); h.parse();
    h.button('替换当前所有对白').props.onClick();
    expect(apply).not.toHaveBeenCalled();
    expect(nodes(h.render()).find(node => node.type as unknown === 'Dialog')?.props.open).toBe(true);
    h.button('取消').props.onClick();
    expect(apply).not.toHaveBeenCalled(); expect(h.props.cues[0].text).toBe('原有对白');
  });
  it('keeps existing data and extraction preview when replacement rejects, then permits retry', async () => {
    const apply = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce(undefined);
    const h = harness({ onBatchApplyCues: apply }); const before = structuredClone(h.props.cues); h.parse();
    h.button('替换当前所有对白').props.onClick(); h.button('确认替换').props.onClick();
    await vi.waitFor(() => expect(text(h.render())).toContain('对白应用失败'));
    expect(text(h.render())).toContain('成功解析'); expect(h.props.cues).toEqual(before);
    expect(h.props.onRemove).not.toHaveBeenCalled(); expect(h.props.onAdd).not.toHaveBeenCalled();
    h.button('替换当前所有对白').props.onClick(); h.button('确认替换').props.onClick();
    await vi.waitFor(() => expect(text(h.render())).not.toContain('成功解析'));
    expect(apply).toHaveBeenLastCalledWith([expect.objectContaining({ text: '不要过来！', speakerName: '林夏', emotion: '愤怒', shotId: 'shot', startMs: 150, endMs: 2850 })], 'replace');
  });
  it('applies an empty-shot extraction once with real text and explicit shot ownership', async () => {
    let finish!: () => void;
    const apply = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const h = harness({ cues: [], onBatchApplyCues: apply }); h.parse();
    const button = h.button('替换当前所有对白'); button.props.onClick(); button.props.onClick();
    expect(apply).toHaveBeenCalledTimes(1); expect(h.button('追加到末尾').props.disabled).toBe(true);
    expect(apply.mock.calls[0]).toEqual([[expect.objectContaining({ shotId: 'shot', text: '不要过来！' })], 'replace']);
    finish(); await vi.waitFor(() => expect(text(h.render())).not.toContain('成功解析'));
  });
});

describe('real batch subtitle document edits', () => {
  it.each(['append', 'replace'] as const)('%s preserves dialogue metadata and changes only the selected shot', mode => {
    const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'extract-test', title: '对白', premise: '雨夜相遇' }));
    const shot = document.episodes[0].scenes[0].shots[0];
    const before = structuredClone(document);
    const old = document.episodes[0].dialogueCues.filter(c => c.shotId === shot.id);
    const next = setDirectorSubtitleCues(document, shot.id, [{ id: 'extracted', text: '不要过来！', startMs: 0, endMs: 1000, emotion: '愤怒', speakerName: '林夏', speakerRole: 'dialogue', bubbleStyle: 'shout' }], mode);
    const actual = next.episodes[0].dialogueCues.filter(c => c.shotId === shot.id);
    expect(actual).toHaveLength(mode === 'append' ? old.length + 1 : 1);
    expect(actual.find(c => c.id === 'extracted')).toMatchObject({ text: '不要过来！', emotion: '愤怒', speakerName: '林夏', bubbleStyle: 'shout' });
    if (mode === 'append') expect(actual.filter(c => c.id !== 'extracted').map(c => c.text)).toEqual(old.map(c => c.text));
    expect(next.episodes[0].dialogueCues.filter(c => c.shotId !== shot.id)).toEqual(document.episodes[0].dialogueCues.filter(c => c.shotId !== shot.id));
    expect(document).toEqual(before);
  });
  it('rejects a failed replace without deleting original text, audio or references', () => {
    const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'extract-failure', title: '对白', premise: '雨夜相遇' }));
    const shot = document.episodes[0].scenes[0].shots[0]; shot.voiceAssetVersionId = 'keep-voice';
    const before = structuredClone(document);
    expect(() => setDirectorSubtitleCues(document, shot.id, Array.from({ length: 101 }, (_, index) => ({ id: `cue-${index}`, text: '过量对白', startMs: 0, endMs: 1000 })), 'replace')).toThrow('100');
    expect(document).toEqual(before);
  });
});
