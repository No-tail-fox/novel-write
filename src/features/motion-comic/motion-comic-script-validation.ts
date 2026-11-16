import { repairMotionComicTitleNarration, splitMotionComicSource, validateMotionComicScriptDraft, type MotionComicPlanningIssue, type MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import type { MotionComicPipelineData } from '../../shared/motion-comic';

export function scriptDraftIssues(script: MotionComicScriptDraft, sourceText: string, project: MotionComicPipelineData, instructions: string): MotionComicPlanningIssue[] {
  return validateMotionComicScriptDraft(script, splitMotionComicSource(sourceText), project, instructions);
}

export function scriptIssueLocation(path: string): string {
  const match = /^script\.scenes\[(\d+)\](?:\.beats\[(\d+)\])?/.exec(path);
  return match ? `第 ${Number(match[1]) + 1} 场${match[2] === undefined ? '' : ` · 第 ${Number(match[2]) + 1} 条`}` : '本集剧本';
}

/** Only standalone chapter headings can be changed without interpreting story content. */
export function repairScriptTitleNarration(script: MotionComicScriptDraft, sourceText: string): MotionComicScriptDraft {
  return repairMotionComicTitleNarration(script, splitMotionComicSource(sourceText));
}
