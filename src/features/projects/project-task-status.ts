import type { TaskSummary } from '../../shared/types';

export function taskStatusDetail(task: Pick<TaskSummary, 'status' | 'currentStep'>): string {
  switch (task.status) {
    case 'draft':
      return '尚未开始生成';
    case 'pending':
      return '等待开始';
    case 'running':
      return `当前步骤 ${Math.max(1, task.currentStep)}`;
    case 'paused':
      return '已暂停，可继续';
    case 'completed':
      return '已完成';
    case 'failed':
      return '需要处理';
    case 'cancelled':
      return '已取消';
  }
}
