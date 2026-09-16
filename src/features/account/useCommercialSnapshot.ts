import { useEffect, useSyncExternalStore } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { CommercialSnapshot } from '../../shared/commercial-contract';
import { getCommercialStore } from './commercial-store';

export const commercialChangedEvent = 'storydream:commercial-changed';
export function notifyCommercialChanged(api: StoryDreamApi, snapshot?: CommercialSnapshot) {
  const store = getCommercialStore(api.commercial);
  if (snapshot) store.replace(snapshot);
  else void store.refresh();
  window.dispatchEvent(new CustomEvent(commercialChangedEvent, { detail: { api, snapshot } }));
}

export function useCommercialSnapshot(api: StoryDreamApi) {
  const store = getCommercialStore(api.commercial);
  const view = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => {
    if (!store.getState().snapshot && !store.getState().loading) void store.refresh();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ api?: StoryDreamApi }>).detail;
      // Our own mutations have already published their authoritative response.
      if (detail?.api === api) return;
      void store.refresh(true);
    };
    window.addEventListener(commercialChangedEvent, changed);
    return () => window.removeEventListener(commercialChangedEvent, changed);
  }, [api, store]);
  return { ...view, refresh: store.refresh, clear: store.clear, replace: store.replace };
}
