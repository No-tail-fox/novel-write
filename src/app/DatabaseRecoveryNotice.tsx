import { Button } from '../ui';
import { DATABASE_RECOVERY_NOTICE_KEY, formatDatabaseRecoveryNotice, shouldShowDatabaseRecoveryNotice } from '../shared/database-recovery';
import type { DatabaseRecoveryEvent } from '../shared/types';

/** The startup recovery event still awaiting acknowledgement, or null (one-time per quarantined file). */
export function pendingDatabaseRecovery(event: DatabaseRecoveryEvent | null | undefined): DatabaseRecoveryEvent | null {
  let acknowledged: string | null = null;
  try { acknowledged = window.localStorage.getItem(DATABASE_RECOVERY_NOTICE_KEY); } catch { /* storage unavailable: show it */ }
  return shouldShowDatabaseRecoveryNotice(event, acknowledged) ? event : null;
}

export function acknowledgeDatabaseRecovery(event: DatabaseRecoveryEvent): void {
  try { window.localStorage.setItem(DATABASE_RECOVERY_NOTICE_KEY, event.quarantinedPath); } catch { /* hidden for this session only */ }
}

/** Startup notice for a quarantined malformed database (O-4). */
export function DatabaseRecoveryNotice({ event, onDismiss }: { event: DatabaseRecoveryEvent; onDismiss: () => void }) {
  return (
    <div className="inline-action-feedback error database-recovery-notice" role="alert">
      <span>{formatDatabaseRecoveryNotice(event)}</span>
      <Button variant="subtle" density="compact" onClick={onDismiss}>知道了</Button>
    </div>
  );
}
