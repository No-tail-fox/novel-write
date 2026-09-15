import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { runBoundedProcess } from '../src/shared/process-runner';

const root = resolve(import.meta.dirname, '..');
async function main() {
  const parent = join(root, '.artifacts', 'vox-audio-sync-qa');
  await mkdir(parent, { recursive: true });
  const artifacts = await mkdtemp(join(parent, 'run-'));
  await build({ entryPoints: [join(root, 'scripts/qa-vox-audio-sync-entry.ts')], outfile: join(artifacts, 'entry.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['electron'], logLevel: 'silent' });
  await writeFile(join(artifacts, 'package.json'), JSON.stringify({ name: 'vox-audio-sync-qa', version: '1.0.0', type: 'module', main: 'entry.mjs' }), 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env, STORYDREAM_VOX_AUDIO_QA: JSON.stringify({ root, artifacts }) };
  delete env.ELECTRON_RUN_AS_NODE;
  process.stdout.write(JSON.stringify({ artifacts, status: 'rendering' }) + '\n');
  const result = await runBoundedProcess(createRequire(import.meta.url)('electron'), [artifacts], { cwd: root, env, timeoutMs: 10 * 60_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 2 * 1024 * 1024 });
  const report = JSON.parse(await readFile(join(artifacts, 'report.json'), 'utf8'));
  if (result.code !== 0 || report.status !== 'passed') throw new Error(JSON.stringify({ artifacts, report, stderr: result.stderr.slice(-2000) }));
  process.stdout.write(JSON.stringify({ artifacts, ...report }, null, 2));
}
main().catch(error => { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; });
