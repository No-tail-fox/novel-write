# Differential updates

- [complete] Add signed, backward-compatible differential metadata and bounded ranges.
- [complete] Integrate a pinned upstream downloader with validated local base and full fallback.
- [complete] Extend release publishing for optional blockmaps, preserving announcements.
- [complete] Run 21 client tests, 15 server tests, renderer/Electron type checks, bundle build and syntax checks.
- [complete] Document rollout and limitations; do not publish an unverified desktop build.

- [complete] Back up production state and deploy server/admin differential support.
- [complete] Verify production trust identity, existing records, legacy clients and Range endpoints.
- [complete] Package and accept the unmodified 1.0.3 Windows installer in an isolated profile.
- [blocked] Upload the accepted installer and matching blockmap, publish and verify linked announcements; restore SSH access first.

The server/admin deployment is live and desktop acceptance passed. Publication is pending: SSH currently closes before the protocol banner, so no 1.0.3 publication has been performed. Pinned HTTPS health/admin checks still return 200, protected admin summary returns 401, and the signed production release is still 1.0.2. Server-console inspection of SSH/access restrictions is needed; credentials have not reached the authentication stage.
