import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export interface PiToolReceipt { version: 1; callId: string; inputHash: string; state: 'submitted' | 'completed'; result?: unknown }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function durableWrite(path: string, value: unknown) {
  const temp = path + '.' + randomUUID() + '.tmp';
  const file = await open(temp, 'wx');
  try { await file.writeFile(JSON.stringify(value) + '\n', 'utf8'); await file.sync(); }
  finally { await file.close(); }
  await rename(temp, path);
}
/** Host-owned directory, outside the agent-writable project. One serialized owner per run. */
export function createPiToolReceiptStore(directory: string) {
  let queue: Promise<unknown> = Promise.resolve();
  async function execute(callId: string, input: unknown, action: () => Promise<unknown>): Promise<unknown> {
    if (!callId || callId.length > 512) throw new Error('PI_TOOL_CALL_ID');
    await mkdir(directory, { recursive: true });
    const path = join(directory, createHash('sha256').update(callId).digest('hex') + '.json');
    const inputHash = digest(input);
    let receipt: PiToolReceipt | undefined;
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (value.version !== 1 || value.callId !== callId || value.inputHash !== inputHash || !['submitted', 'completed'].includes(value.state)) throw new Error('PI_TOOL_RECEIPT_CONFLICT');
      receipt = value as PiToolReceipt;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (receipt?.state === 'completed') return receipt.result;
    if (receipt) throw new Error('PI_TOOL_OUTCOME_UNKNOWN: Inspect prior artifacts before issuing a new tool action.');
    await durableWrite(path, { version: 1, callId, inputHash, state: 'submitted' });
    // A crash or rejected action leaves a submitted receipt. Do not automatically replay side effects.
    const result = await action();
    if (result === undefined) throw new Error('PI_TOOL_RESULT_MISSING');
    await durableWrite(path, { version: 1, callId, inputHash, state: 'completed', result });
    return result;
  }
  return { execute(callId: string, input: unknown, action: () => Promise<unknown>) {
    const pending = queue.then(() => execute(callId, input, action));
    queue = pending.catch(() => {}); return pending;
  } };
}
