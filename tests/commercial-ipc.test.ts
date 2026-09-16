import { describe, expect, it } from 'vitest';
import { commercialRequestSchema, createUnavailableCommercialApi, createCommercialBridge, dispatchCommercialRequest } from '../src/shared/commercial-ipc';
import { formatCredits } from '../src/shared/commercial-contract';

describe('commercial IPC boundary', () => {
  it('does not expose a generic URL, token, balance or activation setter', () => {
    for (const method of ['fetch', 'setBalance', 'setToken', 'setActivation', '__proto__', 'constructor']) {
      expect(commercialRequestSchema.safeParse({ method, args: [] }).success).toBe(false);
    }
    expect(commercialRequestSchema.safeParse({ method: 'updateProfile', args: [{ displayName: 'creator', balance: '999999' }] }).success).toBe(false);
  });
  it('rejects malformed payment and quote commands before forwarding', () => {
    expect(commercialRequestSchema.safeParse({ method: 'createOrder', args: [{ productId: 'x', version: '1', operationId: 'bad', creditUnits: '5000' }] }).success).toBe(false);
    expect(commercialRequestSchema.safeParse({ method: 'submit', args: [{ quoteId: 'quote', operationId: '550e8400-e29b-41d4-a716-446655440000', reservedUnits: '0' }] }).success).toBe(false);
    expect(commercialRequestSchema.safeParse({ method: 'quote', args: [{ modelId: 'music', operation: 'music.generate', params: {}, url: 'http://internal' }] }).success).toBe(false);
  });
  it('normalizes display names and passes only declared arguments', async () => {
    const received: unknown[] = [];
    const api = createCommercialBridge(async input => { received.push(input); return {}; });
    await dispatchCommercialRequest(api, { method: 'updateProfile', args: ['  创作工作室  '] });
    expect(received).toEqual([{ method: 'updateProfile', args: ['创作工作室'] }]);
    await expect(dispatchCommercialRequest(api, { method: 'getSnapshot', args: ['token'] })).rejects.toThrow();
  });
  it('keeps browser preview explicitly unavailable with no simulated wallet', async () => {
    const api = createUnavailableCommercialApi();
    expect(await api.getSnapshot()).toMatchObject({ authenticated: false, wallet: null, license: null, configured: false });
    await expect(api.redeem('DEMO')).rejects.toThrow('COMMERCIAL_UNAVAILABLE');
    await expect(api.createOrder({ productId: 'x', version: '1', operationId: 'op' })).rejects.toThrow('COMMERCIAL_UNAVAILABLE');
  });
  it('formats credit integers beyond Number safe range without losing units', () => {
    expect(formatCredits('9007199254740993123')).toBe('9,007,199,254,740,993.123');
    expect(formatCredits('1000')).toBe('1');
    expect(formatCredits('-1')).toBe('-0.001');
  });
});
