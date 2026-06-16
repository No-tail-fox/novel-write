# Storybound Cover Podcast Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the 1.7.0 cover/podcast parity layer observed in the updated Storybound reference app.

**Architecture:** Keep this as an incremental compatibility pass. Extend existing SQLite-backed task and template state instead of adding a new subsystem, seed cinematic cover styles/templates, and expose compact task controls in the existing new-task form.

**Tech Stack:** React, TypeScript, Vite, Electron, sql.js, Vitest.

---

### Task 1: Storage Contract For Cover/Podcast Defaults

**Files:**
- Modify: `tests/storage.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`

**Step 1: Write the failing test**

Add a storage test that creates a default task and expects:
- `podcastImageMode: 'multi'`
- `podcastSpeakers: null`
- `coverImageMode: 'off'`
- `coverTemplateId: 'cinematic-poster'`
- `scriptFormat: 'narration'`

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts`

Expected: FAIL because the task type does not expose podcast fields and current defaults differ.

**Step 3: Implement minimal storage support**

Add optional task fields, update create/read mapping, insert columns, and migration defaults.

**Step 4: Run test to verify it passes**

Run the same storage test command.

### Task 2: Seed 1.7.0 Cover Template Vocabulary

**Files:**
- Modify: `tests/storage.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/storage.ts`

**Step 1: Write the failing test**

Assert state includes custom cover templates with IDs:
- `cinematic-poster`
- `ancient-cinematic`
- `podcast-cover`

Assert custom styles include:
- `cinematic`
- `ancient-cinematic`

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts`

Expected: FAIL because templates/styles are not seeded.

**Step 3: Implement minimal seed logic**

Add `CustomCoverTemplate` type/state, seed default cover templates, and merge new custom styles.

**Step 4: Run test to verify it passes**

Run the same storage test command.

### Task 3: New Task UI Controls

**Files:**
- Modify: `tests/product-shell-ui.test.ts`
- Modify: `src/main.tsx`

**Step 1: Write the failing test**

Assert the new task source contains labels/options for:
- `封面模板`
- `封面生成`
- `播客配图`
- `cinematic-poster`
- `podcast-cover`

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`

Expected: FAIL because controls are absent.

**Step 3: Implement minimal UI**

Add compact selectors in `NewTaskPage`, persist their values through `createAndRunTask`, and use seeded template options from state.

**Step 4: Run test to verify it passes**

Run the same product shell UI test command.

### Task 4: Verification

Run:
- `npm run typecheck`
- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts tests/product-shell-ui.test.ts`
- `npm test` if focused tests pass cleanly.

Update `storybound_update_*` files with the result.
