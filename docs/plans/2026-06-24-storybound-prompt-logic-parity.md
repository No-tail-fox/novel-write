# Storybound Prompt + Call Logic Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reproduce the observed Storybound prompt templates and the 3-round rewrite / self-evaluation / best-round selection flow in the local app.

**Architecture:** Keep the existing prompt-template registry as the source of truth for the static templates, then update the runner so step 1 mirrors the reference pipeline: rewrite round 1, round 2, round 3, a separate evaluation pass, and artifact selection based on the best round. Preserve the current target-length repair behavior, but apply it after the best draft is chosen. Add tests that lock both prompt-dump parity and the rewrite call sequence so future changes cannot drift.

**Tech Stack:** TypeScript, Vitest, existing shared runner/config/prompt-template modules, JSON artifact files.

---

### Task 1: Lock prompt dump parity

**Files:**
- Modify: `tests/prompt-templates.test.ts`
- Read-only reference: `storybound_e_prompt_dump_2026-06-24.json`

**Step 1: Write the failing test**

Check the exported Storybound prompt dump shape against the local template registry: 9 system templates, 5 global step templates, matching IDs, names, and step types.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/prompt-templates.test.ts`
Expected: FAIL if the local registry diverges from the dumped reference.

**Step 3: Write minimal implementation**

Adjust only the template registry or the test assertions to match the observed dump, not the other way around.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/prompt-templates.test.ts`
Expected: PASS.

### Task 2: Recreate the 3-round rewrite pipeline

**Files:**
- Modify: `src/shared/runner.ts`
- Modify: `tests/runner.test.ts`

**Step 1: Write the failing test**

Replace the single-round rewrite expectation with a test that requires `rewrite-round-1`, `rewrite-round-2`, `rewrite-round-3`, and `rewrite-evaluation`, then asserts the selected best round drives `01-rewritten-copy.md`, `00-cover-title.json`, and `01-rewrite-evaluations.json`.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "rewrite evaluation"`
Expected: FAIL against the current one-round runner.

**Step 3: Write minimal implementation**

Update `runRewriteRounds` to:
- send three rewrite requests with round-specific prompts
- run a separate evaluation request
- choose the best round from the evaluation result
- keep target-length repair after selection

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "rewrite evaluation"`
Expected: PASS.

### Task 3: Verify the pipeline artifacts and events

**Files:**
- Modify: `tests/runner.test.ts`

**Step 1: Write the failing test**

Assert the emitted events and artifact files reflect Storybound-style copy, including the 3-round rewrite messaging and the saved evaluation JSON.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts`
Expected: FAIL until the event text and artifact shape match.

**Step 3: Write minimal implementation**

Tighten the runner event copy and JSON artifact output to match the reference flow.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts`
Expected: PASS.
