/** Runs isolated QA with native dependencies external; no API calls unless explicitly enabled. */
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = process.cwd();
const bundle = resolve(root, '.artifacts/lemo-upstream-production/qa.mjs');
await build({ entryPoints: ['scripts/qa-lemo-upstream-production.ts'], outfile: bundle,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'warning' });
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(resolve(root, 'node_modules/electron/dist/electron.exe'), [bundle],
  { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
