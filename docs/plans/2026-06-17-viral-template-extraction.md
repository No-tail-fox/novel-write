# Viral Template Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let viral analysis results be saved as a user-named story template and image template, while keeping new task creation as a separate user choice.

**Architecture:** Add a pure template-extraction helper in `src/shared/viral-analysis.ts`, then wire the viral report UI to collect editable template names and save through the existing `savePromptTemplate` and `saveCustomStyle` APIs. Keep storage and IPC unchanged.

**Tech Stack:** React, Vite, Electron, TypeScript, Vitest.

---

### Task 1: Add Viral Template Extraction Contract Tests

**Files:**
- Modify: `tests/viral-analysis.test.ts`
- Modify: `src/shared/viral-analysis.ts`

**Step 1: Write the failing test**

Add an import for `createViralTemplateDrafts` from `@shared/viral-analysis`.

Add a test:

```ts
it('creates user-named story and image templates from a viral result', () => {
  const result = {
    ...makeViralResult(),
    frames: [
      {
        timestamp: 1,
        framePath: 'frame-1.jpg',
        shotType: 'close-up',
        cameraMovement: 'push in',
        composition: 'centered product and large headline',
        transition: 'hard cut',
        textOverlay: 'Save this',
        visualDescription: 'Bright shop counter with a before and after contrast.',
        mood: 'urgent and useful',
        keyElements: ['shop counter', 'headline', 'before after'],
        imagePrompt: 'photo-real short video frame, centered shop counter, bold headline',
      },
    ],
  };

  const drafts = createViralTemplateDrafts(result, {
    storyTemplateName: 'My story pattern',
    imageTemplateName: 'My image pattern',
    track: 'ecommerce',
    style: 'photo-real',
    draftTemplateId: 'default-portrait-9-16',
    now: '2026-06-17T00:00:00.000Z',
    storyTemplateId: 'story-id',
    imageTemplateId: 'image-id',
  });

  expect(drafts.storyTemplate.name).toBe('My story pattern');
  expect(drafts.imageTemplate.name).toBe('My image pattern');
  expect(drafts.storyTemplate.type).toBe('task');
  expect(drafts.storyTemplate.defaultStyles).toEqual(['image-id']);
  expect(drafts.storyTemplate.defaultDraftTemplateId).toBe('default-portrait-9-16');
  expect(drafts.storyTemplate.content).toContain('Lead with the result.');
  expect(drafts.storyTemplate.content).toContain('Show before and after.');
  expect(drafts.storyTemplate.content).toContain('不要照抄原文');
  expect(drafts.imageTemplate.prefix).toContain('centered product and large headline');
  expect(drafts.imageTemplate.suffix).toContain('photo-real short video frame');
  expect(drafts.imageTemplate.negativePrompt).toContain('照抄原视频文字');
});
```

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/viral-analysis.test.ts`

Expected: FAIL because `createViralTemplateDrafts` does not exist.

### Task 2: Implement Pure Template Extraction Helper

**Files:**
- Modify: `src/shared/viral-analysis.ts`
- Modify: `src/shared/types.ts` if a small options interface is useful

**Step 1: Add imports**

Import `CustomStyle` and `PromptTemplate` types from `./types`.

**Step 2: Add options/result types**

Add local exported interfaces:

```ts
export interface ViralTemplateDraftOptions {
  storyTemplateName: string;
  imageTemplateName: string;
  track: string;
  style: string;
  draftTemplateId: string;
  now?: string;
  storyTemplateId?: string;
  imageTemplateId?: string;
}

export interface ViralTemplateDrafts {
  storyTemplate: PromptTemplate;
  imageTemplate: CustomStyle;
}
```

**Step 3: Implement `createViralTemplateDrafts`**

Create ids from supplied ids or `crypto.randomUUID()` where available. Build:

- `imageTemplate.id = imageTemplateId`
- `imageTemplate.name = imageTemplateName.trim()`
- `imageTemplate.tag = '爆款拆解'`
- `imageTemplate.shortName = trimmed image name`
- `imageTemplate.prefix` from source topic, cover pattern, frame composition, frame visual descriptions
- `imageTemplate.suffix` from frame image prompts, mood, shot types, and text overlay rules
- `imageTemplate.negativePrompt` with plagiarism guards such as `照抄原视频文字、复用原账号标识、搬运水印、低清晰度、变形文字`
- `imageTemplate.description` from source title and viral point

Build:

- `storyTemplate.id = storyTemplateId`
- `storyTemplate.name = storyTemplateName.trim()`
- `storyTemplate.type = 'task'`
- `storyTemplate.description = '由爆款拆解保存的故事结构模板'`
- `storyTemplate.content` from opening, structure, ending, viral point, title pattern, cover pattern, and anti-copy constraints
- `storyTemplate.isBuiltin = false`
- `storyTemplate.origin = 'custom'`
- `storyTemplate.baseTrack = track`
- `storyTemplate.defaultStyles = [imageTemplate.id]`
- `storyTemplate.defaultDraftTemplateId = draftTemplateId`
- `storyTemplate.characterPolicy = 'follow-template'`
- `storyTemplate.referenceKind = 'none'`
- `storyTemplate.marketTags = ['爆款拆解']`

Throw an error when either trimmed name is empty.

**Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/viral-analysis.test.ts`

Expected: PASS.

### Task 3: Add Viral Result UI Contract Tests

**Files:**
- Modify: `tests/product-shell-ui.test.ts`
- Modify: `src/main.tsx`

**Step 1: Write the failing test**

Update the existing viral analyzer UI test or add a focused test asserting `src/main.tsx` contains:

- `viral-followup-panel`
- `后续操作`
- `保存为模板`
- `生成新任务`
- `故事模板名`
- `图片模板名`
- `saveViralTemplates`
- `api.savePromptTemplate`
- `api.saveCustomStyle`

Also update the older assertion that expected `一键复刻成片任务` so it now expects `生成新任务`.

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`

Expected: FAIL because the UI still only shows the old recreation panel.

### Task 4: Wire Template Saving in Viral Analyzer UI

**Files:**
- Modify: `src/main.tsx`

**Step 1: Import helper**

Import `createViralTemplateDrafts` from `./shared/viral-analysis`.

**Step 2: Add save callback in `ViralAnalyzerPage`**

Add:

```ts
async function saveViralTemplates(input: { storyTemplateName: string; imageTemplateName: string }) {
  if (!result) return;
  const drafts = createViralTemplateDrafts(result, {
    storyTemplateName: input.storyTemplateName,
    imageTemplateName: input.imageTemplateName,
    track,
    style,
    draftTemplateId: templateId,
  });
  const afterImage = await api.saveCustomStyle(drafts.imageTemplate);
  const afterStory = await api.savePromptTemplate(drafts.storyTemplate);
  applyState({ ...afterImage, ...afterStory });
  setMessage('已保存故事模板和图片模板，可在提示词模板中继续编辑。');
}
```

If state merge order is risky, simply call both APIs then `applyState(afterStory)`, because both APIs return full app state from the same database.

**Step 3: Update `ViralReport` props**

Change the signature to:

```ts
function ViralReport({
  result,
  createProductionTask,
  saveTemplates,
}: {
  result: ViralAnalysisResult;
  createProductionTask: () => void;
  saveTemplates: (input: { storyTemplateName: string; imageTemplateName: string }) => Promise<void>;
})
```

Pass `saveViralTemplates` from `ViralAnalyzerPage`.

**Step 4: Replace recreation panel with follow-up panel**

Inside `ViralReport`, add state:

```ts
const defaultTemplateBaseName = viralTemplateBaseName(result);
const [storyTemplateName, setStoryTemplateName] = useState(`爆款故事模板 - ${defaultTemplateBaseName}`);
const [imageTemplateName, setImageTemplateName] = useState(`爆款图片模板 - ${defaultTemplateBaseName}`);
const [savingTemplates, setSavingTemplates] = useState(false);
const [templateSaveError, setTemplateSaveError] = useState('');
```

Render a `viral-followup-panel` with:

- heading `后续操作`
- readonly recreation blueprint/script preview
- `Field label="故事模板名"` input
- `Field label="图片模板名"` input
- button `保存为模板`
- button `生成新任务`

Disable save when either name is blank. Show `templateSaveError` if saving fails.

**Step 5: Add helper**

Add `viralTemplateBaseName(result)` near other viral helpers. Return a short title from source title, breakdown topic, or `短视频`.

**Step 6: Run UI test**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`

Expected: PASS.

### Task 5: Update Styles

**Files:**
- Modify: `src/styles.css`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Add CSS assertions**

Extend the UI test to assert CSS contains:

- `.viral-followup-panel`
- `.viral-template-name-grid`
- `.viral-followup-actions`

**Step 2: Implement CSS**

Add a compact panel style matching existing viral report cards:

```css
.viral-followup-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-soft);
}

.viral-template-name-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.viral-followup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
```

Use existing tokens if names differ.

**Step 3: Run UI test**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`

Expected: PASS.

### Task 6: Verify

**Files:**
- Test: `tests/viral-analysis.test.ts`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Run targeted tests**

Run:

- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/viral-analysis.test.ts`
- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`

Expected: PASS.

**Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.
