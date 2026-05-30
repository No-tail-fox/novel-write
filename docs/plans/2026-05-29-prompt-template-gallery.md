# Prompt Template Gallery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a gallery-first prompt template page with detail editing after opening a template.

**Architecture:** Update `PromptTemplatesPage` in `src/main.tsx` to render either an overview list or a detail editor. Keep existing template persistence functions and clone-on-first-save behavior. Add CSS classes in `src/styles.css` for the gallery rows and detail header.

**Tech Stack:** React, TypeScript, Vite, Vitest, CSS.

---

### Task 1: Lock The UI Contract With Tests

**Files:**
- Modify: `tests/product-shell-ui.test.ts`

**Step 1:** Add assertions that the prompt template page includes gallery/detail mode state and display-list class names.

**Step 2:** Run `npm test -- --run tests/product-shell-ui.test.ts`.

**Expected:** The new assertions fail before implementation.

### Task 2: Implement Gallery And Detail Modes

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Step 1:** Add `templateMode` state and helper open functions in `PromptTemplatesPage`.

**Step 2:** Render the overview as a full-width list with `查看` and `克隆` actions.

**Step 3:** Render the existing editor only after opening a template, with `返回模板库`.

**Step 4:** Add responsive CSS for the gallery rows and detail editor.

### Task 3: Verify

**Files:**
- Test: `tests/product-shell-ui.test.ts`

**Step 1:** Run `npm test -- --run tests/product-shell-ui.test.ts`.

**Step 2:** Run `npm run build`.

