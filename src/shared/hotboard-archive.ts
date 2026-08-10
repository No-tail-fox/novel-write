import { queryAiHot } from './aihot';
import { fetchHotBoardSnapshot } from './hotboard';
import type {
  AiHotArchiveRequest,
  AiHotArchiveResult,
  AiHotQueryRequest,
  AiHotQueryResult,
  HotBoardArchiveRequest,
  HotBoardArchiveResult,
  HotBoardArchiveStore,
  HotBoardSnapshot,
} from './types';

type Clock = () => Date;
type HotBoardFetcher = () => Promise<HotBoardSnapshot>;
type AiHotFetcher = (request: AiHotQueryRequest) => Promise<AiHotQueryResult>;

export async function loadHotBoardArchive(
  store: HotBoardArchiveStore,
  request: HotBoardArchiveRequest = {},
  fetchSnapshot: HotBoardFetcher = fetchHotBoardSnapshot,
  now: Clock = () => new Date(),
): Promise<HotBoardArchiveResult> {
  const today = archiveDateFor(now());
  const archiveDate = resolveArchiveDate(request.date, today);
  const cached = await store.getHotBoardSnapshot(archiveDate);

  if (cached && !request.forceRefresh) {
    return hotBoardResult(store, archiveDate, 'cache', cached);
  }
  if (archiveDate !== today) {
    return hotBoardResult(store, archiveDate, cached ? 'cache' : 'missing', cached);
  }

  const snapshot = await fetchSnapshot();
  await store.saveHotBoardSnapshot(archiveDate, snapshot);
  return hotBoardResult(store, archiveDate, 'network', snapshot);
}

export async function loadAiHotArchive(
  store: HotBoardArchiveStore,
  request: AiHotArchiveRequest,
  fetchQuery: AiHotFetcher = queryAiHot,
  now: Clock = () => new Date(),
): Promise<AiHotArchiveResult> {
  const today = archiveDateFor(now());
  const requestedDate = request.date ?? (request.query.mode === 'daily' ? request.query.date : undefined);
  const archiveDate = resolveArchiveDate(requestedDate, today);
  const query = request.query.mode === 'daily'
    ? { mode: 'daily' as const, date: archiveDate }
    : request.query;
  const queryKey = aiHotArchiveKey(query);
  const cached = await store.getAiHotSnapshot(archiveDate, queryKey);

  if (cached && !request.forceRefresh) {
    return aiHotResult(store, archiveDate, queryKey, 'cache', cached);
  }
  if (archiveDate !== today) {
    return aiHotResult(store, archiveDate, queryKey, cached ? 'cache' : 'missing', cached);
  }

  const result = await fetchQuery(query);
  await store.saveAiHotSnapshot(archiveDate, queryKey, query, result);
  return aiHotResult(store, archiveDate, queryKey, 'network', result);
}

export function aiHotArchiveKey(request: AiHotQueryRequest): string {
  switch (request.mode) {
    case 'daily': return `daily:${request.date ?? 'latest'}`;
    case 'selected': return `selected:${request.window}`;
    case 'all': return `all:${request.window}`;
    case 'category': return `category:${request.category}:${request.window}`;
    case 'recent': return `recent:${request.days}`;
    case 'search': return `search:${normalizeSearchKey(request.query)}:${request.window}`;
  }
}

export function archiveDateFor(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function hotBoardResult(
  store: HotBoardArchiveStore,
  archiveDate: string,
  origin: HotBoardArchiveResult['origin'],
  snapshot: HotBoardSnapshot | null,
): Promise<HotBoardArchiveResult> {
  return {
    archiveDate,
    availableDates: await store.listHotBoardSnapshotDates(),
    origin,
    snapshot,
  };
}

async function aiHotResult(
  store: HotBoardArchiveStore,
  archiveDate: string,
  queryKey: string,
  origin: AiHotArchiveResult['origin'],
  result: AiHotQueryResult | null,
): Promise<AiHotArchiveResult> {
  return {
    archiveDate,
    availableDates: await store.listAiHotSnapshotDates(),
    origin,
    queryKey,
    result,
  };
}

function resolveArchiveDate(value: string | undefined, today: string): string {
  const archiveDate = value?.trim() || today;
  if (!isCalendarDate(archiveDate)) throw new Error('INFORMATION_ARCHIVE_DATE_INVALID: 归档日期无效。');
  if (archiveDate > today) throw new Error('INFORMATION_ARCHIVE_DATE_FUTURE: 不能读取未来日期。');
  return archiveDate;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeSearchKey(query: string): string {
  return query.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-CN');
}
