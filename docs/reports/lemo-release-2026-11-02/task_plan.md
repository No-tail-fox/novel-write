# Lemo official release resources

## Scope
Ship the fixed official SDK worker, CLI and standalone Node runtime; verify discovery, integrity, preparation failure and reversible activation. Do not edit lemo-official-production.ts, fixed vendor content or root plans. The parent authorized packaged runtime-config integration and only the Windows Bash locator sections of probe.ts/session.ts. A later narrow exception authorizes main.ts SmokeReport/runSmokeHandshake and smoke contract tests to distinguish first-launch license-gate acceptance from an authorized workspace; licensing and production entry points remain unchanged.

## Phases
1. Inspect packaging and runtime contracts — complete.
2. Implement staged, verified release bundle and reversible activation — complete.
3. Add meaningful failure, tamper, discovery and rollback tests — complete (55 release/locator/shell tests and 19 smoke contract tests); follow-up package/worker/version regression group also passes 13/13.
4. Restore Python after the legacy preparer failure and make preparation transactional — complete (11 filesystem/integrity tests, actual browser and three-template MP4 checks).
5. Build Windows distribution and verify isolated execution on this machine — in progress. Intermediate directory packages pass actual SDK/CLI/plugin, offline start/resume/cancel and first-launch license-gate checks. The strict SDK PATH contains only the bundled Node directory. Caption geometry passed, but full-suite follow-up repairs are still active; wait for the parent's unified SOURCE-FREEZE before the final rebuild and NSIS/blockmap. The original get-pip SHA now maps to an independently verified official immutable commit; clean network bootstrap remains unverified because that raw endpoint resets on this host. Continue using the restored validated runtime as authorized, without fabricating its marker.
6. Report exact evidence, integration points and acceptance boundaries — pending.

## Constraints
- Cache, temporary data and artifacts belong on D:.
- C: had only 209 MB free at initial inspection; D: had 24.1 GB free.
- No global Node or development absolute path can be required at installed runtime.
- Local isolated execution is not clean-machine acceptance.

## Errors
- Official nodejs.org download timed out; the configured mirror delivered the exact pinned archive SHA-256.
- Initial npm install against registry.npmjs.org failed with ETIMEDOUT/ECONNRESET and npm exit-handler error. Retry using the packaged Node and the configured registry mirror succeeded with the same unchanged lockfile integrity.
- Targeted TypeScript invocation initially needed TypeScript 6 --ignoreConfig; fixed the invocation and rollback pointer narrowing. Type checks then passed.
- The first package attempt invoked the legacy Python preparer, which deleted the active runtime before detecting a get-pip checksum mismatch. Restored the original Python from the existing portable release, reinstalled the exact hash-pinned Pixelle dependencies, and restored the exact Playwright browser revisions. No full package resulted from that failed attempt.
- Python preparation now checks both bootstrap hashes and completes installation and browser rendering in staging before transactional activation. It retains the original directory, rolls back failed activation/validation, and fails safely on the still-unresolved get-pip checksum mismatch. No trust hash was changed or bypassed.
