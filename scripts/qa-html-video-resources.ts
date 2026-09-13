import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedProcess } from '../src/shared/process-runner';
import { formatSmokeError, runSmokeWithTempRoot, setSmokeFailureExitCode } from './smoke-signal-lifecycle';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const faultsOnly = process.argv.includes('--faults-only');
const long1080p = process.argv.includes('--long-1080p');
const groupedSmoke = process.argv.includes('--grouped-smoke');
const artifacts = join(root, '.artifacts', faultsOnly ? 'html-video-render-faults-qa' : long1080p ? 'html-video-long-1080p-qa' : groupedSmoke ? 'html-video-grouped-qa' : 'html-video-resources-qa');

async function main() {
  await mkdir(artifacts, { recursive: true });
  const tempParent = join(root, '.tmp', 'storydream-test-temp');
  await mkdir(tempParent, { recursive: true });
  await runSmokeWithTempRoot({
    createTempRoot: () => mkdtemp(join(tempParent, 'html-resources-')),
    run: async ({ tempRoot, signal }) => {
      await build({
        entryPoints: [join(root, 'scripts', 'qa-html-video-resources-entry.ts')],
        outfile: join(tempRoot, 'entry.mjs'),
        bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['electron'], logLevel: 'silent',
      });
      await writeFile(join(tempRoot, 'package.json'), JSON.stringify({ name: 'html-resources-qa', version: '1.0.0', type: 'module', main: 'entry.mjs' }), 'utf8');
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', STORYDREAM_RESOURCE_QA: JSON.stringify({ root, artifacts, tempRoot, faultsOnly, long1080p, groupedSmoke }) };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = await runBoundedProcess(createRequire(import.meta.url)('electron'), [tempRoot], {
        cwd: root, env, signal, timeoutMs: long1080p ? 40 * 60_000 : 15 * 60_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 2 * 1024 * 1024,
      });
      const report = JSON.parse(await readFile(join(artifacts, 'report.json'), 'utf8'));
      if (result.code !== 0 || report.status !== 'passed') throw new Error(JSON.stringify({ report, stderr: result.stderr.slice(-3000) }));
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    },
    cleanup: (tempRoot) => rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  });
}

main().catch(async (error) => {
  try {
    const report = JSON.parse(await readFile(join(artifacts, 'report.json'), 'utf8'));
    await writeFile(join(artifacts, 'report.json'), JSON.stringify({ ...report, status: 'failed', wrapperError: formatSmokeError(error), finishedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (reportError) {
    process.stderr.write(`Could not persist QA failure: ${formatSmokeError(reportError)}\n`);
  } finally {
    process.stderr.write(`${formatSmokeError(error)}\n`);
    setSmokeFailureExitCode();
  }
});
