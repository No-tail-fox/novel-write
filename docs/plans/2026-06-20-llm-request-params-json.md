# LLM Per-Profile JSON Params Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-LLM-profile raw JSON request parameters so each model profile can independently enable reasoning or other OpenAI-compatible options.

**Architecture:** Extend the LLM profile config with one extra JSON string field, normalize it through existing config utilities, and merge it into every OpenAI-compatible chat request at send time. Keep fixed request fields (`model`, `messages`, `response_format`) authoritative so user JSON can only add or override safe optional knobs. Surface the JSON editor in the LLM settings UI with validation and preserve it through save/load/migration paths.

**Tech Stack:** TypeScript, React, Vitest, Electron renderer settings UI

---

### Task 1: Extend the LLM config model

**Files:**
- Modify: `src/shared/types.ts:31-42`
- Modify: `src/shared/config.ts:17-40`
- Modify: `src/shared/config-utils.ts:24-95, 430-520`

**Step 1: Write the failing test**

```ts
it('preserves per-profile raw llm request json during normalization', () => {
  const normalized = normalizeAppConfig({
    ...defaultConfig,
    llm: { ...defaultConfig.llm, requestParamsJson: '{"reasoning_effort":"medium"}' },
  });
  expect(normalized.llm.requestParamsJson).toContain('reasoning_effort');
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/config-utils.test.ts -t "preserves per-profile raw llm request json during normalization"`
Expected: FAIL because the field does not exist yet.

**Step 3: Write minimal implementation**

Add `requestParamsJson: '{}'` to `LlmConfig`, default it in `defaultConfig.llm` and `defaultConfig.llmProfiles`, and carry it through `normalizeLlmProfile` / `normalizeLocalLlmProfile` as a trimmed string with fallback `{}`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/config-utils.test.ts -t "preserves per-profile raw llm request json during normalization"`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/config.ts src/shared/config-utils.ts tests/config-utils.test.ts
git commit -m "feat: add per-profile llm request params json"
```

### Task 2: Merge profile JSON into OpenAI-compatible requests

**Files:**
- Modify: `src/shared/llm-provider.ts:39-190`
- Test: `tests/llm-provider.test.ts`

**Step 1: Write the failing test**

```ts
it('merges per-profile request params json into chat completions payload', async () => {
  // mock fetch and assert reasoning_effort is present in the POST body
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/llm-provider.test.ts -t "merges per-profile request params json into chat completions payload"`
Expected: FAIL because the outgoing request body does not include the JSON fields yet.

**Step 3: Write minimal implementation**

Parse `config.requestParamsJson` safely, ignore empty/invalid JSON in runtime with a clear error path, and merge the parsed object into the POST body before `response_format` / fixed fields are finalized.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/llm-provider.test.ts -t "merges per-profile request params json into chat completions payload"`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/llm-provider.ts tests/llm-provider.test.ts
git commit -m "feat: pass llm profile request params through"
```

### Task 3: Add settings UI for the JSON field

**Files:**
- Modify: `src/main.tsx:4900-5550`
- Modify: `src/shared/provider-profile-utils.ts:1-120`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing test**

```ts
it('renders an editable request params json field for llm profiles', () => {
  // assert the settings pane shows a JSON textarea for the selected profile
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/product-shell-ui.test.ts -t "renders an editable request params json field for llm profiles"`
Expected: FAIL because the UI does not expose the field yet.

**Step 3: Write minimal implementation**

Add a textarea to the LLM profile editor, bind it to the profile draft, and keep it aligned with existing save/copy/activate flows. Show a small hint that the field is raw JSON for provider-specific request parameters.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/product-shell-ui.test.ts -t "renders an editable request params json field for llm profiles"`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/main.tsx src/shared/provider-profile-utils.ts tests/product-shell-ui.test.ts
git commit -m "feat: edit llm request params json in settings"
```

### Task 4: Harden validation and regression coverage

**Files:**
- Modify: `tests/config-utils.test.ts`
- Modify: `tests/llm-provider.test.ts`

**Step 1: Write the failing tests**

Add coverage for invalid JSON handling, empty JSON fallback, and a profile that stores `{"reasoning_effort":"medium"}` without losing it on round-trip normalization.

**Step 2: Run the tests to verify failures**

Run: `npm test -- tests/config-utils.test.ts tests/llm-provider.test.ts`
Expected: FAIL until the validation and merge behavior is complete.

**Step 3: Write minimal implementation**

Keep JSON parsing isolated, fail fast with a readable message on invalid user input, and make sure save/load normalization preserves exact user-authored JSON text when possible.

**Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/config-utils.test.ts tests/llm-provider.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/config-utils.test.ts tests/llm-provider.test.ts
git commit -m "test: cover llm request params json"
```
