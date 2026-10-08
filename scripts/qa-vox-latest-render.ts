import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { runBoundedProcess } from '../src/shared/process-runner';

async function main() {
  const root = resolve('.');
  const artifacts = join(root, '.artifacts', 'vox-latest-media-20260916', 'real-shot-render');
  await mkdir(artifacts, { recursive: true });
  await build({ entryPoints: [join(root, 'scripts/qa-vox-latest-render-entry.ts')], outfile: join(artifacts, 'entry.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', external: ['electron'], logLevel: 'silent' });
  await writeFile(join(artifacts, 'bootstrap.mjs'), "import { app } from 'electron';\nimport { writeFileSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';\nimport('./entry.mjs').catch(error => { writeFileSync(fileURLToPath(new URL('./report.json', import.meta.url)), JSON.stringify({ status: 'failed', error: String(error.stack ?? error) }, null, 2)); app.exit(1); });\n", 'utf8');
  await writeFile(join(artifacts, 'package.json'), JSON.stringify({ name: 'vox-latest-real-shot-audit', version: '1.0.0', type: 'module', main: 'bootstrap.mjs' }), 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', STORYDREAM_VOX_LATEST_QA: JSON.stringify({ root, artifacts }) };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await runBoundedProcess(createRequire(import.meta.url)('electron'), [artifacts], { cwd: root, env, timeoutMs: 10 * 60_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 2 * 1024 * 1024 });
  const report = JSON.parse(await readFile(join(artifacts, 'report.json'), 'utf8'));
  if (result.code !== 0 || report.status !== 'passed') throw new Error(JSON.stringify({ report, stderr: result.stderr.slice(-3000) }));
  process.stdout.write(JSON.stringify(report, null, 2));
}
main().catch(error => { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; });
