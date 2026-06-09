# Artifact Step Rerun Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-step artifact preview controls for regenerating or rewrite-assisted rerunning from a selected pipeline step.

**Architecture:** The renderer exposes two actions per artifact section and calls a new `rerunTaskStep` API. Electron invalidates cached pipeline state from the selected step, updates retry metadata, and resumes the existing background runner. The runner uses an optional rewrite marker in pipeline state to append existing artifact context to the selected LLM step.

**Tech Stack:** React, Electron IPC, TypeScript, Vitest, local JSON pipeline state.

---

### Task 1: Pipeline Cache Invalidation

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/pipeline-cache.ts`
- Test: `tests/pipeline-cache.test.ts`

**Step 1: Write the failing cache tests**

Add tests for `markTaskStepForRerun`:

```ts
const result = await markTaskStepForRerun(statePath, 1, 'rewrite');
expect(result.step).toBe(1);
expect(result.mode).toBe('rewrite');
expect(next.artifact.reviewedText).toBe('Reviewed');
expect(next.artifact.rewrittenCopy).toBeUndefined();
expect(next.assets.images).toEqual([]);
expect(next.assets.narration).toEqual([]);
expect(next.rerun.context.rewrittenCopy).toBe('Old rewrite');
expect(next.steps['1'].status).toBe('pending');
expect(next.steps['6'].status).toBe('pending');
```

Also add a step 6 test:

```ts
await markTaskStepForRerun(statePath, 6, 'regenerate');
expect(next.artifact.rewrittenCopy).toBe('Old rewrite');
expect(next.assets.images).toHaveLength(1);
expect(next.assets.narration).toHaveLength(1);
expect(next.draft).toBeUndefined();
expect(next.steps['6'].status).toBe('pending');
```

**Step 2: Run tests to verify failure**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/pipeline-cache.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because `markTaskStepForRerun` does not exist.

**Step 3: Implement minimal cache API**

Add:

```ts
export type TaskStepRerunMode = 'regenerate' | 'rewrite';

export async function markTaskStepForRerun(
  statePath: string,
  step: number,
  mode: TaskStepRerunMode,
): Promise<TaskStepRerunResult> {
  // validate 0..6 and mode
  // store rerun marker with context only for rewrite
  // clear artifacts/assets/draft according to the design table
  // mark selected and downstream steps pending
}
```

**Step 4: Run tests to verify pass**

Run the same targeted Vitest command. Expected: PASS.

### Task 2: Rewrite Context In Runner

**Files:**
- Modify: `src/shared/runner.ts`
- Test: `tests/runner.test.ts`

**Step 1: Write the failing runner test**

Create a task, seed its `pipeline/state.json` with completed review/rewrite artifacts, call `markTaskStepForRerun(statePath, 1, 'rewrite')`, then run with a fake LLM and capture the step 1 request.

Assert:

```ts
expect(rewriteRequest?.messages.map((message) => message.content).join('\n')).toContain('Existing artifact context');
expect(rewriteRequest?.messages.map((message) => message.content).join('\n')).toContain('Old rewrite');
```

**Step 2: Run tests to verify failure**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/runner.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the runner ignores `rerun` context.

**Step 3: Implement rewrite context**

Extend the private `PipelineState` shape:

```ts
rerun?: {
  step: number;
  mode: TaskStepRerunMode;
  requestedAt: string;
  context?: Partial<PipelineArtifact>;
};
```

Add helper:

```ts
function rewriteContextForStep(pipeline: PipelineState, step: number): string {
  if (pipeline.rerun?.mode !== 'rewrite' || pipeline.rerun.step !== step || !pipeline.rerun.context) return '';
  return joinPromptBlocks([
    'Existing artifact context:',
    JSON.stringify(pipeline.rerun.context, null, 2),
    'Rewrite the selected step using this existing output as reference. Return fresh JSON for the requested schema.',
  ]);
}
```

Append this helper to the selected step's user prompt for steps 0-3 only.

**Step 4: Run tests to verify pass**

Run the same runner test command. Expected: PASS.

### Task 3: Electron IPC And Renderer API

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Test: `tests/electron-ipc-contract.test.ts`

**Step 1: Write failing IPC contract test**

Assert:

```ts
expect(main).toContain("ipcMain.handle('task:rerun-step'");
expect(main).toContain('markTaskStepForRerun');
expect(rerunHandler).toContain('retryFromStep: step');
expect(rerunHandler).toContain('resumeTaskRun(database, updatedTask)');
expect(preload).toContain('rerunTaskStep');
expect(viteEnv).toContain("rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => Promise<AppState>");
```

**Step 2: Run tests to verify failure**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the IPC/API is missing.

**Step 3: Implement IPC/API**

Add preload method:

```ts
rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) =>
  ipcRenderer.invoke('task:rerun-step', { id, step, mode }),
```

Add Electron handler that validates task and state path, calls `markTaskStepForRerun`, updates the task to pending at `step`, logs an event, and calls `resumeTaskRun`.

**Step 4: Run tests to verify pass**

Run the same IPC contract command. Expected: PASS.

### Task 4: Artifact Preview Controls

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write failing renderer shell test**

Assert the renderer contains:

```ts
expect(main).toContain('rerunTaskStep');
expect(main).toContain('ArtifactStepActions');
expect(main).toContain('改写后继续');
expect(main).toContain('actions={artifactStepActions(1)}');
expect(css).toContain('.artifact-section-actions');
```

**Step 2: Run tests to verify failure**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the UI controls are missing.

**Step 3: Implement UI**

Extend `ArtifactSection`:

```tsx
function ArtifactSection({ title, badge, actions, children }: { title: string; badge: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="artifact-section">
      <div className="panel-title-row">
        <h3>{title}</h3>
        <div className="artifact-section-actions">
          {actions}
          <small>{badge}</small>
        </div>
      </div>
      {children}
    </section>
  );
}
```

Add `ArtifactStepActions` with two mini buttons and wire preview sections to steps 0-6.

**Step 4: Run tests to verify pass**

Run the same product shell command. Expected: PASS.

### Task 5: Verification

**Files:**
- All modified files

**Step 1: Run targeted tests**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/pipeline-cache.test.ts tests/runner.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS.

**Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

**Step 3: Review diff**

Run:

```bash
git diff -- src/shared/types.ts src/shared/pipeline-cache.ts src/shared/runner.ts electron/main.ts electron/preload.ts src/vite-env.d.ts src/main.tsx src/styles.css tests/pipeline-cache.test.ts tests/runner.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
```

Expected: only rerun-related changes, with no unrelated workspace edits.
