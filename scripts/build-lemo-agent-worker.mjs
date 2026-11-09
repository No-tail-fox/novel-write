import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const sdk = JSON.parse(await readFile('services/lemo-agent-worker/node_modules/@anthropic-ai/claude-agent-sdk/package.json', 'utf8'));
if (sdk.version !== '0.3.314') throw new Error('LEMO_SDK_VERSION_MISMATCH');
await build({ entryPoints: ['services/lemo-agent-worker/worker.ts'],
  outfile: 'services/lemo-agent-worker/dist/worker.mjs', bundle: true, platform: 'node',
  format: 'esm', target: 'node20', packages: 'external', sourcemap: false });
console.log('Official Lemo SDK worker built (readiness only; production remains gated).');
