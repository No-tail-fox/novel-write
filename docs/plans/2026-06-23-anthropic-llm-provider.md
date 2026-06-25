# Anthropic LLM Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Anthropic-compatible LLM configuration path and verify it against a Claude gateway without storing credentials.

**Architecture:** Keep the existing OpenAI-compatible adapter intact. Add protocol-aware LLM helpers that select OpenAI chat completions or Anthropic Messages API based on `LlmConfig.protocol` / provider, and route settings/model-list tests through the same protocol-aware layer.

**Tech Stack:** TypeScript, React settings UI, Vitest, Electron IPC.

---

### Task 1: Anthropic Adapter Tests

**Files:**
- Modify: `tests/llm-provider.test.ts`
- Modify: `tests/config-utils.test.ts`

**Steps:**
1. Write failing tests for Anthropic JSON requests using `/v1/messages`, `x-api-key`, `anthropic-version`, `system`, and non-system `messages`.
2. Write failing tests for Anthropic model probing and model listing.
3. Write failing tests that config normalization preserves `protocol: 'anthropic'` and validation points to `/v1/messages`.

### Task 2: Provider Implementation

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/llm-provider.ts`
- Modify: `src/shared/config-utils.ts`
- Modify: `src/shared/provider-profile-utils.ts`
- Modify: `src/shared/task-runtime-providers.ts`
- Modify: `src/shared/viral-runtime.ts`
- Modify: `electron/main.ts`
- Modify: `src/main.tsx`

**Steps:**
1. Extend `LlmConfig.protocol` to include `anthropic`.
2. Add protocol-aware JSON LLM, test, and model-list functions.
3. Add Anthropic Messages request/response parsing.
4. Update runtime provider selection and Electron/browser fallback IPC helpers.
5. Add Anthropic option to the LLM settings UI.

### Task 3: Verification

**Commands:**
- `npm test -- tests/llm-provider.test.ts tests/config-utils.test.ts tests/provider-profile-utils.test.ts`
- `npm test -- tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts`
- Optional live probe with environment variables only:
  `ANTHROPIC_AUTH_TOKEN=... ANTHROPIC_BASE_URL=... node <probe>`
