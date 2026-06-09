# Artifact Step Rerun Design

## Goal

Add per-step controls in the artifact preview so each pipeline section can either regenerate from that step or rewrite from the existing step output, then continue running downstream steps.

## Scope

Every artifact preview section gets two compact actions in the section header:

- `重新生成`: discard the selected step and every downstream artifact, then rerun from that step using the normal prompts and upstream data.
- `改写后继续`: discard the selected step and every downstream artifact, mark the rerun as rewrite-assisted, and rerun from that step with the existing artifact snapshot included as context.

The first pass keeps the workflow automatic. It does not add a manual editing modal, custom per-run instructions, or a new review queue.

## Architecture

The renderer calls a new API method:

```ts
rerunTaskStep(taskId: string, step: number, mode: 'regenerate' | 'rewrite'): Promise<AppState>
```

Electron handles the IPC request by validating the task and artifact state file, invalidating the pipeline cache from the requested step, updating task retry metadata, writing a task event, and using the existing `resumeTaskRun(database, updatedTask)` path.

The runner continues to own execution. Cache invalidation makes the selected step look incomplete, so existing step checks naturally rerun the right work. The `rewrite` mode adds a lightweight marker to the pipeline state; LLM content steps can use that marker to include current artifact output as context when rebuilding the selected step.

## Step Invalidation Rules

- Step 0 `文案预审`: clear reviewed text, rewritten copy, cover, scenes, image prompts, subtitles, images, narration, and draft.
- Step 1 `改写与封面`: keep source context and reviewed text; clear rewritten copy, cover, scenes, image prompts, subtitles, images, narration, and draft.
- Step 2 `分镜`: keep reviewed text, rewritten copy, and cover; clear scenes, image prompts, subtitles, images, narration, and draft.
- Step 3 `绘图提示词`: keep scenes; clear image prompts, images, narration, and draft.
- Step 4 `批量生图`: keep text and prompts; clear image assets and draft.
- Step 5 `TTS 配音`: keep images; clear narration assets and draft.
- Step 6 `剪映草稿`: clear draft only.

For every requested step, mark that step and all downstream steps as `pending` and remove downstream output paths or errors.

## UI

Reuse the existing section header pattern. Extend `ArtifactSection` with an optional action area, and pass step-specific controls from `ArtifactPreviewContent`.

Buttons are disabled in browser preview and while the task is `running` or `pending`. While a rerun request is in flight, show a spinner in the clicked button.

## Testing

- Add a pipeline-cache unit test for invalidating from each representative step.
- Add an Electron IPC contract test for `task:rerun-step`, preload exposure, and type declaration exposure.
- Add a renderer shell test that artifact sections expose both `重新生成` and `改写后继续`.
- Run targeted tests first, then typecheck or the full test suite as needed.

## Non-goals

- No manual text editor for the current artifact in this pass.
- No partial single-scene rerun changes beyond the existing image and narration controls.
- No deletion of old files from disk; this only invalidates state and writes new outputs on rerun.
