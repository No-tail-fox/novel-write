import type { DatabaseRecoveryEvent } from './types';

/** localStorage key remembering which quarantined file the user already acknowledged. */
export const DATABASE_RECOVERY_NOTICE_KEY = 'storydream.database-recovery-notice.acknowledged';

export function formatDatabaseRecoveryNotice(event: DatabaseRecoveryEvent): string {
  const outcome = event.tempRecovered
    ? '并已从最近一次保存时的临时文件恢复数据，请核对最近的项目是否完整'
    : '并新建了空数据库';
  return `数据库文件损坏，已隔离到 ${event.quarantinedPath}，${outcome}。原文件未删除，可联系支持恢复。`;
}

/** One-time notice: shown until the user acknowledges this specific quarantined file. */
export function shouldShowDatabaseRecoveryNotice(event: DatabaseRecoveryEvent | null | undefined, acknowledged: string | null): event is DatabaseRecoveryEvent {
  return Boolean(event && event.quarantinedPath && event.quarantinedPath !== acknowledged);
}
