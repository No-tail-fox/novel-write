# Storyboard Gallery Focus Design

## Goal

Simplify the task detail `storyboard` tab so it only shows the controls and context needed for image review:

- `批量生图` first, with generated thumbnails, status, paths, and per-scene regenerate actions.
- `分镜分句` second, with scene copy and the prompt snippet already paired to each scene.

## UI Changes

- Remove the `分镜画廊` hero strip from the storyboard tab.
- Remove the separate `全部图片` section from the storyboard tab because `批量生图` already shows the same image review surface with controls.
- Remove the separate `绘图提示词` section from the storyboard tab to reduce duplication.
- Keep the full artifact preview tab unchanged so users can still inspect every pipeline artifact when needed.

## Data Flow

No data model or runtime pipeline changes are needed. The existing `ImageGenerationGallery` continues to receive `scenes`, `imagePrompts`, `images`, provider concurrency, and regeneration callbacks. The existing `ArtifactSceneList` remains below it.

## Verification

- Update the UI structure test for storyboard tab ordering.
- Run the focused product shell UI test.
- Typecheck the project if the focused test passes.
