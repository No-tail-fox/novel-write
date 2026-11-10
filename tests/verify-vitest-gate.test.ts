import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectVitestFailures, evaluateVitestGate } from '../scripts/verify-vitest-gate.mjs';

const root = 'I:/repo';
const nonce = 'nonce-1';
const spawnedAtMs = 1_000_000;

function report(overrides: Record<string, unknown> = {}) {
  return {
    numTotalTestSuites: 3, numFailedTestSuites: 1, numTotalTests: 3, numFailedTests: 1, startTime: spawnedAtMs + 50, success: false,
    testResults: [
      { name: 'I:\\repo\\tests\\a.test.ts', status: 'passed', assertionResults: [{ status: 'passed', fullName: 'a works' }] },
      { name: 'I:\\repo\\tests\\b.test.ts', status: 'failed', assertionResults: [{ status: 'passed', fullName: 'b ok' }, { status: 'failed', fullName: 'b known bug' }] },
    ],
    ...overrides,
  };
}
const sidecar = (overrides: Record<string, unknown> = {}) => ({ nonce, reason: 'failed', unhandledErrors: 0, files: 2, ...overrides });
const baseline = { failures: ['tests/b.test.ts > b known bug'], requiresLocalVendor: ['tests/vendor.test.ts'] };
const gate = (overrides: Record<string, unknown> = {}) => evaluateVitestGate({
  run: { status: 1, signal: null }, report: report(), sidecar: sidecar(), nonce, spawnedAtMs, root, baseline, tolerateVendorOnly: false, updateBaseline: false,
  ...overrides,
} as never);

describe('verify vitest gate (Q-3)', () => {
  it('tolerates a real failed test that is in the baseline', () => {
    expect(collectVitestFailures(report(), root)).toEqual(['tests/b.test.ts > b known bug']);
    expect(gate()).toMatchObject({ ok: true, problems: [], unexpected: [], fixed: [] });
  });

  it('fails on a new failed test and reports fixed baseline entries only from a trustworthy run', () => {
    const next = report({ testResults: [
      { name: 'I:/repo/tests/a.test.ts', status: 'failed', assertionResults: [{ status: 'failed', fullName: 'a regressed' }] },
      { name: 'I:/repo/tests/b.test.ts', status: 'passed', assertionResults: [{ status: 'passed', fullName: 'b known bug' }] },
    ] });
    expect(gate({ report: next })).toMatchObject({ ok: false, unexpected: ['tests/a.test.ts > a regressed'], fixed: ['tests/b.test.ts > b known bug'] });
  });

  it('rejects a missing, corrupt or stale report instead of trusting leftovers', () => {
    expect(gate({ report: null })).toMatchObject({ ok: false, fixed: [] });
    expect(gate({ report: null }).problems.join()).toContain('missing or unreadable');
    expect(gate({ report: report({ startTime: spawnedAtMs - 60_000 }) }).problems.join()).toContain('predates this run');
    expect(gate({ sidecar: null }).problems.join()).toContain('sidecar) is missing');
    expect(gate({ sidecar: sidecar({ nonce: 'old-run' }) }).problems.join()).toContain('nonce mismatch');
    expect(gate({ report: report({ numFailedTests: undefined }) }).problems.join()).toContain('numFailedTests missing');
  });

  it('rejects startup errors and abnormal exits that have no failed assertions', () => {
    const clean = report({ numFailedTestSuites: 0, numFailedTests: 0, success: true, testResults: [report().testResults[0]] });
    expect(gate({ report: clean, run: { status: 0 } }).ok).toBe(true);
    expect(gate({ report: clean, run: { status: 1 } }).problems.join()).toContain('report is clean');
    expect(gate({ report: clean, run: { status: 0 }, sidecar: sidecar({ unhandledErrors: 2 }) }).problems.join()).toContain('2 unhandled error');
    expect(gate({ report: clean, run: { status: null, signal: 'SIGTERM' } }).problems.join()).toContain('signal SIGTERM');
    expect(gate({ report: clean, run: { status: 3 } }).problems.join()).toContain('exit status 3');
    expect(gate({ report: clean, run: { status: null, error: new Error('ENOENT') } }).problems.join()).toContain('could not be started');
    expect(gate({ report: clean, run: { status: 0 }, sidecar: sidecar({ reason: 'interrupted' }) }).problems.join()).toContain('did not finish');
    expect(gate({ report: clean, run: { status: 0 }, sidecar: sidecar({ reason: 'unknown' }) }).problems.join()).toContain('did not finish');
    expect(gate({ report: clean, run: { status: 0 }, sidecar: sidecar({ reason: 'passed' }) }).ok).toBe(true);
    expect(gate({ report: report({ numTotalTests: 0, numFailedTests: 0, testResults: [] }) }).problems.join()).toContain('0 tests');
    expect(gate({ report: report({ numRuntimeErrorTestSuites: 1 }) }).problems.join()).toContain('runtime errors');
    expect(gate({ report: report({ numFailedTests: 5 }) }).problems.join()).toContain('inconsistent');
    expect(gate({ report: report({ numFailedTestSuites: 2, numFailedTests: 0, testResults: [report().testResults[0]] }) }).problems.join()).toContain('no failed test file accounts');
    // Even when every failure is in the baseline, a run with unhandled errors still fails.
    expect(gate({ sidecar: sidecar({ unhandledErrors: 1 }) }).ok).toBe(false);
  });

  it('treats a file that failed to load as a failure id, and vendor-only files only in --ci without vendor', () => {
    const loadError = report({ testResults: [...report().testResults, { name: 'I:/repo/tests/vendor.test.ts', status: 'failed', assertionResults: [] }] });
    expect(gate({ report: loadError }).unexpected).toEqual(['tests/vendor.test.ts > (file failed to run)']);
    expect(gate({ report: loadError, tolerateVendorOnly: true }).ok).toBe(true);
  });

  it('--update-baseline only shrinks the baseline and never hides a new failure', () => {
    const next = report({ testResults: [
      { name: 'I:/repo/tests/a.test.ts', status: 'failed', assertionResults: [{ status: 'failed', fullName: 'a regressed' }] },
    ] });
    const result = gate({ report: next, updateBaseline: true });
    expect(result.ok).toBe(false);
    expect(result.nextBaseline).toEqual({ ...baseline, failures: [] });
    expect(result.notes.join()).toContain('still fail the gate');
    const untrusted = gate({ report: next, updateBaseline: true, sidecar: null });
    expect(untrusted.nextBaseline).toBeNull();
    expect(untrusted.notes.join()).toContain('NOT rewritten');
  });

  it('wires verify.mjs to delete old reports, pass a nonce and use the gate', async () => {
    const source = await readFile(new URL('../scripts/verify.mjs', import.meta.url), 'utf8');
    expect(source).toContain('rmSync(out, { force: true })');
    expect(source).toContain('rmSync(sidecarPath, { force: true })');
    expect(source).toContain('--reporter=./scripts/verify-vitest-reporter.mjs');
    expect(source).toContain('VERIFY_VITEST_NONCE: nonce');
    expect(source).toContain('evaluateVitestGate({');
    expect(source).not.toContain('vitestResult.ok =');
  });
});

describe('verify vitest gate with a real vitest run (small fixture)', () => {
  const repo = resolve(__dirname, '..');
  let fixtureDir = '';
  afterAll(async () => { if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true }); });

  function runFixture(dir: string) {
    const out = join(dir, 'out', 'vitest.json');
    const sidecarPath = join(dir, 'out', 'vitest-run.json');
    const runNonce = randomUUID();
    const started = Date.now();
    const run = spawnSync(process.execPath, [join(repo, 'node_modules/vitest/vitest.mjs'), 'run', '--root', dir, '--reporter=json',
      `--reporter=${join(repo, 'scripts/verify-vitest-reporter.mjs')}`, `--outputFile.json=${out}`], {
      cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 120_000,
      env: { ...process.env, VERIFY_VITEST_NONCE: runNonce, VERIFY_VITEST_SIDECAR: sidecarPath },
    });
    return { run, out, sidecarPath, runNonce, started };
  }

  it('accepts baseline failures, then rejects an unhandled error and a stale leftover report', async () => {
    // Inside the repo so the fixture resolves `vitest` from node_modules; no repo config applies (own --root).
    await mkdir(join(repo, '.artifacts'), { recursive: true });
    fixtureDir = await mkdtemp(join(repo, '.artifacts', 'verify-gate-fixture-'));
    await writeFile(join(fixtureDir, 'vitest.config.mjs'), 'export default { test: { include: ["*.test.mjs"] } };\n');
    await writeFile(join(fixtureDir, 'sample.test.mjs'), "import { it, expect } from 'vitest';\nit('passes', () => expect(1).toBe(1));\nit('known bug', () => expect(1).toBe(2));\n");
    const first = runFixture(fixtureDir);
    expect(first.run.status).toBe(1);
    const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
    const fixtureBaseline = { failures: ['sample.test.mjs > known bug'] };
    const accepted = evaluateVitestGate({ run: first.run, report: await read(first.out), sidecar: await read(first.sidecarPath), nonce: first.runNonce,
      spawnedAtMs: first.started, root: fixtureDir, baseline: fixtureBaseline, tolerateVendorOnly: false, updateBaseline: false });
    expect(accepted).toMatchObject({ ok: true, problems: [] });
    // The same files reused by a later run are stale: wrong nonce and an old start time.
    const stale = evaluateVitestGate({ run: first.run, report: await read(first.out), sidecar: await read(first.sidecarPath), nonce: 'later-run',
      spawnedAtMs: Date.now() + 60_000, root: fixtureDir, baseline: fixtureBaseline, tolerateVendorOnly: false, updateBaseline: false });
    expect(stale.ok).toBe(false);
    expect(stale.problems.join()).toMatch(/nonce mismatch.*predates this run/su);

    await writeFile(join(fixtureDir, 'sample.test.mjs'), "import { it } from 'vitest';\nit('passes but leaks', () => { setTimeout(() => { throw new Error('leak'); }, 0); return new Promise(r => setTimeout(r, 20)); });\n");
    const second = runFixture(fixtureDir);
    const rejected = evaluateVitestGate({ run: second.run, report: await read(second.out), sidecar: await read(second.sidecarPath), nonce: second.runNonce,
      spawnedAtMs: second.started, root: fixtureDir, baseline: fixtureBaseline, tolerateVendorOnly: false, updateBaseline: false });
    expect(rejected.ok).toBe(false);
    expect(rejected.problems.join()).toContain('unhandled error');
  }, 240_000);
});
