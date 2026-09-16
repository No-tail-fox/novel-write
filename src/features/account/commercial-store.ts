import type { CommercialApi, CommercialSnapshot } from '../../shared/commercial-contract';

export interface CommercialViewState { snapshot: CommercialSnapshot | null; loading: boolean; error: string }

/** One authoritative renderer view per desktop bridge. Requests from an old account cannot win. */
export function createCommercialStore(api: CommercialApi) {
  let state: CommercialViewState = { snapshot: null, loading: false, error: '' };
  let generation = 0;
  const listeners = new Set<() => void>();
  function publish(next: CommercialViewState) { state = next; listeners.forEach((listener) => listener()); }
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear() { generation++; publish({ snapshot: null, loading: true, error: '' }); },
    replace(snapshot: CommercialSnapshot) { generation++; publish({ snapshot, loading: false, error: '' }); },
    async refresh(clear = false) {
      const current = ++generation;
      publish({ snapshot: clear ? null : state.snapshot, loading: true, error: '' });
      try {
        const snapshot = await api.getSnapshot();
        if (generation === current) publish({ snapshot, loading: false, error: '' });
      } catch (error) {
        if (generation === current) publish({ snapshot: null, loading: false, error: error instanceof Error ? error.message : '账号状态读取失败，请重试。' });
      }
    },
  };
}

export type CommercialStore = ReturnType<typeof createCommercialStore>;
const stores = new WeakMap<CommercialApi, CommercialStore>();
export function getCommercialStore(api: CommercialApi): CommercialStore {
  let store = stores.get(api);
  if (!store) { store = createCommercialStore(api); stores.set(api, store); }
  return store;
}
