import { describe, expect, it, vi } from 'vitest';
import { aiHotArchiveKey, loadAiHotArchive, loadHotBoardArchive } from '../src/shared/hotboard-archive';
import type {
  AiHotQueryRequest,
  AiHotQueryResult,
  HotBoardArchiveStore,
  HotBoardSnapshot,
} from '../src/shared/types';

const TODAY = new Date('2026-08-10T04:00:00.000Z');

function hotBoardSnapshot(label: string): HotBoardSnapshot {
  return {
    fetchedAt: `2026-08-10T04:0${label.length}:00.000Z`,
    items: [],
    platformStatuses: [],
    sourceAssessments: [],
    warnings: [label],
  };
}

function aiHotResult(label: string): AiHotQueryResult {
  return {
    kind: 'items',
    mode: 'selected',
    requestedAt: '2026-08-10T04:00:00.000Z',
    receivedAt: '2026-08-10T04:00:01.000Z',
    queryLabel: label,
    unchanged: false,
    warnings: [],
    items: [],
    count: 0,
    hasMore: false,
    fallbackToAll: false,
  };
}

class MemoryArchiveStore implements HotBoardArchiveStore {
  readonly hotBoard = new Map<string, HotBoardSnapshot>();
  readonly aiHot = new Map<string, { request: AiHotQueryRequest; result: AiHotQueryResult }>();

  async getHotBoardSnapshot(date: string) { return this.hotBoard.get(date) ?? null; }
  async saveHotBoardSnapshot(date: string, snapshot: HotBoardSnapshot) { this.hotBoard.set(date, snapshot); }
  async listHotBoardSnapshotDates() { return [...this.hotBoard.keys()].sort().reverse(); }
  async getAiHotSnapshot(date: string, queryKey: string) { return this.aiHot.get(`${date}:${queryKey}`)?.result ?? null; }
  async saveAiHotSnapshot(date: string, queryKey: string, request: AiHotQueryRequest, result: AiHotQueryResult) {
    this.aiHot.set(`${date}:${queryKey}`, { request, result });
  }
  async listAiHotSnapshotDates() {
    return [...new Set([...this.aiHot.keys()].map((key) => key.slice(0, 10)))].sort().reverse();
  }
}

describe('daily information archive', () => {
  it('fetches once when today has no hot-board snapshot, then serves the saved snapshot', async () => {
    const store = new MemoryArchiveStore();
    const fetchSnapshot = vi.fn(async () => hotBoardSnapshot('first'));

    const first = await loadHotBoardArchive(store, {}, fetchSnapshot, () => TODAY);
    const second = await loadHotBoardArchive(store, {}, fetchSnapshot, () => TODAY);

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ archiveDate: '2026-08-10', origin: 'network' });
    expect(second).toMatchObject({ archiveDate: '2026-08-10', origin: 'cache' });
    expect(second.snapshot?.warnings).toEqual(['first']);
    expect(second.availableDates).toEqual(['2026-08-10']);
  });

  it('only replaces today when refresh is explicitly forced', async () => {
    const store = new MemoryArchiveStore();
    store.hotBoard.set('2026-08-10', hotBoardSnapshot('saved'));
    const fetchSnapshot = vi.fn(async () => hotBoardSnapshot('manual'));

    const result = await loadHotBoardArchive(store, { forceRefresh: true }, fetchSnapshot, () => TODAY);

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(result.origin).toBe('network');
    expect(result.snapshot?.warnings).toEqual(['manual']);
  });

  it('never fabricates a missing historical hot-board snapshot from the live network', async () => {
    const store = new MemoryArchiveStore();
    const fetchSnapshot = vi.fn(async () => hotBoardSnapshot('unexpected'));

    const result = await loadHotBoardArchive(store, { date: '2026-08-09', forceRefresh: true }, fetchSnapshot, () => TODAY);

    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({ archiveDate: '2026-08-09', origin: 'missing', snapshot: null });
  });

  it('uses a stable AIHOT query key and caches each query once per archive date', async () => {
    const store = new MemoryArchiveStore();
    const query = { mode: 'category', category: 'paper', window: '7d' } as const;
    const fetchQuery = vi.fn(async () => aiHotResult('论文'));

    const first = await loadAiHotArchive(store, { query }, fetchQuery, () => TODAY);
    const second = await loadAiHotArchive(store, { query }, fetchQuery, () => TODAY);

    expect(aiHotArchiveKey(query)).toBe('category:paper:7d');
    expect(fetchQuery).toHaveBeenCalledTimes(1);
    expect(first.origin).toBe('network');
    expect(second.origin).toBe('cache');
    expect(second.availableDates).toEqual(['2026-08-10']);
  });

  it('binds AIHOT daily reports to the selected archive date and keeps missing history offline', async () => {
    const store = new MemoryArchiveStore();
    const fetchQuery = vi.fn(async () => aiHotResult('日报'));

    const result = await loadAiHotArchive(
      store,
      { date: '2026-08-09', query: { mode: 'daily' } },
      fetchQuery,
      () => TODAY,
    );

    expect(fetchQuery).not.toHaveBeenCalled();
    expect(result).toMatchObject({ archiveDate: '2026-08-09', origin: 'missing', result: null });
    expect(aiHotArchiveKey({ mode: 'daily', date: '2026-08-09' })).toBe('daily:2026-08-09');
  });
});
