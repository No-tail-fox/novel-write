import type { MotionComicScriptDraft } from '../../shared/motion-comic-planning';

/** Session-only snapshots. Server revisions never move backwards with local undo. */
export interface ScriptEditHistory {
  taskId: string;
  baseRevision: number;
  present: MotionComicScriptDraft;
  past: MotionComicScriptDraft[];
  future: MotionComicScriptDraft[];
}

export function createScriptEditHistory(taskId: string, baseRevision: number, script: MotionComicScriptDraft): ScriptEditHistory {
  return { taskId, baseRevision, present: structuredClone(script), past: [], future: [] };
}

export type ScriptHistoryAction = { type: 'edit'; script: MotionComicScriptDraft } | { type: 'undo' | 'redo' };
export function changeScriptEditHistory(history: ScriptEditHistory, action: ScriptHistoryAction, context: {
  taskId: string; revision: number; expected: MotionComicScriptDraft; locked: boolean;
}): ScriptEditHistory {
  if (context.locked) throw new Error('当前剧本不可编辑，本地修改仍保留。');
  if (history.taskId !== context.taskId || history.baseRevision !== context.revision) throw new Error('剧本版本已变化，请先核对并载入当前版本。');
  if (JSON.stringify(context.expected) !== JSON.stringify(history.present)) throw new Error('本地稿已变化，请基于当前内容重试，未覆盖后续修改。');
  if (action.type === 'edit') {
    if (JSON.stringify(action.script) === JSON.stringify(history.present)) return history;
    return { ...history, past: [...history.past, history.present].slice(-100), present: structuredClone(action.script), future: [] };
  }
  const stack = action.type === 'undo' ? history.past : history.future;
  if (!stack.length) return history;
  const present = stack[stack.length - 1];
  return action.type === 'undo'
    ? { ...history, present, past: history.past.slice(0, -1), future: [...history.future, history.present] }
    : { ...history, present, past: [...history.past, history.present], future: history.future.slice(0, -1) };
}
