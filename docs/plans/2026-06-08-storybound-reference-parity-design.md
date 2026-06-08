# Storybound Reference Parity Design

## Goal

Supplement the current app by reference to `G:\Storybound`, covering voice lab, prompt content, and draft template content in one coherent pass.

## Reference Findings

- The reference app stores runtime data in `C:\Users\foxnotail\AppData\Local\com.dudumd.storybound`.
- Its `data.db` contains `draft_templates`, `user_prompt_templates`, `playground_jobs`, and `minimax_clone_voices`.
- The old prompt-template schema centers on five editable content fields: rewrite prompt, metadata prompt, Step 3 image prompt, style id, and image seed pools.
- The old draft-template configs include text stroke/border fields for title, subtitle, caption, and disclaimer.
- The current app already has richer task prompt templates and a visual draft editor, but lacks a standalone voice audition lab and full text-stroke editing.

## Scope

### Voice Lab

Add a first-class `voice-lab` shell page. It should let the user:

- enter preview text
- select Volcengine or MiniMax
- select voice id and speed
- generate a real MP3 using existing TTS provider configuration
- play the result in-app
- keep a local history of generated voice previews

This reuses existing provider code instead of introducing a new TTS integration path.

### Prompt Content

Enhance prompt-template editing with a reference-style "content fields" panel:

- task instruction
- Step 1 rewrite prompt
- Step 1 metadata prompt
- Step 3 image prompt
- image seed pools JSON

The existing `PromptTemplate.content` and `stepPrompts` remain the source of truth. `imageSeedPoolsJson` is added as optional metadata for reference parity and future use.

### Draft Templates

Extend `DraftTemplate` text layers with a `border` object:

- `color`
- `width`
- `alpha`

Expose the controls for title, subtitle, caption, and disclaimer. Render stroke in the preview using `textShadow` so the visual editor reflects the saved setting. Preserve existing legacy templates with normalization defaults.

## Data Model

- Add `voice-lab` to `ShellView`.
- Add `VoiceLabRecord` to app state and storage.
- Add optional `imageSeedPoolsJson` to `PromptTemplate`.
- Add text border fields to draft title/subtitle/caption/disclaimer.

## IPC/API

- Add `voice-lab:generate` in Electron.
- Add `voice_lab_records` table in storage.
- Browser preview may return a clear error for real voice generation; Electron uses existing `createConfiguredNarrationSynthesizer`.

## Testing

- Unit test storage migration and persistence for voice lab records.
- Unit test TTS provider can generate a single voice preview through a new helper.
- Unit test draft-template normalization fills text border defaults.
- Product shell tests assert the new navigation page, prompt content panel, and draft stroke controls exist.

## Non-goals

- Do not implement MiniMax voice cloning API in this pass.
- Do not replace the existing prompt-template architecture with the old reference database schema.
- Do not import private reference credentials.

