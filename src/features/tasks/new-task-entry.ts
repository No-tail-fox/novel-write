import type { NewTaskDraftSnapshot } from './new-task-draft';

/** Keep legacy material snapshots readable without exposing a third short-video step. */
export function shortVideoEditorStage(stage: NewTaskDraftSnapshot['activeStage']): 'creative' | 'output' {
  return stage === 'output' ? 'output' : 'creative';
}
