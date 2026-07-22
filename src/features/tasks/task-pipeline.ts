import { taskTerminalStep } from '../../shared/task-progress';
import type { Task, TaskArtifactSnapshot } from '../../shared/types';

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export function pipelineStepStatus(task: Task, step: number): PipelineStepStatus {
  if (task.status === 'paused' && task.failedStep === step) return 'failed';
  if (task.status === 'failed') return step === task.currentStep ? 'failed' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'cancelled') return step === task.currentStep ? 'cancelled' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'completed') return 'completed';
  if (task.status === 'running') return step < task.currentStep ? 'completed' : step === task.currentStep ? 'running' : 'pending';
  return step < task.currentStep ? 'completed' : 'pending';
}

export function statusLabelForStep(status: PipelineStepStatus): string {
  return {
    pending: '等待中',
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

export function artifactPanelTitle(task: Task, tab: 'preview' | 'storyboard' | 'audio'): string {
  if (tab === 'storyboard') return task.currentStep >= 2 ? '分镜画廊已跟随流水线准备' : '等待分镜生成';
  if (tab === 'audio') return task.currentStep >= 5 ? '配音与字幕时间轴' : '等待配音生成';
  return task.currentStep >= taskTerminalStep(task) ? '最终剪映草稿目录' : '等待当前步骤产物落盘';
}

export function snapshotStepStatus(snapshot: TaskArtifactSnapshot | null, step: number): string {
  return snapshot?.steps[String(step)]?.status ?? 'pending';
}

export function imageProgressLabel(totalScenes: number, generatedImages: number, stepStatus: string): string {
  const total = totalScenes || generatedImages;
  if (total === 0) return '等待分镜';
  const statusText = stepStatus === 'completed' ? '已完成' : stepStatus === 'running' ? '生成中' : stepStatus === 'failed' ? '生成失败' : '等待生图';
  return `${generatedImages}/${total} 张 · ${statusText}`;
}
