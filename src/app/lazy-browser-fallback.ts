import type { StoryDreamApi } from '../shared/storydream-api';
import type { AppDelta } from '../shared/types';
import type { RendererAppState as AppState } from './route-types';

export function makeLazyFallbackApi(setState: (state: AppState) => void): StoryDreamApi {
  let loaded: Promise<StoryDreamApi> | null = null;
  const load = () => {
    loaded ??= import('./browser-fallback').then((module) => module.makeFallbackApi(setState));
    return loaded;
  };

  return new Proxy({} as StoryDreamApi, {
    get(_target, property) {
      if (property === 'onAppDelta') {
        return (callback: (delta: AppDelta) => void) => {
          let disposed = false;
          let unsubscribe: (() => void) | undefined;
          void load().then((api) => {
            if (!disposed) unsubscribe = api.onAppDelta(callback);
          });
          return () => {
            disposed = true;
            unsubscribe?.();
          };
        };
      }
      return (...args: unknown[]) => load().then((api) => {
        const method = api[property as keyof StoryDreamApi];
        if (typeof method !== 'function') throw new Error(`Browser fallback method is unavailable: ${String(property)}`);
        return Reflect.apply(method, api, args) as unknown;
      });
    },
  });
}
