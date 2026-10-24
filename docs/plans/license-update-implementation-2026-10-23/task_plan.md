# Authorization, Device Control, and Updates

## Goal

Implement and deploy activation codes, machine binding, device revocation, and verified desktop updates on the user-provided server. Keep existing local works accessible. Payment, SMS login, and platform credits are outside this implementation.

## Phases

1. [complete] Inspect server access and desktop integration boundaries; corrected credentials resolved the initial SSH blocker on 2026-10-24.
2. [complete] Implement the authorization service, operator commands, persistence, and signed leases/releases.
3. [complete] Integrate encrypted machine credentials, authorization gates, activation UI, and update UI.
4. [complete] Deploy the service without replacing unrelated server services. Production pinned-CA HTTPS is reachable on TCP 443.
5. [complete] Verify real packaged activation/lock/unbind and a real Windows installer upgrade; local protocol and UI checks also pass.
6. [complete] Update operator workflow and acceptance records for the actual deployment and release; create a full private server backup and verify the restarted endpoint externally.

## Delivery Status

- The service, desktop integration, operator commands, and local checks are implemented.
- 314 relevant Vitest tests in 15 files passed. All 6 current Python service tests passed locally and remotely. Renderer and Electron typechecks and the application build passed.
- Fixture-based Electron UI checks passed at 1440x900 and 1024x768, with 8 screenshots and no runtime errors. These are local UI checks, not evidence of production connectivity.
- SSH access succeeded on 2026-10-24 with the corrected credentials. The service runs as `storydream-license` on Ubuntu 24.04 with only the bind-port capability.
- Strict externally verified HTTPS health and production client configuration validation pass. Final signing and CA identity are initialized and must be retained.
- Real installed activation/lock/unbind acceptance passed, including MachineGuid/DPAPI, seat rejection, restart, revoke/restore and generation gates. No runtime errors.
- Real Windows upgrade from a corrected QA-only 1.0.0 baseline to production 1.0.2 passed: app-launched visible NSIS installation, restart, version/title-bar checks, retained activation and saved account. Release 1.0.1 is withdrawn. Isolated installer output: `.artifacts/license-release`.
- Full server backup completed outside the private state directory with mode 0600. Service restart, external strict TLS health, latest-release signature/version/hash, withdrawal rejection and QA cleanup checks pass.
- Acceptance and delivery details: `acceptance.zh-CN.md` in this directory. The one-device, 365-day owner license remains unused; the code is not stored in project files.
- Operations and recovery instructions: `services/license-server/README.md`. Test details: `progress.md` in this directory.

## Decisions

- Existing root planning files and unrelated working changes belong to other ongoing work; task records live here.
- Credentials stay out of source files, logs, and reports.
- Use authenticated encrypted transport and signed responses; no plain HTTP activation secrets.
- Do not equate an HTTP health check with a completed deployment.
- Shipping an already existing unsigned legacy build cannot retroactively enforce authorization.

## Errors

- Initial OpenSSH attempts closed before authentication. Resolved on 2026-10-24; actual SSH login, deployment and external HTTPS verification succeeded. See the dated history in `progress.md`.
- Renderer typecheck exposed a test using a nonexistent task:repack-draft channel; corrected to the actual step-6 task:rerun-step route and exempted local repack from the entry gate. Provider dispatch remains protected.
