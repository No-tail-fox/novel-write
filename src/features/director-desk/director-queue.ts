export type DirectorQueueKind = 'shot-image' | 'shot-video' | 'shot-voice' | 'style-sample' | 'project-render';

interface DirectorRetryTarget {
  id: string;
  shotId: string;
  kind?: DirectorQueueKind;
  title: string;
}

/** Older workspaces only supplied image jobs without a kind. Keep that contract. */
export function directorQueueKind(item: DirectorRetryTarget): DirectorQueueKind {
  return item.kind ?? 'shot-image';
}

export function directorQueueHasActiveImage(
  queue: readonly (DirectorRetryTarget & { status: string })[],
  shotId: string,
): boolean {
  return queue.some((item) => item.shotId === shotId && directorQueueKind(item) === 'shot-image' && (item.status === 'running' || item.status === 'waiting'));
}

export function directorQueueRetryLabel(item: DirectorRetryTarget): string {
  return { 'shot-image': '重试图片', 'shot-video': '重试视频', 'shot-voice': '重试旁白', 'style-sample': '重试试片', 'project-render': '重试合成' }[directorQueueKind(item)];
}

export async function retryDirectorQueueItem(
  item: DirectorRetryTarget,
  handlers: Partial<Record<DirectorQueueKind, (id: string) => Promise<unknown>>>,
): Promise<void> {
  const kind = directorQueueKind(item);
  const handler = handlers[kind];
  if (!handler) throw new Error(`${directorQueueRetryLabel(item)}尚未接入。`);
  await handler(kind === 'style-sample' ? item.shotId.replace(/^style-candidate:/, '') : item.shotId);
}
