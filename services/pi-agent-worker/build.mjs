import { build } from '../../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const installed = JSON.parse(await readFile(new URL('./node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url), 'utf8').catch(() => {
  throw new Error('Pi worker dependencies missing. Run npm ci in services/pi-agent-worker using Node >=22.19 before building.');
}));
if (installed.version !== '1.5.2') throw new Error('Pi worker requires pinned SDK 1.5.2; run npm ci in services/pi-agent-worker.');
await build({
  entryPoints: [fileURLToPath(new URL('./worker.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/worker.mjs', import.meta.url)),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
});
