# Draft Template Usability Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the draft template editor so every canvas, image, text, caption, disclaimer, and audio function is clearly grouped and user-editable.

**Architecture:** Extend `DraftTemplate` with the missing visual style fields and normalize legacy templates at load time. Reuse the existing React editor, accordion layout, drag canvas, and Jianying bridge payload, adding controls and preserving all style values through export. Keep Python bridge rendering changes conservative: apply fields where the current bridge already has a stable path, and preserve newer fields in JSON for later renderer expansion.

**Tech Stack:** React 19, TypeScript, Electron IPC, Vitest, existing pyJianYingDraft bridge.

---

### Task 1: Add Missing Draft Template Style Fields

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/templates.ts`
- Modify: `tests/draft-template-normalization.test.ts`
- Modify: `tests/product-shell-storage.test.ts`

**Step 1: Write the failing normalization tests**

Add expectations that legacy templates are hydrated with the new fields:

```ts
expect(normalized.image.visible).toBe(true);
expect(normalized.title).toMatchObject({ alpha: 1, bold: true });
expect(normalized.subtitle).toMatchObject({ text: expect.any(String), alpha: 1, bold: false });
expect(normalized.disclaimer).toMatchObject({
  fontSize: expect.any(Number),
  color: expect.stringMatching(/^#/),
  alpha: 1,
});
```

In `tests/product-shell-storage.test.ts`, extend the existing legacy draft template test near the draggable coordinate assertions with the same field expectations after reloading from storage.

**Step 2: Run tests to verify they fail**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/draft-template-normalization.test.ts tests/product-shell-storage.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because `image.visible`, title/subtitle alpha/bold, subtitle text, and disclaimer style fields are not normalized yet.

**Step 3: Extend the type and defaults**

In `src/shared/types.ts`, update `DraftTemplate`:

```ts
image: {
  visible: boolean;
  ratio: string;
  fit: 'cover' | 'contain';
  top: number;
  height: number;
  animation: string;
};
title: {
  visible: boolean;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  alpha: number;
  bold: boolean;
};
subtitle: {
  visible: boolean;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  alpha: number;
  bold: boolean;
};
disclaimer: {
  visible: boolean;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  alpha: number;
};
```

In `src/shared/templates.ts`, add defaults:

```ts
image: { visible: true, ratio: '9:16', fit: 'cover', top: 0, height: 1, animation: '...' }
titleBase: { ..., alpha: 1, bold: true }
subtitleBase: { ..., text: '副标题示例文字', alpha: 1, bold: false }
disclaimerBase: { ..., fontSize: 12, color: '#FFFFFF', alpha: 0.7 }
```

In `normalizeDraftTemplate`, preserve valid stored values and fill missing ones:

```ts
image: { ...fallback.image, ...template.image, visible: template.image?.visible ?? fallback.image.visible },
title: { ...fallback.title, ...template.title, alpha: finiteNumber(template.title?.alpha, fallback.title.alpha), bold: template.title?.bold ?? fallback.title.bold, ... },
subtitle: { ...fallback.subtitle, ...template.subtitle, text: template.subtitle?.text ?? fallback.subtitle.text, alpha: finiteNumber(...), bold: template.subtitle?.bold ?? fallback.subtitle.bold, ... },
disclaimer: { ...fallback.disclaimer, ...template.disclaimer, fontSize: finiteNumber(...), color: template.disclaimer?.color ?? fallback.disclaimer.color, alpha: finiteNumber(...), ... },
```

**Step 4: Run tests to verify they pass**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/draft-template-normalization.test.ts tests/product-shell-storage.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/templates.ts tests/draft-template-normalization.test.ts tests/product-shell-storage.test.ts
git commit -m "feat: normalize draft template style fields"
```

### Task 2: Expose Complete Layer Controls in the Editor

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing source UI test**

Add a test that expects the editor source to contain grouped controls for each layer:

```ts
for (const text of ['显示', '透明度', '加粗', '下划线', '对齐', '字间距', '行间距', '每行字数', '背景透明度', '圆角']) {
  expect(main).toContain(text);
}
expect(main).toContain('ColorField');
expect(main).toContain('ToggleField');
expect(main).toContain('RangeField');
expect(main).toContain('updateDraftTextLayer');
expect(main).toContain('updateDraftCaption');
expect(main).toContain('updateDraftDisclaimer');
expect(css).toContain('.draft-color-field');
expect(css).toContain('.draft-toggle-grid');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the new helpers and controls do not exist yet.

**Step 3: Add reusable controls**

In `src/main.tsx`, add small local helpers near the existing editor helpers:

```tsx
function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Field label={label}>
      <label className="draft-toggle-field">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>{checked ? '开启' : '关闭'}</span>
      </label>
    </Field>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="draft-color-field">
        <input type="color" value={normalizeColorInput(value)} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function RangeField({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <Field label={label}>
      <div className="draft-range-field">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </Field>
  );
}
```

Add update helpers to keep JSX readable:

```ts
const updateTitle = (patch: Partial<DraftTemplate['title']>) => setDraft({ ...draft, title: { ...draft.title, ...patch } });
const updateSubtitle = (patch: Partial<DraftTemplate['subtitle']>) => setDraft({ ...draft, subtitle: { ...draft.subtitle, ...patch } });
const updateCaption = (patch: Partial<DraftTemplate['caption']>) => setDraft({ ...draft, caption: { ...draft.caption, ...patch } });
const updateCaptionBackground = (patch: Partial<DraftTemplate['caption']['background']>) => setDraft({ ...draft, caption: { ...draft.caption, background: { ...draft.caption.background, ...patch } } });
const updateDisclaimer = (patch: Partial<DraftTemplate['disclaimer']>) => setDraft({ ...draft, disclaimer: { ...draft.disclaimer, ...patch } });
```

Use the helpers inside each accordion:

- Image area: `visible`, ratio, fit, top, height, animation.
- Main title: `visible`, `text`, coordinates, `fontSize`, `color`, `alpha`, `bold`.
- Subtitle: `visible`, `text`, coordinates, `fontSize`, `color`, `alpha`, `bold`.
- Caption: all existing caption style fields plus background fields.
- Disclaimer: `visible`, `text`, coordinates, `fontSize`, `color`, `alpha`.

**Step 4: Add CSS for stable controls**

In `src/styles.css`, add compact control layouts:

```css
.draft-color-field,
.draft-range-field,
.draft-toggle-field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.draft-color-field input[type='color'] {
  width: 34px;
  height: 34px;
  padding: 2px;
}

.draft-range-field {
  grid-template-columns: minmax(0, 1fr) 72px;
}

.draft-toggle-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
```

**Step 5: Run test to verify it passes**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS unless unrelated source-string tests fail. If unrelated tests fail, document them and run the narrowed new test.

**Step 6: Commit**

```bash
git add src/main.tsx src/styles.css tests/product-shell-ui.test.ts
git commit -m "feat: complete draft template editor controls"
```

### Task 3: Sync Preview Rendering and Drag Behavior

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing preview test expectations**

Extend the existing draft canvas test:

```ts
expect(main).toContain('template.image.visible');
expect(main).toContain('opacity: template.title.alpha');
expect(main).toContain('fontWeight: template.title.bold');
expect(main).toContain('template.subtitle.text');
expect(main).toContain('opacity: template.disclaimer.alpha');
expect(main).toContain('fontSize: template.disclaimer.fontSize');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because preview rendering does not use the new style fields yet.

**Step 3: Update preview components**

In `DraftTemplatePreview` and `EditableDraftCanvas`:

- Render the image layer only when `template.image.visible` is true.
- Keep the image layer selectable when visible.
- Apply title alpha and bold:

```tsx
style={{
  color: template.title.color,
  fontSize: titleSize,
  opacity: template.title.alpha,
  fontWeight: template.title.bold ? 800 : 500,
}}
```

- Render subtitle text from `template.subtitle.text`.
- Apply subtitle alpha and bold.
- Apply caption alpha, bold, underline, alignment, and background preview style.
- Apply disclaimer font size, color, and alpha.

If hiding a selected layer, set `selectedLayer` to the next visible layer or `image` if image remains visible.

**Step 4: Run test to verify it passes**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS unless unrelated string-based assertions fail.

**Step 5: Commit**

```bash
git add src/main.tsx src/styles.css tests/product-shell-ui.test.ts
git commit -m "feat: reflect draft template styles in preview"
```

### Task 4: Preserve Style Fields in Draft Export Payload

**Files:**
- Modify: `src/shared/jianying-bridge.ts`
- Modify: `src/shared/draft.ts`
- Modify: `tests/draft.test.ts`
- Modify: `tests/jianying-bridge.test.ts`

**Step 1: Write failing payload tests**

In `tests/draft.test.ts`, extend the bridge payload expectation:

```ts
expect(bridgePayloads[0]).toMatchObject({
  imageArea: { visible: true },
  caption: {
    alpha: expect.any(Number),
    bold: expect.any(Boolean),
    underline: expect.any(Boolean),
    align: expect.any(Number),
    letterSpacing: expect.any(Number),
    lineSpacing: expect.any(Number),
    maxCharsPerLine: expect.any(Number),
    background: {
      color: expect.any(String),
      alpha: expect.any(Number),
      roundRadius: expect.any(Number),
    },
  },
  overlays: {
    title: { alpha: expect.any(Number), bold: expect.any(Boolean) },
    subtitle: { text: expect.any(String), alpha: expect.any(Number), bold: expect.any(Boolean) },
    disclaimer: { fontSize: expect.any(Number), color: expect.any(String), alpha: expect.any(Number) },
  },
});
```

In `tests/jianying-bridge.test.ts`, update `PyJianYingBridgeInput` fixture objects with the new fields and assert `writePyJianYingBridgeInput` preserves them.

**Step 2: Run tests to verify they fail**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/draft.test.ts tests/jianying-bridge.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because payload types and `createBridgePayload` do not include all new style fields.

**Step 3: Extend bridge payload types**

In `src/shared/jianying-bridge.ts`, add fields to `PyJianYingBridgeInput`:

```ts
imageArea: {
  visible: boolean;
  ratio: string;
  top: number;
  height: number;
  fit: 'cover' | 'contain';
  animation: string;
};
caption: {
  fontSize: number;
  color: string;
  alpha: number;
  bold: boolean;
  underline: boolean;
  align: number;
  letterSpacing: number;
  lineSpacing: number;
  maxCharsPerLine: number;
  background: {
    color: string;
    alpha: number;
    roundRadius: number;
  };
  x?: number;
  y: number;
};
```

Extend overlay types with `alpha`, `bold`, `text`, `fontSize`, and `color` where relevant.

**Step 4: Populate the fields in `createBridgePayload`**

In `src/shared/draft.ts`, pass the new normalized template fields into `imageArea`, `caption`, and `overlays`.

**Step 5: Conservatively apply bridge-rendered fields**

In the Python bridge script inside `src/shared/jianying-bridge.ts`:

- Skip adding image segments when `imageArea.visible` is `false`.
- Apply caption alignment from `caption.align`.
- Keep color/font size behavior as-is.
- Leave caption background, spacing, title, subtitle, and disclaimer fields preserved in payload even if the current script does not render them yet.

Add string assertions in `tests/jianying-bridge.test.ts` for:

```ts
expect(script).toContain('image_area.get("visible", True)');
expect(script).toContain('align=int(caption.get("align", 1))');
```

**Step 6: Run tests to verify they pass**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/draft.test.ts tests/jianying-bridge.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/shared/jianying-bridge.ts src/shared/draft.ts tests/draft.test.ts tests/jianying-bridge.test.ts
git commit -m "feat: preserve draft template styling in export"
```

### Task 5: Verify the Feature End to End

**Files:**
- No new source files.

**Step 1: Run focused tests**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/draft-template-normalization.test.ts tests/product-shell-storage.test.ts tests/product-shell-ui.test.ts tests/draft.test.ts tests/jianying-bridge.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS.

**Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

**Step 3: Run full build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Run the app**

Run:

```bash
npm run dev
```

Expected: Vite and Electron start.

Open the 草稿模板 view and verify:

- Each accordion is readable and grouped by function.
- Background color, title color, subtitle color, caption color, caption background color, and disclaimer color use swatches plus text inputs.
- Visibility toggles hide/show layers in the preview.
- Dragging visible layers still updates coordinates.
- Saving and reopening a template preserves all values.

**Step 5: Commit final fixups if needed**

If verification required fixes:

```bash
git add src tests
git commit -m "fix: verify draft template usability controls"
```
