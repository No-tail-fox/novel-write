import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function buildLemoAgentWorker(outfile = 'services/lemo-agent-worker/dist/worker.mjs') {
  const sdk = JSON.parse(await readFile('services/lemo-agent-worker/node_modules/@anthropic-ai/claude-agent-sdk/package.json', 'utf8'));
  if (sdk.version !== '0.3.314' || sdk.claudeCodeVersion !== '2.1.314') throw new Error('LEMO_SDK_VERSION_MISMATCH');
  const ai = JSON.parse(await readFile('services/lemo-agent-worker/node_modules/ai/package.json', 'utf8'));
  const openai = JSON.parse(await readFile('services/lemo-agent-worker/node_modules/@ai-sdk/openai/package.json', 'utf8'));
  if (ai.version !== '7.0.159' || openai.version !== '4.0.106') throw new Error('LEMO_NATIVE_SDK_VERSION_MISMATCH');
  await build({ entryPoints: ['services/lemo-agent-worker/worker.ts'], outfile, bundle: true, platform: 'node',
    format: 'esm', target: 'node22', packages: 'external', sourcemap: false });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildLemoAgentWorker();
  console.log('Lemo worker built: Claude SDK 0.3.314 / CLI 2.1.314; AI SDK 7.0.159 / OpenAI provider 4.0.106.');
}
