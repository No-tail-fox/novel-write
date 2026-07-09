# Storybound Latest Practical Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the approved practical subset of the latest Storybound features: rewrite controls, local person materials, local book-selection/product handoff, and local benchmark import.

**Architecture:** Extend the existing React + Electron + sql.js app without adding a new framework. Store new task fields in `tasks`, store book selections in a local SQLite table, store person material images under the Electron app data directory, and keep private Storybound remote APIs out of scope.

**Tech Stack:** React 19, Vite, Electron IPC, sql.js, Vitest, Node fs/path APIs.

---

### Task 1: Extend Types And Storage Contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Test: `tests/storage.test.ts`

**Step 1: Write the failing storage tests**

In `tests/storage.test.ts`, extend the existing schema test to require the latest columns and `book_selection` table:

```ts
expect(tables).toEqual(expect.arrayContaining([
  'book_selection',
]));

expect(taskColumns).toEqual(expect.arrayContaining([
  'product_info',
  'material_person',
  'draft_dir',
  'fixed_intro',
  'outro_cta',
  'lock_intro_sentences',
]));
```

Add a create/read roundtrip test:

```ts
it('persists latest Storybound task controls and product fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'storybound-db-latest-fields-'));
  const file = join(dir, 'app.db');
  try {
    const db = await FileDatabase.open(file);
    await db.createTask({
      title: 'Latest controls',
      inputText: '原始文案',
      productInfo: JSON.stringify({ name: '额尔古纳河右岸', sellpt: '民族史诗' }),
      materialSource: 'local',
      materialPerson: '迟子建',
      draftDir: 'D:/drafts/latest',
      fixedIntro: '今天先别急着划走。',
      outroCta: '想看{主角}，去橱窗找这本书。',
      lockIntroSentences: 3,
    });

    const task = (await db.getState()).tasks[0];
    expect(task).toMatchObject({
      productInfo: JSON.stringify({ name: '额尔古纳河右岸', sellpt: '民族史诗' }),
      materialSource: 'local',
      materialPerson: '迟子建',
      draftDir: 'D:/drafts/latest',
      fixedIntro: '今天先别急着划走。',
      outroCta: '想看{主角}，去橱窗找这本书。',
      lockIntroSentences: 3,
    });
    await db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Add a `book_selection` persistence test:

```ts
it('persists local book selection records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'storybound-book-selection-'));
  const db = await FileDatabase.open(join(dir, 'app.db'));
  try {
    await db.upsertBookSelection({
      theme: '文学',
      bookId: 'erguna',
      data: {
        name: '额尔古纳河右岸',
        author: '迟子建',
        keyword: '鄂温克',
        sellPoint: '民族迁徙与女性命运',
      },
    });
    const rows = await db.listBookSelections();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ theme: '文学', bookId: 'erguna' });
    expect(rows[0].data).toMatchObject({ name: '额尔古纳河右岸' });
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Run tests to verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts
```

Expected: FAIL because the new columns/table/methods/types do not exist.

**Step 3: Extend TypeScript types**

In `src/shared/types.ts`:

- Add shell views:

```ts
| 'book-selection'
| 'benchmark'
| 'person-assets'
```

- Add product/person fields to `Task`:

```ts
productInfo?: string | null;
materialPerson?: string | null;
draftDir?: string | null;
fixedIntro?: string | null;
outroCta?: string | null;
lockIntroSentences?: number;
```

- Add them to `CreateTaskInput` pick list.

- Add book selection types:

```ts
export interface BookProductInfo {
  name: string;
  author?: string;
  category?: string;
  keyword?: string;
  sellPoint?: string;
  audience?: string;
  persons?: string;
  era?: string;
  price?: string;
  url?: string;
  note?: string;
  coverPath?: string;
  materialFolder?: string;
}

export interface BookSelectionRecord {
  theme: string;
  bookId: string;
  data: BookProductInfo;
  updatedAt: number;
}

export interface BookSelectionInput {
  theme: string;
  bookId?: string;
  data: BookProductInfo;
}
```

**Step 4: Extend SQLite migration**

In `src/shared/storage.ts`:

- Add columns to the `CREATE TABLE IF NOT EXISTS tasks` block.
- Add `CREATE TABLE IF NOT EXISTS book_selection`.
- Add migration column entries:

```ts
['product_info', 'TEXT'],
['material_person', 'TEXT'],
['draft_dir', 'TEXT'],
['fixed_intro', 'TEXT'],
['outro_cta', 'TEXT'],
['lock_intro_sentences', 'INTEGER DEFAULT 0'],
```

**Step 5: Extend create/read/write methods**

In `createTask`, set defaults:

```ts
productInfo: input.productInfo ?? null,
materialPerson: input.materialPerson ?? null,
draftDir: input.draftDir ?? null,
fixedIntro: input.fixedIntro ?? null,
outroCta: input.outroCta ?? null,
lockIntroSentences: normalizeLockIntroSentences(input.lockIntroSentences),
```

Add the columns to the `INSERT INTO tasks` statement and value array.

In `rowToTask`, read the fields:

```ts
productInfo: row.product_info == null ? null : String(row.product_info),
materialPerson: row.material_person == null ? null : String(row.material_person),
draftDir: row.draft_dir == null ? null : String(row.draft_dir),
fixedIntro: row.fixed_intro == null ? null : String(row.fixed_intro),
outroCta: row.outro_cta == null ? null : String(row.outro_cta),
lockIntroSentences: normalizeLockIntroSentences(row.lock_intro_sentences),
```

Add private helper:

```ts
function normalizeLockIntroSentences(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(20, Math.max(0, Math.trunc(n)));
}
```

Add DB methods:

```ts
async listBookSelections(theme?: string): Promise<BookSelectionRecord[]> { ... }
async upsertBookSelection(input: BookSelectionInput): Promise<BookSelectionRecord> { ... }
async deleteBookSelection(theme: string, bookId: string): Promise<void> { ... }
```

Use `randomUUID()` for `bookId` when absent and store `data` as JSON.

**Step 6: Run storage tests**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src/shared/types.ts src/shared/storage.ts tests/storage.test.ts
git commit -m "feat: add latest storybound storage fields"
```

---

### Task 2: Add Rewrite Controls And Product Prompting

**Files:**
- Modify: `src/shared/runner.ts`
- Test: `tests/runner.test.ts`

**Step 1: Write failing runner tests**

Add tests that run `runTask` with mocked LLM/media providers.

Test fixed intro/outro:

```ts
it('applies fixed intro and outro after rewrite without asking the LLM to rewrite them', async () => {
  const task = await db.createTask({
    inputText: '她从北方森林里走出来。后来她写下民族迁徙。',
    fixedIntro: '今天这本书，先看第一句话。',
    outroCta: '想读{主角}，去橱窗找这本书。',
  });
  // mock review -> reviewed text; rewrite rounds -> 'AI 改写主体'; cover -> title '额尔古纳河右岸'
  await runTask(...);
  const copy = await readFile(join(dir, 'tasks', task.id, '01-rewritten-copy.md'), 'utf8');
  expect(copy).toContain('今天这本书，先看第一句话。');
  expect(copy).toContain('AI 改写主体');
  expect(copy).toContain('想读额尔古纳河右岸，去橱窗找这本书。');
  const rewritePrompts = requests.filter((request) => request.name.startsWith('rewrite-round-'));
  expect(rewritePrompts.map((request) => request.messages.map((m) => m.content).join('\n')).join('\n')).not.toContain('今天这本书，先看第一句话。');
});
```

Test locked intro:

```ts
it('locks the first reviewed sentences and rewrites only the remainder', async () => {
  const reviewed = '第一句必须保留。第二句也保留。第三句进入改写。第四句继续改写。';
  const task = await db.createTask({ inputText: reviewed, lockIntroSentences: 2 });
  await runTask(...);
  const firstRewritePrompt = requests.find((request) => request.name === 'rewrite-round-1')!;
  const promptText = firstRewritePrompt.messages.map((m) => m.content).join('\n');
  expect(promptText).not.toContain('第一句必须保留。第二句也保留。');
  expect(promptText).toContain('第三句进入改写。第四句继续改写。');
  const copy = await readFile(join(dir, 'tasks', task.id, '01-rewritten-copy.md'), 'utf8');
  expect(copy.startsWith('第一句必须保留。第二句也保留。')).toBe(true);
});
```

Test product info:

```ts
it('injects product info into rewrite prompts and keeps promotion enabled', async () => {
  const productInfo = JSON.stringify({ name: '额尔古纳河右岸', author: '迟子建', sellPoint: '民族史诗' });
  const task = await db.createTask({ inputText: sampleInput, productInfo, keepPromotion: false });
  await runTask(...);
  const promptText = requests.filter((request) => request.name.startsWith('rewrite-round-')).map((request) => request.messages.map((m) => m.content).join('\n')).join('\n');
  expect(promptText).toContain('本视频带货商品');
  expect(promptText).toContain('额尔古纳河右岸');
  expect(promptText).toContain('民族史诗');
});
```

**Step 2: Run tests to verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "fixed intro|locks the first|product info"
```

Expected: FAIL.

**Step 3: Add helper functions in `runner.ts`**

Add near the rewrite helpers:

```ts
interface RewriteControlPlan {
  reviewedTextForRewrite: string;
  lockedIntro: string;
}

function prepareRewriteControls(task: Task, reviewedText: string): RewriteControlPlan {
  if ((task.scriptFormat ?? 'narration') === 'dialogue') {
    return { reviewedTextForRewrite: reviewedText, lockedIntro: '' };
  }
  const lockCount = Math.min(20, Math.max(0, Math.trunc(Number(task.lockIntroSentences ?? 0))));
  if (lockCount <= 0) return { reviewedTextForRewrite: reviewedText, lockedIntro: '' };
  const { locked, rest } = splitLeadingSentences(reviewedText, lockCount);
  return {
    reviewedTextForRewrite: rest.trim() || reviewedText,
    lockedIntro: (task.fixedIntro?.trim() || locked).trim(),
  };
}

function splitLeadingSentences(text: string, count: number): { locked: string; rest: string } {
  const matches = [...text.matchAll(/[^。！？!?；;]+[。！？!?；;]?/g)];
  if (matches.length === 0) return { locked: '', rest: text };
  const locked = matches.slice(0, count).map((m) => m[0]).join('').trim();
  const rest = text.slice(locked.length).trim();
  return { locked, rest };
}

function productInfoRewriteBlock(task: Task): string {
  if (!task.productInfo) return '';
  try {
    const info = JSON.parse(task.productInfo) as { name?: string; author?: string; category?: string; sellPoint?: string; audience?: string; persons?: string; era?: string };
    if (!info?.name) return '';
    return joinPromptBlocks([
      '本视频带货商品：',
      `书名/商品名：${info.name}`,
      info.author ? `作者：${info.author}` : '',
      info.category ? `品类：${info.category}` : '',
      info.sellPoint ? `核心卖点：${info.sellPoint}` : '',
      info.audience ? `目标人群：${info.audience}` : '',
      info.persons || info.era ? `相关信息：${[info.persons, info.era].filter(Boolean).join(' · ')}` : '',
      '要求：内容自然服务于种草和推荐，不夸大，不虚构商品事实。',
    ]);
  } catch {
    return '';
  }
}

function applyFinalRewriteControls(copy: string, task: Task, coverTitle: string, lockedIntro: string): string {
  if ((task.scriptFormat ?? 'narration') === 'dialogue') return copy;
  const intro = lockedIntro || task.fixedIntro?.trim() || '';
  const outro = task.outroCta?.trim().replace(/\{主角\}/g, coverTitle || task.title || '主角') || '';
  return [intro, copy.trim(), outro].filter(Boolean).join('\n\n');
}
```

**Step 4: Wire helpers into Step 1**

Before calling `runRewriteRounds`, compute:

```ts
const controlPlan = prepareRewriteControls(task, requireString(pipeline.artifact.reviewedText, 'reviewedText'));
```

Pass `controlPlan.reviewedTextForRewrite` to `runRewriteRounds`.

After `generateCoverMetadata`, apply:

```ts
pipeline.artifact.rewrittenCopy = applyFinalRewriteControls(
  rewrite.rewrittenCopy,
  task,
  pipeline.artifact.cover.title,
  controlPlan.lockedIntro,
);
```

In `buildRewriteRoundPrompt` and `buildRewriteEvaluationPrompt`, include `productInfoRewriteBlock(input.task)` before general rewrite instructions.

**Step 5: Run runner tests**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "fixed intro|locks the first|product info"
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/shared/runner.ts tests/runner.test.ts
git commit -m "feat: add rewrite control trio"
```

---

### Task 3: Add Person Assets And Local Material Step 4

**Files:**
- Create: `src/shared/person-assets.ts`
- Modify: `src/shared/runner.ts`
- Test: `tests/person-assets.test.ts`
- Test: `tests/runner.test.ts`

**Step 1: Write failing helper tests**

Create `tests/person-assets.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyPersonMaterialsForScenes, createPersonAsset, importPersonAssetFiles, listPersonAssets, listPersonImages } from '@shared/person-assets';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3q/QAAAABJRU5ErkJggg==', 'base64');

describe('person assets', () => {
  it('creates a person, imports images, and copies them over storyboard scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'person-assets-'));
    try {
      const source = join(dir, 'source.png');
      await writeFile(source, tinyPng);
      await createPersonAsset(dir, '迟子建');
      await importPersonAssetFiles(dir, '迟子建', [source]);
      expect(await listPersonAssets(dir)).toEqual([expect.objectContaining({ name: '迟子建', count: 1 })]);
      expect(await listPersonImages(dir, '迟子建')).toHaveLength(1);

      const taskDir = join(dir, 'task');
      const result = await copyPersonMaterialsForScenes({
        rootDir: dir,
        person: '迟子建',
        scenes: [{ id: 1, cap: '一', narration: '一', durationMs: 1000 }, { id: 2, cap: '二', narration: '二', durationMs: 1000 }],
        taskDir,
        ratio: '9:16',
      });

      expect(result.assets).toEqual([
        expect.objectContaining({ sceneId: 1 }),
        expect.objectContaining({ sceneId: 2 }),
      ]);
      const meta = JSON.parse(await readFile(join(taskDir, '04-local-meta.json'), 'utf8'));
      expect(meta).toMatchObject({ version: 1, person: '迟子建' });
      expect(Object.keys(meta.origins)).toEqual(['1', '2']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

**Step 2: Write failing runner test**

In `tests/runner.test.ts`, add:

```ts
it('uses local person materials instead of AI image generation when materialSource is local', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'storybound-runner-local-materials-'));
  const db = await FileDatabase.open(join(dir, 'data.db'));
  try {
    const personRoot = join(dir, 'person-assets');
    await createPersonAsset(personRoot, '迟子建');
    const imagePath = join(dir, 'source.png');
    await writeFile(imagePath, tinyPng);
    await importPersonAssetFiles(personRoot, '迟子建', [imagePath]);

    const task = await db.createTask({
      title: 'Local materials',
      inputText: sampleInput,
      materialSource: 'local',
      materialPerson: '迟子建',
    });

    await runTask(db, task, {
      appDataDir: dir,
      generatePipelineArtifact: async () => makeArtifact(),
      synthesizeNarration: async (scenes) => writeSceneAssets(join(dir, 'media'), scenes, 'wav', wavTone(1200)),
      draftWriterOptions: { runBridge: fakeBridge },
      generateImages: async () => {
        throw new Error('AI image generation should not be called');
      },
    });

    const meta = JSON.parse(await readFile(join(dir, 'tasks', task.id, '04-local-meta.json'), 'utf8'));
    expect(meta.person).toBe('迟子建');
    expect((await db.getState()).tasks[0].status).toBe('completed');
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
```

**Step 3: Run tests to verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/person-assets.test.ts
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "local person materials"
```

Expected: FAIL.

**Step 4: Implement `src/shared/person-assets.ts`**

Implement:

```ts
export interface PersonAssetSummary { name: string; count: number; dir: string; updatedAt: number; }
export interface PersonAssetImage { name: string; path: string; updatedAt: number; }
export interface LocalMaterialCopyResult { assets: SceneAsset[]; origins: Record<string, string>; }
```

Functions:

```ts
export function sanitizePersonName(name: string): string { ... }
export async function createPersonAsset(rootDir: string, name: string): Promise<PersonAssetSummary> { ... }
export async function listPersonAssets(rootDir: string): Promise<PersonAssetSummary[]> { ... }
export async function listPersonImages(rootDir: string, person: string): Promise<PersonAssetImage[]> { ... }
export async function importPersonAssetFiles(rootDir: string, person: string, sourcePaths: string[]): Promise<number> { ... }
export async function renamePersonAsset(rootDir: string, oldName: string, newName: string): Promise<string> { ... }
export async function deletePersonAsset(rootDir: string, person: string): Promise<void> { ... }
export async function copyPersonMaterialsForScenes(input: { rootDir: string; person: string; scenes: StoryboardScene[]; taskDir: string; ratio: string; signal?: AbortSignal }): Promise<LocalMaterialCopyResult> { ... }
```

Implementation notes:

- Accept only `.jpg`, `.jpeg`, `.png`, `.webp`.
- Use `copyFile` for the first implementation; no new image-processing dependency.
- Write copied images to `taskDir/images/<sceneId><ext>`.
- Write `taskDir/04-local-meta.json`.
- Throw `人物素材库中「${person}」没有图片` when empty.

**Step 5: Wire into `ensureImages`**

In `src/shared/runner.ts`:

- Import `copyPersonMaterialsForScenes`.
- At the start of `ensureImages`, before checking `options.generateImages`, add:

```ts
if (task.materialSource === 'local') {
  const person = task.materialPerson?.trim();
  if (!person) throw new Error('materialSource=local 时必须提供 materialPerson（人物素材库中的人物名）');
  await db.updateTask(task.id, { currentStep: 4, retryFromStep: 4 });
  await heartbeatTask(db, task.id, options, 4, 'local person materials');
  await markStep(4, 'running');
  await emit('step_start', 4, 'Producer', `使用人物素材库「${person}」铺分镜`);
  const copied = await copyPersonMaterialsForScenes({
    rootDir: join(options.appDataDir, 'person-assets'),
    person,
    scenes: artifact.scenes,
    taskDir: input.workDir,
    ratio: task.ratio,
    signal: options.signal,
  });
  pipeline.assets.images = mergeAssets(pipeline.assets.images, copied.assets);
  await markStep(4, 'completed', { outputPath: copied.assets.map((asset) => asset.path).join('\n') });
  await emit('step_complete', 4, 'Producer', `真图铺分镜完成：${copied.assets.length}/${artifact.scenes.length}`, { origins: copied.origins });
  return;
}
```

**Step 6: Run tests**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/person-assets.test.ts
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "local person materials"
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src/shared/person-assets.ts src/shared/runner.ts tests/person-assets.test.ts tests/runner.test.ts
git commit -m "feat: add local person material storyboard"
```

---

### Task 4: Add Electron IPC For Book Selection And Person Assets

**Files:**
- Modify: `src/vite-env.d.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write failing API surface test**

In `tests/product-shell-ui.test.ts`, add:

```ts
it('exposes local book selection and person asset APIs through preload', async () => {
  const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

  for (const api of [
    'listBookSelections',
    'saveBookSelection',
    'deleteBookSelection',
    'listPersonAssets',
    'createPersonAsset',
    'renamePersonAsset',
    'deletePersonAsset',
    'importPersonAssetImages',
    'listPersonAssetImages',
  ]) {
    expect(preload).toContain(api);
    expect(viteEnv).toContain(api);
  }

  for (const channel of [
    'book-selection:list',
    'book-selection:save',
    'book-selection:delete',
    'person-assets:list',
    'person-assets:create',
    'person-assets:rename',
    'person-assets:delete',
    'person-assets:import-images',
    'person-assets:list-images',
  ]) {
    expect(main).toContain(channel);
  }
});
```

**Step 2: Run test to verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts -t "book selection and person asset APIs"
```

Expected: FAIL.

**Step 3: Extend `src/vite-env.d.ts`**

Import new types:

```ts
BookSelectionInput,
BookSelectionRecord,
PersonAssetImage,
PersonAssetSummary,
```

Add API signatures:

```ts
listBookSelections: (theme?: string) => Promise<BookSelectionRecord[]>;
saveBookSelection: (input: BookSelectionInput) => Promise<BookSelectionRecord>;
deleteBookSelection: (theme: string, bookId: string) => Promise<void>;
listPersonAssets: () => Promise<PersonAssetSummary[]>;
createPersonAsset: (name: string) => Promise<PersonAssetSummary>;
renamePersonAsset: (oldName: string, newName: string) => Promise<string>;
deletePersonAsset: (name: string) => Promise<void>;
importPersonAssetImages: (name: string) => Promise<number>;
listPersonAssetImages: (name: string) => Promise<PersonAssetImage[]>;
```

**Step 4: Extend `electron/preload.ts`**

Import new types and expose:

```ts
listBookSelections: (theme?: string) => ipcRenderer.invoke('book-selection:list', theme),
saveBookSelection: (input: BookSelectionInput) => ipcRenderer.invoke('book-selection:save', input),
deleteBookSelection: (theme: string, bookId: string) => ipcRenderer.invoke('book-selection:delete', { theme, bookId }),
listPersonAssets: () => ipcRenderer.invoke('person-assets:list'),
createPersonAsset: (name: string) => ipcRenderer.invoke('person-assets:create', name),
renamePersonAsset: (oldName: string, newName: string) => ipcRenderer.invoke('person-assets:rename', { oldName, newName }),
deletePersonAsset: (name: string) => ipcRenderer.invoke('person-assets:delete', name),
importPersonAssetImages: (name: string) => ipcRenderer.invoke('person-assets:import-images', name),
listPersonAssetImages: (name: string) => ipcRenderer.invoke('person-assets:list-images', name),
```

**Step 5: Extend `electron/main.ts`**

Import helpers from `src/shared/person-assets`.

Add helper:

```ts
function personAssetsRoot(): string {
  return join(appDataDir(), 'person-assets');
}
```

Add IPC handlers:

```ts
ipcMain.handle('book-selection:list', async (_event, theme?: string) => (await getDb()).listBookSelections(theme));
ipcMain.handle('book-selection:save', async (_event, input: BookSelectionInput) => (await getDb()).upsertBookSelection(input));
ipcMain.handle('book-selection:delete', async (_event, input: { theme: string; bookId: string }) => {
  await (await getDb()).deleteBookSelection(input.theme, input.bookId);
});

ipcMain.handle('person-assets:list', async () => listPersonAssets(personAssetsRoot()));
ipcMain.handle('person-assets:create', async (_event, name: string) => createPersonAsset(personAssetsRoot(), name));
ipcMain.handle('person-assets:rename', async (_event, input: { oldName: string; newName: string }) => renamePersonAsset(personAssetsRoot(), input.oldName, input.newName));
ipcMain.handle('person-assets:delete', async (_event, name: string) => deletePersonAsset(personAssetsRoot(), name));
ipcMain.handle('person-assets:list-images', async (_event, name: string) => listPersonImages(personAssetsRoot(), name));
ipcMain.handle('person-assets:import-images', async (_event, name: string) => {
  const result = await dialog.showOpenDialog({
    title: `导入图片到「${name}」`,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (result.canceled) return 0;
  return importPersonAssetFiles(personAssetsRoot(), name, result.filePaths);
});
```

**Step 6: Run test and typecheck**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts -t "book selection and person asset APIs"
npm run typecheck
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src/vite-env.d.ts electron/preload.ts electron/main.ts tests/product-shell-ui.test.ts
git commit -m "feat: expose local selection and person asset APIs"
```

---

### Task 5: Add UI Pages And New Task Integration

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write failing shell/UI tests**

In `tests/product-shell-ui.test.ts`, add:

```ts
it('adds practical latest Storybound pages and controls to the Chinese shell', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  for (const text of [
    '选品助手',
    '对标导入',
    '人物素材库',
    '文案把控',
    '固定开头',
    '结尾引导',
    '锁定开头句数',
    '素材来源',
    '本地人物素材',
    '用此文案创建任务',
    '带入新建任务',
  ]) {
    expect(main).toContain(text);
  }

  for (const symbol of [
    'BookSelectionPage',
    'BenchmarkImportPage',
    'PersonAssetsPage',
    'book_product_info',
    'benchmark_search',
    'productInfo',
    'materialPerson',
    'fixedIntro',
    'outroCta',
    'lockIntroSentences',
  ]) {
    expect(main).toContain(symbol);
  }

  expect(css).toContain('.selection-grid');
  expect(css).toContain('.person-assets-layout');
  expect(css).toContain('.benchmark-import-layout');
});
```

**Step 2: Run test to verify failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts -t "practical latest Storybound"
```

Expected: FAIL.

**Step 3: Add navigation**

In `src/main.tsx`:

- Add nav items:

```ts
{ view: 'book-selection', label: '选品助手', hint: '商品卖点', icon: BookOpen },
{ view: 'benchmark', label: '对标导入', hint: '文案二改', icon: Radar },
{ view: 'person-assets', label: '人物素材库', hint: '真图分镜', icon: Images },
```

Use existing lucide icons if already imported; otherwise import `BookOpen`, `Radar`, `Images`.

- Add render branches:

```tsx
{activeView === 'book-selection' ? <BookSelectionPage api={api} navigate={navigate} /> : null}
{activeView === 'benchmark' ? <BenchmarkImportPage api={api} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
{activeView === 'person-assets' ? <PersonAssetsPage api={api} isBrowserPreview={isBrowserPreview} /> : null}
```

- Extend `pageSubtitle`.

**Step 4: Extend fallback API**

In `makeFallbackApi`, add in-memory/localStorage no-op implementations so browser preview renders:

```ts
listBookSelections: async () => [],
saveBookSelection: async (input) => ({ theme: input.theme, bookId: input.bookId ?? `b-${Date.now()}`, data: input.data, updatedAt: Date.now() }),
deleteBookSelection: async () => undefined,
listPersonAssets: async () => [],
createPersonAsset: async (name) => ({ name, count: 0, dir: '', updatedAt: Date.now() }),
renamePersonAsset: async (_oldName, newName) => newName,
deletePersonAsset: async () => undefined,
importPersonAssetImages: async () => 0,
listPersonAssetImages: async () => [],
```

**Step 5: Add NewTaskPage state and session handoff**

Add state:

```ts
const [productInfo, setProductInfo] = useState<string | null>(null);
const [materialSource, setMaterialSource] = useState<'ai' | 'local'>('ai');
const [materialPerson, setMaterialPerson] = useState('');
const [fixedIntro, setFixedIntro] = useState('');
const [outroCta, setOutroCta] = useState('');
const [lockIntroSentences, setLockIntroSentences] = useState('0');
const [personAssets, setPersonAssets] = useState<PersonAssetSummary[]>([]);
```

On mount, read:

```ts
const storedProduct = sessionStorage.getItem('book_product_info');
if (storedProduct) {
  setProductInfo(storedProduct);
  setKeepPromotion(true);
  sessionStorage.removeItem('book_product_info');
}
const storedScript = sessionStorage.getItem('benchmark_script');
if (storedScript) {
  setInputText(storedScript);
  setMode('paste');
  sessionStorage.removeItem('benchmark_script');
}
```

Load people with `api.listPersonAssets()`.

Add controls in the advanced area:

- Section title `文案把控`.
- Textareas for `fixedIntro` and `outroCta`.
- Number input for `lockIntroSentences`.
- Section `素材来源` with segmented AI/local.
- If local, select person from `personAssets`.

Pass fields into `api.createAndRunTask`:

```ts
productInfo,
materialSource,
materialPerson: materialSource === 'local' ? materialPerson : null,
fixedIntro,
outroCta,
lockIntroSentences: normalizeLockIntroSentencesInput(lockIntroSentences),
keepPromotion: keepPromotion || Boolean(productInfo),
```

**Step 6: Add `BookSelectionPage`**

Implement in `src/main.tsx` near other page components:

- Load `api.listBookSelections()`.
- Form fields: theme, name, author, category, keyword, sellPoint, audience, persons, era, price, url, note.
- Save with `api.saveBookSelection`.
- Delete with `api.deleteBookSelection`.
- `带入新建任务`: `sessionStorage.setItem('book_product_info', JSON.stringify(toProductInfo(record)))`, then `navigate('new-task')`.
- `去对标导入`: set both `book_product_info` and `benchmark_search`, then `navigate('benchmark')`.

**Step 7: Add `BenchmarkImportPage`**

Implement local-only page:

- State for source link, account/title, keyword, transcript/script.
- On mount read `book_product_info` and `benchmark_search`.
- `用此文案创建任务` calls `api.createAndRunTask` with:

```ts
{
  title: benchmarkTitle || keyword || productName || '',
  inputText: script,
  mode: 'paste',
  track: productInfo ? 'ecommerce' : 'character-story',
  keepPromotion: Boolean(productInfo),
  productInfo,
  pausePoints: [],
}
```

- Apply state and open created task detail.

**Step 8: Add `PersonAssetsPage`**

Implement:

- Load `api.listPersonAssets`.
- Create person.
- Rename/delete selected person.
- Import images through `api.importPersonAssetImages`.
- Load images through `api.listPersonAssetImages`.
- Open folder can be deferred unless a dedicated IPC exists; use existing `api.openPath(image.dir)` if `PersonAssetSummary.dir` is returned.

**Step 9: Add CSS**

In `src/styles.css`, add compact utility styles:

```css
.selection-grid { display: grid; grid-template-columns: minmax(260px, 360px) minmax(0, 1fr); gap: 16px; }
.selection-card-list { display: grid; gap: 10px; }
.benchmark-import-layout { display: grid; grid-template-columns: minmax(320px, 420px) minmax(0, 1fr); gap: 16px; }
.person-assets-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; }
.person-image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
```

Keep cards low-radius and dense, consistent with current shell.

**Step 10: Run UI tests and typecheck**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts -t "practical latest Storybound"
npm run typecheck
```

Expected: PASS.

**Step 11: Commit**

```powershell
git add src/main.tsx src/styles.css tests/product-shell-ui.test.ts
git commit -m "feat: add practical latest storybound pages"
```

---

### Task 6: Final Verification And Polish

**Files:**
- Modify only if verification exposes issues.
- Update: `task_plan.md`
- Update: `findings.md`
- Update: `progress.md`

**Step 1: Run focused tests**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/person-assets.test.ts
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "fixed intro|locks the first|product info|local person materials"
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts
```

Expected: all PASS.

**Step 2: Run full checks**

Run:

```powershell
npm run typecheck
npm test
npm run build
```

Expected: all PASS. Vite may keep the existing large chunk warning.

**Step 3: Browser/Electron smoke**

Run:

```powershell
npm run smoke:electron
```

Expected: existing smoke passes. If it does not cover new pages, manually start the dev app and verify:

- Sidebar shows `选品助手`、`对标导入`、`人物素材库`.
- New task advanced settings show `文案把控` and `素材来源`.
- Browser preview renders new pages without throwing.

**Step 4: Update planning files**

Update:

- `task_plan.md`: mark implementation phases complete.
- `findings.md`: add final implementation notes and any deviations, especially if local materials copy instead of crop.
- `progress.md`: record commands and results.

**Step 5: Commit final notes if changed**

```powershell
git add task_plan.md findings.md progress.md
git commit -m "docs: record latest storybound feature migration"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-07-09-storybound-latest-practical-features.md`.

Two execution options:

1. **Subagent-Driven (this session)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** - Open a new session with `superpowers:executing-plans`, batch execution with checkpoints.
