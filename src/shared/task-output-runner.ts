import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeTaskOutputTargets, TASK_OUTPUT_LABELS } from './task-output';
import type { TaskDeliverables, TaskOutputTarget } from './types';

export async function outputFingerprint(input: unknown, assetPaths: readonly string[]): Promise<string> {
  const versions = await Promise.all([...new Set(assetPaths.filter(Boolean))].sort().map(async (path) => {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(`输出素材不可读或为空：${path}`);
    return [path, info.size, info.mtimeMs];
  }));
  return createHash('sha256').update(JSON.stringify({ input, versions })).digest('hex');
}

export async function isTaskOutputPresent(target: TaskOutputTarget, path: string): Promise<boolean> {
  try {
    const paths = target === 'mp4' ? [path] : [join(path, 'draft_content.json'), join(path, 'draft_meta_info.json')];
    return (await Promise.all(paths.map(async (file) => { const info = await stat(file); return info.isFile() && info.size > 0; }))).every(Boolean);
  } catch { return false; }
}

/** Run both deliveries even if one fails. Successful artifacts survive retry. */
export async function executeTaskOutputs(input: {
  targets: unknown;
  previous?: TaskDeliverables;
  fingerprint: string;
  signal?: AbortSignal;
  produce: (target: TaskOutputTarget) => Promise<string>;
  onUpdate: (outputs: TaskDeliverables) => Promise<void>;
  verify?: (target: TaskOutputTarget, path: string) => Promise<boolean>;
}): Promise<TaskDeliverables> {
  const targets = normalizeTaskOutputTargets(input.targets);
  const outputs: TaskDeliverables = {};
  for (const target of targets) {
    const previous = input.previous?.[target];
    outputs[target] = previous?.fingerprint === input.fingerprint ? { ...previous } : { status: 'pending', updatedAt: new Date().toISOString() };
  }
  const verify = input.verify ?? isTaskOutputPresent;
  await input.onUpdate(outputs);
  const failures: string[] = [];
  for (const target of targets) {
    input.signal?.throwIfAborted();
    const previous = outputs[target];
    if (previous?.status === 'completed' && previous.path && await verify(target, previous.path)) continue;
    outputs[target] = { status: 'running', fingerprint: input.fingerprint, updatedAt: new Date().toISOString() };
    await input.onUpdate(outputs);
    try {
      const path = await input.produce(target);
      input.signal?.throwIfAborted();
      if (!await verify(target, path)) throw new Error('输出文件缺失或为空');
      outputs[target] = { status: 'completed', path, fingerprint: input.fingerprint, updatedAt: new Date().toISOString() };
    } catch (error) {
      outputs[target] = { status: 'failed', error: error instanceof Error ? error.message : String(error), fingerprint: input.fingerprint, updatedAt: new Date().toISOString() };
      failures.push(`${TASK_OUTPUT_LABELS[target]}：${outputs[target]!.error}`);
    }
    await input.onUpdate(outputs);
    input.signal?.throwIfAborted();
  }
  if (failures.length) throw new Error(`交付未全部完成；已成功的输出会保留，重试只处理未完成项。\n${failures.join('\n')}`);
  return outputs;
}