import { afterEach, describe, expect, it, vi } from 'vitest';

const { agentOptions } = vi.hoisted(() => ({ agentOptions: [] as Array<Record<string, unknown>> }));
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, Agent: class extends actual.Agent {
    constructor(options: ConstructorParameters<typeof actual.Agent>[0]) {
      super(options);
      agentOptions.push(options as Record<string, unknown>);
    }
  } };
});
import { fetchWithNetworkPolicy } from '@shared/network-policy';

afterEach(() => { agentOptions.length = 0; vi.useRealTimers(); });

describe('image generation network deadlines', () => {
  it('aligns response transport deadlines with a long generation request', async () => {
    await fetchWithNetworkPolicy('https://image.example/v1/images/generations', {
      purpose: 'provider-api', timeoutMs: 600_000,
      fetchImpl: async () => new Response('{}'),
    });
    expect(agentOptions).toEqual([expect.objectContaining({
      headersTimeout: 600_000, bodyTimeout: 600_000,
      connect: expect.objectContaining({ timeout: 30_000 }),
    })]);
  });

  it('accepts a response after three minutes and still enforces the overall deadline', async () => {
    vi.useFakeTimers();
    let settled = false;
    const response = fetchWithNetworkPolicy('https://image.example/v1/images/generations', {
      purpose: 'provider-api', timeoutMs: 600_000,
      fetchImpl: async (_url, init) => new Promise<Response>((resolve, reject) => {
        setTimeout(() => resolve(new Response('{}')), 360_000);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    }).then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(180_001);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(179_999);
    expect((await response).status).toBe(200);

    const timeout = fetchWithNetworkPolicy('https://image.example/v1/images/generations', {
      purpose: 'provider-api', timeoutMs: 600_000,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    });
    const rejected = expect(timeout).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(600_000);
    await rejected;
  });
});
