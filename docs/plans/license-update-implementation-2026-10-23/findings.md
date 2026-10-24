# Findings

## Initial State

- Activation previously accepted renderer-provided plan/status/expiry through `activation:save`; account identity defaulted to `local-device`.
- The desktop already had a trusted IPC registrar with schema validation and an OS-encrypted provider credential vault.
- Packaging previously produced an unpacked directory and portable ZIP without an updater.
- The older account/credits plan was a design deliverable. This task authorizes a real authorization and update service; payment, SMS login, and credit billing remain outside scope.

## Implemented Service

- Python HTTPS service with SQLite WAL, transactional device-seat allocation, HMAC activation-code digests, audit records, and operator-only administration through SSH.
- Ed25519-signed short authorization leases and release manifests; device signatures, nonces, and timestamps protect authenticated requests.
- Private CA with an IP certificate, pinned by the desktop. The production deployment uses TCP 443 and a nonroot systemd service with only the bind-port capability.
- Code and virtual environment are root-owned; the service account writes only its private data directory. Deployment refuses conflicting paths/services and does not change SSH or firewall rules.
- Operators can issue codes, inspect licenses/devices/audits, lock/unlock/release devices, revoke/restore licenses, publish/withdraw updates, back up SQLite, and renew TLS without replacing the trust identity.

## Desktop Behavior

- The main process verifies authorization. Legacy `activation:save` cannot modify it. Generation is checked at IPC entry and provider dispatch, including queued work and generating model probes.
- Windows machine binding combines a hashed MachineGuid with a generated Ed25519 key encrypted using Electron safeStorage/DPAPI.
- Refresh occurs every 120 seconds. Offline access lasts only for the remaining signed lease, at most 10 minutes; restarting requires online verification.
- A lock or revocation blocks further generation after it is observed. Already submitted jobs may finish. Existing local works, editing, local render/export, and retrieval of submitted results remain accessible.
- Updates verify pinned TLS, signature, platform/architecture, version, release sequence, file size, and SHA-256. Downloads resume and are verified in full; installation requires confirmation and no active work.
- The Windows package now includes a per-user NSIS installer and portable ZIP. The existing application ID is retained.
- An unconfigured packaged application fails closed. Development remains usable when production licensing has not been configured; packaging rejects the placeholder configuration.

## Verified Limits

- Earlier SSH failures were resolved on 2026-10-24 with corrected access credentials. The deployed service is running and externally reachable with strict pinned-CA HTTPS.
- Production CA/signing identity exists, and `config/license-public.json` contains only its public configuration. Never reinitialize this identity after distribution.
- Real local TLS integration, service tests, desktop typechecks/build, and fixture UI checks passed; see `progress.md` for their exact scope.
- Deployment ran successfully on Ubuntu 24.04, preserving unrelated services. Actual Windows activation and the corrected QA-only 1.0.0 to production 1.0.2 installer upgrade passed, retaining activation and account data. See the dated progress record and production QA reports.
- Production release 1.0.2 is sequence 2. Release 1.0.1 was withdrawn after discovering the hidden NSIS launcher and is no longer downloadable. Interactive NSIS appends the app name to a custom directory that does not already contain it; the QA harness accounts for this standard installer behavior.
- A complete server-local private backup includes state, trust/signing keys, releases, code/venv and service/operator configuration. Service restart and external signed-release checks pass. Encrypted off-host backup storage is not configured.
- No Authenticode publisher certificate was supplied. Application-level update signatures do not replace Windows publisher signing.
- Existing old executables cannot be retroactively protected. MachineGuid binding is not TPM attestation, and client-side enforcement cannot stop a deliberately modified executable.
