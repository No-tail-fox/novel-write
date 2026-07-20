import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

export interface CursorPaginationProps {
  busy: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onReload: () => void;
  onNext: () => void;
  label?: string;
}

export function CursorPagination({ busy, hasPrevious, hasNext, onPrevious, onReload, onNext, label = '历史分页' }: CursorPaginationProps) {
  return (
    <div className="chip-row cursor-pagination" role="group" aria-label={label}>
      <button className="mini-button" type="button" title="上一页" aria-label="上一页" disabled={busy || !hasPrevious} onClick={onPrevious}>
        <ChevronLeft size={14} />
      </button>
      <button className="mini-button" type="button" title="重新加载" aria-label="重新加载" disabled={busy} onClick={onReload}>
        <RotateCcw size={14} />
      </button>
      <button className="mini-button" type="button" title="下一页" aria-label="下一页" disabled={busy || !hasNext} onClick={onNext}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
