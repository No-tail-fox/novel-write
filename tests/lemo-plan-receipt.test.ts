import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedLemoPlanResponse } from '../electron/lemo-plan-receipt';
const roots: string[] = [];
const setup = async () => { const work = await mkdtemp(join(tmpdir(), 'lemo-receipt-')); roots.push(work); return work; };
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const result = { json: { treatment: 'outline'.repeat(900), fps: 24 }, raw: 'original paid response', requestId: 'provider-1', finishReason: 'end_turn', usage: { output_tokens: 5000 } };
const context = { runId: 'run-1', requestId: 'request-1' };
describe('durable planning response receipts', () => {
 it('reuses the untouched paid result after a local validator fails and a new claim is made', async () => {
  const work = await setup(), generate = vi.fn(async () => result);
  expect(await cachedLemoPlanResponse(work, context, { model: 'opus', prompt: 'outline' }, generate)).toEqual(result);
  expect(await cachedLemoPlanResponse(work, { ...context, requestId: 'retry-claim' }, { model: 'opus', prompt: 'outline' }, generate)).toEqual(result);
  expect(generate).toHaveBeenCalledTimes(1);
  const files = await readdir(join(work, 'plan-receipts')); expect(files).toHaveLength(1);
  const receipt = JSON.parse(await readFile(join(work, 'plan-receipts', files[0]), 'utf8'));
  expect(receipt.requestId).toBe(context.requestId); expect(receipt.result.usage.output_tokens).toBe(5000);
 });
 it.each(['run', 'input'])('does not reuse results when the %s changes', async field => {
  const work = await setup(), generate = vi.fn(async () => result);
  await cachedLemoPlanResponse(work, context, { prompt: 'one' }, generate);
  await cachedLemoPlanResponse(work, field === 'run' ? { ...context, runId: 'run-2' } : context, { prompt: field === 'input' ? 'two' : 'one' }, generate);
  expect(generate).toHaveBeenCalledTimes(2);
 });
 it('never replaces a corrupt receipt by silently spending again', async () => {
  const work = await setup(), generate = vi.fn(async () => result);
  await cachedLemoPlanResponse(work, context, {}, generate);
  const [file] = await readdir(join(work, 'plan-receipts'));
  await writeFile(join(work, 'plan-receipts', file), '{}', 'utf8');
  await expect(cachedLemoPlanResponse(work, context, {}, generate)).rejects.toThrow('LEMO_PLAN_RECEIPT_INVALID');
  expect(generate).toHaveBeenCalledTimes(1);
 });
 it('does not turn a provider failure into a completed receipt', async () => {
  const work = await setup();
  await expect(cachedLemoPlanResponse(work, context, {}, async () => { throw Error('interrupted'); })).rejects.toThrow('interrupted');
  await expect(readdir(join(work, 'plan-receipts'))).rejects.toMatchObject({ code: 'ENOENT' });
 });
});
