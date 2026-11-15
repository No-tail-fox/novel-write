import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createPiToolReceiptStore } from '../electron/pi-tool-receipts';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() { const root = await mkdtemp(join(tmpdir(), 'pi-receipts-')); roots.push(root); return root; }
it('replays durable tool output after restart without rerunning side effects', async () => {
  const root = await setup(); let calls = 0;
  const work = async () => ({ count: ++calls });
  expect(await createPiToolReceiptStore(root).execute('call', { tool: 'write' }, work)).toEqual({ count: 1 });
  expect(await createPiToolReceiptStore(root).execute('call', { tool: 'write' }, work)).toEqual({ count: 1 });
  expect(calls).toBe(1);
  await expect(createPiToolReceiptStore(root).execute('call', { tool: 'different' }, work)).rejects.toThrow('CONFLICT');
});
it('does not replay an action with unknown outcome', async () => {
  const root = await setup(); const store = createPiToolReceiptStore(root);
  await expect(store.execute('call', {}, async () => { throw new Error('crash after write'); })).rejects.toThrow('crash');
  let called = false;
  await expect(createPiToolReceiptStore(root).execute('call', {}, async () => { called = true; return {}; })).rejects.toThrow('OUTCOME_UNKNOWN');
  expect(called).toBe(false);
});
it('serializes duplicate concurrent calls', async () => {
  const store = createPiToolReceiptStore(await setup()); let count = 0;
  const results = await Promise.all([store.execute('same', {}, async () => ++count), store.execute('same', {}, async () => ++count)]);
  expect(results).toEqual([1, 1]);
});
