# Storybound HTML Video Hi-Fi Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the local HTML video pipeline closer to the recovered Storybound behavior by making the generated scene HTML time-driven, tightening hidden-window frame capture, and restoring the sidecar's real compose / transition path.

**Architecture:** Keep the current Electron renderer + Python sidecar split, but treat the HTML scene as the source of truth for per-frame visual state and the sidecar as the final ffmpeg composer. The renderer should wait for the scene to become fully ready, seek the scene timeline on every frame, and capture deterministic JPG sequences. The sidecar should honor cover, transition, and BGM inputs with real ffmpeg composition rather than the current concat shortcut, and tests should lock the contract so the pipeline cannot drift back to a static or fake composition path.

**Tech Stack:** Electron, TypeScript, Python, ffmpeg, Vitest.

---

### Task 1: Make scene HTML truly time-driven

**Files:**
- Modify: `src/shared/html-video.ts`
- Test: `tests/html-video.test.ts`

**Step 1: Write the failing test**

Assert that the generated scene HTML exposes a stable timeline contract and embeds time-responsive state hooks, not just static markup. The test should require `window.__tl.seek`, `window.__ready`, and time-aware style/attribute updates that the renderer can read while capturing frames.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/html-video.test.ts`
Expected: FAIL until the scene HTML updates its DOM or CSS state from the timeline.

**Step 3: Write minimal implementation**

Update `buildSceneHtml()` so `seek()` publishes the current time into the document and the scene markup consumes that state for deterministic motion, fade, and emphasis layers.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/html-video.test.ts`
Expected: PASS.

### Task 2: Tighten hidden-window capture behavior

**Files:**
- Modify: `electron/html-video-renderer.ts`
- Test: `tests/electron-ipc-contract.test.ts`

**Step 1: Write the failing test**

Assert that the renderer waits for scene readiness, captures frame files in the recovered `frame_%04d.jpg` pattern, and leaves no path for generic eval IPC in the public surface.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/electron-ipc-contract.test.ts`
Expected: FAIL until the renderer’s readiness and capture semantics are explicit.

**Step 3: Write minimal implementation**

Make the hidden window wait on a stronger ready signal, capture on the correct frame boundary, and keep the capture path deterministic for frame-to-video conversion.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/electron-ipc-contract.test.ts`
Expected: PASS.

### Task 3: Restore real compose / transition composition

**Files:**
- Modify: `src/shared/storybound-sidecar.ts`
- Test: `tests/storybound-sidecar.test.ts`

**Step 1: Write the failing test**

Assert that `compose_render` now preserves cover handling, emits a real transition-aware composition path, and keeps `_source.mp4` as the no-BGM source artifact.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storybound-sidecar.test.ts`
Expected: FAIL until the sidecar no longer uses the concat fallback.

**Step 3: Write minimal implementation**

Replace the concat shortcut with an ffmpeg filter graph that actually crossfades video and audio when transitions are requested, then keep the existing BGM remix path on top of `_source.mp4`.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storybound-sidecar.test.ts`
Expected: PASS.

### Task 4: Lock the end-to-end HTML video contract

**Files:**
- Modify: `tests/html-video.test.ts`
- Modify: `tests/runner.test.ts`

**Step 1: Write the failing test**

Assert the runner still routes `html-video` tasks through the typed renderer, produces the expected payload shape, and records the html-video task as done after the sidecar finishes.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/html-video.test.ts tests/runner.test.ts -t "html-video"`
Expected: FAIL if any contract drift remains.

**Step 3: Write minimal implementation**

Adjust the contract only where needed to reflect the recovered Storybound behavior, keeping the current app shape intact.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/html-video.test.ts tests/runner.test.ts -t "html-video"`
Expected: PASS.
