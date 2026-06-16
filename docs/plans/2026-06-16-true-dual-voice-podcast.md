# True Dual Voice Podcast Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build true two-speaker podcast narration where host A and host B use separate user-configured voice ids.

**Architecture:** Extend the existing task, artifact, media provider, and pyJianYingDraft bridge contracts instead of introducing a separate podcast pipeline. Podcast scenes are split into ordered dialogue turns, generated as separate TTS assets, and placed consecutively on the draft narration timeline while ordinary narration remains one audio file per scene.

**Tech Stack:** React, TypeScript, Vite, Electron, sql.js, Vitest, pyJianYingDraft bridge script.

---

### Task 1: Task Shape And Storage Contract

**Files:**
- Modify: `tests/storage.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`

**Step 1: Write the failing test**

Add a test in `tests/storage.test.ts` that creates a two-host podcast task with:

- `podcastSpeakerA: 'voice-host-a'`
- `podcastSpeakerB: 'voice-host-b'`
- `ttsProvider: 'minimax'`
- `ttsSpeed: 1.15`

Expect the stored task to preserve `podcastSpeakerA` and `podcastSpeakerB`, and expect ordinary narration tasks to read both fields as `null` or `undefined`.

**Step 2: Run test to verify it fails**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\storage.test.ts`

Expected: FAIL because the task type/storage layer does not persist A/B voice ids.

**Step 3: Implement minimal storage support**

In `src/shared/types.ts`, add optional fields on `Task` and `CreateTaskInput`:

```ts
podcastSpeakerA?: string | null;
podcastSpeakerB?: string | null;
```

In `src/shared/storage.ts`:

- Add nullable columns `podcast_speaker_a` and `podcast_speaker_b`.
- Include migration entries.
- Persist values in task insert/update paths.
- Read values in row mapping.
- Default both fields to `null` unless provided.

**Step 4: Run test to verify it passes**

Run the same storage test command.

Expected: PASS.

### Task 2: Dialogue Turn Splitter

**Files:**
- Create: `src/shared/podcast-dialogue.ts`
- Create or modify: `tests/podcast-dialogue.test.ts`
- Modify: `src/shared/types.ts`

**Step 1: Write failing tests**

Create tests for:

- `Host A: Hello\nHost B: Hi` returns two turns with speakers A/B.
- `主持人A：你好\n主持人B：来了` returns two turns with speakers A/B.
- `A: One\nB: Two` strips the labels.
- Unlabeled text like `第一句。第二句。第三句。` alternates A/B/A.
- Empty or whitespace-only captions produce no turns.

**Step 2: Run test to verify it fails**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\podcast-dialogue.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Implement the splitter**

Add:

```ts
export type PodcastTurnSpeaker = 'A' | 'B';

export interface PodcastDialogueTurn {
  sceneId: number;
  speaker: PodcastTurnSpeaker;
  turnIndex: number;
  text: string;
}

export function splitPodcastDialogue(scene: Pick<StoryboardScene, 'id' | 'cap'>): PodcastDialogueTurn[];
```

Use a small prefix matcher for English and Chinese labels. For unlabeled text, split by Chinese and English sentence punctuation, trim blanks, and alternate speakers.

**Step 4: Run test to verify it passes**

Run the same podcast dialogue test command.

Expected: PASS.

### Task 3: SceneAsset Metadata And Cache Merge

**Files:**
- Modify: `tests/runner.test.ts`
- Modify: `tests/pipeline-cache.test.ts`
- Modify: `src/shared/draft.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/runner.ts`
- Modify: `src/shared/pipeline-cache.ts`

**Step 1: Write failing tests**

Add focused tests proving:

- `SceneAsset` can carry `speaker`, `turnIndex`, and `text`.
- `mergeAssets` in `runner.ts` preserves multiple assets with the same `sceneId` when their `turnIndex` differs.
- Narration regeneration for a scene removes all narration assets for that scene, not just one.

**Step 2: Run tests to verify they fail**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\runner.test.ts tests\pipeline-cache.test.ts`

Expected: FAIL because current merge logic keys only by `sceneId`.

**Step 3: Implement asset metadata support**

Update `SceneAsset` and `TaskArtifactAssetPreview` with optional metadata:

```ts
speaker?: 'A' | 'B';
turnIndex?: number;
text?: string;
```

Update merge logic to key narration assets by `sceneId + turnIndex + speaker + path`, while keeping image/cover merging behavior compatible. If helper reuse makes this awkward, add a narration-specific merge helper and leave image merging unchanged.

Confirm `markNarrationForRegeneration` keeps removing all assets for a scene.

**Step 4: Run tests to verify they pass**

Run the same focused command.

Expected: PASS.

### Task 4: Provider-Level Dual Voice TTS

**Files:**
- Modify: `tests/media-providers.test.ts`
- Modify: `src/shared/media-providers.ts`
- Modify: `src/shared/podcast-dialogue.ts`

**Step 1: Write failing tests**

Add tests for MiniMax and Volcengine V3:

- A two-host task with `podcastSpeakerA='voice-a'` and `podcastSpeakerB='voice-b'`.
- One scene caption containing A/B labels.
- Provider receives two requests.
- First request uses `voice-a`, second uses `voice-b`.
- Returned assets include `sceneId`, `speaker`, `turnIndex`, and `text`.

Add a validation test:

- Two-host podcast with missing A/B voice ids throws a clear error naming the missing field.

**Step 2: Run test to verify it fails**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\media-providers.test.ts`

Expected: FAIL because provider code sends one request per scene with one voice id.

**Step 3: Implement dual voice generation**

In `createConfiguredNarrationSynthesizer`, keep current provider selection. In provider-specific synthesizers:

- If `task.videoForm !== 'two-host-podcast'`, use current behavior.
- If `task.videoForm === 'two-host-podcast'`, call `splitPodcastDialogue` per scene.
- Resolve speaker voice id from `task.podcastSpeakerA` or `task.podcastSpeakerB`.
- Use each turn text in the request body.
- Write files as `001-turn-001-A.mp3`, `001-turn-002-B.mp3`.
- Push `SceneAsset` metadata.

Do not concatenate MP3 files.

**Step 4: Run test to verify it passes**

Run the same media provider test command.

Expected: PASS.

### Task 5: Runner Narration Completion Semantics

**Files:**
- Modify: `tests/runner.test.ts`
- Modify: `src/shared/runner.ts`

**Step 1: Write failing tests**

Add a runner test where:

- Artifact has one two-host scene.
- `synthesizeNarration` returns two narration assets for that scene.
- The pipeline stores both assets.
- A second run treats narration as complete for that scene.

**Step 2: Run test to verify it fails**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\runner.test.ts`

Expected: FAIL because completion checks assume asset count is at least scene count and merge keys by scene.

**Step 3: Implement completion logic**

Change narration completion checks to use `missingScenes(artifact.scenes, pipeline.assets.narration)` for both single and multi-turn assets. A scene is complete when it has at least one narration asset. Preserve all assets for completed scenes.

**Step 4: Run test to verify it passes**

Run the same runner test command.

Expected: PASS.

### Task 6: Draft Bridge Multi-Turn Narration

**Files:**
- Modify: `tests/draft.test.ts`
- Modify: `tests/jianying-bridge.test.ts`
- Modify: `src/shared/draft.ts`
- Modify: `src/shared/jianying-bridge.ts`

**Step 1: Write failing tests**

In `tests/draft.test.ts`, assert `writeJianyingDraft` passes multiple narration assets for one scene to the bridge payload in stable order.

In `tests/jianying-bridge.test.ts`, use fake audio assets with different durations and assert the generated draft content has consecutive narration segments in the same scene:

- Turn 1 starts at scene start.
- Turn 2 starts after turn 1 duration.
- Scene image duration is at least turn 1 + turn 2.

**Step 2: Run tests to verify they fail**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\draft.test.ts tests\jianying-bridge.test.ts`

Expected: FAIL because draft collection collapses narration to one asset per scene.

**Step 3: Implement multi-turn bridge payload**

Update `PyJianYingBridgeInput.narration` to include optional `speaker`, `turnIndex`, and `text`.

In `writeJianyingDraft`:

- Keep image collection one asset per scene.
- Collect narration as `Map<number, SceneAsset[]>`.
- Require at least one narration asset per scene.
- Sort scene narration by `turnIndex` when present, otherwise stable input order.
- Pass all narration assets to the bridge payload.

In the Python bridge script:

- Replace `audio_by_scene` with `audio_items_by_scene`.
- Copy each audio with unique stem: `scene-turn-speaker`.
- Create `draft.AudioMaterial` for each item.
- Scene duration is `max(planned_duration, sum(turn audio durations))`.
- Add each audio segment at `scene_start + turn_cursor`.
- Include every copied narration path in meta output.

**Step 4: Run tests to verify they pass**

Run the same draft and bridge test command.

Expected: PASS.

### Task 7: New Task UI For A/B Voice IDs

**Files:**
- Modify: `tests/product-shell-ui.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Step 1: Write failing UI contract tests**

Assert the source contains:

- `podcastSpeakerA`
- `podcastSpeakerB`
- Labels for `主播 A 音色 ID` and `主播 B 音色 ID`
- `ttsProvider` controls are still present in the two-host podcast path.
- `ttsSpeed` control is not hidden solely because `videoForm === 'two-host-podcast'`.
- Task creation passes `podcastSpeakerA` and `podcastSpeakerB`.

**Step 2: Run test to verify it fails**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\product-shell-ui.test.ts`

Expected: FAIL because the UI only exposes a speaker pair selector and hides some voice controls.

**Step 3: Implement UI**

In `NewTaskPage`:

- Add state for `podcastSpeakerA` and `podcastSpeakerB`.
- Show compact inputs under two-host podcast controls.
- Keep provider and speed available.
- Keep single `speaker` input hidden or de-emphasized for podcast mode.
- Include both fields in the create task payload only for podcast mode.
- Update helper copy to say actual audio uses the two configured voice ids.

**Step 4: Run test to verify it passes**

Run the same product shell UI test command.

Expected: PASS.

### Task 8: Artifact Preview Multi-Turn Display

**Files:**
- Modify: `tests/artifact-preview.test.ts`
- Modify: `src/shared/artifact-preview.ts`
- Modify: `src/main.tsx`

**Step 1: Write failing tests**

Add a snapshot/preview test where `assets.narration` contains two assets for one scene with A/B metadata. Expect the preview snapshot to preserve both assets and metadata.

**Step 2: Run test to verify it fails**

Run: `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\artifact-preview.test.ts`

Expected: FAIL if preview normalization drops metadata or assumes one asset per scene.

**Step 3: Implement preview support**

Ensure snapshot reads/writes keep metadata. Update `NarrationPreviewList` grouping to render multiple assets under the same scene and show speaker/turn labels in compact text.

**Step 4: Run test to verify it passes**

Run the same artifact preview test command.

Expected: PASS.

### Task 9: Verification

Run focused checks:

- `node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit`
- `node node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit`
- `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 tests\podcast-dialogue.test.ts tests\storage.test.ts tests\media-providers.test.ts tests\runner.test.ts tests\pipeline-cache.test.ts tests\draft.test.ts tests\jianying-bridge.test.ts tests\artifact-preview.test.ts tests\product-shell-ui.test.ts`

Then run full checks:

- `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1`
- `node node_modules\vite\bin\vite.js build`
- `node scripts\build-electron.mjs`

If Electron smoke is already available and build passes, run:

- `node node_modules\electron\cli.js scripts\smoke-electron.cjs`

Expected: all checks pass, allowing only the existing Vite large chunk warning.
