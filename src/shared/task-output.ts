import type { TaskOutputTarget } from './types';

export const TASK_OUTPUT_LABELS: Record<TaskOutputTarget, string> = {
  mp4: '直接成片 MP4',
  'jianying-draft': '剪映草稿',
};

/** Missing values belong to historical tasks, not new-task defaults. */
export function normalizeTaskOutputTargets(value: unknown): TaskOutputTarget[] {
  if (value === undefined || value === null) return ['jianying-draft'];
  if (!Array.isArray(value) || value.length === 0 || value.some((target) => target !== 'mp4' && target !== 'jianying-draft')) {
    throw new Error('请至少选择一种有效输出：直接成片 MP4 或剪映草稿');
  }
  return [...new Set(value)] as TaskOutputTarget[];
}
