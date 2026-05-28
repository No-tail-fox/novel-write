# Draft Template Dragging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Jianying draft templates editable on the preview canvas with direct dragging for text and image regions, while preserving saved template compatibility and draft export behavior.

**Architecture:** Extend `DraftTemplate` with explicit position fields for title, subtitle, caption, and disclaimer. Render a single interactive editor canvas that reflects those positions and updates the template draft on drag. Keep the Python bridge and storage layer backward-compatible by providing defaults for old templates and exporting the same bridge payload shape, with positions mapped to existing draft fields where the generator already consumes them.

**Tech Stack:** React, TypeScript, CSS, Vitest, existing Jianying bridge.

---

### Task 1: Add template position fields and legacy defaults

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/templates.ts`
- Modify: `src/shared/storage.ts`
- Test: `tests/product-shell-storage.test.ts`

**Step 1: Write the failing test**

Add a storage test that opens a saved draft template without new position fields and expects the reloaded template to still expose usable default coordinates for title, subtitle, caption, and disclaimer.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/product-shell-storage.test.ts --pool=threads --maxWorkers=1`
Expected: FAIL because the new fields/defaults are missing.

**Step 3: Write minimal implementation**

Add the new coordinate fields to `DraftTemplate`, seed them in builtin templates, and normalize missing values when loading old stored templates.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run tests/product-shell-storage.test.ts --pool=threads --maxWorkers=1`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/templates.ts src/shared/storage.ts tests/product-shell-storage.test.ts
git commit -m "feat: add draft template position defaults"
```

### Task 2: Make the draft preview canvas draggable

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing test**

Add a source-level UI test that expects the draft editor preview to include draggable canvas controls, position readouts, and handlers for pointer dragging.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1`
Expected: FAIL because no drag handles or drag logic exist yet.

**Step 3: Write minimal implementation**

Create an editable canvas component for the draft template editor. Support dragging the title, subtitle, caption, disclaimer, and image region. Keep the content inside the canvas bounds and update the draft state live.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/main.tsx src/styles.css tests/product-shell-ui.test.ts
git commit -m "feat: make draft template preview draggable"
```

### Task 3: Keep bridge export compatible with draggable positions

**Files:**
- Modify: `src/shared/draft.ts`
- Modify: `src/shared/jianying-bridge.ts`
- Test: `tests/draft.test.ts`
- Test: `tests/jianying-bridge.test.ts`

**Step 1: Write the failing test**

Add bridge tests that verify the payload still writes successfully after the new position fields exist, and that a template with custom positions keeps those values when building the bridge payload.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/draft.test.ts tests/jianying-bridge.test.ts --pool=threads --maxWorkers=1`
Expected: FAIL because the new positions are not yet represented consistently.

**Step 3: Write minimal implementation**

Map the new template coordinates into the bridge payload without changing the existing export contract more than necessary. Preserve current image/caption behavior for older templates.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run tests/draft.test.ts tests/jianying-bridge.test.ts --pool=threads --maxWorkers=1`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/draft.ts src/shared/jianying-bridge.ts tests/draft.test.ts tests/jianying-bridge.test.ts
git commit -m "feat: preserve draft template positions in export"
```

### Task 4: Verify the full app

**Files:**
- No new files

**Step 1: Run the full test suite**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1`
Expected: PASS.

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

**Step 3: Build the app**

Run: `npm run build`
Expected: PASS.

**Step 4: Check the editor in the browser**

Open the local app, drag at least one text element and the image region, and confirm the preview updates without console errors.

**Step 5: Commit**

If any fixups were needed, commit them here with a final message like `feat: add draggable draft template editor`.
