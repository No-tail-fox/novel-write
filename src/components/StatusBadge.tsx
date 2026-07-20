import type { TaskStatus } from '../shared/types';

const taskStatusLabels: Record<TaskStatus, string> = {
  draft: '草稿',
  pending: '等待',
  running: '运行中',
  paused: '暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function taskStatusLabel(status: TaskStatus | 'all'): string {
  return status === 'all' ? '全部' : taskStatusLabels[status];
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`status-pill ${status}`}>{taskStatusLabel(status)}</span>;
}
