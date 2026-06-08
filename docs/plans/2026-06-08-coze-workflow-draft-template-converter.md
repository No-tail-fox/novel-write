# Coze Workflow Draft Template Converter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a converter and UI flow that imports copied Coze workflow clipboard JSON as reusable Storybound draft template presets.

**Architecture:** Implement a pure parser/converter in `src/shared/coze-workflow-converter.ts`, keep all conversion diagnostics explicit, and reuse the existing `DraftTemplate` storage path. Add a compact paste/import panel to the existing draft-template page rather than creating a new app section.

**Tech Stack:** TypeScript, React, Electron app state API, Vitest, existing `DraftTemplate` normalization and storage.

---

### Task 1: Add Converter Types And Parser Tests

**Files:**
- Create: `src/shared/coze-workflow-converter.ts`
- Create: `tests/coze-workflow-converter.test.ts`

**Step 1: Write the failing tests**

Add tests that:

- Load a minimal Coze clipboard JSON object.
- Assert `parseCozeWorkflowClipboard` returns `workflowId`, `nodes`, and extracted plugin nodes.
- Assert invalid JSON and non-Coze data return a failed result with an error message.

Use an inline fixture with `create_draft`, `add_videos`, and `add_captions`.

**Step 2: Run tests and verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/coze-workflow-converter.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement minimal parser**

Create exported types:

- `CozeWorkflowParseResult`
- `CozeWorkflowPluginNode`
- `CozeWorkflowDiagnostic`

Implement:

- `parseCozeWorkflowClipboard(input: string): CozeWorkflowParseResult`
- Safe JSON parsing.
- `apiParam` extraction for `apiID`, `apiName`, `pluginID`, and `pluginName`.
- Flatten top-level nodes and loop `blocks`.

**Step 4: Run tests and verify pass**

Run the same Vitest command. Expected: PASS.

### Task 2: Convert Coze Workflow To DraftTemplate

**Files:**
- Modify: `src/shared/coze-workflow-converter.ts`
- Modify: `tests/coze-workflow-converter.test.ts`

**Step 1: Write failing conversion tests**

Add tests for:

- `convertCozeWorkflowToDraftTemplate` returns a normalized `DraftTemplate`.
- `create_draft` width `1920` and height `1080` produce canvas ratio `16:9`.
- Generated id starts with `coze-`.
- Template name includes the workflow ID or supplied name.
- Diagnostics include preserved background audio/video URLs.
- Unsupported APIs produce warning diagnostics.

**Step 2: Run tests and verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/coze-workflow-converter.test.ts
```

Expected: FAIL because conversion is missing.

**Step 3: Implement conversion**

Add:

- `convertCozeWorkflowToDraftTemplate(input: string, options?: { name?: string }): CozeWorkflowTemplateConversionResult`
- Helpers to find the first plugin node by `apiName`.
- Helpers to read literal `inputParameters`.
- `inferCanvasRatio(width, height)`.
- A conservative landscape template based on `builtin-landscape-16-9` when dimensions are landscape, otherwise `default-portrait-9-16`.
- Caption style defaults that reflect the sample workflow: visible, yellow/white text with optional red keyword diagnostic, centered, medium background.
- Audio/effect fields from literals when present, otherwise fallback template values.

**Step 4: Run tests and verify pass**

Run the same Vitest command. Expected: PASS.

### Task 3: Add Sample Fixture From The Pasted Workflow

**Files:**
- Create: `tests/fixtures/coze-workflow-emotion-sample.json`
- Modify: `tests/coze-workflow-converter.test.ts`

**Step 1: Write fixture-based test**

Copy the pasted workflow clipboard JSON into a fixture file. Add a test that reads the fixture and asserts:

- `workflowId` is `7629256239332032548`.
- Output canvas is `1920x1080`.
- The converter detects `create_draft`, `add_videos`, `add_audios`, `add_effects`, `add_images`, and `add_keyframes`.
- Diagnostics mention background video and background audio URLs.

**Step 2: Run tests and verify failure or pass**

Run the converter tests. If the fixture is too large for readability, keep it as a file and avoid inline snapshots.

**Step 3: Adjust converter for real payload edge cases**

Handle:

- Nodes nested in `blocks`.
- Code nodes with no plugin data.
- Input references instead of literals.
- Comment nodes.

**Step 4: Run tests and verify pass**

Run converter tests again. Expected: PASS.

### Task 4: Add Draft Template Import UI

**Files:**
- Modify: `src/main.tsx`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write failing UI tests**

Add assertions that `src/main.tsx` contains:

- `convertCozeWorkflowToDraftTemplate`
- A paste textarea label such as `Coze 工作流源码`
- An import action label such as `导入 Coze 模板`
- Diagnostics rendering for conversion warnings.

**Step 2: Run UI test and verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts
```

Expected: FAIL.

**Step 3: Implement UI**

In `DraftTemplatesPage`:

- Add local state for pasted source, import name, conversion result, and error.
- Add a compact import panel above the template cards.
- On preview/import, call `convertCozeWorkflowToDraftTemplate`.
- On save, call existing `api.saveDraftTemplate(result.template)` and update app state.
- Show warning diagnostics in a small list.

Keep styling within existing classes where possible.

**Step 4: Run UI test and verify pass**

Run the UI test. Expected: PASS.

### Task 5: Add Storage/Normalization Coverage

**Files:**
- Modify: `tests/storage.test.ts` or `tests/product-shell-storage.test.ts`
- Modify: `src/shared/storage.ts` only if needed

**Step 1: Write a persistence test**

Assert a converted Coze template can be saved and reloaded through existing draft template storage.

**Step 2: Run test and verify result**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts tests/product-shell-storage.test.ts
```

Expected: likely PASS without storage changes. If it fails, fix normalization/storage only where necessary.

### Task 6: Verification

**Files:**
- No production files unless fixes are needed.

**Step 1: Run targeted tests**

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/coze-workflow-converter.test.ts tests/product-shell-ui.test.ts tests/storage.test.ts tests/product-shell-storage.test.ts tests/draft-template-normalization.test.ts tests/draft.test.ts
```

Expected: PASS.

**Step 2: Run typecheck**

```powershell
npm run typecheck
```

Expected: PASS.

**Step 3: Run full tests**

```powershell
npm test
```

Expected: PASS.

**Step 4: Browser smoke**

Start the dev server if needed:

```powershell
npm run dev
```

Open the app in the in-app browser, navigate to "草稿模板", paste the sample Coze workflow JSON, import it, and verify the new template card appears.
