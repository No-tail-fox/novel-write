import type { HistoryFamily } from '../src/shared/types';

export interface HistoryActivityReservation {
  release(): void;
}

type HistoryActivityKind = 'active' | 'governance';

interface ReservationState {
  kind: HistoryActivityKind;
  token: symbol;
}

export class HistoryActivityRegistry {
  private readonly reservations = new Map<string, ReservationState>();
  private readonly idleWaiters = new Set<() => void>();
  private closed = false;

  reserveActive(family: HistoryFamily, id: string): HistoryActivityReservation {
    return this.reserve(family, id, 'active');
  }

  reserveGovernance(family: HistoryFamily, id: string): HistoryActivityReservation {
    return this.reserve(family, id, 'governance');
  }

  close(): void {
    this.closed = true;
  }

  waitForIdle(): Promise<void> {
    if (this.reservations.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  private reserve(
    family: HistoryFamily,
    id: string,
    kind: HistoryActivityKind,
  ): HistoryActivityReservation {
    if (this.closed) {
      throw new Error('HISTORY_ACTIVITY_CLOSED: History activity registry is closed for shutdown.');
    }
    const key = JSON.stringify([family, id]);
    const existing = this.reservations.get(key);
    if (existing) {
      const boundedId = id.length <= 96 ? id : `${id.slice(0, 93)}...`;
      throw new Error(
        `HISTORY_ACTIVITY_CONFLICT: ${family} ${boundedId} already has a ${existing.kind} reservation; cannot reserve ${kind}.`,
      );
    }

    const token = Symbol(kind);
    this.reservations.set(key, { kind, token });
    let released = false;
    return Object.freeze({
      release: () => {
        if (released) return;
        released = true;
        if (this.reservations.get(key)?.token === token) {
          this.reservations.delete(key);
          if (this.reservations.size === 0) {
            for (const resolve of this.idleWaiters) resolve();
            this.idleWaiters.clear();
          }
        }
      },
    });
  }
}
