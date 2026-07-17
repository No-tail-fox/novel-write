import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createHistoryPageStore } from '../src/features/history/history-page-store';
import { createHistoryPageRequestController } from '../src/features/history/use-history-page';
import type { HistoryFamily, HistoryPage } from '../src/shared/types';

type Item = { id: string };

function item(id: string): Item {
  return { id };
}

function page<F extends HistoryFamily>(
  family: F,
  items: Item[] = [],
  nextCursor: string | null = null,
  totalCount = items.length,
): HistoryPage<F, Item> {
  return {
    family,
    items,
    totalCount,
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('history page store', () => {
  it('canonicalizes task conditions while keeping the cursor outside the stable request key', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const request = store.begin({
      family: 'task',
      filter: 'active',
      statuses: ['paused', 'running', 'paused'],
      query: '  标题  ',
      cursor: 'renderer-must-not-own-this',
    });

    expect(JSON.parse(request.key)).toEqual({
      family: 'task',
      filter: 'active',
      statuses: ['running', 'paused'],
      query: '标题',
    });
    expect(request.cursor).toBeNull();
    expect(request.request).toEqual({
      family: 'task',
      filter: 'active',
      statuses: ['running', 'paused'],
      query: '标题',
      cursor: null,
    });
  });

  it('owns an independent cursor stack per canonical query and rejects a stale query token', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const active = store.begin({
      family: 'task',
      filter: 'active',
      statuses: ['paused', 'running'],
      query: '  标题  ',
    });
    expect(store.accept(active.token, page('task', [item('active-1')], 'next-a'))).toBe(true);
    expect(store.next()).toEqual({ cursor: 'next-a' });
    expect(store.begin({ family: 'task', filter: 'active', statuses: ['running', 'paused'], query: '标题' }).cursor)
      .toBe('next-a');

    const archived = store.begin({ family: 'task', filter: 'archived' });
    expect(archived.cursor).toBeNull();
    expect(store.accept(active.token, page('task', [item('late-active')]))).toBe(false);
    expect(store.accept(archived.token, page('task', [item('archived-1')]))).toBe(true);

    const switchedBack = store.begin({ family: 'task', filter: 'active', statuses: ['paused', 'running'], query: '标题' });
    expect(switchedBack.cursor).toBeNull();
    expect(store.current().cursors).toEqual([null]);
    expect(store.accept(active.token, page('task', [item('late-active')]))).toBe(false);
    expect(store.previous()).toBeNull();
  });

  it('bounds query ownership to the active entry after high-cardinality condition changes', async () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const first = store.begin({ family: 'task', filter: 'active', query: 'query-0' });
    expect(store.accept(first.token, page('task', [item('old-page')], 'old-next'))).toBe(true);
    expect(store.next()).toEqual({ cursor: 'old-next' });

    for (let index = 1; index <= 256; index += 1) {
      const request = store.begin({ family: 'task', filter: 'active', query: `query-${index}` });
      expect(store.accept(request.token, page('task', [item(`item-${index}`)]))).toBe(true);
    }

    const returned = store.begin({ family: 'task', filter: 'active', query: 'query-0' });
    expect(returned.cursor).toBeNull();
    expect(store.current()).toMatchObject({ cursors: [null], page: null });
    expect(store.accept(first.token, page('task', [item('stale-old-page')]))).toBe(false);

    const source = await readFile(new URL('../src/features/history/history-page-store.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('new Map<string, QueryEntry');
  });

  it.each(['task', 'viral-analysis', 'image-lab', 'voice-lab'] as const)(
    'removes a %s tombstone without touching a different family',
    (family) => {
      const store = createHistoryPageStore<typeof family, Item>(family);
      const request = store.begin({ family, filter: 'active' } as Parameters<typeof store.begin>[0]);
      expect(store.accept(request.token, page(family, [item('keep'), item('delete')]))).toBe(true);

      expect(store.removeTombstone(family, 'delete')).toEqual({ cursor: null });
      expect(store.current().page?.items).toEqual([item('keep')]);
      expect(store.removeTombstone(family === 'task' ? 'voice-lab' : 'task', 'keep')).toBeNull();
      expect(store.current().page?.items).toEqual([item('keep')]);
    },
  );

  it('reloads the current cursor after governance and backs up before reloading an emptied page', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const first = store.begin({ family: 'task', filter: 'archived' });
    store.accept(first.token, page('task', [item('first')], 'page-2'));
    expect(store.next()).toEqual({ cursor: 'page-2' });
    const second = store.begin({ family: 'task', filter: 'archived' });
    store.accept(second.token, page('task', [item('only-on-page-2')]));

    expect(store.reload()).toEqual({ cursor: 'page-2' });
    expect(store.accept(second.token, page('task', [item('late')]))).toBe(false);
    expect(store.removeTombstone('task', 'only-on-page-2')).toEqual({ cursor: null });
    expect(store.current().cursor).toBeNull();
    expect(store.current().page).toBeNull();
  });

  it('filters tombstoned ids again when accepting a late list response', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const request = store.begin({ family: 'task', filter: 'archived' });

    expect(store.accept(
      request.token,
      page('task', [item('deleted-while-loading'), item('safe')]),
      (family, id) => family === 'task' && id === 'deleted-while-loading',
    )).toBe(true);
    expect(store.current().page?.items).toEqual([item('safe')]);
  });

  it('backs up when tombstone filtering empties a late non-first page response', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const first = store.begin({ family: 'task', filter: 'archived' });
    store.accept(first.token, page('task', [item('first')], 'page-2'));
    store.next();
    const second = store.begin({ family: 'task', filter: 'archived' });

    expect(store.accept(
      second.token,
      page('task', [item('deleted-while-loading')]),
      (_family, id) => id === 'deleted-while-loading',
    )).toBe(true);
    expect(store.current().cursor).toBeNull();
    expect(store.current().page).toBeNull();
  });

  it('does not navigate an empty cursor', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const first = store.begin({ family: 'task', filter: 'active' });
    expect(store.accept(first.token, page('task', [item('first')], ''))).toBe(true);

    expect(store.next()).toBeNull();
    expect(store.current().cursor).toBeNull();
  });

  it('clears controller-local tombstones on family invalidation while retaining the external barrier', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const initial = store.begin({ family: 'task', filter: 'archived' });
    store.accept(initial.token, page('task', [item('visible')]));
    for (let index = 0; index < 256; index += 1) {
      store.removeTombstone('task', `deleted-${index}`);
    }

    expect(store.invalidateFamily()).toEqual({ cursor: null });
    const afterInvalidation = store.begin({ family: 'task', filter: 'archived' });
    expect(store.accept(
      afterInvalidation.token,
      page('task', [item('deleted-255')]),
      () => false,
    )).toBe(true);
    expect(store.current().page?.items).toEqual([item('deleted-255')]);

    const guarded = store.begin({ family: 'task', filter: 'archived' });
    expect(store.accept(
      guarded.token,
      page('task', [item('deleted-255')]),
      (_family, id) => id === 'deleted-255',
    )).toBe(true);
    expect(store.current().page?.items).toEqual([]);
  });

  it('resets the active cursor when the store transport limit changes', () => {
    const store = createHistoryPageStore<'task', Item>('task');
    const first = store.begin({ family: 'task', filter: 'active', limit: 10 });
    expect(store.accept(first.token, page('task', [item('first')], 'page-2', 2))).toBe(true);
    expect(store.next()).toEqual({ cursor: 'page-2' });
    const second = store.begin({ family: 'task', filter: 'active', limit: 10 });
    expect(store.accept(second.token, page('task', [item('second')], null, 1))).toBe(true);
    const inFlight = store.begin({ family: 'task', filter: 'active', limit: 10 });

    const resized = store.begin({ family: 'task', filter: 'active', limit: 20 });

    expect(resized).toMatchObject({ cursor: null, request: { cursor: null, limit: 20 } });
    expect(store.current()).toMatchObject({ cursors: [null], page: null });
    expect(store.accept(inFlight.token, page('task', [item('late-page-two')]))).toBe(false);
  });

  it('resets the cursor and reloads when only the transport limit changes', async () => {
    const controller = createHistoryPageRequestController<'task', Item>('task');
    const requests: Array<{ cursor?: string | null; limit?: number }> = [];
    const loadPage = vi.fn(async (request: { cursor?: string | null; limit?: number }) => {
      requests.push(request);
      return request.limit === 10
        ? page('task', [item('ten')], 'page-2', 2)
        : page('task', [item('twenty')], null, 1);
    });

    expect(controller.activate({ family: 'task', filter: 'active', limit: 10 }, 0)).toBe(true);
    await controller.load(loadPage, () => false);
    expect(controller.next()).toEqual({ cursor: 'page-2' });
    expect(controller.current().cursor).toBe('page-2');

    expect(controller.activate({ family: 'task', filter: 'active', limit: 20 }, 0)).toBe(true);
    expect(controller.current()).toMatchObject({ cursor: null, page: null });
    await controller.load(loadPage, () => false);

    expect(requests.map(({ cursor, limit }) => ({ cursor, limit }))).toEqual([
      { cursor: null, limit: 10 },
      { cursor: null, limit: 20 },
    ]);
    expect(controller.activate({ family: 'task', filter: 'active', limit: 20 }, 0)).toBe(false);
  });

  it('ignores a regressing family epoch without replacing the current snapshot', async () => {
    const controller = createHistoryPageRequestController<'task', Item>('task');
    const request = { family: 'task', filter: 'active' } as const;
    expect(controller.activate(request, 2)).toBe(true);
    await controller.load(async () => page('task', [item('fresh')]), () => false);
    const fresh = controller.current();

    expect(controller.activate(request, 1)).toBe(false);
    expect(controller.current()).toBe(fresh);
    expect(controller.current()).toMatchObject({ epoch: 2, page: { items: [item('fresh')] } });
  });

  it('invalidates an in-flight family epoch and reloads the same cursor before publishing', async () => {
    const controller = createHistoryPageRequestController<'task', Item>('task');
    const oldResponse = deferred<HistoryPage<'task', Item>>();
    const freshResponse = deferred<HistoryPage<'task', Item>>();
    const responses = [oldResponse, freshResponse];
    const requests: Array<{ cursor?: string | null }> = [];
    const loadPage = vi.fn((request: { cursor?: string | null }) => {
      requests.push(request);
      return responses.shift()!.promise;
    });
    const request = { family: 'task', filter: 'archived' } as const;

    controller.activate(request, 0);
    const oldLoad = controller.load(loadPage, () => false);
    controller.activate(request, 1);
    const freshLoad = controller.load(loadPage, () => false);
    oldResponse.resolve(page('task', [item('stale')], null, 99));
    await oldLoad;

    expect(requests.map((item) => item.cursor)).toEqual([null, null]);
    expect(controller.current().page).toBeNull();
    expect(controller.current().loading).toBe(true);

    freshResponse.resolve(page('task', [item('fresh')], null, 1));
    await freshLoad;
    expect(controller.current().page).toMatchObject({ items: [item('fresh')], totalCount: 1 });
    expect(controller.current().loading).toBe(false);
  });

  it('blocks an old query synchronously before the replacement query effect starts', async () => {
    const controller = createHistoryPageRequestController<'task', Item>('task');
    const oldResponse = deferred<HistoryPage<'task', Item>>();
    const requestA = { family: 'task', filter: 'active', query: 'A' } as const;
    const requestB = { family: 'task', filter: 'active', query: 'B' } as const;

    controller.activate(requestA, 0);
    const oldLoad = controller.load(() => oldResponse.promise, () => false);
    controller.activate(requestB, 0);
    oldResponse.resolve(page('task', [item('A-result')], null, 1));
    await oldLoad;

    expect(JSON.parse(controller.current().key)).toMatchObject({ query: 'B' });
    expect(controller.current().cursor).toBeNull();
    expect(controller.current().page).toBeNull();

    const requests: Array<{ cursor?: string | null; query?: string }> = [];
    await controller.load(async (request) => {
      requests.push(request);
      return page('task', [item('B-result')], null, 1);
    }, () => false);
    expect(requests).toEqual([expect.objectContaining({ cursor: null, query: 'B' })]);
    expect(controller.current().page?.items).toEqual([item('B-result')]);
  });

  it('recursively reloads the previous cursor when a tombstone empties page two', async () => {
    const controller = createHistoryPageRequestController<'task', Item>('task');
    const requests: Array<string | null | undefined> = [];
    const responses = [
      page('task', [item('first-old')], 'page-2', 2),
      page('task', [item('deleted')], null, 1),
      page('task', [item('first-fresh')], null, 1),
    ];
    const loadPage = vi.fn(async (request: { cursor?: string | null }) => {
      requests.push(request.cursor);
      return responses.shift()!;
    });

    controller.activate({ family: 'task', filter: 'archived' }, 0);
    await controller.load(loadPage, (_family, id) => id === 'deleted');
    expect(controller.next()).toEqual({ cursor: 'page-2' });
    await controller.load(loadPage, (_family, id) => id === 'deleted');

    expect(requests).toEqual([null, 'page-2', null]);
    expect(controller.current()).toMatchObject({
      cursor: null,
      loading: false,
      page: { items: [item('first-fresh')], totalCount: 1 },
    });
  });

  it('owns loading and error state while rejecting out-of-order and unmounted completions', async () => {
    const controller = createHistoryPageRequestController<'task', Item>('task');
    const failed = deferred<HistoryPage<'task', Item>>();
    controller.activate({ family: 'task', filter: 'active' }, 0);
    const failedLoad = controller.load(() => failed.promise, () => false);
    expect(controller.current()).toMatchObject({ loading: true, error: null });
    failed.reject(new Error('page failed'));
    await failedLoad;
    expect(controller.current()).toMatchObject({ loading: false, error: new Error('page failed') });

    const abandoned = deferred<HistoryPage<'task', Item>>();
    const abandonedLoad = controller.load(() => abandoned.promise, () => false);
    controller.unmount();
    abandoned.resolve(page('task', [item('must-not-publish')]));
    await abandonedLoad;
    expect(controller.current().page).toBeNull();
    expect(controller.current().loading).toBe(false);

    controller.mount();
    await controller.load(async () => page('task', [item('after-remount')]), () => false);
    expect(controller.current().page?.items).toEqual([item('after-remount')]);
  });

  it('publishes stable snapshot identities and detaches subscriptions on unsubscribe or unmount', async () => {
    const controller = createHistoryPageRequestController<'task', Item>('task');
    const snapshots: Array<ReturnType<typeof controller.current>> = [];
    const unsubscribe = controller.subscribe(() => snapshots.push(controller.current()));
    const initial = controller.current();
    expect(controller.current()).toBe(initial);

    controller.activate({ family: 'task', filter: 'active' }, 0);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toBe(controller.current());
    expect(controller.current()).not.toBe(initial);
    expect(controller.current()).toBe(controller.current());
    const activated = controller.current();
    expect(controller.activate({ family: 'task', filter: 'active' }, 0)).toBe(false);
    expect(controller.current()).toBe(activated);
    expect(snapshots).toHaveLength(1);

    unsubscribe();
    unsubscribe();
    const notificationsAfterUnsubscribe = snapshots.length;
    controller.reload();
    expect(snapshots).toHaveLength(notificationsAfterUnsubscribe);

    const firstSubscription = vi.fn();
    const cleanupFirst = controller.subscribe(firstSubscription);
    cleanupFirst();
    cleanupFirst();
    const secondSubscription = vi.fn();
    const cleanupSecond = controller.subscribe(secondSubscription);
    const beforeSecondPublish = controller.current();
    controller.reload();
    expect(firstSubscription).not.toHaveBeenCalled();
    expect(secondSubscription).toHaveBeenCalledTimes(1);
    expect(controller.current()).not.toBe(beforeSecondPublish);
    cleanupSecond();

    const abandoned = deferred<HistoryPage<'task', Item>>();
    const unmountNotifications = vi.fn();
    controller.subscribe(unmountNotifications);
    const abandonedLoad = controller.load(() => abandoned.promise, () => false);
    const notificationsBeforeUnmount = unmountNotifications.mock.calls.length;
    controller.unmount();
    const snapshotAfterUnmount = controller.current();
    expect(snapshotAfterUnmount.loading).toBe(false);

    controller.mount();
    const latest = deferred<HistoryPage<'task', Item>>();
    const latestLoad = controller.load(() => latest.promise, () => false);
    latest.resolve(page('task', [item('after-remount')]));
    await latestLoad;
    const latestSnapshot = controller.current();
    abandoned.resolve(page('task', [item('must-not-publish')]));
    await abandonedLoad;
    expect(controller.current()).toBe(latestSnapshot);
    expect(controller.current().page?.items).toEqual([item('after-remount')]);
    expect(unmountNotifications).toHaveBeenCalledTimes(notificationsBeforeUnmount);
  });
});
