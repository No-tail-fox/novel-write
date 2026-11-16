import { describe, expect, it } from 'vitest';
import type { MotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import { changeScriptEditHistory, createScriptEditHistory, type ScriptEditHistory, type ScriptHistoryAction } from '../src/features/motion-comic/motion-comic-script-history';

const script: MotionComicScriptDraft = {
  title: '来信', logline: '收到来信', characters: [], sceneAssets: [], props: [],
  scenes: [{ key: 'room', title: '来信', actIndex: 1, actTitle: '开端', actBoundaryReason: '来信', summary: '收到信', locationKey: 'room', beats: [
    { key: 'one', kind: 'action', text: '开门', sourceUnitIds: ['S1'] },
    { key: 'two', kind: 'narration', text: '有人来信', sourceUnitIds: ['S2'] },
  ] }],
};
const start = () => createScriptEditHistory('task', 3, script);
const apply = (history: ScriptEditHistory, action: ScriptHistoryAction) => changeScriptEditHistory(history, action, { taskId: 'task', revision: 3, expected: history.present, locked: false });

describe('script local edit history', () => {
  it('undoes and redoes the exact draft, preserving source evidence and server revision', () => {
    const initial = start();
    const changed = apply(initial, { type: 'edit', script: { ...script, title: '新来信' } });
    const undone = apply(changed, { type: 'undo' });
    expect(undone.present).toEqual(script);
    expect(undone.baseRevision).toBe(3);
    expect(apply(undone, { type: 'redo' }).present).toEqual(changed.present);
    expect(initial.present).toEqual(script);
  });
  it('undoes reordered beats as complete snapshots without guessing by array index', () => {
    const reordered = { ...script, scenes: [{ ...script.scenes[0], beats: [...script.scenes[0].beats].reverse() }] };
    const history = apply(start(), { type: 'edit', script: reordered });
    expect(apply(history, { type: 'undo' }).present).toEqual(script);
    expect(apply(apply(history, { type: 'undo' }), { type: 'redo' }).present).toEqual(reordered);
  });
  it('rejects stale revision, another task, locked state and stale local callbacks', () => {
    const history = apply(start(), { type: 'edit', script: { ...script, title: '人工后续修改' } });
    const valid = { taskId: 'task', revision: 3, expected: history.present, locked: false };
    for (const override of [{ revision: 4 }, { taskId: 'other' }, { locked: true }, { expected: script }]) {
      expect(() => changeScriptEditHistory(history, { type: 'undo' }, { ...valid, ...override })).toThrow();
    }
    expect(history.present.title).toBe('人工后续修改');
  });
  it('drops redo after a new edit, skips no-op edits and bounds snapshot retention', () => {
    let history = start();
    expect(apply(history, { type: 'undo' })).toBe(history);
    expect(apply(history, { type: 'edit', script })).toBe(history);
    history = apply(history, { type: 'edit', script: { ...script, title: 'A' } });
    history = apply(history, { type: 'undo' });
    history = apply(history, { type: 'edit', script: { ...script, title: 'B' } });
    expect(history.future).toEqual([]);
    for (let index = 0; index < 110; index++) history = apply(history, { type: 'edit', script: { ...script, title: String(index) } });
    expect(history.past).toHaveLength(100);
  });
  it('isolates caller objects and creates a fresh baseline after save or restore', () => {
    const input = structuredClone(script);
    const history = createScriptEditHistory('task', 3, input);
    input.scenes[0].beats[0].text = 'unexpected mutation';
    expect(history.present).toEqual(script);
    const edited = apply(history, { type: 'edit', script: { ...script, title: 'changed' } });
    const saved = createScriptEditHistory('task', 4, edited.present);
    expect(saved.past).toEqual([]);
    expect(saved.future).toEqual([]);
    expect(saved.baseRevision).toBe(4);
  });
});
