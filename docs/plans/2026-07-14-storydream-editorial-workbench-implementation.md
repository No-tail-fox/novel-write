# StoryDream Editorial Workbench Full Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不丢失任何现有功能和参数的前提下，完成四类历史治理、安全删除、版本化参数契约、17 路由懒加载和已批准的全量桌面 UI 重构。

**Architecture:** 先稳定 shared/Electron 的契约、持久化和 delta 所有权，再机械拆分 renderer 单体，最后按页面族迁移视觉与交互。`src/app/App.tsx` 继续唯一拥有 bootstrap/delta/reconciliation；feature route 只消费窄 props 和共享纯模块，禁止反向导入 App。重型模板语料和页面实现只进入动态 chunk，媒体画布使用与壳层主题隔离的固定深色 token。

**Tech Stack:** React 19、TypeScript、Vite、Electron、sql.js、Zod、Vitest、Lucide、真实 Electron `webContents.capturePage()`；Browser/Playwright 仅在环境实际提供时作为附加检查。

---

## Execution Rules

- Approved design baseline: `81d1de3 docs: define editorial workbench redesign`.
- Before production edits, use `@superpowers:test-driven-development`; every behavior starts RED, is observed failing for the intended reason, then receives the smallest GREEN implementation.
- React tasks also use `@build-web-apps:react-best-practices`; rendered changes use `@build-web-apps:frontend-testing-debugging` and the accepted concept assets.
- `scripts/test.ps1` ignores focused arguments. Focused evidence must use:

  ```powershell
  scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\startup-script.test.ts --pool=threads --maxWorkers=1
  ```

- Do not use `npm.cmd test -- tests\startup-script.test.ts` as focused evidence; it runs the full suite in this repository.
- Keep `task_plan.md`, `findings.md`, `progress.md`, and `src/shared/__pycache__/` out of every product commit.
- After each task: run its focused tests, both TypeScript projects when contracts moved, `git diff --check`, request review, then commit only the listed paths.
- Every task that changes `.ts` or `.tsx` runs `npm.cmd run typecheck` after focused GREEN and before commit; direct project-specific `tsc` lines are additional focused evidence, not a substitute. From Task 41 onward this also checks `tsconfig.scripts.json`.
- No barrel files under `src/components` or `src/features`; they would obscure chunk ownership. Route loaders live at module scope and may prefetch on navigation hover/focus.

## Phase A: Contracts And History Governance

### Task 1: Make The Node Wrapper Work Outside npm

**Files:**
- Modify: `scripts/run-npm-node.cmd`
- Modify: `tests/startup-script.test.ts`

**Step 1: Write the direct-execution RED test**

Spawn `scripts/run-npm-node.cmd node_modules\vitest\vitest.mjs --version` with `npm_node_execpath` removed and assert exit 0 plus a Vitest version. Add failure cases for neither npm injection nor a PATH-resolvable `node.exe`; the wrapper must emit one bounded diagnostic and preserve the child exit code.

**Step 2: Run RED with a command that does not use the broken wrapper**

```powershell
node.exe node_modules\vitest\vitest.mjs run tests\startup-script.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the wrapper exits with `npm_node_execpath is not available` in a normal PowerShell/tool session.

**Step 3: Add a validated PATH fallback**

Prefer `%npm_node_execpath%` when present. Otherwise resolve `node.exe` from PATH (for example `for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"`), verify the result is a regular executable path, and invoke it with the original arguments. Do not hard-code this machine's `I:\nodejs` path.

**Step 4: Run GREEN and prove the wrapper itself**

```powershell
node.exe node_modules\vitest\vitest.mjs run tests\startup-script.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs --version
git diff --check
```

Only after both commands pass may later tasks use the direct wrapper.

**Step 5: Commit**

```powershell
git add scripts/run-npm-node.cmd tests/startup-script.test.ts
git commit -m "fix: run node tools outside npm"
```

### Task 2: Make Renderer Contract Tests Module-Aware

**Files:**
- Create: `tests/helpers/renderer-source.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing test helper contract**

Add a test proving renderer-wide assertions search all tracked `src/**/*.ts(x)` files while function-owner assertions can target one exact module:

```ts
const renderer = await readRendererSources();
expect(renderer.all).toContain('useAsyncAction');
expect(renderer.file('src/main.tsx')).toContain('createRoot');
expect(renderer.file('src/not-present.ts')).toBeNull();
```

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because `readRendererSources` does not exist.

**Step 3: Implement the helper and migrate assertions**

Use deterministic sorted file discovery. Renderer-wide copy/navigation/forbidden-import assertions use `renderer.all`; implementation-specific assertions name the future owner file. Preserve every existing assertion instead of deleting tests to accommodate extraction.

**Step 4: Run GREEN and diff check**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
git diff --check
```

**Step 5: Commit**

```powershell
git add tests/helpers/renderer-source.ts tests/product-shell-ui.test.ts
git commit -m "test: make renderer contracts module aware"
```

### Task 3: Centralize The Renderer IPC API Contract

**Files:**
- Create: `src/shared/storydream-api.ts`
- Create: `tests/ipc-inventory.test.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/main.tsx`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write failing inventory tests**

```ts
expect(new Set(Object.keys(ipcInputSchemas))).toEqual(new Set(INVOKE_CHANNELS));
expect(PRELOAD_INVOKE_CHANNELS).toEqual(INVOKE_CHANNELS);
expectTypeOf(storyDreamApi).toMatchTypeOf<StoryDreamApi>();
```

Keep `onAppDelta` as a separately audited event subscription, not an invoke channel.

Migrate existing renderer source audits from duplicated method text in `src/vite-env.d.ts` to the canonical `src/shared/storydream-api.ts`; preserve every assertion for public state/config types, local book/person methods, window controls, and config testing.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the shared interface/inventory does not exist.

**Step 3: Implement one source of truth**

Move `StoryDreamApi` to `src/shared/storydream-api.ts`. Make preload use `satisfies StoryDreamApi`; make `vite-env.d.ts` reference the shared interface rather than duplicating method signatures. Replace hard-coded channel-count tests with exact set equality, and point product-shell source contracts at the shared owner instead of preserving duplicate audit text in `vite-env.d.ts`.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
```

**Step 5: Commit**

```powershell
git add src/shared/storydream-api.ts src/shared/ipc-contract.ts electron/preload.ts src/vite-env.d.ts src/main.tsx tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: centralize renderer ipc contract"
```

### Task 4: Define Strict Four-Family History Contracts

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `electron/preload.ts`
- Modify: `src/main.tsx`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`

**Step 1: Write strict RED cases**

Cover unknown keys, cross-family status, `status + statuses`, duplicate/8-item statuses, `limit` 0/fraction/101, query 256/257, empty/oversized cursor, path separators, `..`, absolute IDs, and Windows reserved names.

```ts
expect(() => parseIpcInput('task:list', {
  family: 'task', filter: 'active', status: 'running', statuses: ['paused'],
})).toThrow();
expect(() => parseIpcInput('image-lab:delete', '..\\outside')).toThrow();
```

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Add typed schemas and methods**

Implement `HistoryFamily`, `HistoryArchiveFilter`, `TaskHistoryStatusFilter`, `HistoryListRequest`, `HistoryPage`, and four tombstone result types. Add 12 archive/restore/delete channels. Preload fixes `family`, defaults omitted `filter` to `active`, trims query, and never forwards a renderer-supplied family.

Use a dedicated governance ID schema; do not reuse the broad generic `idSchema`.

Keep the existing list return shape until Task 5 implements `HistoryPage` in storage and Electron. Because the 12 governance methods are required on `StoryDreamApi`, add explicit browser-fallback methods that reject with one bounded desktop-only diagnostic; Task 9 replaces those placeholders with real fallback governance.

**Step 4: Run GREEN and typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
```

**Step 5: Commit**

```powershell
git add src/shared/types.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts electron/preload.ts src/main.tsx tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts
git commit -m "feat: define typed history governance contracts"
```

### Task 5: Add Managed Storage Keys, Runtime Paths, And Server Pagination

**Files:**
- Create: `electron/managed-history-paths.ts`
- Create: `tests/history-managed-paths.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/runner.ts`
- Modify: `electron/config-service.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/html-video-runtime.ts`
- Modify: `src/main.tsx`
- Modify: `scripts/smoke-html-video.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/runner.test.ts`
- Modify: `tests/ai-research-flow.test.ts`
- Modify: `tests/high-parity.test.ts`
- Modify: `tests/pipeline-cache.test.ts`
- Modify: `tests/task-runtime-providers.test.ts`
- Modify: `tests/html-video-electron.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`
- Create: `tests/history-governance.test.ts`

**Step 1: Write pagination and migration RED tests**

Test four `archived_at` columns, managed storage keys, stable `(sort,id)` pages, `COUNT(*)`, full-field search beyond summary previews, literal LIKE escaping, and cursor rejection across family/filter/status/statuses/taskType/query changes.

```ts
const first = await db.listTaskSummaries({ family: 'task', filter: 'active', statuses: ['running', 'paused'], limit: 2 });
const second = await db.listTaskSummaries({ family: 'task', filter: 'active', statuses: ['paused', 'running'], cursor: first.nextCursor, limit: 2 });
expect(new Set([...first.items, ...second.items].map(x => x.id)).size).toBe(4);
```

Also test legacy taskType normalization: whitespace/empty falls back to `taskKind`, legal values remain, unknown nonempty values appear only without taskType filtering.

Add filesystem/runtime RED cases proving task, HTML, viral, image, and voice work directories use the persisted random `managedStorageKey`, never the caller-controlled business ID. The database must persist the key and return the canonical entity before the first `mkdir`/write/provider call. A null legacy key never triggers path derivation or filesystem access.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-governance.test.ts tests\history-managed-paths.test.ts tests\storage.test.ts tests\runner.test.ts tests\html-video-electron.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement migration and keyset queries**

Add `archived_at` and `managed_storage_key` to task/viral/image/voice tables, indexes for active and archived ordering, and `history_tombstones`. New entities receive random safe storage keys before file creation. Task/viral creation persists and returns their canonical row before starting. Image/voice creation first persists a canonical in-progress record/key, then uses that row for provider work and terminal update. Failure still leaves a governed failed record rather than an unowned directory. Legacy keys backfill only after ID, containment, and reparse validation; unsafe rows remain null.

Create the shared Electron path helper now with lexical containment, key validation, and family roots; Task 8 extends it with identity-aware quarantine. Change `electron/main.ts`, HTML workdir construction, and `src/shared/runner.ts` so a canonical managed work directory is injected and no runner reconstructs `tasks/<business-id>`. Cursor payload binds version, family, canonical filter/status/statuses/taskType/query hash, sort value, and ID. Electron/config-service bootstrap requests one active page per family only. Renderer-side automatic all-cursor consumption remains explicitly owned by Task 10.

Complete the server-page contract end to end now: the four `StoryDreamApi`/preload list methods and the four `BootstrapState` families return `HistoryPage`, while browser fallback list/bootstrap paths construct or preserve `family`, `totalCount`, `hasMore`, and `nextCursor`. Do not automatically consume every cursor; that remains Task 10.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-governance.test.ts tests\history-managed-paths.test.ts tests\storage.test.ts tests\runner.test.ts tests\ai-research-flow.test.ts tests\high-parity.test.ts tests\pipeline-cache.test.ts tests\task-runtime-providers.test.ts tests\html-video-electron.test.ts tests\state-delta.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
```

**Step 5: Commit**

```powershell
git add electron/managed-history-paths.ts src/shared/types.ts src/shared/storydream-api.ts src/shared/storage.ts src/shared/runner.ts electron/config-service.ts electron/main.ts electron/preload.ts electron/html-video-runtime.ts src/main.tsx scripts/smoke-html-video.ts tests/history-managed-paths.test.ts tests/storage.test.ts tests/runner.test.ts tests/ai-research-flow.test.ts tests/high-parity.test.ts tests/pipeline-cache.test.ts tests/task-runtime-providers.test.ts tests/html-video-electron.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts tests/history-governance.test.ts
git commit -m "feat: add managed history storage and pagination"
```

### Task 6: Implement Atomic Archive, Restore, And Tombstones

**Files:**
- Modify: `src/shared/storage.ts`
- Modify: `tests/history-governance.test.ts`

**Step 1: Write lifecycle RED tests**

Cover idempotent archive/restore, status preservation, pending/running rejection, archived-only permanent delete, task/viral event cascade, image `playground_jobs` cascade, voice clone preservation, duplicate delete returning the existing tombstone, and all later writes refusing tombstoned IDs.

```ts
await db.archiveTask(task.id);
await expect(db.addTaskEvent({ ...event, taskId: task.id })).rejects.toThrow(/deleted|archived/i);
await db.deleteTaskPermanently(task.id);
expect(await db.getTaskDetail(task.id)).toBeNull();
```

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-governance.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement queued transactions**

Add family methods named in the design. Centralize `assertHistoryWritable`. Tombstone fields include family, ID, managed key, cleanup state, quarantine name, identity JSON, diagnostic, and deletion time. A null managed key creates `unmanaged-legacy` without any path operation.

**Step 4: Run GREEN plus storage regression**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-governance.test.ts tests\storage.test.ts tests\storage-reliability.test.ts --pool=threads --maxWorkers=1
```

**Step 5: Commit**

```powershell
git add src/shared/storage.ts tests/history-governance.test.ts
git commit -m "feat: persist history lifecycle and tombstones"
```

### Task 7: Serialize Governance With Active Runs

**Files:**
- Create: `electron/history-activity-registry.ts`
- Create: `tests/history-activity-registry.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/task-run-lifecycle.ts`
- Modify: `tests/task-run-lifecycle.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`

**Step 1: Write bidirectional race RED tests**

```ts
const active = registry.reserveActive('task', id);
expect(() => registry.reserveGovernance('task', id)).toThrow(/active/i);
active.release();
const governing = registry.reserveGovernance('task', id);
expect(() => registry.reserveActive('task', id)).toThrow(/governance/i);
governing.release();
```

Test active reservation before async status/file work, terminal DB persistence before release, and `finally` cleanup for task/viral/image/voice failures.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-activity-registry.test.ts tests\task-run-lifecycle.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
```

**Step 3: Implement `HistoryActivityRegistry`**

Use synchronous reservation acquisition with opaque release tokens. Existing `runningTasks` and `runningViralAnalyses` remain runtime-handle maps, not the lock owner. Every start/resume/retry/generate and archive/delete path acquires the corresponding reservation before other checks.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-activity-registry.test.ts tests\task-run-lifecycle.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
```

**Step 5: Commit**

```powershell
git add electron/history-activity-registry.ts electron/main.ts electron/task-run-lifecycle.ts tests/history-activity-registry.test.ts tests/task-run-lifecycle.test.ts tests/electron-ipc-contract.test.ts
git commit -m "feat: serialize history governance with active runs"
```

### Task 8: Quarantine Managed History Directories Safely

**Files:**
- Modify: `electron/managed-history-paths.ts`
- Modify: `tests/history-managed-paths.test.ts`
- Modify: `electron/main.ts`
- Modify: `src/shared/storage.ts`
- Modify: `tests/history-governance.test.ts`
- Modify: `tests/html-video-electron.test.ts`
- Modify: `tests/task-run-lifecycle.test.ts`

**Step 1: Write filesystem RED tests**

Cover root/absolute/path IDs, external DB paths, symlink/junction/reparse, root replacement, rename-time identity swap, DB rollback, recreated target, cleanup failure, restart reaper identity mismatch, and a no-follow recursive walker.

```ts
const staged = await stageManagedHistoryDirectory(root, managedKey);
await replaceWithDifferentIdentity(staged.quarantinePath);
await expect(removeQuarantineTreeNoFollow(staged)).rejects.toThrow(/identity/i);
```

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-managed-paths.test.ts tests\history-governance.test.ts tests\html-video-electron.test.ts tests\task-run-lifecycle.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
```

**Step 3: Implement stage/rollback/reaper**

Implement `stageManagedHistoryDirectory`, `rollbackManagedHistoryDirectory`, `removeQuarantineTreeNoFollow`, and `reapHistoryQuarantines`. Derive paths only from fixed family roots and persisted managed keys. Persist post-rename identity before DB commit. Reaper deletes only when containment, reparse, and identity still match.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-managed-paths.test.ts tests\history-governance.test.ts tests\html-video-electron.test.ts tests\task-run-lifecycle.test.ts --pool=threads --maxWorkers=1
```

**Step 5: Commit**

```powershell
git add electron/managed-history-paths.ts electron/main.ts src/shared/storage.ts tests/history-managed-paths.test.ts tests/history-governance.test.ts tests/html-video-electron.test.ts tests/task-run-lifecycle.test.ts
git commit -m "feat: quarantine managed history data before deletion"
```

### Task 9: Reconcile Tombstones Across Electron And Browser Fallback

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `src/shared/state-delta.ts`
- Modify: `src/shared/state-reconciliation.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/main.tsx`
- Modify: `tests/state-delta.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write anti-resurrection RED tests**

Cover ordered/out-of-order tombstones, reset buffering, force reset, a late upsert/detail/list response after deletion, browser fallback persistence, and deleting the selected detail.

```ts
const deleted = reduceAppDelta(state, { kind: 'task-tombstone', id, revision: 9 });
const replayed = reduceAppDelta(deleted, { kind: 'task-upsert', task, revision: 8 });
expect(replayed.tasks.some(x => x.id === id)).toBe(false);
```

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\state-delta.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement four explicit tombstone branches**

Update `AppDelta`, `AppMutationResult`, reducer, reconciliation, revision slices, reset buffers, and fallback storage. Remove summaries, selected details, family events, and page caches by ID. List/detail responses carry generation/query tokens and cannot overwrite a later tombstone.

**Step 4: Run GREEN and typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\state-delta.test.ts tests\electron-ipc-contract.test.ts tests\ipc-inventory.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
```

**Step 5: Commit**

```powershell
git add src/shared/types.ts src/shared/storydream-api.ts src/shared/state-delta.ts src/shared/state-reconciliation.ts electron/main.ts electron/preload.ts src/main.tsx tests/state-delta.test.ts tests/electron-ipc-contract.test.ts tests/ipc-inventory.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: reconcile history tombstones across processes"
```

## Phase B: Renderer Paging, Parameter, And Runtime Parity

### Task 10: Add Query-Safe History Page State

**Files:**
- Create: `src/features/history/history-page-store.ts`
- Create: `src/features/history/use-history-page.ts`
- Create: `tests/history-page-store.test.ts`
- Modify: `src/main.tsx`
- Modify: `tests/state-delta.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write cursor ownership RED tests**

Cover an independent cursor stack for every family/filter/status/statuses/taskType/query key, canonical task-status order, condition-reset to `[null]`, previous/next navigation, stale query-token rejection, tombstone removal, governance reload, and backing up when deletion empties the current page.

```ts
const store = createHistoryPageStore('task');
const active = store.begin({ family: 'task', filter: 'active', statuses: ['paused', 'running'], query: '  标题  ' });
store.accept(active.token, page({ nextCursor: 'next-a' }));
expect(store.next()).toEqual({ cursor: 'next-a' });
expect(store.begin({ family: 'task', filter: 'archived' }).cursor).toBeNull();
expect(store.accept(active.token, page())).toBe(false);
```

Also assert bootstrap no longer calls `collectCursorPages` for tasks, viral analyses, image records, or voice records.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-page-store.test.ts tests\state-delta.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because keyed cursor/query state does not exist and renderer bootstrap still expands every history cursor.

**Step 3: Implement the pure store and narrow hook**

Keep request keys serializable and canonical. The hook owns loading/error/request generation only; global bootstrap/delta/reconciliation remain in `App`. Late list/detail responses must check both query token and tombstone revision before publishing. Bootstrap retains only the first active page for shell summaries.

**Step 4: Run GREEN and renderer typecheck**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-page-store.test.ts tests\state-delta.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/history/history-page-store.ts src/features/history/use-history-page.ts src/main.tsx tests/history-page-store.test.ts tests/state-delta.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: add query-safe renderer history paging"
```

### Task 11: Expose Four-Family History Governance

**Files:**
- Create: `src/features/history/HistoryFilterBar.tsx`
- Create: `src/features/history/HistoryRowActions.tsx`
- Create: `src/features/history/PermanentDeleteDialog.tsx`
- Create: `tests/history-governance-ui.test.ts`
- Modify: `src/main.tsx`
- Modify: `tests/history-page-store.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write governance UI RED contracts**

Require task, viral, image, and voice surfaces to expose active/archived tabs, family-legal status filters, trimmed server search, exact `totalCount`, previous/next controls, and the correct actions. Active rows offer archive plus their existing family actions; archived rows offer restore and permanent delete only. Archived rows are read-only and retain view-only family content: task detail, viral report (but not template save/production handoff), image/provider/mode, and voice playback/voice/speed.

The delete dialog must show title and ID, distinguish managed app data from external files that will not be removed, expose semantic title/description/focus hooks and a pure keyboard/focus-order state helper, and require an explicit destructive command. Node tests cover the pure state and source ownership only; real Tab/Escape/focus-restore behavior is a mandatory Electron QA assertion after the production harness exists.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-governance-ui.test.ts tests\history-page-store.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement shared governance controls**

Wire each action to its family-specific `StoryDreamApi` method. Archive and restore reload the current keyed query without confirmation; permanent delete uses the dialog and, after success, closes a deleted detail or selects the adjacent row. If the current page becomes empty, request the previous cursor instead of displaying a stranded page.

Do not flatten the four families into a fake generic record shape. Share filter/action/pagination mechanics while keeping family data and commands discriminated.

**Step 4: Run GREEN and Electron contracts**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\history-governance-ui.test.ts tests\history-page-store.test.ts tests\product-shell-ui.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/history/HistoryFilterBar.tsx src/features/history/HistoryRowActions.tsx src/features/history/PermanentDeleteDialog.tsx src/main.tsx tests/history-governance-ui.test.ts tests/history-page-store.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: add four-family history governance ui"
```

### Task 12: Page Queue And HTML Task Selectors Independently

**Files:**
- Create: `src/features/tasks/task-list-queries.ts`
- Create: `tests/task-list-pagination-ui.test.ts`
- Modify: `src/main.tsx`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write selector RED tests**

```ts
expect(queueRequest()).toEqual({
  family: 'task',
  filter: 'active',
  statuses: ['pending', 'running', 'paused', 'failed'],
  limit: 50,
});
expect(htmlTaskRequest(null)).toMatchObject({ family: 'task', filter: 'active', taskType: 'html-video' });
```

Test queue next/previous cursor ownership, HTML selector append-only “加载更多”, duplicate suppression, stale response rejection, and preservation of the selected HTML task when another page arrives. Neither surface may derive its full list from bootstrap.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-list-pagination-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement dedicated queries**

Use the shared history request types but separate local stores. Queue pages working statuses so old pending/running work cannot hide behind completed rows. HTML fetches only `taskType='html-video'`; legacy unknown task types never enter that selector.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-list-pagination-ui.test.ts tests\history-page-store.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/tasks/task-list-queries.ts src/main.tsx tests/task-list-pagination-ui.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: page queue and html task selectors"
```

### Task 13: Centralize Task Limits And The 51-Field Manifest

**Files:**
- Create: `src/shared/task-control-limits.ts`
- Create: `src/shared/task-control-version.ts`
- Create: `src/shared/task-title.ts`
- Create: `src/features/tasks/task-control-manifest.ts`
- Create: `src/features/tasks/task-create-input.ts`
- Create: `tests/task-control-limits.test.ts`
- Create: `tests/task-control-manifest.test.ts`
- Create: `tests/task-create-input.test.ts`
- Create: `tests/task-title.test.ts`
- Modify: `src/shared/content-metrics.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storage.ts`
- Modify: `electron/main.ts`
- Modify: `src/main.tsx`
- Modify: `tests/content-metrics.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/task-run-lifecycle.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write boundary, manifest, and payload RED tests**

Assert `TASK_CONTROL_MANIFEST_VERSION === 1` and exact key equality with the approved 51-field fixture. Each entry must name `field`, `flowOwner`, `surface`, `visibility`, `defaultSource`, `uiControl`, `uiRange`, `ipcContracts`, `normalizer`, `persistenceConsumer`, and at least one test. Use `satisfies { [K in keyof CreateTaskInput]-?: TaskControlContract<K> }` so a future field fails compilation until governed.

For `targetLength`, `targetScenes/storyboardSceneCount`, and `lockIntroSentences`, test blank, min-1, min, max, max+1, fraction, and NaN. Prove UI/runtime clamps are respectively `100..5000`, `1..60`, and `0..20`, while compatible generic IPC still accepts values through `1_000_000`, `500`, and `100` and rejects its own max+1. HTML remains independently capped at 30. Export UI and IPC ranges separately; copied numeric literals in renderer, metrics, schema, and storage fail the source contract.

Test one shared payload builder. It writes the same normalized value to `targetScenes` and `storyboardSceneCount`, retains AI `selectedSources` after composed copy switches to paste mode, derives podcast speakers/script format only for podcast mode, and does not invent HTML, Music MV, or runner-owned compatibility values.

Lock automatic title persistence before draft work or renderer extraction. `resolveTaskTitle` trims an explicit title; otherwise it collapses source whitespace and takes the first 18 Unicode code points; empty source falls back to `未命名任务`. Send whitespace titles through the direct Electron `task:create-and-run` path and prove the normalized title is persisted before the runner receives the canonical task. Cover storage close/reopen, browser fallback parity, explicit-title precedence, whitespace-only input, and a non-BMP boundary. An empty title must never be written by direct create-and-run.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-control-limits.test.ts tests\task-control-manifest.test.ts tests\task-create-input.test.ts tests\task-title.test.ts tests\content-metrics.test.ts tests\ipc-contract.test.ts tests\storage.test.ts tests\task-run-lifecycle.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement limits, manifest, and one payload builder**

Keep limit constants free of Zod and import them from manifest, normalizers, IPC schemas, and storage. Export `TASK_CONTROL_MANIFEST_VERSION = 1` from the lightweight shared version module and reuse it in the manifest. Replace the inline new-task payload with `buildTaskCreateInput`; later draft persistence consumes the same builder output. Keep `resolveTaskTitle` in `src/shared`, use it in the payload builder, browser fallback, direct Electron create-and-run handler, and storage as the canonical write guard, and pass the persisted canonical task to the runner.

**Step 4: Run GREEN, typechecks, and storage regressions**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-control-limits.test.ts tests\task-control-manifest.test.ts tests\task-create-input.test.ts tests\task-title.test.ts tests\content-metrics.test.ts tests\ipc-contract.test.ts tests\storage.test.ts tests\task-run-lifecycle.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/task-control-limits.ts src/shared/task-control-version.ts src/shared/task-title.ts src/features/tasks/task-control-manifest.ts src/features/tasks/task-create-input.ts src/shared/content-metrics.ts src/shared/ipc-contract.ts src/shared/storage.ts electron/main.ts src/main.tsx tests/task-control-limits.test.ts tests/task-control-manifest.test.ts tests/task-create-input.test.ts tests/task-title.test.ts tests/content-metrics.test.ts tests/ipc-contract.test.ts tests/storage.test.ts tests/task-run-lifecycle.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: define exhaustive task control manifest"
```

### Task 14: Persist Versioned Recoverable Task Drafts

**Files:**
- Create: `src/shared/task-draft.ts`
- Create: `tests/task-drafts.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `src/shared/storage.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/main.tsx`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/storage-reliability.test.ts`
- Modify: `tests/runner.test.ts`
- Modify: `tests/task-run-lifecycle.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write draft lifecycle RED tests**

Define a strict version-one envelope:

```ts
interface TaskDraftEnvelopeV1 {
  controlManifestVersion: 1;
  values: Partial<CreateTaskInput>;
}
```

Prove a representative value for all 51 fields survives database close/reopen. Incomplete drafts may save; starting without valid input fails without changing status. Save acquires a governing/edit reservation, creates or updates only a `draft` row, and never starts a runner; an active-reserved draft rejects save, and the save reservation blocks concurrent start/archive. Start acquires the active reservation before asynchronous work, migrates and validates the envelope, materializes every canonical Task column, atomically transitions the same task ID to pending, returns that canonical Task to the runner, and starts exactly once. Injected transaction failure leaves both columns and status unchanged. Archived, tombstoned, or governing-reserved drafts reject save/start. Reject unknown envelope keys and future versions.

The visible command must call `saveTaskDraft`, replace the notice-only handler, persist an extracted source title or `未命名草稿`, and reopen into the new-task form. Browser fallback uses the same envelope/migration rules.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-drafts.test.ts tests\storage.test.ts tests\runner.test.ts tests\task-run-lifecycle.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement save/start draft ownership**

Add strict `task:save-draft` and `task:start-draft` channels to the centralized inventory. Both enter the shared activity registry before database work: save uses governing/edit, start uses active, and both release in `finally`. Persist the envelope in a `tasks.control_draft_json` column, omit it from summaries, and expose it only in task detail. `migrateTaskDraft` is the sole version transition owner. In one queued transaction, `startTaskDraft` performs migrate -> shared create-schema validation -> full Task-column materialization -> status transition and returns the canonical row. Main passes that returned row directly to the runner. Permanent task deletion cascades the envelope. Starting a saved draft preserves its ID; do not create an ambiguous second task.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-drafts.test.ts tests\storage.test.ts tests\storage-reliability.test.ts tests\runner.test.ts tests\task-run-lifecycle.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/task-draft.ts src/shared/types.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts src/shared/storage.ts electron/preload.ts electron/main.ts src/main.tsx tests/task-drafts.test.ts tests/storage.test.ts tests/storage-reliability.test.ts tests/runner.test.ts tests/task-run-lifecycle.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: persist versioned task drafts"
```

### Task 15: Govern All 17 HTML Video Controls

**Files:**
- Create: `src/shared/html-video-config.ts`
- Create: `src/shared/html-video-control-manifest.ts`
- Create: `tests/html-video-control-manifest.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/html-video-workflow.ts`
- Modify: `src/shared/html-video-runner.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `electron/html-video-runtime.ts`
- Modify: `tests/html-video.test.ts`
- Modify: `tests/html-video-runner.test.ts`
- Modify: `tests/html-video-electron.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write exhaustive manifest and default RED tests**

Assert exact coverage of `style`, `voiceId`, `ttsProvider`, `ttsSpeed`, `bgmId`, `captionPreset`, `captionAnim`, `captionColors`, `bgmVolume`, `transitionType`, `coverImageMode`, `coverTemplate`, `coverRatio`, `draftTemplate`, `foreground`, `maxScenes`, and `ratio`.

```ts
expect(Object.keys(HTML_VIDEO_CONTROL_MANIFEST_V1).sort()).toEqual(APPROVED_HTML_VIDEO_FIELDS.sort());
expect(HTML_VIDEO_CONTROL_MANIFEST_V1).toEqual(expect.objectContaining({
  transitionType: expect.objectContaining({ persistencePath: 'pipelineData.config', consumerStages: ['render'], invalidateFrom: 'render' }),
}));
```

Every entry records `defaultResolver`, `schema`, `uiLocation`, `persistencePath`, `legacyMirror`, `consumerStages`, `invalidateFrom`, `availability`, and tests. Prove V2 and V1 `_cfg` full-field round-trip, deep cloning of caption colors, missing-snapshot preservation, deterministic default creation, strict enums/ranges, stage checkpoint hashing, and explicit recovery warnings instead of silently replacing custom values.

Test the stage/tab mapping separately: rewrite and planning both map to text; render and done map to output; cover never becomes a seventh stage. Ordinary tasks report `x/7`, HTML reports `x/6`.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-control-manifest.test.ts tests\html-video.test.ts tests\html-video-runner.test.ts tests\html-video-electron.test.ts tests\ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement one config owner and honest availability**

Add `HTML_VIDEO_CONTROL_MANIFEST_VERSION = 1`, the exhaustive shared manifest, and a shared resolver/factory. New jobs resolve documented defaults once; an existing snapshot with an omitted field retains omission semantics. `pipelineData.config` is the only editable runtime owner; task fields are legacy mirrors used for recovery only. Electron and renderer both import the shared manifest; no shared/Electron module may import `src/features`.

Unify provider, speed, volume, transition, max-scene, and ratio validation. Remove copied `fade`, `3:4`, `8`, provider, and ratio literals from recovery/runtime. Record current consumer stages exactly; `transitionType` has only the render/sidecar consumer and invalidates from render. Fields still lacking a consumer remain losslessly persisted with `availability: 'read-only-compatible'`; no inert editor is introduced in this task.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-control-manifest.test.ts tests\html-video.test.ts tests\html-video-runner.test.ts tests\html-video-electron.test.ts tests\ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/html-video-config.ts src/shared/html-video-control-manifest.ts src/shared/types.ts src/shared/html-video-workflow.ts src/shared/html-video-runner.ts src/shared/ipc-contract.ts electron/html-video-runtime.ts tests/html-video-control-manifest.test.ts tests/html-video.test.ts tests/html-video-runner.test.ts tests/html-video-electron.test.ts tests/ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: govern every html video control"
```

### Task 16: Expose Existing HTML Consumers Through Strict Config Updates

**Files:**
- Modify: `src/shared/html-video-control-manifest.ts`
- Modify: `src/shared/html-video-workflow.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `electron/html-video-runtime.ts`
- Modify: `src/main.tsx`
- Modify: `tests/html-video-control-manifest.test.ts`
- Modify: `tests/html-video-electron.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write config-update RED tests**

Add strict `html-video:update-config` inventory cases before implementation. Missing/soft/medium/loud must reach the actual render payload as `-28/-28/-22/-16 dB`; a catalogued transition reaches the sidecar unchanged; invalid transition/provider/speed/ratio is rejected before persistence. Reject pending/running/activity-reserved, archived, and tombstoned canonical tasks, plus any field still marked `read-only-compatible`. Archived/tombstoned rejection occurs before invalidation, persistence, artifact mutation, or event publication and leaves byte-identical config/artifacts/status plus no new event. A valid patch writes `pipelineData.config`, retains earlier artifacts, clears from the manifest-declared stage, synchronizes only documented legacy mirrors, and atomically converts a completed task to the correct resumable top-level status/currentStep/pipelineStep with completion fields cleared. No caption, cover, or draft editor appears while its consumer remains unavailable.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-control-manifest.test.ts tests\html-video-electron.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement strict patch and shipped controls**

Acquire a governing/edit reservation, parse the discriminated patch through the centralized IPC schema, load the canonical task/pipeline, reject archived/tombstoned as well as active or pending/running state before any side effect, and apply only editable manifest-governed fields. In one queued transaction invalidate from the earliest changed stage, update the pipeline plus canonical top-level task status/progress/completion fields, persist one snapshot, and publish one mutation; release in `finally`. Expose only controls with proven deterministic consumers, including provider/voice/speed, volume, transition, foreground, max scenes, style, BGM, and ratio according to their manifest availability.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-control-manifest.test.ts tests\html-video-electron.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/html-video-control-manifest.ts src/shared/html-video-workflow.ts src/shared/types.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts electron/preload.ts electron/main.ts electron/html-video-runtime.ts src/main.tsx tests/html-video-control-manifest.test.ts tests/html-video-electron.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: expose consumed html video controls"
```

### Task 17: Add Deterministic HTML Caption Consumers

**Files:**
- Create: `src/shared/html-video-captions.ts`
- Create: `tests/html-video-captions.test.ts`
- Modify: `src/shared/html-video-config.ts`
- Modify: `src/shared/html-video-control-manifest.ts`
- Modify: `src/shared/html-video-workflow.ts`
- Modify: `electron/html-video-renderer.ts`
- Modify: `electron/html-video-runtime.ts`
- Modify: `src/main.tsx`
- Modify: `tests/html-video-electron.test.ts`
- Modify: `tests/html-video-control-manifest.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write caption consumer RED tests**

Cover the approved caption preset catalog, animation timeline, reduced-motion behavior, and validated color variables. Reject unknown presets/animations, unsafe CSS keys/values, injection strings, and 33 color entries before preview/render. Verify preview and final render receive identical resolved caption style, and missing legacy fields preserve the old appearance.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-captions.test.ts tests\html-video-electron.test.ts tests\html-video-control-manifest.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement caption CSS/timeline consumers and controls**

Render CSS variables from a fixed allowlist, not arbitrary property interpolation. The renderer and final frame capture share the same resolver. Add caption controls to the preview tab only after these consumers exist; edits update `pipelineData.config`, invalidate from preview, and persist across restart/retry.

**Step 4: Run GREEN and HTML regression suites**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-captions.test.ts tests\html-video-electron.test.ts tests\html-video-control-manifest.test.ts tests\html-video.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/html-video-captions.ts src/shared/html-video-config.ts src/shared/html-video-control-manifest.ts src/shared/html-video-workflow.ts electron/html-video-renderer.ts electron/html-video-runtime.ts src/main.tsx tests/html-video-captions.test.ts tests/html-video-electron.test.ts tests/html-video-control-manifest.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: render configurable html video captions"
```

### Task 18: Add HTML Cover Consumers

**Files:**
- Create: `src/shared/html-video-cover.ts`
- Create: `tests/html-video-cover.test.ts`
- Modify: `src/shared/html-video-config.ts`
- Modify: `src/shared/html-video-control-manifest.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/html-video-workflow.ts`
- Modify: `src/shared/html-video-runner.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `electron/html-video-runtime.ts`
- Modify: `src/main.tsx`
- Modify: `tests/html-video-runner.test.ts`
- Modify: `tests/html-video-electron.test.ts`
- Modify: `tests/html-video-control-manifest.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write cover RED tests**

Test `off`, `auto`, and `manual` as different runtime behaviors; built-in/custom/missing cover templates; supported cover ratios and exact output dimensions; legacy `titled` migration; and cover failures remaining under render while appearing in the cover inspector. Add a strict `html-video:import-cover` contract: manual source must be a validated selected image, is staged in the task's managed directory only after canonical-state checks, becomes a versioned `coverAsset` pipeline artifact, and never grants deletion authority over the external source. Invalid/oversized/missing files, pending/running, activity-reserved, archived, and tombstoned tasks fail before copy and leave config, artifacts, managed directories, status, and events unchanged. Inject failures after staging and during persistence to prove temporary files are removed and the prior artifact remains authoritative. Importing into completed work atomically invalidates render and updates canonical top-level task status/progress/completion fields to the tested resumable state.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-cover.test.ts tests\html-video-runner.test.ts tests\html-video-electron.test.ts tests\html-video-control-manifest.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement cover ownership, then unlock controls**

Acquire a governing/edit reservation, load and revalidate the canonical task, and reject archived/tombstoned or active state before validating/copying the external source. Use existing cover-template records through validated IDs. Generate, skip, or preserve the managed manual `coverAsset` according to mode. Stage the copy under a task-owned temporary name, commit pipeline/task state as one queued operation, atomically promote the staged file only for the committed artifact, and clean it on every failure; canonical resumable top-level state follows invalidation. Release the reservation in `finally`. Expose mode/template/ratio/import only after tests observe different deterministic output. Update the shared manifest availability and invalidate from render; cover remains a render subflow, never a seventh pipeline stage.

**Step 4: Run GREEN plus real HTML smoke**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-cover.test.ts tests\html-video-runner.test.ts tests\html-video-electron.test.ts tests\html-video-control-manifest.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
npm.cmd run build
npm.cmd run smoke:html-video
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/html-video-cover.ts src/shared/html-video-config.ts src/shared/html-video-control-manifest.ts src/shared/types.ts src/shared/html-video-workflow.ts src/shared/html-video-runner.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts electron/preload.ts electron/main.ts electron/html-video-runtime.ts src/main.tsx tests/html-video-cover.test.ts tests/html-video-runner.test.ts tests/html-video-electron.test.ts tests/html-video-control-manifest.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: complete html cover output"
```

### Task 19: Apply HTML Draft Templates To Real Output

**Files:**
- Create: `src/shared/html-video-draft.ts`
- Create: `tests/html-video-draft.test.ts`
- Modify: `src/shared/html-video-control-manifest.ts`
- Modify: `src/shared/html-video-workflow.ts`
- Modify: `src/shared/html-video-runner.ts`
- Modify: `src/shared/task-runtime-providers.ts`
- Modify: `src/shared/draft.ts`
- Modify: `src/shared/jianying-bridge.ts`
- Modify: `electron/main.ts`
- Modify: `electron/html-video-runtime.ts`
- Modify: `src/main.tsx`
- Modify: `tests/html-video-runner.test.ts`
- Modify: `tests/html-video-electron.test.ts`
- Modify: `tests/html-video-control-manifest.test.ts`
- Modify: `tests/jianying-bridge.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write draft-output RED tests**

Test missing/valid/deleted draft template IDs, exact detail loading by ID, HTML-only output when omitted, and real Jianying draft differences for two saved templates. Prove canvas, layers, audio/transition settings, and output paths come from the selected canonical template; a missing template errors instead of silently substituting another. Retry/restart retains the config value and invalidates only from render.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-draft.test.ts tests\html-video-runner.test.ts tests\html-video-electron.test.ts tests\html-video-control-manifest.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement canonical template resolution and output**

Resolve template detail through `FileDatabase.getDraftTemplateDetail` before render and pass the canonical template into the HTML runtime/draft bridge. Generate a real draft only when selected; keep normal HTML render output otherwise. Update manifest availability and expose the selector only after output tests turn green.

**Step 4: Run GREEN, both typechecks, and HTML smoke**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-draft.test.ts tests\html-video-runner.test.ts tests\html-video-electron.test.ts tests\html-video-control-manifest.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
npm.cmd run build
npm.cmd run smoke:html-video
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/html-video-draft.ts src/shared/html-video-control-manifest.ts src/shared/html-video-workflow.ts src/shared/html-video-runner.ts src/shared/task-runtime-providers.ts src/shared/draft.ts src/shared/jianying-bridge.ts electron/main.ts electron/html-video-runtime.ts src/main.tsx tests/html-video-draft.test.ts tests/html-video-runner.test.ts tests/html-video-electron.test.ts tests/html-video-control-manifest.test.ts tests/jianying-bridge.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: apply html draft templates to output"
```

### Task 20: Migrate Theme Ownership Without Changing The Default

**Files:**
- Create: `src/shared/theme-preference.ts`
- Create: `tests/theme-preference.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/state-delta.ts`
- Modify: `electron/config-service.ts`
- Modify: `electron/main.ts`
- Modify: `tests/config-migration.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/state-delta.test.ts`

**Step 1: Write migration and rollback RED tests**

Cover legacy config light with no marker, auto-seeded UI dark plus legacy config light, valid raw UI light/dark, marker-present UI preference precedence, invalid legacy values, fresh install dark, and an external legacy config file disagreeing with a marker-present database. Migration must preserve `activeView` and write UI theme, `themePreferenceVersion: 1`, and the config mirror in one queued transaction.

Test navigation preserving theme/version, config save unable to overwrite current UI preference with a stale settings draft, persistence across restart, and a fully rolled-back preference/config pair when an injected database commit fails. Visible DOM application is introduced only after this storage owner is stable.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\theme-preference.test.ts tests\config-migration.test.ts tests\ipc-contract.test.ts tests\storage.test.ts tests\state-delta.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement versioned ownership**

Add `themePreferenceVersion: 1` to `UiPreferences`. `UiPreferences.theme` becomes the sole runtime/persistence owner; `AppConfig.ui.theme` is a compatibility mirror only. Keep new-install default dark. Make storage `upsertUiPreferences` and `upsertConfig` return the canonical persisted preference/config pair. Main handlers, `ConfigService`, state patches, and config-file writes must publish/write only those returned canonical values, never the stale request draft. Navigation updates only `activeView`; theme save updates theme/version/mirror; config save overlays the current preference before persistence.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\theme-preference.test.ts tests\config-migration.test.ts tests\ipc-contract.test.ts tests\storage.test.ts tests\state-delta.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/theme-preference.ts src/shared/types.ts src/shared/config.ts src/shared/ipc-contract.ts src/shared/storage.ts src/shared/state-delta.ts electron/config-service.ts electron/main.ts tests/theme-preference.test.ts tests/config-migration.test.ts tests/ipc-contract.test.ts tests/storage.test.ts tests/state-delta.test.ts
git commit -m "feat: version persisted theme ownership"
```

### Task 21: Apply And Persist Runtime Themes

**Files:**
- Create: `src/features/settings/theme-controller.ts`
- Create: `tests/theme-controller.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write runtime theme RED tests**

Test bootstrap applying the stored theme before the first meaningful render, `document.documentElement.dataset.theme` changing immediately, `saveUiPreferences` persistence, and rollback of DOM plus control state on failure. Browser fallback preserves the marker and config mirror. Navigation and settings-profile changes cannot reset theme.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\theme-controller.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement a narrow controller**

Keep DOM mutation and persistence sequencing in `theme-controller.ts`; React consumes its result rather than duplicating optimistic state. Add only the minimal current-theme selectors required for behavior. Full design tokens arrive after route extraction.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\theme-controller.test.ts tests\product-shell-ui.test.ts tests\theme-preference.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/settings/theme-controller.ts src/main.tsx src/styles.css tests/theme-controller.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: apply persistent shell themes"
```

### Task 22: Isolate The Prompt Corpus From The Entry Chunk

**Files:**
- Create: `src/shared/prompt-template-catalog.ts`
- Create: `src/shared/prompt-template-defaults.ts`
- Create: `src/shared/prompt-template-loader.ts`
- Create: `tests/prompt-corpus-isolation.test.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/state-delta.ts`
- Modify: `src/shared/state-reconciliation.ts`
- Modify: `src/main.tsx`
- Modify: `vite.config.ts`
- Modify: `tests/prompt-templates.test.ts`
- Modify: `tests/state-delta.test.ts`
- Modify: `tests/product-shell-storage.test.ts`
- Modify: `tests/product-shell-ui.test.ts`
- Modify: `tests/vite-config.test.ts`

**Step 1: Write import-boundary RED tests**

Assert renderer entry, app shell, lightweight config, initial state, storage module, and browser fallback have no static path to `storybound-system-templates.ts` or `defaultPromptTemplates`. `config.ts` stops exporting the corpus. The template feature uses a module-scope dynamic loader; `FileDatabase.open()` resolves the same loader before synchronous seeding. Bootstrap/list payloads contain summaries while detail is fetched by ID.

Test lightweight catalog IDs/metadata against the loaded corpus, custom-template merging, database seed/reset parity, bootstrap summary/detail reconciliation, reset order, browser fallback first-load/error/retry, and no loss of current selection during lazy unmount/remount. The RED test runs a temporary Vite build with `build.manifest: true` and inspects Rollup output/module IDs; it must show the corpus in the current static entry closure before the split. The strict 500,000-byte entry budget remains deferred until routes are lazy.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\prompt-corpus-isolation.test.ts tests\prompt-templates.test.ts tests\state-delta.test.ts tests\product-shell-storage.test.ts tests\product-shell-ui.test.ts tests\vite-config.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Split lightweight defaults from heavy corpus**

Keep config/provider/UI defaults in `config.ts`. Store only lightweight IDs, labels, and track metadata in `prompt-template-catalog.ts`. Move system corpus conversion and built-in prompt construction to `prompt-template-defaults.ts`; `prompt-template-loader.ts` is the only loader and is statically imported by consumers, while that loader alone performs the dynamic import. Database open/reset, renderer template detail, browser fallback, and reconciliation await it. Set Vite `build.manifest: true` and make the test inspect the generated manifest/Rollup module graph. Do not duplicate the corpus or introduce a barrel export that makes it eager again.

**Step 4: Run GREEN and preliminary build inspection**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\prompt-corpus-isolation.test.ts tests\prompt-templates.test.ts tests\state-delta.test.ts tests\product-shell-storage.test.ts tests\product-shell-ui.test.ts tests\vite-config.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
npm.cmd run build
git diff --check
```

Expected: build succeeds and emits a separate prompt corpus chunk. The strict entry-size gate is added after all routes become lazy.

**Step 5: Commit**

```powershell
git add src/shared/prompt-template-catalog.ts src/shared/prompt-template-defaults.ts src/shared/prompt-template-loader.ts src/shared/config.ts src/shared/storage.ts src/shared/state-delta.ts src/shared/state-reconciliation.ts src/main.tsx vite.config.ts tests/prompt-corpus-isolation.test.ts tests/prompt-templates.test.ts tests/state-delta.test.ts tests/product-shell-storage.test.ts tests/product-shell-ui.test.ts tests/vite-config.test.ts
git commit -m "perf: isolate the prompt corpus"
```

### Task 23: Lock Image, Cover, And Clone-Voice Data Contracts

**Files:**
- Create: `src/shared/editorial-data-contracts.ts`
- Create: `tests/editorial-data-contracts.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/product-shell-storage.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`

**Step 1: Write compile-time and persistence RED tests**

Require `IMAGE_LAB_SMART_MODE_CONTRACT satisfies Record<ImageLabSmartMode, ...>`, `CUSTOM_COVER_TEMPLATE_FIELDS satisfies { [K in keyof CustomCoverTemplate]-?: true }`, and `MINIMAX_CLONE_VOICE_FIELDS satisfies { [K in keyof MinimaxCloneVoice]-?: true }`. Assert exact independent inventories of 7, 10, and 5 keys.

Write representative records using every field, close/reopen SQLite, and prove exact round-trip, bootstrap/reset stability, strict IPC acceptance, unknown-key rejection, and no loss/reorder during unrelated config/profile saves. Default cover templates insert only missing IDs and never overwrite user-edited rows; clone defaults seed only when the table is empty. With 101+ clone voices, all rows survive reopen/config saves, cursor/count APIs report the true database total despite a 100-row bootstrap projection, and unrelated saves/lazy remounts never change `lastUsedAt`.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-data-contracts.test.ts tests\storage.test.ts tests\product-shell-storage.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement exhaustive shared contracts**

Keep the contracts value-level and lightweight so later manifests/pages import them without the prompt corpus. Fix demonstrated mapper/schema/seeding losses. Add typed cursor/count methods through the centralized API, preload, main, and storage; bootstrap remains bounded and later settings pages consume `totalCount` rather than array length. Do not redesign UI in this task.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-data-contracts.test.ts tests\storage.test.ts tests\product-shell-storage.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/editorial-data-contracts.ts src/shared/types.ts src/shared/storage.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts electron/preload.ts electron/main.ts tests/editorial-data-contracts.test.ts tests/storage.test.ts tests/product-shell-storage.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts
git commit -m "test: lock editorial data contracts"
```

### Task 24: Harden The Nested DraftTemplate IPC Contract

**Files:**
- Create: `src/shared/draft-template-contract.ts`
- Create: `tests/draft-template-contract.test.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storage.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/draft-template-normalization.test.ts`
- Modify: `tests/product-shell-storage.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`

**Step 1: Write strict nested-schema RED tests**

Cover every DraftTemplate nested object and array. Accept the full built-in/user round-trip; reject unknown root/nested keys, invalid coordinates/dimensions/ranges, NaN/Infinity, invalid animation/effect/catalog values, oversized strings/arrays, duplicate layer IDs, malformed colors, and prototype-pollution keys before the handler/storage call.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\draft-template-contract.test.ts tests\ipc-contract.test.ts tests\draft-template-normalization.test.ts tests\product-shell-storage.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement one strict reusable contract**

Build explicit `.strict()` nested schemas from shared limits/catalogs and reuse the parsed canonical result in storage normalization. Do not accept arbitrary record passthrough or silently drop invalid fields.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\draft-template-contract.test.ts tests\ipc-contract.test.ts tests\draft-template-normalization.test.ts tests\product-shell-storage.test.ts tests\electron-ipc-contract.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/draft-template-contract.ts src/shared/ipc-contract.ts src/shared/storage.ts tests/draft-template-contract.test.ts tests/ipc-contract.test.ts tests/draft-template-normalization.test.ts tests/product-shell-storage.test.ts tests/electron-ipc-contract.test.ts
git commit -m "fix: validate nested draft templates"
```

### Task 25: Fix Ordinary Cover And Promotion Semantics

**Files:**
- Create: `tests/ordinary-task-semantics.test.ts`
- Modify: `src/features/tasks/task-control-manifest.ts`
- Modify: `src/features/tasks/task-create-input.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/runner.ts`
- Modify: `src/shared/prompt-templates.ts`
- Modify: `src/shared/task-runtime-providers.ts`
- Modify: `src/main.tsx`
- Modify: `tests/task-create-input.test.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/runner.test.ts`
- Modify: `tests/prompt-templates.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write ordinary-task semantic RED tests**

Prove `coverImageMode='off'` performs zero cover-provider calls and produces no cover; `auto` resolves the selected complete 10-field cover template and produces its deterministic cover; `manual` never falls through to automatic generation and is unavailable/rejected with a clear error until a dedicated validated manual-cover asset exists. Legacy manual values remain round-trippable but cannot trigger auto output. UI availability/copy must match this behavior.

Prove explicit `keepPromotion=false` stays false through shared payload builder, SQLite close/reopen, prompt rendering, retry, and runner execution even when `productInfo` exists. Only explicit `true` requests preservation; remove `effectivePromotionTask` or any `productInfo`-based truthiness override. UI wording describes preservation when enabled, not removal when disabled.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ordinary-task-semantics.test.ts tests\task-create-input.test.ts tests\storage.test.ts tests\runner.test.ts tests\prompt-templates.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement exact boolean/mode ownership**

Use the shared task manifest/builder as the only renderer owner. Branch cover runtime before provider invocation, resolve auto templates by canonical ID, and reject unsupported manual execution without mutation. Preserve the literal promotion boolean across every mapper and prompt/runtime boundary.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ordinary-task-semantics.test.ts tests\task-create-input.test.ts tests\storage.test.ts tests\runner.test.ts tests\prompt-templates.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add tests/ordinary-task-semantics.test.ts src/features/tasks/task-control-manifest.ts src/features/tasks/task-create-input.ts src/shared/storage.ts src/shared/runner.ts src/shared/prompt-templates.ts src/shared/task-runtime-providers.ts src/main.tsx tests/task-create-input.test.ts tests/storage.test.ts tests/runner.test.ts tests/prompt-templates.test.ts tests/product-shell-ui.test.ts
git commit -m "fix: honor ordinary cover and promotion settings"
```

### Task 26: Make Book Selection Identity Changes Atomic

**Files:**
- Create: `tests/book-selection-identity.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `src/shared/storage.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/main.tsx`
- Modify: `tests/storage.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write composite-identity RED tests**

Add a strict save request carrying `previousIdentity` when theme/book ID changes. Prove same-key update, atomic rename/upsert/delete of the old key, stale previous-identity rejection, destination collision rejection, and injected transaction rollback with no duplicate or lost row. Every product field and benchmark handoff remains intact.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\book-selection-identity.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement one canonical save transaction**

Parse previous/current identities in IPC, execute compare/rename/upsert in the database write queue, and return the canonical record. Renderer updates selection only from that response; it never performs insert-then-delete as separate calls.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\book-selection-identity.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add tests/book-selection-identity.test.ts src/shared/types.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts src/shared/storage.ts electron/preload.ts electron/main.ts src/main.tsx tests/storage.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "fix: update book selection identity atomically"
```

### Task 27: Complete Music MV Runtime Consumers

**Files:**
- Create: `tests/music-mv-runtime.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/runner.ts`
- Modify: `src/shared/draft.ts`
- Modify: `src/shared/jianying-bridge.ts`
- Modify: `src/main.tsx`
- Modify: `tests/runner.test.ts`
- Modify: `tests/draft.test.ts`
- Modify: `tests/jianying-bridge.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write Music MV runtime RED tests**

Require audio existence/probe before provider work, bounded lyrics parsing and timestamp synchronization, requested scene count, BGM, selected draft template, ratio/canvas, caption style, native timeline tracks, provider errors, and a visible export result. Inventory the existing editable Music MV controls exactly: title, lyrics, style, ratio, template, scene count, processing mode, pause point, rhythm mode, caption style, visual motif, audio path, and BGM. Prove every control reaches a real canonical runtime/draft/status consumer and changes the tested output or lifecycle semantics; omission/default behavior remains backward compatible.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\music-mv-runtime.test.ts tests\runner.test.ts tests\draft.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement deterministic runtime consumers**

Validate audio first, derive synchronized lyric scenes/tracks, and pass every inventoried field to its canonical runner, lifecycle, or draft consumer. A control without an observed effect keeps the task RED until its consumer exists: hiding, removing, disabling, or marking any existing editable control read-only is not an acceptable GREEN implementation.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\music-mv-runtime.test.ts tests\runner.test.ts tests\draft.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add tests/music-mv-runtime.test.ts src/shared/types.ts src/shared/runner.ts src/shared/draft.ts src/shared/jianying-bridge.ts src/main.tsx tests/runner.test.ts tests/draft.test.ts tests/jianying-bridge.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: complete music mv runtime settings"
```

### Task 28: Complete Viral Lifecycle And Event Contracts

**Files:**
- Create: `tests/viral-contracts.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/state-reconciliation.ts`
- Modify: `src/shared/viral-runtime.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/main.tsx`
- Modify: `tests/storage.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/viral-analysis.test.ts`
- Modify: `tests/viral-runtime.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write viral contract/lifecycle RED tests**

Require strict cursor-paged viral events/report detail with generation guards, start/pause/cancel/resume, crash recovery, isolated saved settings, bounded media/report errors, atomic prompt/task-template save, production-task handoff, and no coupling to ordinary task settings. Active history keeps actions; archived history is read-only and report-view-only.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\viral-contracts.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\viral-analysis.test.ts tests\viral-runtime.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement storage/API/runtime ownership**

Add typed event/detail cursor APIs through storage, IPC, preload, and renderer reconciliation. Serialize lifecycle transitions with the activity registry, make template saves atomic, and persist recovery checkpoints/settings separately from ordinary tasks.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\viral-contracts.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\viral-analysis.test.ts tests\viral-runtime.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add tests/viral-contracts.test.ts src/shared/types.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts src/shared/storage.ts src/shared/state-reconciliation.ts src/shared/viral-runtime.ts electron/preload.ts electron/main.ts src/main.tsx tests/storage.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/viral-analysis.test.ts tests/viral-runtime.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: complete viral lifecycle contracts"
```

### Task 29: Implement IMA Knowledge Retrieval And Governed Cleanup

**Files:**
- Create: `src/shared/ima-knowledge.ts`
- Create: `tests/ima-knowledge.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `src/shared/config-utils.ts`
- Modify: `src/shared/http.ts`
- Modify: `src/shared/network-policy.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/main.tsx`
- Modify: `tests/config-utils.test.ts`
- Modify: `tests/provider-profile-utils.test.ts`
- Modify: `tests/network-policy.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write IMA boundary RED tests**

Define strict request/result types for configured IMA test/fetch. Cover missing/invalid config, allowed URL policy, timeout/abort, bounded response bytes/records/strings, malformed response, credential redaction, success detail, and zero downstream calls after validation failure through an injected HTTP dependency. Require the visible action to call the API; “清理历史” enters governed history and never clears state/tables directly.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ima-knowledge.test.ts tests\config-utils.test.ts tests\provider-profile-utils.test.ts tests\network-policy.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement strict provider/API ownership**

Add the minimal typed channels, reuse bounded HTTP/network policy, keep credentials in main, and return redacted diagnostics/content summaries. Wire the current settings actions to the API/governance navigation before extraction.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\ima-knowledge.test.ts tests\config-utils.test.ts tests\provider-profile-utils.test.ts tests\network-policy.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/ima-knowledge.ts tests/ima-knowledge.test.ts src/shared/types.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts src/shared/config-utils.ts src/shared/http.ts src/shared/network-policy.ts electron/preload.ts electron/main.ts src/main.tsx tests/config-utils.test.ts tests/provider-profile-utils.test.ts tests/network-policy.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: implement ima knowledge actions"
```

### Task 30: Complete Task Operations And Progress Contracts

**Files:**
- Create: `src/shared/task-progress.ts`
- Create: `tests/task-operations-contracts.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/shared/storydream-api.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/shared/state-reconciliation.ts`
- Modify: `src/shared/runner.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/main.tsx`
- Modify: `tests/storage.test.ts`
- Modify: `tests/runner.test.ts`
- Modify: `tests/ipc-contract.test.ts`
- Modify: `tests/ipc-inventory.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write task-operation RED tests**

Add strict cursor-paged task events with generation guards and prove detail consumes every page without bootstrap assumptions. Queue continue/retry/cancel must map to one legal lifecycle command each, reject invalid/archived/active-race states, and never render duplicate pseudo-actions. Centralize progress: ordinary tasks use seven stages, Step 4 is the fifth completed position, HTML uses six, and clip-only ends at its real terminal step rather than reporting 7/7.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-operations-contracts.test.ts tests\storage.test.ts tests\runner.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement one event/progress/lifecycle owner**

Add typed event paging through storage, API, preload, and reconciliation. Route queue commands through existing lifecycle/activity reservations and derive all visible counts/labels from `task-progress.ts`; remove inline six/seven-step guesses.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-operations-contracts.test.ts tests\storage.test.ts tests\runner.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/shared/task-progress.ts tests/task-operations-contracts.test.ts src/shared/types.ts src/shared/ipc-contract.ts src/shared/storydream-api.ts src/shared/storage.ts src/shared/state-reconciliation.ts src/shared/runner.ts electron/preload.ts electron/main.ts src/main.tsx tests/storage.test.ts tests/runner.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: complete task operation contracts"
```

## Phase C: Mechanical Renderer Decomposition

### Task 31: Extract Shared Form Controls Without Visual Changes

**Files:**
- Create: `src/components/FormField.tsx`
- Create: `src/components/SegmentedControl.tsx`
- Create: `src/components/ToggleField.tsx`
- Create: `src/components/RangeField.tsx`
- Create: `src/components/OptionGroup.tsx`
- Create: `src/components/Accordion.tsx`
- Create: `tests/renderer-architecture.test.ts`
- Modify: `src/main.tsx`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write extraction RED contracts**

Require each shared control to have one owner module, an explicit accessible label, disabled/focus behavior, stable class hooks, and typed variants. Assert `src/main.tsx` no longer defines `Field`, `Segmented`, toggle, range, option-group, or accordion implementations inline. Existing product-shell assertions must be reassigned to `renderer.all` or the exact component file; the assertion count cannot decrease.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move markup and handlers mechanically**

Preserve props, labels, option order, DOM ranges, event semantics, and existing CSS classes. Do not introduce new styling or a component barrel. Use familiar Lucide icons where the current control already has an icon; icon-only buttons retain accessible names and tooltips.

**Step 4: Run GREEN and typecheck**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/components/FormField.tsx src/components/SegmentedControl.tsx src/components/ToggleField.tsx src/components/RangeField.tsx src/components/OptionGroup.tsx src/components/Accordion.tsx src/main.tsx tests/renderer-architecture.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: extract shared workbench controls"
```

### Task 32: Extract Shared Feedback And Data Primitives

**Files:**
- Create: `src/components/AsyncActionFeedback.tsx`
- Create: `src/components/ErrorDetails.tsx`
- Create: `src/components/StatusBadge.tsx`
- Create: `src/components/EmptyState.tsx`
- Create: `src/components/EventTimeline.tsx`
- Create: `src/components/ConfirmDialog.tsx`
- Create: `src/components/CursorPagination.tsx`
- Create: `src/components/DataTable.tsx`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/history-governance-ui.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write primitive RED contracts**

Assert stable dimensions for pagination/table controls, semantic table headers, status variants, real empty/error/loading states, and timeline ordering. `ConfirmDialog` must preserve the existing handlers, expose title/description relationships, use a testable pure focus-order helper, and prevent double submit. Node tests do not claim rendered focus behavior; Tab/Escape/focus restoration is exercised by the later real Electron harness. Cursor buttons expose disabled/busy state without changing layout.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\history-governance-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move repeated primitives**

Preserve existing async error details, retry/copy actions, family-specific row content, and event text. `DataTable` owns table anatomy only; it does not turn task/viral/image/voice rows into a generic data model. Keep all source contracts module-aware.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\history-governance-ui.test.ts tests\history-page-store.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/components/AsyncActionFeedback.tsx src/components/ErrorDetails.tsx src/components/StatusBadge.tsx src/components/EmptyState.tsx src/components/EventTimeline.tsx src/components/ConfirmDialog.tsx src/components/CursorPagination.tsx src/components/DataTable.tsx src/main.tsx tests/renderer-architecture.test.ts tests/product-shell-ui.test.ts tests/history-governance-ui.test.ts
git commit -m "refactor: extract shared workbench primitives"
```

### Task 33: Isolate App State, Navigation, And Shared Options

**Files:**
- Create: `src/app/app-state.ts`
- Create: `src/app/browser-fallback.ts`
- Create: `src/app/navigation.ts`
- Create: `src/app/route-types.ts`
- Create: `src/shared/editorial-options.ts`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/state-delta.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write ownership RED tests**

Require bootstrap normalization, delta coordinator, reconciliation, and browser fallback to be importable without React page modules. Navigation exports the one new-task primary action, exact fifteen sidebar entries, labels/hints/icons, and page metadata. Route props use `PublicAppState` from `config-secrets.ts`, never secret-bearing `AppState`. Shared option catalogs have one owner and contain no feature JSX.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\state-delta.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Extract pure ownership modules**

Move code without changing bootstrap timing, state shape, local fallback keys, provider options, task options, labels, or navigation persistence. `app-state.ts` remains the only feature-neutral state adapter. Pages receive narrow callbacks/values and cannot import `App` or browser fallback.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\state-delta.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/app/app-state.ts src/app/browser-fallback.ts src/app/navigation.ts src/app/route-types.ts src/shared/editorial-options.ts src/main.tsx tests/renderer-architecture.test.ts tests/state-delta.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: isolate renderer application contracts"
```

### Task 34: Extract Task Feature Pages

**Files:**
- Create: `src/features/tasks/NewTaskPage.tsx`
- Create: `src/features/tasks/QueuePage.tsx`
- Create: `src/features/tasks/HistoryPage.tsx`
- Create: `src/features/tasks/TaskDetailPage.tsx`
- Create: `src/features/tasks/TaskArtifactPreview.tsx`
- Create: `src/features/tasks/task-pipeline.ts`
- Create: `src/features/tasks/task-formatters.ts`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write task-module RED contracts**

Assign every existing task assertion to its future owner. Require all 51 manifest fields to remain referenced by a surface/builder/owner and preserve every behavior already green after Phase B: draft reopen/start, query-safe queue/history, complete event pagination, lifecycle commands, artifact tabs, and canonical `x/7`/`x/6`/clip-only progress. Assert task pages do not import app bootstrap, secrets, or each other through a barrel.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\task-control-manifest.test.ts tests\task-create-input.test.ts tests\task-drafts.test.ts tests\task-list-pagination-ui.test.ts tests\history-governance-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move task pages without redesigning them**

Preserve hook state, callback ordering, conditional visibility, saved selections, scroll ownership, and class names. Extract pure pipeline/progress/format helpers where they eliminate duplicated logic. `main.tsx` temporarily imports the pages statically; lazy loading arrives only after all pages have clean module boundaries.

**Step 4: Run GREEN and typecheck**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\task-control-manifest.test.ts tests\task-create-input.test.ts tests\task-drafts.test.ts tests\task-list-pagination-ui.test.ts tests\history-governance-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/tasks/NewTaskPage.tsx src/features/tasks/QueuePage.tsx src/features/tasks/HistoryPage.tsx src/features/tasks/TaskDetailPage.tsx src/features/tasks/TaskArtifactPreview.tsx src/features/tasks/task-pipeline.ts src/features/tasks/task-formatters.ts src/main.tsx tests/renderer-architecture.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: extract task feature pages"
```

### Task 35: Extract Local Tool And Lab Pages

**Files:**
- Create: `src/features/labs/BookSelectionPage.tsx`
- Create: `src/features/labs/BenchmarkImportPage.tsx`
- Create: `src/features/labs/PersonAssetsPage.tsx`
- Create: `src/features/labs/ImageLabPage.tsx`
- Create: `src/features/labs/VoiceLabPage.tsx`
- Create: `src/features/labs/image-lab-helpers.ts`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write lab-module RED contracts**

Lock book product round-trip and handoff, benchmark sources/keywords, person preflight, all seven image smart modes, provider/style/ratio/batch/cost/reference inputs, image history governance, voice provider/voice/speed/text playback, failed voice history, and clone-voice preservation. Route props remain secret-stripped.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\image-lab.test.ts tests\person-assets.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move pages mechanically**

Keep current APIs, all form values, media error states, and governance controls. Do not add visual cards or change layout. Extract only image-lab calculations reused by tests/UI.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\image-lab.test.ts tests\person-assets.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/labs/BookSelectionPage.tsx src/features/labs/BenchmarkImportPage.tsx src/features/labs/PersonAssetsPage.tsx src/features/labs/ImageLabPage.tsx src/features/labs/VoiceLabPage.tsx src/features/labs/image-lab-helpers.ts src/main.tsx tests/renderer-architecture.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: extract local tool and lab pages"
```

### Task 36: Extract Media Workflow Pages

**Files:**
- Create: `src/features/music-mv/MusicMvPage.tsx`
- Create: `src/features/html-video/HtmlVideoPage.tsx`
- Create: `src/features/html-video/HtmlVideoTabPanel.tsx`
- Create: `src/features/viral/ViralAnalyzerPage.tsx`
- Create: `src/features/viral/ViralReport.tsx`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/html-video-control-manifest.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write media-module RED contracts**

Require all behavior already green after Phase B: HTML 17-field ownership and stage/tab/runtime behavior; complete Music MV consumers; and complete viral lifecycle, paged events/report, template/handoff, recovery, and governance. This task only moves those pages and cannot change their contracts.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\html-video-control-manifest.test.ts tests\html-video.test.ts tests\viral-analysis.test.ts tests\viral-runtime.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move media pages mechanically**

Preserve all controls, stage state, media cache ownership, side effects, and API calls. Keep HTML, Music MV, and viral types/helpers in their own feature directories; no cross-feature barrel imports.

**Step 4: Run GREEN and both typechecks**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\html-video-control-manifest.test.ts tests\html-video.test.ts tests\viral-analysis.test.ts tests\viral-runtime.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/music-mv/MusicMvPage.tsx src/features/html-video/HtmlVideoPage.tsx src/features/html-video/HtmlVideoTabPanel.tsx src/features/viral/ViralAnalyzerPage.tsx src/features/viral/ViralReport.tsx src/main.tsx tests/renderer-architecture.test.ts tests/html-video-control-manifest.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: extract media workflow pages"
```

### Task 37: Extract Template Pages And Editors

**Files:**
- Create: `src/features/templates/PromptTemplatesPage.tsx`
- Create: `src/features/templates/PromptTemplateEditor.tsx`
- Create: `src/features/templates/DraftTemplatesPage.tsx`
- Create: `src/features/templates/DraftCanvas.tsx`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/prompt-corpus-isolation.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write template-module RED contracts**

Lock prompt summary/detail loading, create/duplicate/import/export/delete/reset, step prompts, variables, track/style/draft-template defaults, and lazy corpus ownership. Lock draft layers, selection, drag coordinates, width scaling, background/color dual inputs, 124 image animations, Jianying effects, BGM, Coze single/batch import, diagnostics, save/copy/delete, and unsaved-edit stability.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\prompt-corpus-isolation.test.ts tests\prompt-templates.test.ts tests\draft-template-normalization.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move template pages mechanically**

The prompt page statically imports the single lightweight loader; only that loader dynamically imports the corpus. Keep canvas math and draft edit state in the draft feature. Preserve every field and option; inspector grouping may not change until visual migration.

**Step 4: Run GREEN**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\prompt-corpus-isolation.test.ts tests\prompt-templates.test.ts tests\draft-template-normalization.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/templates/PromptTemplatesPage.tsx src/features/templates/PromptTemplateEditor.tsx src/features/templates/DraftTemplatesPage.tsx src/features/templates/DraftCanvas.tsx src/main.tsx tests/renderer-architecture.test.ts tests/prompt-corpus-isolation.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: extract template feature pages"
```

### Task 38: Extract Settings, Account, And Activation Pages

**Files:**
- Create: `src/features/settings/SettingsPage.tsx`
- Create: `src/features/settings/ProviderProfileManagers.tsx`
- Create: `src/features/settings/settings-controls.tsx`
- Create: `src/features/account/AccountPage.tsx`
- Create: `src/features/account/ActivationPage.tsx`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/config-utils.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write system-page RED contracts**

Require all AppConfig top-level fields and nested provider/profile parameters to remain editable or deliberately read-only, with secrets handled only through `SecretChanges`. Preserve the now-real IMA test/fetch and governed cleanup actions, local paths, BGM, provider model listing/test, current profile save/copy/delete/enable, and browser limitations. This move-only task adds no new system behavior.

Account keeps display name/email/workspace edits, email validation, derived avatar, read-only device/balance, and real credit transactions. Activation keeps legal plan/status transitions, invalid-date handling, shared remaining-days helper, and consistent sidebar/page values.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\config-utils.test.ts tests\provider-profile-utils.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move pages and pure helpers**

Preserve all parameters, validation, async actions, and conditional provider fields. Feature modules consume `PublicAppState` and secret status only; they never reconstruct or log secret values.

**Step 4: Run GREEN and typecheck**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\config-utils.test.ts tests\provider-profile-utils.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/features/settings/SettingsPage.tsx src/features/settings/ProviderProfileManagers.tsx src/features/settings/settings-controls.tsx src/features/account/AccountPage.tsx src/features/account/ActivationPage.tsx src/main.tsx tests/renderer-architecture.test.ts tests/config-utils.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: extract settings and account pages"
```

### Task 39: Reduce The Entry To App Composition

**Files:**
- Create: `src/app/App.tsx`
- Create: `src/app/AppShell.tsx`
- Create: `src/app/AppRoutes.tsx`
- Create: `src/app/RouteErrorBoundary.tsx`
- Create: `src/app/RouteLoadingState.tsx`
- Modify: `src/main.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/state-delta.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write app-boundary RED tests**

Require `src/main.tsx` to contain only style import, root lookup, `createRoot`, and `<App />` mount. `App.tsx` exclusively owns bootstrap, delta subscription, reconciliation, selected detail, route selection, theme controller, and global errors. `AppShell` owns chrome/navigation; `AppRoutes` owns page composition. Loading/error states have stable dimensions and retry/navigation recovery.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\state-delta.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Move application ownership**

Continue static page imports for this task so behavior changes are isolated from lazy timing. Pass narrow route props; no feature may import `App`, `AppRoutes`, browser fallback, or another page. Preserve bootstrap and delta sequencing exactly.

**Step 4: Run GREEN and typecheck**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-architecture.test.ts tests\state-delta.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
git diff --check
```

**Step 5: Commit**

```powershell
git add src/app/App.tsx src/app/AppShell.tsx src/app/AppRoutes.tsx src/app/RouteErrorBoundary.tsx src/app/RouteLoadingState.tsx src/main.tsx tests/renderer-architecture.test.ts tests/state-delta.test.ts tests/product-shell-ui.test.ts
git commit -m "refactor: split renderer application shell"
```

### Task 40: Add The Exhaustive 17-Route Lazy Registry

**Files:**
- Create: `src/app/route-registry.ts`
- Create: `tests/route-registry.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/app/navigation.ts`
- Modify: `src/app/AppRoutes.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `tests/renderer-architecture.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write route-registry RED tests**

Add runtime `SHELL_VIEWS` and derive `ShellView` from it. Assert exact 17/17 equality with registry keys, one separate new-task primary action, exact fifteen sidebar entries, and task-detail excluded from navigation. Each loader is declared at module scope with `React.lazy`, has no static page import, and supports hover/focus prefetch. Every route has a stable Suspense fallback and error boundary.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\route-registry.test.ts tests\renderer-architecture.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement the registry**

Export loader, preload, and component ownership per view without a barrel. Feature CSS remains module-local once visual files are split; the entry must not import all feature styles. Route changes use `startTransition`; preload happens only on user intent, not by eagerly importing all routes.

**Step 4: Run GREEN and build**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\route-registry.test.ts tests\renderer-architecture.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
npm.cmd run build
git diff --check
```

**Step 5: Commit**

```powershell
git add src/app/route-registry.ts src/shared/types.ts src/app/navigation.ts src/app/AppRoutes.tsx src/app/AppShell.tsx tests/route-registry.test.ts tests/renderer-architecture.test.ts tests/product-shell-ui.test.ts
git commit -m "perf: lazy load every renderer route"
```

### Task 41: Enforce Functional Inventory And Bundle Boundaries

**Files:**
- Create: `tests/fixtures/editorial-workbench-parity.ts`
- Create: `tests/editorial-workbench-parity.test.ts`
- Create: `src/app/renderer-command-inventory.ts`
- Create: `tests/renderer-command-inventory.test.ts`
- Create: `scripts/renderer-bundle-budget.ts`
- Create: `tests/renderer-bundle-budget.test.ts`
- Create: `tsconfig.scripts.json`
- Modify: `vite.config.ts`
- Modify: `scripts/typecheck.ps1`
- Modify: `tests/startup-script.test.ts`
- Modify: `tests/vite-config.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write inventory and budget RED tests**

The test fixture independently hard-codes the approved inventories: 17 ShellView values, 15 sidebar entries, 51 CreateTaskInput fields, 17 HTML fields, 7 image smart modes, 10 custom cover fields, and 5 MiniMax clone-voice fields. It also exports the approved stable above-fold visible copy and order keyed by the nine accepted concept capture IDs. Assert exact manifest/registry equality, nonempty owner/consumer/test metadata, and no duplicate/omitted entry.

Add an independently hard-coded renderer command inventory mapping every user-command `StoryDreamApi` method to its owning route, visible control, disabled/loading/error behavior, and focused test. Compare exact method sets after explicitly allowlisting bootstrap, list, detail, and subscription-only methods. Fail if preload retains a command that no reachable route/control owns; include config tests, model/voice fetches, imports/exports/resets/clones, regeneration, diagnostics, path actions, and governance commands.

Unit-test the bundle checker with an entry at 499,999 bytes (pass), 500,000 bytes (fail), multiple entries, corpus directly in an entry (fail), entry -> statically imported shared corpus (fail), missing corpus (fail), and entry -> dynamic route -> corpus (pass).

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-bundle-budget.test.ts tests\editorial-workbench-parity.test.ts tests\renderer-command-inventory.test.ts tests\vite-config.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Add the Vite output gate**

Use a `generateBundle` plugin and `Buffer.byteLength(chunk.code, 'utf8')`. Every `isEntry` JavaScript chunk must be strictly below 500,000 raw bytes. Normalize Rollup module IDs (`\\` to `/`, strip query and virtual prefixes), build the output chunk graph, and traverse every entry's transitive `OutputChunk.imports`; reject the corpus anywhere in that complete static closure. Require the corpus to be reachable only through a `dynamicImports` edge/lazy subtree. Print each entry filename and exact byte count during a real build.

Create `tsconfig.scripts.json` for repository TypeScript scripts and add it to `scripts/typecheck.ps1`; from this task onward `npm.cmd run typecheck` covers renderer, Electron, and script projects.

**Step 4: Run GREEN and the real build**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\renderer-bundle-budget.test.ts tests\editorial-workbench-parity.test.ts tests\renderer-command-inventory.test.ts tests\vite-config.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

**Step 5: Commit**

```powershell
git add tests/fixtures/editorial-workbench-parity.ts tests/editorial-workbench-parity.test.ts src/app/renderer-command-inventory.ts tests/renderer-command-inventory.test.ts scripts/renderer-bundle-budget.ts tests/renderer-bundle-budget.test.ts tsconfig.scripts.json vite.config.ts scripts/typecheck.ps1 tests/startup-script.test.ts tests/vite-config.test.ts tests/product-shell-ui.test.ts
git commit -m "build: enforce renderer parity and chunk budgets"
```

### Task 42: Build A Real Electron Editorial QA Harness

**Files:**
- Create: `electron/editorial-qa.ts`
- Create: `scripts/editorial-qa-electron.ts`
- Create: `scripts/smoke-electron.ts`
- Create: `tests/editorial-qa.test.ts`
- Delete: `scripts/smoke-electron.cjs`
- Modify: `scripts/smoke-electron.ps1`
- Modify: `package.json`
- Modify: `electron/main.ts`
- Modify: `src/shared/process-runner.ts`
- Modify: `tsconfig.scripts.json`
- Modify: `scripts/typecheck.ps1`
- Modify: `tests/startup-script.test.ts`
- Modify: `tests/electron-smoke-contract.test.ts`
- Modify: `tests/smoke-signal-lifecycle.test.ts`
- Modify: `tests/process-runner.test.ts`

**Step 1: Write harness safety RED tests**

Require QA environment variables, including `STORYDREAM_QA_RUN_TOKEN`, to be all-or-none and smoke/QA modes to be mutually exclusive. The parent alone calls `mkdtemp(tmpdir(), 'storydream-editorial-qa-')`, creates a regular non-reparse sentinel with `wx` and a random token, and passes the root/token. Before `app.setPath` or fixture seeding, main synchronously proves the canonical root is a strict child of canonical OS temp, root/sentinel are not symlink/junction/reparse, token matches and is atomically consumed, the database does not preexist, and report/capture paths are strict descendants. Reject external sentinels and real userData. Cleanup receives only the original `mkdtemp` return value, never an env-derived path.

The parent must pass one AbortSignal to `runBoundedProcess`, terminate only its owned process tree on timeout/signal, preserve primary plus cleanup errors, and remove temporary userData in `finally`. Extend `runBoundedProcess` to return the spawned root PID. Child report records its process PID and `app.getAppMetrics()` PIDs before quit; after normal close the parent waits a bounded grace period, verifies every recorded owned PID is gone, and targets only still-owned exact PIDs. Report `ownedProcessIds` and `remainingOwnedProcessIds: []`; exit code alone is not cleanup evidence.

Require the exact route/theme/viewport matrix data, a validated `--scope` selector for focused page-family captures, deterministic offline fixtures before page load, stable `data-shell-view` and `data-nav-view` readiness hooks, console/did-fail-load/render-process-gone collection, normalized above-fold visible text, and screenshots produced only by real `webContents.capturePage()`. Unknown scopes fail before Electron launch. QA forces device scale factor 1 before app ready, uses `useContentSize: true`, calls `setContentSize`, and asserts inner width/height, `devicePixelRatio === 1`, and PNG pixel dimensions per cell. QA-only CSS disables animation/transition/caret; each scenario reloads/resets deterministic fixture state, waits for `document.fonts.ready` plus two animation frames, and clears focus/hover. Pixel variance rejects solid/transparent screenshots. Never use blanket `taskkill /IM electron.exe`.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-qa.test.ts tests\electron-smoke-contract.test.ts tests\smoke-signal-lifecycle.test.ts tests\process-runner.test.ts --pool=threads --maxWorkers=1
```

**Step 3: Implement the controlled production harness**

Add `qa:editorial` using `tsx`. The parent creates and authenticates the OS-temp run root/sentinel, launches the built production app with a real preload-enabled BrowserWindow, writes report/PNGs inside userData during capture, copies accepted artifacts to a separate OS-temp artifact directory after normal child exit and owned-PID audit, prints that path, and removes userData. No screenshots, reports, traces, or temporary scripts enter the repository.

Replace the CJS smoke parent with the same bounded lifecycle primitives without changing its six existing production assertions. The runner detects and reports JavaScript Playwright availability as an execution fact; the agent records Browser-plugin classification separately. Real Electron capturePage remains mandatory either way.

**Step 4: Run GREEN, build, and smoke**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-qa.test.ts tests\electron-smoke-contract.test.ts tests\smoke-signal-lifecycle.test.ts tests\process-runner.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run smoke:electron
git diff --check
```

**Step 5: Commit**

```powershell
git add electron/editorial-qa.ts scripts/editorial-qa-electron.ts scripts/smoke-electron.ts scripts/smoke-electron.cjs scripts/smoke-electron.ps1 package.json electron/main.ts src/shared/process-runner.ts tsconfig.scripts.json scripts/typecheck.ps1 tests/startup-script.test.ts tests/editorial-qa.test.ts tests/electron-smoke-contract.test.ts tests/smoke-signal-lifecycle.test.ts tests/process-runner.test.ts
git commit -m "test: add real electron editorial qa"
```

## Phase D: Accepted Editorial Workbench Visual Migration

### Task 43: Install Design Tokens And Fixed Media Canvas Ownership

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Create: `src/styles/components.css`
- Create: `src/styles/media-canvas.css`
- Create: `tests/editorial-theme-contract.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/styles.css`
- Modify: `src/app/App.tsx`
- Modify: `src/features/tasks/TaskDetailPage.tsx`
- Modify: `src/features/html-video/HtmlVideoPage.tsx`
- Modify: `src/features/labs/ImageLabPage.tsx`
- Modify: `src/features/labs/VoiceLabPage.tsx`
- Modify: `src/features/templates/DraftCanvas.tsx`
- Modify: `src/features/music-mv/MusicMvPage.tsx`
- Modify: `src/features/viral/ViralAnalyzerPage.tsx`
- Modify: `src/features/viral/ViralReport.tsx`

**Step 1: Write token and ownership RED tests**

Assert every approved light/dark shell token and fixed media token exists exactly once. Require `Segoe UI Variable` / `Microsoft YaHei UI`, weights 400/500, letter spacing 0, radius <=8px, semantic focus tokens, and no gradient-orb/bokeh decoration. Require deterministic `[data-media-canvas]` IDs on task detail, HTML, image, voice, draft canvas, Music MV timeline/audio, and Viral source/report media owners.

Computed QA must prove shell tokens change across themes while media background/surface/border/text/muted values do not; actual text pairs meet 4.5:1 and focus/non-text pairs meet 3:1. No unresolved CSS variable is allowed.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-theme-contract.test.ts tests\editorial-qa.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope theme-smoke
```

Expected: RED on the newly added computed token/media ownership assertions.

**Step 3: Implement the shared visual foundation**

Translate the accepted token table without warming/cooling the palette. Keep page sections unframed, use cards only for repeated records/modals/tools, and keep every image/video/HTML/draft/timeline/audio/report media canvas dark and unframed. Split global reset/tokens/components from the old stylesheet; feature CSS remains owned by lazy modules.

**Step 4: Run GREEN and focused Electron capture**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-theme-contract.test.ts tests\editorial-qa.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope theme-smoke
git diff --check
```

**Step 5: Commit**

```powershell
git add src/styles/tokens.css src/styles/base.css src/styles/components.css src/styles/media-canvas.css src/styles.css src/app/App.tsx src/features/tasks/TaskDetailPage.tsx src/features/html-video/HtmlVideoPage.tsx src/features/labs/ImageLabPage.tsx src/features/labs/VoiceLabPage.tsx src/features/templates/DraftCanvas.tsx src/features/music-mv/MusicMvPage.tsx src/features/viral/ViralAnalyzerPage.tsx src/features/viral/ViralReport.tsx tests/editorial-theme-contract.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: establish editorial workbench tokens"
```

### Task 44: Redesign The Shell And Compact Navigation Rail

**Files:**
- Create: `src/styles/shell.css`
- Create: `tests/editorial-shell-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/navigation.ts`
- Modify: `src/styles.css`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write shell RED contracts**

Require the independent new-task primary action, fifteen sidebar entries in approved order, recent-task access, save/path/browser status, theme control, and account/trial footer. At 1080x720 the sidebar becomes an icon rail with all fifteen tooltips; it never hides entries behind “更多”. Icon-only controls need aria-label plus tooltip. Stable shell/page dimensions prevent lazy/loading text from shifting layout.

Electron checks cover keyboard navigation, focus visibility, theme persistence, 0 horizontal overflow, 0 clipped controls, 0 incoherent overlap, and no relevant console/page/render errors at 1440x900 and 1080x720.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-shell-ui.test.ts tests\route-registry.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope shell
```

Expected: RED on shell geometry/navigation assertions against the pre-redesign shell.

**Step 3: Implement the approved shell**

Match the bright-neutral editorial shell and dark mapping: quiet separators, low shadow, tight control typography, balanced density, no nested cards, and Lucide icon treatment from the concepts. Do not add marketing copy or decorative badges.

**Step 4: Run GREEN and shell captures**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\editorial-shell-ui.test.ts tests\route-registry.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope shell
git diff --check
```

Compare both shell captures directly with the accepted new-task material concept before proceeding.

**Step 5: Commit**

```powershell
git add src/styles/shell.css src/app/AppShell.tsx src/app/navigation.ts src/styles.css tests/editorial-shell-ui.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: redesign the editorial workbench shell"
```

### Task 45: Redesign The Three-Stage New Task Workbench

**Files:**
- Create: `src/styles/features/new-task.css`
- Create: `tests/new-task-workbench-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/tasks/NewTaskPage.tsx`
- Modify: `tests/task-control-manifest.test.ts`
- Modify: `tests/task-create-input.test.ts`
- Modify: `tests/task-drafts.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write new-task RED contracts**

Require real Material, Creative, and Output tabs with state preserved across back/forward; a computed execution summary; all 51 manifest fields owned; template-driven track/prompt/style/draft/ratio linkage; manual overrides stable across refresh; AI selected-source provenance; real save/reopen/start draft; automatic title; and a real custom-pause step selector or removal of the duplicate custom option.

Responsive checks require the 1440 concepts for material/creative/output and the 1080 material concept. At compact width the summary moves below the editor; no primary control clips, wraps incoherently, or changes parent dimensions.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\new-task-workbench-ui.test.ts tests\task-control-manifest.test.ts tests\task-create-input.test.ts tests\task-drafts.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope new-task
```

Expected: RED on the new three-state geometry/copy/responsive assertions.

**Step 3: Implement concept-faithful stages**

Move every existing control into the manifest-declared location without renaming or dropping its value. Use segmented controls, toggles, steppers/inputs, menus, and swatches according to control type. Keep display copy and hierarchy limited to the accepted concepts and functional labels. Import `new-task.css` only from the lazy page module.

**Step 4: Run GREEN and four accepted-state captures**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\new-task-workbench-ui.test.ts tests\task-control-manifest.test.ts tests\task-create-input.test.ts tests\task-drafts.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope new-task
git diff --check
```

Use `view_image` on each accepted new-task PNG and its fresh Electron capture. Fix copy, geometry, typography, density, controls, and responsive drift before commit.

**Step 5: Commit**

```powershell
git add src/styles/features/new-task.css src/features/tasks/NewTaskPage.tsx tests/new-task-workbench-ui.test.ts tests/task-control-manifest.test.ts tests/task-create-input.test.ts tests/task-drafts.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: redesign the new task workbench"
```

### Task 46: Redesign Queue, History, And Task Detail

**Files:**
- Create: `src/styles/features/task-operations.css`
- Create: `tests/task-operations-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/tasks/QueuePage.tsx`
- Modify: `src/features/tasks/HistoryPage.tsx`
- Modify: `src/features/tasks/TaskDetailPage.tsx`
- Modify: `src/features/tasks/TaskArtifactPreview.tsx`
- Modify: `src/features/history/HistoryFilterBar.tsx`
- Modify: `src/features/history/HistoryRowActions.tsx`
- Modify: `tests/history-page-store.test.ts`
- Modify: `tests/history-governance-ui.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write operations RED contracts**

Reassert the already-green working-status counts, independent cursor pages, resume/retry/cancel semantics, history governance, complete detail event pagination, seven ordinary stages, Step 4 fifth-position mapping, HTML six stages, and true clip-only terminal stage. The new RED scope is queue/history/detail layout, responsive density, and rendered interactions only.

Require table/list density from the concepts; compact layout hides only designated secondary columns and never converts governance tables into cards. Selected detail survives valid updates and closes/selects adjacent on tombstone.

The Electron scenario opens the permanent-delete dialog from an archived fixture without confirming deletion, verifies initial focus, forward/backward Tab wrap, Escape close, and focus restoration to the invoking row action.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-operations-ui.test.ts tests\history-page-store.test.ts tests\history-governance-ui.test.ts tests\task-list-pagination-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope task-operations
```

Expected: RED on the new queue/history/detail render assertions.

**Step 3: Implement the three approved states**

Match queue, history, and detail concepts with shared table/pagination/timeline primitives. Keep detail media inside fixed dark canvas tokens. Preserve every already-green action and add no decorative nested cards; this task does not change task-operation contracts.

**Step 4: Run GREEN and accepted-state captures**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\task-operations-ui.test.ts tests\history-page-store.test.ts tests\history-governance-ui.test.ts tests\task-list-pagination-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope task-operations
git diff --check
```

Use `view_image` on queue, history, and task-detail concept/capture pairs before commit.

**Step 5: Commit**

```powershell
git add src/styles/features/task-operations.css src/features/tasks/QueuePage.tsx src/features/tasks/HistoryPage.tsx src/features/tasks/TaskDetailPage.tsx src/features/tasks/TaskArtifactPreview.tsx src/features/history/HistoryFilterBar.tsx src/features/history/HistoryRowActions.tsx tests/task-operations-ui.test.ts tests/history-page-store.test.ts tests/history-governance-ui.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: redesign task operations surfaces"
```

### Task 47: Redesign The HTML Video Studio

**Files:**
- Create: `src/styles/features/html-video.css`
- Create: `tests/html-video-studio-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/html-video/HtmlVideoPage.tsx`
- Modify: `src/features/html-video/HtmlVideoTabPanel.tsx`
- Modify: `tests/html-video-control-manifest.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write studio RED contracts**

Require left parameters, fixed dark canvas/timeline, and right six-step run rail; independently paged task selector; all 17 manifest fields; honest read-only availability; stage/tab mapping; media load/play/seek/error states; pause/resume/retry/recovery; cover inspector under render; and `x/6`. At compact size regions stack parameters, canvas, then run rail.

Theme switching must change shell chrome but produce byte-identical 4px-inset media canvas pixels, timeline colors, default zoom/pan, and dimensions for deterministic fixture data.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-studio-ui.test.ts tests\html-video-control-manifest.test.ts tests\html-video.test.ts tests\html-video-electron.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope html-video
```

Expected: RED on the new studio layout/media invariance assertions.

**Step 3: Implement the accepted studio**

Match the concept's compact professional chrome and unframed canvas. Use the manifest to render editable versus read-only fields; never drop a compatibility value. Media controls update real local state and frame/progress, not fake progress.

**Step 4: Run GREEN, smoke, and concept capture**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\html-video-studio-ui.test.ts tests\html-video-control-manifest.test.ts tests\html-video.test.ts tests\html-video-electron.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run smoke:html-video
npm.cmd run qa:editorial -- --scope html-video
git diff --check
```

Use `view_image` on the HTML studio concept and fresh light capture; inspect the corresponding dark capture for media pixel equality.

**Step 5: Commit**

```powershell
git add src/styles/features/html-video.css src/features/html-video/HtmlVideoPage.tsx src/features/html-video/HtmlVideoTabPanel.tsx tests/html-video-studio-ui.test.ts tests/html-video-control-manifest.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: redesign the html video studio"
```

### Task 48: Redesign Local Tools, Image Lab, And Voice Lab

**Files:**
- Create: `src/styles/features/local-labs.css`
- Create: `tests/local-labs-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/labs/BookSelectionPage.tsx`
- Modify: `src/features/labs/BenchmarkImportPage.tsx`
- Modify: `src/features/labs/PersonAssetsPage.tsx`
- Modify: `src/features/labs/ImageLabPage.tsx`
- Modify: `src/features/labs/VoiceLabPage.tsx`
- Modify: `tests/image-lab.test.ts`
- Modify: `tests/person-assets.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write lab parity RED tests**

Reassert the already-green atomic book identity update, every product field, and product/reference handoff. Benchmark persists source and keyword. Person library keeps folder/images/preflight. Image Lab preserves all seven smart modes, prompt/reference/provider/style/ratio/planning/batch/cost semantics, successful and failed history, media errors, and governance. Voice Lab preserves provider/voice/text/speed/playback, failed history, clone selection, and governance.

Require dense open layouts rather than card walls, stable media dimensions, real image/audio elements, and fixed dark media pixels in both themes for image and voice surfaces.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\local-labs-ui.test.ts tests\image-lab.test.ts tests\person-assets.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\history-governance-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope local-labs
```

Expected: RED on the new local/lab layout and media assertions.

**Step 3: Implement the shared local/lab visual family**

Use tables/lists for records, unframed media workspaces, compact form bands, and existing Lucide icons. Keep every parameter and already-green action; surface actionable media errors instead of placeholders or fake progress. Import the feature stylesheet only from these lazy modules.

**Step 4: Run GREEN and route captures**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\local-labs-ui.test.ts tests\image-lab.test.ts tests\person-assets.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\history-governance-ui.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope local-labs
git diff --check
```

**Step 5: Commit**

```powershell
git add src/styles/features/local-labs.css src/features/labs/BookSelectionPage.tsx src/features/labs/BenchmarkImportPage.tsx src/features/labs/PersonAssetsPage.tsx src/features/labs/ImageLabPage.tsx src/features/labs/VoiceLabPage.tsx tests/local-labs-ui.test.ts tests/image-lab.test.ts tests/person-assets.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: redesign local and lab surfaces"
```

### Task 49: Redesign Music MV

**Files:**
- Create: `src/styles/features/music-mv.css`
- Create: `tests/music-mv-workbench-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/music-mv/MusicMvPage.tsx`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write Music MV workbench UI RED tests**

Reassert the already-green audio preflight, lyric synchronization, requested scene count, BGM, selected draft template, ratio/canvas, caption style, native timeline tracks, provider errors, and visible export result. The new RED scope is the accepted workbench layout and rendered interaction; runtime behavior is not changed here. Require stable `music-mv-timeline` and `music-mv-audio` media-canvas IDs, fixed dark computed tokens in both shell themes, and byte-identical deterministic 4px-inset subregion captures across light/dark.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\music-mv-workbench-ui.test.ts tests\runner.test.ts tests\draft.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope music-mv
```

Expected: runtime consumer assertions remain GREEN from Task 27; RED only on the new Music MV layout, responsive, keyboard, and rendered-interaction assertions.

**Step 3: Migrate the already-functional Music MV controls**

Implement the restrained editorial workflow layout around the already-green consumers. Use real audio states and native timeline tracks, and retain the Task 43 fixed-dark media token contract for both timeline and audio surfaces regardless of shell theme.

**Step 4: Run GREEN and route captures**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\music-mv-workbench-ui.test.ts tests\runner.test.ts tests\draft.test.ts tests\jianying-bridge.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope music-mv
git diff --check
```

**Step 5: Commit**

```powershell
git add src/styles/features/music-mv.css src/features/music-mv/MusicMvPage.tsx tests/music-mv-workbench-ui.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "feat: complete the music mv workbench"
```

### Task 50: Redesign The Viral Analysis Workbench

**Files:**
- Create: `src/styles/features/viral-analysis.css`
- Create: `tests/viral-analysis-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/viral/ViralAnalyzerPage.tsx`
- Modify: `src/features/viral/ViralReport.tsx`
- Modify: `tests/viral-analysis.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write viral workbench UI RED tests**

Reassert the already-green cursor-paged events/report, lifecycle/recovery, isolated settings, media/report errors, atomic template save, production-task handoff, and governed active/archived behavior. The new RED scope is the accepted analyzer/report layout and rendered interaction only. Require stable `viral-source-media` and `viral-report-media` canvas IDs, fixed dark computed tokens in both shell themes, and byte-identical deterministic 4px-inset subregion captures across light/dark.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\viral-analysis-ui.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\viral-analysis.test.ts tests\viral-runtime.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope viral-analysis
```

Expected: lifecycle/pagination assertions remain GREEN from Task 28; RED only on the new viral analyzer/report layout, responsive, keyboard, and rendered-interaction assertions.

**Step 3: Migrate the already-functional viral workbench**

Implement the editorial report/workbench layout with real media/error states and the already-green governed row actions. Retain the Task 43 fixed-dark media token contract for source and report media regardless of shell theme. Do not alter lifecycle or API contracts in this visual task.

**Step 4: Run GREEN, both typechecks, and route QA**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\viral-analysis-ui.test.ts tests\storage.test.ts tests\ipc-contract.test.ts tests\ipc-inventory.test.ts tests\electron-ipc-contract.test.ts tests\viral-analysis.test.ts tests\viral-runtime.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope viral-analysis
git diff --check
```

**Step 5: Commit**

```powershell
git add src/styles/features/viral-analysis.css src/features/viral/ViralAnalyzerPage.tsx src/features/viral/ViralReport.tsx tests/viral-analysis-ui.test.ts tests/viral-analysis.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: redesign the viral analysis workbench"
```

### Task 51: Redesign Prompt And Draft Template Workbenches

**Files:**
- Create: `src/styles/features/templates.css`
- Create: `tests/template-workbenches-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/templates/PromptTemplatesPage.tsx`
- Modify: `src/features/templates/PromptTemplateEditor.tsx`
- Modify: `src/features/templates/DraftTemplatesPage.tsx`
- Modify: `src/features/templates/DraftCanvas.tsx`
- Modify: `tests/prompt-templates.test.ts`
- Modify: `tests/draft-template-normalization.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write template parity RED tests**

Prompt workbench must match the accepted list/editor concept and keep summary/detail loading, every prompt/template/style field, variables, step prompts, import/export, create/duplicate/delete/reset, track/style/draft defaults, and lazy corpus behavior. Draft workbench keeps every layer/property, coordinates/scaling, background/colors/ranges, 124 animations, effect catalog, BGM, Coze imports, diagnostics, and unsaved state.

Reassert the already-green strict DraftTemplate nested contract and complete CustomCoverTemplate 10-field and MiniMax clone-voice 5-field round trips while moving the template UI. This visual task does not redefine those security schemas.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\template-workbenches-ui.test.ts tests\ipc-contract.test.ts tests\prompt-templates.test.ts tests\draft-template-normalization.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope templates
```

Expected: RED on the new prompt/draft workbench render assertions.

**Step 3: Implement list/editor/canvas layouts**

Use the accepted prompt table and side editor, with no corpus in the entry chunk. Keep draft canvas fixed dark, unframed, and pixel-stable across themes; the inspector may use collapsible sections but cannot delete or truncate controls/options.

**Step 4: Run GREEN and concept captures**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\template-workbenches-ui.test.ts tests\ipc-contract.test.ts tests\prompt-templates.test.ts tests\draft-template-normalization.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope templates
git diff --check
```

Use `view_image` on the prompt-template concept and fresh light capture. Compare the draft canvas light/dark media interior byte-for-byte.

**Step 5: Commit**

```powershell
git add src/styles/features/templates.css src/features/templates/PromptTemplatesPage.tsx src/features/templates/PromptTemplateEditor.tsx src/features/templates/DraftTemplatesPage.tsx src/features/templates/DraftCanvas.tsx tests/template-workbenches-ui.test.ts tests/prompt-templates.test.ts tests/draft-template-normalization.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "style: redesign template workbenches"
```

### Task 52: Redesign Settings, Account, And Activation

**Files:**
- Create: `src/styles/features/system-pages.css`
- Create: `tests/system-pages-ui.test.ts`
- Modify: `electron/editorial-qa.ts`
- Modify: `scripts/editorial-qa-electron.ts`
- Modify: `tests/editorial-qa.test.ts`
- Modify: `src/features/settings/SettingsPage.tsx`
- Modify: `src/features/settings/ProviderProfileManagers.tsx`
- Modify: `src/features/account/AccountPage.tsx`
- Modify: `src/features/account/ActivationPage.tsx`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write system behavior RED tests**

Assert full AppConfig top-level/nested round-trip and all provider/profile parameters. Reassert the now-real IMA test/fetch and governed cleanup actions, including success/failure details. Settings counts use real totalCount APIs, not a 100-row bootstrap projection.

Account validates email while preserving compatible legacy values, derives avatar, keeps device/balance read-only, and renders real credit transactions. Activation enforces legal plan/status transitions, invalid/expired dates clamp remaining days to 0, and sidebar/page use the same helper. Test complete five-field clone voice and ten-field cover template persistence through config/profile saves and lazy unmounts.

**Step 2: Run RED**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\system-pages-ui.test.ts tests\ima-knowledge.test.ts tests\config-utils.test.ts tests\provider-profile-utils.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-storage.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
npm.cmd run build
npm.cmd run qa:editorial -- --scope system-pages
```

Expected: RED on the new settings/account/activation render assertions.

**Step 3: Implement real actions and restrained system layouts**

Use quiet form bands, tabs for settings views, dense profile rows, and explicit save/test states around the already-green actions. Do not expose or log secret values. Keep every parameter and route; this task changes presentation/interaction composition only.

**Step 4: Run GREEN and system route captures**

```powershell
scripts\run-npm-node.cmd node_modules\vitest\vitest.mjs run tests\system-pages-ui.test.ts tests\ima-knowledge.test.ts tests\config-utils.test.ts tests\provider-profile-utils.test.ts tests\electron-ipc-contract.test.ts tests\product-shell-storage.test.ts tests\product-shell-ui.test.ts --pool=threads --maxWorkers=1
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
scripts\run-npm-node.cmd node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
npm.cmd run typecheck
npm.cmd run build
npm.cmd run qa:editorial -- --scope system-pages
git diff --check
```

**Step 5: Commit**

```powershell
git add src/styles/features/system-pages.css src/features/settings/SettingsPage.tsx src/features/settings/ProviderProfileManagers.tsx src/features/account/AccountPage.tsx src/features/account/ActivationPage.tsx tests/system-pages-ui.test.ts tests/product-shell-ui.test.ts electron/editorial-qa.ts scripts/editorial-qa-electron.ts tests/editorial-qa.test.ts
git commit -m "feat: complete editorial system pages"
```

## Phase E: Full Fidelity And Release Gate

### Task 53: Close The 67-Capture Parity Matrix

**Files:**
- Create: `docs/plans/2026-07-14-storydream-editorial-workbench-fidelity-ledger.md`

**Step 1: Run the exact production visual matrix**

Run the exact required set of 67 unique capture IDs: 15 sidebar views (`book-selection`, `benchmark`, `person-assets`, `queue`, `history`, `image-lab`, `voice-lab`, `music-mv`, `viral-analyzer`, `prompt-templates`, `draft-templates`, `settings`, `account`, `activation`, `html-video`) x both themes x 1440x900 and 1080x720 = 60; four light new-task IDs (material/creative/output at 1440x900 plus material at 1080x720); task-detail light/dark at 1440x900; and `new-task/material/dark/1440x900`. Supplemental diagnostic captures are recorded separately, so the ledger reports `67/67 required; N supplemental`.

```powershell
npm.cmd run build
npm.cmd run qa:editorial
```

Every cell must report route identity, meaningful nonblank DOM, no framework overlay, zero relevant console/page/render errors, zero horizontal overflow, zero clipped controls, zero incoherent interactive overlap, zero unresolved tokens, zero icon-only aria/tooltip gaps, text contrast >=4.5:1, focus/non-text contrast >=3:1, correct nonblank PNG dimensions, and one non-destructive interaction with state proof.

**Step 2: Verify theme/media/progress invariants**

Compare 4px-inset deterministic `[data-media-canvas]` bitmaps for the exact IDs `task-detail`, `html-video`, `image-lab`, `voice-lab`, `draft-canvas`, `music-mv-timeline`, `music-mv-audio`, `viral-source-media`, and `viral-report-media` across light/dark; require byte identity while shell tokens differ. Assert ordinary task surfaces use `x/7`, HTML uses `x/6`, and clip-only stops at its real terminal step.

Use `view_image` on all nine accepted concept PNGs and their matching fresh captures in the same QA pass. For each pair record at least copy, layout, typography, palette, icon treatment, spacing/container model, responsive behavior, media treatment, and interaction state. Compare normalized visible text and order from the QA report against the stable copy inventory keyed by those nine capture IDs. Any agency-review comment becomes a repair, not an undocumented exception.

**Step 3: Fix every observed mismatch with RED-first regression coverage**

For each behavior or layout defect, first add a numbered repair subtask to the planning log naming the exact production and test files. Add the smallest failing focused test or QA assertion, observe RED, implement and commit that exact repair scope, rerun the focused suite/capture, then repeat the complete matrix. Do not loosen thresholds, hide controls, reduce parameters, widen timeouts, or mark a fixable drift intentional. Task 53 itself owns only the final ledger.

**Step 4: Run the final release gate in order**

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:electron
npm.cmd run smoke:html-video
npm.cmd run qa:editorial
```

Record exact test counts, entry filename/raw bytes, `67/67 required; N supplemental`, nine concept pair results/copy diffs, contrast minima, media bitmap equality, zero error counts, Browser-plugin classification, detected JavaScript Playwright availability, owned/remaining Electron PID arrays, temporary userData removal, OS-temp artifact/report path, and SHA-256 values in the fidelity ledger. Mark pages without dedicated concepts as `spec/token/component-derived`, never as pixel parity. Do not commit production screenshots or QA reports.

After writing the ledger, run:

```powershell
git diff --check
git diff --check -- docs/plans/2026-07-14-storydream-editorial-workbench-fidelity-ledger.md
git status --short
```

**Step 5: Commit the verified ledger**

Commit every RED-first parity repair with its exact affected paths before rerunning the complete release gate. Once the gate is green and the only new final artifact is the ledger:

```powershell
git add docs/plans/2026-07-14-storydream-editorial-workbench-fidelity-ledger.md
git diff --cached --check
$staged = @(git diff --cached --name-only)
if ($staged.Count -ne 1 -or $staged[0] -ne 'docs/plans/2026-07-14-storydream-editorial-workbench-fidelity-ledger.md') { throw "Unexpected staged paths: $staged" }
git commit -m "docs: record editorial workbench verification"
```

After the commit, rerun `git status --short` and confirm planning logs plus `src/shared/__pycache__/` remain outside product commits. Use `@superpowers:finishing-a-development-branch` only after every gate above is fresh and green.
