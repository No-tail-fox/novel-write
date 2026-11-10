import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeModelCapabilities, inferModelCapabilities, modelMeetsTier, normalizeFallbackModels } from '../src/shared/model-capabilities';
import { createConfiguredJsonLlm, createConfiguredTextLlm, onLlmModelFallback, type LlmModelFallbackEvent } from '../src/shared/llm-provider';
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
