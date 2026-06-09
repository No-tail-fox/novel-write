# Storyboard Gallery Focus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the task detail storyboard tab show only `批量生图` followed by `分镜分句`.

**Architecture:** This is a renderer-only UI simplification in `ArtifactPreviewContent`. The preview tab keeps the complete pipeline artifact list, while the storyboard tab becomes a focused image review view backed by existing `ImageGenerationGallery` and `ArtifactSceneList` components.

**Tech Stack:** React 19, TypeScript, Vite, Vitest static UI structure tests.

---

### Task 1: Update Storyboard Tab Structure

**Files:**
- Modify: `tests/product-shell-ui.test.ts`
- Modify: `src/main.tsx`

**Step 1: Write the failing test**

Update the storyboard tab UI test to assert that, within the `tab === 'storyboard'` branch:

- `ArtifactSection title="批量生图"` appears before `ArtifactSection title="分镜分句"`.
- `storyboard-gallery-hero`, `ArtifactSection title="全部图片"`, and `ArtifactSection title="绘图提示词"` are not present in that branch.

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the existing branch still renders the hero, all-images section, and prompt section before `批量生图`.

**Step 3: Write minimal implementation**

In `src/main.tsx`, replace the storyboard tab branch with:

```tsx
<ArtifactSection title="批量生图" badge={`${imageAssets.length} 张`}>
  <ImageGenerationGallery ... />
</ArtifactSection>
<ArtifactSection title="分镜分句" badge={`${scenes.length} 条`}>
  <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
</ArtifactSection>
```

Leave the preview tab unchanged.

**Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS.

**Step 5: Verify TypeScript**

Run:

```bash
npm run typecheck
```

Expected: PASS.
