/**
 * Pure decision logic for the vitest step of scripts/verify.mjs (Q-3), kept separate so it is unit-testable.
 *
 * The gate only trusts a report produced by THIS run:
 *   - verify.mjs deletes the old JSON before spawning vitest and passes a fresh nonce;
 *   - scripts/verify-vitest-reporter.mjs writes a sidecar with that nonce, the run end reason and the
 *     unhandled-error count (vitest's JSON report has no field for unhandled errors);
 *   - the JSON report's own `startTime` must not predate the spawn.
 * Anything missing, stale, inconsistent or abnormal (spawn error, signal, odd exit code, interrupted run,
 * unhandled errors, failed suites without a failed test) fails the gate. Only real failed tests / files that are
 * listed in tests/known-failures.json are tolerated. `--update-baseline` may only shrink the baseline.
 */

/** Clock skew allowance between the spawn timestamp and vitest's own `Date.now()` at init. */
export const VITEST_REPORT_CLOCK_SLACK_MS = 2_000;

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

function relativeTestPath(root, file) {
  const normalizedRoot = String(root).replaceAll('\\', '/').replace(/\/+$/u, '');
  const name = String(file ?? '').replaceAll('\\', '/');
  const lowerName = name.toLowerCase();
  const lowerRoot = `${normalizedRoot.toLowerCase()}/`;
  return lowerName.startsWith(lowerRoot) ? name.slice(lowerRoot.length) : name;
}

/** Failure ids in the baseline format (`tests/x.test.ts > full name` / `> (file failed to run)`). */
export function collectVitestFailures(report, root) {
  const failed = [];
  for (const file of Array.isArray(report?.testResults) ? report.testResults : []) {
    const rel = relativeTestPath(root, file?.name);
    const cases = (Array.isArray(file?.assertionResults) ? file.assertionResults : []).filter(item => item?.status === 'failed');
    if (!cases.length && file?.status === 'failed') failed.push(`${rel} > (file failed to run)`);
    for (const item of cases) failed.push(`${rel} > ${item.fullName ?? item.title}`);
  }
  return failed;
}

/**
 * Problems that make this run's evidence untrustworthy. Each one fails the gate regardless of the baseline.
 * @param {{ run: { status: number | null, signal?: string | null, error?: unknown }, report: any, sidecar: any,
 *           nonce: string, spawnedAtMs: number }} input
 */
export function vitestRunProblems({ run, report, sidecar, nonce, spawnedAtMs }) {
  const problems = [];
  if (run?.error) problems.push(`vitest could not be started: ${run.error instanceof Error ? run.error.message : String(run.error)}`);
  if (run?.signal) problems.push(`vitest was killed by signal ${run.signal}`);
  if (run?.status !== 0 && run?.status !== 1) problems.push(`vitest exited abnormally (exit status ${run?.status ?? 'none'})`);
  if (!report || typeof report !== 'object') {
    problems.push('vitest JSON report is missing or unreadable for this run');
    return problems;
  }
  if (!sidecar || typeof sidecar !== 'object') problems.push('vitest run summary (verify reporter sidecar) is missing for this run');
  else {
    if (sidecar.nonce !== nonce) problems.push('vitest run summary belongs to a different run (nonce mismatch)');
    // Vitest's TestRunEndReason is 'passed' | 'failed' | 'interrupted'; anything else fails closed.
    if (sidecar.reason !== 'passed' && sidecar.reason !== 'failed') problems.push(`vitest run did not finish (reason: ${sidecar.reason ?? 'unknown'})`);
    if (!isCount(sidecar.unhandledErrors)) problems.push('vitest run summary has no unhandled-error count');
    else if (sidecar.unhandledErrors > 0) problems.push(`vitest reported ${sidecar.unhandledErrors} unhandled error(s)`);
  }
  if (!Number.isFinite(report.startTime) || report.startTime < spawnedAtMs - VITEST_REPORT_CLOCK_SLACK_MS) problems.push('vitest JSON report predates this run (stale file)');
  for (const field of ['numTotalTestSuites', 'numFailedTestSuites', 'numTotalTests', 'numFailedTests']) {
    if (!isCount(report[field])) problems.push(`vitest JSON report is incomplete (${field} missing)`);
  }
  if (!Array.isArray(report.testResults) || report.testResults.length === 0) problems.push('vitest JSON report lists no test files');
  if (isCount(report.numTotalTests) && report.numTotalTests === 0) problems.push('vitest ran 0 tests');
  // Jest-compatible field; vitest 4 does not emit it today, but honour it if a future version does.
  if (report.numRuntimeErrorTestSuites !== undefined && (!isCount(report.numRuntimeErrorTestSuites) || report.numRuntimeErrorTestSuites > 0)) {
    problems.push(`vitest reported ${report.numRuntimeErrorTestSuites} test suite(s) with runtime errors`);
  }
  if (Array.isArray(report.testResults) && isCount(report.numFailedTests)) {
    const failedCases = report.testResults.reduce((count, file) => count
      + (Array.isArray(file?.assertionResults) ? file.assertionResults.filter(item => item?.status === 'failed').length : 0), 0);
    if (failedCases !== report.numFailedTests) problems.push(`vitest JSON report is inconsistent (${failedCases} failed cases listed, numFailedTests=${report.numFailedTests})`);
    const failedFiles = report.testResults.filter(file => file?.status === 'failed').length;
    // A describe-level hook failure fails a suite without failing a test; if no file carries it, nothing in the
    // baseline can account for it.
    if (isCount(report.numFailedTestSuites) && report.numFailedTestSuites > 0 && failedFiles === 0) {
      problems.push(`vitest reported ${report.numFailedTestSuites} failed suite(s) that no failed test file accounts for`);
    }
  }
  const reportClean = report.success === true && report.numFailedTests === 0 && report.numFailedTestSuites === 0;
  if (run?.status === 1 && reportClean && !(sidecar?.unhandledErrors > 0)) problems.push('vitest exited with failure although the report is clean (startup/config error?)');
  if (run?.status === 0 && !reportClean) problems.push('vitest exited 0 but the report contains failures');
  return problems;
}

/**
 * Gate decision.
 * @param {{ run: any, report: any, sidecar: any, nonce: string, spawnedAtMs: number, root: string,
 *           baseline: { failures?: string[], requiresLocalVendor?: string[] }, tolerateVendorOnly: boolean,
 *           updateBaseline: boolean }} input
 */
export function evaluateVitestGate(input) {
  const problems = vitestRunProblems(input);
  const baselineFailures = Array.isArray(input.baseline?.failures) ? input.baseline.failures : [];
  const known = new Set(baselineFailures);
  const vendorOnly = new Set(input.baseline?.requiresLocalVendor ?? []);
  const failed = input.report && typeof input.report === 'object' ? collectVitestFailures(input.report, input.root) : [];
  const unexpected = failed.filter(id => !known.has(id) && !(input.tolerateVendorOnly && vendorOnly.has(id.split(' > ')[0])));
  const trustworthy = problems.length === 0;
  // A fixed entry is only provable from a complete report of this run.
  const fixed = trustworthy ? baselineFailures.filter(id => !failed.includes(id)) : [];
  let nextBaseline = null;
  const notes = [];
  if (input.updateBaseline) {
    if (!trustworthy) notes.push('baseline NOT rewritten: this run did not produce a complete, trustworthy report');
    else {
      // Shrink only: new failures are never written into the baseline (add them by hand with a backlog entry).
      const current = new Set(failed);
      nextBaseline = { ...input.baseline, failures: baselineFailures.filter(id => current.has(id)).sort() };
      if (unexpected.length) notes.push(`baseline rewritten without ${unexpected.length} new failure(s); they still fail the gate`);
    }
  }
  return { ok: trustworthy && unexpected.length === 0, problems, failed, unexpected, fixed, nextBaseline, notes };
}
