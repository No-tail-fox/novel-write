import { workflowPrompt } from '../workflow-prompt-runtime';
import type { EditorialLayerKind } from '../editorial-collage';
import { buildEditorialScenePrompt, editorialImageTargetRules, isEditorialAutoLayerPrompt, resolveEditorialScenePrompt } from '../editorial-image-prompts';

/** Content briefs stay reusable across styles; only image dispatch adds materials. */
export function creativeScenePrompt(input: Parameters<typeof resolveEditorialScenePrompt>[0]): string {
  const resolved = resolveEditorialScenePrompt(input);
  if (resolved !== buildEditorialScenePrompt(input)) return resolved;
  return workflowPrompt("creative-scene", [
    'Show one recognizable subject and one visible action or relationship from the narration. Separate the environment from the moving subjects. Keep the lower 16% clear for host subtitles.',
    `Narrative context (meaning only, never print it): ${input.narration.trim()}`,
  ].join('\n'), { value1: (input.narration.trim()) });
}

export function creativeImageTargetRules(kind?: EditorialLayerKind): string {
  if (kind === 'background') return workflowPrompt("creative-target-1", 'OUTPUT TARGET — BACKGROUND ONLY. Quiet contextual scenery in the selected material and palette, generous open space. No foreground actors, hero objects, text, labels, numbers or watermark. Subjects will be animated separately; do not duplicate them in this plate.');
  // Preserve the local green-key contract, including a clean margin and no green subject.
  return editorialImageTargetRules(kind);
}

export function creativeLayerPrompt(kind: EditorialLayerKind, context: string, saved?: string, autoContexts: readonly string[] = []): string {
  if (saved?.trim() && !isEditorialAutoLayerPrompt(saved, kind, autoContexts)) return saved.trim();
  return workflowPrompt("creative-layer", [kind === 'background' ? 'Only the contextual environment, without the separately animated subject.' : 'Only one complete subject or object that explains the current idea.',
    `Semantic context (meaning only, never render these words): ${context.trim()}`, creativeImageTargetRules(kind)].join('\n'), { value1: (kind === 'background' ? 'Only the contextual environment, without the separately animated subject.' : 'Only one complete subject or object that explains the current idea.'), value2: (context.trim()), value3: (creativeImageTargetRules(kind)) });
}
