import { CalendarDays } from 'lucide-react';
import type { InformationArchiveOrigin } from '../../shared/types';

export function ArchiveDateControl({
  date,
  availableDates,
  origin,
  onChange,
}: {
  date: string;
  availableDates: readonly string[];
  origin: InformationArchiveOrigin | null;
  onChange: (date: string) => void;
}) {
  const saved = origin === 'cache' || origin === 'network';
  return (
    <div className="hot-board-archive-control" data-saved={saved ? 'true' : 'false'}>
      <label>
        <CalendarDays size={15} />
        <span>归档日期</span>
        <input
          type="date"
          aria-label="归档日期"
          max={todayArchiveDate()}
          value={date}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="hot-board-archive-state">
        <strong>{saved ? '已保存' : '未归档'}</strong>
        <small>{availableDates.length ? `共 ${availableDates.length} 天` : '暂无历史'}</small>
      </div>
    </div>
  );
}

export function todayArchiveDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
