# Direct Copy Publish Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a task-level publish flow switch so new tasks can skip Step 0/1 and publish directly from the source text, while target word count and target scene count continue to affect rewrite and storyboard prompts.

**Architecture:** Add a persisted `publishMode` field on tasks with two values: `review-rewrite` and `direct-copy`. The runner will branch early inside content generation so `direct-copy` tasks reuse the original input text for downstream artifacts, while the existing rewrite path still reads target length and scene count from task settings. The new task creation control lives next to the target controls in the new-task form and stores the choice with the task.

**Tech Stack:** TypeScript, React, SQLite-backed file storage, Vitest/Jest-style tests.

---

### Task 1: Add task model and storage support for publish mode

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Test: `tests/storage.test.ts`

**Step 1: Write the failing test**

Add a storage test that creates a task with `publishMode: 'direct-copy'` and asserts the task row round-trips with that value.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/storage.test.ts`
Expected: FAIL because `publishMode` is missing from the task model/storage mapping.

**Step 3: Write minimal implementation**

Add the `publishMode` type, default value, SQLite column, create-task persistence, and row hydration.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/storage.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/storage.ts tests/storage.test.ts
git commit -m "feat: persist publish mode on tasks"
```

### Task 2: Update runner behavior and prompt inputs

**Files:**
- Modify: `src/shared/runner.ts`
- Test: `tests/runner.test.ts`

**Step 1: Write the failing test**

Add two runner tests:
- `direct-copy` skips Step 0 and Step 1, but still produces storyboard/image/draft downstream from the original text.
- rewrite prompts include both target word count and target scene count when those values are set.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/runner.test.ts`
Expected: FAIL because direct-copy flow does not exist and rewrite prompts do not yet include both targets.

**Step 3: Write minimal implementation**

Branch in `ensureContentArtifact` before the LLM review/rewrite steps, and pass the target scene count into rewrite prompt assembly.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/runner.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/runner.ts tests/runner.test.ts
git commit -m "feat: support direct copy publish flow"
```

### Task 3: Add the new task creation control

**Files:**
- Modify: `src/main.tsx`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing test**

Add a UI snapshot/assertion that the new-task page exposes the publish flow choice and submits the new field in the task creation payload.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/product-shell-ui.test.ts`
Expected: FAIL because the control and payload field are missing.

**Step 3: Write minimal implementation**

Add a segmented control next to the target controls, keep the default on review/rewrite, and wire the payload through `createAndRunTask`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/product-shell-ui.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/main.tsx tests/product-shell-ui.test.ts
git commit -m "feat: expose publish flow in new task form"
```
