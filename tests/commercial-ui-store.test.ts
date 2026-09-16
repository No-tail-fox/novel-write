import { describe, expect, it, vi } from 'vitest';
import type { CommercialApi, CommercialSnapshot } from '../src/shared/commercial-contract';
import { formatCredits, unconfiguredSnapshot } from '../src/shared/commercial-contract';
import { createCommercialStore } from '../src/features/account/commercial-store';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function account(id: string): CommercialSnapshot { return { ...unconfiguredSnapshot(), configured: true, authenticated: true, environment: 'production', user: { id, phone: '138****1234', displayName: id }, wallet: { availableUnits: '9007199254740993001', reservedUnits: '1001', frozenUnits: '0', revision: '1' } }; }

describe('commercial renderer account isolation', () => {
  it('discards an old account refresh after login replacement', async () => {
    const first = deferred<CommercialSnapshot>();
    const store = createCommercialStore({ getSnapshot: () => first.promise } as CommercialApi);
    const request = store.refresh();
    store.replace(account('new-user'));
    first.resolve(account('old-user'));
    await request;
    expect(store.getState().snapshot?.user?.id).toBe('new-user');
    expect(store.getState().loading).toBe(false);
  });

  it('clears balances immediately before logout and ignores late data', async () => {
    const pending = deferred<CommercialSnapshot>();
    const store = createCommercialStore({ getSnapshot: () => pending.promise } as CommercialApi);
    store.replace(account('old-user'));
    const refresh = store.refresh();
    store.clear();
    expect(store.getState().snapshot).toBeNull();
    pending.resolve(account('old-user'));
    await refresh;
    expect(store.getState().snapshot).toBeNull();
  });

  it('does not let an earlier error erase a successful later refresh', async () => {
    const old = deferred<CommercialSnapshot>();
    const getSnapshot = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValueOnce(account('current'));
    const store = createCommercialStore({ getSnapshot } as unknown as CommercialApi);
    const oldRequest = store.refresh();
    await store.refresh();
    old.reject(new Error('old connection failed'));
    await oldRequest;
    expect(store.getState().snapshot?.user?.id).toBe('current');
    expect(store.getState().error).toBe('');
  });

  it('removes privileged data when current session refresh fails', async () => {
    const store = createCommercialStore({ getSnapshot: async () => { throw new Error('会话已失效'); } } as unknown as CommercialApi);
    store.replace(account('expired'));
    await store.refresh();
    expect(store.getState()).toEqual({ snapshot: null, loading: false, error: '会话已失效' });
  });

  it('notifies subscribers without leaking updates after unsubscribe', () => {
    const store = createCommercialStore({} as CommercialApi);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.replace(account('a'));
    unsubscribe();
    store.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('renders ledger amounts without floating point loss, including reversals', () => {
    expect(formatCredits('9007199254740993001')).toBe('9,007,199,254,740,993.001');
    expect(formatCredits('-1001')).toBe('-1.001');
    expect(formatCredits('0')).toBe('0');
  });
});
