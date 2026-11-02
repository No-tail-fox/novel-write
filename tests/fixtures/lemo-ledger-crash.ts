import { LemoRequestLedger } from '../../services/lemo-agent-worker/request-ledger';
import { LemoResponseStore } from '../../services/lemo-agent-worker/response-store';
import { verifyMessagesReceipt } from '../../services/lemo-agent-worker/message-receipt';
import { recoverLemoLedgerOwner } from '../../services/lemo-agent-worker/ledger-owner';

// Deliberately exit with live handles. Do not add close/finally hooks: these
// durable files must be exactly those left behind by an interrupted worker.
async function send(message: Record<string, unknown>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) return reject(new Error('FIXTURE_REQUIRES_IPC'));
    process.send(message, error => error ? reject(error) : resolve());
  });
}
function stayAlive() { setInterval(() => undefined, 1000); }
process.on('disconnect', () => process.exit(75));

async function main() {
  const [mode, directory, checkpoint, fingerprint, encodedResponse] = process.argv.slice(2);
  if (mode === 'recover-crash') {
    await recoverLemoLedgerOwner(directory, checkpoint, async () => {
      await send({ event: 'ready', pid: process.pid });
      process.exit(74);
    });
    throw new Error('FIXTURE_DID_NOT_CRASH');
  }
  if (mode === 'recover') {
    const proceed = new Promise<void>(resolve => {
      process.once('message', message => {
        if ((message as { command?: string })?.command === 'recover') resolve();
        else process.exit(76);
      });
    });
    await send({ event: 'ready', pid: process.pid });
    await proceed;
    try {
      const ledger = await LemoRequestLedger.recoverInterruptedOwner(directory, 8, checkpoint);
      stayAlive();
      await send({ event: 'result', ok: true, pid: process.pid, summary: ledger.summary() });
    } catch (error) {
      await send({ event: 'result', ok: false, pid: process.pid, error: String(error) });
      process.exit(0);
    }
    return;
  }
  if (!['crash', 'hold'].includes(mode) || !['submitted', 'response-saved', 'received'].includes(checkpoint))
    throw new Error('FIXTURE_ARGUMENTS');
  const ledger = await LemoRequestLedger.open(directory, 8);
  const requestId = await ledger.begin(fingerprint);
  const response = Buffer.from(encodedResponse, 'base64');
  if (checkpoint !== 'submitted') {
    const store = await LemoResponseStore.open(ledger.responseDirectory);
    await store.save({ requestId, fingerprint, stream: false, response });
  }
  if (checkpoint === 'received')
    await ledger.settle(requestId, { outcome: 'received', httpStatus: 200, ...verifyMessagesReceipt(response, false) });
  if (mode === 'hold') stayAlive();
  await send({ event: 'ready', pid: process.pid, requestId, summary: ledger.summary() });
  if (mode === 'crash') process.exit(73);
}

main().catch(async error => {
  await send({ event: 'error', error: String(error) }).catch(() => undefined);
  process.exit(70);
});
