import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readReferenceJson, referenceHash } from './viral-reference-store';

const receiptSchema = z.object({
  key: z.string(), status: z.enum(['submitted', 'succeeded', 'failed', 'outcome-unknown', 'retry-authorized']),
  createdAt: z.string(), result: z.unknown().optional(), message: z.string().optional(),
  attempts: z.number().int().positive().default(1),
  previousAttempts: z.array(z.object({ status: z.string(), createdAt: z.string() })).optional(),
});

/** Mutable control files are replaced atomically; immutable report artifacts remain separate. */
export async function writeReferenceControl(workDir: string, directory: string, name: string, value: unknown): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(directory) || !/^[a-z0-9-]+\.json$/.test(name)) throw new Error('Invalid control path.');
  await mkdir(workDir, { recursive: true });
  if ((await lstat(workDir)).isSymbolicLink()) throw new Error('VIRAL_REFERENCE_PATH');
  const root = join(workDir, directory);
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('VIRAL_REFERENCE_PATH');
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('VIRAL_REFERENCE_TOO_LARGE');
  const temp = join(root, `${randomUUID()}.partial`);
  const handle = await open(temp, 'wx');
  try { await handle.writeFile(body, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, join(root, name));
}

export class ReferenceRequestLedger {
  private attemptCount: number | undefined;
  constructor(private readonly workDir: string, private readonly budget: number, private readonly signal?: AbortSignal) {}

  async run<T>(identity: unknown, request: () => Promise<T>): Promise<T> {
    this.signal?.throwIfAborted();
    const key = referenceHash(JSON.stringify(identity));
    const path = `reference-requests/${key}.json`;
    const prior = await readReferenceJson(this.workDir, path, receiptSchema).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (prior) {
      if (prior.key !== key) throw new Error('VIRAL_REFERENCE_CORRUPT: 请求回执不匹配。');
      if (prior.status === 'succeeded') return prior.result as T;
      if (prior.status !== 'retry-authorized') throw new Error(`VIRAL_REFERENCE_REQUEST_REVIEW: 此请求已有${prior.status === 'failed' ? '失败' : '结果未知'}回执，已阻止自动重复付费。请检查服务商调用记录。`);
    }
    const directory = join(this.workDir, 'reference-requests');
    const entries = await readdir(directory).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[];
      throw error;
    });
    if (this.attemptCount === undefined) {
      this.attemptCount = 0;
      for (const name of entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
        this.attemptCount += (await readReferenceJson(this.workDir, `reference-requests/${name}`, receiptSchema)).attempts;
      }
    }
    if (this.attemptCount >= this.budget) {
      throw new Error('VIRAL_REFERENCE_BUDGET: 已达到本次分析的累计请求上限；已有结果已保留。');
    }
    const receipt = { key, status: 'submitted' as const, createdAt: new Date().toISOString(), attempts: (prior?.attempts ?? 0) + 1,
      previousAttempts: prior ? [...(prior.previousAttempts ?? []), { status: prior.status, createdAt: prior.createdAt }] : [] };
    // A durable reservation always precedes the paid request, including cancellation races.
    await writeReferenceControl(this.workDir, 'reference-requests', `${key}.json`, receipt);
    this.attemptCount++;
    try {
      const result = await request();
      await writeReferenceControl(this.workDir, 'reference-requests', `${key}.json`, { ...receipt, status: 'succeeded', result });
      return result;
    } catch (error) {
      const status = (error as { requestOutcome?: string })?.requestOutcome === 'failed' ? 'failed' : 'outcome-unknown';
      const providerCode = String((error as { code?: unknown })?.code ?? '');
      const safeDetail = /^REFERENCE_PROVIDER_[A-Z_]+$/.test(providerCode) && error instanceof Error ? error.message.slice(0, 600) : '';
      // Never persist provider error bodies: relays may echo credentials or request data.
      await writeReferenceControl(this.workDir, 'reference-requests', `${key}.json`, { ...receipt, status, ...(safeDetail ? { message: safeDetail } : {}) });
      throw new Error(`VIRAL_REFERENCE_REQUEST_REVIEW: ${status === 'failed' ? '请求未取得可用结果' : '请求结果未知'}，已保留进度并停止自动重试。${safeDetail}`);
    }
  }
}

/** Called only after the UI's explicit acknowledgement of possible duplicate billing. */
export async function authorizeReferenceRequestRetries(workDir: string): Promise<number> {
  const entries = await readdir(join(workDir, 'reference-requests')).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[];
    throw error;
  });
  let count = 0;
  for (const name of entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const receipt = await readReferenceJson(workDir, `reference-requests/${name}`, receiptSchema);
    if (receipt.status === 'succeeded' || receipt.status === 'retry-authorized') continue;
    await writeReferenceControl(workDir, 'reference-requests', name, { ...receipt, status: 'retry-authorized',
      previousAttempts: [...(receipt.previousAttempts ?? []), { status: receipt.status, createdAt: receipt.createdAt }] });
    count++;
  }
  return count;
}
