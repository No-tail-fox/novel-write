import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeModelCapabilities, inferModelCapabilities, modelMeetsTier, normalizeFallbackModels } from '../src/shared/model-capabilities';
import { createConfiguredJsonLlm, createConfiguredTextLlm, observeLlmFallbacks, onLlmModelFallback, type ConfiguredJsonLlm, type LlmModelFallbackEvent } from '../src/shared/llm-provider';
import { summarizeErrorMessage } from '../src/components/ErrorDetails';
import { readFileSync } from 'node:fs';
import { normalizeAppConfig } from '../src/shared/config-utils';
import { defaultConfig } from '@shared/config';

describe('model capability profiles (G-1)', () => {
  it.each([
    ['claude-sonnet-4-5', 'T1', true],
    ['gemini-3.1-pro-preview', 'T1', true],
    ['gemini-2.5-flash', 'T2', true],
    ['gemini-2.5-flash-lite', 'T3', true],
    ['gpt-5', 'T1', true],
    ['gpt-4o-mini', 'T3', true],
    ['deepseek-chat', 'T2', true],
    ['my-relay-model', 'T2', false],
  ] as const)('%s → %s', (model, tier, known) => {
    expect(inferModelCapabilities(model)).toMatchObject({ tier, known });
  });

  it('compares tiers and normalises fallback lists', () => {
    expect(modelMeetsTier('claude-opus-4', 'T2')).toBe(true);
    expect(modelMeetsTier('gpt-4o-mini', 'T1')).toBe(false);
    expect(normalizeFallbackModels('a', ' b , a, b,，c\nd,e,f')).toEqual(['b', 'c', 'd', 'e']);
    expect(normalizeFallbackModels('a', undefined)).toEqual([]);
    expect(describeModelCapabilities('gemini-3.1-pro-preview', ['gpt-5'])).toContain('gpt-5');
  });

  it('keeps fallbackModels through config normalisation and drops empty lists', () => {
    const withList = normalizeAppConfig({ ...defaultConfig, llm: { ...defaultConfig.llm, model: 'm1', fallbackModels: [' m2 ', 'm1', ''] } });
    expect(withList.llm.fallbackModels).toEqual(['m2']);
    const without = normalizeAppConfig({ ...defaultConfig, llm: { ...defaultConfig.llm, model: 'm1', fallbackModels: [] } });
    expect(without.llm).not.toHaveProperty('fallbackModels');
  });
});

describe('LLM model fallback chain (G-1)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const body = (init: RequestInit | undefined) => JSON.parse(String(init?.body)) as { model: string };
  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], id: 'r' }), { status: 200 });
  const config = { ...defaultConfig.llm, apiKey: 'k', baseUrl: 'https://llm.example', model: 'primary', fallbackModels: ['backup'] };

  it('moves to the next model after model_not_found and reports the switch', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const { model } = body(init); seen.push(model);
      return model === 'primary' ? new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'model primary does not exist' } }), { status: 404 }) : ok('{"ok":1}');
    }));
    const events: LlmModelFallbackEvent[] = [];
    const off = onLlmModelFallback(event => events.push(event));
    const result = await createConfiguredJsonLlm(config).run({ step: 2, name: 'plan', messages: [{ role: 'user', content: 'x' }], maxRetries: 0 });
    off();
    expect(seen).toEqual(['primary', 'backup']);
    expect(result).toMatchObject({ json: { ok: 1 }, modelUsed: 'backup', modelFallbacks: [{ from: 'primary', to: 'backup', reason: 'model-not-found' }] });
    expect(events).toHaveLength(1);
  });

  it('never switches models for an unknown outcome (524) or auth failure', async () => {
    for (const status of [524, 401]) {
      const seen: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { seen.push(body(init).model); return new Response('err', { status }); }));
      await expect(createConfiguredTextLlm(config).run({ step: 1, name: 't', messages: [{ role: 'user', content: 'x' }], maxRetries: 0 })).rejects.toThrow();
      expect(seen).toEqual(['primary']);
    }
  });

  it('leaves results untouched when no fallback was used', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok('hello')));
    const result = await createConfiguredTextLlm(config).run({ step: 1, name: 't', messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('hello');
    expect(result).not.toHaveProperty('modelUsed');
  });
});

describe('model fallback visibility (U-4)', () => {
  it('reports fallbacks to a task-scoped observer and leaves the result intact', async () => {
    const event: LlmModelFallbackEvent = { step: 3, name: 'storyboard', from: 'a', to: 'b', reason: 'model-not-found', label: 'x', at: 'now' };
    const inner = { protocol: 'openai', run: async () => ({ json: { ok: 1 }, raw: '', requestId: null, modelUsed: 'b', modelFallbacks: [event] }) } as unknown as ConfiguredJsonLlm;
    const seen: LlmModelFallbackEvent[] = [];
    const result = await observeLlmFallbacks(inner, (item) => seen.push(item)).run({ step: 3, name: 'storyboard', messages: [] });
    expect(result).toMatchObject({ json: { ok: 1 }, modelUsed: 'b' });
    expect(seen).toEqual([event]);
  });

  it('records model_fallback task events in the template runner', () => {
    const source = readFileSync('src/shared/runner.ts', 'utf8');
    expect(source).toContain('observeLlmFallbacks(options.llm');
    expect(source).toContain("emit('model_fallback'");
  });

  it('summarises an orphaned paid request for the user', () => {
    expect(summarizeErrorMessage('PROVIDER_RESULT_UNKNOWN: 「改写」上次已发出请求')).toBe('上次请求结果未知，请核对服务商记录后再重试');
  });
});

describe('fallback recommendation from the endpoint model list (G-6)', () => {
  it('proposes same-family, same-or-better chat models and skips media models', async () => {
    const { recommendFallbackModels } = await import('../src/shared/model-capabilities');
    const available = ['claude-sonnet-5-5', 'gpt-image-2', 'text-embedding-3', 'gemini-3.1-pro-preview', 'claude-opus-4-1', 'gpt-4o-mini', 'whisper-1', 'mystery-model'];
    expect(recommendFallbackModels('claude-sonnet-5-5', available)).toEqual(['claude-opus-4-1', 'gemini-3.1-pro-preview']);
    expect(recommendFallbackModels('gpt-4o-mini', available, 4)).toEqual(['claude-opus-4-1', 'claude-sonnet-5-5', 'gemini-3.1-pro-preview']);
    expect(recommendFallbackModels('claude-sonnet-5-5', [])).toEqual([]);
  });

  it('offers a one-click fill only when the profile has no fallbacks yet', () => {
    const source = readFileSync('src/features/settings/ProviderProfileManagers.tsx', 'utf8');
    expect(source).toContain('!(selectedProfile.fallbackModels ?? []).length && recommendFallbackModels(');
    expect(source).toContain('填入推荐备选');
  });
});
