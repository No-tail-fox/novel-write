import type { ContentPlatform, Task } from './types';
import { compactImageBudgetPolicy, type ImageBudgetPolicy } from './image-budget';

export interface OrdinaryTaskPipelineOptions {
  version: 1;
  platformVariants: ContentPlatform[];
  versionsPerPlatform: number;
  openingSequence: {
    enabled: boolean;
    preset: 'editorial-montage' | 'cinematic-cuts' | 'timeline-reveal';
    durationSec: number;
  };
  /** H-5 follow-up: 生图张数. Absent = standard (old projects and the default stay byte-identical). */
  imageBudget?: ImageBudgetPolicy;
}

export const DEFAULT_ORDINARY_TASK_PIPELINE_OPTIONS: OrdinaryTaskPipelineOptions = {
  version: 1,
  platformVariants: ['douyin'],
  versionsPerPlatform: 1,
  openingSequence: {
    enabled: true,
    preset: 'editorial-montage',
    durationSec: 6,
  },
};

const contentPlatforms: readonly ContentPlatform[] = ['douyin', 'xiaohongshu', 'shipinhao', 'bilibili', 'kuaishou'];

export function createOrdinaryTaskPipelineData(input: Partial<OrdinaryTaskPipelineOptions>): string {
  return JSON.stringify(normalizeOrdinaryTaskPipelineOptions(input));
}

export function ordinaryTaskPipelineOptions(task: Pick<Task, 'pipelineData' | 'taskType'>): OrdinaryTaskPipelineOptions {
  if (task.taskType === 'html-video') return DEFAULT_ORDINARY_TASK_PIPELINE_OPTIONS;
  try {
    const parsed = JSON.parse(task.pipelineData || '{}') as Partial<OrdinaryTaskPipelineOptions>;
    return normalizeOrdinaryTaskPipelineOptions(parsed);
  } catch {
    return DEFAULT_ORDINARY_TASK_PIPELINE_OPTIONS;
  }
}

function normalizeOrdinaryTaskPipelineOptions(input: Partial<OrdinaryTaskPipelineOptions>): OrdinaryTaskPipelineOptions {
  const platforms = Array.isArray(input.platformVariants)
    ? Array.from(new Set(input.platformVariants.filter((platform): platform is ContentPlatform => contentPlatforms.includes(platform as ContentPlatform))))
    : [];
  const opening = input.openingSequence;
  const preset = opening?.preset === 'cinematic-cuts' || opening?.preset === 'timeline-reveal'
    ? opening.preset
    : 'editorial-montage';
  const imageBudget = compactImageBudgetPolicy(input.imageBudget);
  return {
    version: 1,
    platformVariants: platforms.length ? platforms : [...DEFAULT_ORDINARY_TASK_PIPELINE_OPTIONS.platformVariants],
    versionsPerPlatform: Math.max(1, Math.min(3, Math.round(Number(input.versionsPerPlatform) || 1))),
    openingSequence: {
      enabled: opening?.enabled !== false,
      preset,
      durationSec: Math.max(4, Math.min(8, Number(opening?.durationSec) || DEFAULT_ORDINARY_TASK_PIPELINE_OPTIONS.openingSequence.durationSec)),
    },
    ...(imageBudget ? { imageBudget } : {}),
  };
}
