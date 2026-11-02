import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function buildLemoAgentWorker(outfile = 'services/lemo-agent-worker/dist/worker.mjs') {
  const sdk = JSON.parse(await readFile('services/lemo-agent-worker/node_modules/@anthropic-ai/claude-agent-sdk/package.json', 'utf8'));
  if (sdk.version !== '0.3.314' || sdk.claudeCodeVersion !== '2.1.314') throw new Error('LEMO_SDK_VERSION_MISMATCH');
  await build({ entryPoints: ['services/lemo-agent-worker/worker.ts'], outfile, bundle: true, platform: 'node',
    format: 'esm', target: 'node20', packages: 'external', sourcemap: false });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildLemoAgentWorker();
  console.log('Official Lemo SDK 0.3.314 / CLI 2.1.314 worker built.');
}
