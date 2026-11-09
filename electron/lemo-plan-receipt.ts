import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmJsonResult } from '../src/shared/llm-provider';

/** Run-scoped, input-bound receipts are persisted BEFORE application schema validation.
 * A known local validation failure can be retried without purchasing the same response again.
 * Never store credentials or silently treat a corrupt receipt as permission to resubmit.
 */
export async function cachedLemoPlanResponse(work: string, context: { runId: string; requestId: string }, input: unknown,
  generate: () => Promise<LlmJsonResult>): Promise<LlmJsonResult> {
  const inputHash = createHash('sha256').update(JSON.stringify([context.runId, input])).digest('hex');
  const directory = join(work, 'plan-receipts');
  const file = join(directory, inputHash + '.json');
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved.version !== 1 || saved.inputHash !== inputHash || saved.runId !== context.runId || !saved.result || typeof saved.result.raw !== 'string' || !('json' in saved.result)) {
      throw new Error('LEMO_PLAN_RECEIPT_INVALID: 本地规划回执损坏，请核对已付费结果，不能自动重发。');
    }
    return saved.result;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const result = await generate();
  await mkdir(directory, { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify({ version: 1, inputHash, ...context, receivedAt: new Date().toISOString(), result }), 'utf8');
  await rename(temporary, file);
  return result;
}
