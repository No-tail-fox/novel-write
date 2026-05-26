# Task Detail Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a screenshot-style task detail view where a selected task runs and displays its own seven-step pipeline.

**Architecture:** Keep the existing runner and task persistence contract. Add view state for the selected task id in the React shell, route queue/history/new-task actions to a detail view, and derive pipeline status from the selected task plus its events.

**Tech Stack:** React, TypeScript, Vite, Electron, Vitest, CSS.

---

### Task 1: Capture Expected UI Contract

**Files:**
- Modify: `tests/product-shell-ui.test.ts`

**Steps:**
1. Add a failing test asserting `main.tsx` contains a task detail component, selected task state, clickable task rows, and the Chinese labels shown in the screenshot.
2. Run `node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1`.
3. Confirm the test fails because those symbols/classes are missing.

### Task 2: Add Task Detail Navigation

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main.tsx`

**Steps:**
1. Add `task-detail` to `ShellView`.
2. Add `selectedTaskId` state and `openTaskDetail(id)` helper in `App`.
3. After `createAndRunTask`, navigate to the created task detail.
4. Make queue/history rows clickable and call `openTaskDetail`.
5. Render `TaskDetailPage` when the active view is `task-detail`.

### Task 3: Add Screenshot-Style Detail Surface

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Steps:**
1. Create `pipelineSteps` metadata for seven steps.
2. Create helpers for task elapsed time, step counts, step status, and current panel copy.
3. Implement `TaskDetailPage` with breadcrumb, close button, summary card, seven-step vertical pipeline, and right-side tabs.
4. Add CSS for the two-column detail workspace, timeline rail, active/completed/error states, tabs, and placeholder preview.

### Task 4: Verify

**Files:**
- No new files.

**Steps:**
1. Run focused UI tests.
2. Run full `npm test`.
3. Run `npm run typecheck`.
4. Run `npm run build`.
5. Start the app and inspect the task detail route visually.
