import { readFile } from 'node:fs/promises';
import type { PipelineArtifact, Task, TaskArtifactAssetPreview, TaskArtifactImageErrorPreview, TaskArtifactSnapshot, TaskArtifactStepPreview, TaskArtifactVideoPreview, TaskDagNode } from './types';

interface PipelineStateFile {
  taskId?: string;
  updatedAt?: string;
  steps?: Record<string, Partial<TaskArtifactStepPreview>>;
  dag?: Record<string, TaskDagNode>;
  artifact?: Partial<PipelineArtifact>;
  assets?: {
    cover?: TaskArtifactAssetPreview[];
    images?: TaskArtifactAssetPreview[];
    videos?: TaskArtifactVideoPreview[];
    imageErrors?: TaskArtifactImageErrorPreview[];
    narration?: TaskArtifactAssetPreview[];
  };
  draft?: TaskArtifactSnapshot['draft'];
}

export async function readTaskArtifactSnapshot(task: Pick<Task, 'id' | 'artifactStatePath' | 'outputDir'>): Promise<TaskArtifactSnapshot> {
  if (!task.artifactStatePath) {
    return emptySnapshot(task, '等待产物状态文件生成');
  }

  try {
    const state = JSON.parse(await readFile(task.artifactStatePath, 'utf8')) as PipelineStateFile;
    return {
      available: true,
      message: '产物已读取',
      taskId: state.taskId || task.id,
      statePath: task.artifactStatePath,
      outputDir: task.outputDir,
      updatedAt: state.updatedAt ?? null,
      steps: normalizeSteps(state.steps),
      dag: Object.values(state.dag ?? {}).sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true })),
      artifact: state.artifact ?? {},
      assets: {
        cover: Array.isArray(state.assets?.cover) ? state.assets.cover : [],
        images: Array.isArray(state.assets?.images) ? state.assets.images : [],
        videos: Array.isArray(state.assets?.videos) ? state.assets.videos : [],
        imageErrors: Array.isArray(state.assets?.imageErrors) ? state.assets.imageErrors : [],
        narration: Array.isArray(state.assets?.narration) ? state.assets.narration : [],
      },
      draft: state.draft ?? null,
    };
  } catch (error) {
    return emptySnapshot(task, `产物状态文件暂不可读：${error instanceof Error ? error.message : String(error)}`);
  }
}

function emptySnapshot(task: Pick<Task, 'id' | 'artifactStatePath' | 'outputDir'>, message: string): TaskArtifactSnapshot {
  return {
    available: false,
    message,
    taskId: task.id,
    statePath: task.artifactStatePath,
    outputDir: task.outputDir,
    updatedAt: null,
    steps: {},
    artifact: {},
    assets: {
      cover: [],
      images: [],
      videos: [],
      imageErrors: [],
      narration: [],
    },
    draft: null,
  };
}

function normalizeSteps(input: PipelineStateFile['steps']): Record<string, TaskArtifactStepPreview> {
  if (!input) return {};
  const output: Record<string, TaskArtifactStepPreview> = {};
  for (const [step, value] of Object.entries(input)) {
    const status = value.status;
    output[step] = {
      status: status === 'running' || status === 'completed' || status === 'failed' ? status : 'pending',
      outputPath: value.outputPath,
      error: value.error,
      completedAt: value.completedAt,
    };
  }
  return output;
}
