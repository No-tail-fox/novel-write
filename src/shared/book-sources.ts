import type { BookDiscoverySource, BookProductInfo } from './types';

export const BOOK_SOURCES: ReadonlyArray<{ value: BookDiscoverySource; label: string }> = [
  { value: 'dangdang', label: '当当' },
  { value: 'weread', label: '微信读书' },
  { value: 'douban', label: '豆瓣' },
];
export const DEFAULT_BOOK_SOURCES = BOOK_SOURCES.map((source) => source.value);

export function bookSourceLabel(source: BookProductInfo['source']): string {
  return BOOK_SOURCES.find((item) => item.value === source)?.label ?? '手动录入';
}

// Include the provider: numeric IDs are not globally unique across book catalogs.
export function bookSourceKey(data: Pick<BookProductInfo, 'source' | 'sourceId'>, fallbackId = ''): string {
  return `${data.source ?? 'manual'}:${data.sourceId || fallbackId}`;
}
