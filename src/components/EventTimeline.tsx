import type { TaskEvent } from '../shared/types';
import { EmptyState } from './EmptyState';
import { ErrorDetails } from './ErrorDetails';

export function sortTimelineEvents(events: readonly TaskEvent[]): TaskEvent[] {
  return [...events].sort((left, right) => {
    if (left.seq !== undefined && right.seq !== undefined && left.seq !== right.seq) return left.seq - right.seq;
    if (left.seq !== undefined && right.seq === undefined) return -1;
    if (left.seq === undefined && right.seq !== undefined) return 1;
    return left.ts - right.ts;
  });
}

export function EventTimeline({ events }: { events: readonly TaskEvent[] }) {
  if (events.length === 0) return <EmptyState title="暂无事件" />;
  return (
    <div className="event-list">
      {sortTimelineEvents(events).map((event, index) => (
        <div className="event-item" key={`${event.seq ?? index}-${event.ts}`}>
          <span>{event.step ?? '-'}</span>
          {event.type === 'step_error' ? <ErrorDetails fullMessage={event.detail} title={`步骤 ${event.step ?? '-'} 错误`} compact /> : <p>{event.detail}</p>}
        </div>
      ))}
    </div>
  );
}
