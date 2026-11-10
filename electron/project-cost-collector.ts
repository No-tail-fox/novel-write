import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lemoAgentImagePolicy } from '../src/shared/creative-animation/agent-assets';
import { createFileLlmReceiptJournal } from '../src/shared/llm-receipt-ledger';
import { costEntriesFromLlmReceipts, normalizeCostPriceTable, summarizeProjectCost, type CostLedgerEntry, type ProjectCostReport } from '../src/shared/project-cost';
import {
  costEntriesFromHtmlPipeline, costEntriesFromLemoTurns, costEntriesFromProviderFiles, costEntriesFromVoxDocument,
  expectedProjectImages, projectCostModelHints, projectCostPipelineKind, type LemoTurnEvidence,
} from '../src/shared/project-cost-sources';
import { projectRuntimeConfig } from '../src/shared/project-models';
import type { AppConfig, Task } from '../src/shared/types';

/**
 * U-5: read-only collection of a project's paid-call evidence from its managed work directory.
 * Never writes, never calls a provider; unreadable records are skipped (and noted), not fatal.
 */

export type ProjectCostTask = Pick<Task, 'id'> & Partial<Pick<Task, 'pipelineData' | 'projectModels' | 'storyboardSceneCount' | 'targetScenes'>>;

const MAX_LEMO_RUNS = 50;
const MAX_LEMO_TURNS = 400;

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return undefined; }
}
async function list(path: string): Promise<Array<{ name: string; directory: boolean }>> {
  try { return (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, directory: entry.isDirectory() })); } catch { return []; }
}

/** `vox-production/lemo-agent/<runId>/turn-NNNN` receipts of every Lemo v3 run of the project. */
export async function readLemoTurnEvidence(workDir: string): Promise<LemoTurnEvidence[]> {
  const root = join(workDir, 'vox-production', 'lemo-agent');
  const turns: LemoTurnEvidence[] = [];
  for (const run of (await list(root)).filter((entry) => entry.directory).slice(0, MAX_LEMO_RUNS)) {
    const runDir = join(root, run.name);
    for (const turnDir of (await list(runDir)).filter((entry) => entry.directory && /^turn-\d+$/u.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (turns.length >= MAX_LEMO_TURNS) return turns;
      const directory = join(runDir, turnDir.name);
      const files = (await list(directory)).filter((entry) => !entry.directory).map((entry) => entry.name);
      const has = (name: string) => files.includes(name);
      const submitted = has('submitted.json') ? await readJson<{ at?: string; requestId?: string }>(join(directory, 'submitted.json')) : undefined;
      const response = has('response.json') ? await readJson<{ usage?: Record<string, unknown> }>(join(directory, 'response.json')) : undefined;
      turns.push({
        runId: run.name,
        turn: Number(turnDir.name.slice(5)),
        at: typeof submitted?.at === 'string' ? submitted.at : '',
        submitted: has('submitted.json'),
        ...(typeof submitted?.requestId === 'string' ? { submittedRequestId: submitted.requestId } : {}),
        ...(has('response.json') ? { response: { ...(response?.usage ? { usage: response.usage } : {}) } } : {}),
        ...(has('rejected.json') ? { rejected: await readJson<{ reason?: string; requestId?: string }>(join(directory, 'rejected.json')) ?? {} } : {}),
        interrupted: has('interrupted.json'),
        rejectedSubmissions: files.filter((name) => name.startsWith('rejected-submission-')).length,
        ...(has('image.json') ? { image: await readJson<{ status?: string }>(join(directory, 'image.json')) ?? { status: 'submitted' } } : {}),
        abandonedImages: files.filter((name) => name.startsWith('image-abandoned-')).length,
      });
    }
  }
  return turns;
}

async function countProviderFiles(workDir: string): Promise<{ images: number; audio: number }> {
  const images = (await list(join(workDir, 'provider-images'))).filter((entry) => !entry.directory && /\.(png|jpe?g|webp)$/iu.test(entry.name)).length;
  const audio = (await list(join(workDir, 'provider-audio'))).filter((entry) => !entry.directory && /\.(mp3|wav|m4a|aac|ogg|flac|pcm)$/iu.test(entry.name)).length;
  return { images, audio };
}

export async function collectProjectCostReport(input: { task: ProjectCostTask; workDir: string; config: AppConfig; now?: () => Date }): Promise<ProjectCostReport> {
  const now = input.now ?? (() => new Date());
  let runtime = input.config;
  if (input.task.projectModels) {
    try { runtime = projectRuntimeConfig(input.config, input.task.projectModels); } catch { /* deleted profile: fall back to the global models */ }
  }
  const hints = projectCostModelHints(runtime);
  const notes: string[] = [];
  let data: unknown;
  try { data = input.task.pipelineData ? JSON.parse(input.task.pipelineData) : undefined; } catch { notes.push('项目流程数据无法解析，仅统计回执文件。'); }
  const kind = projectCostPipelineKind(data);
  const entries: CostLedgerEntry[] = [];

  const journal = await createFileLlmReceiptJournal(join(input.workDir, 'llm-receipts.jsonl')).read().catch(() => []);
  entries.push(...costEntriesFromLlmReceipts(journal, hints.llm.provider));

  let maxAgentImages: number | undefined;
  if (kind === 'html') {
    entries.push(...costEntriesFromHtmlPipeline(data, hints));
    notes.push('生图 / 配音按当前保存的素材计数；单张重新生成会覆盖旧结果，实际次数可能更多。');
  } else if (kind === 'vox') {
    const turns = await readLemoTurnEvidence(input.workDir);
    entries.push(...costEntriesFromLemoTurns(turns, hints));
    entries.push(...costEntriesFromVoxDocument(data, hints, { lemoTurnsCounted: turns.length > 0 }));
    notes.push('自动制作步骤只保留最近一次运行和尝试；更早被替换的运行不计入（Lemo Agent 每轮回执例外），计数为下限。');
    const run = (data as { productionRun?: { authoringVersion?: number; settings?: unknown } }).productionRun;
    if (run?.authoringVersion === 3 && run.settings) {
      try {
        const policy = lemoAgentImagePolicy(run.settings as Parameters<typeof lemoAgentImagePolicy>[0]);
        if (policy.enabled) maxAgentImages = policy.maxImages;
      } catch { /* malformed settings: no estimate */ }
    }
  } else {
    const files = await countProviderFiles(input.workDir);
    entries.push(...costEntriesFromProviderFiles({ ...files, at: '' }, hints));
    if (files.images || files.audio) notes.push('生图 / 配音按输出文件计数；重新生成会覆盖同名文件，实际次数可能更多。');
  }
  if (entries.some((entry) => entry.source !== 'llm-receipts' && entry.source !== 'provider-job')) notes.push('部分记录没有保存模型名，按项目当前模型配置归类。');
  const priceTable = normalizeCostPriceTable(input.config.costPriceTable);
  if (!priceTable.rows.length) notes.push('尚未填写单价：可在“系统设置 → AI 创作 → 成本单价”中按模型填写，未定价的调用只显示次数。');
  return {
    taskId: input.task.id,
    generatedAt: now().toISOString(),
    summary: summarizeProjectCost(entries, priceTable),
    ...(() => { const expected = expectedProjectImages(input.task, data, maxAgentImages); return expected ? { expectedImages: expected } : {}; })(),
    notes,
  };
}
