import type { ProjectActivity } from './types';
import { latestProductionProviderJob, type ProductionProviderJob } from './production-workflow';

export interface ProjectScriptActivity {
  status: string;
  storyboardStatus?: string;
  applied: boolean;
}

export interface ProjectBatchActivity {
  status: string;
  completed: number;
  total: number;
}

export interface ProjectProductionActivity {
  status: string;
  activeKind?: string;
  completed: number;
  total: number;
}

export type ProjectProviderActivity = Pick<ProductionProviderJob,
  'nodeId' | 'capability' | 'episodeId' | 'status' | 'attempt' | 'createdAt' | 'updatedAt'>;

function activity(status: ProjectActivity['status'], label: string, detail: string): ProjectActivity {
  return { status, label, detail };
}

/** Presentation only: authoring projects must remain writable while background jobs run. */
export function resolveProjectActivity(input: {
  stage?: string;
  paused?: boolean;
  scripts: ProjectScriptActivity[];
  batches: ProjectBatchActivity[];
  jobs: ProjectProviderActivity[];
  production?: ProjectProductionActivity;
}): ProjectActivity | undefined {
  const scripts = input.scripts.filter((task) => !task.applied);
  const groups = new Map<string, ProjectProviderActivity[]>();
  for (const job of input.jobs) {
    const key = JSON.stringify([job.nodeId, job.capability, job.episodeId]);
    const group = groups.get(key) ?? [];
    group.push(job);
    groups.set(key, group);
  }
  const jobs = [...groups.values()].map((group) => {
    const first = group[0];
    return latestProductionProviderJob(group, first.nodeId, first.capability, first.episodeId)!;
  });
  const ready = scripts.filter((task) => ['script-ready', 'review', 'approved'].includes(task.status)).length;
  const progress = `剧本 ${ready}/${scripts.length} 集`;
  if (scripts.some((task) => task.storyboardStatus === 'running')) return activity('running', '运行中', '正在生成分镜');
  if (scripts.some((task) => task.status === 'running')) return activity('running', '运行中', `正在生成剧本 · ${progress}`);
  const production = input.production;
  if (production?.status === 'running') {
    const steps: Record<string, string> = { plan: '正在规划画面', image: '正在生成画面', cutout: '正在处理抠图', voice: '正在生成配音', timing: '正在校准时长', animation: '正在制作动画', compile: '正在编译动画', render: '正在渲染成片', verify: '正在检查成片' };
    return activity('running', '运行中', `${steps[production.activeKind ?? ''] ?? '正在自动制作'} · ${production.completed}/${production.total}`);
  }
  const batch = input.batches.find((item) => ['running', 'cancelling'].includes(item.status));
  if (batch) return activity('running', '运行中', `${batch.status === 'cancelling' ? '正在停止批量生成' : '正在批量生成'} · ${batch.completed}/${batch.total}`);
  if (jobs.some((job) => job.status === 'running')) return activity('running', '运行中', jobs.some((job) => job.status === 'running' && job.capability === 'deterministic-render') ? '正在渲染成片' : '正在生成素材');
  if (!input.paused && scripts.some((task) => task.status === 'queued')) return activity('pending', '等待中', `剧本排队中 · ${progress}`);
  if (input.batches.some((item) => item.status === 'queued') || jobs.some((job) => job.status === 'queued')) return activity('pending', '等待中', '等待生成素材');
  if (input.paused && scripts.some((task) => task.status === 'queued')) return activity('paused', '已暂停', `剧本队列已暂停 · ${progress}`);
  if (input.batches.some((item) => item.status === 'paused')) return activity('paused', '已暂停', '批量生成已暂停，可继续');
  if (production?.status === 'paused') return activity('paused', '已暂停', '自动制作已暂停，可继续');
  if (production?.status === 'failed') return activity('failed', '需要处理', '自动制作失败，请查看项目');
  if (production?.status === 'cancelled') return activity('cancelled', '已取消', '自动制作已取消');
  if (production?.status === 'completed') return activity('completed', '已完成', '成片已完成');
  if (input.stage === 'completed') return activity('completed', '已完成', '成片已完成');
  if (scripts.some((task) => task.status === 'failed' || task.storyboardStatus === 'failed')) return activity('failed', '失败', '剧本或分镜生成失败，可重试');
  if (input.stage === 'failed' || input.batches.some((item) => item.status === 'failed') || jobs.some((job) => job.status === 'failed')) return activity('failed', '需要处理', '生成失败，请查看项目');
  const review = scripts.filter((task) => task.storyboardStatus === 'ready' || ['script-ready', 'review'].includes(task.status)).length;
  if (review) return activity('paused', '待审核', `剧本或分镜待审核 · ${review} 集`);
  if (scripts.some((task) => task.status === 'stale')) return activity('paused', '待更新', '剧本输入已变化，请重新生成');
  if (scripts.some((task) => task.status === 'approved')) return activity('draft', '已就绪', '剧本已批准，可生成分镜');
  if (input.batches.some((item) => item.status === 'completed') || jobs.some((job) => job.status === 'completed')) return activity('draft', '制作中', '素材已生成，可继续制作');
  if (scripts.length && scripts.every((task) => task.status === 'cancelled')) return activity('cancelled', '已取消', '剧本生成已取消');
  const stages: Record<string, string> = {
    'series-bible': '系列设定', 'character-bible': '角色设定', 'episode-script': '分集剧本', 'shot-board': '分镜',
    keyframes: '关键帧', audio: '配音', assembly: '剪辑', qa: '审片',
    'script-approved': '剧本已批准', 'style-approved': '风格已确认', assets: '素材制作', rendering: '成片渲染',
  };
  return input.stage && stages[input.stage] ? activity('draft', '制作中', `当前阶段：${stages[input.stage]}`) : undefined;
}
