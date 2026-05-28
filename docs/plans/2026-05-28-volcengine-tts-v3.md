# Volcengine TTS V3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Volcengine TTS V3 API Key support with selectable voice presets.

**Architecture:** Extend the existing Volcengine TTS config/profile shape with V3 fields, prefer the V3 path when `apiKey` is configured, and keep the legacy v1 path as fallback. The renderer settings UI writes the same active TTS profile data that the shared provider consumes.

**Tech Stack:** TypeScript, React, Electron preload API, Vitest, Fetch streams.

---

### Task 1: Config Shape And Normalization

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/config-utils.ts`
- Test: `tests/config-utils.test.ts`

**Step 1: Write the failing test**

Add a test that normalizes a Volcengine TTS profile with:

```ts
volcengine: {
  ...defaultConfig.tts.volcengine,
  apiKey: 'v3-key',
  resourceId: 'seed-tts-2.0',
  endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
  speaker: 'zh_female_vv_uranus_bigtts',
}
```

Assert the active `config.tts.volcengine` mirrors those fields and only that profile is enabled.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-utils.test.ts --pool=threads --maxWorkers=1`
Expected: FAIL because `apiKey` is not part of the Volcengine TTS type/defaults yet.

**Step 3: Write minimal implementation**

Add optional `apiKey` to `TtsConfig['volcengine']`, set defaults:

```ts
apiKey: '',
resourceId: 'seed-tts-2.0',
endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
```

Ensure profile normalization preserves these fields.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-utils.test.ts --pool=threads --maxWorkers=1`
Expected: PASS.

### Task 2: Volcengine V3 Provider

**Files:**
- Modify: `src/shared/media-providers.ts`
- Test: `tests/media-providers.test.ts`

**Step 1: Write the failing test**

Add a test that stubs `fetch` with a streamed response containing newline-delimited JSON:

```json
{"code":0,"message":"","data":"<base64 part 1>"}
{"code":0,"message":"","data":"<base64 part 2>"}
{"code":20000000,"message":"ok","data":null}
```

Assert:
- URL is `https://openspeech.bytedance.com/api/v3/tts/unidirectional`
- Headers include `X-Api-Key` and `X-Api-Resource-Id`
- Body contains `req_params.text`, `req_params.speaker`, `audio_params.format = "mp3"`, and `audio_params.speech_rate`
- Written mp3 equals concatenated audio bytes.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/media-providers.test.ts --pool=threads --maxWorkers=1`
Expected: FAIL because provider still sends the v1 request.

**Step 3: Write minimal implementation**

In `createConfiguredNarrationSynthesizer`, pass `apiKey` and `resourceId`. In `synthesizeVolcengineNarration`, branch:

```ts
if (input.apiKey) return synthesizeVolcengineV3Narration(input);
return synthesizeVolcengineLegacyNarration(input);
```

Implement a stream parser that uses `response.body.getReader()`, `TextDecoder`, newline buffering, and `Buffer.concat`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/media-providers.test.ts --pool=threads --maxWorkers=1`
Expected: PASS.

### Task 3: Settings UI Voice Presets

**Files:**
- Modify: `src/main.tsx`
- Test: `tests/product-shell-ui.test.ts`

**Step 1: Write the failing test**

Assert the renderer source contains:
- `volcengineVoicePresets`
- `火山 API Key`
- `Resource ID`
- `V3 HTTP Chunked`
- `voice_type`

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1`
Expected: FAIL because the UI still exposes App ID/Access Token fields.

**Step 3: Write minimal implementation**

Add a compact preset list:

```ts
const volcengineVoicePresets = [
  ['Vivi 2.0', 'zh_female_vv_uranus_bigtts'],
  ['云舟 2.0', 'zh_male_m191_uranus_bigtts'],
  ['爽快思思 2.0', 'zh_female_shuangkuaisisi_uranus_bigtts'],
  ['儒雅青年 2.0', 'zh_male_ruyaqingnian_uranus_bigtts'],
] as const;
```

Render a select for presets and inputs for API Key, Resource ID, endpoint, and voice type.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1`
Expected: PASS.

### Task 4: Final Verification

**Files:**
- All touched files

**Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/config-utils.test.ts tests/media-providers.test.ts tests/product-shell-ui.test.ts --pool=threads --maxWorkers=1
```

Expected: PASS.

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

**Step 3: Inspect git diff**

Run: `git diff -- src/shared/types.ts src/shared/config.ts src/shared/config-utils.ts src/shared/media-providers.ts src/main.tsx tests/config-utils.test.ts tests/media-providers.test.ts tests/product-shell-ui.test.ts`
Expected: Only scoped Volcengine TTS V3 and test updates, with unrelated dirty work preserved.
