import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedProcess } from '../src/shared/process-runner';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function main() {
  const parent = join(root, '.artifacts', 'vox-motion-variety-qa');
  await mkdir(parent, { recursive: true });
  const artifacts = await mkdtemp(join(parent, 'run-'));
  await build({ entryPoints: [join(root, 'scripts', 'qa-vox-motion-variety-entry.ts')], outfile: join(artifacts, 'entry.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['electron'], logLevel: 'silent' });
  await writeFile(join(artifacts, 'package.json'), JSON.stringify({ name: 'vox-motion-variety-qa', version: '1.0.0', type: 'module', main: 'entry.mjs' }), 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', STORYDREAM_VOX_VARIETY_QA: JSON.stringify({ root, artifacts }) };
  delete env.ELECTRON_RUN_AS_NODE;
  process.stdout.write(`${JSON.stringify({ artifacts, status: 'rendering' })}\n`);
  const result = await runBoundedProcess(createRequire(import.meta.url)('electron'), [artifacts], { cwd: root, env, timeoutMs: 10 * 60_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 2 * 1024 * 1024 });
  const report = JSON.parse(await readFile(join(artifacts, 'report.json'), 'utf8'));
  if (result.code !== 0 || report.status !== 'passed') throw new Error(JSON.stringify({ artifacts, report, stderr: result.stderr.slice(-3000) }, null, 2));
  process.stdout.write(`${JSON.stringify({ artifacts, status: report.status, sampleVideo: report.sampleVideo, measurements: report.measurements, externalCalls: report.externalCalls }, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
