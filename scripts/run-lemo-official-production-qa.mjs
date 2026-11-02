/** Await real Electron QA and its persisted report; the provider is loopback-only. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = process.cwd();
const artifacts = resolve(root, '.artifacts/lemo-official-production-20261102');
const output = resolve(artifacts, 'run-' + Date.now());
const temp = join(artifacts, 'tmp');
await mkdir(temp, { recursive: true }); await mkdir(output, { recursive: true });
const bundle = join(artifacts, 'qa.mjs');
const { buildLemoAgentWorker } = await import('./build-lemo-agent-worker.mjs');
await buildLemoAgentWorker();
await build({ entryPoints: ['scripts/qa-lemo-official-production.ts'], outfile: bundle,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'warning' });
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', STORYDREAM_LEMO_ROOT: root,
  STORYDREAM_LEMO_OFFICIAL_QA_OUTPUT: output, STORYDREAM_LEMO_QA_NODE: process.execPath, TEMP: temp, TMP: temp };
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url);
const child = spawn(require('electron'), [bundle], { cwd: root, env, stdio: 'inherit', windowsHide: true });
// A successful GUI launch is insufficient: wait for process close and check the report.
const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code ?? 1)); });
assert.equal(code, 0, 'Official production Electron QA failed: ' + output);
const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
assert.equal(report.status, 'passed'); assert.equal(report.paidRequests, 0); assert.equal(report.externalFetchAttempts, 0);
assert(report.outputAsset?.localPath && report.outputAsset?.sha256);
console.log(JSON.stringify({ status: report.status, reportPath: join(output, 'report.json'), outputPath: report.outputAsset.localPath,
  paidRequests: 0, sdkVersion: report.sdkVersion, providerRequests: report.requests.length, qualityObservations: report.qualityObservations, recovery: report.recovery }));
