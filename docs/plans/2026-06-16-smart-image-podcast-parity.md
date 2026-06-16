# Smart Image Podcast Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the selected Storybound parity features: smart image generation, real cover/podcast cover artifacts, and new-task video form controls for narration video and two-host podcast.

**Architecture:** Extend the existing SQLite-backed state, React shell, and runner rather than adding a separate subsystem. Use TDD for each layer: storage contracts first, media provider request helpers second, runner artifact behavior third, UI contracts last.

**Tech Stack:** React, TypeScript, Vite, Electron, sql.js, Vitest.

---

### Task 1: Task Shape And Storage Contracts

**Files:**
- Modify: `tests/storage.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`

**Step 1: Write the failing test**

Add a storage test that creates a two-host podcast task and expects:

- `videoForm: 'two-host-podcast'`
- `podcastImageMode: 'single'`
- `podcastSpeakers: 'kazai-dayi'`
- `scriptFormat: 'dialogue'`
- `targetLength` and `targetScenes` persisted.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts`

Expected: FAIL because `videoForm` is not yet typed or persisted.

**Step 3: Implement minimal storage support**

Add `TaskVideoForm`, `PodcastSpeakerPair`, and fields on `Task` / `CreateTaskInput`. Add `video_form` column and map defaults:

- `videoForm='narration'`
- if video form is two-host podcast, default `scriptFormat='dialogue'`, `podcastImageMode='multi'`, `podcastSpeakers='kazai-dayi'`.

**Step 4: Run test to verify it passes**

Run the same storage test command.

### Task 2: New Task Video Form UI

**Files:**
- Modify: `tests/product-shell-ui.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Step 1: Write the failing test**

Assert `NewTaskPage` contains:

- `视频形态`
- `旁白视频`
- `双人播客`
- `配图方式`
- `按分镜配图`
- `单图封面`
- `主播组合`
- `咔仔 x 大壹`
- `刘飞 x 潇磊`
- task creation passes `videoForm`, `podcastSpeakers`, and `scriptFormat`.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`

Expected: FAIL because the screenshot-style control group is not present.

**Step 3: Implement UI**

Add the screenshot-style control group in `NewTaskPage`. Hide ordinary TTS controls for two-host podcast. Write task creation values.

**Step 4: Run test to verify it passes**

Run the same product shell UI test command.

### Task 3: Smart Image Provider Requests

**Files:**
- Modify: `tests/media-providers.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/openai-image.ts`
- Modify: `src/shared/media-providers.ts`

**Step 1: Write failing tests**

Add tests for:

- `buildOpenAiImageEditFormData` sends prompt, model, size, and 1-10 reference images.
- more than 10 reference images throws a validation error.
- async image generation appends `?async=true`, polls the returned task id, and writes the final image.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/media-providers.test.ts`

Expected: FAIL because edit/async helpers are missing.

**Step 3: Implement minimal provider support**

Add image edit body/form-data builder and async submit/poll path for OpenAI-compatible providers. Keep synchronous existing behavior unchanged.

**Step 4: Run test to verify it passes**

Run the same media provider test command.

### Task 4: Image Lab Smart Mode And Playground Jobs

**Files:**
- Modify: `tests/image-lab.test.ts`
- Modify: `tests/storage.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/image-lab.ts`
- Modify: `src/shared/storage.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/main.tsx`

**Step 1: Write failing tests**

Add tests that:

- smart image input with mode `podcast-cover` builds a podcast cover prompt.
- reference edit with zero images fails.
- reference edit with 11 images fails.
- generated smart image records include `smartMode`, `referenceImagePaths`, and are mirrored to `playground_jobs`.

**Step 2: Run failing tests**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/image-lab.test.ts tests/storage.test.ts`

Expected: FAIL because smart fields and playground mirroring are missing.

**Step 3: Implement smart image lab**

Extend image lab generation input, record validation, prompt composition, storage mapping, and UI controls.

**Step 4: Run tests**

Run the same focused command.

### Task 5: Runner Cover And Podcast Artifact Behavior

**Files:**
- Modify: `tests/runner.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/runner.ts`
- Modify: `src/shared/artifact-preview.ts`
- Modify: `src/shared/draft.ts`

**Step 1: Write failing tests**

Add runner tests that:

- `coverImageMode='auto'` generates a cover image asset and writes `cover-image.png`.
- `coverTemplateId='podcast-cover'` includes podcast cover template wording in the generated prompt.
- `videoForm='two-host-podcast'` and `podcastImageMode='single'` generates one cover image and maps it to all scenes/draft image assets.
- `videoForm='two-host-podcast'` injects dialogue/podcast constraints into LLM prompts.

**Step 2: Run failing tests**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts`

Expected: FAIL because the runner ignores these fields.

**Step 3: Implement runner behavior**

Add cover image prompt creation, cover asset storage, single-cover scene asset reuse, and podcast prompt context.

**Step 4: Run tests**

Run the same runner test command.

### Task 6: Verification

Run:

- `npm run typecheck`
- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts tests/product-shell-ui.test.ts tests/media-providers.test.ts tests/image-lab.test.ts tests/runner.test.ts`
- `npm test`
- `npm run build`

Update audit/progress files with results.

### Task 7: Reference Edit Endpoint Follow-Up

**Files:**
- Modify: `tests/image-lab.test.ts`
- Modify: `tests/media-providers.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/image-lab.ts`
- Modify: `src/shared/media-providers.ts`
- Add: `src/shared/openai-image-edit.ts`

**Result:**
- Added a regression test proving `smartMode='reference-edit'` uses `/images/edits` with multipart `FormData`.
- Moved Node-only local image file reading into `src/shared/openai-image-edit.ts`, leaving browser-safe helpers in `src/shared/openai-image.ts`.
- Propagated `referenceImagePaths` through `ImagePrompt` so Image Lab reference edit requests reach the provider layer.
- Verified with `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/image-lab.test.ts tests/media-providers.test.ts` (23 tests passed).

### Browser Smoke Test

- Started Vite at `http://127.0.0.1:5173/`.
- Verified New Task on desktop and 390px mobile:
  - `视频形态`, `旁白视频`, `双人播客`.
  - After selecting `双人播客`: `配图方式`, `按分镜配图`, `单图封面`, `主播组合`, `咔仔 x 大壹`, `刘飞 x 潇磊`.
- Verified Image Lab on desktop and 390px mobile:
  - `智慧生图`, `封面`, `博客封面`, `播客封面`, `旁白视频`, `双人播客`, `参考图编辑`.
  - After selecting `参考图编辑`: reference input placeholder `每行一个本地图片路径，最多 10 张`.
- Browser console had no warnings/errors; checked controls had no horizontal overflow.

### Final Verification Results

- `npm run typecheck`: passed.
- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts tests/product-shell-ui.test.ts tests/media-providers.test.ts tests/image-lab.test.ts tests/runner.test.ts`: 5 files / 140 tests passed.
- `npm test`: 39 files / 339 tests passed.
- `npm run build`: passed; only the pre-existing large chunk warning remains.
