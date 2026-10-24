# StoryDream Licensing and Updates

Deployment status (2026-10-24): the service is running on Ubuntu 24.04 at `https://154.219.120.162:443`. Strict pinned-CA HTTPS health from Windows passes. The repository contains the actual public client trust configuration. Six service tests pass locally and on the deployed server. Real packaged activation/lock/unbind and the corrected QA-only 1.0.0 to production 1.0.2 installer upgrade passed, preserving activation and account data. Acceptance: [acceptance.zh-CN.md](../../docs/plans/license-update-implementation-2026-10-23/acceptance.zh-CN.md).

Chinese operator guide: [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md).

## Deployment

Target: Debian/Ubuntu, Python 3.10+, systemd, public IPv4 address, TCP 443 available. Keep the existing SSH session open during deployment. Inspect `ss -ltnp` and existing services first. This installer does not change SSH, firewall rules, or other applications.

Transfer this directory over a verified SSH connection, then run on the server:

```bash
cd /root/storydream-license-bundle
bash deploy.sh 154.219.120.162
systemctl status storydream-license --no-pager
journalctl -u storydream-license -n 50 --no-pager
```

The installer defaults to port 443; supply a second argument to select a different available port. The nonroot service has only `CAP_NET_BIND_SERVICE` for the HTTPS listener. The installer refuses unmanaged existing installation directories and initializes keys only in an empty data directory. Code and venv are root-owned under `/opt/storydream-license`; the unprivileged service can write only `/var/lib/storydream-license`. Dependency installation needs access to the OS package registry and PyPI. Review this script before running it on a different distribution.

For a later server-code deployment, back up first and stop this service during a maintenance window. The installer refuses to change a running service or a conflicting operator command. Its local readiness check connects through loopback while verifying the public-IP TLS certificate; external reachability must still be checked separately.

Allow the selected inbound TCP port in both the cloud security group and host firewall. Use the host's current firewall manager; do not flush or replace rules. Verify health from a second machine with the pinned CA. A server-local health response alone does not establish external reachability. On the deployed host, external 8443 was unreachable; the final service uses 443 and leaves Docker's existing port-80 service and firewall rules intact.

Download **only** `/var/lib/storydream-license/client-public.json` into the repository as `config/license-public.json`. It contains the public endpoint, CA certificate, and Ed25519 verification key. Never copy private keys or `secrets.json` into the app or repository. Rebuild after this step. The package script intentionally rejects the placeholder configuration.

```powershell
node scripts/check-license-config.mjs
npm run package:win
```

Verify the resulting installer on a clean Windows x64 profile against the actual server before distribution. This implementation does not supply an Authenticode publisher certificate. Existing old executables cannot be retroactively protected; distribute the newly configured build.

## Operator Commands

Run through SSH as root or with sudo. No public administration endpoint is exposed.

```bash
storydream-license issue --days 365 --max-devices 1 --label customer-reference
storydream-license licenses
storydream-license devices
storydream-license lock-device DEVICE_SHA256 --reason operator-reference
storydream-license unlock-device DEVICE_SHA256
storydream-license release-device DEVICE_SHA256
storydream-license revoke-license LICENSE_UUID
storydream-license restore-license LICENSE_UUID
storydream-license audit
```

Activation codes are shown once on issue. The database retains an HMAC digest and last four characters. Store the issued code in the operator's existing secure records; reissue if lost. Validity starts at first activation. Rebinding does not restart its duration. Device seats are allocated in a SQLite write transaction.

Machine binding combines a hashed Windows MachineGuid with a generated Ed25519 key encrypted by Windows DPAPI. Copying app data to another machine does not transfer that private key. A Windows reinstall or lost OS credential may require `release-device` before reactivation. VM or OS cloning can duplicate MachineGuid; this is not a TPM attestation system.

The app refreshes every 120 seconds and before dispatch when a refresh is due. A lock, release, revocation, or expiry blocks subsequent generation after it is observed. Offline use is limited to the remaining signed lease, at most 10 minutes. Already submitted provider jobs may finish, and local viewing, editing, rendering/export and result retrieval remain accessible. A restart requires a fresh online lease. Client-side software cannot prevent a deliberately modified executable; signing and short leases protect the unmodified distributed app.

## Publish Updates

Increment `package.json` version using three decimal components, rebuild with the production trust configuration, and transfer the generated NSIS installer to a service-readable staging directory. Keep uploaded files under the private data directory, owned by `storydream-license`, mode 0600.

```bash
storydream-license publish --file /var/lib/storydream-license/incoming/StoryDream-Setup-1.0.3.exe --version 1.0.3 --minimum-version 0.0.0 --notes 'Release notes'
storydream-license withdraw 1.0.3
```

The current production release is 1.0.2, sequence 2, with SHA-256 `5f156e8a33b66bc6b553e6303b1e291f276e1209d18fa3508e6943a6ba6faa21` and size 542244813 bytes. Release 1.0.1 was withdrawn after acceptance exposed a hidden interactive installer; 1.0.2 launches it visibly. The next release must be at least 1.0.3.

Use `--minimum-version 1.0.3` only when older versions must stop generating. Clients verify the signed manifest, increasing release sequence, TLS chain, platform, architecture, file length and SHA-256 before launching the installer. Partial downloads resume and are verified in full. Installation requires confirmation and no active jobs. The installer retains app data. Update checks run at startup and hourly; users can check manually. Release manifests expire after 24 hours and are freshly signed by the latest-release endpoint.

Withdrawal stops discovery and download of that release without advertising an older one. Publish a corrected **higher** version to recover. A previously installed newer version is not automatically downgraded. Release sequence values must not be reset when restoring a server.

## Backups and Recovery

The SQLite backup command creates a consistent database snapshot, but that snapshot alone cannot restore signing identity or decode activation digests:

```bash
storydream-license backup /var/lib/storydream-license/backup.sqlite3
```

For a full backup, stop only this service and archive the whole private data directory, including database/WAL, keys, `secrets.json`, certificates, client trust configuration and releases. Write the archive outside the source directory, mode 0600, and move it into the operator's encrypted off-host backup storage. Restart the service after the archive completes, including on failure. Never put this archive into source control or a public download directory.

An initial complete server-local backup was verified at `/root/storydream-license-backups/storydream-license-20261023T175858Z.tar` (UTC filename, 2026-10-24 in Shanghai). It also includes deployed code/venv, the systemd unit and operator wrapper. Size 2200791040 bytes, mode 0600, SHA-256 `f83ee78b988e9963ce95ef3fcf004374374fa1aff50643eb3a544e833cb0e942`. Post-backup restart and external strict TLS/latest-manifest checks passed. Encrypted off-host backup storage has not been configured.

To restore, stop the service, restore the complete data directory from one consistent backup, restore ownership to `storydream-license`, and start the same service code/venv. Keep the endpoint and signing keys. Test activation/refresh and latest release before reopening access. Old database snapshots can lose activations, revocations or release high-water values; reconcile them before bringing the service back.

## TLS Renewal

The private CA lasts 10 years; the endpoint certificate lasts one year. Check it monthly with `openssl x509 -in /var/lib/storydream-license/tls.pem -noout -enddate`. Renew at least 30 days before expiry:

```bash
storydream-license renew-tls
systemctl restart storydream-license
```

Renewal preserves the CA, endpoint key, release-signing identity, and desktop trust configuration. CA/signing-key replacement or an IP change requires a coordinated desktop trust update while the old endpoint still works. Keep the CA private key only in protected server storage and encrypted backups.

## Validation

```bash
python -m pip install -r requirements.txt
python -m unittest -v test_server.py
```

From the repository root, `node node_modules/vitest/vitest.mjs run tests/licensing.test.ts tests/electron-ipc-contract.test.ts` starts a real local Python TLS service. It verifies activation, locks, revocations, unbinding, signed manifests, range resume, corrupt installers, wrong CAs, anti-replay and the packaged fail-closed policy. It does not establish that the remote server is deployed or that a Windows upgrade has completed.

The 2026-10-23 local verification passed 314 relevant Vitest tests across 15 files, renderer and Electron typechecks, and the application build. Fixture-based Electron UI checks passed at desktop and compact sizes with 8 screenshots and no runtime errors; their report is `.artifacts/license-qa/report.json`. On 2026-10-24 the deployed Linux service passed all 6 Python tests, including strict TLS verification. Updated application build and both typechecks pass. Full command details and actual production acceptance results are recorded in `docs/plans/license-update-implementation-2026-10-23/progress.md`.
