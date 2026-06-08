# Coze Workflow Draft Template Converter Design

**Goal:** Build a reusable converter that turns copied Coze workflow clipboard JSON into Storybound draft template presets, so users can paste each workflow source and save it as a selectable draft template.

## Source Shape

The source input is Coze clipboard JSON with `type: "coze-workflow-clipboard-data"`. The converter reads:

- `source.workflowId`, `source.spaceId`, and `source.host` for traceability.
- Plugin nodes whose `apiName` describes Jianying operations, such as `create_draft`, `add_videos`, `add_audios`, `add_captions`, `add_effects`, `add_images`, `add_keyframes`, and data-generator APIs such as `caption_infos`, `effect_infos`, `imgs_infos`, and `keyframes_infos`.
- Literal input values and simple references between node outputs.
- Start node defaults for background video, background music, and theme text.
- Comment links for provenance, but not as trusted template data.

## Output Shape

The first output is a `DraftTemplate` because Storybound already stores, previews, edits, and uses this type when generating Jianying drafts. The converter will also return a small diagnostics object so the UI can explain what was mapped and what needs manual tuning.

The generated template is not a full Coze workflow clone. It is a reusable Storybound draft preset that preserves the observable video layout and export settings where the current draft model supports them.

## Mapping

- `create_draft.width` and `create_draft.height` map to `canvas.width`, `canvas.height`, and an inferred `canvas.ratio`.
- `add_videos` maps to `image.visible`, `image.ratio`, `image.fit`, and base opacity assumptions. Current `DraftTemplate` has image area controls but does not store background-video URLs, so source URLs are preserved in diagnostics for future asset-aware templates.
- `add_audios` maps to audio volume/fade fields where literals are present. Background music URLs are preserved as diagnostics because BGM assets are task/runtime inputs in the current app.
- `add_captions` and `caption_infos` map to `caption` style, position, width, keyword color hints, wrapping, and visibility.
- `add_images` and `imgs_infos` map to text overlay presets when the node represents background big text. Current `DraftTemplate` has title/subtitle/disclaimer text overlays, so the converter picks the closest layer and records any unmapped image generation/cutout behavior.
- `add_effects`, `effect_infos`, and `add_keyframes` map to `audio.videoEffectType`, transitions, and alpha/keyframe approximations where a compatible enum/name is visible.
- Unknown plugins or code nodes are recorded in diagnostics rather than guessed silently.

## UI

Add an import affordance inside the existing "草稿模板" page:

- Paste a Coze workflow JSON blob.
- Preview the detected workflow ID, node count, canvas size, and generated template name.
- Save as a local draft template.
- The saved template appears with the existing template cards and can be copied or edited.

Batch import can be added by allowing multiple JSON blobs separated by blank lines or by importing a JSON array. This covers the user's workflow: copy each video's Coze source and paste it into Storybound.

## Error Handling

The converter validates that the input is Coze workflow clipboard data. Invalid JSON, missing nodes, missing `create_draft`, or unsupported dimensions return actionable errors.

Partial conversion is allowed. Diagnostics should include warnings for:

- Asset URLs that cannot be represented in `DraftTemplate`.
- Code nodes that influence timing or text segmentation.
- Keyframe/effect names that the current pyJianYingDraft bridge may not resolve.
- Coze plugin APIs with no current Storybound equivalent.

## Testing

Use the pasted workflow payload as a representative fixture. Tests should cover:

- Parsing Coze clipboard JSON.
- Extracting plugin nodes and API parameters.
- Converting the sample workflow into a landscape `DraftTemplate`.
- Producing diagnostics for preserved background video/audio URLs and unsupported nodes.
- Saving imported templates through the existing storage/app-state path.
- Rendering the import UI markers in `src/main.tsx`.
