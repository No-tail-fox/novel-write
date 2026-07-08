# Storyboard Prompt Edit Design

## Goal

Allow users to repair a single image prompt from the storyboard gallery after an image provider rejects it, then reuse the existing single-image regenerate flow.

## Scope

Each storyboard gallery card gets a `修改提示词` action below `重新生成`. The action expands an inline editor for that scene's positive image prompt only.

The first pass only edits `imagePrompts[].prompt`. It does not edit `negativePrompt`, style, ratio, character profile, scene text, or the Step 3 prompt-generation template.

## Architecture

The renderer keeps the edit interaction local to `ImageGenerationGallery`. When the user saves, it calls a new API:

```ts
updateTaskImagePrompt(taskId: string, sceneId: number, prompt: string): Promise<AppState>
```

Electron validates the task and its artifact state file, updates only the matching `artifact.imagePrompts` entry in `pipeline/state.json`, refreshes `updatedAt`, records a task event, and returns the latest `AppState`.

The existing `regenerateTaskImage(task.id, sceneId)` path remains unchanged. Because the runner reads `artifact.imagePrompts` from the cached pipeline state before Step 4, the regenerated image naturally uses the saved prompt.

## Data Rules

- Require a finite scene id.
- Require a non-empty trimmed prompt.
- Require `artifact.imagePrompts` to already contain the target scene.
- Preserve every other field on the prompt object, including `negativePrompt`, `style`, `ratio`, and `characterProfile`.
- Do not remove existing image assets or image errors when saving. Regeneration remains an explicit second action.
- Refresh the artifact snapshot after save by applying the returned `AppState`.

## UI

The image card keeps its current title, status, prompt preview, path/error display, and `重新生成` button.

Under that button, add `修改提示词`. When active, render a textarea plus `保存提示词` and `取消`. Disable save while the task is running/pending, in browser preview, while the save is in flight, or while the edited prompt is blank.

Saving collapses the editor after success. The card preview then shows the updated prompt.

## Testing

- Add a `pipeline-cache` unit test for updating one scene prompt without changing other prompt fields or assets.
- Add an Electron IPC contract test for `task:update-image-prompt`, preload exposure, and renderer type exposure.
- Add a renderer shell test for the inline editor labels and API call.
- Run targeted tests first, then typecheck and the full test suite before completion.

## Non-goals

- No Step 3 rerun or prompt-template editing.
- No automatic regeneration immediately after saving.
- No negative prompt editor.
- No deletion of old image files from disk.
