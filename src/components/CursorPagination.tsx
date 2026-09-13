import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { IconButton } from '../ui';

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
      <IconButton className="mini-button" variant="subtle" density="compact" label="上一页" icon={<ChevronLeft size={14} />} disabled={busy || !hasPrevious} onClick={onPrevious} />
      <IconButton className="mini-button" variant="subtle" density="compact" label="重新加载" icon={<RotateCcw size={14} />} disabled={busy} onClick={onReload} />
      <IconButton className="mini-button" variant="subtle" density="compact" label="下一页" icon={<ChevronRight size={14} />} disabled={busy || !hasNext} onClick={onNext} />
    </div>
  );
}
