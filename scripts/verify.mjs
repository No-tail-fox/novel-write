#!/usr/bin/env node
/**
 * One-shot quality gate (Q-3): upstream hash check, three tsc configs, eslint, full vitest.
 * Vitest failures are compared against tests/known-failures.json so the gate only fails on
 * NEW failures; fixed entries are reported so the baseline only shrinks.
 *
 *   node scripts/verify.mjs            # everything
 *   node scripts/verify.mjs --ci       # no local vendor trees: skip upstream check, tolerate vendor-only tests
 *   node scripts/verify.mjs --fast     # skip vitest
 *   node scripts/verify.mjs --update-baseline   # rewrite known-failures.json from this run (use sparingly)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  mkdirSync(dirname(out), { recursive: true });
  step('vitest (full)', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=4', '--reporter=dot', '--reporter=json', `--outputFile.json=${out}`]);
  const vitestResult = results.at(-1);
  if (existsSync(out)) {
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const failed = [];
    for (const file of report.testResults ?? []) {
      const rel = relative(root, file.name).replaceAll('\\', '/');
      const cases = (file.assertionResults ?? []).filter(item => item.status === 'failed');
      if (!cases.length && file.status === 'failed') failed.push(`${rel} > (file failed to run)`);
      for (const item of cases) failed.push(`${rel} > ${item.fullName ?? item.title}`);
    }
    const baselinePath = join(root, 'tests/known-failures.json');
    const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { failures: [], requiresLocalVendor: [] };
    const known = new Set(baseline.failures);
    const vendorOnly = new Set(baseline.requiresLocalVendor ?? []);
    const unexpected = failed.filter(id => !known.has(id) && !(ci && !vendorPresent && vendorOnly.has(id.split(' > ')[0])));
    const fixed = baseline.failures.filter(id => !failed.includes(id));
    if (args.has('--update-baseline')) {
      writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, failures: [...new Set(failed)].sort() }, null, 2)}\n`);
      console.log(`[verify] baseline rewritten with ${failed.length} failures.`);
    }
    console.log(`\n[verify] vitest: ${failed.length} failing, ${known.size} in baseline, ${unexpected.length} new, ${fixed.length} fixed.`);
    for (const id of unexpected) console.log(`  NEW  ${id}`);
    for (const id of fixed) console.log(`  FIXED (remove from tests/known-failures.json)  ${id}`);
    // Exit status also reflects baseline failures; the gate is "no new failures".
    vitestResult.ok = unexpected.length === 0 && (report.numTotalTests ?? 0) > 0;
  }
}

console.log('\n[verify] summary');
for (const item of results) console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.name} (${item.seconds}s)`);
process.exit(results.every(item => item.ok) ? 0 : 1);
