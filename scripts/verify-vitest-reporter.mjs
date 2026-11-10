/**
 * Tiny vitest reporter used only by scripts/verify.mjs. Vitest's JSON report has no field for unhandled errors
 * or for an interrupted run, so this writes a sidecar `{ nonce, reason, unhandledErrors, files }` that proves
 * the run finished and belongs to the current verify invocation (nonce from VERIFY_VITEST_NONCE).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export default class VerifyVitestRunReporter {
  onTestRunEnd(testModules, unhandledErrors, reason) {
    const target = process.env.VERIFY_VITEST_SIDECAR;
    if (!target) return;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify({
      nonce: process.env.VERIFY_VITEST_NONCE ?? '',
      reason: reason ?? 'unknown',
      // null (not 0) when the reporter API drifts, so the gate fails closed instead of assuming "no errors".
      unhandledErrors: Array.isArray(unhandledErrors) ? unhandledErrors.length : null,
      files: Array.isArray(testModules) ? testModules.length : null,
    })}\n`);
  }
}
