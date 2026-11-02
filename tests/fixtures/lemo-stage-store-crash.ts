import { LemoStageStore, type LemoStageStoreOptions } from '../../services/lemo-agent-worker/stage-store';

async function send(message: Record<string, unknown>) {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) return reject(new Error('FIXTURE_IPC'));
    process.send(message, error => error ? reject(error) : resolve());
  });
}
process.on('disconnect', () => process.exit(83));
async function main() {
  const [mode, encodedOptions, checkpoint] = process.argv.slice(2);
  const options = JSON.parse(encodedOptions) as LemoStageStoreOptions;
  if (mode === 'contend') {
    const go = new Promise<void>(resolve => process.once('message', () => resolve()));
    await send({ event: 'ready', pid: process.pid }); await go;
    try {
      const store = await LemoStageStore.open(options);
      await store.recordSession('session_concurrent'); await store.startAttempt('start');
      setInterval(() => undefined, 1000);
      await send({ event: 'result', ok: true, pid: process.pid, snapshot: store.snapshot() });
    } catch (error) {
      await send({ event: 'result', ok: false, pid: process.pid, error: String(error) }); process.exit(0);
    }
    return;
  }
  const store = await LemoStageStore.open(options);
  await store.recordSession('session_process_crash');
  await store.startAttempt('start');
  if (checkpoint === 'tool-started') await store.recordToolEvent({ version: 1, operationId: 'op_crash', tool: 'write_file',
    phase: 'started', argumentsSha256: 'a'.repeat(64), at: new Date().toISOString() });
  if (checkpoint === 'completed') await store.complete({ status: 'completed', resultSubtype: 'success' });
  if (mode === 'hold') setInterval(() => undefined, 1000);
  await send({ event: 'ready', pid: process.pid, snapshot: store.snapshot() });
  // No close or finally: exercise durable state left by a terminated worker.
  if (mode === 'crash') process.exit(81);
}
main().catch(async error => { await send({ event: 'error', error: String(error) }).catch(() => undefined); process.exit(82); });
