# Storyboard Prompt Edit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an inline positive prompt editor to the storyboard image gallery so one rejected scene can be repaired and regenerated.

**Architecture:** The renderer edits one scene prompt inline and saves it through a narrow Electron IPC API. The shared pipeline-cache module performs the JSON state mutation, preserving all other prompt fields and media assets. Existing single-image regeneration continues to remove the image asset and resume Step 4.

**Tech Stack:** React, Electron IPC, TypeScript, Vitest, local JSON pipeline state.

---

### Task 1: Pipeline Cache Prompt Update

**Files:**
- Modify: `src/shared/pipeline-cache.ts`
- Test: `tests/pipeline-cache.test.ts`

**Step 1: Write the failing test**

Add a test that seeds `pipeline/state.json` with two `artifact.imagePrompts`, image assets, image errors, narration, and a draft. Call:

```ts
const result = await updateSceneImagePrompt(statePath, 2, 'safer repaired prompt');
```

Assert:

```ts
expect(result.updatedPrompt.prompt).toBe('safer repaired prompt');
expect(next.artifact.imagePrompts[0].prompt).toBe('image one');
expect(next.artifact.imagePrompts[1]).toMatchObject({
  sceneId: 2,
  prompt: 'safer repaired prompt',
  negativePrompt: 'keep negative',
  style: 'photo-real',
  ratio: '9:16',
  characterProfile: 'same person',
});
expect(next.assets.images).toEqual([{ sceneId: 1, path: '1.png' }, { sceneId: 2, path: '2.png' }]);
expect(next.assets.imageErrors).toEqual([{ sceneId: 2, message: 'policy failed' }]);
expect(next.draft).toEqual({ draftDir: 'draft-dir', draftContentPath: 'draft_content.json', draftMetaPath: 'draft_meta_info.json' });
```

Also add a validation assertion:

```ts
await expect(updateSceneImagePrompt(statePath, 2, '   ')).rejects.toThrow(/Image prompt cannot be empty/);
```

**Step 2: Run test to verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/pipeline-cache.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because `updateSceneImagePrompt` does not exist.

**Step 3: Write minimal implementation**

Add:

```ts
export interface UpdateSceneImagePromptResult {
  updatedPrompt: ImagePrompt;
}

export async function updateSceneImagePrompt(
  statePath: string,
  sceneId: number,
  prompt: string,
): Promise<UpdateSceneImagePromptResult> {
  // validate sceneId and trimmed prompt
  // read state JSON
  // find artifact.imagePrompts entry by sceneId
  // replace only prompt
  // refresh updatedAt and write JSON
}
```

**Step 4: Run test to verify it passes**

Run the same targeted command. Expected: PASS.

### Task 2: Electron IPC And API Types

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Test: `tests/electron-ipc-contract.test.ts`

**Step 1: Write the failing IPC contract test**

Assert:

```ts
expect(main).toContain("ipcMain.handle('task:update-image-prompt'");
expect(main).toContain('updateSceneImagePrompt');
expect(preload).toContain('updateTaskImagePrompt');
expect(viteEnv).toContain('updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => Promise<AppState>');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the IPC/API is missing.

**Step 3: Write minimal implementation**

Import `updateSceneImagePrompt` in `electron/main.ts` and add a handler that validates the task and `artifactStatePath`, calls the helper, records a `task:update-image-prompt` event with `{ sceneId }`, and returns `database.getState()`.

Expose in preload:

```ts
updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) =>
  ipcRenderer.invoke('task:update-image-prompt', { id, sceneId, prompt }),
```

Add the same method to `Window['storydream']` in `src/vite-env.d.ts`.

**Step 4: Run test to verify it passes**

Run the same IPC contract command. Expected: PASS.

### Task 3: Storyboard Gallery Inline Editor

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing renderer shell test**

Assert:

```ts
expect(main).toContain('updateTaskImagePrompt');
expect(main).toContain('editingPromptSceneId');
expect(main).toContain('修改提示词');
expect(main).toContain('保存提示词');
expect(main).toContain('取消');
expect(css).toContain('.image-prompt-editor');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the editor is not rendered yet.

**Step 3: Write minimal implementation**

Inside `ImageGenerationGallery`, add state:

```ts
const [editingPromptSceneId, setEditingPromptSceneId] = useState<number | null>(null);
const [editingPromptText, setEditingPromptText] = useState('');
const [savingPromptSceneId, setSavingPromptSceneId] = useState<number | null>(null);
```

Add handlers to open, cancel, and save. Save calls:

```ts
applyState(await api.updateTaskImagePrompt(task.id, sceneId, editingPromptText));
```

Render the editor below the existing `重新生成` button when the active scene id matches the card.

**Step 4: Run test to verify it passes**

Run the same product shell command. Expected: PASS.

### Task 4: Verification

**Files:**
- All modified files

**Step 1: Run targeted tests**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/pipeline-cache.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS.

**Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

**Step 3: Run full suite**

Run:

```bash
npm test
```

Expected: PASS.

**Step 4: Review diff**

Run:

```bash
git diff -- src/shared/pipeline-cache.ts electron/main.ts electron/preload.ts src/vite-env.d.ts src/main.tsx src/styles.css tests/pipeline-cache.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts docs/plans/2026-07-08-storyboard-prompt-edit-design.md docs/plans/2026-07-08-storyboard-prompt-edit.md
```

Expected: only prompt-edit-related changes.
