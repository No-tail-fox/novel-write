# Music MV Runtime Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full `音乐MV` module and connect processing mode, pause checkpoints, rewrite self-evaluation, and character-card extraction to the real runner.

**Architecture:** Extend the existing task model and runner instead of creating a second pipeline. MV tasks produce extra artifacts but reuse image generation, narration, and Jianying draft output.

**Tech Stack:** React 19, TypeScript, Electron IPC, sql.js, Vitest.

---

### Task 1: Add Types and Storage

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Test: `tests/storage.test.ts`
- Test: `tests/high-parity.test.ts`

**Steps:**
1. Write failing tests for `taskKind`, `processingMode`, and `musicMv` settings persistence.
2. Run targeted tests and confirm failure.
3. Add types and SQLite columns.
4. Normalize legacy rows with story/full-auto defaults.
5. Run targeted tests until green.

### Task 2: Runtime Processing Modes and Pauses

**Files:**
- Modify: `src/shared/runner.ts`
- Test: `tests/runner.test.ts`

**Steps:**
1. Write failing tests for `semi-auto`, `clip-only`, `critical`, and `every-step`.
2. Run targeted runner tests and confirm failure.
3. Add a resumable pause helper and processing-mode branches.
4. Run targeted tests until green.

### Task 3: Rewrite Evaluation and Character Card

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/runner.ts`
- Modify: `src/shared/pipeline-cache.ts`
- Test: `tests/runner.test.ts`
- Test: `tests/artifact-preview.test.ts`

**Steps:**
1. Write failing tests for three rewrite candidates, saved evaluation artifact, word-count warning, character-card file, and Step 3 prompt injection.
2. Run targeted tests and confirm failure.
3. Implement LLM calls and artifact writes.
4. Ensure reruns clear character card and downstream prompts when appropriate.
5. Run targeted tests until green.

### Task 4: Music MV Content Path

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/runner.ts`
- Test: `tests/runner.test.ts`

**Steps:**
1. Write failing test for MV task producing `musicPlan`, lyric scenes, and MV-specific image prompt context.
2. Run targeted tests and confirm failure.
3. Add deterministic MV planning helper and LLM-enhanced branch where available.
4. Run targeted tests until green.

### Task 5: React Shell and Music MV Page

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Steps:**
1. Write failing UI tests for `music-mv` nav, page controls, stateful processing mode, and task creation payload.
2. Add shell route, page, and stateful processing mode in both new task and MV forms.
3. Reuse existing style, ratio, BGM, and template selectors.
4. Run targeted UI tests until green.

### Task 6: Verification

**Files:**
- Modify: relevant files from prior tasks only.

**Steps:**
1. Run `npm run typecheck`.
2. Run targeted tests touched by the work.
3. Run `npm test` if targeted tests are green.
4. Summarize remaining gaps without claiming unverified behavior.
