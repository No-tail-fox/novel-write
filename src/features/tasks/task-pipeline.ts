import { isDirectorWorkflowTask, taskProgressStages, taskTerminalStep } from '../../shared/task-progress';
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

const operationStageTitles: Readonly<Record<string, string>> = {
  '三轮改写自评': '三轮改写',
  '主角档案与出图提示词': '角色与提示词',
  '批量生图': '生成图片',
};

export function taskOperationStageTitle(title: string): string {
  const normalized = title.replace(/^Step \d+\s*/u, '');
  return operationStageTitles[normalized] ?? normalized;
}

export function taskOperationStatusLabel(task: Pick<Task, 'taskType' | 'processingMode' | 'currentStep' | 'status'>): string {
  if (isDirectorWorkflowTask(task) && task.status === 'running') return '导演台进行中';
  if (task.status === 'running') {
    const stages = taskProgressStages(task);
    const stage = stages[Math.min(Math.max(0, task.currentStep), Math.max(0, stages.length - 1))];
    return stage ? taskOperationStageTitle(stage.title) : '进行中';
  }
  return {
    draft: '草稿',
    pending: '等待处理',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[task.status];
}

export type ArtifactPanelTab = 'preview' | 'storyboard' | 'images' | 'audio' | 'events';

export function artifactPanelTitle(task: Task, tab: ArtifactPanelTab): string {
  if (tab === 'storyboard') return task.currentStep >= 2 ? '分镜画廊已跟随流水线准备' : '等待分镜生成';
  if (tab === 'images') return task.currentStep >= 4 ? '批量图片已跟随流水线生成' : '等待图片生成';
  if (tab === 'audio') return task.currentStep >= 5 ? '配音与字幕时间轴' : '等待配音生成';
  if (tab === 'events') return '任务事件时间线';
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
