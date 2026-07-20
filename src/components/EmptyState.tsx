import { CircleAlert, Database, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export type EmptyStateTone = 'empty' | 'loading' | 'error';

export interface EmptyStateProps {
  title: string;
  description?: string;
  tone?: EmptyStateTone;
  action?: ReactNode;
}

export function EmptyState({ title, description, tone = 'empty', action }: EmptyStateProps) {
  const icon = tone === 'loading'
    ? <Loader2 className="spin" size={20} aria-hidden="true" />
    : tone === 'error'
      ? <CircleAlert size={20} aria-hidden="true" />
      : <Database size={20} aria-hidden="true" />;
  return (
    <div className={`empty-state ${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      {icon}
      <span>{title}</span>
      {description ? <small>{description}</small> : null}
      {action}
    </div>
  );
}
