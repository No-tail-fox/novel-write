import { describe, expect, it } from 'vitest';
import { installPreloadRecovery } from '../src/app/preload-recovery';

type RecoveryTarget = Parameters<typeof installPreloadRecovery>[0];

function preloadError(message: string): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  Object.defineProperty(event, 'payload', { value: new Error(message) });
  return event;
}

describe('renderer preload recovery', () => {
  it('reloads once per stale chunk signature and removes its listener on cleanup', () => {
    const stored = new Map<string, string>();
    let listener: EventListener | null = null;
    let reloadCount = 0;
    const target = {
      addEventListener: (_type: string, next: EventListenerOrEventListenerObject) => {
        listener = next as EventListener;
      },
      removeEventListener: (_type: string, next: EventListenerOrEventListenerObject) => {
        if (listener === next) listener = null;
      },
      location: { reload: () => { reloadCount += 1; } },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { stored.set(key, value); },
      },
    } as unknown as RecoveryTarget;
    const dispatch = (event: Event) => {
      const current = listener as EventListener | null;
      if (!current) throw new Error('preload listener was not installed');
      current(event);
    };

    const uninstall = installPreloadRecovery(target);
    const first = preloadError('QueuePage-old.js');
    dispatch(first);
    expect(first.defaultPrevented).toBe(true);
    expect(reloadCount).toBe(1);

    const repeated = preloadError('QueuePage-old.js');
    dispatch(repeated);
    expect(repeated.defaultPrevented).toBe(false);
    expect(reloadCount).toBe(1);

    const nextBuild = preloadError('QueuePage-next.js');
    dispatch(nextBuild);
    expect(nextBuild.defaultPrevented).toBe(true);
    expect(reloadCount).toBe(2);

    uninstall();
    expect(listener).toBeNull();
  });

  it('uses in-memory deduplication when session storage is blocked', () => {
    let listener: EventListener | null = null;
    let reloadCount = 0;
    const target = {
      addEventListener: (_type: string, next: EventListenerOrEventListenerObject) => {
        listener = next as EventListener;
      },
      removeEventListener: () => undefined,
      location: { reload: () => { reloadCount += 1; } },
      sessionStorage: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
      },
    } as unknown as RecoveryTarget;
    const dispatch = (event: Event) => {
      const current = listener as EventListener | null;
      if (!current) throw new Error('preload listener was not installed');
      current(event);
    };

    installPreloadRecovery(target);
    dispatch(preloadError('HistoryPage-old.js'));
    dispatch(preloadError('HistoryPage-old.js'));
    expect(reloadCount).toBe(1);
  });
});
