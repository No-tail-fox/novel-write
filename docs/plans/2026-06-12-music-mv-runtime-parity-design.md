# Music MV Runtime Parity Design

## Goal

Replicate the reference Storybound `音乐MV` module and make the previously shell-only runtime controls real: processing mode, pause checkpoints, three-round rewrite self-evaluation, and character-card extraction.

## Scope

### Music MV

Add a first-class `music-mv` shell page and task kind. The page accepts lyrics or MV copy, BGM/audio selection, ratio, visual style, caption style, rhythm mode, and scene count. It creates normal tasks marked as `music-mv`, so queue, history, task detail, image generation, TTS, and Jianying draft output stay on the existing pipeline.

The content pipeline adds an MV planning artifact:

- lyric/line segments
- rhythm mode
- section labels such as intro, verse, chorus, bridge, outro
- visual motif and caption style
- per-segment duration guidance

### Processing Mode

Persist and honor `processingMode` on every task.

- `full-auto`: run all steps through draft generation.
- `semi-auto`: pause after content artifacts are ready, before media generation.
- `clip-only`: stop after text/storyboard/image-prompt artifacts and mark the task completed without images, narration, or draft.

### Pause Checkpoints

Persisted `pausePoints` become runner behavior.

- `critical`: pause after content artifacts, after image generation, and before final draft write.
- `every-step`: pause after each completed step.
- `custom`: initially follows the critical checkpoints while leaving room for later per-step selection.

Pause is resumable: the task is saved as `paused`, `retryFromStep` points to the next step, and resume continues from cached pipeline state.

### Rewrite Self-Evaluation

Step 1 runs three rewrite rounds, asks the LLM to evaluate them, picks the best candidate, writes the selected copy and cover metadata, and saves `01-rewrite-evaluations.json`. If the chosen copy is far outside the target word range, the runner emits a warning task event.

### Character Card

Before image prompt generation, the runner extracts a character card from the rewritten copy and scenes, writes `02-character-card.json`, and injects that card into Step 3 prompt generation. Music MV uses the same card to keep performers, protagonists, and recurring visual motifs consistent.

## Architecture

Reuse existing task storage and `runTask` orchestration. Add typed task metadata and optional artifact fields rather than creating a separate MV database or runner. The runner remains cache-aware: existing completed steps are skipped, new artifact files are written under the task work directory, and reruns clear downstream cached outputs through the existing pipeline-cache path.

## Testing

- Storage tests for task kind, processing mode, and MV settings persistence.
- Runner tests for semi-auto pause, clip-only completion, pause checkpoints, rewrite evaluation artifacts, and character-card injection.
- UI source tests for the new `音乐MV` route and the processing-mode control being stateful.
- Typecheck and targeted Vitest suites before final verification.

## Non-Goals

- Real audio beat detection from waveform is not required in this pass; rhythm is modeled from line count and selected rhythm mode.
- Real payment/credit enforcement is separate from this implementation.
- MiniMax voice cloning and template marketplace are separate parity items.
