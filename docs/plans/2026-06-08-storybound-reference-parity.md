# Storybound Reference Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the reference-inspired voice lab, prompt-content fields, and draft-template text border controls to the current app.

**Architecture:** Reuse the existing React shell, SQLite-backed `FileDatabase`, and configured TTS provider pipeline. Add small data-model extensions and UI panels instead of replacing the current richer prompt/draft systems.

**Tech Stack:** React 19, TypeScript, Electron IPC, sql.js, Vitest.

---

### Task 1: Add Data Model Coverage

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/templates.ts`
- Modify: `src/shared/config.ts`
- Test: `tests/draft-template-normalization.test.ts`
- Test: `tests/product-shell-storage.test.ts`

**Steps:**
1. Write failing tests for draft text border defaults and voice lab records in app state.
2. Run `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/draft-template-normalization.test.ts tests/product-shell-storage.test.ts`.
3. Add `VoiceLabRecord`, `voiceLabRecords`, `PromptTemplate.imageSeedPoolsJson`, and text border fields.
4. Normalize legacy draft templates so missing borders become `{ color: '#000000', width: 0, alpha: 0 }`.
5. Run the same tests until green.

### Task 2: Persist Voice Lab Records

**Files:**
- Modify: `src/shared/storage.ts`
- Test: `tests/storage.test.ts`

**Steps:**
1. Write failing storage tests for `addVoiceLabRecord` and `getState().voiceLabRecords`.
2. Run targeted storage test and confirm failure.
3. Add `voice_lab_records` table, row mapper, and `addVoiceLabRecord`.
4. Run targeted storage test until green.

### Task 3: Add TTS Preview Helper and IPC

**Files:**
- Modify: `src/shared/media-providers.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Test: `tests/media-providers.test.ts`
- Test: `tests/electron-ipc-contract.test.ts`

**Steps:**
1. Write failing helper test for generating a single voice preview using existing MiniMax/Volcengine request logic.
2. Write failing IPC contract assertions for `generateVoiceLabPreview`.
3. Implement `generateConfiguredVoicePreview(config, workDir, input)`.
4. Wire `voice-lab:generate` to save the returned record.
5. Run targeted tests until green.

### Task 4: Build Voice Lab UI

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Steps:**
1. Write failing UI test for `voice-lab` navigation, `VoiceLabPage`, text input, provider segmented control, voice chips, speed control, generate button, audio player, and history list.
2. Add shell route and page using existing `ttsVoiceOptionsForProvider`.
3. Browser preview should show a useful error when real generation is unavailable.
4. Run targeted UI test until green.

### Task 5: Enhance Prompt Content Editing

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/main.tsx`
- Test: `tests/prompt-templates.test.ts`
- Test: `tests/product-shell-ui.test.ts`

**Steps:**
1. Write failing tests for `imageSeedPoolsJson` persistence and UI strings/symbols for reference content fields.
2. Add `imageSeedPoolsJson` to prompt template metadata.
3. Add prompt editor fields for task instruction, rewrite, metadata, Step 3 image prompt, and image seed pools JSON.
4. Keep current `content` and `stepPrompts` as source of truth.
5. Run targeted tests until green.

### Task 6: Add Draft Text Border Controls

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/templates.ts`
- Modify: `src/shared/draft.ts`
- Modify: `src/shared/jianying-bridge.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/draft.test.ts`
- Test: `tests/jianying-bridge.test.ts`
- Test: `tests/product-shell-ui.test.ts`

**Steps:**
1. Write failing tests for text border fields in draft payload and editor controls.
2. Add border controls to title/subtitle/caption/disclaimer accordions.
3. Render preview stroke via CSS/text shadow helper.
4. Pass border to draft writer/bridge where supported.
5. Run targeted tests until green.

### Task 7: Clean Text and Verify

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/shared/templates.ts`
- Modify: `src/shared/tts-voices.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Steps:**
1. Replace obvious mojibake in changed feature areas with valid Chinese.
2. Run `npm run typecheck`.
3. Run `npm test`.
4. Update `findings.md`, `progress.md`, and `task_plan.md`.

