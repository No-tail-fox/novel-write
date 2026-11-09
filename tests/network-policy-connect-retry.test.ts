import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithNetworkPolicy, NetworkPolicyError } from '@shared/network-policy';

const failure = (code = 'UND_ERR_CONNECT_TIMEOUT') => new TypeError('fetch failed', {
  cause: Object.assign(new Error('unsafe upstream details must not become the public message'), { code }),
});
const options = { purpose: 'provider-api' as const, retryConnectTimeout: true, method: 'POST', body: '{"model":"image"}' };
afterEach(() => vi.useRealTimers());

describe('image connection recovery', () => {
  it('reconnects once before HTTP submission, preserving the body and filtered credentials', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; authorization: string | null }> = [];
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 as const }]);
    const response = await fetchWithNetworkPolicy('https://image.example/generate', {
      ...options, lookup, headers: { Authorization: 'Bearer test', Cookie: 'not-allowed' },
      fetchImpl: async (_url, init) => {
        expect(new Headers(init?.headers).has('cookie')).toBe(false);
        calls.push({ body: init?.body, authorization: new Headers(init?.headers).get('authorization') });
        if (calls.length === 1) throw failure();
        return new Response('image');
      },
    });
    expect(await response.text()).toBe('image');
    expect(calls).toEqual(Array(2).fill({ body: options.body, authorization: 'Bearer test' }));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('stops after a second connection timeout and exposes its code without unsafe details', async () => {
    const fetchImpl = vi.fn(async () => { throw failure(); });
    await expect(fetchWithNetworkPolicy('https://image.example/generate', { ...options, fetchImpl }))
      .rejects.toMatchObject({ code: 'UND_ERR_CONNECT_TIMEOUT', message: expect.stringContaining('连接 image.example 超时') });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    try { await fetchWithNetworkPolicy('https://image.example/generate', { ...options, retryConnectTimeout: false, fetchImpl }); }
    catch (error) { expect((error as Error).message).not.toContain('unsafe upstream'); }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each(['UND_ERR_SOCKET', 'ECONNRESET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'EAI_AGAIN', 'ENOTFOUND'])
  ('does not replay ambiguous failures or DNS failures: %s', async code => {
    const fetchImpl = vi.fn(async () => { throw failure(code); });
    await expect(fetchWithNetworkPolicy('https://image.example/generate', { ...options, fetchImpl }))
      .rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([400, 429, 503])('does not replay an HTTP %s response', async status => {
    const fetchImpl = vi.fn(async () => new Response('upstream error', { status }));
    expect((await fetchWithNetworkPolicy('https://image.example/generate', { ...options, fetchImpl })).status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not replay a response whose body fails, even if the body throws a connection error code', async () => {
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.error(failure()); } })));
    await expect(fetchWithNetworkPolicy('https://image.example/generate', { ...options, fetchImpl })).rejects.toMatchObject({ code: 'UND_ERR_CONNECT_TIMEOUT' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not replay a stream request body', async () => {
    const fetchImpl = vi.fn(async () => { throw failure(); });
    await expect(fetchWithNetworkPolicy('https://image.example/generate', { ...options, body: new ReadableStream(), fetchImpl }))
      .rejects.toMatchObject({ code: 'UND_ERR_CONNECT_TIMEOUT' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('revalidates the target after reconnecting and preserves DNS policy rejections', async () => {
    const lookup = vi.fn().mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const fetchImpl = vi.fn(async () => { throw failure(); });
    await expect(fetchWithNetworkPolicy('https://image.example/generate', { ...options, lookup, fetchImpl }))
      .rejects.toBeInstanceOf(NetworkPolicyError);
    expect(lookup).toHaveBeenCalledTimes(2); expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not extend the overall request deadline when reconnecting', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      if (fetchImpl.mock.calls.length === 1) setTimeout(() => reject(failure()), 30_000);
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const result = fetchWithNetworkPolicy('https://image.example/generate', { ...options, timeoutMs: 45_000, fetchImpl });
    const rejected = expect(result).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(45_000); await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
