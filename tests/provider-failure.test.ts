import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyProviderFailure, parseRetryAfterMs, providerBackoffMs, shouldRetryProviderFailure } from '../src/shared/provider-failure';
import { createOpenAiCompatibleJsonLlm } from '../src/shared/llm-provider';
import { defaultConfig } from '@shared/config';

const coded = (code: string, message = 'fetch failed') => new TypeError(message, { cause: Object.assign(new Error('inner'), { code, hostname: 'api.example.com' }) });

describe('provider failure classification (G-2)', () => {
  it.each([
    ['UND_ERR_CONNECT_TIMEOUT', 'connect', 'not-sent', 'always'],
    ['ECONNREFUSED', 'connect', 'not-sent', 'always'],
    ['EAI_AGAIN', 'dns', 'not-sent', 'always'],
    ['ENOTFOUND', 'dns', 'not-sent', 'never'],
    ['ECONNRESET', 'transport-lost', 'unknown', 'idempotent'],
    ['UND_ERR_SOCKET', 'transport-lost', 'unknown', 'idempotent'],
    ['UND_ERR_HEADERS_TIMEOUT', 'response-timeout', 'unknown', 'idempotent'],
  ])('network code %s → %s / %s / %s', (code, kind, outcome, retry) => {
    const failure = classifyProviderFailure({ error: coded(code) });
    expect(failure).toMatchObject({ kind, outcome, retry, code, host: 'api.example.com' });
  });

  it.each([
    [429, '', 'rate-limit', 'rejected', 'always'],
    [503, 'overloaded', 'overloaded', 'rejected', 'always'],
    [529, '', 'overloaded', 'rejected', 'always'],
    [502, '', 'gateway', 'unknown', 'idempotent'],
    [520, '', 'gateway', 'unknown', 'idempotent'],
    [522, '', 'gateway', 'not-sent', 'always'],
    [524, '', 'gateway-timeout', 'unknown', 'idempotent'],
    [500, '', 'server', 'unknown', 'idempotent'],
    [401, '', 'auth', 'rejected', 'never'],
    [402, '', 'billing', 'rejected', 'never'],
    [404, '{"error":{"code":"model_not_found"}}', 'model-not-found', 'rejected', 'never'],
    [503, 'No available channel for model gpt-image-2 under group default', 'model-not-found', 'rejected', 'never'],
    [404, 'Not Found', 'not-found', 'rejected', 'never'],
    [400, 'content_policy_violation', 'content-policy', 'rejected', 'never'],
    [400, 'bad', 'bad-request', 'rejected', 'never'],
  ] as const)('HTTP %s %s → %s', (status, body, kind, outcome, retry) => {
    expect(classifyProviderFailure({ status, body })).toMatchObject({ kind, outcome, retry, status });
  });

  it('marks model-not-found and overload as fallback candidates for G-1', () => {
    expect(classifyProviderFailure({ status: 404, body: 'model_not_found' }).fallback).toBe(true);
    expect(classifyProviderFailure({ status: 529 }).fallback).toBe(true);
    expect(classifyProviderFailure({ status: 401 }).fallback).toBe(false);
  });

  it('reads status from stored error text and keeps unknown outcomes from paid resend', () => {
    const failure = classifyProviderFailure({ error: new Error('Image provider API error (524) at vllmproxy.example.com') });
    expect(failure).toMatchObject({ kind: 'gateway-timeout', outcome: 'unknown', host: 'vllmproxy.example.com' });
    expect(shouldRetryProviderFailure(failure, { idempotent: false })).toBe(false);
    expect(shouldRetryProviderFailure(failure, { idempotent: true })).toBe(true);
    expect(shouldRetryProviderFailure(classifyProviderFailure({ status: 429 }), { idempotent: false })).toBe(true);
  });

  it('treats aborts and plain local errors as never-retry', () => {
    expect(classifyProviderFailure({ error: Object.assign(new Error('x'), { name: 'AbortError' }) }).kind).toBe('aborted');
    expect(classifyProviderFailure({ error: new Error('Cannot read properties of undefined') })).toMatchObject({ kind: 'local', retry: 'never' });
  });

  it('parses Retry-After and caps it; backoff honours it as a lower bound', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs('99999')).toBe(60_000);
    expect(parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect([1, 2, 3].map(attempt => providerBackoffMs(attempt))).toEqual([500, 1500, 4500]);
    expect(providerBackoffMs(1, { retryAfterMs: 8000 })).toBe(8000);
    expect(providerBackoffMs(10)).toBe(30_000);
    expect(providerBackoffMs(2, { jitter: 1, random: () => 0.5 })).toBe(750);
    expect(classifyProviderFailure({ status: 429, headers: { 'Retry-After': '2' } }).retryAfterMs).toBe(2000);
  });
});

describe('LLM retry schedule (G-2)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], id: 'r' }), { status: 200 });
  const run = () => createOpenAiCompatibleJsonLlm({ ...defaultConfig.llm, apiKey: 'k', baseUrl: 'https://llm.example' })({ step: 1, name: 'probe', messages: [{ role: 'user', content: 'x' }] });

  it('waits at least Retry-After before resending a 429', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++calls === 1 ? new Response('slow down', { status: 429, headers: { 'Retry-After': '4' } }) : ok())));
    const pending = run();
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toMatchObject({ json: { ok: true } });
    expect(calls).toBe(2);
  });

  it('retries a 522 (gateway never reached the model) but not a 524 (result unknown)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++calls === 1 ? new Response('', { status: 522 }) : ok())));
    await expect(run()).resolves.toMatchObject({ json: { ok: true } });
    expect(calls).toBe(2);
    calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls += 1; return new Response('timeout', { status: 524 }); }));
    await expect(run()).rejects.toThrow(/524/);
    expect(calls).toBe(1);
  });
});
