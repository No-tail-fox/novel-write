#!/usr/bin/env node
/**
 * One-shot quality gate (Q-3): upstream hash check, three tsc configs, eslint, full vitest.
 * Vitest failures are compared against tests/known-failures.json so the gate only fails on
 * NEW failures; fixed entries are reported so the baseline only shrinks.
 *
 *   node scripts/verify.mjs            # everything
 *   node scripts/verify.mjs --ci       # no local vendor trees: skip upstream check, tolerate vendor-only tests
 *   node scripts/verify.mjs --fast     # skip vitest
 *   node scripts/verify.mjs --update-baseline   # drop FIXED entries from known-failures.json (shrink only; new failures still fail)
 *
 * The vitest step only trusts a complete report written by this run (see scripts/verify-vitest-gate.mjs).
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateVitestGate } from './verify-vitest-gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const ci = args.has('--ci');
const results = [];

function step(name, command, commandArgs, options = {}) {
  const started = Date.now();
  process.stdout.write(`\n[verify] ${name}\n`);
  const run = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  const ok = run.status === 0;
  results.push({ name, ok, seconds: Math.round((Date.now() - started) / 1000) });
  return ok;
}

const vendorPresent = existsSync(join(root, 'vendor/lemo-upstream/storydream-upstream.json')) && existsSync(join(root, 'vendor/pixelle-upstream'));
if (!ci || vendorPresent) {
  if (!vendorPresent) {
    console.error('[verify] vendor/lemo-upstream or vendor/pixelle-upstream is missing. Import them with scripts/import-lemo-upstream.mjs <checkout> and scripts/import-pixelle-upstream.mjs <checkout>, or run with --ci.');
    results.push({ name: 'upstream vendor present', ok: false, seconds: 0 });
  } else {
    step('upstream: lemo hash verify', process.execPath, ['scripts/import-lemo-upstream.mjs', '--verify']);
    step('upstream: pixelle hash verify', process.execPath, ['scripts/import-pixelle-upstream.mjs', '--verify']);
  }
}
for (const config of ['tsconfig.json', 'tsconfig.electron.json', 'tsconfig.scripts.json']) {
  step(`tsc -p ${config}`, process.execPath, ['node_modules/typescript/bin/tsc', '-p', config, '--noEmit']);
}
step('eslint', process.execPath, ['node_modules/eslint/bin/eslint.js', 'src', 'electron', 'scripts', 'tests']);

if (!args.has('--fast')) {
  const out = join(root, '.artifacts', 'verify', 'vitest.json');
  const sidecarPath = join(root, '.artifacts', 'verify', 'vitest-run.json');
  mkdirSync(dirname(out), { recursive: true });
  // Never let a previous run's files stand in for this one.
  rmSync(out, { force: true });
  rmSync(sidecarPath, { force: true });
  const nonce = randomUUID();
  const started = Date.now();
  process.stdout.write('\n[verify] vitest (full)\n');
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=4', '--reporter=dot', '--reporter=json',
    '--reporter=./scripts/verify-vitest-reporter.mjs', `--outputFile.json=${out}`], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, VERIFY_VITEST_NONCE: nonce, VERIFY_VITEST_SIDECAR: sidecarPath },
  });
  const readJson = (path) => { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; } };
  const baselinePath = join(root, 'tests/known-failures.json');
  const baseline = readJson(baselinePath) ?? { failures: [], requiresLocalVendor: [] };
  const gate = evaluateVitestGate({
    run: { status: run.status, signal: run.signal, error: run.error }, report: readJson(out), sidecar: readJson(sidecarPath),
    nonce, spawnedAtMs: started, root, baseline, tolerateVendorOnly: ci && !vendorPresent, updateBaseline: args.has('--update-baseline'),
  });
  if (gate.nextBaseline) {
    writeFileSync(baselinePath, `${JSON.stringify(gate.nextBaseline, null, 2)}\n`);
    console.log(`[verify] baseline rewritten with ${gate.nextBaseline.failures.length} failures (shrink only).`);
  }
  for (const note of gate.notes) console.log(`[verify] ${note}`);
  for (const problem of gate.problems) console.log(`  ERROR  ${problem}`);
  console.log(`\n[verify] vitest: ${gate.failed.length} failing, ${(baseline.failures ?? []).length} in baseline, ${gate.unexpected.length} new, ${gate.fixed.length} fixed.`);
  for (const id of gate.unexpected) console.log(`  NEW  ${id}`);
  for (const id of gate.fixed) console.log(`  FIXED (remove from tests/known-failures.json)  ${id}`);
  // Exit status also reflects baseline failures; the gate is "complete report of this run + no new failures".
  results.push({ name: 'vitest (full)', ok: gate.ok, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log('\n[verify] summary');
for (const item of results) console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.name} (${item.seconds}s)`);
process.exit(results.every(item => item.ok) ? 0 : 1);
