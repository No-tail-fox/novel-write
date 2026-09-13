import type {
  HistoryFamily,
  HistoryListRequest,
  HistoryPage,
  TaskStatus,
} from '../../shared/types';

const taskStatusOrder: readonly TaskStatus[] = [
  'draft',
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
];

export type FamilyHistoryRequest<F extends HistoryFamily> = Extract<HistoryListRequest, { family: F }>;

export interface HistoryPageLoad<F extends HistoryFamily> {
  key: string;
  token: number;
  cursor: string | null;
  request: FamilyHistoryRequest<F>;
}

export interface HistoryPageNavigation {
  cursor: string | null;
}

export interface HistoryPageSnapshot<F extends HistoryFamily, T extends { id: string }> {
  key: string;
  request: FamilyHistoryRequest<F>;
  cursor: string | null;
  cursors: readonly (string | null)[];
  page: HistoryPage<F, T> | null;
  hasPrevious: boolean;
}

export interface HistoryPageStore<F extends HistoryFamily, T extends { id: string }> {
  begin: (request: FamilyHistoryRequest<F>) => HistoryPageLoad<F>;
  accept: (
    token: number,
    page: HistoryPage<F, T>,
    isTombstoned?: (family: F, id: string) => boolean,
  ) => boolean;
  next: () => HistoryPageNavigation | null;
  previous: () => HistoryPageNavigation | null;
  reload: () => HistoryPageNavigation | null;
  invalidateFamily: () => HistoryPageNavigation | null;
  removeTombstone: (family: HistoryFamily, id: string) => HistoryPageNavigation | null;
  current: () => HistoryPageSnapshot<F, T>;
}

type CanonicalRequest = Record<string, unknown> & {
  family: HistoryFamily;
  filter: 'active' | 'archived';
};

interface QueryEntry<F extends HistoryFamily, T extends { id: string }> {
  key: string;
  transportSignature: string;
  request: FamilyHistoryRequest<F>;
  cursors: (string | null)[];
  page: HistoryPage<F, T> | null;
  token: number | null;
}

function canonicalTaskStatuses(statuses: readonly TaskStatus[]): TaskStatus[] {
  const included = new Set(statuses);
  return taskStatusOrder.filter((status) => included.has(status));
}

export function canonicalHistoryPageRequest<F extends HistoryFamily>(
  family: F,
  request: FamilyHistoryRequest<F>,
): FamilyHistoryRequest<F> {
  if (request.family !== family) {
    throw new Error(`HISTORY_FAMILY_MISMATCH: Expected ${family}, received ${request.family}.`);
  }
  const source = request as HistoryListRequest;
  const canonical: CanonicalRequest = {
    family,
    filter: source.filter ?? 'active',
  };
  if (family === 'task') {
    const taskRequest = source as Extract<HistoryListRequest, { family: 'task' }>;
    if (taskRequest.statuses !== undefined) {
      const statuses = canonicalTaskStatuses(taskRequest.statuses);
      if (statuses.length > 0) canonical.statuses = statuses;
    } else if (taskRequest.status !== undefined) {
      canonical.status = taskRequest.status;
    }
    if (taskRequest.taskType !== undefined) canonical.taskType = taskRequest.taskType;
    if (taskRequest.favorite !== undefined) canonical.favorite = taskRequest.favorite;
  } else if (source.status !== undefined) {
    canonical.status = source.status;
  }
  const query = source.query?.trim();
  if (query) canonical.query = query;
  if (source.limit !== undefined) canonical.limit = source.limit;
  return { ...canonical, cursor: null } as FamilyHistoryRequest<F>;
}

function canonicalRequestKey(request: HistoryListRequest): string {
  const { cursor: _cursor, limit: _limit, ...conditions } = request;
  return JSON.stringify(conditions);
}

function canonicalTransportSignature(request: HistoryListRequest): string {
  const { cursor: _cursor, ...transport } = request;
  return JSON.stringify(transport);
}

export function historyPageRequestKey<F extends HistoryFamily>(
  family: F,
  request: FamilyHistoryRequest<F>,
): string {
  return canonicalRequestKey(canonicalHistoryPageRequest(family, request));
}

export function historyPageTransportSignature<F extends HistoryFamily>(
  family: F,
  request: FamilyHistoryRequest<F>,
): string {
  return canonicalTransportSignature(canonicalHistoryPageRequest(family, request));
}

function requestAtCursor<F extends HistoryFamily>(
  request: FamilyHistoryRequest<F>,
  cursor: string | null,
): FamilyHistoryRequest<F> {
  return { ...request, cursor } as FamilyHistoryRequest<F>;
}

function clonePage<F extends HistoryFamily, T extends { id: string }>(
  page: HistoryPage<F, T>,
): HistoryPage<F, T> {
  return { ...page, items: [...page.items] };
}

export function createHistoryPageStore<F extends HistoryFamily, T extends { id: string }>(
  family: F,
): HistoryPageStore<F, T> {
  const tombstones = new Set<string>();
  let entry: QueryEntry<F, T> | null = null;
  let nextToken = 0;

  const activeEntry = (): QueryEntry<F, T> | null => entry;

  const snapshot = (): HistoryPageSnapshot<F, T> => {
    const entry = activeEntry();
    if (!entry) throw new Error('HISTORY_QUERY_NOT_STARTED: Call begin before reading page state.');
    const cursor = entry.cursors.at(-1) ?? null;
    return {
      key: entry.key,
      request: requestAtCursor(entry.request, cursor),
      cursor,
      cursors: [...entry.cursors],
      page: entry.page ? clonePage(entry.page) : null,
      hasPrevious: entry.cursors.length > 1,
    };
  };

  const navigate = (cursor: string | null): HistoryPageNavigation => ({ cursor });

  return {
    begin(incoming) {
      const request = canonicalHistoryPageRequest(family, incoming);
      const key = canonicalRequestKey(request);
      const transportSignature = canonicalTransportSignature(request);
      if (!entry || entry.key !== key) {
        entry = { key, transportSignature, request, cursors: [null], page: null, token: null };
      } else {
        const transportChanged = entry.transportSignature !== transportSignature;
        entry.transportSignature = transportSignature;
        entry.request = request;
        if (transportChanged) {
          entry.cursors = [null];
          entry.page = null;
          entry.token = null;
        }
      }
      nextToken += 1;
      entry.token = nextToken;
      const cursor = entry.cursors.at(-1) ?? null;
      return { key, token: nextToken, cursor, request: requestAtCursor(entry.request, cursor) };
    },
    accept(token, incoming, isTombstoned = () => false) {
      const entry = activeEntry();
      if (!entry || entry.token !== token || incoming.family !== family) return false;
      entry.token = null;
      const items = incoming.items.filter((item) => (
        !tombstones.has(item.id) && !isTombstoned(family, item.id)
      ));
      entry.page = {
        ...incoming,
        items,
        totalCount: Math.max(0, incoming.totalCount - (incoming.items.length - items.length)),
      };
      if (items.length === 0 && entry.cursors.length > 1) {
        entry.cursors.pop();
        entry.page = null;
      }
      return true;
    },
    next() {
      const entry = activeEntry();
      const cursor = entry?.page?.nextCursor ?? null;
      if (!entry || !cursor || entry.cursors.includes(cursor)) return null;
      entry.cursors.push(cursor);
      entry.page = null;
      entry.token = null;
      return navigate(cursor);
    },
    previous() {
      const entry = activeEntry();
      if (!entry || entry.cursors.length <= 1) return null;
      entry.cursors.pop();
      entry.page = null;
      entry.token = null;
      return navigate(entry.cursors.at(-1) ?? null);
    },
    reload() {
      const entry = activeEntry();
      if (!entry) return null;
      entry.token = null;
      return navigate(entry.cursors.at(-1) ?? null);
    },
    invalidateFamily() {
      tombstones.clear();
      const current = activeEntry();
      if (!current) return null;
      current.page = null;
      current.token = null;
      return navigate(current.cursors.at(-1) ?? null);
    },
    removeTombstone(incomingFamily, id) {
      if (incomingFamily !== family) return null;
      tombstones.add(id);
      const current = activeEntry();
      if (current?.page) {
        const items = current.page.items.filter((item) => item.id !== id);
        if (items.length !== current.page.items.length) {
          current.page = {
            ...current.page,
            items,
            totalCount: Math.max(0, current.page.totalCount - 1),
          };
        }
      }
      if (!current) return null;
      current.token = null;
      if (current.page?.items.length === 0 && current.cursors.length > 1) {
        current.cursors.pop();
        current.page = null;
      }
      return navigate(current.cursors.at(-1) ?? null);
    },
    current: snapshot,
  };
}
