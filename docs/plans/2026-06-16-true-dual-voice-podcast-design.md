# True Dual Voice Podcast Design

## Goal

Add real two-speaker audio generation for two-host podcast tasks. The current mode shapes prompts and imagery like a podcast, but audio still follows a single voice chain. This design makes host A and host B use separate user-configured voice ids.

## Product Behavior

When the user selects `two-host-podcast` in the new task form:

- The form keeps the TTS provider and speed controls visible.
- The form shows two voice id inputs:
  - Host A voice id.
  - Host B voice id.
- The legacy speaker pair selector can remain as a label/preset helper, but the generated audio must use the explicit A/B voice ids.
- Task creation persists both voice ids.
- Existing narration tasks keep using the current single `speaker` field.

The narration preview should show that a scene can contain multiple audio turns. Each turn should expose speaker metadata so the user can verify that A and B were generated separately.

## Dialogue Splitting

The runner/media layer will split each podcast scene caption into dialogue turns before TTS.

Recognized prefixes include:

- `Host A:`, `Host B:`
- `A:`, `B:`
- `主持人A：`, `主持人B：`
- `主播A：`, `主播B：`

Each parsed turn stores:

- `speaker`: `A` or `B`
- `text`: text without the speaker prefix
- `turnIndex`: order inside the scene

If a caption has no usable speaker labels, split by sentence and alternate A/B. If splitting fails, keep one A turn for the scene so generation does not block.

## Audio Generation

For ordinary narration:

- Existing one-scene, one-audio behavior remains unchanged.

For two-host podcast:

- Each scene may produce multiple `SceneAsset` rows with the same `sceneId`.
- Each turn calls the selected TTS provider with the corresponding voice id.
- Output files use deterministic names such as `001-turn-001-A.mp3`.
- `SceneAsset` gains optional metadata:
  - `speaker?: 'A' | 'B'`
  - `turnIndex?: number`
  - `text?: string`

This avoids unsafe MP3 binary concatenation and keeps provider behavior transparent.

## Draft Timeline

The draft bridge must support multiple narration assets per scene.

The bridge payload should carry narration turns in scene order. In Python, the bridge should:

- Copy every narration file with a unique stem that includes scene id and turn index.
- Read each audio duration.
- Build a scene timeline where each scene duration is at least the sum of its turn audio durations.
- Add the audio segments consecutively on the narration track.
- Keep each scene image visible for the full scene duration.
- Keep subtitles at scene level for this pass.

The single-audio scene path remains supported for old artifacts and narration tasks.

## Storage And Compatibility

Add optional task fields:

- `podcastSpeakerA`
- `podcastSpeakerB`

SQLite migrations add nullable columns. Existing tasks read as null. For two-host podcast tasks with missing A/B fields, the runtime falls back to `speaker` or provider defaults, then raises a clear error only if no usable voice id exists.

Artifact snapshots and pipeline cache should preserve the optional `SceneAsset` metadata without requiring old artifacts to contain it.

## Testing

Use focused TDD:

- Dialogue splitter tests for labeled English/Chinese prefixes and unlabeled fallback.
- Storage tests for persisting `podcastSpeakerA` and `podcastSpeakerB`.
- Media provider tests proving a two-host scene issues separate TTS requests with separate voice ids.
- Runner/cache tests proving multiple narration assets for one scene are preserved.
- Draft bridge tests proving multiple narration assets become consecutive audio payload entries.
- UI contract tests proving the new task form exposes A/B voice id fields and does not hide provider/speed controls in podcast mode.

## Non-Goals

- No MP3 concatenation.
- No full per-turn subtitle rewrite in this pass.
- No voice marketplace or automatic voice lookup.
- No changes to image generation behavior beyond keeping current podcast image behavior compatible.
