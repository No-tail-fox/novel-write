# StoryBound Prompt Template Replica Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace our default prompt templates with StoryBound's current system prompt templates.

**Architecture:** Store the fetched StoryBound system-template payload as a local typed data module, then project it into our `PromptTemplate` shape from `config.ts`. Keep global step templates as internal fallbacks, while task-level StoryBound prompts drive rewrite, cover metadata, and image prompt generation.

**Tech Stack:** React, Vite, Electron, TypeScript, Vitest.

---

### Task 1: Lock StoryBound Defaults With Tests

**Files:**
- Modify: `tests/prompt-templates.test.ts`
- Modify: `src/shared/prompt-templates.ts`

**Step 1: Write the failing test**

Add tests that assert the built-in task template ids match StoryBound template ids, the character-story step prompts contain StoryBound headings, old local track names resolve to the new StoryBound ids, and StoryBound style aliases resolve to local image style ids.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/prompt-templates.test.ts`

Expected: FAIL because the current defaults still use old local prompt content and old track ids.

### Task 2: Add StoryBound Template Data

**Files:**
- Create: `src/shared/storybound-system-templates.ts`
- Modify: `src/shared/config.ts`

**Step 1: Generate template data**

Fetch `https://jihuo.52aibot.com/v1/system-templates`, preserve the returned prompt text exactly, and write a typed local module containing `storyboundSystemTemplateVersionHash` and `storyboundSystemTemplates`.

**Step 2: Project into app defaults**

Map each StoryBound template to a built-in task `PromptTemplate` with `stepPrompts.rewrite`, `stepPrompts.cover`, and `stepPrompts.image-prompt`.

### Task 3: Add Compatibility Mapping

**Files:**
- Modify: `src/shared/prompt-templates.ts`

**Step 1: Add track aliases**

Map old local tracks to StoryBound tracks: `general-story -> general`, `food-v2 -> food-vlog`, `mind-soup -> inspirational`, `culture-science -> culture-knowledge`, and `folk-story -> folk-tale`.

**Step 2: Add style aliases**

Map StoryBound style ids to local image styles where needed: `realistic -> photo-real`, `oil-painting -> oil-paint`, `vintage-film -> retro-film`, and `folk-tale-gongbi -> folk`.

### Task 4: Verify

**Files:**
- Test: `tests/prompt-templates.test.ts`
- Test: `tests/storage.test.ts`

**Step 1: Run targeted tests**

Run:
- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/prompt-templates.test.ts`
- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts`

**Step 2: Run typecheck**

Run: `npm run typecheck`
