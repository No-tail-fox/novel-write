# Progress

## 2026-10-24 Deployment

- Corrected SSH credentials succeeded. Inspected Ubuntu 24.04.1, listening sockets, systemd, storage and existing services before deploying.
- Deployed root-owned code/venv in `/opt/storydream-license`, private state in `/var/lib/storydream-license`, nonroot systemd service and SSH-only operator wrapper.
- External TCP 8443 was unreachable; TCP 443 is reachable. Deployed on 443 using only `CAP_NET_BIND_SERVICE`, preserving SSH, Docker services and firewall rules.
- Python 3.13 strict TLS verification exposed missing certificate authority identifiers. Added SKI/AKI and server leaf usage extensions, plus a strict-verification regression. Six Python tests now pass both locally and on the deployed host.
- Initial unused trust state was moved into a root-only bootstrap backup before final 443 initialization. Final trust state is now established; do not reinitialize it.
- Imported only the public endpoint, CA and signing verification key. Production config validation and strict pinned-CA health from Windows pass (HTTP 200).
- Production application build passes. Building a configured 1.0.0 baseline in isolated output for real activation and subsequent 1.0.1 updater acceptance. Older release artifacts are preserved.
- Added `scripts/qa-license-production.py`: uses the actual installed executable, real MachineGuid/DPAPI and trusted preload API. SSH secrets are read without echo and never written into the script or reports.
- Real installed 1.0.0 activation acceptance passed: Windows MachineGuid/DPAPI binding, second-device seat rejection, restart with fresh lease, remote lock/unlock, license revoke/restore, operator release and desktop unbind. Generation gates reject while unauthorized; local bootstrap remains accessible. Report: `.artifacts/license-production-qa/activation-report.json`; screenshots: `active.png`, `locked.png`. No runtime errors.
- Bumped package and lockfile root versions to 1.0.1 for real signed-update acceptance. The 1.0.0 baseline is installed only in the isolated QA directory.
- Rebuilt after the version bump to update the renderer's embedded title-bar version. Final installer: `.artifacts/license-release/StoryDream-Setup-1.0.1.exe`, 542209225 bytes, SHA-256 `8813a65b1d2b52b0f8e5fd9d0adf5908b45bd06aeefb3b8f256d316983a1fcc5`. No Windows publisher certificate is configured.
- Added the Chinese operator guide `services/license-server/OPERATIONS.zh-CN.md`; UTF-8 readback verified.
- Uploaded the installer through verified SSH connections and matched the complete remote SHA-256 before publishing 1.0.1 at release sequence 1. Production filename: `StoryDream-Setup-1.0.1-f93b60ecbb4c.exe`. Publication report: `.artifacts/license-production-qa/publish-report.json`.
- Issued a one-device, 365-day owner activation code, valid from first activation; the unused earlier owner code is revoked. Codes are not stored in project files or reports.
- Real desktop HTTPS download reached approximately 47 MiB on the slow single connection. Interrupted it to exercise resume acceptance: eight pinned-CA HTTPS connections prepare the partial file up to the final 8 MiB, then the actual desktop resumes and verifies the entire installer. This is distinct from a complete single-connection download. GUI-driven upgrade acceptance is in progress.
- Production acceptance caught a hidden NSIS wizard: the updater launched an interactive installer with `windowsHide: true`. Corrected it to `false`; 9 focused licensing/config tests and the full application build pass. Withdrew 1.0.1 rather than replacing its signed bytes. Preparing a corrected QA-only 1.0.0 baseline and a higher 1.0.2 production release for visible-wizard acceptance.
- The QA process observer now starts before installation and retains its browser connection until installation finishes. This avoids destroying detached installer descendants when a CDP connection closes and records the actual app-launched installer PID.
- Installed the corrected QA-only 1.0.0 baseline without replacing its existing profile. Extracted its installed ASAR to confirm both version 1.0.0 and the visible-installer fix. This baseline is an acceptance fixture, not a distributed production version.
- Built production 1.0.2 successfully: `.artifacts/license-release/StoryDream-Setup-1.0.2.exe`, 542244813 bytes, SHA-256 `5f156e8a33b66bc6b553e6303b1e291f276e1209d18fa3508e6943a6ba6faa21`. Upload and final acceptance are in progress.
- Uploaded and matched the complete remote SHA-256, then published 1.0.2 at sequence 2. Production filename: `StoryDream-Setup-1.0.2-0cda6f91912f.exe`. Started the final real desktop resume/install/restart acceptance against this release.
- Real desktop resumed the final 8388608 bytes of a 533856205-byte HTTPS partial file and verified the entire 542244813-byte installer. Observed the app-launched installer PID and drove its visible Chinese Next/Install/Finish controls to completion.
- After the wizard finished, the harness initially used the old QA executable path. NSIS's standard interactive directory sanitization appended `StoryDream` to the QA-only `installed` directory. Added lookup of both actual paths and a `verify-upgrade` recovery mode that preserves the earlier installer observation and failure in the report. This change affects only the acceptance script.
- Completed verification of the actual installed 1.0.2: package version and visible title-bar match; the same DPAPI license vault obtains an active lease; saved account marker survives. No runtime errors. `.artifacts/license-production-qa/update-report.json` is passed; screenshot `updated.png` was inspected. The starting 1.0.0 baseline includes the launcher fix and was QA-only, not a claim that the withdrawn original launcher worked.
- Revoked the QA license and released its machine. Database checks confirm zero occupied devices, the earlier owner license still revoked, and the final one-device/365-day owner license valid but not yet started.
- Created a complete state/code/venv/systemd/operator backup at `/root/storydream-license-backups/storydream-license-20261023T175858Z.tar`, mode 0600, size 2200791040 bytes, SHA-256 `f83ee78b988e9963ce95ef3fcf004374374fa1aff50643eb3a544e833cb0e942`. Stopped only the license service and used an EXIT trap to restart even on failure; tar listing verification passed. This is a server-local backup, not an encrypted off-host backup.
- After restart: systemd active/enabled; external strict pinned-CA `/v1/health` returns HTTP 200; latest manifest Ed25519 signature verifies with version 1.0.2, sequence 2 and expected SHA-256. Withdrawn 1.0.1 download returns HTTP 404. SSH and the pre-existing Docker port-80 listener remain intact.
- Final production-config validation passes. The scoped tracked-file whitespace check passes apart from Git's existing CRLF normalization notice. Chinese operator guide read back correctly as UTF-8. Installer publication and acceptance sessions have completed.

## 2026-10-23

- Read existing authorization design, trusted IPC, packaging, and credential storage.
- Read StoryDream UI and planning skills. Read the web-access skill for network guidance; its browser-only setup is not applicable to SSH server administration.
- Confirmed local OpenSSH, Node, Python, PowerShell 7, and Paramiko are installed.
- Started server connectivity diagnosis before any remote mutation.

## Implementation Completed

- Added the HTTPS authorization/update service, SQLite persistence, signed leases/releases, device proofs, operator commands, private-CA initialization/renewal, nonroot systemd unit, and guarded deployment script.
- Integrated main-process machine credentials, authorization refresh/expiry notifications, generation gates, and update download/install handling.
- Replaced the activation screen with real license and update controls, including unbind/install confirmation, lock states, download progress, and busy-install rejection.
- Added a per-user Windows NSIS installer and a packaging guard requiring production trust configuration.
- Preserved access to local works and already submitted results. Added provider-dispatch checks for transcription, frame analysis, image-generation probes, and text-generation probes.
- Preserved strict IPC channel ordering and verified it against preload and the shared inventory.

## Local Verification Completed

All commands below completed; no required test/build sessions remain running.

- 314/314 Vitest tests passed across 15 files:

  ```powershell
  node node_modules/vitest/vitest.mjs run tests/licensing.test.ts tests/electron-ipc-contract.test.ts tests/ipc-contract.test.ts tests/ipc-inventory.test.ts tests/license-config-validation.test.ts tests/llm-provider.test.ts tests/media-providers.test.ts tests/video-provider.test.ts tests/music-provider.test.ts tests/music-voice-enhanced.test.ts tests/viral-reference-providers.test.ts tests/task-runtime-providers.test.ts tests/history-activity-registry.test.ts tests/viral-runtime.test.ts tests/config-utils.test.ts
  ```

- 5/5 Python service tests passed with `python -m unittest -v test_server.py` from `services/license-server`.
- Real local TLS tests cover activation, locks/revocation/unbinding, signed releases, resumable download, corrupt installers, CA mismatch, replay defenses, packaged fail-closed behavior, offline expiry, and restart requiring online verification. Python tests additionally cover concurrent device-seat allocation and TLS renewal preserving the trust identity.
- A dispatch regression locks authorization after provider creation, then confirms transcription, frame analysis, and generating model probes fail with `DEVICE_LOCKED` before any fetch.
- Renderer and Electron typechecks passed:

  ```powershell
  node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
  node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit
  ```

- `pwsh -NoProfile -File scripts/build.ps1` passed. Existing Vite browser-externalization warnings from network-policy/undici remain. This is not a claim that every repository test or scripts-only typecheck passed.
- `python scripts/qa-license.py` passed 3 UI workflow groups with 8 screenshots, zero runtime errors, and no layout overflow at 1440x900 and 1024x768. Report: `.artifacts/license-qa/report.json`. This harness uses explicit fixtures and is not a production-server acceptance test.
- Deployment script and operator wrapper passed separate Bash syntax checks. Neither has been executed on Linux.
- `node scripts/check-license-config.mjs` intentionally exits 1 for the empty placeholder and explains that the deployed server's public configuration is required. No fabricated trust configuration was inserted.

## Historical Deployment Blocker (Resolved on 2026-10-24)

The following records describe the earlier failed access attempts. Current deployment and acceptance status is in the 2026-10-24 section above.

- OpenSSH and Paramiko attempts to `154.219.120.162` on ports 22 and 2222 close before authentication. Password validity is unknown; unchanged probes were not repeated.
- User requested a retry on 2026-10-23. OpenSSH again reached TCP on 22, 2222, and 2022, then reported `kex_exchange_identification: Connection closed by remote host` without receiving an SSH banner or reaching authentication. TCP checks on 2022, 10022, 22022, and 22222 all accepted connections but returned no banner within 5 seconds. HTTPS on 8443 failed during TLS handshake. No password was attempted and no remote change was made.
- No successful SSH login, remote deployment, production activation code, or remote release publication occurred.
- The next external input is confirmation/correction of the SSH forwarding or access/security-group policy, and a reachable SSH endpoint that presents an SSH banner. Credentials do not need to be supplied again for the same endpoint.
- Once access works: inspect OS/services, deploy without replacing unrelated applications, allow the service port through existing firewall/security-group controls, verify pinned-CA health externally, import only `client-public.json`, build the configured installer, and verify activation/lock/unbind plus a real Windows upgrade retaining user data.
- No Authenticode publisher certificate is configured. Production Windows installation and upgrade behavior still require acceptance on an actual configured build.
- Operator workflow, update publication, backup/restore, and TLS renewal are documented in `services/license-server/README.md`.
