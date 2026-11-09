# Progress

## 2026-10-30: local implementation complete

- Added separate Ed25519-signed differential metadata, optional validated blockmap publication, bounded Range delivery and withdrawal handling. The legacy signed release payload is unchanged.
- Integrated pinned electron-updater reconstruction with the existing private-CA trust chain, authenticated cached bases, final SHA-512/SHA-256 verification and full-download fallback. Preserved existing .part resume and installation guards.
- Added the optional matching blockmap field to the release form, including staged upload and localized errors. Automatic release announcements remain intact.
- Enabled NSIS differentialPackage explicitly, added installer/blockmap presence checks to packaging, and collect bundled runtime license texts from the main-process esbuild metafile.
- Added the rollout guide and linked it from the server README and Chinese operations guide.

## Verification

- PASS: `node node_modules/vitest/vitest.mjs run tests/differential-updates.test.ts tests/licensing.test.ts --pool=threads --maxWorkers=1`: 21 tests across 2 files (32.95 seconds on final run). Uses the real electron-builder blockmap generator, upstream downloader and isolated Python TLS server.
- PASS: `python -m unittest discover -s services/license-server -p 'test_*.py'`: 15 tests (18.760 seconds on final run).
- PASS: renderer TypeScript (`tsconfig.json`) and Electron TypeScript (`tsconfig.electron.json`), both `--noEmit`.
- PASS: `node scripts/build-electron.mjs`; generated main.js syntax check; management admin.js syntax check; PowerShell parser check of package-win.ps1 without executing packaging.
- PASS: `npm ls electron-updater builder-util-runtime electron-builder app-builder-lib --depth=1`; the pinned runtime versions resolve without dependency errors. Generated notices include original licenses for electron-updater, builder-util-runtime and bundled dependencies.
- PASS: scoped `git diff --check`. Chinese additions re-read as UTF-8.
- Recovery notes: tests use I:/opc/tmp because the C: disk cannot satisfy upload reserve checks. One parallel TypeScript attempt exhausted system memory; rerunning Electron typecheck alone passed. A test fixture initially mixed synthetic SHA-256 checksums with builder Blake2 checksums; it now uses the actual old blockmap and correctly exercises final hash rejection.

## 2026-10-30: server rollout completed

- Deployed server.py and the three admin-dist assets to production, preserving the virtualenv, service unit, CA, signing keys, administrator credentials and existing records.
- Private full backup: `/root/storydream-license-backups/storydream-differential-20261030T012906Z.tar` (2,200,934,400 bytes, mode 0600). Maintenance interruption: 30.12 seconds.
- All 15 isolated server tests passed on the production host before replacement. External pinned-CA health, signed legacy release/announcement compatibility, bounded/open Range, 416 Content-Range, missing legacy blockmap 404, admin authentication and deployed file hashes passed.
- Evidence: `.artifacts/differential-deploy-20261030/deployment.json`. Device last_seen and freshly signed issuedAt/validUntil are intentionally excluded from stable record comparisons.
- Incremented package.json and package-lock.json to 1.0.3. Sequential renderer/Electron typechecks, renderer/main build, generated JavaScript syntax checks and packaged Python imports passed. NSIS tooling download timed out; packaging is being retried with the existing F:/DevCache/electron-builder cache and already built win-unpacked output.

## Pending acceptance and publication

- No 1.0.3 desktop release has been published yet. Production credentials, CA, signing keys, licenses and announcements remain unchanged.
- Candidate packaging and isolated Windows upgrade acceptance are in progress under F:/StoryDream-deployment-20261030. The existing active machine binding will not be released or replaced for testing.
- No new desktop/mobile browser screenshot acceptance of the added form field in this turn. Its JavaScript syntax and backing upload/publication APIs are tested, but this is not a claim of end-to-end browser acceptance.

## 2026-10-30: packaged upgrade accepted

- PASS: genuine, unmodified NSIS 1.0.2-to-1.0.3 upgrade in the isolated installation; installer exit 0. UI and main process both report 1.0.3, the saved account and active production machine authorization survive the upgrade and a second restart, and no renderer runtime errors were observed.
- PASS: original user vault, registered installation, shortcuts and installer cache restored/preserved. Evidence: F:/StoryDream-deployment-20261030/acceptance/report.json.
- Accepted installer SHA-256: c2fb646d96cbcdf1048335f8c3205ac035baffb26a1e462809da3b2289c4381e. Candidate binaries were not modified during troubleshooting.
- Earlier NSIS rename failures did not recur after the standalone rename/restore preflight. The underlying transient cause is not established; no security settings or uninstall safeguards were disabled.
- Publication has not run. Paramiko, Windows OpenSSH and a connection through the already-running local HTTP proxy reach TCP port 22 but close before the SSH protocol banner. No password authentication is reached. No proxy or server security settings were changed. A browser-session fallback was unavailable because the browser tool reported no available browser.
- Final pinned-CA HTTPS checks: /v1/health = 200; /admin/ = 200; /admin/api/summary = 401; verified signed production version = 1.0.2. Existing online authorization also passed in the accepted desktop. This is an SSH publication blocker, not evidence of a website outage.
- Final installer and blockmap SHA-256 checks passed. The matching blockmap SHA-256 is 791abbc18a0c50ee2f110cc0c5785b3854b4f2441644292c879e18c8a9c0d79a. Scoped documentation diff check passed. Test applications and the credential-bearing SSH operator session were closed.
- Next action: inspect SSH service/access restrictions through the server console, then stage/publish using .artifacts/differential-deploy-20261030/publish.py, verify signatures/Range/announcements, and run post-publication desktop discovery. Do not claim 1.0.3 is live until that succeeds.

See rollout.zh-CN.md for server-first deployment order, first-full-upgrade requirements and cache limitations.
