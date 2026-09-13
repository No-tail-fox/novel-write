import { useState } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../../ui';

export function useDirectorHistoryPage<T>(items: readonly T[], scope: string, pageSize = 20) {
  const [selection, setSelection] = useState({ scope, page: 0 });
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(selection.scope === scope ? selection.page : 0, pageCount - 1);
  return {
    items: items.slice(page * pageSize, (page + 1) * pageSize),
    page,
    pageCount,
    total: items.length,
    onPageChange: (next: number) => setSelection({ scope, page: Math.max(0, Math.min(next, pageCount - 1)) }),
  };
}

export function DirectorHistoryPager({ label, page, pageCount, total, onPageChange }: {
  label: string;
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return <nav className="director-history-pager" aria-label={`${label}分页`}>
    <span aria-live="polite">{page + 1} / {pageCount} 页 · {total} 条</span>
    <div>
      <IconButton label={`${label}首页`} icon={<ChevronFirst size={14} />} density="compact" variant="subtle" disabled={page === 0} onClick={() => onPageChange(0)} />
      <IconButton label={`${label}上一页`} icon={<ChevronLeft size={14} />} density="compact" variant="subtle" disabled={page === 0} onClick={() => onPageChange(page - 1)} />
      <IconButton label={`${label}下一页`} icon={<ChevronRight size={14} />} density="compact" variant="subtle" disabled={page === pageCount - 1} onClick={() => onPageChange(page + 1)} />
      <IconButton label={`${label}末页`} icon={<ChevronLast size={14} />} density="compact" variant="subtle" disabled={page === pageCount - 1} onClick={() => onPageChange(pageCount - 1)} />
    </div>
  </nav>;
}
