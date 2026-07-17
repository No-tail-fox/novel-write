import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { HistoryFamily, HistoryPage } from '../../shared/types';
import {
  canonicalHistoryPageRequest,
  createHistoryPageStore,
  historyPageRequestKey,
  historyPageTransportSignature,
  type FamilyHistoryRequest,
  type HistoryPageNavigation,
  type HistoryPageSnapshot,
} from './history-page-store';

export type HistoryPageLoader<F extends HistoryFamily, T extends { id: string }> = (
  request: FamilyHistoryRequest<F>,
) => Promise<HistoryPage<F, T>>;

export type HistoryTombstoneBarrier<F extends HistoryFamily> = (family: F, id: string) => boolean;

export interface HistoryPageRequestState<F extends HistoryFamily, T extends { id: string }> {
  key: string;
  transportSignature: string;
  epoch: number;
  request: FamilyHistoryRequest<F> | null;
  cursor: string | null;
  page: HistoryPage<F, T> | null;
  hasPrevious: boolean;
  loading: boolean;
  error: Error | null;
}

export interface HistoryPageRequestController<F extends HistoryFamily, T extends { id: string }> {
  activate: (request: FamilyHistoryRequest<F>, epoch: number) => boolean;
  load: (loadPage: HistoryPageLoader<F, T>, isTombstoned: HistoryTombstoneBarrier<F>) => Promise<void>;
  next: (expectedKey?: string) => HistoryPageNavigation | null;
  previous: (expectedKey?: string) => HistoryPageNavigation | null;
  reload: (expectedKey?: string) => HistoryPageNavigation | null;
  removeTombstone: (family: HistoryFamily, id: string, expectedKey?: string) => HistoryPageNavigation | null;
  cancel: () => void;
  mount: () => void;
  unmount: () => void;
  current: () => HistoryPageRequestState<F, T>;
  subscribe: (listener: () => void) => () => void;
}

export interface UseHistoryPageOptions<F extends HistoryFamily, T extends { id: string }> {
  family: F;
  request: FamilyHistoryRequest<F>;
  loadPage: HistoryPageLoader<F, T>;
  isTombstoned: HistoryTombstoneBarrier<F>;
  familyEpoch?: number;
}

export interface UseHistoryPageResult<F extends HistoryFamily, T extends { id: string }> {
  page: HistoryPage<F, T> | null;
  loading: boolean;
  error: Error | null;
  hasPrevious: boolean;
  next: () => void;
  previous: () => void;
  reload: () => void;
  removeTombstone: (family: HistoryFamily, id: string) => void;
}

function normalizeHistoryPageError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function stateFromSnapshot<F extends HistoryFamily, T extends { id: string }>(
  snapshot: HistoryPageSnapshot<F, T>,
  epoch: number,
  transportSignature: string,
  loading: boolean,
  error: Error | null,
): HistoryPageRequestState<F, T> {
  return {
    key: snapshot.key,
    transportSignature,
    epoch,
    request: snapshot.request,
    cursor: snapshot.cursor,
    page: snapshot.page,
    hasPrevious: snapshot.hasPrevious,
    loading,
    error,
  };
}

export function createHistoryPageRequestController<F extends HistoryFamily, T extends { id: string }>(
  family: F,
): HistoryPageRequestController<F, T> {
  const store = createHistoryPageStore<F, T>(family);
  const listeners = new Set<() => void>();
  let mounted = true;
  let generation = 0;
  let state: HistoryPageRequestState<F, T> = {
    key: '',
    transportSignature: '',
    epoch: 0,
    request: null,
    cursor: null,
    page: null,
    hasPrevious: false,
    loading: false,
    error: null,
  };

  const publish = (next: HistoryPageRequestState<F, T>): void => {
    state = next;
    if (!mounted) return;
    listeners.forEach((listener) => listener());
  };

  const isCurrent = (token: number, key: string, epoch: number, transportSignature: string): boolean => (
    mounted
    && generation === token
    && state.key === key
    && state.epoch === epoch
    && state.transportSignature === transportSignature
  );

  const move = (
    expectedKey: string | undefined,
    navigate: () => HistoryPageNavigation | null,
  ): HistoryPageNavigation | null => {
    if (!mounted || !state.request || (expectedKey !== undefined && state.key !== expectedKey)) return null;
    const navigation = navigate();
    if (!navigation) return null;
    generation += 1;
    publish(stateFromSnapshot(store.current(), state.epoch, state.transportSignature, false, null));
    return navigation;
  };

  const controller: HistoryPageRequestController<F, T> = {
    activate(incoming, incomingEpoch) {
      const request = canonicalHistoryPageRequest(family, incoming);
      const key = historyPageRequestKey(family, request);
      const transportSignature = historyPageTransportSignature(family, request);
      const epoch = Math.max(state.epoch, incomingEpoch);
      const keyChanged = state.key !== key;
      const epochChanged = epoch !== state.epoch;
      const transportChanged = state.transportSignature !== transportSignature;
      if (!keyChanged && !epochChanged && !transportChanged) return false;
      generation += 1;
      if (epochChanged) store.invalidateFamily();
      store.begin(request);
      publish(stateFromSnapshot(store.current(), epoch, transportSignature, false, null));
      return true;
    },
    async load(loadPage, isTombstoned) {
      if (!mounted || !state.request) return;
      const pending = store.begin(state.request);
      const key = state.key;
      const epoch = state.epoch;
      const transportSignature = state.transportSignature;
      generation += 1;
      const token = generation;
      publish(stateFromSnapshot(store.current(), epoch, transportSignature, true, null));
      try {
        const page = await loadPage(pending.request);
        if (!isCurrent(token, key, epoch, transportSignature)) return;
        if (!store.accept(pending.token, page, isTombstoned)) return;
        const accepted = store.current();
        publish(stateFromSnapshot(accepted, epoch, transportSignature, true, null));
        if (!accepted.page) await controller.load(loadPage, isTombstoned);
      } catch (error) {
        if (isCurrent(token, key, epoch, transportSignature)) {
          publish({ ...state, loading: false, error: normalizeHistoryPageError(error) });
        }
      } finally {
        if (isCurrent(token, key, epoch, transportSignature) && state.loading) {
          publish({ ...state, loading: false });
        }
      }
    },
    next: (expectedKey) => move(expectedKey, () => store.next()),
    previous: (expectedKey) => move(expectedKey, () => store.previous()),
    reload: (expectedKey) => move(expectedKey, () => store.reload()),
    removeTombstone(incomingFamily, id, expectedKey) {
      return move(expectedKey, () => store.removeTombstone(incomingFamily, id));
    },
    cancel() {
      generation += 1;
      if (!state.loading) return;
      if (mounted) publish({ ...state, loading: false });
      else state = { ...state, loading: false };
    },
    mount() {
      mounted = true;
    },
    unmount() {
      mounted = false;
      generation += 1;
      listeners.clear();
      if (state.loading) state = { ...state, loading: false };
    },
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return controller;
}

export function useHistoryPage<F extends HistoryFamily, T extends { id: string }>(
  options: UseHistoryPageOptions<F, T>,
): UseHistoryPageResult<F, T> {
  const controller = useMemo(
    () => createHistoryPageRequestController<F, T>(options.family),
    [options.family],
  );
  const key = historyPageRequestKey(options.family, options.request);
  const transportSignature = historyPageTransportSignature(options.family, options.request);
  const epoch = Math.max(0, options.familyEpoch ?? 0);
  const loadPageRef = useRef(options.loadPage);
  const isTombstonedRef = useRef(options.isTombstoned);
  const committedKeyRef = useRef('');

  useLayoutEffect(() => {
    loadPageRef.current = options.loadPage;
    isTombstonedRef.current = options.isTombstoned;
  }, [options.isTombstoned, options.loadPage]);

  useLayoutEffect(() => {
    committedKeyRef.current = key;
    controller.activate(options.request, epoch);
  }, [controller, epoch, key, options.request, transportSignature]);

  useLayoutEffect(() => {
    controller.mount();
    return () => controller.unmount();
  }, [controller]);

  useEffect(() => {
    void controller.load(loadPageRef.current, isTombstonedRef.current);
    return () => controller.cancel();
  }, [controller, epoch, key, transportSignature]);

  const navigate = useCallback((move: (expectedKey: string) => HistoryPageNavigation | null) => {
    const expectedKey = committedKeyRef.current;
    if (!move(expectedKey)) return;
    void controller.load(loadPageRef.current, isTombstonedRef.current);
  }, [controller]);

  const next = useCallback(() => navigate(controller.next), [controller.next, navigate]);
  const previous = useCallback(() => navigate(controller.previous), [controller.previous, navigate]);
  const reload = useCallback(() => navigate(controller.reload), [controller.reload, navigate]);
  const removeTombstone = useCallback((family: HistoryFamily, id: string) => {
    const expectedKey = committedKeyRef.current;
    if (!controller.removeTombstone(family, id, expectedKey)) return;
    void controller.load(loadPageRef.current, isTombstonedRef.current);
  }, [controller]);

  const current = useSyncExternalStore(controller.subscribe, controller.current, controller.current);
  const canPublish = current.key === key
    && current.epoch === epoch
    && current.transportSignature === transportSignature;
  return {
    page: canPublish ? current.page : null,
    loading: canPublish ? current.loading : true,
    error: canPublish ? current.error : null,
    hasPrevious: canPublish && current.hasPrevious,
    next,
    previous,
    reload,
    removeTombstone,
  };
}
