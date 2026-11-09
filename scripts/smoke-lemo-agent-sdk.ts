import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { probeOfficialLemoAgentRuntime } from '../electron/lemo-agent-runtime';
const root = resolve('.artifacts/lemo-agent-sdk-smoke');
await mkdir(root, { recursive: true });
const result = await probeOfficialLemoAgentRuntime({ nodeExecutable: process.execPath,
  workerPath: resolve('services/lemo-agent-worker/dist/worker.mjs'),
  runRoot: root, upstreamRoot: resolve('vendor/lemo-upstream') });
await writeFile(resolve(root, 'report.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result));
