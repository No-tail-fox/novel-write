import type { Task } from './types';
import { htmlVideoSteps } from './html-video-workflow';

export interface TaskProgressStage {
  index: number;
  title: string;
  hint: string;
  agent: string;
}

export const ORDINARY_TASK_STAGES = [
  { index: 0, title: 'Step 0 预审', hint: '清理广告、重复和敏感表达', agent: 'Reviewer' },
  { index: 1, title: 'Step 1 三轮改写自评', hint: '三轮改写、评分、自评并生成封面信息', agent: 'Writer' },
  { index: 2, title: 'Step 2 分镜', hint: '拆成可配图的镜头单元', agent: 'Storyboard' },
  { index: 3, title: 'Step 3 主角档案与出图提示词', hint: '提取角色档案并生成每镜 prompt', agent: 'Prompt' },
  { index: 4, title: 'Step 4 批量生图', hint: '并发调用 AI 绘图，暂停后可续跑', agent: 'Producer' },
  { index: 5, title: 'Step 5 配音', hint: '生成旁白音频和字幕时间轴', agent: 'TTS' },
  { index: 6, title: 'Step 6 草稿导出', hint: '写入剪映草稿输出目录', agent: 'Draft' },
] as const;

export function isDirectorWorkflowTask(task: Pick<Task, 'taskType'>): boolean {
  return task.taskType === 'editorial-collage' || task.taskType === 'motion-comic';
}

const HTML_VIDEO_TASK_STAGES: readonly TaskProgressStage[] = htmlVideoSteps.map((step, index) => ({
  index,
  title: step.name,
  hint: step.sub,
  agent: 'HTML Video',
}));
const CLIP_ONLY_TASK_STAGES = ORDINARY_TASK_STAGES.slice(0, 4);

export interface TaskProgressSnapshot {
  completed: number;
  total: number;
  position: number;
}

export type TaskLifecycleAction = 'continue' | 'pause' | 'cancel' | 'retry';

const lifecycleStatuses: Record<TaskLifecycleAction, readonly Task['status'][]> = {
  continue: ['paused'],
  pause: ['running', 'paused'],
  cancel: ['pending', 'running', 'paused', 'cancelled'],
  retry: ['paused', 'failed', 'cancelled'],
};

export function assertTaskLifecycleAction(
  task: Pick<Task, 'id' | 'archivedAt' | 'status'>,
  action: TaskLifecycleAction,
  options: { hasActiveRun?: boolean } = {},
): void {
  if (task.archivedAt) throw new Error(`TASK_ARCHIVED: ${task.id}`);
  if (options.hasActiveRun && task.status === 'running' && (action === 'continue' || action === 'retry')) return;
  if (!lifecycleStatuses[action].includes(task.status)) {
    throw new Error(`TASK_LIFECYCLE_INVALID: Cannot ${action} task ${task.id} from ${task.status}.`);
  }
}

export function taskStepPosition(step: number): number {
  return Math.max(1, Math.trunc(step) + 1);
}

export function taskTerminalStep(task: Pick<Task, 'taskType' | 'processingMode'>): number {
  if (isDirectorWorkflowTask(task)) return 1;
  if (task.taskType === 'html-video') return HTML_VIDEO_TASK_STAGES.length;
  if (task.processingMode === 'clip-only') return CLIP_ONLY_TASK_STAGES.length;
  return ORDINARY_TASK_STAGES.length;
}

export function taskProgressStages(
  task: Pick<Task, 'taskType' | 'processingMode'>,
): readonly TaskProgressStage[] {
  if (isDirectorWorkflowTask(task)) return [{ index: 0, title: '导演台工作流', hint: '按项目、分集和批次执行', agent: 'Director Desk' }];
  if (task.taskType === 'html-video') return HTML_VIDEO_TASK_STAGES;
  if (task.processingMode === 'clip-only') return CLIP_ONLY_TASK_STAGES;
  return ORDINARY_TASK_STAGES;
}

export function taskProgressSnapshot(
  task: Pick<Task, 'taskType' | 'processingMode' | 'status' | 'currentStep'>,
): TaskProgressSnapshot {
  if (isDirectorWorkflowTask(task)) {
    return {
      completed: task.status === 'completed' ? 1 : 0,
      total: 1,
      position: task.status === 'running' ? 1 : 0,
    };
  }
  const total = taskTerminalStep(task);
  const currentStep = Math.max(0, Math.trunc(task.currentStep));
  return {
    completed: task.status === 'completed' ? total : Math.min(currentStep, total),
    total,
    position: task.status === 'completed' ? total : Math.min(taskStepPosition(currentStep), total),
  };
}
