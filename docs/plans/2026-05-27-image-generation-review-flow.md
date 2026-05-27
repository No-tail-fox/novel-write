# Image Generation Review Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Step 4 support configured image concurrency, live image preview, and per-scene regeneration without repeating completed LLM or TTS work.

**Architecture:** Keep production generation inside the existing Electron runner. The runner honors provider concurrency while writing each completed image into `pipeline/state.json`; Electron exposes safe asset data URLs and a per-scene regenerate IPC that removes one cached image and resumes the real runner from Step 4. The React task detail reads the artifact snapshot, displays real thumbnails, and triggers per-image regeneration.

**Tech Stack:** Electron IPC/preload, React, TypeScript, Vitest, local filesystem assets.

---

### Task 1: Concurrency In Runner

**Files:**
- Modify: `src/shared/media-providers.ts`
- Modify: `src/shared/runner.ts`
- Test: `tests/media-providers.test.ts`
- Test: `tests/pipeline-cache.test.ts`

**Steps:**
1. Add a failing provider test that configured `concurrency: 2` runs two image requests before the first one resolves.
2. Add a failing runner/cache test that Step 4 writes each completed image to `pipeline/state.json`.
3. Implement a small concurrency pool in the image provider layer using existing config `concurrency`.
4. Keep abort checks before and after each provider call.
5. Run targeted tests and confirm they pass.

### Task 2: Asset Preview IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Test: `tests/electron-ipc-contract.test.ts`

**Steps:**
1. Add failing static contract tests for `asset:read-data-url`.
2. Implement IPC that reads local image files and returns `data:image/*;base64,...`.
3. Reject missing paths and non-image extensions with clear errors.
4. Expose `readAssetDataUrl(path)` in preload and typings.

### Task 3: Per-Scene Regeneration

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/shared/runner.ts`
- Test: `tests/electron-ipc-contract.test.ts`
- Test: `tests/pipeline-cache.test.ts`

**Steps:**
1. Add failing tests that removing one scene image leaves other images and TTS cached.
2. Implement a helper that edits `pipeline/state.json`, removes the scene image, marks Step 4 and Step 6 pending, updates `retryFromStep` to 4, and starts the background runner.
3. Expose `task:regenerate-image` as an immediate-return IPC.
4. Preserve duplicate-run protection through `runningTasks`.

### Task 4: Task Detail UI

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Steps:**
1. Add failing UI source tests for thumbnail rendering, concurrency display, and regenerate button.
2. Load image data URLs for visible image assets.
3. Show a compact gallery with scene text, prompt, thumbnail, path, status, and "重新生成".
4. Disable regenerate in browser preview and while the task is running.
5. Keep layout dense and operational, matching existing shell styling.

### Task 5: Verification

**Commands:**
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke:electron`

**Browser smoke:**
- Open `http://127.0.0.1:5173/`.
- Confirm browser preview still disables real generation.
- Confirm image gallery UI renders without overlapping text.
